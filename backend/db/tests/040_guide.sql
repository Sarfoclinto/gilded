-- The Guide: categories, articles with blocks, publishing tells people, reads per version, edit conflicts, reminders.
do $$
declare
  t uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r_role uuid := gen_random_uuid();
  dir uuid := gen_random_uuid(); u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); cat uuid := gen_random_uuid(); art uuid := gen_random_uuid(); art2 uuid := gen_random_uuid();
  r jsonb; n int;
  blocks jsonb := '[{"type":"heading","text":"Customer privacy"},{"type":"text","text":"Never share **one** customer''s details with another."},
    {"type":"list","style":"donts","items":["Show a transaction to someone else"]},{"type":"callout","tone":"danger","text":"Serious"},
    {"type":"flow","nodes":[{"kind":"decision","text":"Is the person the customer?","yes":"Go ahead","no":"Stop"}]},{"type":"divider"}]'::jsonb;
begin
  insert into gold.tenants (id, slug, name) values (t, 'guide', 'Guide'), (t2, 'guide2', 'Other');
  perform set_config('app.tenant_id', t::text, true);
  insert into gold.branches (id, tenant_id, code, name, is_main, timezone) values (b, t, 'TKW', 'Tarkwa', true, 'Africa/Accra');
  insert into gold.roles (id, tenant_id, key, name) values (r_role, t, 'teller', 'Teller');
  insert into gold.users (id, tenant_id, username, display_name, password_hash, role_id) values (dir, t, 'dir', 'Dir', 'x', r_role), (u1, t, 'ama', 'Ama', 'x', r_role), (u2, t, 'kojo', 'Kojo', 'x', r_role);
  set local role gold_app;
  perform set_config('app.user_id', dir::text, true);

  perform gold.guide_save_category(jsonb_build_object('id', cat, 'name', 'Customer privacy'));
  perform gold_test.assert(gold_test.code_of($q$select gold.guide_save_category('{"name":"customer PRIVACY"}'::jsonb)$q$) = 'ALREADY_EXISTS', 'category names are unique ignoring case');
  r := gold.guide_save_article(jsonb_build_object('id', art, 'categoryId', cat, 'title', 'Never share customer details', 'kind', 'dos_donts', 'blocks', blocks));
  perform gold_test.assert(r->>'status' = 'draft' and (r->>'rev')::int = 1, 'saved as a draft');
  perform gold_test.assert(jsonb_array_length(gold.guide_json()->'articles') = 0, 'a draft is not shown to readers');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.guide_article_json('%s')$q$, art)) = 'NOT_FOUND', 'a reader cannot open a draft');

  -- content is checked
  perform gold_test.assert(gold_test.code_of(format($q$select gold.guide_save_article('{"id":"%s","title":"Bad one","blocks":[{"type":"script"}]}'::jsonb)$q$, gen_random_uuid())) = 'VALIDATION_FAILED', 'unknown block refused');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.guide_save_article('{"id":"%s","title":"Bad image","blocks":[{"type":"image","src":"https://x.test/a.png"}]}'::jsonb)$q$, gen_random_uuid())) = 'VALIDATION_FAILED', 'only embedded pictures');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.guide_save_article('{"id":"%s","title":"x","blocks":[]}'::jsonb)$q$, gen_random_uuid())) = 'VALIDATION_FAILED', 'title too short');
  perform gold.guide_save_article(jsonb_build_object('id', gen_random_uuid(), 'title', 'With a picture', 'blocks', '[{"type":"image","src":"data:image/png;base64,iVBORw0KGgo="}]'::jsonb));

  -- publishing tells everyone else once
  perform gold_test.assert(gold_test.code_of(format($q$select gold.guide_publish('%s')$q$, art2)) = 'NOT_FOUND', 'cannot publish what does not exist');
  r := gold.guide_publish(art);
  perform gold_test.assert((r->>'notified')::int = 2 and r->>'status' = 'published', 'two people told (not the publisher): ' || r::text);
  perform gold_test.assert((select count(*) from gold.notifications where kind = 'guide_new' and link = '/guide/' || art) = 2, 'notifications written');

  -- a reader
  perform set_config('app.user_id', u1::text, true);
  r := gold.guide_json();
  perform gold_test.assert((r->>'unread')::int = 1 and jsonb_array_length(r->'articles') = 1, 'one to read');
  perform gold_test.assert(jsonb_array_length(gold.guide_article_json(art)->'blocks') = 6, 'content comes with the article');
  perform gold.guide_mark_read(art);
  perform gold_test.assert((gold.guide_json()->>'unread')::int = 0, 'read');

  -- a real change makes everyone read it again; a small fix does not
  perform set_config('app.user_id', dir::text, true);
  r := gold.guide_save_article(jsonb_build_object('id', art, 'title', 'Never share customer details', 'kind', 'dos_donts', 'blocks', blocks, 'rev', 1));
  perform gold_test.assert((r->>'rev')::int = 2, 'rev goes up on save');
  perform gold_test.assert(gold_test.code_of(format($q$select gold.guide_save_article('{"id":"%s","title":"Never share customer details","blocks":[],"rev":1}'::jsonb)$q$, art)) = 'EDIT_CONFLICT', 'a stale save is refused');
  perform gold.guide_publish(art, '{"notify":false}'::jsonb);
  perform set_config('app.user_id', u1::text, true);
  perform gold_test.assert((gold.guide_json()->>'unread')::int = 0, 'a small fix keeps it read');
  perform set_config('app.user_id', dir::text, true);
  r := gold.guide_publish(art, '{"material":true}'::jsonb);
  perform gold_test.assert((r->>'version')::int = 2 and (r->>'notified')::int = 2, 'a real change: version 2, people told');
  perform set_config('app.user_id', u1::text, true);
  perform gold_test.assert((gold.guide_json()->>'unread')::int = 1, 'must be read again');

  -- who has read
  perform set_config('app.user_id', dir::text, true);
  r := gold.guide_readers_json(art);
  perform gold_test.assert(jsonb_array_length(r) = 3 and (select count(*) from jsonb_array_elements(r) e where (e->>'read')::boolean) = 0, 'nobody has read version 2');

  -- reminders: off by default, daily at a time, once a day, unread people only
  perform gold_test.assert(gold.guide_reminders_json()->>'frequency' = 'off', 'off by default');
  perform gold_test.assert(gold_test.code_of($q$select gold.set_guide_reminders('{"frequency":"daily","time":"25:00"}'::jsonb)$q$) = 'VALIDATION_FAILED', 'bad time refused');
  perform gold.set_guide_reminders('{"frequency":"daily","time":"08:00","audience":"unread"}'::jsonb);
  perform gold_test.assert(gold.guide_reminder_run(date_trunc('day', now()) + interval '6 hours') = 0, 'not before the time');
  n := gold.guide_reminder_run(date_trunc('day', now()) + interval '9 hours');
  perform gold_test.assert(n = 3, 'everyone has the new version unread: ' || n);
  perform gold_test.assert(gold.guide_reminder_run(date_trunc('day', now()) + interval '10 hours') = 0, 'only once a day');
  perform gold_test.assert(gold.guide_reminder_run(date_trunc('day', now()) + interval '1 day 9 hours') = 3, 'again the next day');
  perform set_config('app.user_id', u2::text, true);
  perform gold.guide_mark_read(art);
  perform set_config('app.user_id', dir::text, true);
  perform gold.set_guide_reminders('{"frequency":"daily","time":"07:00","audience":"unread"}'::jsonb);
  perform gold_test.assert(gold.guide_reminder_run(date_trunc('day', now()) + interval '2 days 9 hours') = 2, 'a person who has read it is not reminded');
  perform gold.set_guide_reminders('{"frequency":"weekly","time":"07:00","weekday":1,"audience":"everyone"}'::jsonb);
  perform gold_test.assert(exists (select 1 from gold.audit_events where action = 'guide.reminders_changed'), 'audited');

  -- category with articles cannot be deleted; unpublish hides
  perform gold_test.assert(gold_test.code_of(format($q$select gold.guide_delete_category('%s')$q$, cat)) = 'NOT_EMPTY', 'category in use');
  perform gold.guide_unpublish(art);
  perform gold_test.assert(jsonb_array_length(gold.guide_json()->'articles') = 0, 'unpublished hides it');
  perform gold.guide_delete_article(art);
  perform gold.guide_delete_category(cat);
  perform gold_test.assert(exists (select 1 from gold.audit_events where action = 'guide.article_published'), 'publishing audited');
  raise notice 'guide ok';
end $$;