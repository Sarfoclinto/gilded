-- B63: camera-only setting, the same picture used twice, and the list of missing pictures.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); r_d uuid := gen_random_uuid(); r_t uuid := gen_random_uuid();
  boss uuid := gen_random_uuid(); ama uuid := gen_random_uuid(); d1 uuid := gen_random_uuid(); cust uuid := gen_random_uuid();
  tx1 uuid := gen_random_uuid(); tx2 uuid := gen_random_uuid(); p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
  r jsonb; x text; hash text := repeat('ab', 32); orig text := repeat('12', 32);
begin
  insert into gold.tenants (id, slug, name) values (t, 'photos63', 'Photo Gold 63');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', true);
  insert into gold.roles (id, tenant_id, key, name, is_system) values (r_d, t, 'director', 'Director', true), (r_t, t, 'teller', 'Teller', true);
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_d, 'attachments:library'), (t, r_d, 'settings:manage');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (boss, t, 'boss', 'Boss', 'x', r_d), (ama, t, 'ama', 'Ama', 'x', r_t);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, boss, tkw), (t, ama, tkw);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  insert into gold.transactions (id, tenant_id, branch_id, reference, customer_name, formula_version, price_as_of, client_amount, calculated_amount,
                                 payout_policy, payout_strategy, payable, payout_difference, captured_at, created_by)
  values (tx1, t, tkw, 'TKW-1', 'A', 'ExcelV1', now(), 1, 1, 'down', 'fewest-notes', 1, 0, now(), ama),
         (tx2, t, tkw, 'TKW-2', 'B', 'ExcelV1', now(), 1, 1, 'down', 'fewest-notes', 1, 0, now(), ama);
  insert into gold.business_days (id, tenant_id, branch_id, business_date, status, closed_at, closed_by, opened_by)
    select d1, t, tkw, current_date - 1, 'closed', now() - interval '1 hour', ama, ama where false;
  set local role gold_app;
  perform set_config('app.user_id', ama::text, true);

  -- the same picture on two purchases: the second is marked, the first is not, and reviewers are told
  r := gold.add_attachment(jsonb_build_object('id', p1, 'entityType', 'transaction', 'entityId', tx1, 'slot', 'goods', 'storageKey', 'k/1', 'size', 1, 'sha256', hash, 'originalSha', orig, 'source', 'library'), array[tkw]);
  perform gold_test.assert((r#>>'{data,reused}')::boolean = false, 'the first use is not marked: ' || r::text);
  r := gold.add_attachment(jsonb_build_object('id', p2, 'entityType', 'transaction', 'entityId', tx2, 'slot', 'goods', 'storageKey', 'k/2', 'size', 1, 'sha256', hash, 'originalSha', orig, 'source', 'library'), array[tkw]);
  perform gold_test.assert((r#>>'{data,reused}')::boolean = true, 'the second use is marked');
  perform gold_test.assert((gold.attachments_json('transaction', tx1, array[tkw], false)#>>'{0,reused}')::boolean = false, 'the first stays unmarked');
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'photo_reused' and user_id = boss) = 1, 'the reviewer was notified');
  r := gold.add_attachment(jsonb_build_object('id', p2, 'entityType', 'transaction', 'entityId', tx2, 'slot', 'goods', 'storageKey', 'k/2', 'size', 1, 'sha256', hash, 'originalSha', orig), array[tkw]);
  perform gold_test.assert((r->>'replayed')::boolean and (select count(*) from gold.notifications where kind = 'photo_reused') = 1, 'sending it again does not notify again');

  -- camera only
  perform set_config('app.user_id', boss::text, true);
  perform gold.set_settings('{"photos.cameraOnly":true}'::jsonb);
  perform set_config('app.user_id', ama::text, true);
  x := gold_test.code_of(format($q$select gold.add_attachment(jsonb_build_object('id', %L, 'entityType', 'transaction', 'entityId', %L, 'slot', 'goods', 'storageKey', 'k', 'size', 1, 'sha256', %L, 'source', 'library'), array[%L::uuid])$q$, p3, tx1, hash, tkw));
  perform gold_test.assert(x = 'CAMERA_ONLY', 'library pictures are refused when camera only is on: ' || x);
  perform gold.add_attachment(jsonb_build_object('id', p3, 'entityType', 'transaction', 'entityId', tx1, 'slot', 'goods', 'storageKey', 'k/3', 'size', 1, 'sha256', hash, 'source', 'camera'), array[tkw]);
  perform gold_test.assert(true, 'camera pictures are fine');

  -- gaps: a held loan's gold with no picture
  perform gold_test.assert(jsonb_typeof(gold.photo_gaps('{}'::jsonb, array[tkw])) = 'array', 'gaps is a list');
  raise notice 'photo evidence ok';
end $$;