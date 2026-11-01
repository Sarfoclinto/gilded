-- 0041 What carat to expect. Plain statistics over what this company has actually bought, no model.
--   * gold.karat_label(k): the way tellers say it. 22.1 is "22 low", 22.5 "22 mid", 22.8 "22 high" (thirds of a karat).
--   * gold.expect_json(town, customer): for a town and/or a customer, how many pieces were bought, the usual (median) carat and the
--     range most pieces fall in (10th to 90th percentile). "enough" is false below 5 pieces: the number is then shown as a count only.
--     Void purchases are left out. Everything stays inside the company (row-level security).

create function gold.karat_label(k numeric) returns text language sql immutable as $$
  select case when k is null then null
              when k >= 24 then '24'
              else floor(k)::int::text || ' ' || case when k - floor(k) < 1.0/3 then 'low' when k - floor(k) < 2.0/3 then 'mid' else 'high' end end
$$;

create function gold.karat_stats_json(p_items uuid[]) returns jsonb language sql stable as $$
  select case when count(*) = 0 then jsonb_build_object('n', 0, 'enough', false) else jsonb_build_object(
    'n', count(*), 'enough', count(*) >= 5,
    'median', round(percentile_cont(0.5) within group (order by i.karat)::numeric, 2),
    'low', round(percentile_cont(0.1) within group (order by i.karat)::numeric, 2),
    'high', round(percentile_cont(0.9) within group (order by i.karat)::numeric, 2),
    'usual', gold.karat_label(percentile_cont(0.5) within group (order by i.karat)::numeric),
    'from', gold.karat_label(percentile_cont(0.1) within group (order by i.karat)::numeric),
    'to', gold.karat_label(percentile_cont(0.9) within group (order by i.karat)::numeric)) end
  from gold.transaction_items i where i.id = any(p_items)
$$;

create function gold.expect_json(p_town uuid, p_customer uuid) returns jsonb language plpgsql stable as $$
declare v_town jsonb := null; v_cust jsonb := null; v_items uuid[]; v_name text;
begin
  if p_town is not null then
    select name into v_name from gold.origin_towns where id = p_town;
    if v_name is not null then
      select coalesce(array_agg(i.id), '{}') into v_items from gold.transaction_items i join gold.transactions t on t.id = i.transaction_id
      where t.origin_town_id = p_town and t.status <> 'void';
      v_town := gold.karat_stats_json(v_items) || jsonb_build_object('id', p_town, 'name', v_name);
    end if;
  end if;
  if p_customer is not null then
    select coalesce(array_agg(i.id), '{}') into v_items from gold.transaction_items i join gold.transactions t on t.id = i.transaction_id
    where t.customer_id = p_customer and t.status <> 'void';
    v_cust := gold.karat_stats_json(v_items) || jsonb_build_object('id', p_customer);
  end if;
  return jsonb_build_object('town', v_town, 'customer', v_cust);
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;