-- 0069: totals count every debt, and the open list is not cut at 100.
do $$
declare t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid(); boss uuid := gen_random_uuid(); r jsonb; i int;
begin
  insert into gold.tenants (id, slug, name) values (t, 'debts69', 'Debts Gold 69');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', true), (ksi, t, 'KSI', 'Kumasi', false);
  insert into gold.roles (id, tenant_id, key, name, is_system) values (gen_random_uuid(), t, 'director', 'Director', true);
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (boss, t, 'boss', 'Boss', 'x', (select id from gold.roles where tenant_id = t));
  -- 150 open loans of 10 cedis at Tarkwa, the oldest 20 overdue; one settled; one at another branch; two the branch owes
  for i in 1..150 loop
    insert into gold.debts (tenant_id, branch_id, party_name, party_type, principal, reason, issued_at, issued_by, due_date, direction)
    values (t, tkw, 'C' || i, 'other', 10, 'loan', now() - make_interval(days => 200 - i), boss, case when i <= 20 then current_date - 5 else current_date + 30 end, 'receivable');
  end loop;
  insert into gold.debts (tenant_id, branch_id, party_name, party_type, principal, reason, issued_at, issued_by, status, closed_at, closed_by, direction)
  values (t, tkw, 'Old', 'other', 999, 'loan', now() - interval '300 days', boss, 'settled', now(), boss, 'receivable');
  insert into gold.debts (tenant_id, branch_id, party_name, party_type, principal, reason, issued_at, issued_by, direction)
  values (t, ksi, 'Elsewhere', 'other', 500, 'loan', now(), boss, 'receivable'),
         (t, tkw, 'We owe A', 'other', 40, 'owed', now(), boss, 'payable'), (t, tkw, 'We owe B', 'other', 60, 'owed', now(), boss, 'payable');

  r := gold.debts_summary(tkw);
  perform gold_test.assert((r#>>'{receivable,open}')::int = 150 and (r#>>'{receivable,total}')::numeric = 1500, 'every open loan is counted: ' || r::text);
  perform gold_test.assert((r#>>'{receivable,overdue}')::int = 20, 'the old overdue ones are counted');
  perform gold_test.assert((r#>>'{payable,open}')::int = 2 and (r#>>'{payable,total}')::numeric = 100, 'what the branch owes');
  perform gold_test.assert((r->>'allCount')::int = 153, 'all debts, settled included');
  perform gold_test.assert(jsonb_array_length(gold.debts_json(tkw, 'receivable', true, null, 1000)) = 150, 'the open list shows all 150');
  perform gold_test.assert(jsonb_array_length(gold.debts_json(tkw, 'receivable', true, null)) = 100, 'the old default is unchanged for other callers');
  perform gold_test.assert(jsonb_array_length(gold.debts_json(tkw, 'receivable', true, null, 5000)) = 150, 'the cap is 1000, a bigger ask is fine');
  raise notice 'debts summary ok';
end $$;