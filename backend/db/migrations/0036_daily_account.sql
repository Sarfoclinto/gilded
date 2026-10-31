-- 0036 The daily account (what the tellers write on the A4 sheet) and the office allowance as a drawer movement.
--   * Office allowance: paid out of the day's cash, by note, for N people. It is a drawer movement of kind 'allowance'.
--   * gold.daily_accounts_json(scope, branch, date): for each branch, the closed day's account: debtors (with what changed since the
--     previous closed day), cash as bundles (whole 100s of notes) and loose notes, debts, goods (days since the last transfer out, with
--     what was sent earlier kept separately), what is owed to customers, the allowance, the closing balance, and its change.
--   Read-only: nothing here changes any record.
alter table gold.drawer_movements add column if not exists people smallint check (people is null or people between 1 and 200);
alter table gold.drawer_movements drop constraint if exists drawer_movements_kind_check;
alter table gold.drawer_movements add constraint drawer_movements_kind_check check (kind in ('topup', 'withdrawal', 'allowance'));

create or replace function gold.record_movement(p jsonb) returns jsonb language plpgsql as $$
declare
  v_tenant uuid := gold.current_tenant();
  v_user uuid := gold.require_actor();
  v_id uuid := (p->>'id')::uuid;
  v_day uuid := (p->>'dayId')::uuid;
  v_branch uuid := (p->>'branchId')::uuid;
  v_kind text := p->>'kind';
  v_note text := trim(coalesce(p->>'note', ''));
  v_at timestamptz := least((p->>'capturedAt')::timestamptz, now());
  v_people int := nullif(p->>'people', '')::int;
  d gold.business_days;
begin
  if exists (select 1 from gold.drawer_movements where id = v_id) then
    return jsonb_build_object('replayed', true, 'data', gold.movement_json(v_id));
  end if;
  select * into d from gold.business_days where id = v_day and branch_id = v_branch;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'That day was not found.'); end if;
  if d.status <> 'open' then
    -- Saved on a device while the day was open, reaching us after it closed. The cash really moved, so it is recorded in the day
    -- that is open now (never in the sealed one), and says so. With no day open it still has nowhere to go.
    v_day := gold.open_day_id(v_branch);
    if v_day is null then perform gold.fail(409, 'DAY_CLOSED', 'This day is closed and no day is open. Open the day, then send it again.'); end if;
    v_note := 'Made before the day closed: ' || v_note;
  end if;
  if v_kind not in ('topup', 'withdrawal', 'allowance') then perform gold.fail(422, 'VALIDATION_FAILED', 'kind must be topup, withdrawal or allowance.'); end if;
  if v_kind = 'allowance' then
    if v_people is null or v_people < 1 or v_people > 200 then perform gold.fail(422, 'VALIDATION_FAILED', 'Say how many people the office allowance is for.'); end if;
    if not gold.has_text(v_note, 1) then v_note := 'Office allowance for ' || v_people || ' ' || case when v_people = 1 then 'person' else 'people' end; end if;
  elsif v_people is not null then v_people := null; end if;
  if not gold.has_text(v_note, 1) then perform gold.fail(422, 'VALIDATION_FAILED', 'Write a note saying what the money is for.'); end if;
  if gold.lines_total(p->'lines') = 0 then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter at least one note.'); end if;

  insert into gold.drawer_movements (id, tenant_id, branch_id, business_day_id, kind, note, occurred_at, created_by, people)
  values (v_id, v_tenant, v_branch, v_day, v_kind, v_note, v_at, v_user, v_people);
  perform gold.post_cash(v_branch, v_day, v_at, p->'lines', case when v_kind = 'topup' then 1 else -1 end, 'drawer_movement', v_id, v_note);
  return jsonb_build_object('replayed', false, 'data', gold.movement_json(v_id));
end $$;

-- Debts owed TO the branch as they stood at a moment: issued by then, less repayments received by then, not closed before then.
create or replace function gold.debtors_at(p_branch uuid, p_t timestamptz)
returns table (id uuid, name text, amount numeric, issued_at timestamptz) language sql stable as $$
  select x.id, x.party_name, x.amt, x.issued_at from (
    select d.id, d.party_name, d.issued_at,
           d.principal - coalesce((select sum(r.amount) from gold.debt_repayments r where r.debt_id = d.id and r.received_at <= p_t), 0) as amt
    from gold.debts d
    where d.branch_id = p_branch and d.direction = 'receivable' and d.issued_at <= p_t and (d.status = 'open' or d.closed_at > p_t)
  ) x where x.amt > 0
$$;

create or replace function gold.daily_account_json(p_branch uuid, p_date date) returns jsonb language plpgsql stable as $$
declare
  b gold.branches; d gold.business_days; pd gold.business_days; c gold.day_balances; pc gold.day_balances;
  v_seq bigint; v_t timestamptz; v_pt timestamptz;
  v_debtors jsonb; v_listed numeric; v_bundles jsonb; v_loose jsonb; v_bt numeric := 0; v_lt numeric := 0;
  v_last_out date; v_goods_rows jsonb; v_goods_sum numeric; v_sent jsonb;
  v_allow numeric; v_people int; v_closing numeric; v_prev_closing numeric;
begin
  select * into b from gold.branches where id = p_branch;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Branch was not found.'); end if;
  select * into d from gold.business_days where branch_id = p_branch and business_date = p_date and status = 'closed' order by session_no desc limit 1;
  if not found then
    return jsonb_build_object('branchId', b.id, 'name', b.name, 'isMain', b.is_main, 'businessDate', p_date,
      'status', case when exists (select 1 from gold.business_days x where x.branch_id = p_branch and x.business_date = p_date) then 'open' else 'none' end);
  end if;
  select * into c from gold.day_balances where business_day_id = d.id and kind = 'closing_declared';
  v_t := d.closed_at;
  select max(seq) into v_seq from gold.ledger_entries where branch_id = p_branch and business_day_id = d.id;
  select * into pd from gold.business_days x
   where x.branch_id = p_branch and x.status = 'closed' and (x.business_date, x.session_no) < (d.business_date, d.session_no)
   order by x.business_date desc, x.session_no desc limit 1;
  if found then
    select * into pc from gold.day_balances where business_day_id = pd.id and kind = 'closing_declared';
    v_pt := pd.closed_at;
  end if;

  -- debtors, with what changed since the previous closed day
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'amount', gold.ts(x.amount),
           'change', case when v_pt is null then null else gold.ts(x.amount - coalesce(p.amount, 0)) end,
           'isNew', v_pt is not null and p.id is null) order by x.amount desc, lower(x.name)), '[]'::jsonb),
         coalesce(sum(x.amount), 0)
  into v_debtors, v_listed
  from gold.debtors_at(p_branch, v_t) x left join gold.debtors_at(p_branch, coalesce(v_pt, v_t)) p on p.id = x.id and v_pt is not null;

  -- cash: whole bundles of 100 notes, and the loose rest
  select coalesce(jsonb_agg(jsonb_build_object('denomination', k, 'count', (n / 100) * 100, 'value', gold.ts(k * (n / 100) * 100)) order by k desc) filter (where n >= 100), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('denomination', k, 'count', n % 100, 'value', gold.ts(k * (n % 100))) order by k desc) filter (where n % 100 > 0), '[]'::jsonb),
         coalesce(sum(k * (n / 100) * 100), 0), coalesce(sum(k * (n % 100)), 0)
  into v_bundles, v_loose, v_bt, v_lt
  from (select key::int as k, (value #>> '{}')::int as n from jsonb_each(c.cash_lines)) z where n > 0;

  -- goods: the days since the last time goods were sent out, newest first; the rest is "brought forward"
  select max(dt) into v_last_out from (
    select coalesce(bd.business_date, (e.occurred_at at time zone b.timezone)::date) as dt
    from gold.ledger_entries e left join gold.business_days bd on bd.id = e.business_day_id
    where e.branch_id = p_branch and e.asset = 'goods' and e.source_type = 'transfer_release' and e.delta_value < 0 and e.seq <= coalesce(v_seq, 9223372036854775807)) o;
  select coalesce(jsonb_agg(jsonb_build_object('date', g.dt, 'value', gold.ts(g.v)) order by g.dt desc), '[]'::jsonb), coalesce(sum(g.v), 0)
  into v_goods_rows, v_goods_sum
  from (select coalesce(bd.business_date, (e.occurred_at at time zone b.timezone)::date) as dt, sum(e.delta_value) as v
        from gold.ledger_entries e left join gold.business_days bd on bd.id = e.business_day_id
        where e.branch_id = p_branch and e.asset = 'goods' and e.seq <= coalesce(v_seq, 9223372036854775807)
        group by 1 having sum(e.delta_value) <> 0) g
  where v_last_out is null or g.dt > v_last_out;
  select coalesce(jsonb_agg(jsonb_build_object('reference', t.reference, 'date', (t.released_at at time zone b.timezone)::date, 'value', gold.ts(coalesce(t.declared_value, 0)),
           'to', (select name from gold.branches x where x.id = t.destination_branch_id)) order by t.released_at desc), '[]'::jsonb)
  into v_sent
  from (select * from gold.transfers where origin_branch_id = p_branch and kind = 'goods' and released_at is not null and released_at <= v_t order by released_at desc limit 15) t;

  -- office allowance paid from the drawer on this date
  select coalesce(sum(-e.delta_value), 0), coalesce(max(m.people), 0) into v_allow, v_people
  from gold.drawer_movements m join gold.business_days x on x.id = m.business_day_id and x.branch_id = p_branch and x.business_date = p_date
  left join gold.ledger_entries e on e.source_type = 'drawer_movement' and e.source_id = m.id and e.asset = 'cash'
  where m.kind = 'allowance';

  v_closing := c.cash_value + c.debt_value + c.goods_value - c.payable_value;
  v_prev_closing := case when pc.id is null then null else pc.cash_value + pc.debt_value + pc.goods_value - pc.payable_value end;

  return jsonb_build_object(
    'branchId', b.id, 'name', b.name, 'isMain', b.is_main, 'businessDate', p_date, 'status', 'closed',
    'day', jsonb_build_object('id', d.id, 'openedAt', gold.iso(d.opened_at), 'closedAt', gold.iso(d.closed_at), 'closedBy', gold.person_json(d.closed_by),
                              'signoff', d.signoff_status, 'sessions', (select count(*) from gold.business_days x where x.branch_id = p_branch and x.business_date = p_date)),
    'debtors', v_debtors, 'debtTotal', gold.ts(c.debt_value), 'debtUnlisted', gold.ts(c.debt_value - v_listed),
    'cash', jsonb_build_object('bundles', v_bundles, 'bundlesTotal', gold.ts(v_bt), 'loose', v_loose, 'looseTotal', gold.ts(v_lt), 'total', gold.ts(c.cash_value)),
    'goods', jsonb_build_object('total', gold.ts(c.goods_value), 'days', v_goods_rows, 'broughtForward', gold.ts(c.goods_value - v_goods_sum),
                                'lastSentOn', v_last_out, 'sent', v_sent),
    'owedToCustomers', gold.ts(c.payable_value),
    'allowance', jsonb_build_object('paid', gold.ts(v_allow), 'people', v_people),
    'closing', gold.ts(v_closing),
    'previous', case when v_prev_closing is null then null else jsonb_build_object('date', pd.business_date, 'closing', gold.ts(v_prev_closing)) end,
    'change', case when v_prev_closing is null then null else gold.ts(v_closing - v_prev_closing) end);
end $$;

create or replace function gold.daily_accounts_json(p_scope uuid[], p_branch uuid, p_date date) returns jsonb language plpgsql stable as $$
declare v_out jsonb;
begin
  if p_branch is not null and not (p_branch = any (coalesce(p_scope, '{}'))) then
    perform gold.fail(403, 'FORBIDDEN', 'You do not have access to that branch.');
  end if;
  select coalesce(jsonb_agg(gold.daily_account_json(b.id, p_date) order by b.is_main desc, b.name), '[]'::jsonb) into v_out
  from gold.branches b where b.is_active and b.id = any (coalesce(p_scope, '{}')) and (p_branch is null or b.id = p_branch);
  return jsonb_build_object('date', p_date, 'branches', v_out);
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;