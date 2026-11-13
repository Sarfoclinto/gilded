-- 0056 (B55): the Gold market page.
--   * a company setting, "market.worldChart": show the live world gold price chart (an outside service, TradingView). On by default;
--     a director can switch it off. Our own price history below needs no outside service.
--   * gold.price_history_json: the price a branch has been paying over time (GoldBod price + margin, every change), and what was
--     actually bought each day (purchases, grams, cedis, and the average price per pound paid, weighted by weight).
create or replace function gold.setting_defaults() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'payout.twoStep', false,
    'payout.sameUserMayPay', true,
    'payout.blindCheck', false,
    'count.blind', false,
    'customers.autoCreate', true,
    'offline.maxDays', 7,
    'drawer.looseBranches', '[]'::jsonb,
    'market.worldChart', true,
    'allowance.perPerson', 100,
    'receipt.printer', false,
    'receipt.paper', '80',
    'receipt.businessName', '',
    'receipt.tagline', '',
    'receipt.address', '',
    'receipt.phone', '',
    'receipt.footer', '')
$$;

create function gold.price_history_json(p_branch uuid, p_days int) returns jsonb language plpgsql stable as $$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 1), 730);
  v_from timestamptz := now() - make_interval(days => v_days);
  b gold.branches;
begin
  select * into b from gold.branches where id = p_branch;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Branch was not found.'); end if;
  return jsonb_build_object(
    'branchId', p_branch, 'days', v_days, 'from', gold.iso(v_from), 'asOf', gold.iso(now()),
    -- every change of the price in the period, and before them the price that was in force when the period starts
    'points', coalesce((
      select jsonb_agg(jsonb_build_object('at', gold.iso(x.at), 'base', gold.ts(x.base), 'margin', gold.ts(x.margin), 'price', gold.ts(x.base + x.margin),
                                          'source', x.source, 'status', x.status) order by x.at, x.created_at)
      from (
        select bp.effective_from as at, bp.created_at, s.base_price as base, bp.margin, s.source, bp.status
        from gold.branch_prices bp join gold.price_snapshots s on s.id = bp.snapshot_id
        where bp.branch_id = p_branch and bp.effective_from >= v_from
        union all
        (select bp.effective_from, bp.created_at, s.base_price, bp.margin, s.source, bp.status
         from gold.branch_prices bp join gold.price_snapshots s on s.id = bp.snapshot_id
         where bp.branch_id = p_branch and bp.effective_from < v_from
         order by bp.effective_from desc, bp.created_at desc limit 1)
      ) x), '[]'::jsonb),
    -- what was bought each day (the branch's own calendar days); cancelled purchases are left out
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', y.d, 'purchases', y.n, 'top', gold.ts(y.top), 'amount', gold.ts(y.amount),
                                          'avgPrice', case when y.top > 0 then gold.ts(round(y.weighted / y.top, 2)) end) order by y.d)
      from (
        select (t.captured_at at time zone b.timezone)::date as d, count(*) as n, coalesce(sum(i.top), 0) as top,
               coalesce(sum(t.payable), 0) as amount, coalesce(sum(i.weighted), 0) as weighted
        from gold.transactions t
        join lateral (select sum(ti.top) as top, sum(ti.top * ti.price) as weighted from gold.transaction_items ti where ti.transaction_id = t.id) i on true
        where t.branch_id = p_branch and t.status <> 'void' and t.captured_at >= v_from
        group by 1
      ) y), '[]'::jsonb));
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then grant execute on all functions in schema gold to gold_app; end if;
end $$;