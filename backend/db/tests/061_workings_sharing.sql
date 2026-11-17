-- B68: sharing a Workings sheet read-only with one colleague, and taking it back.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); r_d uuid := gen_random_uuid(); r_t uuid := gen_random_uuid();
  boss uuid := gen_random_uuid(); ama uuid := gen_random_uuid(); kojo uuid := gen_random_uuid(); gone uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); r jsonb; x text;
  doc1 jsonb := '{"notes":[{"id":"a","x":1,"y":2,"text":"Weight 12 g"}]}'; doc2 jsonb := '{"notes":[{"id":"a","x":1,"y":2,"text":"Weight 13 g"}]}';
begin
  insert into gold.tenants (id, slug, name) values (t, 'workings68', 'Workings Gold 68');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', true);
  insert into gold.roles (id, tenant_id, key, name, is_system) values (r_d, t, 'director', 'Director', true), (r_t, t, 'teller', 'Teller', true);
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id, is_active)
    values (boss, t, 'boss', 'Boss', 'x', r_d, true), (ama, t, 'ama', 'Ama', 'x', r_t, true), (kojo, t, 'kojo', 'Kojo', 'x', r_t, true), (gone, t, 'gone', 'Gone', 'x', r_t, false);
  set local role gold_app;
  perform set_config('app.user_id', ama::text, true);
  perform gold.working_save(jsonb_build_object('id', s1, 'name', 'Kwame', 'doc', doc1));

  x := gold_test.code_of(format('select gold.working_share(%L, %L)', s1, ama));
  perform gold_test.assert(x = 'VALIDATION_FAILED', 'not with oneself: ' || coalesce(x, 'no error'));
  x := gold_test.code_of(format('select gold.working_share(%L, %L)', s1, gone));
  perform gold_test.assert(x = 'NOT_FOUND', 'not with someone switched off: ' || coalesce(x, 'no error'));
  perform gold_test.assert((gold.working_share(s1, kojo)->>'shared')::boolean, 'shared');
  perform gold_test.assert(not (gold.working_share(s1, kojo)->>'shared')::boolean, 'sharing again changes nothing');
  perform gold_test.assert(gold.workings_list('{}')#>>'{items,0,sharedWith,0,displayName}' = 'Kojo', 'the owner sees who it is shared with');
  perform gold_test.assert((gold.working_get(s1)->>'mine')::boolean, 'the owner may change it');
  perform gold_test.assert((select count(*) from gold.notifications where user_id = kojo and kind = 'working_shared') = 1, 'one notification');
  perform gold_test.assert((select count(*) from gold.audit_events where action = 'working.shared') = 1
    and not exists (select 1 from gold.audit_events where action like 'working.%' and coalesce(after::text, '') like '%Weight%'), 'logged without the contents');

  -- the colleague: read only, the owner's latest version
  perform set_config('app.user_id', kojo::text, true);
  r := gold.workings_shared_list();
  perform gold_test.assert(jsonb_array_length(r->'items') = 1 and r#>>'{items,0,sharedBy,displayName}' = 'Ama', 'listed as shared by Ama');
  r := gold.working_get(s1);
  perform gold_test.assert(r->'doc' = doc1 and not (r->>'mine')::boolean and r#>>'{owner,displayName}' = 'Ama', 'opened read-only: ' || r::text);
  perform gold_test.assert((gold.workings_list('{}')->>'sharedCount')::int = 1 and jsonb_array_length(gold.workings_list('{}')->'items') = 0, 'not in their own sheets, counted on the tab');
  x := gold_test.code_of(format($q$select gold.working_save(jsonb_build_object('id', %L, 'name', 'mine', 'doc', '{"notes":[]}'::jsonb, 'baseVersion', 1))$q$, s1));
  perform gold_test.assert(x = 'ID_IN_USE', 'they cannot save over it: ' || coalesce(x, 'no error'));
  x := gold_test.code_of(format('select gold.working_rename(%L, ''mine'')', s1));
  perform gold_test.assert(x = 'NOT_FOUND', 'they cannot rename it: ' || coalesce(x, 'no error'));
  perform gold_test.assert((gold.workings_delete(array[s1])->>'deleted')::int = 0, 'they cannot delete it');
  x := gold_test.code_of(format('select gold.working_share(%L, %L)', s1, boss));
  perform gold_test.assert(x = 'NOT_FOUND', 'they cannot share it on: ' || coalesce(x, 'no error'));

  -- the owner changes it: the colleague sees the new version
  perform set_config('app.user_id', ama::text, true);
  perform gold.working_save(jsonb_build_object('id', s1, 'name', 'Kwame', 'doc', doc2, 'baseVersion', 1));
  perform set_config('app.user_id', kojo::text, true);
  perform gold_test.assert(gold.working_get(s1)->'doc' = doc2, 'the colleague sees the latest version');

  -- the director sees nothing
  perform set_config('app.user_id', boss::text, true);
  perform gold_test.assert(gold.working_get(s1) is null and (select count(*) from gold.workings) = 0 and (select count(*) from gold.working_shares) = 0
    and jsonb_array_length(gold.workings_shared_list()->'items') = 0, 'a director sees nothing');

  -- hide, stop, share again, delete
  perform set_config('app.user_id', kojo::text, true);
  perform gold_test.assert((gold.working_shared_hide(s1)->>'hidden')::int = 1, 'hidden from their list');
  perform gold_test.assert(jsonb_array_length(gold.workings_shared_list()->'items') = 0, 'and gone from it');
  perform gold_test.assert(gold.working_get(s1) is not null, 'but still openable while shared');
  perform set_config('app.user_id', ama::text, true);
  perform gold_test.assert((gold.working_unshare(s1, null)->>'stopped')::int = 1, 'stopped');
  perform set_config('app.user_id', kojo::text, true);
  perform gold_test.assert(gold.working_get(s1) is null, 'access ended at once');
  perform set_config('app.user_id', ama::text, true);
  perform gold_test.assert((gold.working_share(s1, kojo)->>'shared')::boolean, 'shared again after stopping');
  perform gold.workings_delete(array[s1]);
  perform set_config('app.user_id', kojo::text, true);
  perform gold_test.assert(gold.working_get(s1) is null, 'deleting ends the share');
  reset role;
  perform gold_test.assert((select count(*) from gold.working_shares) = 0, 'no share rows left');
  raise notice 'workings sharing ok';
end $$;