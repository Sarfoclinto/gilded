-- Purchases with filters, sorting and paging, for the Transactions screen and a customer's page.
-- p: { scope: [branch ids the caller may see], branchId?, customerId?, q?, from?, to? (yyyy-mm-dd, the branch's own calendar day),
--      status?: saved|paid|void, flag?: true (only those with a flag), minAmount?, maxAmount?, sort?: newest|oldest|amount_desc|amount_asc, limit?, offset? }
-- Returns { items: [transaction...], total, sumPayable }.
create function gold.transactions_search(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_scope uuid[] := array(select jsonb_array_elements_text(coalesce(p->'scope', '[]'::jsonb))::uuid);
  v_branch uuid := nullif(p->>'branchId', '')::uuid;
  v_customer uuid := nullif(p->>'customerId', '')::uuid;
  v_q text := nullif(trim(coalesce(p->>'q', '')), '');
  v_from date := nullif(p->>'from', '')::date;
  v_to date := nullif(p->>'to', '')::date;
  v_status text := nullif(p->>'status', '');
  v_flag boolean := coalesce((p->>'flag')::boolean, false);
  v_min numeric := nullif(p->>'minAmount', '')::numeric;
  v_max numeric := nullif(p->>'maxAmount', '')::numeric;
  v_sort text := coalesce(nullif(p->>'sort', ''), 'newest');
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 25), 1), 100);
  v_offset int := greatest(coalesce((p->>'offset')::int, 0), 0);
  v_like text; v_total bigint; v_sum numeric; v_items jsonb;
begin
  if v_sort not in ('newest', 'oldest', 'amount_desc', 'amount_asc') then perform gold.fail(422, 'VALIDATION_FAILED', 'That sort order is not known.'); end if;
  if v_status is not null and v_status not in ('saved', 'paid', 'void') then perform gold.fail(422, 'VALIDATION_FAILED', 'That status is not known.'); end if;
  if v_branch is not null and not (v_branch = any (v_scope)) then perform gold.fail(403, 'FORBIDDEN', 'You do not have access to that branch.'); end if;
  v_like := case when v_q is null then null else '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;

  with hits as (
    select t.id, t.captured_at, t.created_at, t.payable
    from gold.transactions t join gold.branches b on b.id = t.branch_id
    where t.branch_id = any (v_scope)
      and (v_branch is null or t.branch_id = v_branch)
      and (v_customer is null or t.customer_id = v_customer)
      and (v_like is null or t.customer_name ilike v_like or t.reference ilike v_like or coalesce(t.customer_phone, '') ilike v_like)
      and (v_from is null or (t.captured_at at time zone b.timezone)::date >= v_from)
      and (v_to is null or (t.captured_at at time zone b.timezone)::date <= v_to)
      and (v_status is null or t.status = v_status)
      and (not v_flag or cardinality(t.flags) > 0)
      and (v_min is null or t.payable >= v_min)
      and (v_max is null or t.payable <= v_max)
  ), ranked as (
    select id, row_number() over (order by
        case when v_sort = 'amount_desc' then payable end desc nulls last,
        case when v_sort = 'amount_asc' then payable end asc nulls last,
        case when v_sort = 'oldest' then captured_at end asc,
        case when v_sort in ('newest', 'amount_desc', 'amount_asc') then captured_at end desc,
        created_at desc) as rn
    from hits
  )
  select (select count(*) from hits), (select coalesce(sum(payable), 0) from hits),
         (select coalesce(jsonb_agg(gold.transaction_json(id) order by rn), '[]'::jsonb) from ranked where rn > v_offset and rn <= v_offset + v_limit)
  into v_total, v_sum, v_items;

  return jsonb_build_object('items', v_items, 'total', v_total, 'sumPayable', gold.ts(v_sum));
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;