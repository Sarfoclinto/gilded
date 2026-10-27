-- 0020 Data import (B7b): past purchases and customers brought in from spreadsheets so lists, customer histories and reports show real history.
--  Past purchases are records only. They never touch the drawer, the gold on hand or any debt: those were counted another way before
--  go-live, and the first day's count and the opening balances (a separate step) set the starting position. Their gold is marked
--  'historical', so it can never be offered for a transfer. Each is flagged HISTORICAL and numbered H... so it is obvious in every list.
--  A batch can be undone: its purchases are voided with a reason (nothing is deleted).

create table gold.import_batches (
  id          uuid primary key,
  tenant_id   uuid not null,
  kind        text not null check (kind in ('history', 'customers')),
  label       text,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  undone_at   timestamptz,
  undone_by   uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references gold.users (tenant_id, id)
);
alter table gold.import_batches enable row level security;
alter table gold.import_batches force row level security;
create policy tenant_isolation on gold.import_batches
  using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());

alter table gold.transactions add column imported_batch uuid, add column import_key text, add column import_ref text, add column import_note text;
alter table gold.transactions add constraint import_has_key check ((imported_batch is null) = (import_key is null));
create unique index transactions_import_once on gold.transactions (tenant_id, imported_batch, import_key) where imported_batch is not null;

alter table gold.transaction_items drop constraint transaction_items_location_state_check;
alter table gold.transaction_items add constraint transaction_items_location_state_check check (location_state in ('on_hand', 'in_transit', 'historical'));

-- The list shows the newest purchases by when they happened, so a large import never pushes today's work out of view.
create or replace function gold.transactions_json(p_branch uuid, p_limit int) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(gold.transaction_json(id) order by captured_at desc, created_at desc), '[]'::jsonb)
  from (select id, captured_at, created_at from gold.transactions where branch_id = p_branch order by captured_at desc, created_at desc limit least(coalesce(p_limit, 50), 200)) x
$$;

-- p: { batchId, label?, rows: [ { key, branchId, capturedAt, customer{name,phone}, items[], formulaVersion, calculatedAmount, clientAmount, payable, receiptNo?, note?, flags[] } ] }
-- Returns { created, skipped, rows: [ { key, status: created | exists, reference } ] }. Resending a batch is safe: a row already imported is skipped.
create function gold.import_history(p jsonb, p_scope uuid[]) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant(); v_user uuid := gold.require_actor(); v_batch uuid := (p->>'batchId')::uuid;
  r jsonb; b gold.branches; v_id uuid; v_at timestamptz; v_local date; v_n int; v_ref text; v_customer uuid; v_name text; v_phone text;
  v_flags text[]; v_created int := 0; v_skipped int := 0; v_out jsonb := '[]'::jsonb; v_payable numeric;
begin
  if v_batch is null then perform gold.fail(422, 'VALIDATION_FAILED', 'A batch id is needed.'); end if;
  if jsonb_typeof(p->'rows') <> 'array' or jsonb_array_length(p->'rows') not between 1 and 500 then
    perform gold.fail(422, 'VALIDATION_FAILED', 'Send 1 to 500 rows at a time.');
  end if;
  insert into gold.import_batches (id, tenant_id, kind, label, created_by) values (v_batch, v_tenant, 'history', nullif(trim(coalesce(p->>'label', '')), ''), v_user)
    on conflict (id) do nothing;
  if exists (select 1 from gold.import_batches where id = v_batch and (kind <> 'history' or undone_at is not null)) then
    perform gold.fail(409, 'BATCH_CLOSED', 'This import was undone or is not a purchases import. Start a new one.');
  end if;

  for r in select * from jsonb_array_elements(p->'rows') loop
    perform gold.in_scope((r->>'branchId')::uuid, p_scope);
    select * into b from gold.branches where id = (r->>'branchId')::uuid and is_active;
    if not found then perform gold.fail(404, 'NOT_FOUND', 'Branch was not found.'); end if;
    if exists (select 1 from gold.transactions where imported_batch = v_batch and import_key = r->>'key') then
      v_skipped := v_skipped + 1;
      v_out := v_out || jsonb_build_object('key', r->>'key', 'status', 'exists');
      continue;
    end if;
    v_at := (r->>'capturedAt')::timestamptz;
    if v_at is null or v_at > now() then perform gold.fail(422, 'VALIDATION_FAILED', 'Row ' || (r->>'key') || ': the date must be in the past.'); end if;
    v_name := trim(coalesce(r#>>'{customer,name}', ''));
    if not gold.has_text(v_name, 1) then perform gold.fail(422, 'VALIDATION_FAILED', 'Row ' || (r->>'key') || ': the customer name is missing.'); end if;
    v_phone := nullif(regexp_replace(coalesce(r#>>'{customer,phone}', ''), '\s', '', 'g'), '');
    if not exists (select 1 from gold.formula_versions where key = r->>'formulaVersion') then
      perform gold.fail(409, 'FORMULA_NOT_CONFIGURED', 'The calculation settings are missing for this company. Run the seed command.');
    end if;
    v_payable := (r->>'payable')::numeric;
    if v_payable is null or v_payable < 0 then perform gold.fail(422, 'VALIDATION_FAILED', 'Row ' || (r->>'key') || ': the amount paid is not valid.'); end if;

    v_customer := gold.ensure_customer(null, v_name, v_phone);
    v_local := (v_at at time zone b.timezone)::date;
    v_n := gold.next_document_number(v_tenant, 'history', b.id, v_local);
    v_ref := b.code || '-H' || to_char(v_local, 'YYYYMMDD') || '-' || lpad(v_n::text, 4, '0');
    v_flags := array['HISTORICAL'] || coalesce(array(select jsonb_array_elements_text(coalesce(r->'flags', '[]'::jsonb))), '{}');
    v_id := gen_random_uuid();

    insert into gold.transactions (id, tenant_id, branch_id, business_day_id, reference, customer_id, customer_name, customer_phone, status, formula_version,
                                   price_as_of, client_amount, calculated_amount, payout_policy, payout_strategy, payable, payout_difference, captured_at,
                                   created_by, flags, imported_batch, import_key, import_ref, import_note)
    values (v_id, v_tenant, b.id, null, v_ref, v_customer, v_name, v_phone, 'saved', r->>'formulaVersion', v_at,
            coalesce((r->>'clientAmount')::numeric, (r->>'calculatedAmount')::numeric), (r->>'calculatedAmount')::numeric, 'down', 'fewest-notes', v_payable,
            v_payable - (r->>'calculatedAmount')::numeric, v_at, v_user, v_flags, v_batch, r->>'key',
            nullif(trim(coalesce(r->>'receiptNo', '')), ''), nullif(trim(coalesce(r->>'note', '')), ''));

    insert into gold.transaction_items (id, tenant_id, transaction_id, line_no, label, top, down, price, density, karat, purity, net_weight, pounds, amount,
                                        location_branch_id, location_state)
    select gen_random_uuid(), v_tenant, v_id, ord::smallint, nullif(trim(coalesce(i->>'label', '')), ''), (i->>'top')::numeric, (i->>'down')::numeric,
           (i->>'price')::numeric, (i->>'density')::numeric, (i->>'karat')::numeric, (i->>'purity')::numeric, (i->>'netWeight')::numeric,
           (i->>'pounds')::numeric, (i->>'amount')::numeric, b.id, 'historical'
    from jsonb_array_elements(r->'items') with ordinality as t(i, ord);

    v_created := v_created + 1;
    v_out := v_out || jsonb_build_object('key', r->>'key', 'status', 'created', 'reference', v_ref);
  end loop;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'rows', v_out);
end $$;

-- p: { rows: [ { name, phone, notes? } ] }. Existing customers (same phone and name) are left alone.
create function gold.import_customers(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant(); v_user uuid := gold.require_actor(); r jsonb; v_id uuid; v_before int; v_created int := 0; v_existing int := 0;
  v_name text; v_phone text;
begin
  if jsonb_typeof(p->'rows') <> 'array' or jsonb_array_length(p->'rows') not between 1 and 1000 then
    perform gold.fail(422, 'VALIDATION_FAILED', 'Send 1 to 1000 rows at a time.');
  end if;
  for r in select * from jsonb_array_elements(p->'rows') loop
    v_name := trim(coalesce(r->>'name', ''));
    v_phone := nullif(regexp_replace(coalesce(r->>'phone', ''), '\s', '', 'g'), '');
    if not gold.has_text(v_name, 1) or v_phone is null then
      perform gold.fail(422, 'VALIDATION_FAILED', 'Every customer needs a name and a phone number.');
    end if;
    select count(*) into v_before from gold.customers;
    v_id := gold.ensure_customer(null, v_name, v_phone);
    if (select count(*) from gold.customers) > v_before then
      v_created := v_created + 1;
      update gold.customers set notes = nullif(trim(coalesce(r->>'notes', '')), '') where id = v_id;
    else v_existing := v_existing + 1; end if;
  end loop;
  return jsonb_build_object('created', v_created, 'existing', v_existing);
end $$;

-- ---------------------------------------------------------------- batches
create function gold.import_batches_json(p_scope uuid[]) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'label', b.label, 'createdAt', gold.iso(b.created_at), 'createdBy', gold.person_json(b.created_by),
      'undone', b.undone_at is not null,
      'purchases', (select count(*) from gold.transactions t where t.imported_batch = b.id and t.status <> 'void'),
      'worth', gold.ts(coalesce((select sum(t.payable) from gold.transactions t where t.imported_batch = b.id and t.status <> 'void'), 0)),
      'from', (select min(t.captured_at)::date from gold.transactions t where t.imported_batch = b.id),
      'to', (select max(t.captured_at)::date from gold.transactions t where t.imported_batch = b.id)) order by b.created_at desc), '[]'::jsonb)
  from gold.import_batches b
  where b.kind = 'history'
    and (not exists (select 1 from gold.transactions t where t.imported_batch = b.id)
         or exists (select 1 from gold.transactions t where t.imported_batch = b.id and t.branch_id = any(coalesce(p_scope, '{}'))))
$$;

-- Voids every purchase of the batch (with the reason), and closes the batch. Nothing is deleted.
create function gold.import_undo(p_batch uuid, p_reason text, p_scope uuid[]) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor(); b gold.import_batches; n int;
begin
  select * into b from gold.import_batches where id = p_batch and kind = 'history' for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That import was not found.'); end if;
  if b.undone_at is not null then perform gold.fail(409, 'ALREADY_UNDONE', 'This import was already undone.'); end if;
  if not gold.has_text(p_reason, 5) then perform gold.fail(422, 'VALIDATION_FAILED', 'Say why (at least 5 characters).'); end if;
  if exists (select 1 from gold.transactions t where t.imported_batch = p_batch and not (t.branch_id = any(coalesce(p_scope, '{}')))) then
    perform gold.fail(403, 'FORBIDDEN', 'This import includes branches you do not work at.');
  end if;
  update gold.transactions set status = 'void', voided_at = now(), voided_by = v_user, void_reason = 'Import undone: ' || trim(p_reason)
   where imported_batch = p_batch and status <> 'void';
  get diagnostics n = row_count;
  update gold.import_batches set undone_at = now(), undone_by = v_user where id = p_batch;
  return jsonb_build_object('voided', n);
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert, update on gold.import_batches to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;