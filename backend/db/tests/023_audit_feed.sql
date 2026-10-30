-- The audit feed: reads the original records, filters, sorts, pages, and respects branch scope.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid(); r_dir uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); r jsonb;
begin
  insert into gold.tenants (id, slug, name) values (t, 'aud', 'Audit Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (tkw, t, 'TKW', 'Tarkwa', true, 'Africa/Accra'), (ksi, t, 'KSI', 'Kumasi', false, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_dir, t, 'director', 'Director');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u1, t, 'ama', 'Ama Bene', 'x', r_dir), (u2, t, 'kojo', 'Kojo Sarpong', 'x', r_dir);
  insert into gold.business_days (id, tenant_id, branch_id, business_date, status, opened_at, opened_by, closed_at, closed_by, closing_confirmed, closing_confirmation_version, closing_confirmation_text, signoff_status)
  values (d1, t, tkw, current_date - 1, 'closed', now() - interval '30 hours', u1, now() - interval '20 hours', u1, true, 'v1', 'I checked', 'pending');
  insert into gold.business_days (id, tenant_id, branch_id, business_date, status, opened_at, opened_by) values (d2, t, ksi, current_date, 'open', now() - interval '2 hours', u2);
  insert into gold.drawer_movements (tenant_id, branch_id, business_day_id, kind, note, occurred_at, created_by) values (t, ksi, d2, 'topup', 'Float from head office', now() - interval '1 hour', u2);

  set local role gold_app;
  perform set_config('app.user_id', u1::text, true);
  perform gold.audit('branch.updated', 'branch', ksi::text, '{"name":"Old"}'::jsonb, '{"name":"Kumasi"}'::jsonb);

  -- everything, newest first
  r := gold.audit_search_json(null, '{}'::jsonb);
  perform gold_test.assert((r->>'total')::int = 5, 'five events: ' || (r->>'total'));
  perform gold_test.assert(r->'items'->0->>'action' = 'branch.updated' and r->'items'->0->'actor'->>'displayName' = 'Ama Bene', 'newest first, with the actor: ' || (r->'items'->0)::text);
  perform gold_test.assert((r->'categories'->>'day')::int = 3 and (r->'categories'->>'cash')::int = 1 and (r->'categories'->>'setup')::int = 1, 'category counts: ' || (r->'categories')::text);
  -- oldest first
  r := gold.audit_search_json(null, '{"sort":"oldest"}'::jsonb);
  perform gold_test.assert(r->'items'->0->>'action' = 'day.opened' and r->'items'->0->'branch'->>'name' = 'Tarkwa', 'oldest first: ' || (r->'items'->0)::text);
  -- filters
  r := gold.audit_search_json(null, '{"category":"day"}'::jsonb);
  perform gold_test.assert((r->>'total')::int = 3 and (r->'categories'->>'cash')::int = 1, 'category filter keeps the other counts');
  r := gold.audit_search_json(null, jsonb_build_object('actorId', u2));
  perform gold_test.assert((r->>'total')::int = 2, 'by person');
  r := gold.audit_search_json(null, '{"q":"float"}'::jsonb);
  perform gold_test.assert((r->>'total')::int = 1 and r->'items'->0->>'action' = 'cash.topup', 'search the words');
  r := gold.audit_search_json(null, '{"q":"ama"}'::jsonb);
  perform gold_test.assert((r->>'total')::int >= 3, 'search by who did it');
  r := gold.audit_search_json(null, jsonb_build_object('from', (now() - interval '3 hours')::text));
  perform gold_test.assert((r->>'total')::int = 3, 'date range: ' || (r->>'total'));
  -- pages
  r := gold.audit_search_json(null, '{"size":2,"page":3}'::jsonb);
  perform gold_test.assert((r->>'total')::int = 5 and jsonb_array_length(r->'items') = 1, 'last page holds the remainder');
  -- scope: Kumasi only (company-wide events, with no branch, are not shown to someone limited to a branch)
  r := gold.audit_search_json(array[ksi], '{}'::jsonb);
  perform gold_test.assert((r->>'total')::int = 2 and not exists (select 1 from jsonb_array_elements(r->'items') i where i->'branch'->>'name' = 'Tarkwa'), 'scope respected');
  begin
    perform gold.audit_search_json(array[ksi], jsonb_build_object('branchId', tkw));
    perform gold_test.assert(false, 'should be refused');
  exception when others then
    perform gold_test.assert(sqlerrm like '%FORBIDDEN%', 'outside scope refused: ' || sqlerrm);
  end;
end $$;