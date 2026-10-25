-- 0014: managing users, customers and branches. Runs as the application login.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid();
  r_dir uuid := gen_random_uuid(); r_tel uuid := gen_random_uuid(); u_dir uuid := gen_random_uuid(); u_dir2 uuid := gen_random_uuid();
  new_user uuid := gen_random_uuid(); other_user uuid := gen_random_uuid(); r jsonb; n int; c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); br uuid := gen_random_uuid();
  tx uuid := gen_random_uuid(); loan uuid := gen_random_uuid(); d1 uuid := gen_random_uuid();
begin
  insert into gold.tenants (id, slug, name) values (t, 'people', 'People Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_dir, t, 'director', 'Director'), (r_tel, t, 'teller', 'Teller');
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_dir, 'users:manage'), (t, r_dir, 'branches:all'), (t, r_tel, 'calculator:use');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values
    (u_dir, t, 'boss', 'The Boss', 'x', r_dir), (u_dir2, t, 'boss2', 'Second Boss', 'x', r_dir);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u_dir::text, true);

  -- users ---------------------------------------------------------------------------------------------------
  r := gold.create_user(jsonb_build_object('id', new_user, 'username', ' Ama.Teller ', 'displayName', 'Ama', 'passwordHash', 'hash1', 'roleKey', 'teller', 'branchIds', jsonb_build_array(tkw)));
  perform gold_test.assert(r#>>'{data,username}' = 'ama.teller' and (r#>>'{data,mustChangePassword}')::boolean and r#>>'{data,role,key}' = 'teller'
    and r#>'{data,branchIds}' = jsonb_build_array(tkw) and not (r#>'{data}' ? 'passwordHash'), 'user created, must change the password: ' || r::text);
  perform gold_test.assert((gold.create_user(jsonb_build_object('id', new_user, 'username', 'x', 'displayName', 'x', 'passwordHash', 'h', 'roleKey', 'teller')))->>'replayed' = 'true', 'same id replays');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.create_user(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'username', 'AMA.teller', 'displayName', 'Other', 'passwordHash', 'h', 'roleKey', 'teller', 'branchIds', jsonb_build_array(tkw)))) = 'USERNAME_TAKEN', 'usernames are unique, ignoring case');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.create_user(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'username', 'a b', 'displayName', 'Other', 'passwordHash', 'h', 'roleKey', 'teller', 'branchIds', jsonb_build_array(tkw)))) = 'VALIDATION_FAILED', 'bad username');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.create_user(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'username', 'nobranch', 'displayName', 'Nobody', 'passwordHash', 'h', 'roleKey', 'teller', 'branchIds', '[]'::jsonb))) = 'BRANCH_REQUIRED', 'a teller needs a branch');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.create_user(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'username', 'norole', 'displayName', 'Nobody', 'passwordHash', 'h', 'roleKey', 'astronaut', 'branchIds', jsonb_build_array(tkw)))) = 'VALIDATION_FAILED', 'unknown role');
  select count(*) into n from gold.users where username = 'nobranch'::citext;
  perform gold_test.assert(n = 0, 'a refused creation leaves nothing behind');
  perform gold_test.assert(jsonb_array_length(gold.users_admin_json()) = 3 and jsonb_array_length(gold.roles_json()) = 2, 'lists');

  -- a personal grant shows up in the effective permissions
  r := gold.update_user(new_user, jsonb_build_object('overrides', jsonb_build_array(jsonb_build_object('permission', 'customers:manage', 'effect', 'allow'))));
  perform gold_test.assert(r->'permissions' @> '"customers:manage"' and r->'permissions' @> '"calculator:use"', 'the override adds a permission: ' || r::text);
  r := gold.update_user(new_user, jsonb_build_object('overrides', jsonb_build_array(jsonb_build_object('permission', 'calculator:use', 'effect', 'deny'))));
  perform gold_test.assert(not (r->'permissions' @> '"calculator:use"') and not (r->'permissions' @> '"customers:manage"'), 'overrides are replaced as a set, a denial removes the role''s permission');

  -- changing access signs the person out
  insert into gold.refresh_tokens (tenant_id, user_id, family_id, token_hash, expires_at) values (t, new_user, gen_random_uuid(), '\x01', now() + interval '1 day');
  r := gold.update_user(new_user, jsonb_build_object('displayName', 'Ama Mensah', 'branchIds', jsonb_build_array(tkw, ksi)));
  select count(*) into n from gold.refresh_tokens where user_id = new_user and revoked_at is null;
  perform gold_test.assert(n = 0 and r->>'displayName' = 'Ama Mensah' and jsonb_array_length(r->'branchIds') = 2, 'access change revokes sessions');
  insert into gold.refresh_tokens (tenant_id, user_id, family_id, token_hash, expires_at) values (t, new_user, gen_random_uuid(), '\x02', now() + interval '1 day');
  r := gold.update_user(new_user, jsonb_build_object('phone', '0244000000'));
  select count(*) into n from gold.refresh_tokens where user_id = new_user and revoked_at is null;
  perform gold_test.assert(n = 1, 'a name or phone change does not sign anyone out');

  r := gold.update_user(new_user, jsonb_build_object('isActive', false));
  perform gold_test.assert(not (r->>'isActive')::boolean, 'switched off');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.update_user(%L, %L::jsonb)$f$, u_dir, jsonb_build_object('isActive', false))) = 'CANNOT_CHANGE_OWN_ACCESS', 'you cannot switch yourself off');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.update_user(%L, %L::jsonb)$f$, u_dir, jsonb_build_object('roleKey', 'teller'))) = 'CANNOT_CHANGE_OWN_ACCESS', 'or demote yourself');
  -- two directors: switching the other off would leave only the actor, which is fine; the company can never reach zero
  r := gold.update_user(u_dir2, jsonb_build_object('isActive', false));
  perform gold_test.assert(not (r->>'isActive')::boolean, 'one director may switch off the other');
  -- (the API only lets people with users:manage ask; this checks the database rule on its own, with an actor who lacks it)
  perform gold.create_user(jsonb_build_object('id', other_user, 'username', 'kojo', 'displayName', 'Kojo', 'passwordHash', 'h', 'roleKey', 'teller', 'branchIds', jsonb_build_array(tkw)));
  perform set_config('app.user_id', other_user::text, true);
  perform gold_test.assert(gold_test.code_of(format($f$select gold.update_user(%L, %L::jsonb)$f$, u_dir, jsonb_build_object('overrides', jsonb_build_array(jsonb_build_object('permission', 'users:manage', 'effect', 'deny'))))) = 'LAST_DIRECTOR', 'the last person who can manage users cannot lose it');
  perform set_config('app.user_id', u_dir::text, true);
  r := gold.update_user(u_dir2, jsonb_build_object('isActive', true));

  -- passwords
  r := gold.reset_user_password(new_user, 'hash2');
  perform gold_test.assert((r->>'mustChangePassword')::boolean and (select password_hash from gold.users where id = new_user) = 'hash2', 'reset sets a temporary password');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.reset_user_password(%L, 'h')$f$, u_dir)) = 'USE_CHANGE_PASSWORD', 'not for yourself');
  update gold.users set must_change_password = true where id = u_dir;
  perform gold_test.assert((gold.my_security_json()->>'mustChangePassword')::boolean and gold.my_password_hash() = 'x', 'security state');
  perform gold.change_my_password('hash3');
  perform gold_test.assert(not (gold.my_security_json()->>'mustChangePassword')::boolean and gold.my_password_hash() = 'hash3', 'changing your own password clears the flag');

  -- customers -----------------------------------------------------------------------------------------------
  r := gold.create_customer(jsonb_build_object('id', c1, 'name', 'Kofi Boateng', 'phone', '0200 000 001', 'notes', 'regular'));
  perform gold_test.assert(r#>>'{data,phone}' = '0200000001' and r#>>'{data,purchases}' = '0', 'customer created, phone tidied');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.create_customer(%L::jsonb)$f$, jsonb_build_object('name', 'kofi boateng', 'phone', '0200000001'))) = 'DUPLICATE_CUSTOMER', 'duplicate by name and phone');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.create_customer(%L::jsonb)$f$, jsonb_build_object('name', 'No Phone'))) = 'VALIDATION_FAILED', 'phone needed');
  perform gold.create_customer(jsonb_build_object('id', c2, 'name', 'Kofi B.', 'phone', '0200000009'));

  perform gold.open_day(jsonb_build_object('id', d1, 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":100}'::jsonb, 'capturedAt', now()));
  perform gold.post_transaction(jsonb_build_object('id', tx, 'branchId', tkw, 'customer', jsonb_build_object('id', c2, 'name', 'Kofi B.'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold.issue_loan(jsonb_build_object('id', loan, 'branchId', tkw, 'principal', 300, 'customer', jsonb_build_object('id', c2, 'name', 'Kofi B.'), 'lines', '{"100":3}'::jsonb,
    'collateral', jsonb_build_object('topWeight', '10'), 'capturedAt', now()));
  r := gold.customer_detail_json(c2);
  perform gold_test.assert(r->>'purchases' = '1' and r->>'owesUs' = '300' and jsonb_array_length(r->'transactions') = 1 and jsonb_array_length(r->'debts') = 1 and jsonb_array_length(r->'held') = 1, 'detail: ' || r::text);

  perform gold_test.assert(gold_test.code_of(format($f$select gold.update_customer(%L, %L::jsonb)$f$, c2, jsonb_build_object('name', 'Kofi Boateng', 'phone', '0200000001'))) = 'DUPLICATE_CUSTOMER', 'renaming into an existing person is refused');
  r := gold.update_customer(c2, jsonb_build_object('name', 'Kofi Boateng Jr', 'notes', 'son'));
  perform gold_test.assert(r->>'name' = 'Kofi Boateng Jr' and (select party_name from gold.debts where customer_id = c2) = 'Kofi Boateng Jr'
    and (select customer_name from gold.transactions where id = tx) = 'Kofi B.', 'debts follow the new name, the receipt keeps the old one');

  r := gold.merge_customers(c1, c2);
  perform gold_test.assert(r->>'id' = c1::text and r->>'purchases' = '1' and r->>'owesUs' = '300' and jsonb_array_length(r->'held') = 1, 'merged into the kept customer: ' || r::text);
  select count(*) into n from gold.customers where id = c2;
  perform gold_test.assert(n = 0 and (select customer_id from gold.transactions where id = tx) = c1, 'the duplicate is gone and its history moved');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.merge_customers(%L, %L)$f$, c1, c1)) = 'VALIDATION_FAILED', 'cannot merge with itself');

  -- branches ------------------------------------------------------------------------------------------------
  r := gold.create_branch(jsonb_build_object('id', br, 'code', ' obu ', 'name', 'Obuasi'));
  perform gold_test.assert(r#>>'{data,code}' = 'OBU' and r#>>'{data,timezone}' = 'Africa/Accra' and not (r#>>'{data,isMain}')::boolean, 'branch created: ' || r::text);
  perform gold_test.assert(gold_test.code_of(format($f$select gold.create_branch(%L::jsonb)$f$, jsonb_build_object('code', 'obu', 'name', 'Again'))) = 'CODE_TAKEN', 'code is unique');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.create_branch(%L::jsonb)$f$, jsonb_build_object('code', 'X', 'name', 'Short'))) = 'VALIDATION_FAILED', 'code shape');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.create_branch(%L::jsonb)$f$, jsonb_build_object('code', 'ZZZ', 'name', 'Nowhere', 'timezone', 'Mars/Base'))) = 'VALIDATION_FAILED', 'time zone must be real');
  r := gold.update_branch(br, jsonb_build_object('name', 'Obuasi Town'));
  perform gold_test.assert(r->>'name' = 'Obuasi Town' and r->>'code' = 'OBU', 'renamed, code unchanged');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.update_branch(%L, %L::jsonb)$f$, ksi, jsonb_build_object('isActive', false))) = 'MAIN_BRANCH', 'main branch stays');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.update_branch(%L, %L::jsonb)$f$, tkw, jsonb_build_object('isActive', false))) = 'DAY_OPEN', 'an open day blocks switching off');
  r := gold.update_branch(br, jsonb_build_object('isActive', false));
  perform gold_test.assert(not (r->>'isActive')::boolean and jsonb_array_length(gold.branches_admin_json()) = 3, 'switched off, still listed for administrators');

  select count(*) into n from gold.audit_events where action in ('user.created', 'user.updated', 'customer.merged', 'branch.created');
  perform gold_test.assert(n >= 6, 'changes are audited');
  reset role;
  raise notice 'people: all assertions passed';
end $$;