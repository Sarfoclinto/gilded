-- B67: Workings are private to their owner, saved with a version, kept both ways on a clash, limited, and deleted for real.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); r_d uuid := gen_random_uuid(); r_t uuid := gen_random_uuid();
  boss uuid := gen_random_uuid(); ama uuid := gen_random_uuid(); kojo uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid();
  r jsonb; x text; doc1 jsonb := '{"notes":[{"id":"a","x":1,"y":2,"text":"Weight 12 g"}]}'; doc2 jsonb := '{"notes":[{"id":"a","x":1,"y":2,"text":"Weight 13 g"},{"id":"b","x":5,"y":5,"text":"= Weight * 2"}]}';
begin
  insert into gold.tenants (id, slug, name) values (t, 'workings67', 'Workings Gold 67');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', true);
  insert into gold.roles (id, tenant_id, key, name, is_system) values (r_d, t, 'director', 'Director', true), (r_t, t, 'teller', 'Teller', true);
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_d, 'settings:manage'), (t, r_d, 'audit:read');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (boss, t, 'boss', 'Boss', 'x', r_d), (ama, t, 'ama', 'Ama', 'x', r_t), (kojo, t, 'kojo', 'Kojo', 'x', r_t);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, boss, tkw), (t, ama, tkw), (t, kojo, tkw);
  set local role gold_app;
  perform set_config('app.user_id', ama::text, true);

  -- making and saving
  r := gold.working_save(jsonb_build_object('id', s1, 'name', '  Kwame, 3 chains ', 'doc', doc1));
  perform gold_test.assert(r#>>'{data,name}' = 'Kwame, 3 chains' and (r#>>'{data,version}')::int = 1 and (r#>>'{data,notes}')::int = 1 and r->'copy' = 'null'::jsonb, 'saved: ' || r::text);
  r := gold.working_save(jsonb_build_object('id', s1, 'name', 'Kwame, 3 chains', 'doc', doc2, 'baseVersion', 1));
  perform gold_test.assert((r#>>'{data,version}')::int = 2 and (r#>>'{data,notes}')::int = 2, 'a change bumps the version: ' || r::text);
  r := gold.working_save(jsonb_build_object('id', s1, 'name', 'Kwame, 3 chains', 'doc', doc2, 'baseVersion', 2));
  perform gold_test.assert((r#>>'{data,version}')::int = 2, 'saving the same thing again changes nothing');
  perform gold_test.assert(gold.working_get(s1)->'doc' = doc2 and jsonb_array_length(gold.workings_list('{}')->'items') = 1, 'it can be opened and listed');
  perform gold_test.assert(gold.workings_list('{}')#>'{items,0}' ? 'doc' = false, 'the list does not carry the contents');
  perform gold_test.assert((gold.workings_list('{"q":"kwame"}')->'items'->0->>'name') = 'Kwame, 3 chains' and jsonb_array_length(gold.workings_list('{"q":"zzz"}')->'items') = 0, 'search by name');
  perform gold_test.assert(gold.working_rename(s1, 'Kwame')->>'name' = 'Kwame', 'renamed');

  -- a clash: another device saves from an old version
  r := gold.working_save(jsonb_build_object('id', s1, 'name', 'Kwame', 'doc', doc1, 'baseVersion', 1));
  perform gold_test.assert((r#>>'{data,version}')::int = 2 and r->'data'->'doc' = doc2, 'the server keeps its newer copy and hands it back with the contents: ' || r::text);
  perform gold_test.assert(r#>>'{copy,name}' = 'Kwame (other device)' and (select count(*) from gold.workings where owner_id = ama) = 2, 'and the old-device version is kept as a second sheet');
  perform gold_test.assert((select doc from gold.workings where name = 'Kwame (other device)') = doc1, 'with its own contents');

  -- nobody else
  perform set_config('app.user_id', kojo::text, true);
  perform gold_test.assert(jsonb_array_length(gold.workings_list('{}')->'items') = 0 and gold.working_get(s1) is null, 'a colleague sees none');
  x := gold_test.code_of(format('select gold.working_rename(%L, ''mine'')', s1));
  perform gold_test.assert(x = 'NOT_FOUND', 'a colleague cannot rename: ' || coalesce(x, 'no error'));
  x := gold_test.code_of(format($q$select gold.working_save(jsonb_build_object('id', %L, 'name', 'steal', 'doc', '{"notes":[]}'::jsonb))$q$, s1));
  perform gold_test.assert(x = 'ID_IN_USE', 'a colleague cannot take over its id: ' || coalesce(x, 'no error'));
  perform gold_test.assert((gold.workings_delete(array[s1])->>'deleted')::int = 0, 'a colleague cannot delete it');
  perform set_config('app.user_id', boss::text, true);
  perform gold_test.assert((select count(*) from gold.workings) = 0 and gold.working_get(s1) is null, 'a director sees nothing');

  -- limits and the switch
  perform gold.set_settings('{"workings.maxPerUser":2,"workings.maxKb":1}'::jsonb);
  perform set_config('app.user_id', ama::text, true);
  x := gold_test.code_of(format($q$select gold.working_save(jsonb_build_object('id', %L, 'name', 'third', 'doc', '{"notes":[]}'::jsonb))$q$, s2));
  perform gold_test.assert(x = 'WORKINGS_FULL', 'the sheet limit holds: ' || coalesce(x, 'no error'));
  x := gold_test.code_of(format($q$select gold.working_save(jsonb_build_object('id', %L, 'name', 'Kwame', 'doc', jsonb_build_object('notes', jsonb_build_array(jsonb_build_object('id', 'a', 'x', 0, 'y', 0, 'text', repeat('x', 1100)))), 'baseVersion', 2))$q$, s1));
  perform gold_test.assert(x = 'WORKING_TOO_BIG', 'the size limit holds: ' || coalesce(x, 'no error'));
  perform set_config('app.user_id', boss::text, true);
  perform gold.set_settings('{"workings.enabled":false,"workings.maxPerUser":200}'::jsonb);
  perform set_config('app.user_id', ama::text, true);
  x := gold_test.code_of(format($q$select gold.working_save(jsonb_build_object('id', %L, 'name', 'new', 'doc', '{"notes":[]}'::jsonb))$q$, s3));
  perform gold_test.assert(x = 'WORKINGS_OFF', 'switched off: no new sheets: ' || coalesce(x, 'no error'));
  r := gold.working_save(jsonb_build_object('id', s1, 'name', 'Kwame', 'doc', doc1, 'baseVersion', 2));
  perform gold_test.assert((r#>>'{data,version}')::int = 3, 'but an existing sheet can still be saved');

  -- deleting
  r := gold.workings_delete(array[s1]);
  perform gold_test.assert((r->>'deleted')::int = 1, 'deleted for real');
  perform gold_test.assert(gold.working_get(s1) is null, 'and gone');
  raise notice 'workings ok';
end $$;