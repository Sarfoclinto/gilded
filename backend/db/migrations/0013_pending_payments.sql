-- 0013 Mobile money waiting for confirmation, as a list a branch can work through.
--  'sending'   = money this branch was asked to send and has not confirmed yet (the person at this branch confirms or fails it)
--  'receiving' = money other branches still owe for purchases made at this branch (so the teller knows what is outstanding)
create function gold.pending_payments_json(p_branch uuid, p_role text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'paymentId', p.id, 'transactionId', t.id, 'reference', t.reference,
      'purchaseBranchId', t.branch_id, 'purchaseBranchName', b.name,
      'sendingBranchId', p.paid_by_branch_id, 'sendingBranchName', sb.name,
      'customerName', t.customer_name, 'amount', gold.ts(p.amount), 'externalRef', p.external_ref,
      'createdAt', gold.iso(p.created_at)) order by p.created_at), '[]'::jsonb)
  from gold.transaction_payments p
  join gold.transactions t on t.id = p.transaction_id
  join gold.branches b on b.id = t.branch_id
  join gold.branches sb on sb.id = p.paid_by_branch_id
  where p.method = 'mobile_money' and p.status = 'pending'
    and case when p_role = 'receiving' then t.branch_id = p_branch else p.paid_by_branch_id = p_branch end
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;