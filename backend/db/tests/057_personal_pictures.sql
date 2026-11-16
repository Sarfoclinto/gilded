-- B65: personal pictures are private to their owner, deleted for real, limited, and cleaned up for people who left.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); r_d uuid := gen_random_uuid(); r_t uuid := gen_random_uuid();
  boss uuid := gen_random_uuid(); ama uuid := gen_random_uuid(); kojo uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
  r jsonb; x text; n int;
begin
  insert into gold.tenants (id, slug, name) values (t, 'personal64', 'Personal Gold 64');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', true);
  insert into gold.roles (id, tenant_id, key, name, is_system) values (r_d, t, 'director', 'Director', true), (r_t, t, 'teller', 'Teller', true);
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_d, 'attachments:library'), (t, r_d, 'attachments:remove'), (t, r_d, 'settings:manage');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (boss, t, 'boss', 'Boss', 'x', r_d), (ama, t, 'ama', 'Ama', 'x', r_t), (kojo, t, 'kojo', 'Kojo', 'x', r_t);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, boss, tkw), (t, ama, tkw), (t, kojo, tkw);
  set local role gold_app;
  perform set_config('app.user_id', ama::text, true);

  -- taking a picture
  r := gold.personal_add(jsonb_build_object('id', p1, 'fileName', 'note.jpg', 'size', 1000, 'sha256', repeat('ab', 32), 'storageKey', 'k/1', 'thumbKey', 'k/1t', 'width', 10, 'height', 10));
  perform gold_test.assert(not (r->>'replayed')::boolean and r#>>'{data,id}' = p1::text, 'the picture was kept');
  r := gold.personal_add(jsonb_build_object('id', p1, 'size', 1000, 'sha256', repeat('ab', 32), 'storageKey', 'k/1'));
  perform gold_test.assert((r->>'replayed')::boolean and (select count(*) from gold.personal_pictures) = 1, 'sending it again keeps one');
  perform gold.personal_set_caption(p1, '  receipt from the bank  ');
  perform gold_test.assert(gold.personal_list('{}')#>>'{items,0,caption}' = 'receipt from the bank', 'the caption was kept trimmed');
  perform gold_test.assert((gold.personal_list('{"q":"BANK"}')->>'total')::int = 1 and (gold.personal_list('{"q":"zzz"}')->>'total')::int = 0, 'search finds by caption');

  -- nobody else sees it: a colleague, a director with every photo permission, and a guessed id
  perform set_config('app.user_id', kojo::text, true);
  perform gold_test.assert(jsonb_array_length(gold.personal_list('{}')->'items') = 0, 'a colleague sees none');
  perform gold_test.assert(gold.personal_open(p1) is null, 'a colleague cannot open it by id');
  x := gold_test.code_of(format('select gold.personal_set_caption(%L, ''mine now'')', p1));
  perform gold_test.assert(x = 'NOT_FOUND', 'a colleague cannot change it: ' || coalesce(x, 'no error'));
  perform gold_test.assert(jsonb_array_length(gold.personal_delete(array[p1])) = 0, 'a colleague cannot delete it');
  x := gold_test.code_of(format($q$select gold.personal_add(jsonb_build_object('id', %L, 'size', 5, 'sha256', repeat('cd', 32), 'storageKey', 'k/steal'))$q$, p1));
  perform gold_test.assert(x = 'ID_IN_USE', 'a colleague cannot take over its id: ' || coalesce(x, 'no error'));
  perform set_config('app.user_id', boss::text, true);
  perform gold_test.assert(jsonb_array_length(gold.personal_list('{}')->'items') = 0 and gold.personal_open(p1) is null, 'a director sees none');
  perform gold_test.assert((select count(*) from gold.personal_pictures) = 0, 'not even by reading the table');
  perform gold_test.assert((gold.photo_library('{}', array[tkw], true)->>'total')::int = 0, 'the company library does not list it');

  -- limits and the switch
  perform gold.set_settings('{"personalPictures.maxPerUser":2,"personalPictures.maxMb":1}'::jsonb);
  perform set_config('app.user_id', ama::text, true);
  perform gold.personal_add(jsonb_build_object('id', p2, 'size', 1000, 'sha256', repeat('ab', 32), 'storageKey', 'k/2'));
  x := gold_test.code_of(format($q$select gold.personal_add(jsonb_build_object('id', %L, 'size', 1000, 'sha256', repeat('ab', 32), 'storageKey', 'k/3'))$q$, p3));
  perform gold_test.assert(x = 'PERSONAL_FULL', 'the count limit holds: ' || coalesce(x, 'no error'));
  perform gold.set_settings('{"personalPictures.maxPerUser":50}'::jsonb);
  x := gold_test.code_of(format($q$select gold.personal_add(jsonb_build_object('id', %L, 'size', 1100000, 'sha256', repeat('ab', 32), 'storageKey', 'k/3'))$q$, p3));
  perform gold_test.assert(x = 'PERSONAL_FULL', 'the size limit holds: ' || coalesce(x, 'no error'));
  perform gold.set_settings('{"personalPictures.enabled":false}'::jsonb);
  x := gold_test.code_of(format($q$select gold.personal_add(jsonb_build_object('id', %L, 'size', 10, 'sha256', repeat('ab', 32), 'storageKey', 'k/3'))$q$, p3));
  perform gold_test.assert(x = 'PERSONAL_OFF', 'the company switch holds: ' || coalesce(x, 'no error'));
  perform gold_test.assert(jsonb_array_length(gold.personal_list('{}')->'items') = 2, 'switching off hides nothing from the owner');
  perform gold.set_settings('{"personalPictures.enabled":true}'::jsonb);

  -- deleting is real and returns the files to remove
  r := gold.personal_delete(array[p1]);
  perform gold_test.assert(r#>>'{0,storageKey}' = 'k/1' and r#>>'{0,thumbKey}' = 'k/1t', 'the files to remove come back');
  perform gold_test.assert((select count(*) from gold.personal_pictures where id = p1) = 0, 'the row is gone');

  -- people who left: only after the waiting time, only their pictures
  reset role;
  update gold.users set is_active = false where id = ama;
  set local role gold_app;
  perform set_config('app.user_id', boss::text, true);
  perform gold_test.assert(jsonb_array_length(gold.personal_pictures_purge()) = 0, 'not purged before 90 days');
  reset role;
  alter table gold.users disable trigger users_touch;
  update gold.users set updated_at = now() - interval '100 days' where id = ama;
  alter table gold.users enable trigger users_touch;
  set local role gold_app;
  perform set_config('app.user_id', boss::text, true);
  perform gold_test.assert(jsonb_array_length(gold.personal_pictures_purge()) = 1, 'purged after 90 days');
  reset role;
  perform gold_test.assert((select count(*) from gold.personal_pictures) = 0, 'nothing left');
  raise notice 'personal pictures ok';
end $$;