-- 0031 Purchases that reach the server late or with a wrong device clock.
--   * A purchase made offline during a day but synced after that day closed is flagged AFTER_CLOSE, and the people who review differences are told,
--     because that day's count will not match the books by exactly this purchase (and the day it lands in will show the opposite).
--   * A device clock running more than 5 minutes ahead is replaced by the server's time and the purchase is flagged CLOCK_AHEAD.
-- Nothing else about saving a purchase changes.

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
  b gold.branches; v_customer uuid; v_day uuid; v_flags text[]; v_late uuid; v_ref text; v_n int; v_local date;
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
  -- A device clock that runs ahead must not date the books in the future: use the server's time and say so.
  if v_at > now() + interval '5 minutes' then
    v_at := now();
    v_flags := array_append(v_flags, 'CLOCK_AHEAD');
  end if;
  -- Made while a day was open but reaching us after it closed: the cash really left that day, so its count will not match the books.
  select d.id into v_late from gold.business_days d
   where d.branch_id = v_branch and d.status = 'closed' and d.opened_at <= v_at and v_at <= d.closed_at
   order by d.opened_at desc limit 1;
  if v_late is not null then v_flags := array_append(v_flags, 'AFTER_CLOSE'); end if;

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

  if v_late is not null then
    perform gold.notify(v_tenant, 'late_purchase', format('%s was recorded after its day had closed', v_ref),
      'It was made while the day was open but reached the server later, so that day''s count may show a difference that this purchase explains.', '/drawer/history', array[v_branch], 'discrepancies:review');
  end if;
  return jsonb_build_object('replayed', false, 'data', gold.transaction_json(v_id));
end $function$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;