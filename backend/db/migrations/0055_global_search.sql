-- 0055 (B54): global search. One question, answered across everything the person may see:
--   customers, purchases, transfers, debts and loans, gold held as security, mobile money, users, branches and guide articles.
--
--   * What a person may see is decided by the API (which groups, which branches) and passed in; this function never widens it.
--   * Every word typed must be found (in any order): "ama 0244" finds Ama whose phone has 0244. Case does not matter.
--   * Phone numbers are compared by their digits, so 0244 123 456, +233244123456 and 244123456 are the same number.
--   * A number is also tried as an amount: 8605 finds the purchase paid GHS 8,605.
--   * Customers are also found when the name is slightly misspelt (trigram similarity), ranked below exact finds.
--   * Results are ranked: an exact reference or name first, then names that start with what was typed, then the rest; newest first within a rank.
--   * Each group returns its best few with the figures a person needs to recognise the right one without opening it, and how many there are in all.
create extension if not exists pg_trgm;

-- Finding by a piece of text stays fast as the books grow.
create index if not exists transactions_search_trgm on gold.transactions
  using gin ((customer_name || ' ' || reference || ' ' || coalesce(customer_phone, '')) gin_trgm_ops);
create index if not exists customers_search_trgm on gold.customers
  using gin ((name || ' ' || coalesce(phone, '')) gin_trgm_ops);

-- A phone number as its last nine digits: what is left after spaces, dashes, a leading 0 or the country code.
create function gold.phone_key(p text) returns text language sql immutable as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9), '')
$$;

-- Are all the words in the text? (words are already lower case)
create function gold.has_words(p_text text, p_words text[]) returns boolean language sql immutable as $$
  select coalesce(bool_and(position(w in lower(coalesce(p_text, ''))) > 0), false) from unnest(p_words) w
$$;

-- p: { q, scope: [branch ids], groups: [keys the person may search], group?: one key (then more of it), limit? }
create function gold.global_search(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_q text := lower(regexp_replace(trim(coalesce(p->>'q', '')), '\s+', ' ', 'g'));
  v_scope uuid[] := array(select jsonb_array_elements_text(coalesce(p->'scope', '[]'::jsonb))::uuid);
  v_groups text[] := array(select jsonb_array_elements_text(coalesce(p->'groups', '[]'::jsonb)));
  v_only text := nullif(p->>'group', '');
  v_limit int := least(greatest(coalesce((p->>'limit')::int, case when nullif(p->>'group', '') is null then 5 else 25 end), 1), 50);
  v_words text[]; v_long text; v_like text; v_digits text; v_pk text; v_num numeric; v_fuzzy boolean;
  v_out jsonb := '[]'::jsonb; g jsonb;
begin
  if char_length(v_q) > 80 then v_q := left(v_q, 80); end if;
  if char_length(v_q) < 2 then return jsonb_build_object('q', v_q, 'groups', '[]'::jsonb); end if;
  if v_only is not null then
    if not (v_only = any (v_groups)) then perform gold.fail(403, 'FORBIDDEN', 'You do not have permission for this.'); end if;
    v_groups := array[v_only];
  end if;

  v_words := string_to_array(v_q, ' ');
  -- the longest word goes to the index; the others are checked on what it finds
  select w into v_long from unnest(v_words) w order by char_length(w) desc, w limit 1;
  v_like := '%' || replace(replace(replace(v_long, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  -- as a phone number: its digits without a leading 0 or 233, when there are enough to mean something
  v_digits := regexp_replace(v_q, '\D', '', 'g');
  if v_q ~ '^[\d\s+()-]+$' and char_length(v_digits) >= 4 then
    v_pk := right(regexp_replace(v_digits, '^(233|0)', ''), 9);
  end if;
  -- as an amount: "8605", "8,605" or "8605.50"
  if v_q ~ '^\d[\d,]*(\.\d{1,2})?$' and char_length(v_digits) between 2 and 12 then
    v_num := replace(v_q, ',', '')::numeric;
  end if;
  v_fuzzy := char_length(v_q) >= 4 and v_pk is null;

  -- ---------------------------------------------------------------- customers (company-wide, like the customer list)
  if 'customers' = any (v_groups) then
    with hits as (
      select c.id, c.name, c.phone, c.created_at,
             greatest(
               case when lower(c.name) = v_q then 100
                    when lower(c.name) like replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' then 90
                    when gold.has_words(c.name || ' ' || coalesce(c.phone, ''), v_words) then 70 else 0 end,
               case when v_pk is not null and gold.phone_key(c.phone) = v_pk then 96
                    when v_pk is not null and position(v_pk in coalesce(gold.phone_key(c.phone), '')) > 0 then 75 else 0 end,
               case when v_fuzzy then (50 * word_similarity(v_q, lower(c.name)))::int else 0 end) as score
      from gold.customers c
      where ((c.name || ' ' || coalesce(c.phone, '')) ilike v_like and gold.has_words(c.name || ' ' || coalesce(c.phone, ''), v_words))
         or (v_pk is not null and position(v_pk in coalesce(gold.phone_key(c.phone), '')) > 0)
         or (v_fuzzy and word_similarity(v_q, lower(c.name)) >= 0.5)
    ), top as (
      select h.*, (select max(t.captured_at) from gold.transactions t where t.customer_id = h.id and t.status <> 'void') as last_at
      from hits h order by h.score desc, lower(h.name), h.id limit 200
    ), picked as (
      select * from top order by score desc, last_at desc nulls last, lower(name) limit v_limit
    )
    select jsonb_build_object('key', 'customers', 'total', (select count(*) from hits),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', x.id, 'name', x.name, 'phone', x.phone, 'score', x.score, 'close', x.score < 60,
          'purchases', (select count(*) from gold.transactions t where t.customer_id = x.id and t.status <> 'void'),
          'lastPurchaseAt', case when x.last_at is null then null else gold.iso(x.last_at) end,
          'lastAmount', (select gold.ts(t.payable) from gold.transactions t where t.customer_id = x.id and t.status <> 'void' order by t.captured_at desc limit 1),
          'owes', case when 'debts' = any (v_groups) or v_only = 'customers' and 'debts' = any (array(select jsonb_array_elements_text(coalesce(p->'groups', '[]'::jsonb))))
                       then (select gold.ts(coalesce(sum(d.outstanding), 0)) from gold.v_debts_outstanding d
                             where d.customer_id = x.id and d.status = 'open' and d.direction = 'receivable' and d.branch_id = any (v_scope)) end)
          order by x.score desc, x.last_at desc nulls last, lower(x.name)) from picked x), '[]'::jsonb)) into g;
    v_out := v_out || g;
  end if;

  -- ---------------------------------------------------------------- purchases
  if 'purchases' = any (v_groups) then
    with hits as (
      select t.id, t.captured_at,
             greatest(
               case when lower(t.reference) = v_q then 100
                    when position(v_q in lower(t.reference)) > 0 then 88
                    when gold.has_words(t.customer_name || ' ' || t.reference || ' ' || coalesce(t.customer_phone, ''), v_words) then 70 else 0 end,
               case when v_pk is not null and position(v_pk in coalesce(gold.phone_key(t.customer_phone), '')) > 0 then 75 else 0 end,
               case when v_num is not null and t.payable = v_num then 80 else 0 end) as score
      from gold.transactions t
      where t.branch_id = any (v_scope)
        and (((t.customer_name || ' ' || t.reference || ' ' || coalesce(t.customer_phone, '')) ilike v_like
              and gold.has_words(t.customer_name || ' ' || t.reference || ' ' || coalesce(t.customer_phone, ''), v_words))
             or (v_pk is not null and position(v_pk in coalesce(gold.phone_key(t.customer_phone), '')) > 0)
             or (v_num is not null and t.payable = v_num))
    ), picked as (
      select * from hits order by score desc, captured_at desc, id limit v_limit
    )
    select jsonb_build_object('key', 'purchases', 'total', (select count(*) from hits),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', t.id, 'reference', t.reference, 'customerId', t.customer_id, 'customerName', t.customer_name, 'customerPhone', t.customer_phone,
          'amount', gold.ts(t.payable), 'status', t.status, 'capturedAt', gold.iso(t.captured_at), 'branch', b.name, 'flagged', cardinality(t.flags) > 0, 'score', x.score,
          'top', (select gold.ts(sum(i.top)) from gold.transaction_items i where i.transaction_id = t.id),
          'down', (select gold.ts(sum(i.down)) from gold.transaction_items i where i.transaction_id = t.id),
          'karat', (select gold.ts(i.karat) from gold.transaction_items i where i.transaction_id = t.id order by i.line_no limit 1),
          'items', (select count(*) from gold.transaction_items i where i.transaction_id = t.id))
          order by x.score desc, t.captured_at desc, t.id)
        from picked x join gold.transactions t on t.id = x.id join gold.branches b on b.id = t.branch_id), '[]'::jsonb)) into g;
    v_out := v_out || g;
  end if;

  -- ---------------------------------------------------------------- debts and loans
  if 'debts' = any (v_groups) then
    with hits as (
      select d.id, d.issued_at, d.outstanding, d.status,
             case when lower(d.party_name) = v_q then 100 when v_num is not null and (d.principal = v_num or d.outstanding = v_num) then 80 else 70 end as score
      from gold.v_debts_outstanding d left join gold.customers c on c.id = d.customer_id
      where d.branch_id = any (v_scope)
        and (gold.has_words(d.party_name || ' ' || d.reason || ' ' || coalesce(c.phone, ''), v_words)
             or (v_pk is not null and position(v_pk in coalesce(gold.phone_key(c.phone), '')) > 0)
             or (v_num is not null and (d.principal = v_num or d.outstanding = v_num)))
    ), picked as (
      select * from hits order by (status = 'open') desc, score desc, issued_at desc, id limit v_limit
    )
    select jsonb_build_object('key', 'debts', 'total', (select count(*) from hits),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', d.id, 'name', d.party_name, 'customerId', d.customer_id, 'direction', d.direction, 'status', d.status, 'reason', d.reason,
          'principal', gold.ts(d.principal), 'outstanding', gold.ts(d.outstanding), 'issuedAt', gold.iso(d.issued_at),
          'dueDate', d.due_date, 'branch', b.name, 'score', x.score)
          order by (d.status = 'open') desc, x.score desc, d.issued_at desc, d.id)
        from picked x join gold.v_debts_outstanding d on d.id = x.id join gold.branches b on b.id = d.branch_id), '[]'::jsonb)) into g;
    v_out := v_out || g;
  end if;

  -- ---------------------------------------------------------------- gold held as security
  if 'held' = any (v_groups) then
    with hits as (
      select h.id, h.received_at, h.status
      from gold.collateral_holdings h join gold.customers c on c.id = h.customer_id
      where h.branch_id = any (v_scope)
        and (gold.has_words(c.name || ' ' || coalesce(c.phone, '') || ' ' || coalesce(h.description, ''), v_words)
             or (v_pk is not null and position(v_pk in coalesce(gold.phone_key(c.phone), '')) > 0))
    ), picked as (
      select * from hits order by (status = 'held') desc, received_at desc, id limit v_limit
    )
    select jsonb_build_object('key', 'held', 'total', (select count(*) from hits),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', h.id, 'customerId', h.customer_id, 'name', c.name, 'phone', c.phone, 'topWeight', gold.ts(h.top_weight), 'status', h.status,
          'description', h.description, 'receivedAt', gold.iso(h.received_at), 'branch', b.name)
          order by (h.status = 'held') desc, h.received_at desc, h.id)
        from picked x join gold.collateral_holdings h on h.id = x.id join gold.customers c on c.id = h.customer_id join gold.branches b on b.id = h.branch_id), '[]'::jsonb)) into g;
    v_out := v_out || g;
  end if;

  -- ---------------------------------------------------------------- transfers (either end in the person's branches)
  if 'transfers' = any (v_groups) then
    with hits as (
      select t.id, t.created_at,
             case when lower(t.reference) = v_q then 100 when position(v_q in lower(t.reference)) > 0 then 88 else 70 end as score
      from gold.transfers t join gold.branches o on o.id = t.origin_branch_id join gold.branches d on d.id = t.destination_branch_id
      where (t.origin_branch_id = any (v_scope) or t.destination_branch_id = any (v_scope))
        and gold.has_words(t.reference || ' ' || coalesce(t.collector_name, '') || ' ' || coalesce(t.collector_phone, '') || ' ' || o.name || ' ' || d.name, v_words)
    ), picked as (
      select * from hits order by score desc, created_at desc, id limit v_limit
    )
    select jsonb_build_object('key', 'transfers', 'total', (select count(*) from hits),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', t.id, 'reference', t.reference, 'kind', t.kind, 'status', t.status, 'from', o.name, 'to', d.name,
          'collector', t.collector_name, 'cash', case when t.declared_cash is null then null else gold.ts(t.declared_cash) end,
          'createdAt', gold.iso(t.created_at), 'score', x.score)
          order by x.score desc, t.created_at desc, t.id)
        from picked x join gold.transfers t on t.id = x.id join gold.branches o on o.id = t.origin_branch_id join gold.branches d on d.id = t.destination_branch_id), '[]'::jsonb)) into g;
    v_out := v_out || g;
  end if;

  -- ---------------------------------------------------------------- mobile money (found by its reference, the purchase or the customer)
  if 'payments' = any (v_groups) then
    with hits as (
      select m.id, m.created_at,
             case when lower(coalesce(m.external_ref, '')) = v_q then 100 when v_num is not null and m.amount = v_num then 80 else 70 end as score
      from gold.transaction_payments m join gold.transactions t on t.id = m.transaction_id
      where m.method = 'mobile_money' and (t.branch_id = any (v_scope) or m.paid_by_branch_id = any (v_scope))
        and (gold.has_words(coalesce(m.external_ref, '') || ' ' || t.reference || ' ' || t.customer_name || ' ' || coalesce(t.customer_phone, ''), v_words)
             or (v_pk is not null and position(v_pk in coalesce(gold.phone_key(t.customer_phone), '')) > 0)
             or (v_num is not null and m.amount = v_num))
    ), picked as (
      select * from hits order by score desc, created_at desc, id limit v_limit
    )
    select jsonb_build_object('key', 'payments', 'total', (select count(*) from hits),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', m.id, 'transactionId', t.id, 'reference', t.reference, 'customerName', t.customer_name, 'amount', gold.ts(m.amount),
          'status', m.status, 'externalRef', m.external_ref, 'createdAt', gold.iso(m.created_at), 'score', x.score)
          order by x.score desc, m.created_at desc, m.id)
        from picked x join gold.transaction_payments m on m.id = x.id join gold.transactions t on t.id = m.transaction_id), '[]'::jsonb)) into g;
    v_out := v_out || g;
  end if;

  -- ---------------------------------------------------------------- users
  if 'users' = any (v_groups) then
    with hits as (
      select u.id, u.display_name, u.is_active,
             case when lower(u.display_name) = v_q or lower(u.username::text) = v_q then 100 else 70 end as score
      from gold.users u
      where gold.has_words(u.display_name || ' ' || u.username::text || ' ' || coalesce(u.phone, ''), v_words)
         or (v_pk is not null and position(v_pk in coalesce(gold.phone_key(u.phone), '')) > 0)
    ), picked as (
      select * from hits order by is_active desc, score desc, lower(display_name), id limit v_limit
    )
    select jsonb_build_object('key', 'users', 'total', (select count(*) from hits),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', u.id, 'name', u.display_name, 'username', u.username, 'role', r.name, 'active', u.is_active, 'score', x.score)
          order by u.is_active desc, x.score desc, lower(u.display_name), u.id)
        from picked x join gold.users u on u.id = x.id left join gold.roles r on r.id = u.role_id), '[]'::jsonb)) into g;
    v_out := v_out || g;
  end if;

  -- ---------------------------------------------------------------- branches
  if 'branches' = any (v_groups) then
    with hits as (
      select b.id, b.name, b.is_active from gold.branches b where gold.has_words(b.name || ' ' || b.code, v_words)
    ), picked as (
      select * from hits order by is_active desc, lower(name), id limit v_limit
    )
    select jsonb_build_object('key', 'branches', 'total', (select count(*) from hits),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'code', b.code, 'active', b.is_active, 'main', b.is_main)
          order by b.is_active desc, lower(b.name), b.id)
        from picked x join gold.branches b on b.id = x.id), '[]'::jsonb)) into g;
    v_out := v_out || g;
  end if;

  -- ---------------------------------------------------------------- guide articles (published ones; everyone may read the guide)
  if 'guide' = any (v_groups) then
    with hits as (
      select a.id, a.title, a.published_at,
             case when position(v_q in lower(a.title)) > 0 then 90 else 70 end as score
      from gold.guide_articles a
      where a.status = 'published' and gold.has_words(a.title || ' ' || coalesce(a.summary, ''), v_words)
    ), picked as (
      select * from hits order by score desc, lower(title), id limit v_limit
    )
    select jsonb_build_object('key', 'guide', 'total', (select count(*) from hits),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'summary', a.summary, 'kind', a.kind, 'score', x.score)
          order by x.score desc, lower(a.title), a.id)
        from picked x join gold.guide_articles a on a.id = x.id), '[]'::jsonb)) into g;
    v_out := v_out || g;
  end if;

  -- groups with nothing found are left out
  return jsonb_build_object('q', v_q,
    'groups', coalesce((select jsonb_agg(x order by ord) from jsonb_array_elements(v_out) with ordinality as t(x, ord) where (x->>'total')::int > 0), '[]'::jsonb));
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then grant execute on all functions in schema gold to gold_app; end if;
end $$;