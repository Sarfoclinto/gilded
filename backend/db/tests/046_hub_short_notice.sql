-- B50: a computer that learns its entry was short at the hub reports it; the branch's managers get one notice per entry.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid();
  r_teller uuid := gen_random_uuid(); r_mgr uuid := gen_random_uuid(); teller uuid := gen_random_uuid(); mgr uuid := gen_random_uuid(); mgr2 uuid := gen_random_uuid();
  r jsonb; n int; p jsonb;
begin
  insert into gold.tenants (id, slug, name) values (t, 'hubshort', 'Hub Short');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_teller, t, 'teller', 'Teller'), (r_mgr, t, 'manager', 'Manager');
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_mgr, 'discrepancies:review');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values
    (teller, t, 'ama', 'Ama', 'x', r_teller), (mgr, t, 'kojo', 'Kojo', 'x', r_mgr), (mgr2, t, 'esi', 'Esi', 'x', r_mgr);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, teller, tkw), (t, mgr, tkw), (t, mgr2, ksi);
  set local role gold_app;
  perform set_config('app.user_id', teller::text, true);

  p := jsonb_build_object('branchId', tkw, 'commandId', 'cmd-1', 'short', '{"100":7,"50":2}'::jsonb, 'capturedAt', now());
  r := gold.report_hub_short(p);
  perform gold_test.assert((r->>'recorded')::boolean and (r->>'value')::numeric = 800, 'first report is recorded: ' || r::text);
  select count(*) into n from gold.notifications where kind = 'hub_short' and user_id = mgr;
  perform gold_test.assert(n = 1, 'the manager of that branch is told');
  select count(*) into n from gold.notifications where kind = 'hub_short' and user_id in (mgr2, teller);
  perform gold_test.assert(n = 0, 'a manager of another branch and the teller are not told');
  perform gold_test.assert((select title from gold.notifications where user_id = mgr) like '%Tarkwa%GHS 800%'
    and (select body from gold.notifications where user_id = mgr) like '%7 × GHS 100, 2 × GHS 50%', 'the notice says where and how much');

  -- the same entry reported again (a retry) changes nothing
  r := gold.report_hub_short(p);
  perform gold_test.assert(not (r->>'recorded')::boolean, 'a repeat is ignored');
  select count(*) into n from gold.notifications where kind = 'hub_short'; perform gold_test.assert(n = 1, 'still one notice');
  select count(*) into n from gold.hub_short_notices; perform gold_test.assert(n = 1, 'and one record');

  -- a different entry is a new notice
  r := gold.report_hub_short(jsonb_build_object('branchId', tkw, 'commandId', 'cmd-2', 'short', '{"20":3}'::jsonb));
  perform gold_test.assert((r->>'recorded')::boolean, 'another entry is new');
  select count(*) into n from gold.notifications where kind = 'hub_short' and user_id = mgr; perform gold_test.assert(n = 2, 'second notice');

  -- bad input
  perform gold_test.assert(gold_test.code_of(format($q$select gold.report_hub_short(jsonb_build_object('branchId','%s','commandId','x','short','{"100":1}'::jsonb))$q$, gen_random_uuid())) = 'NOT_FOUND', 'unknown branch');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.report_hub_short(jsonb_build_object('branchId','%s','commandId','x','short','{}'::jsonb))$q$, tkw)) = 'VALIDATION_FAILED', 'empty short');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.report_hub_short(jsonb_build_object('branchId','%s','commandId','x','short','{"abc":1}'::jsonb))$q$, tkw)) = 'VALIDATION_FAILED', 'bad note value');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.report_hub_short(jsonb_build_object('branchId','%s','commandId','x','short','{"100":-1}'::jsonb))$q$, tkw)) = 'VALIDATION_FAILED', 'negative count');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.report_hub_short(jsonb_build_object('branchId','%s','short','{"100":1}'::jsonb))$q$, tkw)) = 'VALIDATION_FAILED', 'missing command id');
  raise notice 'hub short notice ok';
end $$;