-- XS Connect — foundation: workspaces (brands), staff access, permissions, audit.
-- Same rules as XS Gym: every write goes through a command function; API roles
-- only read, through row level security.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 2 and 120),
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  timezone     text not null default 'Asia/Kolkata',
  phone        text,
  vertical     text not null default 'general'
               check (vertical in ('general','gym','clinic','salon','coaching','real_estate','retail','restaurant')),
  status       text not null default 'active' check (status in ('active', 'suspended')),
  onboarded_at timestamptz,
  order_seq    int not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id),
  updated_at   timestamptz not null default now()
);

create table public.workspace_staff (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  user_id      uuid not null references auth.users (id),
  role         text not null check (role in ('owner', 'manager', 'agent')),
  status       text not null default 'active' check (status in ('active', 'inactive')),
  display_name text,
  email        text,
  created_at   timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index workspace_staff_user_idx on public.workspace_staff (user_id);

create table public.role_permissions (
  role       text not null check (role in ('owner', 'manager', 'agent')),
  permission text not null,
  primary key (role, permission)
);

insert into public.role_permissions (role, permission)
select 'owner', p from unnest(array[
  'inbox.read','inbox.reply','leads.read','leads.write','orders.read','orders.write',
  'brain.read','brain.manage','channels.read','channels.manage','reports.read',
  'staff.read','staff.manage','workspace.settings','billing.manage','audit.read']) p
union all
select 'manager', p from unnest(array[
  'inbox.read','inbox.reply','leads.read','leads.write','orders.read','orders.write',
  'brain.read','brain.manage','channels.read','reports.read','staff.read']) p
union all
select 'agent', p from unnest(array[
  'inbox.read','inbox.reply','leads.read','leads.write','orders.read','orders.write',
  'brain.read','channels.read','staff.read']) p;

-- Pay per conversation: a prepaid wallet per workspace, plus free trial conversations.
create table public.wallets (
  workspace_id             uuid primary key references public.workspaces (id),
  balance_paise            bigint not null default 0,
  trial_conversations_left int not null default 100 check (trial_conversations_left >= 0),
  price_per_conversation_paise int not null default 500 check (price_per_conversation_paise >= 0),
  updated_at               timestamptz not null default now()
);

create table public.audit_logs (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null references public.workspaces (id),
  occurred_at   timestamptz not null default now(),
  actor_user_id uuid,
  actor         text not null default 'staff' check (actor in ('staff', 'ai', 'system')),
  action        text not null,
  entity        text not null,
  entity_id     uuid,
  data          jsonb
);
create index audit_logs_ws_time_idx on public.audit_logs (workspace_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Helpers (not exposed through the API)
-- ---------------------------------------------------------------------------

create function private.is_staff(p_ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_staff s
    where s.workspace_id = p_ws and s.user_id = auth.uid() and s.status = 'active');
$$;

create function private.has_permission(p_ws uuid, p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.workspace_staff s
    join public.role_permissions rp on rp.role = s.role
    where s.workspace_id = p_ws and s.user_id = auth.uid() and s.status = 'active'
      and rp.permission = p_permission);
$$;

create function private.require(p_ws uuid, p_permission text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'XS401: sign in required' using errcode = '42501';
  end if;
  if not private.has_permission(p_ws, p_permission) then
    raise exception 'XS403: you do not have permission to do this' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspaces w where w.id = p_ws and w.status = 'active') then
    raise exception 'XS402: this workspace is suspended. Data is read-only.' using errcode = 'P0001';
  end if;
end;
$$;

create function private.audit(p_ws uuid, p_action text, p_entity text, p_entity_id uuid,
                              p_data jsonb default null, p_actor text default 'staff')
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (workspace_id, actor_user_id, actor, action, entity, entity_id, data)
  values (p_ws, auth.uid(), p_actor, p_action, p_entity, p_entity_id, p_data);
$$;

create function private.reject_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'XS405: % rows cannot be changed or deleted', tg_table_name using errcode = '42501';
end;
$$;

create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function private.reject_change();

create function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger workspaces_touch before update on public.workspaces
  for each row execute function private.touch_updated_at();

create function private.slugify(p_name text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(nullif(btrim(regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'brand');
$$;

-- ---------------------------------------------------------------------------
-- Row level security: default deny, read-only policies
-- ---------------------------------------------------------------------------

alter table public.workspaces       enable row level security;
alter table public.workspace_staff  enable row level security;
alter table public.role_permissions enable row level security;
alter table public.wallets          enable row level security;
alter table public.audit_logs       enable row level security;

create policy workspaces_read on public.workspaces for select to authenticated
  using ((select private.is_staff(id)));
create policy workspace_staff_read on public.workspace_staff for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_permission(workspace_id, 'staff.read')));
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy wallets_read on public.wallets for select to authenticated
  using ((select private.is_staff(workspace_id)));
create policy audit_logs_read on public.audit_logs for select to authenticated
  using ((select private.has_permission(workspace_id, 'audit.read')));

revoke all on public.workspaces, public.workspace_staff, public.role_permissions, public.wallets, public.audit_logs
  from anon, authenticated;
grant select on public.workspaces, public.workspace_staff, public.role_permissions, public.wallets, public.audit_logs
  to authenticated;
