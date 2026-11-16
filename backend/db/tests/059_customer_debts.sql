-- B59: what a customer already owes, across the caller's branches.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid(); boss uuid := gen_random_uuid();
  kofi uuid := gen_random_uuid(); ama uuid := gen_random_uuid(); r jsonb;
begin
  insert into gold.tenants (id, slug, name) values (t, 'debts59', 'Debts Gold 59');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', true), (ksi, t, 'KSI', 'Kumasi', false);
  insert into gold.roles (id, tenant_id, key, name, is_system) values (gen_random_uuid(), t, 'director', 'Director', true);
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (boss, t, 'boss', 'Boss', 'x', (select id from gold.roles where tenant_id = t));
  insert into gold.customers (id, tenant_id, name, phone) values (kofi, t, 'Kofi', '0200000001'), (ama, t, 'Ama', '0200000002');
  insert into gold.debts (tenant_id, branch_id, customer_id, party_name, party_type, principal, reason, issued_at, issued_by, due_date)
  values (t, tkw, kofi, 'Kofi', 'customer', 1000, 'loan', now() - interval '10 days', boss, current_date - 2),
         (t, ksi, kofi, 'Kofi', 'customer', 500, 'loan', now() - interval '5 days', boss, null),
         (t, tkw, ama, 'Ama', 'customer', 300, 'loan', now(), boss, null);
  insert into gold.debts (tenant_id, branch_id, customer_id, party_name, party_type, principal, reason, issued_at, issued_by, status, closed_at, closed_by)
  values (t, tkw, kofi, 'Kofi', 'customer', 200, 'old loan', now() - interval '60 days', boss, 'settled', now() - interval '30 days', boss);

  r := gold.customer_debts_json(kofi, array[tkw, ksi]);
  perform gold_test.assert(jsonb_array_length(r->'items') = 2 and (r->>'total')::numeric = 1500 and (r->>'elsewhere')::int = 0, 'both open loans, not the settled one: ' || r::text);
  perform gold_test.assert(r#>>'{items,0,branchName}' = 'Tarkwa', 'dated loans first, with the branch name');
  r := gold.customer_debts_json(kofi, array[tkw]);
  perform gold_test.assert(jsonb_array_length(r->'items') = 1 and (r->>'total')::numeric = 1000 and (r->>'elsewhere')::int = 1, 'the other branch is only counted: ' || r::text);
  r := gold.customer_debts_json(gen_random_uuid(), array[tkw]);
  perform gold_test.assert(jsonb_array_length(r->'items') = 0 and (r->>'total')::numeric = 0, 'a customer who owes nothing');
  raise notice 'customer debts ok';
end $$;