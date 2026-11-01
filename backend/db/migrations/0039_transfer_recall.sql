-- 0039: recalling a transfer that never arrived.
--
-- Until now a released transfer could only end by being received. If the carrier never turned up, or the destination refused it, the
-- goods or cash stayed "in transit" forever and the origin branch's balance stayed short. The origin can now recall a released transfer
-- that nobody has received: what left comes back into the origin's books through new ledger entries (nothing is edited or deleted),
-- the items go back on the shelf, and the transfer is closed as cancelled with the reason written down.
--
-- Race safety: gold.transfer_for locks the transfer row, so a recall and a receipt cannot both succeed. Whoever gets the lock first
-- wins and the other is told the transfer is no longer in transit.

alter table gold.ledger_entries drop constraint ledger_entries_source_type_check;
alter table gold.ledger_entries add constraint ledger_entries_source_type_check check (source_type in (
  'go_live_balance', 'transaction_purchase', 'transaction_payout', 'drawer_movement',
  'transfer_release', 'transfer_receipt', 'transfer_payment', 'transfer_recall', 'debt_issued', 'debt_repayment',
  'payable_issued', 'payable_settlement', 'custody_in', 'custody_out',
  'opening_adjustment', 'closing_adjustment', 'discrepancy_resolution', 'reversal'));

alter table gold.transfer_events drop constraint transfer_events_event_type_check;
alter table gold.transfer_events add constraint transfer_events_event_type_check check (event_type in (
  'created', 'goods_added', 'goods_removed', 'collector_set', 'released', 'payment_recorded',
  'received', 'discrepancy_flagged', 'note_added', 'cancelled', 'attachment_added', 'recalled'));

create function gold.recall_transfer(p_id uuid, p_reason text, p_scope uuid[]) returns jsonb language plpgsql as $$
declare
  t gold.transfers; v_user uuid := gold.require_actor(); v_day uuid; v_at timestamptz := now(); v_lines jsonb;
begin
  t := gold.transfer_for(p_id, 'origin', p_scope);
  if t.status = 'draft' then perform gold.fail(409, 'TRANSFER_NOT_RELEASED', 'This transfer has not been released yet. Cancel it instead.'); end if;
  if t.status <> 'released' then
    perform gold.fail(409, 'TRANSFER_NOT_IN_TRANSIT', case t.status
      when 'cancelled' then 'This transfer was already cancelled or recalled.'
      else 'This transfer has already been received, so it cannot be recalled.' end);
  end if;
  if not gold.has_text(p_reason, 5) then perform gold.fail(422, 'VALIDATION_FAILED', 'Write the reason (at least a few words).'); end if;
  v_day := gold.open_day_id(t.origin_branch_id);
  if v_day is null then perform gold.fail(409, 'DAY_NOT_OPEN', 'Open the day at the sending branch first.'); end if;

  if t.kind = 'goods' then
    perform gold.post_goods(t.origin_branch_id, v_day, v_at, t.declared_top, t.declared_down, t.declared_value, 'transfer_recall', p_id, 'Recalled ' || t.reference);
    update gold.transaction_items set location_state = 'on_hand'
      where id in (select transaction_item_id from gold.transfer_goods_lines where transfer_id = p_id and transaction_item_id is not null)
        and location_state = 'in_transit';
  else
    v_lines := gold.lines_json('transfer_release', p_id);
    perform gold.post_cash(t.origin_branch_id, v_day, v_at, v_lines, 1, 'transfer_recall', p_id, 'Cash back from ' || t.reference);
  end if;

  update gold.transfers set status = 'cancelled', cancelled_at = v_at, cancelled_by = v_user, cancel_reason = 'Recalled: ' || trim(p_reason) where id = p_id;
  perform gold.transfer_event(p_id, 'recalled', jsonb_build_object('reason', trim(p_reason), 'kind', t.kind));
  perform gold.notify(t.tenant_id, 'transfer_recalled', format('%s was recalled by the sending branch', t.reference),
    'Do not receive it. Reason: ' || trim(p_reason), '/transfers/' || p_id, array[t.destination_branch_id], 'transfers:receive');
  return gold.transfer_json(p_id);
end $$;