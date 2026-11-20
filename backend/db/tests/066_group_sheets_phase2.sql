-- B75: Group Sheets phase 2. Savings per person (with a statement), money and quantity (mercury), receipt photos seen only by the
-- sheet's readers, and alerts on money taken out.
do $$
declare
  t uuid := gen_random_uuid(); ba uuid := gen_random_uuid(); r_mgr uuid := gen_random_uuid(); r_tel uuid := gen_random_uuid(); r_dir uuid := gen_random_uuid();
  mgr uuid := gen_random_uuid(); t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); dir uuid := gen_random_uuid();
  g uuid := gen_random_uuid(); sv uuid := gen_random_uuid(); hg uuid := gen_random_uuid(); ama uuid := gen_random_uuid(); kofi uuid := gen_random_uuid();
  e1 uuid := gen_random_uuid(); ph uuid := gen_random_uuid(); r jsonb;
begin
  insert into gold.tenants (id, slug, name) values (t, 'gsheets2', 'Group sheets 2');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (ba, t, 'ANY', 'Anyanso', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_mgr, t, 'manager', 'Manager'), (r_tel, t, 'teller', 'Teller'), (r_dir, t, 'director', 'Director');
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_mgr, 'groups:create'), (t, r_dir, 'users:manage'), (t, r_dir, 'branches:all');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values
    (mgr, t, 'mgr', 'Manager Mo', 'x', r_mgr), (t1, t, 't1', 'Ama', 'x', r_tel), (t2, t, 't2', 'Kofi', 'x', r_tel), (dir, t, 'dir', 'Director Dee', 'x', r_dir);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, mgr, ba), (t, t1, ba), (t, t2, ba), (t, dir, ba);
  set local role gold_app;
  perform set_config('app.user_id', mgr::text, true);
  perform gold.group_sheets('group_create', jsonb_build_object('id', g, 'name', 'Staff'));
  perform gold.group_sheets('member_set', jsonb_build_object('groupId', g, 'userId', t1, 'role', 'writer'));
  perform gold.group_sheets('member_set', jsonb_build_object('groupId', g, 'userId', t2, 'role', 'writer'));

  -- 1. savings per person
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('sheet_create', '{"groupId":"%s","name":"S","kind":"people","openingBalance":"10"}')$q$, g)) = 'VALIDATION_FAILED', 'a savings sheet starts at zero');
  r := gold.group_sheets('sheet_create', jsonb_build_object('groupId', g, 'id', sv, 'name', 'Welfare savings', 'kind', 'people'));
  perform gold_test.assert(r->>'kind' = 'people' and jsonb_array_length(r->'people') = 0, 'a savings sheet: ' || r::text);
  perform gold.group_sheets('person_add', jsonb_build_object('sheetId', sv, 'id', ama, 'userId', t1));
  perform gold.group_sheets('person_add', jsonb_build_object('sheetId', sv, 'id', kofi, 'name', 'Kofi Boateng'));
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('person_add', '{"sheetId":"%s","name":"kofi boateng"}')$q$, sv)) = 'NAME_IN_USE', 'names are unique on a sheet');
  perform set_config('app.user_id', t1::text, true);
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('person_add', '{"sheetId":"%s","name":"Me"}')$q$, sv)) = 'FORBIDDEN', 'only keepers add people');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('entry_add', '{"id":"%s","sheetId":"%s","direction":"in","amount":"50"}')$q$, gen_random_uuid(), sv)) = 'VALIDATION_FAILED', 'whose savings must be said');
  perform gold.group_sheets('entry_add', jsonb_build_object('id', e1, 'sheetId', sv, 'personId', ama, 'direction', 'in', 'amount', '400', 'moneyDate', current_date - 10));
  perform gold.group_sheets('entry_add', jsonb_build_object('id', gen_random_uuid(), 'sheetId', sv, 'personId', kofi, 'direction', 'in', 'amount', '250'));
  perform gold.group_sheets('entry_add', jsonb_build_object('id', gen_random_uuid(), 'sheetId', sv, 'personId', ama, 'direction', 'out', 'amount', '100'));
  r := gold.group_sheets('sheet_get', jsonb_build_object('sheetId', sv));
  perform gold_test.assert((r->>'balance')::numeric = 550 and (select (x->>'balance')::numeric from jsonb_array_elements(r->'people') x where x->>'name' = 'Ama') = 300
    and (select (x->>'balance')::numeric from jsonb_array_elements(r->'people') x where x->>'name' = 'Kofi Boateng') = 250, 'each person''s balance and the total: ' || (r->'people')::text);
  r := gold.group_sheets('sheet_get', jsonb_build_object('sheetId', sv, 'personId', ama, 'from', current_date - 3));
  perform gold_test.assert((r->>'balanceBefore')::numeric = 400 and (r#>>'{days,0,closing}')::numeric = 300 and jsonb_array_length(r#>'{days,0,entries}') = 1, 'Ama''s statement: brought forward 400, closes at 300: ' || r::text);

  -- 2. money and quantity (mercury)
  perform set_config('app.user_id', mgr::text, true);
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('sheet_create', '{"groupId":"%s","name":"M","kind":"quantity"}')$q$, g)) = 'VALIDATION_FAILED', 'a quantity sheet needs a unit');
  r := gold.group_sheets('sheet_create', jsonb_build_object('groupId', g, 'id', hg, 'name', 'Mercury', 'kind', 'quantity', 'unit', 'kg', 'openingQuantity', '2'));
  perform gold_test.assert(r->>'unit' = 'kg' and (r->>'stock')::numeric = 2, 'opening stock 2 kg: ' || r::text);
  perform set_config('app.user_id', t1::text, true);
  perform gold.group_sheets('entry_add', jsonb_build_object('id', gen_random_uuid(), 'sheetId', hg, 'direction', 'in', 'amount', '1800', 'quantity', '0.5', 'qtyDirection', 'out', 'note', 'Sold 0.5 kg'));
  perform gold.group_sheets('entry_add', jsonb_build_object('id', gen_random_uuid(), 'sheetId', hg, 'quantity', '1.25', 'qtyDirection', 'in', 'note', 'From Kumasi'));
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('entry_add', '{"id":"%s","sheetId":"%s"}')$q$, gen_random_uuid(), hg)) = 'VALIDATION_FAILED', 'an amount or a quantity is needed');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('entry_add', '{"id":"%s","sheetId":"%s","quantity":"1","qtyDirection":"in"}')$q$, gen_random_uuid(), sv)) = 'VALIDATION_FAILED', 'only quantity sheets keep a quantity');
  r := gold.group_sheets('sheet_get', jsonb_build_object('sheetId', hg));
  perform gold_test.assert((r->>'stock')::numeric = 2.75 and (r->>'balance')::numeric = 1800 and (r#>>'{days,0,qtyIn}')::numeric = 1.25 and (r#>>'{days,0,qtyOut}')::numeric = 0.5
    and (r#>>'{days,0,stock}')::numeric = 2.75, 'stock 2 - 0.5 + 1.25, cash 1800: ' || r::text);
  -- taking back reverses the quantity too
  perform gold.group_sheets('entry_take_back', jsonb_build_object('entryId', (select (e->>'id') from jsonb_array_elements(r#>'{days,0,entries}') e where e->>'note' = 'From Kumasi')));
  perform gold_test.assert((gold.group_sheets('sheet_get', jsonb_build_object('sheetId', hg))->>'stock')::numeric = 1.5, 'taken back: stock 1.5');

  -- 3. receipt photos: seen only by those who may see the sheet
  perform gold.group_sheets('photo_add', jsonb_build_object('id', ph, 'entryId', e1, 'storageKey', 'k/1.jpg', 'thumbKey', 'k/1.t.jpg', 'size', 1000, 'sha256', 'ab'));
  perform gold.group_sheets('photo_add', jsonb_build_object('id', ph, 'entryId', e1, 'storageKey', 'k/1.jpg', 'size', 1000, 'sha256', 'ab'));
  perform gold_test.assert((select count(*) from gold.gs_photos) = 1, 'sent twice, kept once');
  r := gold.group_sheets('sheet_get', jsonb_build_object('sheetId', sv, 'from', current_date - 30));
  perform gold_test.assert((select count(*) from jsonb_array_elements(r->'days') d, jsonb_array_elements(d->'entries') e, jsonb_array_elements(e->'photos') x) = 1, 'the entry shows its photo');
  perform gold_test.assert(gold.group_sheets('photo_open', jsonb_build_object('photoId', ph))->>'storageKey' = 'k/1.jpg', 'Ama can open it');
  perform set_config('app.user_id', dir::text, true);
  perform gold_test.assert(gold.group_sheets('photo_open', jsonb_build_object('photoId', ph)) is null and (select count(*) from gold.gs_photos) = 0, 'the director cannot');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('photo_add', '{"id":"%s","entryId":"%s","storageKey":"x","size":1,"sha256":"x"}')$q$, gen_random_uuid(), e1)) = 'NOT_FOUND', 'or add one');
  perform set_config('app.user_id', t2::text, true);
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('photo_remove', '{"photoId":"%s"}')$q$, ph)) = 'FORBIDDEN', 'another writer cannot take it off');
  perform set_config('app.user_id', mgr::text, true);
  perform gold.group_sheets('access_set', jsonb_build_object('sheetId', sv, 'userId', t2, 'access', 'none'));
  perform set_config('app.user_id', t2::text, true);
  perform gold_test.assert(gold.group_sheets('photo_open', jsonb_build_object('photoId', ph)) is null, 'hidden sheet, hidden photo');
  perform set_config('app.user_id', mgr::text, true);
  perform gold.group_sheets('photo_remove', jsonb_build_object('photoId', ph));
  perform gold_test.assert(gold.group_sheets('photo_open', jsonb_build_object('photoId', ph)) is null and exists (select 1 from gold.gs_events where kind = 'photo_removed'), 'a keeper took it off; the log says so');

  -- 4. alerts on money taken out
  perform set_config('app.user_id', mgr::text, true);
  perform gold.group_sheets('alert_set', jsonb_build_object('sheetId', hg, 'on', true, 'minAmount', '100'));
  perform set_config('app.user_id', t2::text, true);
  perform gold.group_sheets('alert_set', jsonb_build_object('sheetId', hg, 'on', true));
  perform set_config('app.user_id', t1::text, true);
  perform gold.group_sheets('entry_add', jsonb_build_object('id', gen_random_uuid(), 'sheetId', hg, 'direction', 'out', 'amount', '60', 'note', 'Transport'));
  perform gold.group_sheets('entry_add', jsonb_build_object('id', gen_random_uuid(), 'sheetId', hg, 'direction', 'out', 'amount', '500', 'note', 'Bought scale'));
  reset role;
  perform gold_test.assert((select count(*) from gold.notifications where user_id = mgr and kind = 'group_taken_out') = 1, 'Mo, from 100 up, was told once');
  perform gold_test.assert((select count(*) from gold.notifications where user_id = t2 and kind = 'group_taken_out') = 2, 'Kofi, any amount, was told twice');
  perform gold_test.assert((select count(*) from gold.notifications where user_id = t1 and kind = 'group_taken_out') = 0, 'the writer is never told');
  perform gold_test.assert((select title from gold.notifications where user_id = mgr and kind = 'group_taken_out') = 'Ama took GHS 500.00 out of Mercury', 'the message reads well');
  set local role gold_app;
  perform set_config('app.user_id', mgr::text, true);
  perform gold.group_sheets('access_set', jsonb_build_object('sheetId', hg, 'userId', t2, 'access', 'none'));
  perform set_config('app.user_id', t1::text, true);
  perform gold.group_sheets('entry_add', jsonb_build_object('id', gen_random_uuid(), 'sheetId', hg, 'direction', 'out', 'amount', '700'));
  reset role;
  perform gold_test.assert((select count(*) from gold.notifications where user_id = t2 and kind = 'group_taken_out') = 2, 'no alert once the sheet is hidden from Kofi');
  raise notice 'group sheets phase 2 ok';
end $$;