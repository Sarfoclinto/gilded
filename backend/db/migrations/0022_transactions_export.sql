-- 0022 Flat purchase rows for spreadsheets (B7c). One row per purchase with how it was paid, newest last, up to 5000 per request.
create function gold.transactions_export_json(p_branch uuid, p_from timestamptz, p_to timestamptz, p_limit int) returns jsonb language sql stable as $$
  with picked as (
    select t.* from gold.transactions t
    where t.branch_id = p_branch
      and (p_from is null or t.captured_at >= p_from) and (p_to is null or t.captured_at < p_to)
    order by t.captured_at, t.created_at
    limit least(coalesce(p_limit, 5000), 5000) + 1
  ), shown as (select * from picked order by captured_at, created_at limit least(coalesce(p_limit, 5000), 5000))
  select jsonb_build_object(
    'truncated', (select count(*) from picked) > least(coalesce(p_limit, 5000), 5000),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'reference', s.reference, 'capturedAt', gold.iso(s.captured_at), 'status', s.status,
        'customerName', s.customer_name, 'customerPhone', s.customer_phone,
        'pieces', (select count(*) from gold.transaction_items i where i.transaction_id = s.id),
        'topWeight', gold.ts((select coalesce(sum(i.top), 0) from gold.transaction_items i where i.transaction_id = s.id)),
        'netWeight', gold.ts((select coalesce(sum(i.net_weight), 0) from gold.transaction_items i where i.transaction_id = s.id)),
        'calculated', gold.ts(s.calculated_amount), 'payable', gold.ts(s.payable), 'difference', gold.ts(s.payout_difference),
        'cash', gold.ts((select coalesce(sum(p.amount), 0) from gold.transaction_payments p where p.transaction_id = s.id and p.method = 'cash' and p.status <> 'failed')),
        'mobileMoney', gold.ts((select coalesce(sum(p.amount), 0) from gold.transaction_payments p where p.transaction_id = s.id and p.method = 'mobile_money' and p.status <> 'failed')),
        'owed', gold.ts((select coalesce(sum(p.amount), 0) from gold.transaction_payments p where p.transaction_id = s.id and p.method = 'owed')),
        'flags', array_to_string(s.flags, ', '), 'imported', s.imported_batch is not null, 'receiptNo', s.import_ref,
        'createdBy', (select display_name from gold.users u where u.id = s.created_by), 'voidReason', s.void_reason) order by s.captured_at, s.created_at)
      from shown s), '[]'::jsonb))
$$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then grant execute on all functions in schema gold to gold_app; end if;
end $$;