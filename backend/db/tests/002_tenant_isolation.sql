-- Row-level security as the application login sees it. (The scenario above ran as the owner, which bypasses it.)
grant usage on schema gold_test to gold_app;
do $$
declare ta uuid; tb uuid; n int;
begin
  select id into ta from gold.tenants where slug = 'demo';
  select id into tb from gold.tenants where slug = 'other';

  set local role gold_app;

  perform set_config('app.tenant_id', ta::text, true);
  select count(*) into n from gold.ledger_entries;
  perform gold_test.assert(n > 20, 'tenant A sees its ledger');
  select count(*) into n from gold.branches;
  perform gold_test.assert(n = 2, 'tenant A sees only its two branches, saw ' || n);
  select count(*) into n from gold.tenants;
  perform gold_test.assert(n = 1, 'tenant A sees only its own tenant row');

  perform set_config('app.tenant_id', tb::text, true);
  select count(*) into n from gold.ledger_entries;
  perform gold_test.assert(n = 0, 'tenant B sees none of tenant A''s ledger');
  select count(*) into n from gold.users;
  perform gold_test.assert(n = 1, 'tenant B sees only its own users');
  perform gold_test.assert(gold_test.fails(format($f$insert into gold.customers (tenant_id, name) values (%L, 'sneaky')$f$, ta), '42501'),
    'tenant B cannot write rows into tenant A');

  perform set_config('app.tenant_id', '', true);
  select count(*) into n from gold.ledger_entries;
  perform gold_test.assert(n = 0, 'no tenant set means no rows');

  perform set_config('app.tenant_id', ta::text, true);
  perform gold_test.assert(gold_test.fails($f$update gold.ledger_entries set memo = 'x'$f$, '42501'), 'the app login has no UPDATE on the ledger');
  perform gold_test.assert(gold_test.fails($f$delete from gold.audit_events$f$, '42501'), 'the app login has no DELETE on the audit log');
  perform gold_test.assert(gold_test.fails($f$create table gold.hack (id int)$f$, '42501'), 'the app login cannot change structure');
  insert into gold.customers (tenant_id, name) values (ta, 'Allowed customer');

  reset role;
  raise notice 'tenant isolation: all assertions passed';
end $$;
