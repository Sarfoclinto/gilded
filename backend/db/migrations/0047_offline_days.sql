-- 0047 Company setting "offline.maxDays" (default 7): how many days a device may keep working, and be signed in to, with no contact
-- with the server. Devices store the value when they last reached the server and clamp it to 1..30.
create or replace function gold.setting_defaults() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'payout.twoStep', false,
    'payout.sameUserMayPay', true,
    'payout.blindCheck', false,
    'count.blind', false,
    'customers.autoCreate', true,
    'offline.maxDays', 7,
    'allowance.perPerson', 100,
    'receipt.printer', false,
    'receipt.paper', '80',
    'receipt.businessName', '',
    'receipt.tagline', '',
    'receipt.address', '',
    'receipt.phone', '',
    'receipt.footer', '')
$$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then grant execute on all functions in schema gold to gold_app; end if;
end $$;