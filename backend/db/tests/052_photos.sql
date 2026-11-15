-- B60: pictures attach to transfers and people, are stored once, can be taken off the screen (never erased), and never block anything.
do $$
declare
  t uuid := gen_random_uuid(); tkw uuid := gen_random_uuid(); ksi uuid := gen_random_uuid(); acc uuid := gen_random_uuid();
  r_t uuid := gen_random_uuid(); teller uuid := gen_random_uuid(); other uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  tx uuid := gen_random_uuid(); items uuid[]; trf uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid(); me1 uuid := gen_random_uuid(); me2 uuid := gen_random_uuid();
  r jsonb; x text; hash text := repeat('ab', 32);
begin
  insert into gold.tenants (id, slug, name) values (t, 'photos60', 'Photo Gold');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main) values (tkw, t, 'TKW', 'Tarkwa', false), (ksi, t, 'KSI', 'Kumasi', true), (acc, t, 'ACC', 'Accra', false);
  insert into gold.roles (id, tenant_id, key, name, is_system) values (r_t, t, 'teller', 'Teller', true);
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (teller, t, 'ama', 'Ama', 'x', r_t), (other, t, 'kofi', 'Kofi', 'x', r_t), (outsider, t, 'yaw', 'Yaw', 'x', r_t);
  insert into gold.user_branches (tenant_id, user_id, branch_id) values (t, teller, tkw), (t, other, ksi), (t, outsider, acc);
  insert into gold.formula_versions (tenant_id, key, params) values (t, 'ExcelV1', '{}');
  set local role gold_app;
  perform set_config('app.user_id', teller::text, true);
  perform gold.open_day(jsonb_build_object('id', gen_random_uuid(), 'branchId', tkw, 'businessDate', current_date, 'lines', '{"100":100}'::jsonb, 'capturedAt', now()));
  perform gold.post_transaction(jsonb_build_object('id', tx, 'branchId', tkw, 'customer', jsonb_build_object('name', 'Kwesi'),
    'items', jsonb_build_array(gold_test.item(), gold_test.item()), 'formulaVersion', 'ExcelV1', 'clientAmount', '2000', 'calculatedAmount', '2000',
    'policy', 'down', 'strategy', 'fewest-notes', 'payable', 2000, 'difference', 0, 'capturedAt', now(), 'priceAsOf', now(), 'flags', '[]'::jsonb,
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 2000, 'lines', '{"100":20}'::jsonb))));
  select array_agg(id order by line_no) into items from gold.transaction_items where transaction_id = tx;
  perform gold.create_transfer(jsonb_build_object('id', trf, 'kind', 'goods', 'originBranchId', tkw, 'destinationBranchId', ksi, 'purpose', 'stock_collection', 'method', 'staff_travelling', 'itemIds', jsonb_build_array(items[1])), array[tkw]);

  -- a new transfer shows no pictures, and that blocks nothing
  r := gold.transfer_json(trf);
  perform gold_test.assert((r#>>'{photos,release}')::int = 0 and (r#>>'{photos,receive}')::int = 0, 'no pictures yet: ' || (r->'photos')::text);

  -- add a picture at hand-over; sending it twice stores it once
  r := gold.add_attachment(jsonb_build_object('id', p1, 'entityType', 'transfer', 'entityId', trf, 'slot', 'release', 'storageKey', 'k/p1.jpg', 'thumbKey', 'k/p1.t.jpg',
        'size', 123456, 'sha256', hash, 'width', 1200, 'height', 1600, 'takenAt', now(), 'source', 'camera', 'stamped', true), array[tkw]);
  perform gold_test.assert((r->>'replayed')::boolean = false and r#>>'{data,slot}' = 'release' and r#>>'{data,by,name}' is not null or r#>>'{data,id}' = p1::text, 'stored: ' || r::text);
  r := gold.add_attachment(jsonb_build_object('id', p1, 'entityType', 'transfer', 'entityId', trf, 'slot', 'release', 'storageKey', 'k/p1.jpg', 'size', 123456, 'sha256', hash), array[tkw]);
  perform gold_test.assert((r->>'replayed')::boolean and (select count(*) from gold.attachments where id = p1) = 1, 'the same picture sent twice is stored once');
  perform gold_test.assert((gold.transfer_json(trf)#>>'{photos,release}')::int = 1, 'the transfer counts it');
  perform gold_test.assert((select count(*) from gold.transfer_events where transfer_id = trf and event_type = 'attachment_added') = 1, 'the timeline says a picture was added once');

  -- somebody else cannot take over the same id; a stranger's branch cannot see or add to the transfer
  perform set_config('app.user_id', outsider::text, true);
  x := gold_test.code_of(format($q$select gold.add_attachment(jsonb_build_object('id', %L, 'entityType', 'transfer', 'entityId', %L, 'slot', 'release', 'storageKey', 'k', 'size', 1, 'sha256', %L), array[%L::uuid])$q$, p1, trf, hash, acc));
  perform gold_test.assert(x = 'ATTACHMENT_ID_TAKEN', 'a used id is refused: ' || x);
  x := gold_test.code_of(format($q$select gold.add_attachment(jsonb_build_object('id', %L, 'entityType', 'transfer', 'entityId', %L, 'slot', 'release', 'storageKey', 'k', 'size', 1, 'sha256', %L), array[%L::uuid])$q$, p2, trf, hash, acc));
  perform gold_test.assert(x = 'NOT_FOUND', 'a branch outside the transfer cannot add: ' || x);
  perform gold_test.assert(gold.attachments_json('transfer', trf, array[acc]) = '[]'::jsonb, 'and cannot list it');
  perform gold_test.assert(gold.attachment_file(p1, array[acc]) is null, 'nor fetch the file');

  -- the receiving branch adds its own, which counts at receipt
  perform set_config('app.user_id', other::text, true);
  perform gold.add_attachment(jsonb_build_object('id', p2, 'entityType', 'transfer', 'entityId', trf, 'slot', 'receive', 'storageKey', 'k/p2.jpg', 'size', 99, 'sha256', hash, 'source', 'library'), array[ksi]);
  r := gold.transfer_json(trf);
  perform gold_test.assert((r#>>'{photos,release}')::int = 1 and (r#>>'{photos,receive}')::int = 1, 'one at each end: ' || (r->'photos')::text);
  perform gold_test.assert(jsonb_array_length(gold.attachments_json('transfer', trf, array[ksi])) = 2, 'both ends see both pictures');
  perform gold_test.assert((select branch_id from gold.attachments where id = p2) = ksi and (select branch_id from gold.attachments where id = p1) = tkw, 'each is filed under its own branch');
  x := gold_test.code_of(format($q$select gold.add_attachment(jsonb_build_object('id', %L, 'entityType', 'transfer', 'entityId', %L, 'slot', 'bogus', 'storageKey', 'k', 'size', 1, 'sha256', %L), array[%L::uuid])$q$, p3, trf, hash, ksi));
  perform gold_test.assert(x = 'VALIDATION_FAILED', 'an unknown place is refused: ' || x);

  -- removing: the uploader may; another teller may not unless allowed; the row stays for the record
  x := gold_test.code_of(format($q$select gold.remove_attachment(%L, 'oops', false, array[%L::uuid])$q$, p1, ksi));
  perform gold_test.assert(x = 'FORBIDDEN', 'another person cannot remove it: ' || x);
  perform gold.remove_attachment(p1, 'wrong gold', true, array[ksi]);
  perform gold_test.assert((gold.transfer_json(trf)#>>'{photos,release}')::int = 0, 'a removed picture no longer counts (back to no photo)');
  perform gold_test.assert((select count(*) from gold.attachments where id = p1) = 1 and (select count(*) from gold.attachment_removals where attachment_id = p1) = 1, 'but the record stays');
  perform gold_test.assert(gold.attachment_file(p1, array[ksi]) is null, 'and it is not served');
  perform gold.remove_attachment(p1, 'again', true, array[ksi]);
  perform gold_test.assert((select count(*) from gold.attachment_removals where attachment_id = p1) = 1, 'removing twice is harmless');
  perform gold_test.assert((select count(*) from gold.audit_events where action = 'attachment.remove') = 1, 'the removal is on the audit trail');

  -- profile pictures: only your own; the newest wins; removing it falls back to the one before
  perform set_config('app.user_id', teller::text, true);
  x := gold_test.code_of(format($q$select gold.add_attachment(jsonb_build_object('id', %L, 'entityType', 'user', 'entityId', %L, 'storageKey', 'k', 'size', 1, 'sha256', %L), array[%L::uuid])$q$, p3, other, hash, tkw));
  perform gold_test.assert(x = 'FORBIDDEN', 'you cannot change somebody else''s picture: ' || x);
  perform gold.add_attachment(jsonb_build_object('id', me1, 'entityType', 'user', 'entityId', teller, 'storageKey', 'k/me1.jpg', 'size', 10, 'sha256', hash), array[tkw]);
  perform pg_sleep(0.01);
  perform gold.add_attachment(jsonb_build_object('id', me2, 'entityType', 'user', 'entityId', teller, 'storageKey', 'k/me2.jpg', 'size', 10, 'sha256', hash), array[tkw]);
  perform gold_test.assert(gold.profile_picture_id(teller) = me2, 'the newest profile picture wins');
  perform gold.remove_attachment(me2, null, false, array[tkw]);
  perform gold_test.assert(gold.profile_picture_id(teller) = me1, 'removing it shows the one before');
  perform gold_test.assert(gold.profile_picture_id(other) is null, 'a person with none has none');
  perform gold_test.assert(gold.attachment_file(me1, array[acc]) is not null, 'profile pictures are visible company-wide');
end $$;