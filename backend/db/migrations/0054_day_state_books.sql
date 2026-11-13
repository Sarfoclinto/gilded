-- 0054 (B52): the day state now also carries what the books say the branch holds besides cash (goods, debts, amounts owed, held gold).
-- Devices keep the day state for working with no connection; with these figures a device can work out a closing by itself:
-- the last figures it heard here, plus everything it has made since. Cash is already there (balance / carryOver).
create or replace function gold.day_state(p_branch uuid) returns jsonb language plpgsql stable as $$
declare d gold.business_days; bal record; v_carry jsonb := null;
begin
  select * into d from gold.business_days where branch_id = p_branch order by (status = 'open') desc, business_date desc, opened_at desc limit 1;
  select * into bal from gold.branch_balance(p_branch);
  if exists (select 1 from gold.ledger_entries where branch_id = p_branch) then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_carry from jsonb_each(bal.cash_lines) where (value #>> '{}')::int > 0;
  end if;
  return jsonb_build_object(
    'day', case when d.id is null then null else gold.day_json(d.id) end,
    'balance', case when d.status = 'open' then bal.cash_lines else null end,
    'movements', case when d.id is null then '[]'::jsonb else
        coalesce((select jsonb_agg(gold.movement_json(m.id) order by m.occurred_at, m.created_at)
                  from gold.drawer_movements m where m.business_day_id = d.id), '[]'::jsonb) end,
    'appliedIds', case when d.id is null then '[]'::jsonb else
        coalesce((select jsonb_agg(x) from (
           select d.id::text as x
           union select source_id::text from gold.ledger_entries
                 where business_day_id = d.id and source_type in ('transaction_payout', 'drawer_movement', 'debt_issued', 'debt_repayment', 'payable_settlement')
        ) ids), '[]'::jsonb) end,
    'carryOver', v_carry,
    'looseDenominations', gold.denominations_loose(p_branch),
    'books', jsonb_build_object('goodsTop', gold.ts(bal.goods_top), 'goodsDown', gold.ts(bal.goods_down), 'goodsValue', gold.ts(bal.goods_value),
                                'debt', gold.ts(bal.debt_value), 'payable', gold.ts(bal.payable_value), 'custodyTop', gold.ts(bal.custody_top)),
    'asOf', gold.iso(now()));
end $$;