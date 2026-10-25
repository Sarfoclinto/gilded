-- Sign-in support as the application login sees it: company lookup, permissions, branches, refresh-token rotation.
do $$
declare ta uuid; tb uuid; u uuid; rid uuid; r record; n int; perms text[]; b_count int;
begin
  select id into ta from gold.tenants where slug = 'demo';
  select id into tb from gold.tenants where slug = 'other';
  select id, users.role_id into u, rid from gold.users where tenant_id = ta limit 1;

  -- grants for the scenario (as owner)
  insert into gold.role_permissions (tenant_id, role_id, permission)
    select ta, rid, p from unnest(array['transactions:read','transactions:create','days:read']) p on conflict do nothing;
  insert into gold.user_permission_overrides (tenant_id, user_id, permission, effect) values
    (ta, u, 'reports:read', 'allow'), (ta, u, 'transactions:create', 'deny');
  select count(*) into b_count from gold.branches where tenant_id = ta and is_active;

  set local role gold_app;

  -- 1. Company lookup before anyone is signed in
  perform set_config('app.tenant_id', '', true);
  perform set_config('app.login_company', 'DEMO', true);   -- slug is case-insensitive
  select count(*) into n from gold.tenants;
  perform gold_test.assert(n = 1, 'sign-in can see exactly the named company, saw ' || n);
  perform set_config('app.login_company', 'nope', true);
  select count(*) into n from gold.tenants;
  perform gold_test.assert(n = 0, 'an unknown company name shows nothing');
  perform set_config('app.login_company', '', true);
  select count(*) into n from gold.tenants;
  perform gold_test.assert(n = 0, 'without a company name the tenant list stays hidden');
  perform gold_test.assert(gold_test.fails($f$select count(*) from gold.users$f$) = false and (select count(*) from gold.users) = 0,
    'users stay hidden until a company is set');

  -- 2. Effective permissions: role + allow - deny
  perform set_config('app.tenant_id', ta::text, true);
  select array_agg(p) into perms from gold.effective_permissions(u) p;
  perform gold_test.assert(perms @> array['transactions:read','days:read','reports:read'], 'role and personal grants combine: ' || perms::text);
  perform gold_test.assert(not ('transactions:create' = any(perms)), 'a personal denial removes a role permission');

  -- 3. Branches: assigned only, then everything with branches:all
  select count(*) into n from gold.user_branch_ids(u);
  perform gold_test.assert(n <= b_count, 'a user sees no more than the active branches');
  reset role;
  insert into gold.user_permission_overrides (tenant_id, user_id, permission, effect) values (ta, u, 'branches:all', 'allow');
  set local role gold_app;
  perform set_config('app.tenant_id', ta::text, true);
  select count(*) into n from gold.user_branch_ids(u);
  perform gold_test.assert(n = b_count, 'branches:all gives every active branch');

  -- 4. Refresh rotation
  insert into gold.refresh_tokens (tenant_id, user_id, family_id, token_hash, expires_at)
    values (ta, u, gen_random_uuid(), '\x0a01', now() + interval '7 days');
  select * into r from gold.rotate_refresh_token('\x0a01', '\x0a02', now() + interval '7 days', 'test', null);
  perform gold_test.assert(r.o_outcome = 'ok' and r.o_user_id = u, 'first rotation succeeds');
  select * into r from gold.rotate_refresh_token('\x0a01', '\x0a03', now() + interval '7 days', 'test', null);
  perform gold_test.assert(r.o_outcome = 'race', 'the retired token used again at once is a harmless race, got ' || r.o_outcome);
  select count(*) into n from gold.refresh_tokens where token_hash = '\x0a02' and revoked_at is null;
  perform gold_test.assert(n = 1, 'a race does not revoke the live token');

  -- age the retirement past the grace period, then replay it
  reset role;
  update gold.refresh_tokens set revoked_at = now() - interval '1 minute' where token_hash = '\x0a01';
  set local role gold_app;
  perform set_config('app.tenant_id', ta::text, true);
  select * into r from gold.rotate_refresh_token('\x0a01', '\x0a04', now() + interval '7 days', 'thief', null);
  perform gold_test.assert(r.o_outcome = 'reused', 'a retired token replayed later is flagged as reused, got ' || r.o_outcome);
  select count(*) into n from gold.refresh_tokens where family_id = r.o_family_id and revoked_at is null;
  perform gold_test.assert(n = 0, 'reuse revokes the whole login');
  select * into r from gold.rotate_refresh_token('\x0a02', '\x0a05', now() + interval '7 days', 'victim', null);
  perform gold_test.assert(r.o_outcome = 'revoked', 'the legitimate holder is signed out too, got ' || r.o_outcome);

  select * into r from gold.rotate_refresh_token('\xdead', '\x0a06', now() + interval '7 days', 'x', null);
  perform gold_test.assert(r.o_outcome = 'unknown', 'a made-up token is unknown');

  -- expiry, logout, deactivated account
  insert into gold.refresh_tokens (tenant_id, user_id, family_id, token_hash, expires_at)
    values (ta, u, gen_random_uuid(), '\x0b01', now() - interval '1 second');
  select * into r from gold.rotate_refresh_token('\x0b01', '\x0b02', now() + interval '7 days', 'x', null);
  perform gold_test.assert(r.o_outcome = 'expired', 'an expired token is refused');

  insert into gold.refresh_tokens (tenant_id, user_id, family_id, token_hash, expires_at)
    values (ta, u, gen_random_uuid(), '\x0c01', now() + interval '7 days');
  perform gold.revoke_refresh_family('\x0c01');
  select * into r from gold.rotate_refresh_token('\x0c01', '\x0c02', now() + interval '7 days', 'x', null);
  perform gold_test.assert(r.o_outcome = 'revoked', 'after logout the token is dead');
  perform gold.revoke_refresh_family('\xffff');   -- unknown token: no error

  reset role;
  insert into gold.refresh_tokens (tenant_id, user_id, family_id, token_hash, expires_at)
    values (ta, u, gen_random_uuid(), '\x0d01', now() + interval '7 days');
  update gold.users set is_active = false where id = u;
  set local role gold_app;
  perform set_config('app.tenant_id', ta::text, true);
  select * into r from gold.rotate_refresh_token('\x0d01', '\x0d02', now() + interval '7 days', 'x', null);
  perform gold_test.assert(r.o_outcome = 'revoked', 'a switched-off account cannot refresh');

  -- 5. A token from another company is invisible
  perform set_config('app.tenant_id', tb::text, true);
  select * into r from gold.rotate_refresh_token('\x0a02', '\x0e01', now() + interval '7 days', 'x', null);
  perform gold_test.assert(r.o_outcome = 'unknown', 'company B cannot touch company A''s tokens');

  reset role;
  update gold.users set is_active = true where id = u;
  raise notice 'auth support: all assertions passed';
end $$;