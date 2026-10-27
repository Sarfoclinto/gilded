-- B7a: notifications are written by the database itself when things happen, and each person only sees their own.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid();
  r_role uuid := gen_random_uuid(); sender uuid := gen_random_uuid(); receiver uuid := gen_random_uuid(); boss uuid := gen_random_uuid();
  tx uuid := gen_random_uuid(); items uuid[]; trf uuid := gen_random_uuid(); r jsonb; n int; first_id uuid;
begin
  insert into gold.tenants (id, slug, name) values (t, 'notify', 'Notify Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'staff', 'Staff');
  insert into gold.role_permissions (tenant_id, role_id, permission)
    select t, r_role, p from unnest(array['transfers:read', 'transfers:receive', 'transfers:create', 'discrepancies:review', 'transactions:read']) p;
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values
    (sender, t, 'ama', 'Ama', 'x', r_role), (receiver, t, 'kojo', 'Kojo', 'x', r_role), (boss, t, 'boss', 'Boss', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, sender, tkw), (t, receiver, ksi), (t, boss, tkw);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', sender::text, true);
  perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":50}'::jsonb, 'capturedAt', now()));
  perform gold.post_transaction(jsonb_build_object('id', tx, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kwesi'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000',
    'policy', 'down', 'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  select array_agg(id) into items from gold.transaction_items where transaction_id = tx;
  perform gold.create_transfer(jsonb_build_object('id', trf, 'kind', 'goods', 'originBranchId', tkw, 'destinationBranchId', ksi, 'purpose', 'stock_collection',
    'method', 'staff_travelling', 'itemIds', to_jsonb(items)), array[tkw]);
  perform gold.transfer_edit(trf, jsonb_build_object('collector', jsonb_build_object('type', 'external', 'name', 'Mr Mensah', 'phone', '024', 'idType', 'Ghana card', 'idNumber', 'GHA-1')), array[tkw]);

  -- nothing yet: a draft announces nothing to people
  select count(*) into n from gold.notifications; perform gold_test.assert(n = 0, 'a draft notifies nobody');

  perform gold.release_transfer(trf, '{}'::jsonb, array[tkw]);
  select count(*) into n from gold.notifications where kind = 'transfer_on_the_way' and user_id = receiver;
  perform gold_test.assert(n = 1, 'the receiving branch is told the transfer is on the way');
  select count(*) into n from gold.notifications where user_id in (sender, boss) and kind = 'transfer_on_the_way';
  perform gold_test.assert(n = 0, 'the sending branch is not told about its own release');

  -- the receiver sees only their own inbox
  perform set_config('app.user_id', receiver::text, true);
  r := gold.notifications_json(30, false);
  perform gold_test.assert((r->>'unread')::int = 1 and jsonb_array_length(r->'items') = 1 and r#>>'{items,0,link}' like '/transfers/%', 'inbox: ' || r::text);
  first_id := (r#>>'{items,0,id}')::uuid;
  perform set_config('app.user_id', sender::text, true);
  perform gold_test.assert((gold.notifications_json(30, false)->>'unread')::int = 0, 'someone else''s inbox is separate');
  perform gold.notifications_mark_read(array[first_id]);   -- not theirs: nothing changes for the receiver
  perform set_config('app.user_id', receiver::text, true);
  perform gold_test.assert((gold.notifications_json(30, false)->>'unread')::int = 1, 'cannot mark another person''s notification read');
  r := gold.notifications_mark_read(null);
  perform gold_test.assert((r->>'unread')::int = 0 and (r#>>'{items,0,read}')::boolean, 'mark all read');

  -- a difference notifies the reviewers of that branch (but not the person who caused it)
  perform set_config('app.user_id', sender::text, true);
  insert into gold.discrepancies (tenant_id, branch_id, kind, expected, actual, difference, reported_explanation, opened_by)
  values (t, tkw, 'other', 10, 5, -5, 'short', sender);
  select count(*) into n from gold.notifications where kind = 'difference_opened' and user_id = boss;
  perform gold_test.assert(n = 1, 'the reviewer at that branch is told');
  select count(*) into n from gold.notifications where kind = 'difference_opened' and user_id in (sender, receiver);
  perform gold_test.assert(n = 0, 'not the actor, not another branch');
  raise notice 'ok 013';
end $$;