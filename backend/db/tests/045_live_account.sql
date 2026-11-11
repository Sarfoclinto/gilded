-- B46: "if I closed now" - the live closing account for a branch. Read-only; matches the books and the closing preview.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); other uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); tx1 uuid := gen_random_uuid(); tx2 uuid := gen_random_uuid(); r jsonb; pre jsonb; n bigint;
begin
  insert into gold.tenants (id, slug, name) values (t, 'live', 'Live Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (other, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (u, t, 'ama', 'Ama', 'x', r_role);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);

  r := gold.live_account_json(tkw);
  perform gold_test.assert(r->'day' = 'null'::jsonb and (r->>'closing')::numeric = 0 and (r#>>'{goods,count}')::int = 0, 'before any day it is all zero: ' || r::text);
  perform gold_test.assert(gold_test.code_of(format($q$select gold.live_account_json(%L)$q$, gen_random_uuid())) = 'NOT_FOUND', 'unknown branch');

  perform gold.open_day(jsonb_build_object('id', d1, 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":150,"20":30}'::jsonb, 'capturedAt', now()));
  perform gold.post_transaction(jsonb_build_object('id', tx1, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kwesi'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now() - interval '2 minutes', 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold.issue_loan(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'principal', 500, 'customer', jsonb_build_object('name', 'Kofi', 'phone', '0200000001'),
    'lines', '{"100":5}'::jsonb, 'reason', 'fees', 'collateral', jsonb_build_object('topWeight', '24.5'), 'capturedAt', now()));

  r := gold.live_account_json(tkw);
  pre := gold.closing_preview(d1);
  perform gold_test.assert(r#>>'{day,status}' = 'open', 'the open day');
  -- cash: 150x100 + 30x20 = 15,600, less 1,000 and 500 paid out = 14,100: 1 bundle of 100x100, 35 loose 100s... counts 135 x 100 and 30 x 20
  perform gold_test.assert((r#>>'{cash,total}')::numeric = (pre#>>'{expected,cash,value}')::numeric and (r#>>'{cash,total}')::numeric = 14100, 'cash agrees with the closing preview');
  perform gold_test.assert((r#>>'{cash,notesSound}')::boolean and (r#>>'{cash,bundlesTotal}')::numeric = 10000 and (r#>>'{cash,looseTotal}')::numeric = 4100, 'bundles of 100 notes and the loose rest: ' || (r->'cash')::text);
  perform gold_test.assert((r#>>'{debtTotal}')::numeric = 500 and r#>>'{debtors,0,name}' = 'Kofi' and (r#>>'{debtors,0,amount}')::numeric = 500, 'the debtor');
  perform gold_test.assert((r#>>'{goods,total}')::numeric = (pre#>>'{expected,goodsValue}')::numeric and (r#>>'{goods,count}')::int = 1 and r#>>'{goods,transactions,0,customerName}' = 'Kwesi'
    and (r#>>'{goods,transactions,0,value}')::numeric = 1000 and (r#>>'{goods,broughtForward}')::numeric = 0, 'goods: one purchase, listed with its figures: ' || (r->'goods')::text);
  perform gold_test.assert((r#>>'{goods,transactions,0,top}')::numeric > 0 and (r#>>'{goods,transactions,0,down}')::numeric > 0, 'with top and down');
  perform gold_test.assert((r#>>'{closing}')::numeric = 14100 + 500 + 1000, 'closing balance = cash + debts + goods - owed');

  -- a negative note count (a branch with the note rule off) means no breakdown, only the amount
  perform gold.post_transaction(jsonb_build_object('id', tx2, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Esi'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"20":50}'::jsonb))));
  r := gold.live_account_json(tkw);
  perform gold_test.assert(not (r#>>'{cash,notesSound}')::boolean and r#>'{cash,bundles}' = 'null'::jsonb and (r#>>'{cash,total}')::numeric = 13100, 'unsound notes: amount only: ' || (r->'cash')::text);
  perform gold_test.assert((r#>>'{goods,count}')::int = 2 and r#>>'{goods,transactions,0,customerName}' = 'Esi', 'newest purchase first');

  -- another branch is its own account
  r := gold.live_account_json(other);
  perform gold_test.assert((r#>>'{closing}')::numeric = 0, 'another branch is separate');
  raise notice 'live account ok';
end $$;