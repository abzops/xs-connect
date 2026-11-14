-- XS Connect — messaging domain: channels, contacts, conversations, messages,
-- leads, orders, follow-ups, Brand Brain, AI runs and usage metering.

-- ---------------------------------------------------------------------------
-- Channels (a WhatsApp number, an Instagram account, a Facebook Page)
-- ---------------------------------------------------------------------------

create table public.channels (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  kind         text not null check (kind in ('whatsapp', 'instagram', 'messenger')),
  -- WhatsApp: phone_number_id. Instagram: professional account id. Messenger: Page id.
  external_id  text not null check (length(btrim(external_id)) between 1 and 64),
  display_name text not null,
  -- demo channels never call Meta; they let a brand try the product first.
  mode         text not null default 'live' check (mode in ('live', 'demo')),
  status       text not null default 'connected' check (status in ('connected', 'disconnected')),
  created_at   timestamptz not null default now(),
  unique (kind, external_id)
);
create index channels_ws_idx on public.channels (workspace_id);

-- Access tokens never leave the database through the API.
create table private.channel_secrets (
  channel_id   uuid primary key references public.channels (id) on delete cascade,
  access_token text not null,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create table public.contacts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  display_name text not null default 'Unknown',
  phone        text,
  notes        text,
  created_at   timestamptz not null default now()
);
create index contacts_ws_idx on public.contacts (workspace_id);
create index contacts_ws_phone_idx on public.contacts (workspace_id, phone) where phone is not null;

-- One person can reach a brand on several channels; identities merge on phone.
create table public.contact_identities (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  contact_id   uuid not null references public.contacts (id),
  kind         text not null check (kind in ('whatsapp', 'instagram', 'messenger')),
  external_id  text not null,
  unique (workspace_id, kind, external_id)
);
create index contact_identities_contact_idx on public.contact_identities (contact_id);

-- ---------------------------------------------------------------------------
-- Conversations and messages
-- ---------------------------------------------------------------------------

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id),
  channel_id      uuid not null references public.channels (id),
  contact_id      uuid not null references public.contacts (id),
  contact_external text not null,
  status          text not null default 'open' check (status in ('open', 'closed')),
  ai_enabled      boolean not null default true,
  handoff_reason  text,
  assigned_to     uuid references auth.users (id),
  last_message_at timestamptz not null default now(),
  -- Meta allows free-form replies for 24 hours after the customer's last message.
  last_inbound_at timestamptz,
  last_preview    text,
  unread          int not null default 0,
  created_at      timestamptz not null default now(),
  unique (channel_id, contact_external)
);
create index conversations_ws_recent_idx on public.conversations (workspace_id, last_message_at desc);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id),
  conversation_id uuid not null references public.conversations (id),
  direction       text not null check (direction in ('in', 'out')),
  sender          text not null check (sender in ('contact', 'ai', 'staff', 'system')),
  kind            text not null default 'text' check (kind in ('text', 'image', 'audio', 'video', 'document', 'template', 'other')),
  body            text not null default '',
  external_id     text,
  status          text not null default 'received'
                  check (status in ('received', 'draft', 'queued', 'sent', 'delivered', 'read', 'failed')),
  error           text,
  sent_by         uuid references auth.users (id),
  created_at      timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
-- Meta retries webhooks; the same message must never be stored twice.
create unique index messages_external_uidx on public.messages (workspace_id, external_id) where external_id is not null;

-- ---------------------------------------------------------------------------
-- Sales: leads, orders, follow-ups
-- ---------------------------------------------------------------------------

create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id),
  contact_id      uuid not null references public.contacts (id),
  conversation_id uuid references public.conversations (id),
  stage           text not null default 'new' check (stage in ('new', 'qualified', 'proposal', 'won', 'lost')),
  score           int not null default 0 check (score between 0 and 100),
  need            text,
  budget_paise    bigint check (budget_paise is null or budget_paise >= 0),
  value_paise     bigint check (value_paise is null or value_paise >= 0),
  source          text not null default 'whatsapp' check (source in ('whatsapp', 'instagram', 'messenger', 'manual')),
  notes           text,
  lost_reason     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz
);
create index leads_ws_stage_idx on public.leads (workspace_id, stage, updated_at desc);
-- One open lead per contact; a closed one can be followed by a new enquiry.
create unique index leads_open_contact_uidx on public.leads (contact_id) where stage not in ('won', 'lost');
create trigger leads_touch before update on public.leads
  for each row execute function private.touch_updated_at();

create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id),
  contact_id      uuid not null references public.contacts (id),
  conversation_id uuid references public.conversations (id),
  order_no        text not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'confirmed', 'paid', 'fulfilled', 'cancelled')),
  items           jsonb not null default '[]',
  total_paise     bigint not null default 0 check (total_paise >= 0),
  note            text,
  payment_link    text,
  created_by_ai   boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, order_no)
);
create index orders_ws_recent_idx on public.orders (workspace_id, created_at desc);
create trigger orders_touch before update on public.orders
  for each row execute function private.touch_updated_at();

create table public.followups (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id),
  conversation_id uuid not null references public.conversations (id),
  due_at          timestamptz not null,
  note            text not null,
  -- 'ai' sends on its own inside the messaging window; 'staff' is a task for a person.
  mode            text not null default 'staff' check (mode in ('ai', 'staff')),
  status          text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  created_by_ai   boolean not null default false,
  created_at      timestamptz not null default now(),
  done_at         timestamptz
);
create index followups_ws_due_idx on public.followups (workspace_id, status, due_at);

-- ---------------------------------------------------------------------------
-- Brand Brain: what the AI knows about the brand
-- ---------------------------------------------------------------------------

create table public.brand_profiles (
  workspace_id   uuid primary key references public.workspaces (id),
  about          text not null default '',
  services       text not null default '',
  offers         text not null default '',
  hours          text not null default '',
  location       text not null default '',
  policies       text not null default '',
  tone           text not null default 'Friendly, short and clear. Reply in the customer''s own language.',
  never_say      text not null default '',
  -- Above this deal size the AI hands the chat to a person.
  handoff_above_paise bigint check (handoff_above_paise is null or handoff_above_paise >= 0),
  -- false = shadow mode: the AI writes drafts and a person sends them.
  autopilot      boolean not null default false,
  updated_at     timestamptz not null default now()
);

create table public.catalog_items (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  kind         text not null default 'product' check (kind in ('product', 'service')),
  name         text not null check (length(btrim(name)) between 1 and 160),
  description  text,
  price_paise  bigint not null check (price_paise >= 0),
  unit         text,
  in_stock     boolean not null default true,
  status       text not null default 'active' check (status in ('active', 'archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index catalog_items_ws_idx on public.catalog_items (workspace_id, status);

create table public.knowledge_items (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  title        text not null check (length(btrim(title)) between 1 and 200),
  body         text not null,
  status       text not null default 'active' check (status in ('active', 'archived')),
  fts          tsvector generated always as (to_tsvector('simple', title || ' ' || body)) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index knowledge_items_fts_idx on public.knowledge_items using gin (fts);
create index knowledge_items_ws_idx on public.knowledge_items (workspace_id, status);

-- ---------------------------------------------------------------------------
-- AI runs and usage (the meter behind pay-per-conversation)
-- ---------------------------------------------------------------------------

create table public.ai_runs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id),
  conversation_id uuid not null references public.conversations (id),
  model           text not null,
  input_tokens    int not null default 0,
  output_tokens   int not null default 0,
  cached_tokens   int not null default 0,
  tools           jsonb not null default '[]',
  outcome         text not null check (outcome in ('replied', 'drafted', 'handoff', 'skipped', 'error')),
  detail          text,
  created_at      timestamptz not null default now()
);
create index ai_runs_ws_time_idx on public.ai_runs (workspace_id, created_at desc);

-- One billable AI conversation per contact per day (a 24 hour session).
create table public.usage_events (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id),
  conversation_id uuid not null references public.conversations (id),
  day             date not null,
  amount_paise    int not null default 0,
  from_trial      boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (conversation_id, day)
);
create index usage_events_ws_day_idx on public.usage_events (workspace_id, day);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

do $$
declare t text; perm text;
begin
  for t, perm in values
    ('channels', 'channels.read'), ('contacts', 'inbox.read'), ('contact_identities', 'inbox.read'),
    ('conversations', 'inbox.read'), ('messages', 'inbox.read'), ('leads', 'leads.read'),
    ('orders', 'orders.read'), ('followups', 'inbox.read'), ('brand_profiles', 'brain.read'),
    ('catalog_items', 'brain.read'), ('knowledge_items', 'brain.read'), ('ai_runs', 'reports.read'),
    ('usage_events', 'reports.read')
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.has_permission(workspace_id, %L)))',
      t || '_read', t, perm);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

alter table private.channel_secrets enable row level security;
revoke all on private.channel_secrets from public, anon, authenticated;

-- Live inbox: staff see new messages without refreshing.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.conversations;
  end if;
end $$;
