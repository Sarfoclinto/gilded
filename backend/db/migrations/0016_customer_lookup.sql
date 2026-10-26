-- 0016 Who is at the counter, and who the purchase is for.
--
-- A purchase belongs to a customer (their debts, their history). Sometimes a customer sends someone else with the gold: that person is
-- the representative. They are written on the purchase but are NOT turned into a customer; the purchase is linked to the customer who sent them.
-- Also: customers made on a device (possibly offline) keep the id the device gave them, so queued purchases for the same new person agree,
-- and the lookup used by the customer picker lists this branch's customers first.

alter table gold.transactions add column represented_by_name  text;
alter table gold.transactions add column represented_by_phone text;
alter table gold.transactions add constraint represented_by_has_name check (represented_by_name is null or gold.has_text(represented_by_name, 1));
alter table gold.transactions add constraint representative_phone_needs_name check (represented_by_phone is null or represented_by_name is not null);

create or replace function gold.ensure_customer(p_id uuid, p_name text, p_phone text) returns uuid language plpgsql as $$
declare v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '\s', '', 'g'), ''); v_id uuid;
begin
  if p_id is not null then
    if exists (select 1 from gold.customers where id = p_id) then return p_id; end if;
    -- A new customer made on a device with its own id (it may have been offline). Needs a phone so they can be found again.
    if v_phone is null or not gold.has_text(p_name, 1) then perform gold.fail(404, 'NOT_FOUND', 'Customer was not found.'); end if;
    select id into v_id from gold.customers where lower(name) = lower(trim(p_name)) and phone = v_phone limit 1;
    if v_id is not null then return v_id; end if;   -- another branch or device already added the same person
    insert into gold.customers (id, tenant_id, name, phone, created_by) values (p_id, gold.current_tenant(), trim(p_name), v_phone, gold.current_actor());
    return p_id;
  end if;
  if v_phone is null then return null; end if;
  select id into v_id from gold.customers where lower(name) = lower(trim(p_name)) and phone = v_phone limit 1;
  if v_id is null then
    insert into gold.customers (tenant_id, name, phone, created_by) values (gold.current_tenant(), trim(p_name), v_phone, gold.current_actor())
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- The picker's list. Customers who have sold at this branch come first (most recent first), then everyone else in the company.
-- An exact phone match always leads. With no text it returns the branch's directory, which a device keeps for use offline.
create function gold.customers_lookup_json(p_q text, p_branch uuid, p_limit int default 25) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'phone', phone, 'atBranch', last_here is not null) order by exact desc, (last_here is not null) desc, last_here desc nulls last, name), '[]'::jsonb)
  from (
    select c.id, c.name, c.phone,
           (select max(t.captured_at) from gold.transactions t where t.customer_id = c.id and t.branch_id = p_branch) as last_here,
           (nullif(p_q, '') is not null and c.phone = regexp_replace(p_q, '\s', '', 'g')) as exact
    from gold.customers c
    where nullif(trim(coalesce(p_q, '')), '') is null
       or lower(c.name) like '%' || lower(trim(p_q)) || '%'
       or c.phone like '%' || regexp_replace(p_q, '\s', '', 'g') || '%'
    order by 5 desc, 4 desc nulls last, c.name
    limit least(coalesce(p_limit, 25), 1000)
  ) x
$$;

CREATE OR REPLACE FUNCTION gold.post_transaction(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_tenant uuid := gold.current_tenant();
  v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_branch uuid := (p->>'branchId')::uuid;
  v_at timestamptz := (p->>'capturedAt')::timestamptz;
  v_payable numeric := (p->>'payable')::numeric;
  v_name text := trim(coalesce(p#>>'{customer,name}', ''));
  v_phone text := nullif(regexp_replace(coalesce(p#>>'{customer,phone}', ''), '\s', '', 'g'), '');
  v_rep_name text := nullif(trim(coalesce(p#>>'{representative,name}', '')), '');
  v_rep_phone text := nullif(regexp_replace(coalesce(p#>>'{representative,phone}', ''), '\s', '', 'g'), '');
  b gold.branches; v_customer uuid; v_day uuid; v_flags text[]; v_ref text; v_n int; v_local date;
  pay jsonb; v_sum numeric := 0; v_top numeric; v_down numeric; h gold.collateral_holdings;
begin
  if exists (select 1 from gold.transactions where id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.transaction_json(v_id));
  end if;
  select * into b from gold.branches where id = v_branch and is_active;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Branch was not found.'); end if;
  if not gold.has_text(v_name, 1) then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the customer name.'); end if;
  if not exists (select 1 from gold.formula_versions where key = p->>'formulaVersion') then
    perform gold.fail(409, 'FORMULA_NOT_CONFIGURED', 'The calculation settings are missing for this company. Run the seed command.');
  end if;
  if v_payable is null or v_payable < 0 or v_payable <> trunc(v_payable) or mod(v_payable, 5) <> 0 then
    perform gold.fail(422, 'PAYOUT_MISMATCH', 'The amount to pay must be a whole number of cedis, a multiple of 5.');
  end if;
  for pay in select * from jsonb_array_elements(coalesce(p->'payments', '[]'::jsonb)) loop
    v_sum := v_sum + (pay->>'amount')::numeric;
  end loop;
  if v_sum <> v_payable then
    perform gold.fail(422, 'PAYOUT_MISMATCH', 'The parts of the payment (' || gold.ts(v_sum) || ') must add up to the amount to pay (' || gold.ts(v_payable) || ').');
  end if;

  v_customer := gold.ensure_customer((p#>>'{customer,id}')::uuid, v_name, v_phone);
  -- Someone brought the gold for the customer: the customer owns the purchase and any debts; the representative is only written on it.
  if v_rep_name is not null and v_customer is null then
    perform gold.fail(422, 'REPRESENTATIVE_NEEDS_CUSTOMER', 'Pick the customer this person is acting for, or give the customer''s phone number.');
  end if;
  if v_rep_phone is not null and v_rep_name is null then
    perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the name of the person bringing the gold.');
  end if;
  v_day := gold.open_day_id(v_branch);
  v_flags := coalesce(array(select jsonb_array_elements_text(coalesce(p->'flags', '[]'::jsonb))), '{}');
  if v_day is null then v_flags := array_append(v_flags, 'NO_OPEN_DAY'); end if;

  v_local := (v_at at time zone b.timezone)::date;
  v_n := gold.next_document_number(v_tenant, 'transaction', v_branch, v_local);
  v_ref := b.code || '-' || to_char(v_local, 'YYYYMMDD') || '-' || lpad(v_n::text, 4, '0');

  insert into gold.transactions (id, tenant_id, branch_id, business_day_id, reference, customer_id, customer_name, customer_phone, status,
                                 formula_version, price_as_of, client_amount, calculated_amount, payout_policy, payout_strategy, payable,
                                 payout_difference, captured_at, created_by, flags, represented_by_name, represented_by_phone)
  values (v_id, v_tenant, v_branch, v_day, v_ref, v_customer, v_name, v_phone, 'saved', p->>'formulaVersion', (p->>'priceAsOf')::timestamptz,
          (p->>'clientAmount')::numeric, (p->>'calculatedAmount')::numeric, p->>'policy', p->>'strategy', v_payable,
          (p->>'difference')::numeric, v_at, v_user, v_flags, v_rep_name, v_rep_phone);

  insert into gold.transaction_items (id, tenant_id, transaction_id, line_no, label, top, down, price, density, karat, purity, net_weight, pounds,
                                      amount, location_branch_id)
  select (i->>'id')::uuid, v_tenant, v_id, ord::smallint, nullif(trim(coalesce(i->>'label', '')), ''), (i->>'top')::numeric, (i->>'down')::numeric,
         (i->>'price')::numeric, (i->>'density')::numeric, (i->>'karat')::numeric, (i->>'purity')::numeric, (i->>'netWeight')::numeric,
         (i->>'pounds')::numeric, (i->>'amount')::numeric, v_branch
  from jsonb_array_elements(p->'items') with ordinality as t(i, ord);

  for pay in select * from jsonb_array_elements(coalesce(p->'payments', '[]'::jsonb)) loop
    perform gold.apply_payment(v_id, v_branch, v_day, v_at, v_customer, v_ref, pay);
  end loop;

  select sum(top), sum(down) into v_top, v_down from gold.transaction_items where transaction_id = v_id;
  perform gold.post_goods(v_branch, v_day, v_at, v_top, v_down, v_payable, 'transaction_purchase', v_id, 'Gold bought ' || v_ref);

  if nullif(p->>'collateralId', '') is not null then
    select * into h from gold.collateral_holdings where id = (p->>'collateralId')::uuid for update;
    if not found then perform gold.fail(404, 'NOT_FOUND', 'That security was not found.'); end if;
    if h.status <> 'held' then perform gold.fail(409, 'COLLATERAL_NOT_HELD', 'This gold is no longer held.'); end if;
    if h.branch_id <> v_branch or h.customer_id is distinct from v_customer then
      perform gold.fail(422, 'COLLATERAL_MISMATCH', 'This security belongs to another customer or branch.');
    end if;
    update gold.collateral_holdings set status = 'converted', converted_transaction_id = v_id, closed_by = v_user, closed_at = v_at where id = h.id;
    perform gold.post_custody(v_branch, v_day, v_at, -h.top_weight, 'custody_out', h.id, 'Refined and bought ' || v_ref);
  end if;

  return jsonb_build_object('replayed', false, 'data', gold.transaction_json(v_id));
end $function$;

CREATE OR REPLACE FUNCTION gold.transaction_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
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
    'flags', to_jsonb(t.flags))
  from gold.transactions t where t.id = p_id
$function$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;