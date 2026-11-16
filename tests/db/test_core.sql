-- Core database tests: tenancy, permissions, inbound, AI replies, orders, metering.
-- Run with tests/db/run.sh. Any failed assertion aborts with a message.
\set ON_ERROR_STOP on
set client_min_messages = notice;
\o /dev/null

create schema t;
create function t.eq(actual anyelement, expected anyelement, label text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok  %', label;
end $$;
create function t.fails(stmt text, needle text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if position(needle in sqlerrm) > 0 then raise notice 'ok  %', label; return; end if;
    raise exception 'FAIL %: wrong error: %', label, sqlerrm;
  end;
  raise exception 'FAIL %: statement succeeded but should fail', label;
end $$;
grant usage on schema t to authenticated, anon, service_role;
grant execute on all functions in schema t to authenticated, anon, service_role;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner.a@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'agent.a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner.b@test.local');

-- Supabase gives the service role full table access; the local shim does not.
grant all on all tables in schema public to service_role;

create table t.ids (k text primary key, v uuid);
grant all on t.ids to authenticated, service_role;
create function t.id(k text) returns uuid language sql as $$ select v from t.ids where ids.k = $1 $$;
grant execute on function t.id(text) to authenticated, service_role;

-- ------------------------------------------------------------ owner A sets up
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
insert into t.ids select 'wsA', (public.create_workspace('Brand A', '9000000000', 'retail')).id;
select t.eq((select slug from public.workspaces where id = t.id('wsA')), 'brand-a', 'slug from name');
select t.eq((select count(*)::int from public.workspace_staff), 1, 'owner sees own staff row');
select t.eq((select autopilot from public.brand_profiles where workspace_id = t.id('wsA')), true, 'new brands reply on their own');
insert into t.ids select 'itemA', (public.save_catalog_item(t.id('wsA'), null, 'product', 'Blue kurta', null, 129900, 'each', true, 'active')).id;
select public.save_knowledge_item(t.id('wsA'), null, 'Delivery time', 'We deliver in 3 days across Kerala.', 'active');
insert into t.ids select 'chA', (public.save_channel(t.id('wsA'), 'whatsapp', '1111', 'Brand A WhatsApp', 'token-token-token-token-token')).id;
select t.fails($$insert into public.channels (workspace_id, kind, external_id, display_name) values (t.id('wsA'), 'whatsapp', 'x', 'x')$$,
  'permission denied', 'no direct table writes');
select t.fails($$select * from private.channel_secrets$$, 'permission denied', 'tokens are not readable');
select t.fails($$select public.service_ingest('whatsapp','1111','9199','A',null,'m','text','hi',now())$$,
  'permission denied', 'staff cannot call service functions');

-- ------------------------------------------------------------ owner B is isolated
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
insert into t.ids select 'wsB', (public.create_workspace('Brand A', null, 'general')).id;
select t.eq((select slug from public.workspaces where id = t.id('wsB')), 'brand-a-2', 'slug collision gets a suffix');
select t.eq((select count(*)::int from public.workspaces), 1, 'B sees only own workspace');
select t.eq((select count(*)::int from public.catalog_items), 0, 'B cannot read A catalog');
select t.fails($$select public.save_catalog_item(t.id('wsA'), null, 'product', 'Hack', null, 1, null, true, 'active')$$,
  'XS403', 'B cannot write to A');
select t.fails($$select public.save_channel(t.id('wsB'), 'whatsapp', '1111', 'steal', 'token-token-token-token-token')$$,
  'XS409', 'a channel belongs to one brand');
select t.fails($$select public.workspace_overview(t.id('wsA'))$$, 'XS403', 'B cannot read A overview');

-- ------------------------------------------------------------ inbound from Meta
reset role;
set role service_role;
insert into t.ids select 'convA', (public.service_ingest('whatsapp', '1111', '919812345678', 'Anu', '+919812345678', 'wamid.1', 'text', 'Do you have blue kurta?', now())->>'conversation_id')::uuid;
select t.eq(public.service_ingest('whatsapp', '1111', '919812345678', 'Anu', '+919812345678', 'wamid.1', 'text', 'Do you have blue kurta?', now())->>'duplicate', 'true', 'webhook retry is ignored');
select t.eq(public.service_ingest('whatsapp', '9999', '91', 'x', null, 'wamid.z', 'text', 'hi', now())->>'ignored', 'unknown channel', 'unknown channel ignored');
select t.eq((select count(*)::int from public.messages where conversation_id = t.id('convA')), 1, 'one message stored');
select t.eq((select count(*)::int from public.leads where conversation_id = t.id('convA')), 1, 'a lead is opened');
select t.eq((public.service_agent_context(t.id('convA'))->>'run')::boolean, true, 'agent may run');
select t.eq(jsonb_array_length(public.service_agent_context(t.id('convA'))->'catalog'), 1, 'context carries the catalog');
select t.eq(public.service_search_knowledge(t.id('convA'), 'delivery')->0->>'title', 'Delivery time', 'knowledge search');

-- Approval mode (autopilot off): the reply becomes a draft.
update public.brand_profiles set autopilot = false where workspace_id = t.id('wsA');
insert into t.ids select 'lastIn', (public.service_agent_context(t.id('convA'))->>'last_message_id')::uuid;
select t.eq(public.service_ai_reply(t.id('convA'), 'Yes, ₹1,299.', t.id('lastIn'))->>'status', 'draft', 'approval mode drafts');
select t.eq(public.service_ai_reply(t.id('convA'), 'Late reply', gen_random_uuid())->>'stale', 'true', 'stale reply is dropped');

-- Orders: price comes from the catalog, never from the AI.
select t.eq((public.service_create_order(t.id('convA'), jsonb_build_array(jsonb_build_object('catalog_item_id', t.id('itemA'), 'qty', 2, 'price_paise', 1)))->>'total_paise')::int,
  259800, 'order total uses catalog price');
select t.eq(public.service_create_order(t.id('convA'), jsonb_build_array(jsonb_build_object('catalog_item_id', gen_random_uuid(), 'qty', 1)))->>'error',
  'item is not in the catalog', 'unknown item refused');
select t.eq((select stage from public.leads where conversation_id = t.id('convA')), 'proposal', 'order moves lead to proposal');
select t.eq(public.service_update_lead(t.id('convA'), 'Anu K', null, 'Blue kurta x2', 300000, 'won', 90)->>'stage', 'proposal', 'AI cannot mark a lead won');

-- Metering: one billable conversation per day, trial first.
select public.service_log_run(t.id('convA'), 'm', 100, 20, 0, '[]', 'drafted');
select public.service_log_run(t.id('convA'), 'm', 100, 20, 0, '[]', 'drafted');
select t.eq((select count(*)::int from public.usage_events where conversation_id = t.id('convA')), 1, 'metered once per day');
select t.eq((select trial_conversations_left from public.wallets where workspace_id = t.id('wsA')), 99, 'trial conversation used');

-- Handoff turns the AI off.
select public.service_handoff(t.id('convA'), 'Wants a discount');
select t.eq(public.service_agent_context(t.id('convA'))->>'why', 'ai off for this chat', 'no AI after handoff');
select t.eq(public.service_send_target(gen_random_uuid())->>'error', 'not queued', 'send target needs a queued message');

-- ------------------------------------------------------------ staff reply
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
insert into t.ids select 'draft', id from public.messages where conversation_id = t.id('convA') and status = 'draft';
insert into t.ids select 'sent', (public.staff_send_message(t.id('wsA'), t.id('convA'), 'Yes, ₹1,299 each.', t.id('draft'))).id;
select t.eq((select status from public.messages where id = t.id('sent')), 'queued', 'approved draft is queued for delivery');
select public.update_conversation(t.id('wsA'), t.id('convA'), true);
select t.eq((select handoff_reason from public.conversations where id = t.id('convA')), null::text, 'AI back on clears handoff');
select t.fails($$select public.save_lead(t.id('wsA'), gen_random_uuid(), 'won', null, null, null, null)$$, 'XS404', 'unknown lead');

reset role;
update public.conversations set last_inbound_at = now() - interval '25 hours' where id = t.id('convA');
set role authenticated;
select t.fails($$select public.staff_send_message(t.id('wsA'), t.id('convA'), 'Hello again')$$, 'reply window has closed', 'WhatsApp window enforced');

reset role;
set role service_role;
select t.eq(public.service_send_target(t.id('sent'))->>'error', 'reply window closed', 'sender re-checks the window');
select t.eq(public.service_agent_context(t.id('convA'))->>'why', 'nothing to answer', 'agent does not answer its own side');

-- ------------------------------------------------------------ demo data
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select public.seed_demo(t.id('wsB'));
select public.seed_demo(t.id('wsB'));
select t.eq((select count(*)::int from public.conversations), 3, 'demo seeds once');
insert into t.ids select 'demoConv', id from public.conversations order by last_message_at desc limit 1;
select public.demo_inbound(t.id('wsB'), t.id('demoConv'), 'One more question');
select t.eq((select status from public.staff_send_message(t.id('wsB'), t.id('demoConv'), 'Sure!')), 'sent', 'demo replies never reach Meta');
select t.eq((public.workspace_overview(t.id('wsB'), 30)->>'leads_open')::int, 3, 'overview counts leads');

reset role;
-- ------------------------------------------------------------ voice notes
set role service_role;
insert into t.ids select 'voice', (public.service_ingest('whatsapp', '1111', '919000000001', 'Asha', '+919000000001', 'wamid.voice1', 'audio', '', now())->>'message_id')::uuid;
select t.eq(public.service_voice_target(t.id('voice'))->>'error', 'no voice note', 'no media, nothing to transcribe');
select public.service_attach_media(t.id('voice'), 'MEDIA1', 'audio/ogg; codecs=opus');
select t.eq(public.service_voice_target(t.id('voice'))->>'media_ref', 'MEDIA1', 'transcriber gets the media id');
select t.eq((public.service_voice_target(t.id('voice'))->>'token') is not null, true, 'transcriber gets the channel token');
select public.service_set_transcript(t.id('voice'), '  Premium plan rate ethra?  ', 'saaras:v4');
select t.eq((select body || '|' || transcribed_by from public.messages where id = t.id('voice')), 'Premium plan rate ethra?|saaras:v4', 'transcript becomes the message body');
select t.eq((select last_preview from public.conversations c join public.messages m on m.conversation_id = c.id where m.id = t.id('voice')), 'Voice note: Premium plan rate ethra?', 'inbox preview shows the words');
select public.service_set_transcript(t.id('voice'), 'something else', 'x');
select t.eq((select body from public.messages where id = t.id('voice')), 'Premium plan rate ethra?', 'a transcript is written once');
select t.eq(public.service_voice_target(t.id('voice'))->>'error', 'already transcribed', 'no second transcription');
reset role;
set role authenticated;
select t.fails($$select public.service_voice_target(t.id('voice'))$$, 'permission denied', 'staff cannot read channel tokens through the transcriber');

reset role;
-- ------------------------------------------------------------ customer language
set role service_role;
select t.eq(public.service_set_language(t.id('convA'), 'Hindi')->>'error', 'language must be english or malayalam', 'only the two offered languages');
select t.eq(public.service_set_language(t.id('convA'), ' Malayalam ')->>'language', 'malayalam', 'the choice is saved');
select t.eq((select k.language from public.contacts k join public.conversations c on c.contact_id = k.id where c.id = t.id('convA')), 'malayalam', 'on the contact, so it holds on every channel');

reset role;
-- ------------------------------------------------------------ easy connect
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select t.eq(public.check_permission(t.id('wsA'), 'channels.manage'), true, 'owner may connect channels');
select t.eq(public.check_permission(t.id('wsB'), 'channels.manage'), false, 'not in another brand');
select t.fails($$select public.request_channel_setup(t.id('wsA'), 'whatsapp', '123')$$, 'enter a phone number we can call', 'help request needs a phone number');
select public.request_channel_setup(t.id('wsA'), 'whatsapp', '+91 98470 00000');
select public.request_channel_setup(t.id('wsA'), 'whatsapp', '98470 11111');
select t.eq((select count(*)::int from public.setup_requests where workspace_id = t.id('wsA') and status = 'open'), 1, 'asking again refreshes one request');
select t.eq((select phone from public.setup_requests where workspace_id = t.id('wsA')), '9847011111', 'latest phone kept');
select t.fails($$select public.request_channel_setup(t.id('wsB'), 'whatsapp', '9847000000')$$, 'permission', 'cannot ask for another brand');
select public.save_channel(t.id('wsA'), 'whatsapp', '5550001', 'Shop', repeat('t', 30));
select t.eq((select status from public.setup_requests where workspace_id = t.id('wsA') and kind = 'whatsapp'), 'done', 'connecting closes the request');

reset role;
-- ------------------------------------------------------------ pitch demo (administrator only)
select t.eq(private.seed_pitch(t.id('wsB')), 'seeded 12 conversations', 'pitch demo seeds');
select t.eq(private.seed_pitch(t.id('wsB')), 'already seeded', 'pitch demo seeds once');
select t.eq((select count(*)::int from public.orders where workspace_id = t.id('wsB') and status in ('paid','fulfilled')), 4, 'pitch demo has paid orders');
set role authenticated;
select t.fails($$select private.seed_pitch(t.id('wsB'))$$, 'permission denied', 'staff cannot run the pitch seed');
reset role;
\o
\echo all database tests passed
