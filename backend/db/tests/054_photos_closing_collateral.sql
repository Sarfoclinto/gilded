-- B61: pictures on the closing day and on gold held as security; counted, branch-scoped, never required.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid();
  r_t uuid := gen_random_uuid(); ama uuid := gen_random_uuid(); kofi uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); loan uuid := gen_random_uuid(); coll uuid;
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid();
  r jsonb; x text; hash text := repeat('cd', 32);
begin
  insert into gold.tenants (id, slug, name) values (t, 'photos61', 'Photo Gold 61');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name, is_system) values (r_t, t, 'teller', 'Teller', true);
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (ama, t, 'ama', 'Ama', 'x', r_t), (kofi, t, 'kofi', 'Kofi', 'x', r_t);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, ama, tkw), (t, kofi, ksi);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', ama::text, true);
  perform gold.open_day(jsonb_build_object('id', d1, 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":200}'::jsonb, 'capturedAt', now()));

  -- an open day with no picture: zero, nothing blocked
  r := gold.day_json(d1);
  perform gold_test.assert((r#>>'{photos,closing}')::int = 0 and r->>'status' = 'open', 'no closing picture yet: ' || (r->'photos')::text);

  -- a picture for the closing, sent twice, stored once
  r := gold.add_attachment(jsonb_build_object('id', p1, 'entityType', 'day', 'entityId', d1, 'slot', 'closing', 'storageKey', 'k/p1.jpg', 'size', 100, 'sha256', hash, 'stamped', true), array[tkw]);
  perform gold_test.assert(r#>>'{data,slot}' = 'closing' and not (r->>'replayed')::boolean, 'stored: ' || r::text);
  perform gold.add_attachment(jsonb_build_object('id', p1, 'entityType', 'day', 'entityId', d1, 'slot', 'closing', 'storageKey', 'k/p1.jpg', 'size', 100, 'sha256', hash), array[tkw]);
  perform gold_test.assert((gold.day_json(d1)#>>'{photos,closing}')::int = 1 and (select count(*) from gold.attachments where id = p1) = 1, 'the day counts it once');
  perform gold_test.assert((select branch_id from gold.attachments where id = p1) = tkw, 'filed under the day''s branch');

  -- a wrong place, and another branch
  x := gold_test.code_of(format($q$select gold.add_attachment(jsonb_build_object('id', %L, 'entityType', 'day', 'entityId', %L, 'slot', 'release', 'storageKey', 'k', 'size', 1, 'sha256', %L), array[%L::uuid])$q$, p2, d1, hash, tkw));
  perform gold_test.assert(x = 'VALIDATION_FAILED', 'a day has no hand-over slot: ' || x);
  x := gold_test.code_of(format($q$select gold.add_attachment(jsonb_build_object('id', %L, 'entityType', 'day', 'entityId', %L, 'slot', 'closing', 'storageKey', 'k', 'size', 1, 'sha256', %L), array[%L::uuid])$q$, p2, d1, hash, ksi));
  perform gold_test.assert(x = 'NOT_FOUND', 'another branch cannot add to this day: ' || x);
  perform gold_test.assert(gold.attachments_json('day', d1, array[ksi]) = '[]'::jsonb and gold.attachment_file(p1, array[ksi]) is null, 'nor see or fetch it');
  perform gold_test.assert(jsonb_array_length(gold.attachments_json('day', d1, array[tkw])) = 1, 'its own branch lists it');

  -- a loan with gold as security: no picture needed; then pictures can be added to the held gold
  r := gold.issue_loan(jsonb_build_object('id', loan, 'branchId', tkw, 'principal', 1000, 'customer', jsonb_build_object('name', 'Kwesi', 'phone', '0200000009'),
        'lines', '{"100":10}'::jsonb, 'collateral', jsonb_build_object('topWeight', '50.5', 'description', 'lump'), 'capturedAt', now()));
  coll := (r#>>'{data,collateral,id}')::uuid;
  perform gold_test.assert(coll is not null, 'the loan gave back the held gold id: ' || r::text);
  perform gold_test.assert((gold.collateral_json(coll)->>'photos')::int = 0, 'held gold with no picture says zero');
  perform gold.add_attachment(jsonb_build_object('id', p3, 'entityType', 'collateral', 'entityId', coll, 'slot', 'collateral', 'storageKey', 'k/p3.jpg', 'size', 100, 'sha256', hash), array[tkw]);
  perform gold.add_attachment(jsonb_build_object('id', p4, 'entityType', 'collateral', 'entityId', coll, 'slot', 'collateral', 'storageKey', 'k/p4.jpg', 'size', 100, 'sha256', hash), array[tkw]);
  perform gold_test.assert((gold.collateral_json(coll)->>'photos')::int = 2, 'two pictures counted');
  perform gold_test.assert(jsonb_array_length(gold.collateral_list_json(tkw, null)) = 1 and (gold.collateral_list_json(tkw, null)#>>'{0,photos}')::int = 2, 'the list carries the count');
  x := gold_test.code_of(format($q$select gold.add_attachment(jsonb_build_object('id', %L, 'entityType', 'collateral', 'entityId', %L, 'slot', 'collateral', 'storageKey', 'k', 'size', 1, 'sha256', %L), array[%L::uuid])$q$, gen_random_uuid(), coll, hash, ksi));
  perform gold_test.assert(x = 'NOT_FOUND', 'another branch cannot add to held gold: ' || x);
  perform gold.remove_attachment(p3, 'wrong', true, array[tkw]);
  perform gold_test.assert((gold.collateral_json(coll)->>'photos')::int = 1, 'a removed picture is not counted');

  -- the earlier kinds still work
  perform gold.add_attachment(jsonb_build_object('id', gen_random_uuid(), 'entityType', 'user', 'entityId', ama, 'storageKey', 'k/me.jpg', 'size', 10, 'sha256', hash), array[tkw]);
  perform gold_test.assert(gold.profile_picture_id(ama) is not null, 'profile pictures still work');
end $$;