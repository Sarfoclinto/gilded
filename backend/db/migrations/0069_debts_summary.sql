-- 0069: debt totals that count every debt, and the open list that shows every open debt.
-- Before: the Debts page and the Home tile added up the debts in the list, and the list stopped at the 100 newest. A branch with more than 100
-- open debts showed a total that was too low, and its oldest open debts (the likeliest to be overdue) did not appear at all.
--   * gold.debts_summary: counts and totals worked out in the database over all debts of the branch.
--   * gold.debts_json: the cap goes from 200 to 1000, and the app asks for up to 1000 when listing open debts.

create or replace function gold.debts_json(p_branch uuid, p_direction text, p_open_only boolean, p_customer uuid, p_limit int default 100)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(gold.debt_json(id) order by issued_at desc), '[]'::jsonb)
  from (select id, issued_at from gold.debts
        where branch_id = p_branch and (p_direction is null or direction = p_direction)
          and (not coalesce(p_open_only, false) or status = 'open')
          and (p_customer is null or customer_id = p_customer)
        order by issued_at desc limit least(greatest(coalesce(p_limit, 100), 1), 1000)) x
$$;

-- one branch's debts at a glance, over all of them: { receivable: { open, total, overdue, held }, payable: { open, total, overdue }, allCount }
create function gold.debts_summary(p_branch uuid) returns jsonb language sql stable as $$
  with o as (
    select d.direction, d.outstanding, d.due_date, d.id
    from gold.v_debts_outstanding d where d.branch_id = p_branch and d.status = 'open'
  )
  select jsonb_build_object(
    'receivable', jsonb_build_object(
      'open', (select count(*) from o where direction = 'receivable'),
      'total', gold.ts(coalesce((select sum(outstanding) from o where direction = 'receivable'), 0)),
      'overdue', (select count(*) from o where direction = 'receivable' and due_date < current_date),
      'held', (select count(*) from o join gold.collateral_holdings h on h.debt_id = o.id and h.status = 'held' where o.direction = 'receivable')),
    'payable', jsonb_build_object(
      'open', (select count(*) from o where direction = 'payable'),
      'total', gold.ts(coalesce((select sum(outstanding) from o where direction = 'payable'), 0)),
      'overdue', (select count(*) from o where direction = 'payable' and due_date < current_date)),
    'allCount', (select count(*) from gold.debts where branch_id = p_branch))
$$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then grant execute on all functions in schema gold to gold_app; end if;
end $$;