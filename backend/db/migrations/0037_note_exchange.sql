-- 0037 Changing notes after a customer was paid ("I want my 200 changed into two 100s").
-- The notes the customer gives back and the notes handed out must be worth exactly the same, and must be different notes.
-- It is a drawer movement of kind 'exchange' (optionally linked to the purchase), so the drawer count stays right and the audit trail shows it.
alter table gold.drawer_movements drop constraint if exists drawer_movements_kind_check;
alter table gold.drawer_movements add constraint drawer_movements_kind_check check (kind in ('topup', 'withdrawal', 'allowance', 'exchange'));
alter table gold.drawer_movements add column if not exists transaction_id uuid references gold.transactions (id);

create or replace function gold.movement_json(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('id', m.id, 'dayId', m.business_day_id, 'kind', m.kind, 'lines', gold.lines_json('drawer_movement', m.id),
                            'note', m.note, 'capturedAt', gold.iso(m.occurred_at), 'createdBy', gold.person_json(m.created_by),
                            'transactionId', m.transaction_id)
         || case when m.kind = 'exchange' then jsonb_build_object('exchange', jsonb_build_object(
              'gave', coalesce((select jsonb_object_agg(x.denomination::text, x.n) from (select denomination, sum(delta_count) as n from gold.ledger_entries
                        where asset = 'cash' and source_type = 'drawer_movement' and source_id = m.id group by denomination having sum(delta_count) > 0) x), '{}'::jsonb),
              'took', coalesce((select jsonb_object_agg(x.denomination::text, -x.n) from (select denomination, sum(delta_count) as n from gold.ledger_entries
                        where asset = 'cash' and source_type = 'drawer_movement' and source_id = m.id group by denomination having sum(delta_count) < 0) x), '{}'::jsonb)))
            else '{}'::jsonb end
  from gold.drawer_movements m where m.id = p_id
$$;

create or replace function gold.record_exchange(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_day uuid := (p->>'dayId')::uuid;
  v_branch uuid := (p->>'branchId')::uuid;
  v_tx uuid := nullif(p->>'transactionId', '')::uuid;
  v_note text := nullif(trim(coalesce(p->>'note', '')), '');
  v_at timestamptz := least((p->>'capturedAt')::timestamptz, now());
  v_gave jsonb := coalesce(p->'gave', '{}'::jsonb);
  v_took jsonb := coalesce(p->'took', '{}'::jsonb);
  d gold.business_days; t gold.transactions;
begin
  if exists (select 1 from gold.drawer_movements where id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.movement_json(v_id));
  end if;
  select * into d from gold.business_days where id = v_day and branch_id = v_branch;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That day was not found.'); end if;
  if d.status <> 'open' then
    v_day := gold.open_day_id(v_branch);
    if v_day is null then perform gold.fail(409, 'DAY_CLOSED', 'This day is closed and no day is open. Open the day, then send it again.'); end if;
    v_note := 'Made before the day closed: ' || coalesce(v_note, 'notes changed');
  end if;
  if gold.lines_total(v_gave) = 0 or gold.lines_total(v_took) = 0 then
    perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the notes the customer gives back and the notes you hand out.');
  end if;
  if gold.lines_total(v_gave) <> gold.lines_total(v_took) then
    perform gold.fail(422, 'EXCHANGE_MISMATCH', 'The notes given back (' || gold.ts(gold.lines_total(v_gave)) || ') and the notes handed out (' || gold.ts(gold.lines_total(v_took)) || ') must be worth the same.');
  end if;
  if exists (select 1 from jsonb_object_keys(v_gave) k where v_took ? k) then
    perform gold.fail(422, 'EXCHANGE_SAME_NOTE', 'Hand out different notes from the ones given back.');
  end if;
  if v_tx is not null then
    select * into t from gold.transactions where id = v_tx;
    if not found or t.branch_id <> v_branch then perform gold.fail(404, 'NOT_FOUND', 'That purchase was not found at this branch.'); end if;
    if t.status = 'void' then perform gold.fail(409, 'TRANSACTION_VOID', 'That purchase was cancelled.'); end if;
    v_note := coalesce(v_note, 'Notes changed for ' || t.reference);
  end if;
  v_note := coalesce(v_note, 'Notes changed');

  insert into gold.drawer_movements (id, tenant_id, branch_id, business_day_id, kind, note, occurred_at, created_by, transaction_id)
  values (v_id, v_tenant, v_branch, v_day, 'exchange', v_note, v_at, v_user, v_tx);
  perform gold.post_cash(v_branch, v_day, v_at, v_gave, 1, 'drawer_movement', v_id, v_note);
  perform gold.post_cash(v_branch, v_day, v_at, v_took, -1, 'drawer_movement', v_id, v_note);
  return jsonb_build_object('replayed', false, 'data', gold.movement_json(v_id));
end $$;

create or replace view gold.activity_feed with (security_invoker = true) as
  -- purchases
  select 'tx:' || t.id as uid, t.created_at as at, t.created_by as actor_id, t.branch_id, 'purchase'::text as category, 'purchase.saved'::text as action,
         'transaction'::text as entity_type, t.id::text as entity_id,
         format('Saved purchase %s for %s', t.reference, t.customer_name) as summary, t.payable as amount,
         jsonb_build_object('reference', t.reference, 'customer', t.customer_name, 'status', t.status, 'capturedAt', t.captured_at) as detail
    from gold.transactions t
  union all
  select 'txv:' || t.id, t.voided_at, t.voided_by, t.branch_id, 'purchase', 'purchase.voided', 'transaction', t.id::text,
         format('Voided purchase %s', t.reference), t.payable, jsonb_build_object('reference', t.reference, 'reason', t.void_reason)
    from gold.transactions t where t.voided_at is not null
  -- days
  union all
  select 'dayo:' || d.id, d.opened_at, d.opened_by, d.branch_id, 'day', 'day.opened', 'day', d.id::text,
         format('Opened the day for %s', d.business_date), null::numeric, jsonb_build_object('businessDate', d.business_date, 'source', d.opening_source)
    from gold.business_days d
  union all
  select 'dayc:' || d.id, d.closed_at, d.closed_by, d.branch_id, 'day', 'day.closed', 'day', d.id::text,
         format('Closed the day for %s', d.business_date), null, jsonb_build_object('businessDate', d.business_date, 'signoff', d.signoff_status)
    from gold.business_days d where d.closed_at is not null
  union all
  select 'days:' || d.id, d.signoff_at, d.signoff_by, d.branch_id, 'day', case when d.signoff_status = 'rejected' then 'day.signoff_rejected' else 'day.signed_off' end, 'day', d.id::text,
         format('%s the closing of %s', case when d.signoff_status = 'rejected' then 'Rejected' else 'Signed off' end, d.business_date), null,
         jsonb_build_object('businessDate', d.business_date, 'note', d.signoff_note)
    from gold.business_days d where d.signoff_at is not null
  -- cash drawer
  union all
  select 'mv:' || m.id, m.created_at, m.created_by, m.branch_id, 'cash', 'cash.' || m.kind, 'drawer_movement', m.id::text,
         case m.kind when 'topup' then 'Added cash to the drawer' when 'exchange' then 'Changed notes' when 'allowance' then 'Paid the office allowance' else 'Took cash out of the drawer' end || ': ' || m.note, null,
         jsonb_build_object('note', m.note, 'occurredAt', m.occurred_at)
    from gold.drawer_movements m
  -- transfers
  union all
  select 'trc:' || x.id, x.created_at, x.created_by, x.origin_branch_id, 'transfer', 'transfer.drafted', 'transfer', x.id::text,
         format('Drafted transfer %s', x.reference), null, jsonb_build_object('reference', x.reference, 'to', x.destination_branch_id)
    from gold.transfers x
  union all
  select 'trr:' || x.id, x.released_at, x.released_by, x.origin_branch_id, 'transfer', 'transfer.released', 'transfer', x.id::text,
         format('Released transfer %s', x.reference), null, jsonb_build_object('reference', x.reference, 'to', x.destination_branch_id)
    from gold.transfers x where x.released_at is not null
  union all
  select 'trv:' || x.id, x.received_at, x.received_by, x.destination_branch_id, 'transfer',
         case when x.status = 'received_with_discrepancy' then 'transfer.received_with_difference' else 'transfer.received' end, 'transfer', x.id::text,
         format('Received transfer %s%s', x.reference, case when x.status = 'received_with_discrepancy' then ' with a difference' else '' end), null,
         jsonb_build_object('reference', x.reference, 'from', x.origin_branch_id)
    from gold.transfers x where x.received_at is not null
  union all
  select 'trx:' || x.id, x.cancelled_at, x.cancelled_by, x.origin_branch_id, 'transfer', 'transfer.cancelled', 'transfer', x.id::text,
         format('Cancelled transfer %s', x.reference), null, jsonb_build_object('reference', x.reference)
    from gold.transfers x where x.cancelled_at is not null
  -- differences (cases)
  union all
  select 'dca:' || a.id, a.occurred_at, a.actor_user_id, d.branch_id, 'case', 'case.' || a.action_type, 'discrepancy', d.id::text,
         case a.action_type when 'opened' then 'Opened a difference case' when 'note' then 'Added a note to a case' when 'assigned' then 'Took over a case'
                            when 'resolved' then 'Resolved a case' when 'reopened' then 'Reopened a case' when 'status_changed' then 'Changed the status of a case'
                            when 'adjustment_posted' then 'Posted an adjustment for a case' else 'Added evidence to a case' end,
         d.difference, jsonb_build_object('note', a.note, 'from', a.from_status, 'to', a.to_status, 'kind', d.kind, 'asset', d.asset)
    from gold.discrepancy_actions a join gold.discrepancies d on d.id = a.discrepancy_id
  -- debts and held gold
  union all
  select 'dbi:' || b.id, b.issued_at, b.issued_by, b.branch_id, 'debt', case when b.direction = 'payable' then 'debt.owed_recorded' else 'debt.issued' end, 'debt', b.id::text,
         case when b.direction = 'payable' then 'Recorded an amount we owe' else 'Gave a loan' end || ': ' || b.reason, b.principal,
         jsonb_build_object('reason', b.reason, 'direction', b.direction, 'party', b.party_type)
    from gold.debts b
  union all
  select 'dbr:' || r.id, r.received_at, r.received_by, b.branch_id, 'debt', 'debt.repaid', 'debt', b.id::text,
         'Recorded a repayment', null, jsonb_build_object('note', r.note, 'reason', b.reason)
    from gold.debt_repayments r join gold.debts b on b.id = r.debt_id
  union all
  select 'dbc:' || b.id, b.closed_at, b.closed_by, b.branch_id, 'debt', case when b.status = 'written_off' then 'debt.written_off' else 'debt.settled' end, 'debt', b.id::text,
         case when b.status = 'written_off' then 'Wrote off a debt' else 'Settled a debt' end, b.principal, jsonb_build_object('reason', b.close_reason)
    from gold.debts b where b.closed_at is not null
  union all
  select 'colr:' || c.id, c.received_at, c.received_by, c.branch_id, 'debt', 'gold.held', 'collateral', c.id::text,
         'Took gold as security for a loan', null, jsonb_build_object('debtId', c.debt_id)
    from gold.collateral_holdings c
  union all
  select 'colc:' || c.id, c.closed_at, c.closed_by, c.branch_id, 'debt', 'gold.' || c.status, 'collateral', c.id::text,
         case c.status when 'converted' then 'Bought the gold held as security' else 'Returned the gold held as security' end, null, jsonb_build_object('note', c.close_note)
    from gold.collateral_holdings c where c.closed_at is not null
  -- mobile money
  union all
  select 'pay:' || p.id, p.confirmed_at, p.confirmed_by, t.branch_id, 'payment', 'payment.' || p.status, 'payment', p.id::text,
         case p.status when 'failed' then 'Marked a mobile payment as failed' else 'Confirmed a mobile payment' end || format(' for %s', t.reference), p.amount,
         jsonb_build_object('note', p.note, 'reference', t.reference)
    from gold.transaction_payments p join gold.transactions t on t.id = p.transaction_id
   where p.method = 'mobile_money' and p.confirmed_at is not null
  -- prices
  union all
  select 'bps:' || b.id, b.created_at, b.set_by, b.branch_id, 'price', 'price.set', 'branch_price', b.id::text,
         'Set a branch margin', null, jsonb_build_object('status', b.status)
    from gold.branch_prices b
  union all
  select 'bpa:' || b.id, b.approved_at, b.approved_by, b.branch_id, 'price', 'price.approved', 'branch_price', b.id::text,
         'Approved a branch margin', null, jsonb_build_object('status', b.status)
    from gold.branch_prices b where b.approved_at is not null
  union all
  select 'pfe:' || e.id, e.at, e.decided_by, null::uuid, 'price', 'price.feed_' || e.kind, 'price_feed', e.id::text,
         e.message, e.base_price, jsonb_build_object('state', e.state, 'publishedAt', e.published_at)
    from gold.price_feed_events e
  -- people, customers and branches (the audit table)
  union all
  select 'aud:' || a.id, a.occurred_at, a.actor_user_id, a.branch_id, case when a.entity_type in ('user', 'role') then 'people' when a.entity_type = 'customer' then 'customer' else 'setup' end,
         a.action, a.entity_type, a.entity_id,
         case a.action
           when 'user.created' then 'Added a user' when 'user.updated' then 'Changed a user' when 'user.password_reset' then 'Reset a user''s password'
           when 'user.password_changed' then 'Changed their own password' when 'customer.created' then 'Added a customer' when 'customer.updated' then 'Edited a customer'
           when 'customer.merged' then 'Merged duplicate customers' when 'branch.created' then 'Added a branch' when 'branch.updated' then 'Changed a branch'
           else replace(a.action, '.', ' ') end,
         null, jsonb_build_object('before', a.before, 'after', a.after)
    from gold.audit_events a;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;