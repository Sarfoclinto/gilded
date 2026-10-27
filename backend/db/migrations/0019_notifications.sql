-- 0019 Live updates and notifications (B7a).
--  Two things leave the database at commit time through Postgres NOTIFY on the channel gold_events:
--    changed       something open screens may need to refresh: { type, t (tenant), topic, b (branch ids, null = whole company) }
--    notification  something a person should read:             { type, t, u (user), n (notification id), kind, title, link }
--  The API listens and relays them over SignalR. Because this is done by triggers, it holds for every writer, not just the API.
--  Payloads carry no business figures. A NOTIFY is only delivered if the transaction commits, so nothing is announced that was rolled back.

create table gold.notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  user_id     uuid not null,
  kind        text not null,
  title       text not null,
  body        text,
  link        text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  foreign key (tenant_id, user_id) references gold.users (tenant_id, id) on delete cascade
);
create index notifications_inbox on gold.notifications (user_id, created_at desc);
create index notifications_unread on gold.notifications (user_id) where read_at is null;
alter table gold.notifications enable row level security;
alter table gold.notifications force row level security;
create policy tenant_isolation on gold.notifications
  using (tenant_id = gold.current_tenant()) with check (tenant_id = gold.current_tenant());

-- ---------------------------------------------------------------- publishing
create function gold.publish(p_tenant uuid, p_topic text, p_branches uuid[]) returns void language plpgsql as $$
begin
  perform pg_notify('gold_events', jsonb_build_object('type', 'changed', 't', p_tenant, 'topic', p_topic, 'b', to_jsonb(case when p_branches is null then null else array_remove(p_branches, null) end))::text);
end $$;

-- Tell the people who hold p_permission at any of p_branches (null = anywhere in the company), except the person who did it.
create function gold.notify(p_tenant uuid, p_kind text, p_title text, p_body text, p_link text, p_branches uuid[], p_permission text) returns int
language plpgsql as $$
declare v_tenant uuid := p_tenant; v_actor uuid := gold.current_actor(); r record; v_id uuid; n int := 0;
begin
  for r in
    select u.id from gold.users u
    where u.tenant_id = v_tenant and u.is_active and u.id is distinct from v_actor
      and exists (select 1 from gold.effective_permissions(u.id) p where p = p_permission)
      and (p_branches is null or exists (select 1 from gold.user_branch_ids(u.id) b where b = any(p_branches)))
  loop
    insert into gold.notifications (tenant_id, user_id, kind, title, body, link) values (v_tenant, r.id, p_kind, p_title, p_body, p_link) returning id into v_id;
    perform pg_notify('gold_events', jsonb_build_object('type', 'notification', 't', v_tenant, 'u', r.id, 'n', v_id, 'kind', p_kind, 'title', p_title, 'link', p_link)::text);
    n := n + 1;
  end loop;
  return n;
end $$;

create function gold.notify_user(p_tenant uuid, p_user uuid, p_kind text, p_title text, p_body text, p_link text) returns void language plpgsql as $$
declare v_tenant uuid := p_tenant; v_id uuid;
begin
  if p_user is null or p_user is not distinct from gold.current_actor() then return; end if;
  insert into gold.notifications (tenant_id, user_id, kind, title, body, link) values (v_tenant, p_user, p_kind, p_title, p_body, p_link) returning id into v_id;
  perform pg_notify('gold_events', jsonb_build_object('type', 'notification', 't', v_tenant, 'u', p_user, 'n', v_id, 'kind', p_kind, 'title', p_title, 'link', p_link)::text);
end $$;

-- ---------------------------------------------------------------- what is announced
-- Screens: refresh when these change.
create function gold.trg_publish_transfers() returns trigger language plpgsql as $$
declare v_name text; v_dest text;
begin
  perform gold.publish(new.tenant_id, 'transfers', array[new.origin_branch_id, new.destination_branch_id]);
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    select name into v_name from gold.branches where id = new.origin_branch_id;
    select name into v_dest from gold.branches where id = new.destination_branch_id;
    if new.status = 'released' then
      perform gold.notify(new.tenant_id, 'transfer_on_the_way', format('%s is on the way from %s', new.reference, v_name), null, '/transfers/' || new.id, array[new.destination_branch_id], 'transfers:receive');
    elsif new.status = 'received' then
      perform gold.notify(new.tenant_id, 'transfer_received', format('%s was received at %s', new.reference, v_dest), null, '/transfers/' || new.id, array[new.origin_branch_id], 'transfers:read');
    elsif new.status = 'received_with_discrepancy' then
      perform gold.notify(new.tenant_id, 'transfer_received', format('%s was received at %s with differences', new.reference, v_dest), null, '/transfers/' || new.id, array[new.origin_branch_id], 'transfers:read');
    end if;
  end if;
  return null;
end $$;
create trigger publish_transfers after insert or update on gold.transfers for each row execute function gold.trg_publish_transfers();

create function gold.trg_publish_discrepancy() returns trigger language plpgsql as $$
declare v_name text;
begin
  perform gold.publish(new.tenant_id, 'review', array[new.branch_id]);
  if tg_op = 'INSERT' then
    select name into v_name from gold.branches where id = new.branch_id;
    perform gold.notify(new.tenant_id, 'difference_opened', format('A difference needs a look at %s', v_name), null, '/review/cases', array[new.branch_id], 'discrepancies:review');
  end if;
  return null;
end $$;
create trigger publish_discrepancy after insert or update on gold.discrepancies for each row execute function gold.trg_publish_discrepancy();

create function gold.trg_publish_day() returns trigger language plpgsql as $$
declare v_name text;
begin
  perform gold.publish(new.tenant_id, 'days', array[new.branch_id]);
  if tg_op = 'UPDATE' and new.signoff_status is distinct from old.signoff_status then
    select name into v_name from gold.branches where id = new.branch_id;
    if new.signoff_status = 'pending' then
      perform gold.notify(new.tenant_id, 'signoff_needed', format('%s closed with differences: sign-off needed', v_name), null, '/drawer/history', array[new.branch_id], 'days:signoff');
    elsif new.signoff_status in ('approved', 'rejected') then
      perform gold.notify_user(new.tenant_id, new.closed_by, 'signoff_decided', format('Your closing at %s was %s', v_name, new.signoff_status), new.signoff_note, '/drawer/history');
    end if;
  end if;
  return null;
end $$;
create trigger publish_day after insert or update on gold.business_days for each row execute function gold.trg_publish_day();

create function gold.trg_publish_payment() returns trigger language plpgsql as $$
declare v_branch uuid; v_name text;
begin
  select t.branch_id into v_branch from gold.transactions t where t.id = new.transaction_id;
  perform gold.publish(new.tenant_id, 'payments', array[v_branch, new.paid_by_branch_id]);
  if tg_op = 'INSERT' and new.method = 'mobile_money' and new.status = 'pending' and new.paid_by_branch_id is not null then
    select name into v_name from gold.branches where id = v_branch;
    perform gold.notify(new.tenant_id, 'payment_to_send', format('Mobile money to send for a purchase at %s', v_name), null, '/payments', array[new.paid_by_branch_id], 'payments:confirm');
  end if;
  return null;
end $$;
create trigger publish_payment after insert or update on gold.transaction_payments for each row execute function gold.trg_publish_payment();

create function gold.trg_publish_price() returns trigger language plpgsql as $$
declare v_name text;
begin
  perform gold.publish(new.tenant_id, 'prices', array[new.branch_id]);
  select name into v_name from gold.branches where id = new.branch_id;
  if tg_op = 'INSERT' and new.status = 'provisional' then
    perform gold.notify(new.tenant_id, 'margin_to_approve', format('A margin for %s is waiting for approval', v_name), null, '/prices', null, 'prices:approve');
  elsif tg_op = 'INSERT' and new.status = 'approved' then
    perform gold.notify(new.tenant_id, 'price_updated', format('The price for %s was updated', v_name), null, '/prices', array[new.branch_id], 'transactions:create');
  end if;
  return null;
end $$;
create trigger publish_price after insert or update on gold.branch_prices for each row execute function gold.trg_publish_price();

create function gold.trg_publish_snapshot() returns trigger language plpgsql as $$
begin
  perform gold.publish(new.tenant_id, 'prices', null);
  return null;
end $$;
create trigger publish_snapshot after insert on gold.price_snapshots for each row execute function gold.trg_publish_snapshot();

-- Quiet signals: screens refresh, nobody is notified.
create function gold.trg_publish_quiet() returns trigger language plpgsql as $$
begin
  perform gold.publish(new.tenant_id, tg_argv[0], array[new.branch_id]);
  return null;
end $$;
create trigger publish_ledger       after insert on gold.ledger_entries for each row execute function gold.trg_publish_quiet('ledger');
create trigger publish_transactions after insert on gold.transactions   for each row execute function gold.trg_publish_quiet('transactions');
create trigger publish_debts        after insert or update on gold.debts for each row execute function gold.trg_publish_quiet('debts');

-- ---------------------------------------------------------------- the inbox
create function gold.notifications_json(p_limit int default 30, p_unread_only boolean default false) returns jsonb language plpgsql stable as $$
declare v_user uuid := gold.require_actor();
begin
  return jsonb_build_object(
    'unread', (select count(*) from gold.notifications where user_id = v_user and read_at is null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'link', n.link,
                'createdAt', gold.iso(n.created_at), 'read', n.read_at is not null) order by n.created_at desc)
              from (select * from gold.notifications where user_id = v_user and (not p_unread_only or read_at is null)
                    order by created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) n), '[]'::jsonb));
end $$;

-- ids = those notifications; null = all of mine.
create function gold.notifications_mark_read(p_ids uuid[]) returns jsonb language plpgsql as $$
declare v_user uuid := gold.require_actor();
begin
  update gold.notifications set read_at = now() where user_id = v_user and read_at is null and (p_ids is null or id = any(p_ids));
  return gold.notifications_json(30, false);
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant select, insert, update on gold.notifications to gold_app;
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;