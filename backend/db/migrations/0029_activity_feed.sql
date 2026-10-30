-- 0029 Audit trail: one searchable feed of who did what, drawn from every table that records an action.
-- Nothing new is stored and nothing is copied: the view reads the original records, so it can never disagree with them.
-- It runs with the caller's own rights (security_invoker), so the per-company row security still applies.
--
-- Columns: uid (unique, stable), at, actor_id, branch_id (null = company-wide), category, action, entity_type, entity_id,
-- summary (plain words, no ids), amount (money involved, when there is one), detail (extra facts for the detail view).
-- A new permission, audit:read, guards the viewer; directors get it here (new companies get it from the code).

create view gold.activity_feed with (security_invoker = true) as
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
         case m.kind when 'topup' then 'Added cash to the drawer' else 'Took cash out of the drawer' end || ': ' || m.note, null,
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

-- ---------------------------------------------------------------- the search
-- p_scope: branches the caller may see (null = every branch and company-wide events).
-- p_f keys (all optional): q, category, action, actorId, branchId, from, to (ISO), minAmount, sort ('newest' | 'oldest' | 'amount'), page (1-based), size (1..100).
create function gold.audit_search_json(p_scope uuid[], p_f jsonb) returns jsonb language plpgsql stable as $$
declare
  v_q text := nullif(btrim(coalesce(p_f->>'q', '')), '');
  v_cat text := nullif(p_f->>'category', '');
  v_act text := nullif(p_f->>'action', '');
  v_actor uuid := nullif(p_f->>'actorId', '')::uuid;
  v_branch uuid := nullif(p_f->>'branchId', '')::uuid;
  v_from timestamptz := nullif(p_f->>'from', '')::timestamptz;
  v_to timestamptz := nullif(p_f->>'to', '')::timestamptz;
  v_min numeric := nullif(p_f->>'minAmount', '')::numeric;
  v_sort text := coalesce(nullif(p_f->>'sort', ''), 'newest');
  v_size int := least(greatest(coalesce(nullif(p_f->>'size', '')::int, 25), 1), 100);
  v_page int := greatest(coalesce(nullif(p_f->>'page', '')::int, 1), 1);
  v_total int; v_items jsonb; v_cats jsonb; v_actors jsonb;
begin
  if v_branch is not null and p_scope is not null and not (v_branch = any(p_scope)) then
    perform gold.fail(403, 'FORBIDDEN', 'That branch is not one of yours.');
  end if;

  with base as materialized (
    select f.uid, f.at, f.actor_id, u.display_name as actor_name, f.branch_id, b.name as branch_name, f.category, f.action,
           f.entity_type, f.entity_id, f.summary, f.amount, f.detail
      from gold.activity_feed f
      left join gold.users u on u.id = f.actor_id
      left join gold.branches b on b.id = f.branch_id
     where f.at is not null
       and (p_scope is null or f.branch_id = any(p_scope))
       and (v_branch is null or f.branch_id = v_branch)
       and (v_actor is null or f.actor_id = v_actor)
       and (v_from is null or f.at >= v_from)
       and (v_to is null or f.at < v_to)
       and (v_min is null or coalesce(f.amount, 0) >= v_min)
       and (v_q is null or f.summary ilike '%' || v_q || '%' or coalesce(u.display_name, '') ilike '%' || v_q || '%'
            or coalesce(b.name, '') ilike '%' || v_q || '%' or f.detail::text ilike '%' || v_q || '%')
  ), filt as (
    select * from base where (v_cat is null or category = v_cat) and (v_act is null or action = v_act)
  ), page as (
    select * from filt
     order by case v_sort when 'amount' then coalesce(amount, -1) when 'oldest' then -extract(epoch from at) else extract(epoch from at) end desc,
              at desc, uid
     offset (v_page - 1) * v_size limit v_size
  )
  select (select count(*) from filt),
         -- Counts for the filter chips ignore the category and action filters themselves, so choosing one does not hide the others.
         (select coalesce(jsonb_object_agg(category, n), '{}'::jsonb) from (select category, count(*) n from base group by category) c),
         (select coalesce(jsonb_agg(jsonb_build_object('id', actor_id, 'name', actor_name, 'count', n) order by n desc, actor_name), '[]'::jsonb)
            from (select actor_id, actor_name, count(*) n from base where actor_id is not null group by actor_id, actor_name order by n desc limit 50) a),
         (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', uid, 'at', gold.iso(at), 'actor', case when actor_id is null then null else jsonb_build_object('id', actor_id, 'displayName', actor_name) end,
                  'branch', case when branch_id is null then null else jsonb_build_object('id', branch_id, 'name', branch_name) end,
                  'category', category, 'action', action, 'entityType', entity_type, 'entityId', entity_id, 'summary', summary,
                  'amount', gold.ts(amount), 'detail', detail)
                order by case v_sort when 'amount' then coalesce(amount, -1) when 'oldest' then -extract(epoch from at) else extract(epoch from at) end desc, at desc, uid), '[]'::jsonb)
            from page)
    into v_total, v_cats, v_actors, v_items;

  return jsonb_build_object('asOf', gold.iso(now()), 'total', v_total, 'page', v_page, 'size', v_size, 'items', v_items, 'categories', v_cats, 'actors', v_actors);
end $$;

-- Existing companies: directors may read the audit trail.
insert into gold.role_permissions (tenant_id, role_id, permission)
select r.tenant_id, r.id, 'audit:read' from gold.roles r where r.key = 'director' and r.is_system
on conflict do nothing;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select on gold.activity_feed to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;