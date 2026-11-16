-- B66: sharing a personal picture with one colleague, and taking it back.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); r_d uuid := gen_random_uuid(); r_t uuid := gen_random_uuid();
  boss uuid := gen_random_uuid(); ama uuid := gen_random_uuid(); kojo uuid := gen_random_uuid(); gone uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
  r jsonb; x text;
begin
  insert into gold.tenants (id, slug, name) values (t, 'personal65', 'Personal Gold 65');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', true);
  insert into gold.roles (id, tenant_id, key, name, is_system) values (r_d, t, 'director', 'Director', true), (r_t, t, 'teller', 'Teller', true);
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_d, 'attachments:library'), (t, r_d, 'audit:read');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id, is_active)
    values (boss, t, 'boss', 'Boss', 'x', r_d, true), (ama, t, 'ama', 'Ama', 'x', r_t, true), (kojo, t, 'kojo', 'Kojo', 'x', r_t, true), (gone, t, 'gone', 'Gone', 'x', r_t, false);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, boss, tkw), (t, ama, tkw), (t, kojo, tkw);
  set local role gold_app;
  perform set_config('app.user_id', ama::text, true);
  perform gold.personal_add(jsonb_build_object('id', p1, 'size', 1000, 'sha256', repeat('ab', 32), 'storageKey', 'k/1', 'thumbKey', 'k/1t'));
  perform gold.personal_add(jsonb_build_object('id', p2, 'size', 1000, 'sha256', repeat('ab', 32), 'storageKey', 'k/2'));
  perform gold.personal_set_caption(p1, 'price board');

  perform gold_test.assert(jsonb_array_length(gold.personal_colleagues()) = 2, 'colleagues are the other active people');
  perform gold_test.assert(not exists (select 1 from jsonb_array_elements(gold.personal_colleagues()) e where e->>'id' = ama::text or e->>'id' = gone::text), 'not oneself, not someone switched off');

  -- sharing
  x := gold_test.code_of(format('select gold.personal_share(array[%L::uuid], %L)', p1, ama));
  perform gold_test.assert(x = 'VALIDATION_FAILED', 'not with oneself: ' || coalesce(x, 'no error'));
  x := gold_test.code_of(format('select gold.personal_share(array[%L::uuid], %L)', p1, gone));
  perform gold_test.assert(x = 'NOT_FOUND', 'not with someone switched off: ' || coalesce(x, 'no error'));
  r := gold.personal_share(array[p1, p2], kojo);
  perform gold_test.assert((r->>'shared')::int = 2, 'two pictures shared');
  r := gold.personal_share(array[p1], kojo);
  perform gold_test.assert((r->>'shared')::int = 0 and (r->>'already')::int = 1, 'sharing again changes nothing');
  perform gold_test.assert(jsonb_array_length(gold.personal_list('{}')#>'{items,0,sharedWith}') = 1 and gold.personal_list('{}')#>>'{items,0,sharedWith,0,displayName}' = 'Kojo', 'the owner sees who it is shared with');
  perform gold_test.assert((select count(*) from gold.notifications where user_id = kojo and kind = 'personal_shared') = 1, 'one notification for the whole share');
  perform gold_test.assert((select count(*) from gold.audit_events where action = 'personal.shared') = 1 and
    not exists (select 1 from gold.audit_events where action like 'personal.%' and (before::text like '%' || p1::text || '%' or after::text like '%' || p1::text || '%')), 'the share is logged without the pictures');

  -- the colleague
  perform set_config('app.user_id', kojo::text, true);
  r := gold.personal_shared_list('{}');
  perform gold_test.assert((r->>'total')::int = 2 and r#>>'{items,0,sharedBy,displayName}' = 'Ama', 'the colleague sees both, from Ama');
  perform gold_test.assert(gold.personal_open(p1) is not null, 'the colleague can open it');
  perform gold_test.assert(jsonb_array_length(gold.personal_list('{}')->'items') = 0 and (gold.personal_list('{}')->>'total')::int = 0, 'it is not in their own pictures');
  perform gold_test.assert((gold.personal_usage()->>'count')::int = 0, 'it does not use their space');
  x := gold_test.code_of(format('select gold.personal_set_caption(%L, ''mine'')', p1));
  perform gold_test.assert(x = 'NOT_FOUND', 'they cannot change it: ' || coalesce(x, 'no error'));
  perform gold_test.assert(jsonb_array_length(gold.personal_delete(array[p1])) = 0, 'they cannot delete it');
  x := gold_test.code_of(format('select gold.personal_share(array[%L::uuid], %L)', p1, boss));
  perform gold_test.assert(x = 'NOT_FOUND', 'they cannot share it on: ' || coalesce(x, 'no error'));
  perform gold_test.assert((select count(*) from gold.personal_pictures where id = p1) = 1, 'they can read the row they were given');
  r := gold.personal_shared_hide(array[p2]);
  perform gold_test.assert(r->>'hidden' = '1', 'they can hide one from their list');
  perform gold_test.assert((gold.personal_shared_list('{}')->>'total')::int = 1, 'and it is gone from the list');

  -- the director sees nothing
  perform set_config('app.user_id', boss::text, true);
  perform gold_test.assert(gold.personal_open(p1) is null and (gold.personal_shared_list('{}')->>'total')::int = 0 and (select count(*) from gold.personal_pictures) = 0 and (select count(*) from gold.personal_picture_shares) = 0, 'a director sees nothing');

  -- stopping
  perform set_config('app.user_id', ama::text, true);
  r := gold.personal_unshare(array[p1], kojo);
  perform gold_test.assert((r->>'stopped')::int = 1, 'stopped for one picture');
  perform gold_test.assert((select count(*) from gold.audit_events where action = 'personal.unshared') = 1, 'stopping is logged');
  perform set_config('app.user_id', kojo::text, true);
  perform gold_test.assert(gold.personal_open(p1) is null and (select count(*) from gold.personal_pictures where id = p1) = 0, 'access ended at once');
  perform gold_test.assert(gold.personal_open(p2) is not null, 'the other one is still shared');

  -- sharing again after stopping, then deleting ends every share
  perform set_config('app.user_id', ama::text, true);
  r := gold.personal_share(array[p1], kojo);
  perform gold_test.assert((r->>'shared')::int = 1, 'a stopped share can be started again');
  perform gold.personal_delete(array[p1, p2]);
  perform set_config('app.user_id', kojo::text, true);
  perform gold_test.assert((gold.personal_shared_list('{}')->>'total')::int = 0 and gold.personal_open(p2) is null, 'deleting ends the shares');
  reset role;
  perform gold_test.assert((select count(*) from gold.personal_picture_shares) = 0, 'no share rows left');
  raise notice 'personal sharing ok';
end $$;