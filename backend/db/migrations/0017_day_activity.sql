-- 0017 "This day only" (B4.6): what happened on one business day, apart from the running totals since go-live.
--  Read-only. Opening balances (go-live or the opening count) are shown as "opening", not as activity. Entries with no business day (late sync after close) are not part of any day's figures.
--  Cash is reported by note: what the drawer opened with, what came in, what went out, and the net.
create function gold.day_activity_json(p_day uuid) returns jsonb language plpgsql stable as $$
declare d gold.business_days; v_open jsonb;
begin
  select * into d from gold.business_days where id = p_day;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That day was not found.'); end if;
  v_open := coalesce((select cash_lines from gold.day_balances where business_day_id = d.id and kind = 'opening_declared'), '{}'::jsonb);
  return jsonb_build_object(
    'dayId', d.id, 'branchId', d.branch_id, 'businessDate', d.business_date, 'status', d.status,
    'cash', jsonb_build_object(
        'opening', v_open,
        'in',  coalesce((select jsonb_object_agg(k::text, n) from (select denomination k, sum(delta_count) n from gold.ledger_entries
                          where business_day_id = d.id and source_type not in ('go_live_balance', 'opening_adjustment') and asset = 'cash' and delta_count > 0 group by denomination) x), '{}'::jsonb),
        'out', coalesce((select jsonb_object_agg(k::text, n) from (select denomination k, -sum(delta_count) n from gold.ledger_entries
                          where business_day_id = d.id and source_type not in ('go_live_balance', 'opening_adjustment') and asset = 'cash' and delta_count < 0 group by denomination) x), '{}'::jsonb),
        'net', coalesce((select jsonb_object_agg(k::text, n) from (select denomination k, sum(delta_count) n from gold.ledger_entries
                          where business_day_id = d.id and source_type not in ('go_live_balance', 'opening_adjustment') and asset = 'cash' group by denomination having sum(delta_count) <> 0) x), '{}'::jsonb),
        'netValue', gold.ts(coalesce((select sum(delta_value) from gold.ledger_entries where business_day_id = d.id and source_type not in ('go_live_balance', 'opening_adjustment') and asset = 'cash'), 0))),
    'goods', (select jsonb_build_object('top', gold.ts(coalesce(sum(delta_top), 0)), 'down', gold.ts(coalesce(sum(delta_down), 0)),
                                        'value', gold.ts(coalesce(sum(delta_value), 0)))
              from gold.ledger_entries where business_day_id = d.id and source_type not in ('go_live_balance', 'opening_adjustment') and asset = 'goods'),
    'debts', jsonb_build_object(
        'net', gold.ts(coalesce((select sum(delta_value) from gold.ledger_entries where business_day_id = d.id and source_type not in ('go_live_balance', 'opening_adjustment') and asset = 'debt'), 0)),
        'debtors', coalesce((
          select jsonb_agg(jsonb_build_object('customerId', customer_id, 'name', party_name, 'issued', gold.ts(issued), 'repaid', gold.ts(repaid), 'net', gold.ts(issued - repaid))
                           order by issued - repaid desc, party_name)
          from (select db.customer_id, db.party_name,
                       sum(case when l.delta_value > 0 then l.delta_value else 0 end) as issued,
                       sum(case when l.delta_value < 0 then -l.delta_value else 0 end) as repaid
                from gold.ledger_entries l
                join gold.debts db on db.id = case l.source_type when 'debt_issued' then l.source_id
                                               else (select r.debt_id from gold.debt_repayments r where r.id = l.source_id) end
                where l.business_day_id = d.id and l.source_type not in ('go_live_balance', 'opening_adjustment') and l.asset = 'debt' and l.source_type in ('debt_issued', 'debt_repayment')
                group by db.customer_id, db.party_name) x), '[]'::jsonb)),
    'payable', gold.ts(coalesce((select sum(delta_value) from gold.ledger_entries where business_day_id = d.id and source_type not in ('go_live_balance', 'opening_adjustment') and asset = 'payable'), 0)));
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;