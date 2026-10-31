-- 0038 Two-step payout, and the company settings that switch it on.
--   * gold.tenant_settings: a few named company settings (validated), read by everyone in the company, changed with settings:manage.
--   * With payout.twoStep on, saving a purchase records the gold and books the cash part as owed to the customer (the 'payable' asset);
--     the cash leaves the drawer only when someone pays it out with gold.pay_transaction. The amount cannot change at that step, only
--     which notes make it up. Non-cash parts (mobile money, owed, gold against a debt) are applied at once, as before.
--   * Paying is first-come: a second attempt is refused with ALREADY_PAID, naming who paid and when. Paying twice cannot take cash twice.
--   * payout.sameUserMayPay (default on) lets a one-person branch record and pay; switched off, a different person must pay.
--   * payout.blindCheck makes the payer re-enter the amount from the weights without seeing ours; a mismatch refuses the payment and is flagged.

create table gold.tenant_settings (
  tenant_id  uuid not null,
  key        text not null,
  value      jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key),
  foreign key (tenant_id, updated_by) references gold.users (tenant_id, id)
);
alter table gold.tenant_settings enable row level security;
alter table gold.tenant_settings force row level security;
create policy tenant_isolation on gold.tenant_settings using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());

-- Every setting the system knows, with its default and what it may hold.
create function gold.setting_defaults() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'payout.twoStep', false,
    'payout.sameUserMayPay', true,
    'payout.blindCheck', false,
    'allowance.perPerson', 100,
    'receipt.printer', false,
    'receipt.paper', '80',
    'receipt.businessName', '',
    'receipt.tagline', '',
    'receipt.address', '',
    'receipt.phone', '',
    'receipt.footer', '')
$$;

create function gold.settings_json() returns jsonb language sql stable as $$
  select gold.setting_defaults() || coalesce((select jsonb_object_agg(key, value) from gold.tenant_settings), '{}'::jsonb)
$$;

create function gold.setting(p_key text) returns jsonb language sql stable as $$
  select gold.settings_json() -> p_key
$$;

create function gold.set_settings(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant(); v_user uuid := gold.require_actor();
  v_defaults jsonb := gold.setting_defaults(); v_before jsonb := gold.settings_json(); r record; v_t text;
begin
  if p is null or jsonb_typeof(p) <> 'object' or p = '{}'::jsonb then perform gold.fail(422, 'VALIDATION_FAILED', 'Nothing to change.'); end if;
  for r in select key, value from jsonb_each(p) loop
    if not v_defaults ? r.key then perform gold.fail(422, 'VALIDATION_FAILED', format('"%s" is not a setting.', r.key)); end if;
    v_t := jsonb_typeof(v_defaults -> r.key);
    if jsonb_typeof(r.value) <> v_t then perform gold.fail(422, 'VALIDATION_FAILED', format('The setting "%s" must be a %s.', r.key, v_t)); end if;
    if r.key = 'allowance.perPerson' and ((r.value #>> '{}')::numeric < 0 or (r.value #>> '{}')::numeric > 10000 or (r.value #>> '{}')::numeric <> trunc((r.value #>> '{}')::numeric)) then
      perform gold.fail(422, 'VALIDATION_FAILED', 'The allowance must be a whole number of cedis from 0 to 10,000.');
    end if;
    if r.key = 'receipt.paper' and (r.value #>> '{}') not in ('80', '58', 'a4') then perform gold.fail(422, 'VALIDATION_FAILED', 'Paper must be 80, 58 or a4.'); end if;
    if v_t = 'string' and char_length(r.value #>> '{}') > 200 then perform gold.fail(422, 'VALIDATION_FAILED', format('"%s" is too long (200 characters at most).', r.key)); end if;
    insert into gold.tenant_settings (tenant_id, key, value, updated_by) values (v_tenant, r.key, r.value, v_user)
    on conflict (tenant_id, key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  end loop;
  perform gold.audit('settings.changed', 'settings', v_tenant::text, v_before, gold.settings_json());
  return gold.settings_json();
end $$;

-- Directors may change settings (existing companies).
insert into gold.role_permissions (tenant_id, role_id, permission)
select r.tenant_id, r.id, 'settings:manage' from gold.roles r where r.key = 'director' and r.is_system
on conflict do nothing;

-- ---------------------------------------------------------------- purchases waiting to be paid
alter table gold.transactions add column stage text not null default 'paid' check (stage in ('paid', 'to_pay'));
alter table gold.transactions add column cash_due numeric(18,2) not null default 0 check (cash_due >= 0);
alter table gold.transactions add column suggested_lines jsonb;
alter table gold.transactions add column paid_by uuid;
alter table gold.transactions add column paid_at timestamptz;
alter table gold.transactions add column check_amount numeric(18,2);
alter table gold.transactions add column check_matched boolean;
alter table gold.transactions add foreign key (tenant_id, paid_by) references gold.users (tenant_id, id);
alter table gold.transactions add constraint to_pay_has_amount check (stage <> 'to_pay' or cash_due > 0);
create index transactions_to_pay on gold.transactions (tenant_id, branch_id, created_at desc) where stage = 'to_pay' and status <> 'void';

-- The purchase, plus where it stands in the payout.
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

-- Saving a purchase (as 0031, plus the two-step booking).
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

-- Purchases of a branch that still need paying, newest first, for the payer's list. Search matches the number, name or phone.
create function gold.to_pay_json(p_branch uuid, p_search text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(gold.transaction_json(x.id) order by x.created_at desc), '[]'::jsonb)
  from (select t.id, t.created_at from gold.transactions t
         where t.branch_id = p_branch and t.stage = 'to_pay' and t.status <> 'void'
           and (nullif(trim(p_search), '') is null
                or t.reference ilike '%' || trim(p_search) || '%' or t.customer_name ilike '%' || trim(p_search) || '%'
                or t.customer_phone like '%' || regexp_replace(trim(p_search), '\s', '', 'g') || '%')
         order by t.created_at desc limit 100) x
$$;

-- Pay out the cash of a purchase. p: {id (the purchase), branchId, lines (notes), capturedAt, checkAmount?}.
-- The notes must add up to exactly the cash still due. The first payment wins; a repeat of the same payment is a replay.
create function gold.pay_transaction(p jsonb) returns jsonb language plpgsql as $$
declare
  v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_lines jsonb := p->'lines';
  v_at timestamptz := least(coalesce((p->>'capturedAt')::timestamptz, now()), now());
  t gold.transactions; v_day uuid; v_who text; v_check numeric; v_matched boolean;
begin
  select * into t from gold.transactions where id = v_id for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Purchase was not found.'); end if;
  if t.status = 'void' then perform gold.fail(409, 'TRANSACTION_VOID', 'This purchase was cancelled.'); end if;
  if t.stage = 'paid' then
    if t.paid_by is null then perform gold.fail(409, 'ALREADY_PAID', 'This purchase was already paid when it was saved.'); end if;
    if t.paid_by = v_user and gold.lines_json('transaction_payout', t.id) = coalesce(v_lines, '{}'::jsonb) then
      return jsonb_build_object('replayed', true, 'data', gold.transaction_json(v_id));
    end if;
    select display_name into v_who from gold.users where id = t.paid_by;
    perform gold.fail(409, 'ALREADY_PAID', format('Already paid by %s at %s.', coalesce(v_who, 'someone else'), to_char(t.paid_at at time zone (select timezone from gold.branches where id = t.branch_id), 'HH24:MI')));
  end if;
  if t.created_by = v_user and not coalesce((gold.setting('payout.sameUserMayPay'))::boolean, true) then
    perform gold.fail(403, 'SAME_PERSON', 'Another person has to pay this one out.');
  end if;
  if gold.lines_total(v_lines) <> t.cash_due then
    perform gold.fail(422, 'PAYOUT_MISMATCH', format('The notes must add up to exactly GHS %s. Only the notes can change, not the amount.', gold.ts(t.cash_due)));
  end if;
  v_day := gold.open_day_id(t.branch_id);
  if v_day is null then perform gold.fail(409, 'NO_OPEN_DAY', 'Open the day before paying cash out.'); end if;

  if coalesce((gold.setting('payout.blindCheck'))::boolean, false) and nullif(p->>'checkAmount', '') is null then
    perform gold.fail(422, 'CHECK_REQUIRED', 'Enter the amount worked out from the weights before paying.');
  end if;
  if nullif(p->>'checkAmount', '') is not null then
    v_check := (p->>'checkAmount')::numeric;
    v_matched := v_check = t.calculated_amount;
    if not v_matched then
      -- Refuse, and make a note that someone noticed: the books are unchanged.
      perform gold.notify(t.tenant_id, 'check_mismatch', format('%s: the check does not match', t.reference),
        format('The amount worked out at the paying desk (GHS %s) differs from the recorded one (GHS %s).', gold.ts(v_check), gold.ts(t.calculated_amount)),
        '/transactions/' || t.id::text, array[t.branch_id], 'discrepancies:review');
      perform gold.fail(409, 'CHECK_MISMATCH', format('Your figure (GHS %s) does not match the recorded amount. Check the weights and the price with the person who recorded it.', gold.ts(v_check)));
    end if;
  end if;

  perform gold.post_cash(t.branch_id, v_day, v_at, v_lines, -1, 'transaction_payout', t.id, 'Paid for ' || t.reference);
  perform gold.post_value('payable', t.branch_id, v_day, v_at, -t.cash_due, 'payable_settlement', t.id, 'Cash paid for ' || t.reference);
  insert into gold.transaction_payments (tenant_id, transaction_id, method, amount, recorded_by, confirmed_by, confirmed_at)
  values (t.tenant_id, t.id, 'cash', t.cash_due, v_user, v_user, v_at);
  update gold.transactions set stage = 'paid', paid_by = v_user, paid_at = v_at, check_amount = v_check, check_matched = v_matched where id = t.id;
  return jsonb_build_object('replayed', false, 'data', gold.transaction_json(t.id));
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert, update on gold.tenant_settings to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;