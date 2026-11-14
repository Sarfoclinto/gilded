-- 0057 (B56): cancelling a wrongly saved purchase.
--   * New permission transactions:cancel, given to the manager and director roles that already exist (a company can give it to any role or person).
--   * gold.cancel_transaction: with a written reason, puts back everything the purchase did, by NEW ledger entries that point at the ones they
--     reverse (the original purchase and its entries are never edited). The purchase is marked cancelled with the reason and by whom.
--     - the gold goes off the books (and the pieces stop being "on hand");
--     - the cash paid comes back into the drawer that is open now (the teller takes it back from the customer today);
--     - an amount owed to the customer for it is closed; cash still to be paid (two-step) is no longer owed;
--     - a customer's debt that was settled with this gold is owed again (the repayment is reversed and the debt reopened);
--     - gold held as security that this purchase refined and bought is held again;
--     - a mobile money part that was still pending is marked failed; one already confirmed stops the cancellation (money has left).
--   * Refused when any piece has already been sent to another branch, when the purchase is already cancelled, or when no day is open.
--   * The branch's reviewers are told; the audit trail records it.
insert into gold.role_permissions (tenant_id, role_id, permission)
select r.tenant_id, r.id, 'transactions:cancel' from gold.roles r where r.key in ('manager', 'director') and r.is_system
on conflict do nothing;

-- A repayment can now be reversed by a second row with a negative amount that points at it (repayments themselves are never edited).
alter table gold.debt_repayments add column reverses_repayment_id uuid references gold.debt_repayments (id);
alter table gold.debt_repayments drop constraint debt_repayments_amount_check;
alter table gold.debt_repayments add constraint debt_repayments_amount_check
  check ((amount > 0 and reverses_repayment_id is null) or (amount < 0 and reverses_repayment_id is not null));

-- The parts of a payment must add up to the purchase, unless the purchase is cancelled: then a mobile money part that was never sent is
-- marked failed and the sum no longer has to hold (the purchase itself no longer counts).
create or replace function gold.check_payment_split() returns trigger language plpgsql as $$
declare paid numeric; due numeric; v_status text;
begin
  select payable, status into due, v_status from gold.transactions where id = new.transaction_id;
  if v_status = 'void' then return null; end if;
  select coalesce(sum(amount) filter (where status <> 'failed'), 0) into paid from gold.transaction_payments where transaction_id = new.transaction_id;
  if paid <> due then
    raise exception 'the payments (%) must add up to the amount payable (%) for transaction %', paid, due, new.transaction_id
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

-- Writes the reversing entries for a set of ledger entries, dated now, in the day that is open now. Entries already reversed are skipped.
create function gold.reverse_entries(p_ids uuid[], p_day uuid, p_at timestamptz, p_memo text) returns int language plpgsql as $$
declare n int;
begin
  insert into gold.ledger_entries (tenant_id, branch_id, business_day_id, occurred_at, recorded_by, asset, denomination, delta_count, delta_top, delta_down, delta_value,
                                   source_type, source_id, memo, reverses_entry_id)
  select e.tenant_id, e.branch_id, p_day, p_at, gold.current_actor(), e.asset, e.denomination, -e.delta_count, -e.delta_top, -e.delta_down, -e.delta_value,
         'reversal', e.source_id, p_memo, e.id
    from gold.ledger_entries e
   where e.id = any (p_ids)
     and not exists (select 1 from gold.ledger_entries x where x.reverses_entry_id = e.id);
  get diagnostics n = row_count;
  return n;
end $$;

-- p: { id (the purchase), reason, capturedAt? }
create function gold.cancel_transaction(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant(); v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid; v_reason text := nullif(trim(coalesce(p->>'reason', '')), '');
  v_at timestamptz := least(coalesce(nullif(p->>'capturedAt', '')::timestamptz, now()), now());
  t gold.transactions; v_day uuid; v_ids uuid[]; v_memo text; v_name text; n int; r record; v_cash numeric := 0;
begin
  select * into t from gold.transactions where id = v_id for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That purchase was not found.'); end if;
  if t.status = 'void' then perform gold.fail(409, 'ALREADY_CANCELLED', 'This purchase was already cancelled.'); end if;
  if not gold.has_text(v_reason, 5) then perform gold.fail(422, 'VALIDATION_FAILED', 'Say why the purchase is cancelled (at least 5 characters).'); end if;
  if exists (select 1 from gold.transaction_items i where i.transaction_id = v_id and (i.location_state <> 'on_hand' or i.location_branch_id <> t.branch_id)) then
    perform gold.fail(409, 'GOODS_MOVED', 'Some of this gold has already been sent to another branch. It cannot be cancelled any more.');
  end if;
  if exists (select 1 from gold.transaction_payments m where m.transaction_id = v_id and m.method = 'mobile_money' and m.status = 'confirmed') then
    perform gold.fail(409, 'MONEY_SENT', 'Mobile money for this purchase has already been sent and confirmed. Get it back first, then record the refund by hand; the purchase cannot be cancelled here.');
  end if;
  v_day := gold.open_day_id(t.branch_id);
  if v_day is null then perform gold.fail(409, 'NO_OPEN_DAY', 'Open the day first: the cash comes back into the drawer that is open now.'); end if;
  select name into v_name from gold.branches where id = t.branch_id;
  v_memo := 'Cancelled ' || t.reference || ': ' || v_reason;

  -- everything this purchase put in the books: its own entries, an amount owed for it, a debt it settled, security it released
  select coalesce(array_agg(e.id), '{}') into v_ids
    from gold.ledger_entries e
   where e.source_type <> 'reversal'
     and (e.source_id = v_id
          or (e.source_type = 'payable_issued' and e.source_id in (select id from gold.debts where source_transaction_id = v_id))
          or (e.source_type = 'debt_repayment' and e.source_id in (select id from gold.debt_repayments where source_transaction_id = v_id))
          or (e.source_type = 'custody_out' and e.source_id in (select id from gold.collateral_holdings where converted_transaction_id = v_id)));
  select coalesce(-sum(e.delta_value), 0) into v_cash from gold.ledger_entries e where e.id = any (v_ids) and e.asset = 'cash';
  n := gold.reverse_entries(v_ids, v_day, v_at, v_memo);

  -- the pieces are no longer stock
  update gold.transaction_items set location_state = 'in_transit' where transaction_id = v_id;
  -- an amount the branch owed the customer for this gold is no longer owed
  update gold.debts set status = 'written_off', closed_at = v_at, closed_by = v_user, close_reason = v_memo
   where source_transaction_id = v_id and direction = 'payable' and status = 'open';
  -- a debt the customer settled with this gold is owed again
  for r in select * from gold.debt_repayments where source_transaction_id = v_id and reverses_repayment_id is null
                and not exists (select 1 from gold.debt_repayments x where x.reverses_repayment_id = gold.debt_repayments.id) loop
    insert into gold.debt_repayments (tenant_id, debt_id, amount, received_at, received_by, method, source_transaction_id, note, reverses_repayment_id)
    values (v_tenant, r.debt_id, -r.amount, v_at, v_user, r.method, v_id, v_memo, r.id);
    update gold.debts set status = 'open', closed_at = null, closed_by = null, close_reason = null where id = r.debt_id and status = 'settled';
  end loop;
  -- security this purchase refined and bought is held again
  update gold.collateral_holdings set status = 'held', converted_transaction_id = null, closed_by = null, closed_at = null
   where converted_transaction_id = v_id and status = 'converted';
  update gold.transactions set status = 'void', voided_at = v_at, voided_by = v_user, void_reason = v_reason where id = v_id;
  -- mobile money not yet sent is not sent (after the purchase is marked cancelled, so the parts no longer have to add up)
  update gold.transaction_payments set status = 'failed', note = coalesce(note || ' · ', '') || 'Purchase cancelled' where transaction_id = v_id and method = 'mobile_money' and status = 'pending';

  perform gold.audit('transaction.cancelled', 'transaction', v_id::text,
    jsonb_build_object('reference', t.reference, 'customer', t.customer_name, 'payable', gold.ts(t.payable)),
    jsonb_build_object('reason', v_reason, 'entriesReversed', n, 'cashBack', gold.ts(v_cash)));
  perform gold.notify(v_tenant, 'purchase_cancelled', format('%s was cancelled at %s', t.reference, v_name),
    format('%s, GHS %s. Reason: %s. The gold is off the books and GHS %s cash is back in the drawer.', t.customer_name, gold.ts(t.payable), v_reason, gold.ts(v_cash)),
    '/transactions/' || v_id::text, array[t.branch_id], 'discrepancies:review');
  return jsonb_build_object('data', gold.transaction_json(v_id), 'entriesReversed', n, 'cashBack', gold.ts(v_cash));
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then grant execute on all functions in schema gold to gold_app; end if;
end $$;