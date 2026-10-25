-- 0006 Discrepancies: surplus, shortage and transfer differences become cases that managers work through.
-- The original records (reconciliation rows, ledger entries, transfer lines) are never edited. A case has a status,
-- an append-only action log, and any correction is a NEW ledger entry that points back at the case.

create table gold.discrepancies (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  branch_id           uuid not null,
  business_day_id     uuid,
  kind                text not null check (kind in ('opening_variance', 'closing_variance', 'transfer_receipt', 'other')),
  asset               text check (asset in ('cash', 'goods_top', 'goods_down', 'goods_value', 'debt')),
  reconciliation_id   uuid references gold.day_reconciliations (id),
  transfer_id         uuid,
  transfer_line_id    uuid references gold.transfer_goods_lines (id),
  expected            numeric(18,4),
  actual              numeric(18,4),
  difference          numeric(18,4),
  reported_explanation text,                                  -- the teller's words, copied at the time
  status              text not null default 'open' check (status in ('open', 'under_review', 'resolved', 'written_off')),
  assigned_to         uuid,
  opened_at           timestamptz not null default now(),
  opened_by           uuid,
  resolved_at         timestamptz,
  resolved_by         uuid,
  resolution_type     text check (resolution_type in ('explained', 'found', 'recovered', 'corrected_entry', 'written_off')),
  resolution_summary  text,
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id)       references gold.branches (tenant_id, id),
  foreign key (tenant_id, business_day_id) references gold.business_days (tenant_id, id),
  foreign key (tenant_id, transfer_id)     references gold.transfers (tenant_id, id),
  foreign key (tenant_id, assigned_to)     references gold.users (tenant_id, id),
  foreign key (tenant_id, resolved_by)     references gold.users (tenant_id, id),
  check (reconciliation_id is not null or transfer_id is not null or kind = 'other'),
  constraint closed_case_is_documented check (
    status in ('open', 'under_review')
    or (resolved_at is not null and resolved_by is not null and resolution_type is not null
        and gold.has_text(resolution_summary, 10))
  )
);
create unique index discrepancies_one_per_reconciliation on gold.discrepancies (reconciliation_id) where reconciliation_id is not null;
create unique index discrepancies_one_per_transfer_line  on gold.discrepancies (transfer_line_id) where transfer_line_id is not null;
create index discrepancies_open on gold.discrepancies (tenant_id, branch_id, status) where status in ('open', 'under_review');

create table gold.discrepancy_actions (
  id               bigint generated always as identity primary key,
  tenant_id        uuid not null,
  discrepancy_id   uuid not null,
  action_type      text not null check (action_type in (
                     'opened', 'note', 'assigned', 'status_changed', 'adjustment_posted', 'evidence_added', 'resolved', 'reopened')),
  from_status      text,
  to_status        text,
  note             text,
  ledger_entry_ids uuid[] not null default '{}',              -- corrections posted because of this action
  actor_user_id    uuid,
  occurred_at      timestamptz not null default now(),
  foreign key (tenant_id, discrepancy_id) references gold.discrepancies (tenant_id, id)
);
create index discrepancy_actions_case on gold.discrepancy_actions (discrepancy_id, id);
create trigger discrepancy_actions_immutable before update or delete on gold.discrepancy_actions
  for each row execute function gold.forbid_mutation();

-- Cases cannot be deleted, and every status change is logged by the database itself,
-- so the history is complete even if an application bug forgets to write it.
create function gold.discrepancy_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'discrepancies cannot be deleted' using errcode = 'integrity_constraint_violation';
  end if;
  if tg_op = 'INSERT' then
    insert into gold.discrepancy_actions (tenant_id, discrepancy_id, action_type, to_status, note, actor_user_id)
    values (new.tenant_id, new.id, 'opened', new.status, new.reported_explanation, coalesce(new.opened_by, gold.current_actor()));
    return new;
  end if;
  -- UPDATE: the facts of the case are frozen; only workflow fields may change.
  if (new.tenant_id, new.branch_id, new.business_day_id, new.kind, new.asset, new.reconciliation_id, new.transfer_id,
      new.transfer_line_id, new.expected, new.actual, new.difference, new.reported_explanation, new.opened_at)
     is distinct from
     (old.tenant_id, old.branch_id, old.business_day_id, old.kind, old.asset, old.reconciliation_id, old.transfer_id,
      old.transfer_line_id, old.expected, old.actual, old.difference, old.reported_explanation, old.opened_at) then
    raise exception 'the recorded facts of a discrepancy cannot be changed' using errcode = 'integrity_constraint_violation';
  end if;
  if new.status is distinct from old.status then
    insert into gold.discrepancy_actions (tenant_id, discrepancy_id, action_type, from_status, to_status, note, actor_user_id)
    values (new.tenant_id, new.id,
            case when old.status in ('resolved', 'written_off') then 'reopened'
                 when new.status in ('resolved', 'written_off') then 'resolved' else 'status_changed' end,
            old.status, new.status, new.resolution_summary, gold.current_actor());
  end if;
  return new;
end $$;
create trigger discrepancies_guard before delete on gold.discrepancies for each row execute function gold.discrepancy_guard();
create trigger discrepancies_guard_ins after insert on gold.discrepancies for each row execute function gold.discrepancy_guard();
create trigger discrepancies_guard_upd after update on gold.discrepancies for each row execute function gold.discrepancy_guard();
