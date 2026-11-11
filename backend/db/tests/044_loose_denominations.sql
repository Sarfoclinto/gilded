-- B44: the per-branch note-by-note switch. Off for a branch = opening/closing match on the TOTAL only; every other branch is unchanged.
do $$
declare
  t uuid := gen_random_uuid(); b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid(); r_role uuid := gen_random_uuid(); dir uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); d3 uuid := gen_random_uuid(); d4 uuid := gen_random_uuid(); r jsonb; n int;
  conf jsonb := jsonb_build_object('accepted', true, 'version', 'v3', 'text', 'I confirm that I have physically verified everything reported.');
  decl_ok jsonb := jsonb_build_object('cash', '{"100":9,"50":2}'::jsonb, 'goodsTop', '0', 'goodsDown', '0', 'goodsValue', '0', 'debt', '0', 'payable', '0', 'custodyTop', '0');
begin
  insert into gold.tenants (id, slug, name) values (t, 'loose', 'Loose');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (b1, t, 'AAA', 'Strict', false), (b2, t, 'BBB', 'Loose', false);
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'director', 'Director');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (dir, t, 'dir', 'Dir', 'x', r_role);
  set local role gold_app;
  perform set_config('app.user_id', dir::text, true);

  perform gold_test.assert(gold.setting('drawer.looseBranches') = '[]'::jsonb, 'nobody is loose by default');
  perform gold_test.assert(not gold.denominations_loose(b2), 'so every branch is strict');
  perform gold_test.assert(gold_test.code_of($q$select gold.set_settings('{"drawer.looseBranches":"x"}'::jsonb)$q$) = 'VALIDATION_FAILED', 'must be a list');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.set_settings('{"drawer.looseBranches":["%s"]}'::jsonb)$q$, gen_random_uuid())) = 'VALIDATION_FAILED', 'only real branches');
  perform gold.set_settings(jsonb_build_object('drawer.looseBranches', jsonb_build_array(b2)));
  perform gold_test.assert(gold.denominations_loose(b2) and not gold.denominations_loose(b1), 'only the chosen branch is loose');

  -- first counts (both branches hold GHS 1,000 as 9x100 + 2x50)
  perform gold.open_day(jsonb_build_object('id', d1, 'branchId', b1, 'businessDate', current_date - 3, 'lines', '{"100":9,"50":2}'::jsonb, 'capturedAt', now()));
  perform gold.open_day(jsonb_build_object('id', d2, 'branchId', b2, 'businessDate', current_date - 3, 'lines', '{"100":9,"50":2}'::jsonb, 'capturedAt', now()));

  -- closing with the same total but different notes (10x100, 0x50 would be 1000): strict needs a reason, loose does not
  decl_ok := jsonb_set(decl_ok, '{cash}', '{"100":10}'::jsonb);
  perform gold_test.assert(gold_test.code_of(format($f$select gold.close_day(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'dayId', d1, 'branchId', b1,
    'declared', decl_ok, 'confirmation', conf, 'capturedAt', now()))) = 'EXPLANATION_REQUIRED', 'strict branch: different notes still need a reason');
  r := gold.close_day(jsonb_build_object('id', gen_random_uuid(), 'dayId', d2, 'branchId', b2, 'declared', decl_ok, 'confirmation', conf, 'capturedAt', now()));
  perform gold_test.assert(r#>>'{data,status}' = 'closed' and r#>>'{data,closing,signoff,status}' = 'not_required', 'loose branch: same total closes with no reason and no sign-off: ' || r::text);
  perform gold_test.assert((select cash_lines->>'100' from gold.branch_balance(b2)) = '10' and (select cash_lines->>'50' from gold.branch_balance(b2)) is null, 'the notes in the books now match the count');
  perform gold_test.assert((select detail->>'50' from gold.day_reconciliations where business_day_id = d2 and phase = 'closing' and asset = 'cash') = '-2', 'the note difference is kept on the day for the manager');

  -- a different TOTAL still needs a reason in a loose branch (reopen another day and short it)
  perform gold.open_day(jsonb_build_object('id', d3, 'branchId', b2, 'businessDate', current_date - 2, 'lines', '{"100":10}'::jsonb, 'capturedAt', now()));
  perform gold_test.assert(gold_test.code_of(format($f$select gold.close_day(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'dayId', d3, 'branchId', b2,
    'declared', jsonb_set(decl_ok, '{cash}', '{"100":9}'::jsonb), 'confirmation', conf, 'capturedAt', now()))) = 'EXPLANATION_REQUIRED', 'loose branch: a different total needs a reason');
  r := gold.close_day(jsonb_build_object('id', gen_random_uuid(), 'dayId', d3, 'branchId', b2, 'declared', jsonb_set(decl_ok, '{cash}', '{"100":9}'::jsonb),
    'explanations', jsonb_build_object('cash', 'one hundred cedis short'), 'confirmation', conf, 'capturedAt', now()));
  perform gold_test.assert(r#>>'{data,closing,signoff,status}' = 'pending', 'and goes to sign-off as before');

  -- opening: loose branch, same total in other notes, no reason needed; strict branch asks for one
  perform gold_test.assert(gold_test.code_of(format($f$select gold.open_day(%L::jsonb)$f$, jsonb_build_object('id', gen_random_uuid(), 'branchId', b1, 'businessDate', current_date - 2,
    'lines', '{"100":8,"50":4}'::jsonb, 'capturedAt', now()))) is not null, 'strict branch: other notes are refused without a reason');
  r := gold.open_day(jsonb_build_object('id', d4, 'branchId', b2, 'businessDate', current_date - 1, 'lines', '{"50":18}'::jsonb, 'capturedAt', now()));
  perform gold_test.assert(r#>>'{data,status}' = 'open', 'loose branch: opened with the same total in other notes');
  perform gold_test.assert((select cash_lines->>'50' from gold.branch_balance(b2)) = '18', 'and the books follow the count');
  raise notice 'loose denominations ok';
end $$;