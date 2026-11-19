-- B74: Group Sheets. Members only (no company role opens a group), branch rules, per-sheet narrowing, entries that are never edited,
-- taking back, entries written before a removal, the last keeper, and a group left with no keeper.
do $$
declare
  t uuid := gen_random_uuid(); ba uuid := gen_random_uuid(); bb uuid := gen_random_uuid();
  r_dir uuid := gen_random_uuid(); r_mgr uuid := gen_random_uuid(); r_tel uuid := gen_random_uuid();
  dir uuid := gen_random_uuid(); mgr uuid := gen_random_uuid(); t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t3 uuid := gen_random_uuid();
  g uuid := gen_random_uuid(); kitchen uuid := gen_random_uuid(); savings uuid := gen_random_uuid();
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); r jsonb; n int;
begin
  insert into gold.tenants (id, slug, name) values (t, 'gsheets', 'Group sheets');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (ba, t, 'ANY', 'Anyanso', true), (bb, t, 'TKW', 'Tarkwa', false);
  insert into gold.roles (id, tenant_id, key, name) values (r_dir, t, 'director', 'Director'), (r_mgr, t, 'manager', 'Manager'), (r_tel, t, 'teller', 'Teller');
  insert into gold.role_permissions (tenant_id, role_id, permission) values
    (t, r_dir, 'groups:create'), (t, r_dir, 'users:manage'), (t, r_dir, 'branches:all'), (t, r_dir, 'settings:manage'), (t, r_mgr, 'groups:create');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values
    (dir, t, 'dir', 'Director Dee', 'x', r_dir), (mgr, t, 'mgr', 'Manager Mo', 'x', r_mgr),
    (t1, t, 't1', 'Ama', 'x', r_tel), (t2, t, 't2', 'Kofi', 'x', r_tel), (t3, t, 't3', 'Esi', 'x', r_tel);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, dir, ba), (t, mgr, ba), (t, t1, ba), (t, t2, ba), (t, t3, bb);
  set local role gold_app;

  -- 1. who may create a group
  perform set_config('app.user_id', t1::text, true);
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('group_create', '{"name":"x"}')$q$)) = 'FORBIDDEN', 'a teller may not create a group');
  perform gold_test.assert((gold.group_sheets('home', '{}')->>'canCreate')::boolean = false, 'and is told so');
  perform set_config('app.user_id', mgr::text, true);
  r := gold.group_sheets('group_create', jsonb_build_object('id', g, 'name', '  Anyanso   staff '));
  perform gold_test.assert(r->>'name' = 'Anyanso staff' and r->>'myRole' = 'keeper', 'the creator is the first keeper: ' || r::text);
  perform gold.group_sheets('group_create', jsonb_build_object('id', g, 'name', 'Anyanso staff'));
  perform gold_test.assert((select count(*) from gold.gs_groups) = 1, 'creating twice with the same id makes one group');

  -- 2. the director sees nothing, even with branches:all and users:manage
  perform set_config('app.user_id', dir::text, true);
  perform gold_test.assert(jsonb_array_length(gold.group_sheets('home', '{}')->'groups') = 0 and jsonb_array_length(gold.group_sheets('home', '{}')->'needKeeper') = 0, 'not in the director''s list');
  perform gold_test.assert((select count(*) from gold.gs_groups) = 0, 'not even its name, read directly');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('group_get', '{"groupId":"%s"}')$q$, g)) = 'NOT_FOUND', 'opening it says not found');

  -- 3. everyone at Anyanso as writers; keepers only by name
  perform set_config('app.user_id', mgr::text, true);
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('rule_set', '{"groupId":"%s","branchId":"%s","role":"keeper"}')$q$, g, ba)) = 'VALIDATION_FAILED', 'no keepers by branch');
  r := gold.group_sheets('rule_set', jsonb_build_object('groupId', g, 'branchId', ba, 'role', 'writer'));
  perform gold_test.assert((select count(*) from jsonb_array_elements(r->'members') m where m->>'how' = 'branch' and m->>'role' = 'writer') = 3,
    'Ama, Kofi and the director (who works at Anyanso) come in as writers: ' || (r->'members')::text);
  perform gold_test.assert(gold.gs_role_of(g, t3) is null, 'Esi at Tarkwa does not');
  -- the director is in now only because he works at Anyanso: leave him out
  r := gold.group_sheets('member_remove', jsonb_build_object('groupId', g, 'userId', dir));
  perform gold_test.assert(gold.gs_role_of(g, dir) is null and jsonb_array_length(r->'leftOut') = 1, 'one person can be left out of a branch rule');

  -- 4. a sheet with an opening balance, entries, sending twice
  r := gold.group_sheets('sheet_create', jsonb_build_object('groupId', g, 'id', kitchen, 'name', 'Kitchen fees', 'branchId', ba, 'openingBalance', '100'));
  perform gold_test.assert((r->>'balance')::numeric = 100, 'opening balance: ' || r::text);
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('sheet_create', '{"groupId":"%s","name":"kitchen FEES"}')$q$, g)) = 'NAME_IN_USE', 'names are unique in a group');
  perform set_config('app.user_id', t1::text, true);
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('sheet_create', '{"groupId":"%s","name":"Mine"}')$q$, g)) = 'FORBIDDEN', 'only keepers make sheets');
  perform gold.group_sheets('entry_add', jsonb_build_object('id', e1, 'sheetId', kitchen, 'direction', 'in', 'amount', '50', 'dayTotal', true));
  perform gold.group_sheets('entry_add', jsonb_build_object('id', e1, 'sheetId', kitchen, 'direction', 'in', 'amount', '50', 'dayTotal', true));
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('entry_add', '{"id":"%s","sheetId":"%s","direction":"in","amount":"0"}')$q$, gen_random_uuid(), kitchen)) = 'VALIDATION_FAILED', 'zero refused');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('entry_add', '{"id":"%s","sheetId":"%s","direction":"in","amount":"1.234"}')$q$, gen_random_uuid(), kitchen)) = 'VALIDATION_FAILED', 'no fractions of a pesewa');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('entry_add', '{"id":"%s","sheetId":"%s","direction":"in","amount":"5","moneyDate":"2999-01-01"}')$q$, gen_random_uuid(), kitchen)) = 'VALIDATION_FAILED', 'no future dates');
  perform set_config('app.user_id', t2::text, true);
  perform gold.group_sheets('entry_add', jsonb_build_object('id', e2, 'sheetId', kitchen, 'direction', 'out', 'amount', '20.50', 'note', '  Gas   refill '));
  r := gold.group_sheets('sheet_get', jsonb_build_object('sheetId', kitchen));
  perform gold_test.assert((r->>'balance')::numeric = 129.5 and (r->>'todayIn')::numeric = 50 and (r->>'todayOut')::numeric = 20.5, 'balance 100 + 50 - 20.50, sent twice kept once: ' || r::text);
  perform gold_test.assert(jsonb_array_length(r->'days') = 1 and (r#>>'{days,0,closing}')::numeric = 129.5 and jsonb_array_length(r#>'{days,0,entries}') = 2, 'one day, closing 129.50');
  perform gold_test.assert((select bool_or(e->>'note' = 'Gas refill') from jsonb_array_elements(r#>'{days,0,entries}') e), 'notes are tidied');

  -- 5. entries are never changed or deleted
  perform gold_test.assert(gold_test.fails(format('update gold.gs_entries set amount = 1 where id = %L', e2)), 'an entry cannot be edited');
  perform gold_test.assert(gold_test.fails(format('delete from gold.gs_entries where id = %L', e2)), 'or deleted');

  -- 6. readers look; writers can't add to a sheet narrowed to see-only
  perform set_config('app.user_id', mgr::text, true);
  perform gold.group_sheets('member_set', jsonb_build_object('groupId', g, 'userId', t3, 'role', 'reader'));
  perform set_config('app.user_id', t3::text, true);
  perform gold_test.assert((gold.group_sheets('sheet_get', jsonb_build_object('sheetId', kitchen))->>'access') = 'read', 'a reader sees');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('entry_add', '{"id":"%s","sheetId":"%s","direction":"in","amount":"5"}')$q$, gen_random_uuid(), kitchen)) = 'FORBIDDEN', 'but cannot add');
  perform gold_test.assert((select count(*) from gold.notifications where user_id = t3 and kind = 'group_added') = 1, 'and was told they were added');

  -- 7. savings: hidden from everyone but Ama
  perform set_config('app.user_id', mgr::text, true);
  perform gold.group_sheets('sheet_create', jsonb_build_object('groupId', g, 'id', savings, 'name', 'Savings'));
  perform gold.group_sheets('access_set', jsonb_build_object('sheetId', savings, 'access', 'none'));
  perform gold.group_sheets('access_set', jsonb_build_object('sheetId', savings, 'userId', t1, 'access', 'write'));
  perform set_config('app.user_id', t2::text, true);
  perform gold_test.assert((select count(*) from gold.gs_sheets) = 1, 'Kofi sees only Kitchen fees');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('sheet_get', '{"sheetId":"%s"}')$q$, savings)) = 'NOT_FOUND', 'Savings does not exist for him');
  perform set_config('app.user_id', t1::text, true);
  perform gold_test.assert((select count(*) from gold.gs_sheets) = 2, 'Ama sees both');
  perform set_config('app.user_id', t3::text, true);
  perform gold_test.assert((select count(*) from gold.gs_sheets) = 1, 'a narrowed "write" never makes a reader a writer, and everyone-none hides it');

  -- 8. taking back
  perform set_config('app.user_id', t2::text, true);
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('entry_take_back', '{"entryId":"%s"}')$q$, e1)) = 'FORBIDDEN', 'a writer cannot take back someone else''s entry');
  perform set_config('app.user_id', t1::text, true);
  r := gold.group_sheets('entry_take_back', jsonb_build_object('entryId', e1));
  perform gold_test.assert(r#>>'{takenBack,by,displayName}' = 'Ama', 'taken back by Ama: ' || r::text);
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('entry_take_back', '{"entryId":"%s"}')$q$, e1)) = 'ALREADY_TAKEN_BACK', 'only once');
  r := gold.group_sheets('sheet_get', jsonb_build_object('sheetId', kitchen));
  perform gold_test.assert((r->>'balance')::numeric = 79.5 and (r#>>'{days,0,in}')::numeric = 0 and (r#>>'{days,0,out}')::numeric = 20.5
    and jsonb_array_length(r#>'{days,0,entries}') = 3 and (r->>'todayIn')::numeric = 0, 'the balance is put right, the pair stays in the history but not in the day''s in and out: ' || (r->'days')::text);

  -- 9. the director still sees no figures
  perform set_config('app.user_id', dir::text, true);
  perform gold_test.assert((select count(*) from gold.gs_entries) = 0 and (select count(*) from gold.gs_sheets) = 0 and (select count(*) from gold.gs_events) = 0, 'no entries, sheets or log for the director');

  -- 10. removed, with an entry written before the removal still on the device
  perform set_config('app.user_id', mgr::text, true);
  perform gold.group_sheets('member_remove', jsonb_build_object('groupId', g, 'userId', t2));
  perform set_config('app.user_id', t2::text, true);
  perform gold_test.assert((select count(*) from gold.gs_sheets) = 0, 'Kofi sees nothing now');
  r := gold.group_sheets('entry_add', jsonb_build_object('id', gen_random_uuid(), 'sheetId', kitchen, 'direction', 'in', 'amount', '10', 'writtenAt', (now() - interval '1 hour')::text));
  perform gold_test.assert((r->>'afterRemoval')::boolean, 'written before the removal: accepted and marked: ' || r::text);
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('entry_add', '{"id":"%s","sheetId":"%s","direction":"in","amount":"10"}')$q$, gen_random_uuid(), kitchen)) = 'FORBIDDEN', 'written after it: refused');
  perform set_config('app.user_id', mgr::text, true);
  perform gold_test.assert((gold.group_sheets('sheet_get', jsonb_build_object('sheetId', kitchen))->>'balance')::numeric = 89.5, 'the late entry counts');
  perform gold_test.assert(exists (select 1 from jsonb_array_elements(gold.group_sheets('activity', jsonb_build_object('groupId', g))) a where a->>'kind' = 'entry_after_removal'), 'and is in the log');

  -- 11. the last keeper
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('leave', '{"groupId":"%s"}')$q$, g)) = 'LAST_KEEPER', 'the last keeper cannot leave');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('member_set', '{"groupId":"%s","userId":"%s","role":"writer"}')$q$, g, mgr)) = 'LAST_KEEPER', 'or step down');
  perform gold.group_sheets('member_set', jsonb_build_object('groupId', g, 'userId', t1, 'role', 'keeper'));
  perform gold.group_sheets('member_set', jsonb_build_object('groupId', g, 'userId', mgr, 'role', 'writer'));
  perform gold_test.assert(gold.gs_role_of(g, t1) = 'keeper' and gold.gs_role_of(g, mgr) = 'writer', 'after making someone else keeper');

  -- 12. the keeper's account is switched off: the group needs a keeper, and only that is shown to people who manage people
  reset role;
  update gold.users set is_active = false where id = t1;
  set local role gold_app;
  perform gold_test.assert((select count(*) from gold.notifications where user_id = dir and kind = 'group_needs_keeper') = 1, 'the director is told');
  perform set_config('app.user_id', dir::text, true);
  r := gold.group_sheets('home', '{}');
  perform gold_test.assert(jsonb_array_length(r->'needKeeper') = 1 and r#>>'{needKeeper,0,name}' = 'Anyanso staff' and jsonb_array_length(r->'groups') = 0, 'named, with its people: ' || r::text);
  perform gold_test.assert((select count(*) from gold.gs_sheets) = 0 and (select count(*) from gold.gs_entries) = 0, 'still no sheets or figures');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('name_keeper', '{"groupId":"%s","userId":"%s"}')$q$, g, t2)) = 'VALIDATION_FAILED', 'the new keeper must be in the group');
  r := gold.group_sheets('name_keeper', jsonb_build_object('groupId', g, 'userId', mgr));
  perform gold_test.assert(jsonb_array_length(r->'needKeeper') = 0 and (select count(*) from gold.gs_groups) = 0, 'once named, the group is gone from the director again');
  perform set_config('app.user_id', mgr::text, true);
  perform gold_test.assert(gold.gs_role_of(g, mgr) = 'keeper' and exists (select 1 from gold.gs_events where kind = 'keeper_named' and actor = dir), 'Mo is keeper, and the log says who named him');

  -- 13. closing a sheet; deleting only an empty one
  perform gold.group_sheets('sheet_update', jsonb_build_object('sheetId', kitchen, 'closed', true));
  perform set_config('app.user_id', t3::text, true);
  perform set_config('app.user_id', mgr::text, true);
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('entry_add', '{"id":"%s","sheetId":"%s","direction":"in","amount":"5"}')$q$, gen_random_uuid(), kitchen)) = 'FORBIDDEN', 'a closed sheet takes no entries');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.group_sheets('sheet_delete', '{"sheetId":"%s"}')$q$, kitchen)) = 'HAS_ENTRIES', 'a sheet with entries is never deleted');
  perform gold_test.assert((gold.group_sheets('sheet_delete', jsonb_build_object('sheetId', savings))->>'deleted')::boolean, 'an empty one can be');

  -- 14. bad input
  perform gold_test.assert(gold_test.code_of($q$select gold.group_sheets('sheet_get', '{"sheetId":"not-a-uuid"}')$q$) = 'VALIDATION_FAILED', 'a broken id is a clear error');
  perform gold_test.assert(gold.group_sheets('nonsense', '{}') is null, 'an unknown action does nothing');
  raise notice 'group sheets ok';
end $$;