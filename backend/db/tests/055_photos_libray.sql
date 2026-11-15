-- B62: pictures on purchases and customers, customer IDs behind a permission and logged, and the library.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid(); r_t uuid := gen_random_uuid();
  ama uuid := gen_random_uuid(); kofi uuid := gen_random_uuid(); cust uuid := gen_random_uuid(); tx uuid := gen_random_uuid(); tx2 uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid();
  r jsonb; x text; hash text := repeat('ef', 32);
begin
  insert into gold.tenants (id, slug, name) values (t, 'photos62', 'Photo Gold 62');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name, is_system) values (r_t, t, 'teller', 'Teller', true);
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (ama, t, 'ama', 'Ama', 'x', r_t), (kofi, t, 'kofi', 'Kofi', 'x', r_t);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, ama, tkw), (t, kofi, ksi);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  insert into gold.customers (id, tenant_id, name, phone) values (cust, t, 'Yaw Mensah', '0244000001');
  insert into gold.transactions (id, tenant_id, branch_id, reference, customer_id, customer_name, formula_version, price_as_of, client_amount, calculated_amount,
                                 payout_policy, payout_strategy, payable, payout_difference, captured_at, created_by)
  values (tx, t, tkw, 'TKW-20261115-0001', cust, 'Yaw Mensah', 'ExcelV1', now(), 100, 100, 'down', 'fewest-notes', 100, 0, now(), ama),
         (tx2, t, ksi, 'KSI-20261115-0001', null, 'Abena', 'ExcelV1', now(), 50, 50, 'down', 'fewest-notes', 50, 0, now(), kofi);
  set local role gold_app;
  perform set_config('app.user_id', ama::text, true);

  -- a picture of the gold on a purchase: only the branch of the purchase
  perform gold.add_attachment(jsonb_build_object('id', p1, 'entityType', 'transaction', 'entityId', tx, 'slot', 'goods', 'storageKey', 'k/p1.jpg', 'size', 10, 'sha256', hash), array[tkw]);
  x := gold_test.code_of(format($q$select gold.add_attachment(jsonb_build_object('id', %L, 'entityType', 'transaction', 'entityId', %L, 'slot', 'goods', 'storageKey', 'k', 'size', 1, 'sha256', %L), array[%L::uuid])$q$, p2, tx2, hash, tkw));
  perform gold_test.assert(x = 'NOT_FOUND', 'another branch''s purchase: ' || x);
  x := gold_test.code_of(format($q$select gold.add_attachment(jsonb_build_object('id', %L, 'entityType', 'transaction', 'entityId', %L, 'slot', 'id', 'storageKey', 'k', 'size', 1, 'sha256', %L), array[%L::uuid])$q$, p2, tx, hash, tkw));
  perform gold_test.assert(x = 'VALIDATION_FAILED', 'no ID slot on a purchase: ' || x);

  -- a customer ID: anyone who sells may add it, only holders of the permission see it
  perform gold.add_attachment(jsonb_build_object('id', p3, 'entityType', 'customer', 'entityId', cust, 'slot', 'id', 'storageKey', 'k/p3.jpg', 'size', 10, 'sha256', hash), array[tkw]);
  x := gold_test.code_of(format($q$select gold.add_attachment(jsonb_build_object('id', %L, 'entityType', 'customer', 'entityId', %L, 'slot', 'id', 'storageKey', 'k', 'size', 1, 'sha256', %L), array[%L::uuid])$q$, p4, gen_random_uuid(), hash, tkw));
  perform gold_test.assert(x = 'NOT_FOUND', 'an unknown customer: ' || x);
  perform gold_test.assert(gold.attachments_json('customer', cust, array[tkw], false) = '[]'::jsonb, 'without the permission the ID list is empty');
  perform gold_test.assert(gold.attachment_open(p3, array[tkw], false) is null, 'nor can it be opened');
  perform gold_test.assert(jsonb_array_length(gold.attachments_json('customer', cust, array[tkw], true)) = 1, 'with it, the ID is listed');
  perform gold_test.assert(gold.attachment_open(p3, array[tkw], true) is not null, 'and opens');
  perform gold.attachment_open(p3, array[tkw], true);
  perform gold_test.assert((select count(*) from gold.audit_events where action = 'attachment.id_viewed' and entity_id = p3::text) = 1, 'opened twice in a row, logged once');

  -- the library
  r := gold.photo_library('{}'::jsonb, array[tkw], false);
  perform gold_test.assert((r->>'total')::int = 1 and r#>>'{items,0,label}' = 'TKW-20261115-0001 · Yaw Mensah', 'without the ID permission the library has the purchase picture only: ' || r::text);
  r := gold.photo_library('{}'::jsonb, array[tkw], true);
  perform gold_test.assert((r->>'total')::int = 2, 'with it, the ID shows too');
  r := gold.photo_library('{"type":"customer"}'::jsonb, array[tkw], true);
  perform gold_test.assert((r->>'total')::int = 1 and r#>>'{items,0,label}' = 'Yaw Mensah', 'filter by kind');
  r := gold.photo_library('{"q":"mensah"}'::jsonb, array[tkw], true);
  perform gold_test.assert((r->>'total')::int = 2, 'search by name');
  r := gold.photo_library('{"q":"zzz"}'::jsonb, array[tkw], true);
  perform gold_test.assert((r->>'total')::int = 0, 'search finds nothing');
  r := gold.photo_library('{"from":"2999-01-01"}'::jsonb, array[tkw], true);
  perform gold_test.assert((r->>'total')::int = 0, 'date filter');
  r := gold.photo_library('{}'::jsonb, array[ksi], true);
  perform gold_test.assert((r->>'total')::int = 1 and r#>>'{items,0,label}' = 'Yaw Mensah', 'another branch sees none of the purchase pictures, only the ID');
  perform gold.remove_attachment(p1, 'wrong picture', true, array[tkw]);
  r := gold.photo_library('{}'::jsonb, array[tkw], false);
  perform gold_test.assert((r->>'total')::int = 0, 'a removed picture leaves the library');
  r := gold.photo_library('{"size":1,"page":1}'::jsonb, array[tkw], true);
  perform gold_test.assert((r->>'total')::int = 1 and jsonb_array_length(r->'items') = 1, 'paging');
end $$;