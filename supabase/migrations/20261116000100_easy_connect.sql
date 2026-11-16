-- Easy channel connection.
-- 1. Staff can check a permission before the server talks to Meta for them.
-- 2. A brand that needs help asks Xelorsoft to connect a channel with them.

create function public.check_permission(p_ws uuid, p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_permission(p_ws, p_permission);
$$;
revoke all on function public.check_permission(uuid, text) from public, anon;
grant execute on function public.check_permission(uuid, text) to authenticated;

create table public.setup_requests (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  kind         text not null check (kind in ('whatsapp', 'instagram', 'messenger')),
  phone        text not null,
  requested_by uuid not null references auth.users (id),
  status       text not null default 'open' check (status in ('open', 'done')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- One open request per channel per brand; asking again refreshes it.
create unique index setup_requests_open_uidx on public.setup_requests (workspace_id, kind) where status = 'open';
alter table public.setup_requests enable row level security;
create policy setup_requests_read on public.setup_requests for select to authenticated
  using (private.is_staff(workspace_id));
grant select on public.setup_requests to authenticated;

create function public.request_channel_setup(p_ws uuid, p_kind text, p_phone text)
returns public.setup_requests language plpgsql security definer set search_path = '' as $$
declare v public.setup_requests; v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
begin
  perform private.require(p_ws, 'channels.manage');
  if p_kind not in ('whatsapp', 'instagram', 'messenger') then raise exception 'XS400: unknown channel'; end if;
  if length(regexp_replace(v_phone, '\D', '', 'g')) < 10 then raise exception 'XS400: enter a phone number we can call'; end if;
  insert into public.setup_requests (workspace_id, kind, phone, requested_by)
  values (p_ws, p_kind, v_phone, auth.uid())
  on conflict (workspace_id, kind) where status = 'open'
  do update set phone = excluded.phone, requested_by = excluded.requested_by, updated_at = now()
  returning * into v;
  perform private.audit(p_ws, 'channel.setup_request', 'setup_request', v.id, jsonb_build_object('kind', p_kind));
  return v;
end;
$$;
revoke all on function public.request_channel_setup(uuid, text, text) from public, anon;
grant execute on function public.request_channel_setup(uuid, text, text) to authenticated;

-- A connected channel closes its open setup request.
create function private.close_setup_request() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.mode = 'live' and new.status = 'connected' then
    update public.setup_requests r set status = 'done', updated_at = now()
    where r.workspace_id = new.workspace_id and r.kind = new.kind and r.status = 'open';
  end if;
  return new;
end;
$$;
create trigger channels_close_setup_request after insert or update of status, mode on public.channels
  for each row execute function private.close_setup_request();
