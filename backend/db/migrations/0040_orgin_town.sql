-- 0040 Where the gold comes from.
--   * gold.origin_towns: a company's own list of towns. Matching ignores case, spaces and punctuation, so "obuasi " finds "Obuasi"
--     instead of making a second one. Anyone who records a purchase may add a town on the spot (offline too: the device picks the id).
--   * gold.transactions.origin_town_id: optional. A purchase never needs it. It is the raw material for "what carat to expect from here".
--   * The purchase payload carries originTown: {id?, name}. If the name already exists the existing town is used, whatever id was sent.

create table gold.origin_towns (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  name       text not null check (char_length(name) between 2 and 80),
  name_key   text not null check (name_key <> ''),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name_key),
  foreign key (tenant_id, created_by) references gold.users (tenant_id, id)
);
alter table gold.origin_towns enable row level security;
alter table gold.origin_towns force row level security;
create policy tenant_isolation on gold.origin_towns using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());


alter table gold.transactions add column origin_town_id uuid;
alter table gold.transactions add constraint transactions_origin_town_fk foreign key (tenant_id, origin_town_id) references gold.origin_towns (tenant_id, id);
create index transactions_origin_town on gold.transactions (tenant_id, origin_town_id) where origin_town_id is not null;

create function gold.town_key(p text) returns text language sql immutable as $$
  select lower(regexp_replace(coalesce(p, ''), '[^[:alnum:]]', '', 'g'))
$$;

-- Finds or creates the town named in a purchase or in a request. Null when no town was given.
create function gold.resolve_town(p jsonb) returns uuid language plpgsql as $$
declare
  v_name text; v_key text; v_id uuid; v_new uuid;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;
  v_name := trim(regexp_replace(coalesce(p->>'name', ''), '\s+', ' ', 'g'));
  if v_name = '' then
    -- an id on its own: it must be one of ours
    if nullif(p->>'id', '') is null then return null; end if;
    select id into v_id from gold.origin_towns where id = (p->>'id')::uuid;
    if v_id is null then perform gold.fail(422, 'VALIDATION_FAILED', 'That town is not in your list. Type its name to add it.'); end if;
    return v_id;
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then perform gold.fail(422, 'VALIDATION_FAILED', 'A town name is 2 to 80 letters.'); end if;
  v_key := gold.town_key(v_name);
  if v_key = '' then perform gold.fail(422, 'VALIDATION_FAILED', 'A town name needs letters or numbers.'); end if;
  select id into v_id from gold.origin_towns where name_key = v_key;
  if v_id is not null then return v_id; end if;
  v_new := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
  insert into gold.origin_towns (id, tenant_id, name, name_key, created_by) values (v_new, gold.current_tenant(), v_name, v_key, gold.current_actor())
  on conflict (tenant_id, name_key) do nothing;
  select id into v_id from gold.origin_towns where name_key = v_key;
  return v_id;
end $$;

create function gold.create_town(p jsonb) returns jsonb language plpgsql as $$
declare v_id uuid;
begin
  perform gold.require_actor();
  if p is null or not gold.has_text(p->>'name', 2) then perform gold.fail(422, 'VALIDATION_FAILED', 'Write the town name.'); end if;
  v_id := gold.resolve_town(p);
  return (select jsonb_build_object('id', o.id, 'name', o.name, 'uses', (select count(*) from gold.transactions t where t.origin_town_id = o.id)) from gold.origin_towns o where o.id = v_id);
end $$;

-- The company's towns, most used first. q narrows by name. The list is small, so it is not paged.
create function gold.towns_json(p_q text default null) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x order by uses desc, name), '[]'::jsonb) from (
    select o.name, o.id, (select count(*) from gold.transactions t where t.origin_town_id = o.id) as uses
    from gold.origin_towns o
    where nullif(trim(coalesce(p_q, '')), '') is null or o.name_key like '%' || gold.town_key(p_q) || '%'
    order by 3 desc, 1 limit 500
  ) y, lateral (select jsonb_build_object('id', y.id, 'name', y.name, 'uses', y.uses) as x) z
$$;

create or replace FUNCTION gold.post_transaction(p jsonb)
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
  b gold.branches; v_town uuid; v_customer uuid; v_day uuid; v_flags text[]; v_late uuid; v_ref text; v_n int; v_local date;
  pay jsonb; v_sum numeric := 0; v_top numeric; v_down numeric; h gold.collateral_holdings;
  v_two boolean := coalesce((gold.setting('payout.twoStep'))::boolean, false); v_due numeric := 0; v_suggest jsonb;
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

  v_town := gold.resolve_town(p->'originTown');

  insert into gold.transactions (id, tenant_id, branch_id, business_day_id, reference, customer_id, customer_name, customer_phone, status,
                                 formula_version, price_as_of, client_amount, calculated_amount, payout_policy, payout_strategy, payable,
                                 payout_difference, captured_at, created_by, flags, represented_by_name, represented_by_phone, origin_town_id)
  values (v_id, v_tenant, v_branch, v_day, v_ref, v_customer, v_name, v_phone, 'saved', p->>'formulaVersion', (p->>'priceAsOf')::timestamptz,
          (p->>'clientAmount')::numeric, (p->>'calculatedAmount')::numeric, p->>'policy', p->>'strategy', v_payable,
          (p->>'difference')::numeric, v_at, v_user, v_flags, v_rep_name, v_rep_phone, v_town);

  insert into gold.transaction_items (id, tenant_id, transaction_id, line_no, label, top, down, price, density, karat, purity, net_weight, pounds,
                                      amount, location_branch_id)
  select (i->>'id')::uuid, v_tenant, v_id, ord::smallint, nullif(trim(coalesce(i->>'label', '')), ''), (i->>'top')::numeric, (i->>'down')::numeric,
         (i->>'price')::numeric, (i->>'density')::numeric, (i->>'karat')::numeric, (i->>'purity')::numeric, (i->>'netWeight')::numeric,
         (i->>'pounds')::numeric, (i->>'amount')::numeric, v_branch
  from jsonb_array_elements(p->'items') with ordinality as t(i, ord);

  for pay in select * from jsonb_array_elements(coalesce(p->'payments', '[]'::jsonb)) loop
    if v_two and pay->>'method' = 'cash' then
      -- Two-step: the cash is paid out later by whoever hands it over. Until then it is an amount owed to the customer.
      v_due := (pay->>'amount')::numeric;
      if v_due <= 0 or v_due <> trunc(v_due) then perform gold.fail(422, 'VALIDATION_FAILED', 'Each part of the payment must be a whole number of cedis above zero.'); end if;
      if gold.lines_total(pay->'lines') <> v_due then perform gold.fail(422, 'PAYOUT_MISMATCH', 'The notes do not add up to the cash amount.'); end if;
      v_suggest := pay->'lines';
    else
      perform gold.apply_payment(v_id, v_branch, v_day, v_at, v_customer, v_ref, pay);
    end if;
  end loop;

  select sum(top), sum(down) into v_top, v_down from gold.transaction_items where transaction_id = v_id;
  perform gold.post_goods(v_branch, v_day, v_at, v_top, v_down, v_payable, 'transaction_purchase', v_id, 'Gold bought ' || v_ref);
  if v_due > 0 then
    update gold.transactions set stage = 'to_pay', cash_due = v_due, suggested_lines = v_suggest where id = v_id;
    perform gold.post_value('payable', v_branch, v_day, v_at, v_due, 'payable_issued', v_id, 'Cash still to pay for ' || v_ref);
    perform gold.notify(v_tenant, 'purchase_to_pay', format('%s is ready to be paid', v_ref),
      format('%s: GHS %s to pay out.', v_name, gold.ts(v_due)), '/transactions/' || v_id::text, array[v_branch], 'days:manage');
  end if;

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

create or replace function gold.transaction_json(p_id uuid)
 returns jsonb language sql stable as $function$
  select jsonb_build_object(
    'id', t.id, 'branchId', t.branch_id, 'reference', t.reference, 'customerId', t.customer_id,
    'customerName', t.customer_name, 'customerPhone', t.customer_phone, 'status', t.status,
    'representative', case when t.represented_by_name is null then null else jsonb_build_object('name', t.represented_by_name, 'phone', t.represented_by_phone) end,
    'originTown', (select jsonb_build_object('id', o.id, 'name', o.name) from gold.origin_towns o where o.id = t.origin_town_id),
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
                       where asset = 'cash' and source_type = 'transaction_payout' and source_id = t.id),
        'stage', t.stage, 'cashDue', gold.ts(t.cash_due), 'suggestedLines', case when t.stage = 'to_pay' then t.suggested_lines else null end,
        'paidBy', case when t.paid_by is null then null else gold.person_json(t.paid_by) end,
        'paidAt', case when t.paid_at is null then null else gold.iso(t.paid_at) end,
        'checkMatched', t.check_matched),
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
    grant select, insert on gold.origin_towns to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;