-- 0034 Two people editing one customer: the second save is refused (with a clear message) when it would overwrite a field the first one changed.

create or replace function gold.update_customer(p_id uuid, p jsonb) returns jsonb language plpgsql as $$
declare c gold.customers; v_before jsonb; v_name text; v_phone text;
begin
  perform gold.require_actor();
  select * into c from gold.customers where id = p_id for update;
  if not found then perform gold.fail(404, 'NOT_FOUND', 'Customer was not found.'); end if;
  v_before := gold.customer_row_json(c);
  -- Someone else saved this customer after this person opened it: say so instead of silently overwriting their change.
  if jsonb_typeof(p->'expected') = 'object' then
    if (p ? 'name' and p->'expected' ? 'name' and trim(coalesce(p->'expected'->>'name', '')) is distinct from c.name)
       or (p ? 'phone' and p->'expected' ? 'phone' and nullif(regexp_replace(coalesce(p->'expected'->>'phone', ''), '\s', '', 'g'), '') is distinct from c.phone)
       or (p ? 'notes' and p->'expected' ? 'notes' and nullif(trim(coalesce(p->'expected'->>'notes', '')), '') is distinct from c.notes) then
      perform gold.fail(409, 'EDIT_CONFLICT', 'Someone else changed this customer while you were editing. Close this and open the customer again to see their change.');
    end if;
  end if;
  v_name := case when p ? 'name' then trim(coalesce(p->>'name', '')) else c.name end;
  v_phone := case when p ? 'phone' then nullif(regexp_replace(coalesce(p->>'phone', ''), '\s', '', 'g'), '') else c.phone end;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the customer''s name.'); end if;
  if v_phone is null or char_length(v_phone) < 6 then perform gold.fail(422, 'VALIDATION_FAILED', 'Enter the customer''s phone number.'); end if;
  if exists (select 1 from gold.customers where id <> p_id and lower(name) = lower(v_name) and phone = v_phone) then
    perform gold.fail(409, 'DUPLICATE_CUSTOMER', 'Another customer has this name and phone number. Merge them instead.');
  end if;
  update gold.customers set name = v_name, phone = v_phone,
         notes = case when p ? 'notes' then nullif(trim(coalesce(p->>'notes', '')), '') else notes end
  where id = p_id;
  -- Names on debts follow the customer. Receipts keep the name used on the day.
  update gold.debts set party_name = v_name where customer_id = p_id and party_type = 'customer';
  perform gold.audit('customer.updated', 'customer', p_id::text, v_before, gold.customer_row_json((select x from gold.customers x where x.id = p_id)));
  return gold.customer_detail_json(p_id);
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then
    grant execute on all functions in schema gold to gold_app;
  end if;
end $$;