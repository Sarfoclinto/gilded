-- B58: how each branch has performed over time, as lines on the dashboard.
-- p: { scope: [branch ids the caller may see], branchIds?: [subset], days?: 7..366 (default 30), asOf?: timestamptz (tests) }
-- One point per bucket for every branch, empty buckets included, so the lines share one x axis. The bucket is a day up to
-- 31 days, a week (Monday) up to 182 days, a month beyond that. Each purchase counts on its branch's own calendar day.
-- Cancelled (void) purchases never count. Branches come in code order, so each one keeps the same colour on every screen.
create function gold.branch_performance_json(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_scope uuid[] := array(select jsonb_array_elements_text(coalesce(p->'scope', '[]'::jsonb))::uuid);
  v_pick uuid[] := array(select jsonb_array_elements_text(coalesce(p->'branchIds', '[]'::jsonb))::uuid);
  v_days int := least(greatest(coalesce((p->>'days')::int, 30), 7), 366);
  v_now timestamptz := coalesce(nullif(p->>'asOf', '')::timestamptz, now());
  v_ids uuid[]; v_grain text; v_today date := (v_now at time zone 'Africa/Accra')::date; v_from date; v_prev_from date;
  v_buckets jsonb; v_branches jsonb;
begin
  if cardinality(v_pick) > 0 then
    if exists (select 1 from unnest(v_pick) x where not (x = any (v_scope))) then perform gold.fail(403, 'FORBIDDEN', 'You do not have access to one of those branches.'); end if;
    v_ids := v_pick;
  else
    v_ids := v_scope;
  end if;
  v_grain := case when v_days <= 31 then 'day' when v_days <= 182 then 'week' else 'month' end;
  v_from := v_today - (v_days - 1);
  v_prev_from := v_from - v_days;

  -- the shared x axis: the first day of every bucket in the window
  select coalesce(jsonb_agg(to_char(d, 'YYYY-MM-DD') order by d), '[]'::jsonb) into v_buckets
  from (select distinct case v_grain when 'day' then g::date when 'week' then date_trunc('week', g)::date else date_trunc('month', g)::date end as d
        from generate_series(v_from, v_today, interval '1 day') g) s;

  with purchases as (
    -- this window and the one before it, so each branch can say how it compares
    select t.branch_id, (t.captured_at at time zone b.timezone)::date as local_date, t.payable, t.id
    from gold.transactions t join gold.branches b on b.id = t.branch_id
    where t.branch_id = any (v_ids) and t.status <> 'void'
      and (t.captured_at at time zone b.timezone)::date between v_prev_from and v_today
  ), weighed as (
    select p.branch_id, p.local_date, p.payable, p.id,
           coalesce((select sum(i.pounds) from gold.transaction_items i where i.transaction_id = p.id), 0) as pounds,
           coalesce((select sum(i.top) from gold.transaction_items i where i.transaction_id = p.id), 0) as top
    from purchases p
  ), bucketed as (
    select w.branch_id,
           case v_grain when 'day' then w.local_date when 'week' then date_trunc('week', w.local_date)::date else date_trunc('month', w.local_date)::date end as bucket,
           count(*) as n, sum(w.payable) as paid, sum(w.pounds) as pounds, sum(w.top) as top
    from weighed w where w.local_date >= v_from group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'branchId', b.id, 'name', b.name, 'code', b.code,
      'points', (select coalesce(jsonb_agg(jsonb_build_object('date', to_char(k.d, 'YYYY-MM-DD'), 'count', coalesce(x.n, 0), 'paid', gold.ts(coalesce(x.paid, 0)),
                                                        'pounds', gold.ts(coalesce(x.pounds, 0)), 'top', gold.ts(coalesce(x.top, 0))) order by k.d), '[]'::jsonb)
                 from (select (jsonb_array_elements_text(v_buckets))::date as d) k
                 left join bucketed x on x.branch_id = b.id and x.bucket = k.d),
      'total', (select jsonb_build_object('count', count(*), 'paid', gold.ts(coalesce(sum(w.payable), 0)), 'pounds', gold.ts(coalesce(sum(w.pounds), 0)), 'top', gold.ts(coalesce(sum(w.top), 0)))
                from weighed w where w.branch_id = b.id and w.local_date >= v_from),
      'previous', (select jsonb_build_object('count', count(*), 'paid', gold.ts(coalesce(sum(w.payable), 0)), 'pounds', gold.ts(coalesce(sum(w.pounds), 0)), 'top', gold.ts(coalesce(sum(w.top), 0)))
                   from weighed w where w.branch_id = b.id and w.local_date < v_from),
      'best', (select jsonb_build_object('date', to_char(x.bucket, 'YYYY-MM-DD'), 'paid', gold.ts(x.paid)) from bucketed x where x.branch_id = b.id order by x.paid desc, x.bucket desc limit 1)
    ) order by b.code), '[]'::jsonb)
  into v_branches
  from gold.branches b where b.id = any (v_ids);

  return jsonb_build_object('asOf', gold.iso(v_now), 'days', v_days, 'grain', v_grain, 'from', to_char(v_from, 'YYYY-MM-DD'), 'to', to_char(v_today, 'YYYY-MM-DD'),
                            'buckets', v_buckets, 'branches', v_branches);
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then grant execute on all functions in schema gold to gold_app; end if;
end $$;