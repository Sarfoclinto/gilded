-- 0008 Privileges for the application login. It can read and write business data, never alter structure.
-- Append-only tables also lose UPDATE/DELETE here (the triggers already refuse them; this is a second lock).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant usage on schema gold to gold_app;
    grant select, insert, update, delete on all tables in schema gold to gold_app;
    grant usage, select on all sequences in schema gold to gold_app;
    grant execute on all functions in schema gold to gold_app;
    revoke update, delete on
      gold.ledger_entries, gold.audit_events, gold.day_balances, gold.day_reconciliations, gold.transfer_events,
      gold.transfer_payments, gold.discrepancy_actions, gold.debt_repayments, gold.drawer_movements, gold.attachments
      from gold_app;
    alter default privileges in schema gold grant select, insert, update, delete on tables to gold_app;
  end if;
end $$;
