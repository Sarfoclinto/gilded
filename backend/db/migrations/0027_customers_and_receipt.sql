-- Customers: search with filters, sorting and totals; lifetime figures on every customer row.
-- Transactions: the cancellation details and the price time on the receipt.

-- Purchases no longer count cancelled ones; lifetime paid and first purchase are new.
create or replace function gold.customer_row_json(c gold.customers) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'phone', c.phone, 'notes', c.notes, 'createdAt', gold.iso(c.created_at),
    'purchases', (select count(*) from gold.transactions t where t.customer_id = c.id and t.status <> 'void'),
    'lifetimePaid', gold.ts(coalesce((select sum(t.payable) from gold.transactions t where t.customer_id = c.id and t.status <> 'void'), 0)),
    'firstPurchaseAt', (select case when min(t.captured_at) is null then null else gold.iso(min(t.captured_at)) end from gold.transactions t where t.customer_id = c.id and t.status <> 'void'),
    'lastPurchaseAt', (select case when max(t.captured_at) is null then null else gold.iso(max(t.captured_at)) end from gold.transactions t where t.customer_id = c.id and t.status <> 'void'),
    'owesUs', gold.ts(coalesce((select sum(d.outstanding) from gold.v_debts_outstanding d where d.customer_id = c.id and d.status = 'open' and d.direction = 'receivable'), 0)),
    'weOwe', gold.ts(coalesce((select sum(d.outstanding) from gold.v_debts_outstanding d where d.customer_id = c.id and d.status = 'open' and d.direction = 'payable'), 0)))
$$;

-- p: { q?, filter?: all|owes_us|we_owe|active|inactive, sort?: name|recent|purchases|paid|owes, limit?, offset? }
-- Returns { total, items, summary: { customers, active, owesUs, weOwe } }. The summary ignores q and filter.
-- active = bought in the last 30 days; inactive = nothing in the last 90 days (or never).
create function gold.customers_query_json(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_q text := nullif(trim(coalesce(p->>'q', '')), '');
  v_like text;
  v_filter text := coalesce(nullif(p->>'filter', ''), 'all');
  v_sort text := coalesce(nullif(p->>'sort', ''), 'name');
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 25), 1), 100);
  v_offset int := greatest(coalesce((p->>'offset')::int, 0), 0);
  v_total bigint; v_items jsonb; v_summary jsonb;
begin
  if v_filter not in ('all', 'owes_us', 'we_owe', 'active', 'inactive') then perform gold.fail(422, 'VALIDATION_FAILED', 'That filter is not known.'); end if;
  if v_sort not in ('name', 'recent', 'purchases', 'paid', 'owes') then perform gold.fail(422, 'VALIDATION_FAILED', 'That sort order is not known.'); end if;
  v_like := case when v_q is null then null else '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;

  with st as (
    select c.id, c.name,
           (select count(*) from gold.transactions t where t.customer_id = c.id and t.status <> 'void') as purchases,
           (select max(t.captured_at) from gold.transactions t where t.customer_id = c.id and t.status <> 'void') as last_at,
           coalesce((select sum(t.payable) from gold.transactions t where t.customer_id = c.id and t.status <> 'void'), 0) as paid,
           coalesce((select sum(d.outstanding) from gold.v_debts_outstanding d where d.customer_id = c.id and d.status = 'open' and d.direction = 'receivable'), 0) as owes_us,
           coalesce((select sum(d.outstanding) from gold.v_debts_outstanding d where d.customer_id = c.id and d.status = 'open' and d.direction = 'payable'), 0) as we_owe
    from gold.customers c
  ), hits as (
    select st.* from st join gold.customers c on c.id = st.id
    where (v_like is null or lower(c.name) like v_like escape '\' or coalesce(c.phone, '') like v_like escape '\')
      and case v_filter
            when 'owes_us' then st.owes_us > 0
            when 'we_owe' then st.we_owe > 0
            when 'active' then st.last_at >= now() - interval '30 days'
            when 'inactive' then st.last_at is null or st.last_at < now() - interval '90 days'
            else true end
  ), ranked as (
    select id, row_number() over (order by
      case when v_sort = 'recent' then last_at end desc nulls last,
      case when v_sort = 'purchases' then purchases end desc,
      case when v_sort = 'paid' then paid end desc,
      case when v_sort = 'owes' then owes_us + we_owe end desc,
      lower(name), id) as rn
    from hits
  )
  select (select count(*) from hits),
         coalesce((select jsonb_agg(gold.customer_row_json(c) order by o.rn)
                   from ranked o join gold.customers c on c.id = o.id where o.rn > v_offset and o.rn <= v_offset + v_limit), '[]'::jsonb),
         (select jsonb_build_object('customers', count(*), 'active', count(*) filter (where last_at >= now() - interval '30 days'),
                                    'owesUs', gold.ts(coalesce(sum(owes_us), 0)), 'weOwe', gold.ts(coalesce(sum(we_owe), 0))) from st)
  into v_total, v_items, v_summary;
  return jsonb_build_object('total', v_total, 'items', v_items, 'summary', v_summary);
end $$;

-- The receipt also needs: when the price was fixed, and, for a cancelled purchase, when, by whom and why.
create or replace function gold.transaction_json(p_id uuid)
 returns jsonb language sql stable as $function$
  select jsonb_build_object(
    'id', t.id, 'branchId', t.branch_id, 'reference', t.reference, 'customerId', t.customer_id,
    'customerName', t.customer_name, 'customerPhone', t.customer_phone, 'status', t.status,
    'representative', case when t.represented_by_name is null then null else jsonb_build_object('name', t.represented_by_name, 'phone', t.represented_by_phone) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'label', i.label, 'top', gold.ts(i.top), 'down', gold.ts(i.down), 'price', gold.ts(i.price),
        'result', jsonb_build_object('density', gold.ts(i.density), 'karat', gold.ts(i.karat), 'purity', gold.ts(i.purity),
                                     'netWeight', gold.ts(i.net_weight), 'pounds', gold.ts(i.pounds), 'amount', gold.ts(i.amount))) order by i.line_no)
        from gold.transaction_items i where i.transaction_id = t.id), '[]'::jsonb),
    'formulaVersion', t.formula_version, 'calculatedAmount', gold.ts(t.calculated_amount),
    'payout', jsonb_build_object(
        'policy', t.payout_policy, 'strategy', t.payout_strategy, 'payable', gold.ts(t.payable),
        'lines', gold.lines_json('transaction_payout', t.id), 'difference', gold.ts(t.payout_difference),
        'totalNotes', (select coalesce(sum(abs(delta_count)), 0) from gold.ledger_entries
                       where asset = 'cash' and source_type = 'transaction_payout' and source_id = t.id)),
    'payments', coalesce((select jsonb_agg(gold.payment_json(p.id) order by p.created_at, p.id)
                          from gold.transaction_payments p where p.transaction_id = t.id), '[]'::jsonb),
    'capturedAt', gold.iso(t.captured_at), 'createdAt', gold.iso(t.created_at), 'createdBy', gold.person_json(t.created_by),
    'flags', to_jsonb(t.flags),
    'priceAsOf', gold.iso(t.price_as_of),
    'voidedAt', case when t.voided_at is null then null else gold.iso(t.voided_at) end,
    'voidReason', t.void_reason,
    'voidedBy', case when t.voided_by is null then null else gold.person_json(t.voided_by) end)
  from gold.transactions t where t.id = p_id
$function$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;