-- 0035 A rejected closing sign-off keeps its cases open with the reason written on them, and tells the reviewers.

create or replace function gold.trg_publish_day() returns trigger language plpgsql as $$
declare v_name text;
begin
  perform gold.publish(new.tenant_id, 'days', array[new.branch_id]);
  if tg_op = 'UPDATE' and new.signoff_status is distinct from old.signoff_status then
    select name into v_name from gold.branches where id = new.branch_id;
    if new.signoff_status = 'pending' then
      perform gold.notify(new.tenant_id, 'signoff_needed', format('%s closed with differences: sign-off needed', v_name), null, '/drawer/history', array[new.branch_id], 'days:signoff');
    elsif new.signoff_status in ('approved', 'rejected') then
      perform gold.notify_user(new.tenant_id, new.closed_by, 'signoff_decided', format('Your closing at %s was %s', v_name, new.signoff_status), new.signoff_note, '/drawer/history');
      -- A rejection is not the end of it: the cases stay open for review, with the reason written on each, and reviewers are told.
      if new.signoff_status = 'rejected' then
        update gold.discrepancies set status = 'under_review', resolved_at = null, resolved_by = null, resolution_type = null, resolution_summary = null
         where business_day_id = new.id and status in ('resolved', 'written_off');
        insert into gold.discrepancy_actions (tenant_id, discrepancy_id, action_type, note, actor_user_id)
        select d.tenant_id, d.id, 'note', 'Closing rejected: ' || coalesce(new.signoff_note, ''), new.signoff_by
        from gold.discrepancies d where d.business_day_id = new.id;
        perform gold.notify(new.tenant_id, 'signoff_rejected', format('The closing at %s was rejected', v_name), new.signoff_note, '/review/cases', array[new.branch_id], 'discrepancies:review');
      end if;
    end if;
  end if;
  return null;
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;