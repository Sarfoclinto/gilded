-- A customer was paid, then wants a 200 note changed into two 100s.
do $$
declare
  t uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); tx uuid := gen_random_uuid(); r jsonb; bal record;
begin
  insert into gold.tenants (id, slug, name) values (t, 'exch', 'Exchange');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (b, t, 'TKW', 'Tarkwa', true, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'ama', 'Ama', 'x', r_role);
  insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary) values (t, u, b, true);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);
  perform gold.open_day(jsonb_build_object('id', d1, 'branchId', b, 'businessDate', current_date, 'lines', '{"200":10,"100":20}'::jsonb, 'capturedAt', now() - interval '2 hours'));
  perform gold.post_transaction(jsonb_build_object('id', tx, 'branchId', b, 'customer', jsonb_build_object('name', 'Kwesi'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now() - interval '1 hour', 'priceAsOf', now() - interval '2 hours', 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"200":5}'::jsonb))));

  r := gold.record_exchange(jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', b, 'transactionId', tx,
    'gave', '{"200":1}'::jsonb, 'took', '{"100":2}'::jsonb, 'capturedAt', now()));
  perform gold_test.assert(r#>>'{data,kind}' = 'exchange' and r#>'{data,exchange,gave}' = '{"200": 1}'::jsonb and r#>'{data,exchange,took}' = '{"100": 2}'::jsonb, 'recorded both sides: ' || r::text);
  perform gold_test.assert((r#>>'{data,note}') like 'Notes changed for TKW-%', 'names the purchase');
  select * into bal from gold.branch_balance(b);
  -- 10 x 200 + 20 x 100 = 4000; paid 5 x 200 (-1000) = 3000; exchange +200 -200 = same value
  perform gold_test.assert(bal.cash_value = 3000 and (bal.cash_lines->>'200')::int = 6 and (bal.cash_lines->>'100')::int = 18, 'drawer by note: ' || bal.cash_lines::text);

  perform gold_test.assert(gold_test.code_of(format($f$select gold.record_exchange(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', b,
    'gave', '{"200":1}'::jsonb, 'took', '{"100":1}'::jsonb, 'capturedAt', now()))) = 'EXCHANGE_MISMATCH', 'must be worth the same');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.record_exchange(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', b,
    'gave', '{"100":2}'::jsonb, 'took', '{"100":1,"50":2}'::jsonb, 'capturedAt', now()))) = 'EXCHANGE_SAME_NOTE', 'must be different notes');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.record_exchange(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', b,
    'gave', '{"200":1}'::jsonb, 'capturedAt', now()))) = 'VALIDATION_FAILED', 'both sides are needed');
  perform gold_test.assert(gold_test.code_of(format($f$select gold.record_exchange(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', b, 'transactionId', gen_random_uuid(),
    'gave', '{"200":1}'::jsonb, 'took', '{"100":2}'::jsonb, 'capturedAt', now()))) = 'NOT_FOUND', 'an unknown purchase is refused');
  perform gold_test.assert((gold.record_exchange(jsonb_build_object('id', (r#>>'{data,id}')::uuid, 'dayId', d1, 'branchId', b, 'gave', '{"200":1}'::jsonb, 'took', '{"100":2}'::jsonb, 'capturedAt', now()))->>'replayed')::boolean, 'sending it twice records it once');
  select * into bal from gold.branch_balance(b);
  perform gold_test.assert((bal.cash_lines->>'200')::int = 6, 'and the drawer is unchanged by the repeat');
end $$;