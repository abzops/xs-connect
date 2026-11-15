-- Each customer picks the language the AI writes to them in.
alter table public.contacts add column language text check (language in ('english', 'malayalam'));

create or replace function public.service_agent_context(p_conversation uuid, p_user uuid default null)
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
    'contact', (select jsonb_build_object('name', k.display_name, 'phone', k.phone, 'language', k.language) from public.contacts k where k.id = v_c.contact_id),
    'lead', (select jsonb_build_object('stage', l.stage, 'score', l.score, 'need', l.need, 'budget_paise', l.budget_paise)
             from public.leads l where l.contact_id = v_c.contact_id and l.stage not in ('won', 'lost') limit 1),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('direction', x.direction, 'sender', x.sender,
                   'kind', x.kind, 'body', x.body) order by x.created_at), '[]'::jsonb)
                 from (select m.* from public.messages m
                       where m.conversation_id = v_c.id and m.status <> 'draft' and m.sender <> 'system'
                       order by m.created_at desc limit 30) x));
end;
$$;

create function public.service_set_language(p_conversation uuid, p_language text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_lang text := lower(btrim(coalesce(p_language, '')));
begin
  if v_lang not in ('english', 'malayalam') then return jsonb_build_object('error', 'language must be english or malayalam'); end if;
  update public.contacts k set language = v_lang
  where k.id = (select c.contact_id from public.conversations c where c.id = p_conversation);
  if not found then return jsonb_build_object('error', 'conversation not found'); end if;
  return jsonb_build_object('language', v_lang, 'next', 'Write every reply from now on fully in ' || initcap(v_lang) || '.');
end;
$$;

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
