-- Offline sync: device keys, applying queued commands once each with a recorded result, held/rejected review, retry and dismiss.
do $$
declare
  t uuid := gen_random_uuid(); b uuid := gen_random_uuid(); b2 uuid := gen_random_uuid(); r_role uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid();
  c_open uuid := gen_random_uuid(); c_tx uuid := gen_random_uuid(); c_held uuid := gen_random_uuid(); c_bad uuid := gen_random_uuid(); c_open2 uuid := gen_random_uuid();
  mv_held uuid := gen_random_uuid(); tx uuid := gen_random_uuid();
  key1 text := repeat('A', 120); key2 text := repeat('B', 120);
  r jsonb; rv jsonb;
begin
  insert into gold.tenants (id, slug, name) values (t, 'syncco', 'Sync');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (b, t, 'TKW', 'Tarkwa', true, 'Africa/Accra');
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (b2, t, 'OBU', 'Obuasi', false, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'director', 'Director');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u1, t, 'dir', 'Dir', 'x', r_role);
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u2, t, 'ama', 'Ama', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (t, u1, b, true), (t, u2, b, true), (t, u1, b2, false);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  insert into gold.role_permissions (tenant_id, role_id, permission) values (t, r_role, 'discrepancies:review');
  set local role gold_app;

  -- device keys
  perform set_config('app.user_id', u2::text, true);
  perform gold.register_device_key(jsonb_build_object('deviceId', 'dev-12345678', 'publicKey', key1));
  perform gold_test.assert(gold.device_key(u2, 'dev-12345678') = key1, 'key stored');
  perform gold_test.assert(gold.device_key(u2, 'other-device-1') is null, 'unknown device has no key');
  perform gold_test.assert(gold.device_key(u1, 'dev-12345678') is null, 'a key belongs to one person');
  perform gold.register_device_key(jsonb_build_object('deviceId', 'dev-12345678', 'publicKey', key2));
  perform gold_test.assert(gold.device_key(u2, 'dev-12345678') = key2, 'registering again replaces the key');
  perform gold_test.assert(gold_test.code_of($q$select gold.register_device_key('{"deviceId":"x","publicKey":"short"}'::jsonb)$q$) = 'VALIDATION_FAILED', 'bad key refused');

  perform gold_test.assert((gold.sync_author(u2)->>'active')::boolean and (gold.sync_author(u2)->'permissions') ? 'discrepancies:review', 'author lookup gives permissions');
  perform gold_test.assert(gold.sync_author(gen_random_uuid()) is null, 'unknown author is null');

  -- open the day offline (2 hours ago), as the director
  perform set_config('app.user_id', u1::text, true);
  r := gold.sync_apply(jsonb_build_object('id', c_open, 'type', 'day.open', 'deviceId', 'dev-12345678', 'capturedAt', now() - interval '2 hours',
        'payload', jsonb_build_object('id', d1, 'branchId', b, 'businessDate', current_date, 'lines', '{"100":50}'::jsonb, 'capturedAt', now() - interval '2 hours')));
  perform gold_test.assert(r->>'status' = 'applied', 'open day applied: ' || r::text);
  perform gold_test.assert((r->'flags') ? 'offline', 'late entry is flagged offline');
  r := gold.sync_apply(jsonb_build_object('id', c_open, 'type', 'day.open', 'payload', '{}'::jsonb));
  perform gold_test.assert((r->>'replayed')::boolean and r->>'status' = 'applied', 'sending it again is a replay');
  perform gold_test.assert((select count(*) from gold.sync_commands) = 1 and (select count(*) from gold.business_days) = 1, 'once only');

  -- a purchase made by the other person
  perform set_config('app.user_id', u2::text, true);
  r := gold.sync_apply(jsonb_build_object('id', c_tx, 'type', 'transaction.create', 'capturedAt', now() - interval '90 minutes',
        'payload', jsonb_build_object('id', tx, 'branchId', b, 'customer', jsonb_build_object('name', 'Kofi', 'phone', '0244000111'),
          'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
          'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now() - interval '90 minutes', 'priceAsOf', now() - interval '2 hours', 'flags', '[]'::jsonb,
          'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb)))));
  perform gold_test.assert(r->>'status' = 'applied', 'purchase applied: ' || r::text);
  perform gold_test.assert((select user_id from gold.sync_commands where id = c_tx) = u2, 'recorded under the person who made it');
  perform gold_test.assert((select count(*) from gold.transactions where id = tx) = 1, 'the purchase exists');

  -- held: a movement for a day that has not arrived yet (it is in the other branch, opened later)
  r := gold.sync_apply(jsonb_build_object('id', c_held, 'type', 'drawer.movement', 'capturedAt', now() - interval '30 minutes',
        'payload', jsonb_build_object('id', mv_held, 'dayId', d2, 'branchId', b2, 'kind', 'topup', 'note', 'Restock', 'lines', '{"100":5}'::jsonb, 'capturedAt', now() - interval '30 minutes')));
  perform gold_test.assert(r->>'status' = 'held' and r->>'code' = 'NOT_FOUND', 'depends on a missing day: held. ' || r::text);

  -- rejected: the entry itself is wrong
  r := gold.sync_apply(jsonb_build_object('id', c_bad, 'type', 'drawer.movement', 'capturedAt', now() - interval '20 minutes',
        'payload', jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', b, 'kind', 'bogus', 'note', 'x', 'lines', '{"100":1}'::jsonb, 'capturedAt', now() - interval '20 minutes')));
  perform gold_test.assert(r->>'status' = 'rejected' and r->>'code' = 'VALIDATION_FAILED', 'wrong entry: rejected. ' || r::text);

  perform gold_test.assert(gold_test.code_of($q$select gold.sync_apply('{"id":"00000000-0000-0000-0000-000000000001","type":"drop.table","payload":{}}'::jsonb)$q$) = 'VALIDATION_FAILED', 'unknown type refused');

  -- review list
  perform set_config('app.user_id', u1::text, true);
  rv := gold.sync_review_json();
  perform gold_test.assert((rv->>'held')::int = 1 and (rv->>'rejected')::int = 1 and jsonb_array_length(rv->'items') = 2, 'review shows both');
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'sync_review') >= 1, 'managers were told');

  -- retry the held one still fails until the day exists
  r := gold.sync_resolve(jsonb_build_object('id', c_held, 'action', 'retry'));
  perform gold_test.assert(r->>'status' = 'held', 'still held while the day is missing');
  r := gold.sync_apply(jsonb_build_object('id', c_open2, 'type', 'day.open', 'capturedAt', now() - interval '3 hours',
        'payload', jsonb_build_object('id', d2, 'branchId', b2, 'businessDate', current_date, 'lines', '{"100":10}'::jsonb, 'capturedAt', now() - interval '3 hours')));
  perform gold_test.assert(r->>'status' = 'applied', 'the other branch day arrives: ' || r::text);
  -- B51: the server tries waiting entries again by itself when the day they need arrives; no manager has to press anything
  perform gold_test.assert((select status from gold.sync_commands where id = c_held) = 'applied', 'the held movement went in by itself once its day arrived');
  perform gold_test.assert((select created_by from gold.drawer_movements where id = mv_held) = u2, 'the movement is under the person who made it, not whoever sent the opening');
  perform gold_test.assert(gold.current_actor() = u1, 'the current person is unchanged afterwards');
  perform gold_test.assert((select 'auto-retried' = any(flags) and resolved_by is null from gold.sync_commands where id = c_held), 'marked as applied by the server');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.sync_resolve('{"id":"%s","action":"retry"}'::jsonb)$q$, c_held)) = 'ALREADY_RESOLVED', 'nothing left for a manager to retry');

  -- the rejected one: retry fails again, dismiss needs a reason
  r := gold.sync_resolve(jsonb_build_object('id', c_bad, 'action', 'retry'));
  perform gold_test.assert(r->>'status' = 'rejected', 'a wrong entry stays rejected');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.sync_resolve('{"id":"%s","action":"dismiss"}'::jsonb)$q$, c_bad)) = 'VALIDATION_FAILED', 'dismiss needs a reason');
  r := gold.sync_resolve(jsonb_build_object('id', c_bad, 'action', 'dismiss', 'note', 'Typed by mistake on the till'));
  perform gold_test.assert(r->>'status' = 'dismissed', 'dismissed');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.sync_resolve('{"id":"%s","action":"retry"}'::jsonb)$q$, c_bad)) = 'ALREADY_RESOLVED', 'cannot resolve twice');
  rv := gold.sync_review_json();
  perform gold_test.assert((rv->>'held')::int = 0 and (rv->>'rejected')::int = 0 and jsonb_array_length(rv->'recent') = 2, 'review is clear, history kept');
  perform gold_test.assert((select count(*) from gold.audit_events where action in ('sync.retried', 'sync.dismissed')) = 1, 'audited');
  raise notice 'offline sync ok';
end $$;