-- Voice notes and reply timing.
-- A customer's voice note arrives as a media reference; the webhook downloads
-- it, transcribes it and stores the transcript as the message body.

alter table public.messages
  add column media_ref text,        -- WhatsApp media id, or the attachment URL on Instagram and Messenger
  add column media_mime text,
  add column transcribed_by text;   -- which model wrote the transcript; null when it is not a transcript
alter table public.ai_runs add column latency_ms int;

create function public.service_attach_media(p_message uuid, p_ref text, p_mime text default null)
returns void language sql security definer set search_path = '' as $$
  update public.messages m set media_ref = left(p_ref, 2000), media_mime = left(p_mime, 100)
  where m.id = p_message and m.direction = 'in' and m.media_ref is null;
$$;

-- What the transcriber needs to fetch one inbound voice note.
create function public.service_voice_target(p_message uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_m public.messages; v_ch public.channels; v_token text;
begin
  select * into v_m from public.messages m where m.id = p_message and m.direction = 'in' and m.kind = 'audio';
  if v_m.id is null or v_m.media_ref is null then return jsonb_build_object('error', 'no voice note'); end if;
  if v_m.body <> '' then return jsonb_build_object('error', 'already transcribed'); end if;
  select ch.* into v_ch from public.channels ch
  join public.conversations c on c.channel_id = ch.id where c.id = v_m.conversation_id;
  if v_ch.mode <> 'live' or v_ch.status <> 'connected' then return jsonb_build_object('error', 'channel not live'); end if;
  select s.access_token into v_token from private.channel_secrets s where s.channel_id = v_ch.id;
  if v_token is null then return jsonb_build_object('error', 'channel has no token'); end if;
  return jsonb_build_object('kind', v_ch.kind, 'token', v_token, 'media_ref', v_m.media_ref, 'media_mime', v_m.media_mime);
end;
$$;

create function public.service_set_transcript(p_message uuid, p_body text, p_by text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_conv uuid;
begin
  update public.messages m set body = left(btrim(p_body), 4000), transcribed_by = left(p_by, 60)
  where m.id = p_message and m.direction = 'in' and m.kind = 'audio' and m.body = '' and btrim(coalesce(p_body, '')) <> ''
  returning m.conversation_id into v_conv;
  if v_conv is null then return; end if;
  -- Show the words in the inbox list when the voice note is still the latest message.
  update public.conversations c set last_preview = left('Voice note: ' || btrim(p_body), 140)
  where c.id = v_conv and not exists (
    select 1 from public.messages x where x.conversation_id = v_conv and x.status <> 'draft'
      and x.created_at > (select m.created_at from public.messages m where m.id = p_message));
end;
$$;

-- Seconds matter in chat: record how long the latest AI turn took.
create function public.service_log_latency(p_conversation uuid, p_latency_ms int)
returns void language sql security definer set search_path = '' as $$
  update public.ai_runs r set latency_ms = p_latency_ms
  where r.id = (select x.id from public.ai_runs x where x.conversation_id = p_conversation order by x.created_at desc limit 1);
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
