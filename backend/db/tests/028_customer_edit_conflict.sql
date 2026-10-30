-- Two people editing the same customer.
do $$
declare
  t uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid(); c uuid := gen_random_uuid(); v_failed boolean := false;
begin
  insert into gold.tenants (id, slug, name) values (t, 'conflict', 'Conflict');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'ama', 'Ama', 'x', r_role);
  insert into gold.customers (id, tenant_id, name, phone) values (c, t, 'Kofi Mensah', '0241111111');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);

  -- first person changes the phone
  perform gold.update_customer(c, jsonb_build_object('phone', '0242222222', 'expected', jsonb_build_object('phone', '0241111111')));
  -- second person opened it before that and also changes the phone: refused
  begin
    perform gold.update_customer(c, jsonb_build_object('phone', '0243333333', 'expected', jsonb_build_object('phone', '0241111111')));
  exception when others then v_failed := true; end;
  perform gold_test.assert(v_failed, 'second save refused');
  perform gold_test.assert((select phone from gold.customers where id = c) = '0242222222', 'first change kept');
  -- a different field is fine: the name was not touched by the other person
  perform gold.update_customer(c, jsonb_build_object('name', 'Kofi A. Mensah', 'expected', jsonb_build_object('name', 'Kofi Mensah')));
  perform gold_test.assert((select name from gold.customers where id = c) = 'Kofi A. Mensah', 'other field saved');
  -- saves without `expected` behave as before
  perform gold.update_customer(c, jsonb_build_object('notes', 'regular'));
  perform gold_test.assert((select notes from gold.customers where id = c) = 'regular', 'old style still works');
end $$;