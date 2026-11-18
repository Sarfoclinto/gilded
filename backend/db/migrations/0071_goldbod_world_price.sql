-- 0071 (B73): the Gold market page shows GoldBod's world price (the LBMA price in US dollars per ounce that GoldBod's own price is
-- built on, e.g. "USD 3,759.35") with the time GoldBod published it, so it can be held against the live world price.
-- The figure is already kept with every price read from GoldBod (price_snapshots.raw); this only returns the newest one with the history.
create or replace function gold.price_history_json(p_branch uuid, p_days int) returns jsonb language plpgsql stable as $$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 1), 730);
  v_from timestamptz := now() - make_interval(days => v_days);
  b gold.branches;
begin
  select * into b from gold.branches where id = p_branch;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Branch was not found.'); end if;
  return jsonb_build_object(
    'branchId', p_branch, 'days', v_days, 'from', gold.iso(v_from), 'asOf', gold.iso(now()),
    -- GoldBod's own world price (LBMA, US dollars per troy ounce) and dollar rate from the last price read off its page, with the time
    -- GoldBod published it. Shown beside the live world chart so a person can see where the market has gone since. Null until GoldBod
    -- has been read once (a price typed in by hand carries no dollar figure).
    'goldbod', (select jsonb_build_object('usdPerOunce', gold.ts((s.raw->>'usdPerOunce')::numeric), 'rate', gold.ts((s.raw->>'rate')::numeric),
                                          'publishedAt', gold.iso(s.published_at))
                from gold.price_snapshots s
                where s.source = 'goldbod' and jsonb_typeof(s.raw->'usdPerOunce') in ('number', 'string')
                order by s.published_at desc, s.fetched_at desc limit 1),
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