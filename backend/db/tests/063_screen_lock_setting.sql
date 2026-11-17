-- 0070: the screen-lock time is a company setting, 5 minutes by default, 0 to 60.
do $$
declare t uuid := gen_random_uuid(); boss uuid := gen_random_uuid(); x text;
begin
  insert into gold.tenants (id, slug, name) values (t, 'lock70', 'Lock Gold 70');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.roles (id, tenant_id, key, name, is_system) values (gen_random_uuid(), t, 'director', 'Director', true);
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (boss, t, 'boss', 'Boss', 'x', (select id from gold.roles where tenant_id = t));
  set local role gold_app;
  perform set_config('app.user_id', boss::text, true);
  perform gold_test.assert((gold.setting('session.lockMinutes'))::int = 5, 'five minutes by default');
  perform gold.set_settings('{"session.lockMinutes":2}'::jsonb);
  perform gold_test.assert((gold.setting('session.lockMinutes'))::int = 2, 'changed');
  perform gold.set_settings('{"session.lockMinutes":0}'::jsonb);
  perform gold_test.assert((gold.setting('session.lockMinutes'))::int = 0, 'can be switched off');
  x := gold_test.code_of('select gold.set_settings(''{"session.lockMinutes":61}''::jsonb)');
  perform gold_test.assert(x = 'VALIDATION_FAILED', 'not over an hour: ' || coalesce(x, 'no error'));
  x := gold_test.code_of('select gold.set_settings(''{"session.lockMinutes":2.5}''::jsonb)');
  perform gold_test.assert(x = 'VALIDATION_FAILED', 'whole minutes: ' || coalesce(x, 'no error'));
  raise notice 'screen lock setting ok';
end $$;