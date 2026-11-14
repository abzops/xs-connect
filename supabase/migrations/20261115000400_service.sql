-- XS Connect — functions for the edge functions (service role only).
-- The webhook gateway, the AI agent and the sender never touch tables directly.

-- ---------------------------------------------------------------------------
-- Inbound: one message from Meta
-- ---------------------------------------------------------------------------

create function public.service_ingest(p_kind text, p_channel_external text, p_contact_external text,
                                      p_contact_name text, p_phone text, p_message_external text,
                                      p_msg_kind text, p_body text, p_sent_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ch public.channels; v_contact uuid; v_c public.conversations; v_m uuid; v_name text;
begin
  select * into v_ch from public.channels c
  where c.kind = p_kind and c.external_id = p_channel_external and c.status = 'connected' and c.mode = 'live';
  if v_ch.id is null then return jsonb_build_object('ignored', 'unknown channel'); end if;

  if exists (select 1 from public.messages m where m.workspace_id = v_ch.workspace_id and m.external_id = p_message_external) then
    return jsonb_build_object('duplicate', true);
  end if;

  v_name := nullif(btrim(coalesce(p_contact_name, '')), '');
  select i.contact_id into v_contact from public.contact_identities i
  where i.workspace_id = v_ch.workspace_id and i.kind = p_kind and i.external_id = p_contact_external;
  if v_contact is null then
    -- Same person on another channel: merge on phone number.
    if p_phone is not null then
      select c.id into v_contact from public.contacts c
      where c.workspace_id = v_ch.workspace_id and c.phone = p_phone order by c.created_at limit 1;
    end if;
    if v_contact is null then
      insert into public.contacts (workspace_id, display_name, phone)
      values (v_ch.workspace_id, coalesce(v_name, p_phone, 'New contact'), p_phone) returning id into v_contact;
    end if;
    insert into public.contact_identities (workspace_id, contact_id, kind, external_id)
    values (v_ch.workspace_id, v_contact, p_kind, p_contact_external)
    on conflict (workspace_id, kind, external_id) do nothing;
  elsif v_name is not null then
    update public.contacts c set display_name = v_name
    where c.id = v_contact and c.display_name in ('Unknown', 'New contact');
  end if;

  insert into public.conversations (workspace_id, channel_id, contact_id, contact_external)
  values (v_ch.workspace_id, v_ch.id, v_contact, p_contact_external)
  on conflict (channel_id, contact_external) do nothing;
  select * into v_c from public.conversations c
  where c.channel_id = v_ch.id and c.contact_external = p_contact_external for update;

  insert into public.messages (workspace_id, conversation_id, direction, sender, kind, body, external_id, status, created_at)
  values (v_ch.workspace_id, v_c.id, 'in', 'contact', coalesce(p_msg_kind, 'text'), left(coalesce(p_body, ''), 4000),
          p_message_external, 'received', coalesce(p_sent_at, now()))
  on conflict do nothing returning id into v_m;
  if v_m is null then return jsonb_build_object('duplicate', true); end if;

  update public.conversations c set status = 'open', last_message_at = now(), last_inbound_at = now(),
    last_preview = left(coalesce(nullif(p_body, ''), '[' || coalesce(p_msg_kind, 'message') || ']'), 140),
    unread = c.unread + 1
  where c.id = v_c.id;

  if not exists (select 1 from public.leads l where l.contact_id = v_contact and l.stage not in ('won', 'lost')) then
    insert into public.leads (workspace_id, contact_id, conversation_id, source)
    values (v_ch.workspace_id, v_contact, v_c.id, p_kind) on conflict do nothing;
  end if;

  return jsonb_build_object('workspace_id', v_ch.workspace_id, 'conversation_id', v_c.id, 'message_id', v_m,
                            'ai_enabled', v_c.ai_enabled);
end;
$$;

-- Delivery receipts from Meta. Status only moves forward.
create function public.service_message_status(p_external_id text, p_status text, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('sent', 'delivered', 'read', 'failed') then return; end if;
  update public.messages m set status = p_status, error = p_error
  where m.external_id = p_external_id and m.direction = 'out'
    and array_position(array['queued','sent','delivered','read'], m.status)
        < coalesce(array_position(array['queued','sent','delivered','read'], p_status), 99);
end;
$$;

-- ---------------------------------------------------------------------------
-- Outbound
-- ---------------------------------------------------------------------------

-- Where and how to deliver a queued message. p_user is set for staff sends and
-- must be active staff of the workspace.
create function public.service_send_target(p_message uuid, p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_m public.messages; v_c public.conversations; v_ch public.channels; v_token text; v_human boolean;
begin
  select * into v_m from public.messages m where m.id = p_message and m.direction = 'out' and m.status = 'queued';
  if v_m.id is null then return jsonb_build_object('error', 'not queued'); end if;
  if p_user is not null and not exists (
      select 1 from public.workspace_staff s
      where s.workspace_id = v_m.workspace_id and s.user_id = p_user and s.status = 'active') then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into v_c from public.conversations c where c.id = v_m.conversation_id;
  select * into v_ch from public.channels ch where ch.id = v_c.channel_id;
  if v_ch.mode <> 'live' or v_ch.status <> 'connected' then return jsonb_build_object('error', 'channel not live'); end if;
  select s.access_token into v_token from private.channel_secrets s where s.channel_id = v_ch.id;
  if v_token is null then return jsonb_build_object('error', 'channel has no token'); end if;
  v_human := v_m.sender = 'staff';
  if now() > coalesce(private.reply_deadline(v_ch.kind, v_c.last_inbound_at, v_human), '-infinity') then
    return jsonb_build_object('error', 'reply window closed');
  end if;
  return jsonb_build_object(
    'kind', v_ch.kind, 'channel_external', v_ch.external_id, 'token', v_token,
    'recipient', v_c.contact_external, 'body', v_m.body,
    -- Past 24 hours on Instagram or Messenger only a person may reply, tagged HUMAN_AGENT.
    'human_agent_tag', v_human and v_ch.kind in ('instagram', 'messenger')
                       and now() > v_c.last_inbound_at + interval '24 hours');
end;
$$;

create function public.service_mark_sent(p_message uuid, p_external_id text, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update public.messages m set status = case when p_ok then 'sent' else 'failed' end,
    external_id = coalesce(p_external_id, m.external_id), error = left(p_error, 500)
  where m.id = p_message and m.status = 'queued';
$$;

-- ---------------------------------------------------------------------------
-- AI agent
-- ---------------------------------------------------------------------------

-- Everything one AI turn needs. p_user is set when a signed-in person triggers
-- the agent (demo chats); the webhook passes null.
create function public.service_agent_context(p_conversation uuid, p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_c public.conversations; v_ch public.channels; v_w public.wallets; v_ws public.workspaces; v_last public.messages;
begin
  select * into v_c from public.conversations c where c.id = p_conversation;
  if v_c.id is null then return jsonb_build_object('run', false, 'why', 'conversation not found'); end if;
  if p_user is not null and not exists (
      select 1 from public.workspace_staff s
      where s.workspace_id = v_c.workspace_id and s.user_id = p_user and s.status = 'active') then
    return jsonb_build_object('run', false, 'why', 'forbidden');
  end if;
  select * into v_ch from public.channels ch where ch.id = v_c.channel_id;
  select * into v_ws from public.workspaces w where w.id = v_c.workspace_id;
  select * into v_w from public.wallets w where w.workspace_id = v_c.workspace_id;
  select * into v_last from public.messages m
  where m.conversation_id = v_c.id and m.status <> 'draft' order by m.created_at desc limit 1;

  if v_ws.status <> 'active' then return jsonb_build_object('run', false, 'why', 'workspace suspended'); end if;
  if not v_c.ai_enabled then return jsonb_build_object('run', false, 'why', 'ai off for this chat'); end if;
  if v_last.id is null or v_last.direction <> 'in' then return jsonb_build_object('run', false, 'why', 'nothing to answer'); end if;
  if v_ch.mode = 'live' and now() > coalesce(private.reply_deadline(v_ch.kind, v_c.last_inbound_at, false), '-infinity') then
    return jsonb_build_object('run', false, 'why', 'reply window closed');
  end if;
  -- Pay per conversation: stop when the trial and the wallet are both used up,
  -- unless this contact's conversation was already counted today.
  if v_w.trial_conversations_left = 0 and v_w.balance_paise < v_w.price_per_conversation_paise
     and not exists (select 1 from public.usage_events u
                     where u.conversation_id = v_c.id and u.day = (now() at time zone v_ws.timezone)::date) then
    return jsonb_build_object('run', false, 'why', 'wallet empty');
  end if;

  return jsonb_build_object(
    'run', true,
    'workspace', jsonb_build_object('id', v_ws.id, 'name', v_ws.name, 'vertical', v_ws.vertical, 'timezone', v_ws.timezone),
    'channel', jsonb_build_object('kind', v_ch.kind, 'mode', v_ch.mode),
    'last_message_id', v_last.id,
    'profile', (select to_jsonb(b) - 'workspace_id' - 'updated_at' from public.brand_profiles b where b.workspace_id = v_ws.id),
    'catalog', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'name', c.name,
                  'description', c.description, 'price_paise', c.price_paise, 'unit', c.unit, 'in_stock', c.in_stock)
                  order by c.name), '[]'::jsonb)
                from public.catalog_items c where c.workspace_id = v_ws.id and c.status = 'active'),
    'contact', (select jsonb_build_object('name', k.display_name, 'phone', k.phone) from public.contacts k where k.id = v_c.contact_id),
    'lead', (select jsonb_build_object('stage', l.stage, 'score', l.score, 'need', l.need, 'budget_paise', l.budget_paise)
             from public.leads l where l.contact_id = v_c.contact_id and l.stage not in ('won', 'lost') limit 1),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('direction', x.direction, 'sender', x.sender,
                   'kind', x.kind, 'body', x.body) order by x.created_at), '[]'::jsonb)
                 from (select m.* from public.messages m
                       where m.conversation_id = v_c.id and m.status <> 'draft' and m.sender <> 'system'
                       order by m.created_at desc limit 30) x));
end;
$$;

create function public.service_search_knowledge(p_conversation uuid, p_query text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('title', x.title, 'body', x.body)), '[]'::jsonb) from (
    select k.title, k.body
    from public.knowledge_items k
    join public.conversations c on c.workspace_id = k.workspace_id
    where c.id = p_conversation and k.status = 'active'
    order by ts_rank(k.fts, websearch_to_tsquery('simple', regexp_replace(coalesce(p_query, ''), '\s+', ' or ', 'g'))) desc,
             k.updated_at desc
    limit 5) x;
$$;

create function public.service_update_lead(p_conversation uuid, p_name text, p_phone text, p_need text,
                                           p_budget_paise bigint, p_stage text, p_score int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c public.conversations; v_l public.leads; v_phone text;
begin
  select * into v_c from public.conversations c where c.id = p_conversation;
  if v_c.id is null then return jsonb_build_object('error', 'conversation not found'); end if;
  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  if v_phone is not null and v_phone !~ '^\+' then
    v_phone := case when length(v_phone) = 10 then '+91' || v_phone else '+' || v_phone end;
  end if;
  update public.contacts k set
    display_name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), k.display_name),
    phone = coalesce(k.phone, v_phone)
  where k.id = v_c.contact_id;
  select * into v_l from public.leads l where l.contact_id = v_c.contact_id and l.stage not in ('won', 'lost');
  if v_l.id is null then
    insert into public.leads (workspace_id, contact_id, conversation_id, source)
    select v_c.workspace_id, v_c.contact_id, v_c.id, ch.kind from public.channels ch where ch.id = v_c.channel_id
    returning * into v_l;
  end if;
  -- The AI may move a lead forward to qualified or proposal; a person marks won or lost.
  update public.leads l set
    need = coalesce(nullif(btrim(coalesce(p_need, '')), ''), l.need),
    budget_paise = coalesce(p_budget_paise, l.budget_paise),
    score = coalesce(least(100, greatest(0, p_score)), l.score),
    stage = case when p_stage in ('qualified', 'proposal')
                  and array_position(array['new','qualified','proposal'], p_stage)
                      > array_position(array['new','qualified','proposal'], l.stage)
                 then p_stage else l.stage end
  where l.id = v_l.id returning * into v_l;
  return jsonb_build_object('ok', true, 'stage', v_l.stage, 'score', v_l.score);
end;
$$;

-- The AI names items and quantities; prices always come from the catalog.
create function public.service_create_order(p_conversation uuid, p_items jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_c public.conversations; v_lines jsonb := '[]'::jsonb; v_total bigint := 0; v_seq int; v_o public.orders;
  v_it jsonb; v_cat public.catalog_items; v_qty int; v_limit bigint;
begin
  select * into v_c from public.conversations c where c.id = p_conversation;
  if v_c.id is null then return jsonb_build_object('error', 'conversation not found'); end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('error', 'no items');
  end if;
  for v_it in select * from jsonb_array_elements(p_items) loop
    select * into v_cat from public.catalog_items c
    where c.id = (v_it->>'catalog_item_id')::uuid and c.workspace_id = v_c.workspace_id and c.status = 'active';
    if v_cat.id is null then return jsonb_build_object('error', 'item is not in the catalog'); end if;
    if not v_cat.in_stock then return jsonb_build_object('error', v_cat.name || ' is out of stock'); end if;
    v_qty := least(999, greatest(1, coalesce((v_it->>'qty')::int, 1)));
    v_lines := v_lines || jsonb_build_object('catalog_item_id', v_cat.id, 'name', v_cat.name, 'qty', v_qty, 'price_paise', v_cat.price_paise);
    v_total := v_total + v_cat.price_paise * v_qty;
  end loop;
  select b.handoff_above_paise into v_limit from public.brand_profiles b where b.workspace_id = v_c.workspace_id;
  if v_limit is not null and v_total > v_limit then
    return jsonb_build_object('error', 'order is above the limit for AI; hand off to a person');
  end if;
  update public.workspaces w set order_seq = w.order_seq + 1 where w.id = v_c.workspace_id returning order_seq into v_seq;
  insert into public.orders (workspace_id, contact_id, conversation_id, order_no, items, total_paise, note, created_by_ai)
  values (v_c.workspace_id, v_c.contact_id, v_c.id, 'XC-' || lpad(v_seq::text, 4, '0'), v_lines, v_total,
          nullif(btrim(coalesce(p_note, '')), ''), true)
  returning * into v_o;
  update public.leads l set stage = 'proposal', value_paise = v_total
  where l.contact_id = v_c.contact_id and l.stage in ('new', 'qualified');
  perform private.audit(v_c.workspace_id, 'order.create', 'order', v_o.id, jsonb_build_object('total_paise', v_total), 'ai');
  return jsonb_build_object('ok', true, 'order_no', v_o.order_no, 'total_paise', v_total, 'items', v_lines);
end;
$$;

create function public.service_create_followup(p_conversation uuid, p_due_at timestamptz, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c public.conversations; v_kind text; v_mode text;
begin
  select * into v_c from public.conversations c where c.id = p_conversation;
  if v_c.id is null then return jsonb_build_object('error', 'conversation not found'); end if;
  if p_due_at is null or p_due_at < now() or p_due_at > now() + interval '60 days' then
    return jsonb_build_object('error', 'due time must be within the next 60 days');
  end if;
  select ch.kind into v_kind from public.channels ch where ch.id = v_c.channel_id;
  -- Outside the 24 hour window the AI may not write; it becomes a task for a person.
  v_mode := case when p_due_at <= coalesce(v_c.last_inbound_at, '-infinity') + interval '24 hours' then 'ai' else 'staff' end;
  insert into public.followups (workspace_id, conversation_id, due_at, note, mode, created_by_ai)
  values (v_c.workspace_id, v_c.id, p_due_at, left(btrim(p_note), 500), v_mode, true);
  return jsonb_build_object('ok', true, 'mode', v_mode);
end;
$$;

create function public.service_handoff(p_conversation uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c public.conversations;
begin
  update public.conversations c set ai_enabled = false, handoff_reason = left(btrim(coalesce(p_reason, 'Needs a person')), 300),
    unread = greatest(c.unread, 1)
  where c.id = p_conversation returning * into v_c;
  if v_c.id is null then return jsonb_build_object('error', 'conversation not found'); end if;
  insert into public.messages (workspace_id, conversation_id, direction, sender, body, status)
  values (v_c.workspace_id, v_c.id, 'out', 'system', 'AI handed this chat to the team: ' || v_c.handoff_reason, 'sent');
  perform private.audit(v_c.workspace_id, 'conversation.handoff', 'conversation', v_c.id, jsonb_build_object('reason', v_c.handoff_reason), 'ai');
  return jsonb_build_object('ok', true);
end;
$$;

-- Stores the AI's reply. Autopilot off (shadow mode) keeps it as a draft for a
-- person to send. Demo channels are marked sent without calling Meta.
create function public.service_ai_reply(p_conversation uuid, p_body text, p_answering uuid, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c public.conversations; v_ch public.channels; v_auto boolean; v_status text; v_m uuid; v_latest uuid;
begin
  select * into v_c from public.conversations c where c.id = p_conversation for update;
  if v_c.id is null then return jsonb_build_object('error', 'conversation not found'); end if;
  -- The customer wrote again while the AI was thinking: drop this reply, a newer run answers.
  select m.id into v_latest from public.messages m
  where m.conversation_id = v_c.id and m.direction = 'in' order by m.created_at desc limit 1;
  if v_latest is distinct from p_answering then return jsonb_build_object('stale', true); end if;
  -- p_force: the closing line the AI writes right after handing the chat over.
  if not v_c.ai_enabled and not p_force then return jsonb_build_object('stale', true); end if;
  select * into v_ch from public.channels ch where ch.id = v_c.channel_id;
  select b.autopilot into v_auto from public.brand_profiles b where b.workspace_id = v_c.workspace_id;
  v_status := case when not coalesce(v_auto, false) then 'draft' when v_ch.mode = 'demo' then 'sent' else 'queued' end;
  delete from public.messages m where m.conversation_id = v_c.id and m.status = 'draft';
  insert into public.messages (workspace_id, conversation_id, direction, sender, body, status)
  values (v_c.workspace_id, v_c.id, 'out', 'ai', left(btrim(p_body), 4000), v_status) returning id into v_m;
  if v_status <> 'draft' then
    update public.conversations c set last_message_at = now(), last_preview = left(btrim(p_body), 140), unread = 0
    where c.id = v_c.id;
  end if;
  return jsonb_build_object('message_id', v_m, 'status', v_status);
end;
$$;

-- Records the run and meters one billable conversation per contact per day.
create function public.service_log_run(p_conversation uuid, p_model text, p_input int, p_output int, p_cached int,
                                       p_tools jsonb, p_outcome text, p_detail text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.conversations; v_day date; v_w public.wallets; v_new uuid;
begin
  select * into v_c from public.conversations c where c.id = p_conversation;
  if v_c.id is null then return; end if;
  insert into public.ai_runs (workspace_id, conversation_id, model, input_tokens, output_tokens, cached_tokens, tools, outcome, detail)
  values (v_c.workspace_id, v_c.id, p_model, coalesce(p_input, 0), coalesce(p_output, 0), coalesce(p_cached, 0),
          coalesce(p_tools, '[]'::jsonb), p_outcome, left(p_detail, 500));
  if p_outcome not in ('replied', 'drafted', 'handoff') then return; end if;
  select (now() at time zone w.timezone)::date into v_day from public.workspaces w where w.id = v_c.workspace_id;
  select * into v_w from public.wallets w where w.workspace_id = v_c.workspace_id for update;
  insert into public.usage_events (workspace_id, conversation_id, day, amount_paise, from_trial)
  values (v_c.workspace_id, v_c.id, v_day,
          case when v_w.trial_conversations_left > 0 then 0 else v_w.price_per_conversation_paise end,
          v_w.trial_conversations_left > 0)
  on conflict (conversation_id, day) do nothing returning id into v_new;
  if v_new is null then return; end if;
  if v_w.trial_conversations_left > 0 then
    update public.wallets w set trial_conversations_left = w.trial_conversations_left - 1, updated_at = now()
    where w.workspace_id = v_c.workspace_id;
  else
    update public.wallets w set balance_paise = w.balance_paise - w.price_per_conversation_paise, updated_at = now()
    where w.workspace_id = v_c.workspace_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service role only
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  for f in
    select p.oid::regprocedure::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname like 'service\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
