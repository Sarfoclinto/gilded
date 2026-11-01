-- 0043 Company setting: count the drawer without seeing the books ("count.blind", off by default).
-- It only changes what the open and close screens show; the books, the checks and the audit trail are unchanged. A mismatch still needs a
-- written reason, and the server still decides. Adding the key to the defaults is all that is needed: gold.set_settings accepts any key
-- listed here, with the same type.
create or replace function gold.setting_defaults() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'payout.twoStep', false,
    'payout.sameUserMayPay', true,
    'payout.blindCheck', false,
    'count.blind', false,
    'allowance.perPerson', 100,
    'receipt.printer', false,
    'receipt.paper', '80',
    'receipt.businessName', '',
    'receipt.tagline', '',
    'receipt.address', '',
    'receipt.phone', '',
    'receipt.footer', '')
$$;