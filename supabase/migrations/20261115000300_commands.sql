-- XS Connect — command functions for signed-in staff.
-- Each one checks permission with private.require, validates input, writes, audits.

-- ---------------------------------------------------------------------------
-- Workspace
-- ---------------------------------------------------------------------------

create function public.create_workspace(p_name text, p_phone text default null, p_vertical text default 'general')
returns public.workspaces language plpgsql security definer set search_path = '' as $$
declare
  v_ws public.workspaces; v_base text; v_slug text; v_n int := 1; v_email text;
begin
  if auth.uid() is null then raise exception 'XS401: sign in required' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'XS400: enter the brand name'; end if;
  if (select count(*) from public.workspace_staff s where s.user_id = auth.uid() and s.role = 'owner') >= 5 then
    raise exception 'XS409: you already own five brands';
  end if;
  v_base := left(private.slugify(p_name), 40); v_slug := v_base;
  while exists (select 1 from public.workspaces w where w.slug = v_slug) loop
    v_n := v_n + 1; v_slug := v_base || '-' || v_n;
  end loop;
  insert into public.workspaces (name, slug, phone, vertical, created_by)
  values (btrim(p_name), v_slug, nullif(btrim(coalesce(p_phone, '')), ''), coalesce(p_vertical, 'general'), auth.uid())
  returning * into v_ws;
  select u.email into v_email from auth.users u where u.id = auth.uid();
  insert into public.workspace_staff (workspace_id, user_id, role, email, display_name)
  values (v_ws.id, auth.uid(), 'owner', v_email, split_part(coalesce(v_email, 'Owner'), '@', 1));
  insert into public.brand_profiles (workspace_id) values (v_ws.id);
  insert into public.wallets (workspace_id) values (v_ws.id);
  perform private.audit(v_ws.id, 'workspace.create', 'workspace', v_ws.id);
  return v_ws;
end;
$$;

create function public.complete_onboarding(p_ws uuid)
returns public.workspaces language plpgsql security definer set search_path = '' as $$
declare v_ws public.workspaces;
begin
  perform private.require(p_ws, 'workspace.settings');
  update public.workspaces set onboarded_at = coalesce(onboarded_at, now()) where id = p_ws returning * into v_ws;
  return v_ws;
end;
$$;

-- ---------------------------------------------------------------------------
-- Brand Brain
-- ---------------------------------------------------------------------------

create function public.save_brand_profile(p_ws uuid, p_profile jsonb)
returns public.brand_profiles language plpgsql security definer set search_path = '' as $$
declare v public.brand_profiles;
begin
  perform private.require(p_ws, 'brain.manage');
  update public.brand_profiles b set
    about     = left(coalesce(p_profile->>'about', b.about), 4000),
    services  = left(coalesce(p_profile->>'services', b.services), 4000),
    offers    = left(coalesce(p_profile->>'offers', b.offers), 2000),
    hours     = left(coalesce(p_profile->>'hours', b.hours), 500),
    location  = left(coalesce(p_profile->>'location', b.location), 500),
    policies  = left(coalesce(p_profile->>'policies', b.policies), 4000),
    tone      = left(coalesce(p_profile->>'tone', b.tone), 1000),
    never_say = left(coalesce(p_profile->>'never_say', b.never_say), 2000),
    handoff_above_paise = case when p_profile ? 'handoff_above_paise'
                               then nullif(p_profile->>'handoff_above_paise', '')::bigint else b.handoff_above_paise end,
    autopilot = coalesce((p_profile->>'autopilot')::boolean, b.autopilot),
    updated_at = now()
  where b.workspace_id = p_ws returning * into v;
  perform private.audit(p_ws, 'brain.profile.save', 'brand_profile', p_ws, jsonb_build_object('autopilot', v.autopilot));
  return v;
end;
$$;

create function public.save_catalog_item(p_ws uuid, p_item uuid, p_kind text, p_name text, p_description text,
                                         p_price_paise bigint, p_unit text, p_in_stock boolean, p_status text)
returns public.catalog_items language plpgsql security definer set search_path = '' as $$
declare v public.catalog_items;
begin
  perform private.require(p_ws, 'brain.manage');
  if length(btrim(coalesce(p_name, ''))) < 1 then raise exception 'XS400: enter a name'; end if;
  if p_price_paise is null or p_price_paise < 0 then raise exception 'XS400: enter a valid price'; end if;
  if p_item is null then
    insert into public.catalog_items (workspace_id, kind, name, description, price_paise, unit, in_stock, status)
    values (p_ws, coalesce(p_kind, 'product'), btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_price_paise,
            nullif(btrim(coalesce(p_unit, '')), ''), coalesce(p_in_stock, true), coalesce(p_status, 'active'))
    returning * into v;
  else
    update public.catalog_items c set kind = coalesce(p_kind, c.kind), name = btrim(p_name),
      description = nullif(btrim(coalesce(p_description, '')), ''), price_paise = p_price_paise,
      unit = nullif(btrim(coalesce(p_unit, '')), ''), in_stock = coalesce(p_in_stock, c.in_stock),
      status = coalesce(p_status, c.status), updated_at = now()
    where c.id = p_item and c.workspace_id = p_ws returning * into v;
    if v.id is null then raise exception 'XS404: item not found'; end if;
  end if;
  perform private.audit(p_ws, 'brain.catalog.save', 'catalog_item', v.id, jsonb_build_object('price_paise', v.price_paise));
  return v;
end;
$$;

create function public.save_knowledge_item(p_ws uuid, p_item uuid, p_title text, p_body text, p_status text)
returns public.knowledge_items language plpgsql security definer set search_path = '' as $$
declare v public.knowledge_items;
begin
  perform private.require(p_ws, 'brain.manage');
  if length(btrim(coalesce(p_title, ''))) < 1 or length(btrim(coalesce(p_body, ''))) < 1 then
    raise exception 'XS400: enter a question and its answer';
  end if;
  if p_item is null then
    insert into public.knowledge_items (workspace_id, title, body, status)
    values (p_ws, btrim(p_title), left(btrim(p_body), 8000), coalesce(p_status, 'active')) returning * into v;
  else
    update public.knowledge_items k set title = btrim(p_title), body = left(btrim(p_body), 8000),
      status = coalesce(p_status, k.status), updated_at = now()
    where k.id = p_item and k.workspace_id = p_ws returning * into v;
    if v.id is null then raise exception 'XS404: item not found'; end if;
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Channels
-- ---------------------------------------------------------------------------

create function public.save_channel(p_ws uuid, p_kind text, p_external_id text, p_display_name text, p_access_token text)
returns public.channels language plpgsql security definer set search_path = '' as $$
declare v public.channels;
begin
  perform private.require(p_ws, 'channels.manage');
  if p_kind not in ('whatsapp', 'instagram', 'messenger') then raise exception 'XS400: unknown channel'; end if;
  if length(btrim(coalesce(p_external_id, ''))) < 1 then raise exception 'XS400: enter the account ID'; end if;
  if length(coalesce(p_access_token, '')) < 20 then raise exception 'XS400: paste the access token'; end if;
  select * into v from public.channels c where c.kind = p_kind and c.external_id = btrim(p_external_id);
  if v.id is not null and v.workspace_id <> p_ws then
    raise exception 'XS409: this account is already connected to another brand';
  end if;
  if v.id is null then
    insert into public.channels (workspace_id, kind, external_id, display_name)
    values (p_ws, p_kind, btrim(p_external_id), coalesce(nullif(btrim(coalesce(p_display_name, '')), ''), initcap(p_kind)))
    returning * into v;
  else
    update public.channels c set status = 'connected', mode = 'live',
      display_name = coalesce(nullif(btrim(coalesce(p_display_name, '')), ''), c.display_name)
    where c.id = v.id returning * into v;
  end if;
  insert into private.channel_secrets (channel_id, access_token) values (v.id, p_access_token)
  on conflict (channel_id) do update set access_token = excluded.access_token, updated_at = now();
  perform private.audit(p_ws, 'channel.connect', 'channel', v.id, jsonb_build_object('kind', v.kind));
  return v;
end;
$$;

create function public.disconnect_channel(p_ws uuid, p_channel uuid)
returns public.channels language plpgsql security definer set search_path = '' as $$
declare v public.channels;
begin
  perform private.require(p_ws, 'channels.manage');
  update public.channels c set status = 'disconnected' where c.id = p_channel and c.workspace_id = p_ws returning * into v;
  if v.id is null then raise exception 'XS404: channel not found'; end if;
  delete from private.channel_secrets s where s.channel_id = v.id;
  perform private.audit(p_ws, 'channel.disconnect', 'channel', v.id);
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Inbox
-- ---------------------------------------------------------------------------

create function public.update_conversation(p_ws uuid, p_conversation uuid, p_ai_enabled boolean default null,
                                           p_status text default null, p_assign_me boolean default null,
                                           p_read boolean default null)
returns public.conversations language plpgsql security definer set search_path = '' as $$
declare v public.conversations;
begin
  perform private.require(p_ws, 'inbox.reply');
  update public.conversations c set
    ai_enabled = coalesce(p_ai_enabled, c.ai_enabled),
    handoff_reason = case when p_ai_enabled is true then null else c.handoff_reason end,
    status = coalesce(p_status, c.status),
    assigned_to = case when p_assign_me is true then auth.uid() when p_assign_me is false then null else c.assigned_to end,
    unread = case when p_read is true then 0 else c.unread end
  where c.id = p_conversation and c.workspace_id = p_ws returning * into v;
  if v.id is null then raise exception 'XS404: conversation not found'; end if;
  if p_ai_enabled is not null then
    perform private.audit(p_ws, case when p_ai_enabled then 'conversation.ai_on' else 'conversation.ai_off' end, 'conversation', v.id);
  end if;
  return v;
end;
$$;

-- How long a business may still reply. WhatsApp: 24 hours of free-form replies.
-- Instagram and Messenger: 24 hours, or 7 days for a person using the Human Agent tag.
create function private.reply_deadline(p_kind text, p_last_inbound timestamptz, p_human boolean)
returns timestamptz language sql immutable set search_path = '' as $$
  select case
    when p_last_inbound is null then null
    when p_human and p_kind in ('instagram', 'messenger') then p_last_inbound + interval '7 days'
    else p_last_inbound + interval '24 hours' end;
$$;

-- Staff reply, or approval of an AI draft (p_draft). The edge function
-- send-message delivers queued messages on live channels.
create function public.staff_send_message(p_ws uuid, p_conversation uuid, p_body text, p_draft uuid default null)
returns public.messages language plpgsql security definer set search_path = '' as $$
declare
  v_c public.conversations; v_ch public.channels; v_m public.messages; v_deadline timestamptz; v_status text;
begin
  perform private.require(p_ws, 'inbox.reply');
  if length(btrim(coalesce(p_body, ''))) < 1 then raise exception 'XS400: type a message'; end if;
  if length(p_body) > 4000 then raise exception 'XS400: message is too long'; end if;
  select * into v_c from public.conversations c where c.id = p_conversation and c.workspace_id = p_ws for update;
  if v_c.id is null then raise exception 'XS404: conversation not found'; end if;
  select * into v_ch from public.channels ch where ch.id = v_c.channel_id;
  if v_ch.mode = 'live' then
    if v_ch.status <> 'connected' then raise exception 'XS409: this channel is disconnected'; end if;
    v_deadline := private.reply_deadline(v_ch.kind, v_c.last_inbound_at, true);
    if v_deadline is null or now() > v_deadline then
      raise exception 'XS409: the reply window has closed. The customer must message again%',
        case when v_ch.kind = 'whatsapp' then ', or send an approved WhatsApp template' else '' end;
    end if;
  end if;
  v_status := case when v_ch.mode = 'demo' then 'sent' else 'queued' end;
  if p_draft is not null then
    update public.messages m set body = btrim(p_body), status = v_status, sent_by = auth.uid(), created_at = now()
    where m.id = p_draft and m.conversation_id = v_c.id and m.status = 'draft' returning * into v_m;
    if v_m.id is null then raise exception 'XS404: draft not found'; end if;
  else
    insert into public.messages (workspace_id, conversation_id, direction, sender, body, status, sent_by)
    values (p_ws, v_c.id, 'out', 'staff', btrim(p_body), v_status, auth.uid()) returning * into v_m;
  end if;
  update public.conversations c set last_message_at = now(), last_preview = left(btrim(p_body), 140), unread = 0
  where c.id = v_c.id;
  return v_m;
end;
$$;

create function public.discard_draft(p_ws uuid, p_message uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(p_ws, 'inbox.reply');
  delete from public.messages m where m.id = p_message and m.workspace_id = p_ws and m.status = 'draft';
end;
$$;

-- Demo channels only: type as the customer to try the AI before connecting Meta.
create function public.demo_inbound(p_ws uuid, p_conversation uuid, p_body text)
returns public.messages language plpgsql security definer set search_path = '' as $$
declare v_c public.conversations; v_m public.messages;
begin
  perform private.require(p_ws, 'inbox.reply');
  if length(btrim(coalesce(p_body, ''))) < 1 then raise exception 'XS400: type a message'; end if;
  select c.* into v_c from public.conversations c join public.channels ch on ch.id = c.channel_id
  where c.id = p_conversation and c.workspace_id = p_ws and ch.mode = 'demo';
  if v_c.id is null then raise exception 'XS409: only demo conversations can be simulated'; end if;
  insert into public.messages (workspace_id, conversation_id, direction, sender, body, status)
  values (p_ws, v_c.id, 'in', 'contact', left(btrim(p_body), 4000), 'received') returning * into v_m;
  update public.conversations c set last_message_at = now(), last_inbound_at = now(),
    last_preview = left(btrim(p_body), 140), status = 'open' where c.id = v_c.id;
  return v_m;
end;
$$;

-- ---------------------------------------------------------------------------
-- Leads, orders, follow-ups
-- ---------------------------------------------------------------------------

create function public.save_lead(p_ws uuid, p_lead uuid, p_stage text, p_need text, p_budget_paise bigint,
                                 p_value_paise bigint, p_notes text, p_lost_reason text default null)
returns public.leads language plpgsql security definer set search_path = '' as $$
declare v public.leads;
begin
  perform private.require(p_ws, 'leads.write');
  if p_stage not in ('new', 'qualified', 'proposal', 'won', 'lost') then raise exception 'XS400: unknown stage'; end if;
  update public.leads l set stage = p_stage, need = nullif(btrim(coalesce(p_need, '')), ''),
    budget_paise = p_budget_paise, value_paise = p_value_paise, notes = nullif(btrim(coalesce(p_notes, '')), ''),
    lost_reason = case when p_stage = 'lost' then nullif(btrim(coalesce(p_lost_reason, '')), '') else null end,
    closed_at = case when p_stage in ('won', 'lost') then coalesce(l.closed_at, now()) else null end
  where l.id = p_lead and l.workspace_id = p_ws returning * into v;
  if v.id is null then raise exception 'XS404: lead not found'; end if;
  perform private.audit(p_ws, 'lead.save', 'lead', v.id, jsonb_build_object('stage', v.stage));
  return v;
end;
$$;

create function public.set_order_status(p_ws uuid, p_order uuid, p_status text)
returns public.orders language plpgsql security definer set search_path = '' as $$
declare v public.orders;
begin
  perform private.require(p_ws, 'orders.write');
  if p_status not in ('pending', 'confirmed', 'paid', 'fulfilled', 'cancelled') then raise exception 'XS400: unknown status'; end if;
  update public.orders o set status = p_status where o.id = p_order and o.workspace_id = p_ws returning * into v;
  if v.id is null then raise exception 'XS404: order not found'; end if;
  perform private.audit(p_ws, 'order.status', 'order', v.id, jsonb_build_object('status', v.status));
  return v;
end;
$$;

create function public.save_followup(p_ws uuid, p_followup uuid, p_conversation uuid, p_due_at timestamptz,
                                     p_note text, p_status text default 'pending')
returns public.followups language plpgsql security definer set search_path = '' as $$
declare v public.followups;
begin
  perform private.require(p_ws, 'inbox.reply');
  if p_followup is null then
    if length(btrim(coalesce(p_note, ''))) < 1 or p_due_at is null then raise exception 'XS400: enter a note and a time'; end if;
    if not exists (select 1 from public.conversations c where c.id = p_conversation and c.workspace_id = p_ws) then
      raise exception 'XS404: conversation not found';
    end if;
    insert into public.followups (workspace_id, conversation_id, due_at, note, mode)
    values (p_ws, p_conversation, p_due_at, btrim(p_note), 'staff') returning * into v;
  else
    update public.followups f set status = coalesce(p_status, f.status),
      due_at = coalesce(p_due_at, f.due_at), note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), f.note),
      done_at = case when p_status = 'done' then now() else f.done_at end
    where f.id = p_followup and f.workspace_id = p_ws returning * into v;
    if v.id is null then raise exception 'XS404: follow-up not found'; end if;
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Overview numbers for Home and Analytics
-- ---------------------------------------------------------------------------

create function public.workspace_overview(p_ws uuid, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz; v_tz text; v jsonb;
begin
  if not private.is_staff(p_ws) then raise exception 'XS403: you do not have permission to do this' using errcode = '42501'; end if;
  select w.timezone into v_tz from public.workspaces w where w.id = p_ws;
  v_from := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  select jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 30), 365)),
    'conversations', (select count(*) from public.conversations c where c.workspace_id = p_ws and c.last_message_at >= v_from),
    'waiting', (select count(*) from public.conversations c where c.workspace_id = p_ws and c.status = 'open'
                and (not c.ai_enabled or c.handoff_reason is not null) and c.unread > 0),
    'handoffs', (select count(*) from public.conversations c where c.workspace_id = p_ws and c.handoff_reason is not null and c.status = 'open'),
    'drafts', (select count(*) from public.messages m where m.workspace_id = p_ws and m.status = 'draft'),
    'leads_new', (select count(*) from public.leads l where l.workspace_id = p_ws and l.created_at >= v_from),
    'leads_open', (select count(*) from public.leads l where l.workspace_id = p_ws and l.stage not in ('won', 'lost')),
    'leads_won', (select count(*) from public.leads l where l.workspace_id = p_ws and l.stage = 'won' and l.closed_at >= v_from),
    'leads_lost', (select count(*) from public.leads l where l.workspace_id = p_ws and l.stage = 'lost' and l.closed_at >= v_from),
    'orders', (select count(*) from public.orders o where o.workspace_id = p_ws and o.created_at >= v_from and o.status <> 'cancelled'),
    'revenue_paise', (select coalesce(sum(o.total_paise), 0) from public.orders o
                      where o.workspace_id = p_ws and o.created_at >= v_from and o.status in ('paid', 'fulfilled')),
    'ai_replies', (select count(*) from public.messages m where m.workspace_id = p_ws and m.sender = 'ai'
                   and m.status not in ('draft', 'failed') and m.created_at >= v_from),
    'staff_replies', (select count(*) from public.messages m where m.workspace_id = p_ws and m.sender = 'staff' and m.created_at >= v_from),
    'followups_due', (select count(*) from public.followups f where f.workspace_id = p_ws and f.status = 'pending' and f.due_at <= now()),
    'billable_conversations', (select count(*) from public.usage_events u where u.workspace_id = p_ws and u.created_at >= v_from),
    'spend_paise', (select coalesce(sum(u.amount_paise), 0) from public.usage_events u where u.workspace_id = p_ws and u.created_at >= v_from),
    'by_channel', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
        select ch.kind, count(*) n from public.conversations c join public.channels ch on ch.id = c.channel_id
        where c.workspace_id = p_ws and c.last_message_at >= v_from group by ch.kind) x),
    'by_stage', (select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) from (
        select l.stage, count(*) n from public.leads l where l.workspace_id = p_ws group by l.stage) x),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'inbound', n) order by d), '[]'::jsonb) from (
        select (m.created_at at time zone v_tz)::date d, count(*) n from public.messages m
        where m.workspace_id = p_ws and m.direction = 'in' and m.created_at >= v_from group by 1) x)
  ) into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sample data, so a new brand can try every screen before connecting Meta
-- ---------------------------------------------------------------------------

create function public.seed_demo(p_ws uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_wa uuid; v_ig uuid; v_c1 uuid; v_c2 uuid; v_c3 uuid; v_k1 uuid; v_k2 uuid; v_k3 uuid; v_item uuid; v_seq int;
begin
  perform private.require(p_ws, 'workspace.settings');
  if exists (select 1 from public.channels c where c.workspace_id = p_ws and c.mode = 'demo') then return; end if;

  insert into public.channels (workspace_id, kind, external_id, display_name, mode)
  values (p_ws, 'whatsapp', 'demo-wa-' || p_ws, 'Demo WhatsApp', 'demo') returning id into v_wa;
  insert into public.channels (workspace_id, kind, external_id, display_name, mode)
  values (p_ws, 'instagram', 'demo-ig-' || p_ws, 'Demo Instagram', 'demo') returning id into v_ig;

  if not exists (select 1 from public.catalog_items c where c.workspace_id = p_ws) then
    insert into public.catalog_items (workspace_id, kind, name, description, price_paise, unit) values
      (p_ws, 'service', 'Starter package', 'One month, everything included', 250000, 'month'),
      (p_ws, 'service', 'Premium package', 'Three months with personal support', 650000, '3 months'),
      (p_ws, 'product', 'Welcome kit', 'Delivered anywhere in Kerala', 99900, 'each');
  end if;
  select c.id into v_item from public.catalog_items c where c.workspace_id = p_ws order by c.price_paise limit 1;
  if not exists (select 1 from public.knowledge_items k where k.workspace_id = p_ws) then
    insert into public.knowledge_items (workspace_id, title, body) values
      (p_ws, 'Do you deliver?', 'Yes, across Kerala in 2 to 4 working days. Delivery is free above ₹1,000.'),
      (p_ws, 'How can I pay?', 'UPI, card or cash on delivery. We send a payment link in this chat.');
  end if;

  insert into public.contacts (workspace_id, display_name, phone) values (p_ws, 'Anjali Menon', '+919000000001') returning id into v_k1;
  insert into public.contacts (workspace_id, display_name) values (p_ws, 'Rahul Krishnan') returning id into v_k2;
  insert into public.contacts (workspace_id, display_name, phone) values (p_ws, 'Fathima Rizwan', '+919000000003') returning id into v_k3;
  insert into public.contact_identities (workspace_id, contact_id, kind, external_id) values
    (p_ws, v_k1, 'whatsapp', 'demo-919000000001'), (p_ws, v_k2, 'instagram', 'demo-rahul'), (p_ws, v_k3, 'whatsapp', 'demo-919000000003');

  insert into public.conversations (workspace_id, channel_id, contact_id, contact_external, last_inbound_at, last_message_at, last_preview, unread)
  values (p_ws, v_wa, v_k1, 'demo-919000000001', now() - interval '20 minutes', now() - interval '19 minutes', 'Great, please share the payment link', 0)
  returning id into v_c1;
  insert into public.conversations (workspace_id, channel_id, contact_id, contact_external, last_inbound_at, last_message_at, last_preview, unread, ai_enabled, handoff_reason)
  values (p_ws, v_ig, v_k2, 'demo-rahul', now() - interval '2 hours', now() - interval '2 hours', 'Can I get a discount for 5 people?', 1, false, 'Asked for a group discount')
  returning id into v_c2;
  insert into public.conversations (workspace_id, channel_id, contact_id, contact_external, last_inbound_at, last_message_at, last_preview, unread)
  values (p_ws, v_wa, v_k3, 'demo-919000000003', now() - interval '26 hours', now() - interval '26 hours', 'I will think and tell you', 0)
  returning id into v_c3;

  insert into public.messages (workspace_id, conversation_id, direction, sender, body, status, created_at) values
    (p_ws, v_c1, 'in',  'contact', 'Hi, what packages do you have?', 'received', now() - interval '30 minutes'),
    (p_ws, v_c1, 'out', 'ai', 'Hello Anjali! We have a Starter package at ₹2,500 a month and a Premium package at ₹6,500 for three months. Which one suits you?', 'read', now() - interval '29 minutes'),
    (p_ws, v_c1, 'in',  'contact', 'Starter is fine. How do I pay?', 'received', now() - interval '22 minutes'),
    (p_ws, v_c1, 'out', 'ai', 'You can pay by UPI or card. Shall I book the Starter package for you?', 'read', now() - interval '21 minutes'),
    (p_ws, v_c1, 'in',  'contact', 'Great, please share the payment link', 'received', now() - interval '20 minutes'),
    (p_ws, v_c1, 'out', 'ai', 'Done! Your order is booked. Our team will send the payment link in a moment.', 'draft', now() - interval '19 minutes'),
    (p_ws, v_c2, 'in',  'contact', 'Saw your reel. Price?', 'received', now() - interval '3 hours'),
    (p_ws, v_c2, 'out', 'ai', 'Thanks for reaching out, Rahul! Starter is ₹2,500 a month. May I have your WhatsApp number so we can share details there?', 'delivered', now() - interval '3 hours' + interval '1 minute'),
    (p_ws, v_c2, 'in',  'contact', 'Can I get a discount for 5 people?', 'received', now() - interval '2 hours'),
    (p_ws, v_c2, 'out', 'system', 'AI handed this chat to the team: asked for a group discount.', 'sent', now() - interval '2 hours' + interval '5 seconds'),
    (p_ws, v_c3, 'in',  'contact', 'Is the premium package refundable?', 'received', now() - interval '27 hours'),
    (p_ws, v_c3, 'out', 'ai', 'Yes, a full refund within the first 7 days. Would you like me to book it?', 'read', now() - interval '27 hours' + interval '1 minute'),
    (p_ws, v_c3, 'in',  'contact', 'I will think and tell you', 'received', now() - interval '26 hours');

  insert into public.leads (workspace_id, contact_id, conversation_id, stage, score, need, budget_paise, value_paise, source) values
    (p_ws, v_k1, v_c1, 'proposal', 85, 'Starter package', 300000, 250000, 'whatsapp'),
    (p_ws, v_k2, v_c2, 'qualified', 60, 'Group of 5, wants a discount', null, 1250000, 'instagram'),
    (p_ws, v_k3, v_c3, 'new', 35, 'Premium package, asked about refunds', null, 650000, 'whatsapp');

  update public.workspaces w set order_seq = w.order_seq + 1 where w.id = p_ws returning order_seq into v_seq;
  insert into public.orders (workspace_id, contact_id, conversation_id, order_no, status, items, total_paise, created_by_ai)
  select p_ws, v_k1, v_c1, 'XC-' || lpad(v_seq::text, 4, '0'), 'pending',
         jsonb_build_array(jsonb_build_object('catalog_item_id', c.id, 'name', c.name, 'qty', 1, 'price_paise', c.price_paise)),
         c.price_paise, true
  from public.catalog_items c where c.id = v_item;

  insert into public.followups (workspace_id, conversation_id, due_at, note, mode, created_by_ai) values
    (p_ws, v_c3, now() - interval '1 hour', 'Check if Fathima decided on Premium. Window closed: needs a WhatsApp template.', 'staff', true),
    (p_ws, v_c2, now() + interval '3 hours', 'Reply with the group price', 'staff', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: commands are for signed-in staff only
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  for f in
    select p.oid::regprocedure::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname in (
      'create_workspace', 'complete_onboarding', 'save_brand_profile', 'save_catalog_item', 'save_knowledge_item',
      'save_channel', 'disconnect_channel', 'update_conversation', 'staff_send_message', 'discard_draft',
      'demo_inbound', 'save_lead', 'set_order_status', 'save_followup', 'workspace_overview', 'seed_demo')
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
