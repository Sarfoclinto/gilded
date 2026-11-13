-- B54: global search. One question, answered across what the person may see.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid(); r_role uuid := gen_random_uuid();
  u uuid := gen_random_uuid(); boss uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); tx_ama uuid := gen_random_uuid(); tx_kwesi uuid := gen_random_uuid(); tx_ama2 uuid := gen_random_uuid();
  trf uuid := gen_random_uuid(); cat uuid := gen_random_uuid(); art uuid := gen_random_uuid(); items uuid[];
  r jsonb; g jsonb; ref_ama text; ref_trf text; x text;
  all_groups jsonb := '["customers","purchases","debts","held","transfers","payments","users","branches","guide"]'::jsonb;
  -- one group of the answer, by key (null when it found nothing)
  q text;
begin
  insert into gold.tenants (id, slug, name) values (t, 'gsearch', 'Search Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.role_permissions (tenant_id, role_id, permission) select t, r_role, p from unnest(array['transfers:read', 'transfers:create', 'guide:manage']) p;
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id, phone) values
    (u, t, 'esi', 'Esi Teller', 'x', r_role, '0209998887'), (boss, t, 'boss', 'Yaw Boateng', 'x', r_role, null);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, u, tkw), (t, boss, tkw);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', u::text, true);

  perform gold.open_day(jsonb_build_object('id', d1, 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":300}'::jsonb, 'capturedAt', now()));
  perform gold.post_transaction(jsonb_build_object('id', tx_ama, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Ama Serwaa', 'phone', '0244 123 456'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '1000', 'calculatedAmount', '1000', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 1000, 'difference', 0, 'capturedAt', now() - interval '3 hours', 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000, 'lines', '{"100":10}'::jsonb))));
  perform gold.post_transaction(jsonb_build_object('id', tx_kwesi, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kwesi Mensah', 'phone', '+233201112223'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '8605', 'calculatedAmount', '8605', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 8605, 'difference', 0, 'capturedAt', now() - interval '2 hours', 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 8000, 'lines', '{"100":80}'::jsonb),
                                  jsonb_build_object('method', 'mobile_money', 'amount', 605, 'paidByBranchId', ksi, 'externalRef', 'MM-778899'))));
  perform gold.post_transaction(jsonb_build_object('id', tx_ama2, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Ama Serwaa', 'phone', '0244 123 456'),
    'items', jsonb_build_array(gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '2500', 'calculatedAmount', '2500', 'policy', 'down',
    'strategy', 'fewest-notes', 'payable', 2500, 'difference', 0, 'capturedAt', now() - interval '1 hour', 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 2500, 'lines', '{"100":25}'::jsonb))));
  perform gold.issue_loan(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'principal', 500, 'customer', jsonb_build_object('name', 'Kofi Annan', 'phone', '0271234567'),
    'lines', '{"100":5}'::jsonb, 'reason', 'school fees', 'collateral', jsonb_build_object('topWeight', '24.5', 'description', 'two nuggets'), 'capturedAt', now()));
  select array_agg(id) into items from gold.transaction_items where transaction_id = tx_ama;
  perform gold.create_transfer(jsonb_build_object('id', trf, 'kind', 'goods', 'originBranchId', tkw, 'destinationBranchId', ksi, 'purpose', 'stock_collection',
    'method', 'staff_travelling', 'itemIds', to_jsonb(items)), array[tkw]);
  perform gold.transfer_edit(trf, jsonb_build_object('collector', jsonb_build_object('type', 'external', 'name', 'Mr Owusu', 'phone', '024', 'idType', 'Ghana card', 'idNumber', 'GHA-1')), array[tkw]);
  perform gold.guide_save_category(jsonb_build_object('id', cat, 'name', 'Customers'));
  perform gold.guide_save_article(jsonb_build_object('id', art, 'categoryId', cat, 'title', 'Never share customer details', 'kind', 'dos_donts', 'blocks', '[{"type":"heading","text":"Privacy"}]'::jsonb));
  perform gold.guide_publish(art);
  select reference into ref_ama from gold.transactions where id = tx_ama;
  select reference into ref_trf from gold.transfers where id = trf;

  -- too little typed: nothing
  r := gold.global_search(jsonb_build_object('q', 'a', 'scope', jsonb_build_array(tkw), 'groups', all_groups));
  perform gold_test.assert(jsonb_array_length(r->'groups') = 0, 'one letter finds nothing');

  -- a name: the customer first, with what a teller needs to recognise her; her purchases too
  r := gold.global_search(jsonb_build_object('q', 'Ama', 'scope', jsonb_build_array(tkw), 'groups', all_groups));
  g := (select e from jsonb_array_elements(r->'groups') e where e->>'key' = 'customers');
  perform gold_test.assert(g#>>'{items,0,name}' = 'Ama Serwaa' and (g#>>'{items,0,purchases}')::int = 2 and (g#>>'{items,0,lastAmount}')::numeric = 2500 and g#>>'{items,0,phone}' = '0244123456',
    'customer found with her figures: ' || g::text);
  g := (select e from jsonb_array_elements(r->'groups') e where e->>'key' = 'purchases');
  perform gold_test.assert((g->>'total')::int = 2 and (g#>>'{items,0,amount}')::numeric = 2500 and (g#>>'{items,0,top}')::numeric = 7.77 and g#>>'{items,0,branch}' = 'Tarkwa',
    'her purchases, newest first, with weights: ' || g::text);
  perform gold_test.assert(r->'groups'->0->>'key' = 'customers', 'groups come in a fixed order, customers first');

  -- words in any order, any case
  r := gold.global_search(jsonb_build_object('q', 'SERWAA  ama', 'scope', jsonb_build_array(tkw), 'groups', '["customers"]'::jsonb));
  perform gold_test.assert(r#>>'{groups,0,items,0,name}' = 'Ama Serwaa', 'words in any order');
  -- a word and part of the phone together
  r := gold.global_search(jsonb_build_object('q', 'ama 0244', 'scope', jsonb_build_array(tkw), 'groups', '["customers"]'::jsonb));
  perform gold_test.assert(r#>>'{groups,0,items,0,name}' = 'Ama Serwaa', 'name and phone together');

  -- phone numbers by their digits, whatever the format
  foreach q in array array['0244123456', '+233 244 123 456', '244-123-456', '0244 12'] loop
    r := gold.global_search(jsonb_build_object('q', q, 'scope', jsonb_build_array(tkw), 'groups', '["customers","purchases"]'::jsonb));
    perform gold_test.assert(r#>>'{groups,0,key}' = 'customers' and r#>>'{groups,0,items,0,name}' = 'Ama Serwaa', format('phone "%s" finds Ama: %s', q, r::text));
  end loop;
  r := gold.global_search(jsonb_build_object('q', '0201112223', 'scope', jsonb_build_array(tkw), 'groups', '["customers"]'::jsonb));
  perform gold_test.assert(r#>>'{groups,0,items,0,name}' = 'Kwesi Mensah', 'a number saved with +233 is found by its local form');

  -- a slightly misspelt name is still found, marked as a close match
  r := gold.global_search(jsonb_build_object('q', 'kwezi mensa', 'scope', jsonb_build_array(tkw), 'groups', '["customers"]'::jsonb));
  perform gold_test.assert(r#>>'{groups,0,items,0,name}' = 'Kwesi Mensah' and (r#>>'{groups,0,items,0,close}')::boolean, 'misspelt name: ' || r::text);

  -- a receipt number, exact and in part
  r := gold.global_search(jsonb_build_object('q', lower(ref_ama), 'scope', jsonb_build_array(tkw), 'groups', all_groups));
  g := (select e from jsonb_array_elements(r->'groups') e where e->>'key' = 'purchases');
  perform gold_test.assert((g->>'total')::int = 1 and (g#>>'{items,0,score}')::int = 100 and g#>>'{items,0,reference}' = ref_ama, 'exact receipt number: ' || r::text);
  r := gold.global_search(jsonb_build_object('q', right(ref_ama, 4), 'scope', jsonb_build_array(tkw), 'groups', '["purchases"]'::jsonb));
  perform gold_test.assert(exists (select 1 from jsonb_array_elements(r#>'{groups,0,items}') i where i->>'reference' = ref_ama), 'the last digits of a receipt number');

  -- a number is also tried as an amount
  r := gold.global_search(jsonb_build_object('q', '8,605', 'scope', jsonb_build_array(tkw), 'groups', '["purchases"]'::jsonb));
  perform gold_test.assert(r#>>'{groups,0,items,0,customerName}' = 'Kwesi Mensah', 'found by the amount paid: ' || r::text);

  -- only the person's branches, only the groups they may search
  r := gold.global_search(jsonb_build_object('q', 'ama', 'scope', jsonb_build_array(ksi), 'groups', all_groups));
  perform gold_test.assert(not exists (select 1 from jsonb_array_elements(r->'groups') e where e->>'key' = 'purchases'), 'purchases of another branch are not found');
  r := gold.global_search(jsonb_build_object('q', 'ama', 'scope', jsonb_build_array(tkw), 'groups', '["purchases"]'::jsonb));
  perform gold_test.assert(jsonb_array_length(r->'groups') = 1 and r#>>'{groups,0,key}' = 'purchases', 'only the groups asked for');
  x := gold_test.code_of(format($q$select gold.global_search(jsonb_build_object('q', 'ama', 'scope', jsonb_build_array('%s'::uuid), 'groups', '["purchases"]'::jsonb, 'group', 'users'))$q$, tkw));
  perform gold_test.assert(x = 'FORBIDDEN', 'cannot ask for more of a group that is not allowed: ' || x);

  -- "more" of one group
  r := gold.global_search(jsonb_build_object('q', 'ama', 'scope', jsonb_build_array(tkw), 'groups', all_groups, 'group', 'purchases', 'limit', 1));
  perform gold_test.assert(jsonb_array_length(r->'groups') = 1 and jsonb_array_length(r#>'{groups,0,items}') = 1 and (r#>>'{groups,0,total}')::int = 2, 'one group, limited, with the full count');

  -- the other groups
  r := gold.global_search(jsonb_build_object('q', 'kofi', 'scope', jsonb_build_array(tkw), 'groups', all_groups));
  g := (select e from jsonb_array_elements(r->'groups') e where e->>'key' = 'debts');
  perform gold_test.assert(g#>>'{items,0,name}' = 'Kofi Annan' and (g#>>'{items,0,outstanding}')::numeric = 500 and g#>>'{items,0,reason}' = 'school fees', 'the loan: ' || r::text);
  g := (select e from jsonb_array_elements(r->'groups') e where e->>'key' = 'held');
  perform gold_test.assert((g#>>'{items,0,topWeight}')::numeric = 24.5 and g#>>'{items,0,status}' = 'held', 'gold held as security: ' || r::text);
  g := (select e from jsonb_array_elements(r->'groups') e where e->>'key' = 'customers');
  perform gold_test.assert((g#>>'{items,0,owes}')::numeric = 500, 'the customer shows what he owes: ' || g::text);
  r := gold.global_search(jsonb_build_object('q', 'kofi', 'scope', jsonb_build_array(tkw), 'groups', '["customers"]'::jsonb));
  perform gold_test.assert(r#>'{groups,0,items,0,owes}' = 'null'::jsonb, 'what he owes is not shown to someone who may not see debts');

  r := gold.global_search(jsonb_build_object('q', ref_trf, 'scope', jsonb_build_array(ksi), 'groups', all_groups));
  g := (select e from jsonb_array_elements(r->'groups') e where e->>'key' = 'transfers');
  perform gold_test.assert(g#>>'{items,0,reference}' = ref_trf and g#>>'{items,0,from}' = 'Tarkwa' and g#>>'{items,0,to}' = 'Kumasi', 'a transfer, seen from the receiving branch: ' || r::text);
  r := gold.global_search(jsonb_build_object('q', 'owusu', 'scope', jsonb_build_array(tkw), 'groups', '["transfers"]'::jsonb));
  perform gold_test.assert(r#>>'{groups,0,items,0,collector}' = 'Mr Owusu', 'a transfer by its collector');

  r := gold.global_search(jsonb_build_object('q', 'mm-778899', 'scope', jsonb_build_array(ksi), 'groups', all_groups));
  g := (select e from jsonb_array_elements(r->'groups') e where e->>'key' = 'payments');
  perform gold_test.assert((g#>>'{items,0,amount}')::numeric = 605 and g#>>'{items,0,customerName}' = 'Kwesi Mensah' and (g#>>'{items,0,score}')::int = 100, 'mobile money by its reference, for the branch that sends it: ' || r::text);

  r := gold.global_search(jsonb_build_object('q', 'boateng', 'scope', jsonb_build_array(tkw), 'groups', all_groups));
  perform gold_test.assert(r#>>'{groups,0,key}' = 'users' and r#>>'{groups,0,items,0,username}' = 'boss' and r#>>'{groups,0,items,0,role}' = 'Teller', 'a user: ' || r::text);
  r := gold.global_search(jsonb_build_object('q', 'tark', 'scope', jsonb_build_array(tkw), 'groups', '["branches"]'::jsonb));
  perform gold_test.assert(r#>>'{groups,0,items,0,code}' = 'TKW', 'a branch');
  r := gold.global_search(jsonb_build_object('q', 'share customer', 'scope', jsonb_build_array(tkw), 'groups', '["guide"]'::jsonb));
  perform gold_test.assert(r#>>'{groups,0,items,0,title}' = 'Never share customer details', 'a guide article: ' || r::text);

  -- typed signs that mean something to the database are just text here
  r := gold.global_search(jsonb_build_object('q', '100%_', 'scope', jsonb_build_array(tkw), 'groups', all_groups));
  perform gold_test.assert(jsonb_array_length(r->'groups') = 0, 'percent and underscore are plain characters');
  r := gold.global_search(jsonb_build_object('q', E'o''brien\\', 'scope', jsonb_build_array(tkw), 'groups', all_groups));
  perform gold_test.assert(jsonb_array_length(r->'groups') = 0, 'quotes and backslashes do no harm');
  raise notice 'global search ok';
end $$;