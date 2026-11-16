-- 0066 (B59): what a customer already owes, across the branches the caller can see, for the "Give a loan" page.
-- p_scope: the caller's branch ids. Debts at branches outside it are not shown, only counted ("elsewhere"), so a lender knows there is more.
create function gold.customer_debts_json(p_customer uuid, p_scope uuid[]) returns jsonb language sql stable as $$
  with open_debts as (
    select d.id, d.branch_id, d.issued_at, d.due_date, d.outstanding
    from gold.v_debts_outstanding d
    where d.customer_id = p_customer and d.direction = 'receivable' and d.status = 'open' and d.outstanding > 0
  ), seen as (
    select o.*, b.name as branch_name from open_debts o join gold.branches b on b.id = o.branch_id where o.branch_id = any (coalesce(p_scope, '{}'))
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(gold.debt_json(s.id) || jsonb_build_object('branchName', s.branch_name) order by s.due_date nulls last, s.issued_at) from seen s), '[]'::jsonb),
    'total', coalesce((select gold.ts(sum(s.outstanding)) from seen s), gold.ts(0::numeric)),
    'elsewhere', (select count(*) from open_debts o where not (o.branch_id = any (coalesce(p_scope, '{}')))))
$$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then grant execute on all functions in schema gold to gold_app; end if;
end $$;