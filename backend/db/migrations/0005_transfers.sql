-- 0005 Goods and cash movements between branches (collections, deliveries, restocking).
--
-- A transfer is a document with a lifecycle and a permanent event trail:
--   draft -> released (handed to the collector; goods leave the origin) -> received | received_with_discrepancy
--   draft/released -> cancelled (with a reason)
-- Goods leave the origin's ledger at release and enter the destination's ledger at receipt, for the weights and
-- value the receiver actually confirmed. Anything released but not received is a discrepancy case, never a silent gap.

create table gold.transfers (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null,
  reference               text not null,                       -- TRF-KSI-20261022-0001
  origin_branch_id        uuid not null,
  destination_branch_id   uuid not null,
  purpose                 text not null check (purpose in ('stock_collection', 'restock_funding', 'cash_return', 'payment_on_collection', 'other')),
  purpose_note            text,
  method                  text not null check (method in ('collector_from_destination', 'staff_travelling', 'designated_courier', 'branch_delivery', 'other')),
  status                  text not null default 'draft' check (status in ('draft', 'released', 'received', 'received_with_discrepancy', 'cancelled')),
  -- Who released it at the origin
  released_by             uuid,
  released_at             timestamptz,
  release_note            text,
  -- Who physically carries it: a staff member (user) or someone outside the system
  collector_type          text check (collector_type in ('staff', 'external')),
  collector_user_id       uuid,
  collector_name          text,
  collector_phone         text,
  collector_id_type       text,
  collector_id_number     text,
  collector_relationship  text,                                -- e.g. "sent by Kumasi manager"
  collected_at            timestamp with time zone,            -- handover moment
  expected_arrival_at     timestamptz,
  -- Totals as released (sum of the lines, frozen at release)
  declared_top            numeric(14,4),
  declared_down           numeric(14,4),
  declared_value          numeric(18,2),
  -- Who received it at the destination, and what they confirmed
  received_by             uuid,
  received_at             timestamptz,
  received_top            numeric(14,4),
  received_down           numeric(14,4),
  received_value          numeric(18,2),
  receipt_note            text,
  cancelled_at            timestamptz,
  cancelled_by            uuid,
  cancel_reason           text,
  created_by              uuid not null,
  created_at              timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, reference),
  foreign key (tenant_id, origin_branch_id)      references gold.branches (tenant_id, id),
  foreign key (tenant_id, destination_branch_id) references gold.branches (tenant_id, id),
  foreign key (tenant_id, released_by)           references gold.users (tenant_id, id),
  foreign key (tenant_id, collector_user_id)     references gold.users (tenant_id, id),
  foreign key (tenant_id, received_by)           references gold.users (tenant_id, id),
  foreign key (tenant_id, cancelled_by)          references gold.users (tenant_id, id),
  foreign key (tenant_id, created_by)            references gold.users (tenant_id, id),
  check (origin_branch_id <> destination_branch_id),
  check (collector_type is distinct from 'staff' or collector_user_id is not null),
  check (collector_type is distinct from 'external' or gold.has_text(collector_name, 1)),
  -- Released means a named releaser, a named collector, a handover time and frozen totals.
  constraint released_is_complete check (
    status in ('draft', 'cancelled')
    or (released_by is not null and released_at is not null and collector_type is not null
        and collected_at is not null and declared_top is not null and declared_down is not null and declared_value is not null)
  ),
  constraint received_is_complete check (
    status not in ('received', 'received_with_discrepancy')
    or (received_by is not null and received_at is not null
        and received_top is not null and received_down is not null and received_value is not null)
  ),
  constraint cancelled_is_complete check (
    status <> 'cancelled' or (cancelled_at is not null and cancelled_by is not null and gold.has_text(cancel_reason, 5))
  )
);
create index transfers_origin      on gold.transfers (tenant_id, origin_branch_id, created_at desc);
create index transfers_destination on gold.transfers (tenant_id, destination_branch_id, created_at desc);
create index transfers_open        on gold.transfers (tenant_id, status) where status in ('draft', 'released');

-- What was in it. Normally a customer's item (full traceability); a line without an item (legacy or bulk stock)
-- must say what it is.
create table gold.transfer_goods_lines (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  transfer_id         uuid not null,
  line_no             smallint not null check (line_no > 0),
  transaction_item_id uuid,
  description         text,
  released_top        numeric(14,4) not null check (released_top >= 0),
  released_down       numeric(14,4) not null check (released_down >= 0),
  released_value      numeric(18,2) not null check (released_value >= 0),
  received_top        numeric(14,4),
  received_down       numeric(14,4),
  received_value      numeric(18,2),
  outcome             text not null default 'pending' check (outcome in ('pending', 'matched', 'differs', 'missing')),
  unique (transfer_id, line_no),
  foreign key (tenant_id, transfer_id)         references gold.transfers (tenant_id, id),
  foreign key (tenant_id, transaction_item_id) references gold.transaction_items (tenant_id, id),
  check (transaction_item_id is not null or gold.has_text(description, 1)),
  check (outcome = 'pending' or (received_top is not null and received_down is not null and received_value is not null) or outcome = 'missing')
);
create index transfer_goods_lines_item on gold.transfer_goods_lines (transaction_item_id) where transaction_item_id is not null;

-- Money that changed hands because of the transfer (paying the collector, or the collector paying on collection).
-- Cash payments also have note-level ledger rows (source_type 'transfer_payment', source_id = this id).
create table gold.transfer_payments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  transfer_id   uuid not null,
  direction     text not null check (direction in ('paid_to_collector', 'received_from_collector')),
  amount        numeric(18,2) not null check (amount > 0),
  method        text not null check (method in ('cash', 'mobile_money', 'bank', 'other')),
  purpose       text not null check (gold.has_text(purpose, 1)),
  external_ref  text,
  paid_at       timestamptz not null,
  recorded_by   uuid not null,
  note          text,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, transfer_id)  references gold.transfers (tenant_id, id),
  foreign key (tenant_id, recorded_by)  references gold.users (tenant_id, id)
);
create trigger transfer_payments_immutable before update or delete on gold.transfer_payments
  for each row execute function gold.forbid_mutation();

-- The permanent story of a transfer. Anything management asks ("who released it, when did it arrive,
-- who changed the collector?") is answered from here.
create table gold.transfer_events (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null,
  transfer_id   uuid not null,
  event_type    text not null check (event_type in (
                  'created', 'goods_added', 'goods_removed', 'collector_set', 'released', 'payment_recorded',
                  'received', 'discrepancy_flagged', 'note_added', 'cancelled', 'attachment_added')),
  actor_user_id uuid,
  occurred_at   timestamptz not null,
  recorded_at   timestamptz not null default now(),
  data          jsonb not null default '{}'::jsonb,
  foreign key (tenant_id, transfer_id) references gold.transfers (tenant_id, id)
);
create index transfer_events_transfer on gold.transfer_events (transfer_id, id);
create trigger transfer_events_immutable before update or delete on gold.transfer_events
  for each row execute function gold.forbid_mutation();
