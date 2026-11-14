export type Role = 'owner' | 'manager' | 'agent';
export type ChannelKind = 'whatsapp' | 'instagram' | 'messenger';
export type Vertical = 'general' | 'gym' | 'clinic' | 'salon' | 'coaching' | 'real_estate' | 'retail' | 'restaurant';

export type Workspace = {
  id: string; name: string; slug: string; timezone: string; phone: string | null; vertical: Vertical;
  status: 'active' | 'suspended'; onboarded_at: string | null; created_at: string;
};

export type StaffRow = {
  id: string; workspace_id: string; user_id: string; role: Role; status: 'active' | 'inactive';
  display_name: string | null; email: string | null; created_at: string;
};

export type Wallet = {
  workspace_id: string; balance_paise: number; trial_conversations_left: number; price_per_conversation_paise: number;
};

export type Channel = {
  id: string; workspace_id: string; kind: ChannelKind; external_id: string; display_name: string;
  mode: 'live' | 'demo'; status: 'connected' | 'disconnected'; created_at: string;
};

export type Contact = { id: string; display_name: string; phone: string | null };

export type Conversation = {
  id: string; workspace_id: string; channel_id: string; contact_id: string; status: 'open' | 'closed';
  ai_enabled: boolean; handoff_reason: string | null; assigned_to: string | null; last_message_at: string;
  last_inbound_at: string | null; last_preview: string | null; unread: number;
  contacts: Contact; channels: Pick<Channel, 'kind' | 'mode' | 'display_name'>;
};

export type MessageStatus = 'received' | 'draft' | 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
export type Message = {
  id: string; conversation_id: string; direction: 'in' | 'out'; sender: 'contact' | 'ai' | 'staff' | 'system';
  kind: string; body: string; status: MessageStatus; error: string | null; created_at: string;
};

export type LeadStage = 'new' | 'qualified' | 'proposal' | 'won' | 'lost';
export type Lead = {
  id: string; workspace_id: string; contact_id: string; conversation_id: string | null; stage: LeadStage; score: number;
  need: string | null; budget_paise: number | null; value_paise: number | null; source: ChannelKind | 'manual';
  notes: string | null; lost_reason: string | null; created_at: string; updated_at: string; closed_at: string | null;
  contacts: Contact;
};

export type OrderStatus = 'pending' | 'confirmed' | 'paid' | 'fulfilled' | 'cancelled';
export type OrderLine = { catalog_item_id: string; name: string; qty: number; price_paise: number };
export type Order = {
  id: string; order_no: string; status: OrderStatus; items: OrderLine[]; total_paise: number; note: string | null;
  created_by_ai: boolean; created_at: string; conversation_id: string | null; contacts: Contact;
};

export type Followup = {
  id: string; conversation_id: string; due_at: string; note: string; mode: 'ai' | 'staff';
  status: 'pending' | 'done' | 'cancelled'; created_by_ai: boolean;
  conversations: { contacts: Contact; channels: Pick<Channel, 'kind'> };
};

export type BrandProfile = {
  workspace_id: string; about: string; services: string; offers: string; hours: string; location: string;
  policies: string; tone: string; never_say: string; handoff_above_paise: number | null; autopilot: boolean;
};

export type CatalogItem = {
  id: string; kind: 'product' | 'service'; name: string; description: string | null; price_paise: number;
  unit: string | null; in_stock: boolean; status: 'active' | 'archived';
};

export type KnowledgeItem = { id: string; title: string; body: string; status: 'active' | 'archived' };

export type Overview = {
  days: number; conversations: number; waiting: number; handoffs: number; drafts: number;
  leads_new: number; leads_open: number; leads_won: number; leads_lost: number; orders: number; revenue_paise: number;
  ai_replies: number; staff_replies: number; followups_due: number; billable_conversations: number; spend_paise: number;
  by_channel: Partial<Record<ChannelKind, number>>; by_stage: Partial<Record<LeadStage, number>>;
  daily: { day: string; inbound: number }[];
};

export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', manager: 'Manager', agent: 'Agent' };
export const CHANNEL_LABEL: Record<ChannelKind, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' };
export const STAGE_LABEL: Record<LeadStage, string> = { new: 'New', qualified: 'Qualified', proposal: 'Proposal', won: 'Won', lost: 'Lost' };
export const ORDER_LABEL: Record<OrderStatus, string> = { pending: 'Pending', confirmed: 'Confirmed', paid: 'Paid', fulfilled: 'Fulfilled', cancelled: 'Cancelled' };
export const VERTICAL_LABEL: Record<Vertical, string> = {
  general: 'Other business', gym: 'Gym or fitness', clinic: 'Clinic', salon: 'Salon or spa', coaching: 'Coaching or classes',
  real_estate: 'Real estate', retail: 'Shop or online store', restaurant: 'Restaurant or cafe',
};
