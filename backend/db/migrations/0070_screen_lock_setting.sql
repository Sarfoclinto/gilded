-- 0070 (B70): how long a device may sit with no activity before the screen locks (minutes; 0 never locks by itself).
-- The lock and its PIN live on each device; the server only keeps the company's choice. Checked by gold.set_settings like any number.
create or replace function gold.setting_defaults() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'payout.twoStep', false,
    'payout.sameUserMayPay', true,
    'payout.blindCheck', false,
    'count.blind', false,
    'customers.autoCreate', true,
    'offline.maxDays', 7,
    'drawer.looseBranches', '[]'::jsonb,
    'market.worldChart', true,
    'photos.cameraOnly', false,
    'personalPictures.enabled', true,
    'personalPictures.maxPerUser', 300,
    'personalPictures.maxMb', 300,
    'personalPictures.purgeDays', 90,
    'session.lockMinutes', 5,
    'workings.enabled', true,
    'workings.maxPerUser', 200,
    'workings.maxKb', 256,
    'allowance.perPerson', 100,
    'receipt.printer', false,
    'receipt.paper', '80',
    'receipt.businessName', '',
    'receipt.tagline', '',
    'receipt.address', '',
    'receipt.phone', '',
    'receipt.footer', '')
$$;

-- 0 to 60 minutes
alter function gold.set_settings(jsonb) rename to set_settings_v6;
create function gold.set_settings(p jsonb) returns jsonb language plpgsql as $$
begin
  if p ? 'session.lockMinutes' and jsonb_typeof(p->'session.lockMinutes') = 'number'
     and ((p->>'session.lockMinutes')::numeric < 0 or (p->>'session.lockMinutes')::numeric > 60 or (p->>'session.lockMinutes')::numeric <> trunc((p->>'session.lockMinutes')::numeric)) then
    perform gold.fail(422, 'VALIDATION_FAILED', 'The lock time must be a whole number of minutes from 0 to 60.');
  end if;
  return gold.set_settings_v6(p);
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then grant execute on all functions in schema gold to gold_app; end if;
end $$;