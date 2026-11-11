-- 0051 "If I closed now": the closing account for one branch from the books as they stand this moment (read-only, changes nothing).
--   * debtors (who owes the branch, how much), cash (notes as bundles of 100 and loose, only when the note counts are all sound -
--     otherwise just the amount), goods in stock (the amount, with the purchases since goods were last sent out, each with top, down
--     and value; whatever the books hold beyond those is "brought forward"), what the branch owes customers, and the closing balance.
create function gold.live_account_json(p_branch uuid) returns jsonb language plpgsql stable as $$
declare
  b gold.branches; d gold.business_days; bal record;
  v_debtors jsonb; v_listed numeric; v_sound boolean; v_bundles jsonb; v_loose jsonb; v_bt numeric := 0; v_lt numeric := 0;
  v_out bigint; v_rows jsonb; v_sum numeric; v_n int;
begin
  select * into b from gold.branches where id = p_branch;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Branch was not found.'); end if;
  select * into d from gold.business_days where branch_id = p_branch order by (status = 'open') desc, business_date desc, opened_at desc limit 1;
  select * into bal from gold.branch_balance(p_branch);

  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'amount', gold.ts(x.amount)) order by x.amount desc, lower(x.name)), '[]'::jsonb),
         coalesce(sum(x.amount), 0)
  into v_debtors, v_listed
  from gold.debtors_at(p_branch, now()) x;

  -- notes are only broken down when every count is a real, non-negative number of notes
  v_sound := not exists (select 1 from jsonb_each(bal.cash_lines) e where (e.value #>> '{}')::int < 0);
  if v_sound then
    select coalesce(jsonb_agg(jsonb_build_object('denomination', k, 'count', (n / 100) * 100, 'value', gold.ts(k * (n / 100) * 100)) order by k desc) filter (where n >= 100), '[]'::jsonb),
           coalesce(jsonb_agg(jsonb_build_object('denomination', k, 'count', n % 100, 'value', gold.ts(k * (n % 100))) order by k desc) filter (where n % 100 > 0), '[]'::jsonb),
           coalesce(sum(k * (n / 100) * 100), 0), coalesce(sum(k * (n % 100)), 0)
    into v_bundles, v_loose, v_bt, v_lt
    from (select key::int as k, (value #>> '{}')::int as n from jsonb_each(bal.cash_lines)) z where n > 0;
  end if;

  -- goods: purchases since goods were last sent out (cancelled ones left out), newest first
  select coalesce(max(seq), 0) into v_out from gold.ledger_entries
   where branch_id = p_branch and asset = 'goods' and source_type = 'transfer_release' and delta_value < 0;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'reference', t.reference, 'customerName', t.customer_name, 'capturedAt', gold.iso(t.captured_at),
           'top', gold.ts(g.top), 'down', gold.ts(g.down), 'value', gold.ts(g.v)) order by t.captured_at desc, t.id), '[]'::jsonb),
         coalesce(sum(g.v), 0), count(*)
  into v_rows, v_sum, v_n
  from (select source_id, sum(delta_top) as top, sum(delta_down) as down, sum(delta_value) as v
        from gold.ledger_entries
        where branch_id = p_branch and asset = 'goods' and source_type = 'transaction_purchase' and seq > v_out
        group by source_id having sum(delta_value) <> 0) g
  join gold.transactions t on t.id = g.source_id and t.status <> 'void';

  return jsonb_build_object(
    'branchId', b.id, 'name', b.name, 'asOf', gold.iso(now()),
    'day', case when d.id is null then null else jsonb_build_object('id', d.id, 'status', d.status, 'businessDate', d.business_date) end,
    'debtors', v_debtors, 'debtTotal', gold.ts(bal.debt_value), 'debtUnlisted', gold.ts(bal.debt_value - v_listed),
    'cash', jsonb_build_object('total', gold.ts(bal.cash_value), 'notesSound', v_sound,
                               'bundles', case when v_sound then v_bundles end, 'bundlesTotal', case when v_sound then gold.ts(v_bt) end,
                               'loose', case when v_sound then v_loose end, 'looseTotal', case when v_sound then gold.ts(v_lt) end),
    'goods', jsonb_build_object('total', gold.ts(bal.goods_value), 'top', gold.ts(bal.goods_top), 'down', gold.ts(bal.goods_down),
                                'transactions', v_rows, 'count', v_n, 'listedTotal', gold.ts(v_sum), 'broughtForward', gold.ts(bal.goods_value - v_sum)),
    'owedToCustomers', gold.ts(bal.payable_value),
    'closing', gold.ts(bal.cash_value + bal.debt_value + bal.goods_value - bal.payable_value));
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then grant execute on all functions in schema gold to gold_app; end if;
end $$;