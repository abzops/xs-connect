import { queryOptions } from '@tanstack/react-query';
import { rpc, supabase } from './supabase';
import type {
  BrandProfile, CatalogItem, Channel, Conversation, Followup, KnowledgeItem, Lead, Message, Order, Overview, StaffRow, Wallet,
} from './types';

/** The first query each section runs, shared by pages so switching shows cached data. */
async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as T[];
}

export const overviewQuery = (ws: string, days: number) => queryOptions({
  queryKey: ['overview', ws, days],
  queryFn: () => rpc<Overview>('workspace_overview', { p_ws: ws, p_days: days }),
});

export const conversationsQuery = (ws: string) => queryOptions({
  queryKey: ['conversations', ws],
  queryFn: () => rows<Conversation>(supabase.from('conversations')
    .select('*, contacts(id, display_name, phone), channels(kind, mode, display_name)')
    .eq('workspace_id', ws).order('last_message_at', { ascending: false }).limit(200)),
});

export const messagesQuery = (ws: string, conversation: string) => queryOptions({
  queryKey: ['messages', ws, conversation],
  queryFn: () => rows<Message>(supabase.from('messages').select('*')
    .eq('conversation_id', conversation).order('created_at', { ascending: true }).limit(500)),
});

export const leadsQuery = (ws: string) => queryOptions({
  queryKey: ['leads', ws],
  queryFn: () => rows<Lead>(supabase.from('leads').select('*, contacts(id, display_name, phone)')
    .eq('workspace_id', ws).order('updated_at', { ascending: false }).limit(500)),
});

export const ordersQuery = (ws: string) => queryOptions({
  queryKey: ['orders', ws],
  queryFn: () => rows<Order>(supabase.from('orders').select('*, contacts(id, display_name, phone)')
    .eq('workspace_id', ws).order('created_at', { ascending: false }).limit(300)),
});

export const followupsQuery = (ws: string) => queryOptions({
  queryKey: ['followups', ws],
  queryFn: () => rows<Followup>(supabase.from('followups')
    .select('*, conversations(contacts(id, display_name, phone), channels(kind))')
    .eq('workspace_id', ws).eq('status', 'pending').order('due_at', { ascending: true }).limit(200)),
});

export const profileQuery = (ws: string) => queryOptions({
  queryKey: ['brain', ws, 'profile'],
  queryFn: async () => {
    const { data, error } = await supabase.from('brand_profiles').select('*').eq('workspace_id', ws).single();
    if (error) throw error;
    return data as BrandProfile;
  },
});

export const catalogQuery = (ws: string) => queryOptions({
  queryKey: ['brain', ws, 'catalog'],
  queryFn: () => rows<CatalogItem>(supabase.from('catalog_items').select('*').eq('workspace_id', ws).eq('status', 'active').order('name')),
});

export const knowledgeQuery = (ws: string) => queryOptions({
  queryKey: ['brain', ws, 'knowledge'],
  queryFn: () => rows<KnowledgeItem>(supabase.from('knowledge_items').select('id, title, body, status').eq('workspace_id', ws).eq('status', 'active').order('title')),
});

export const channelsQuery = (ws: string) => queryOptions({
  queryKey: ['channels', ws],
  queryFn: () => rows<Channel>(supabase.from('channels').select('*').eq('workspace_id', ws).order('created_at')),
});

export const staffQuery = (ws: string) => queryOptions({
  queryKey: ['staff', ws],
  queryFn: () => rows<StaffRow>(supabase.from('workspace_staff').select('*').eq('workspace_id', ws).order('role').order('created_at')),
});

export const walletQuery = (ws: string) => queryOptions({
  queryKey: ['wallet', ws],
  queryFn: async () => {
    const { data, error } = await supabase.from('wallets').select('*').eq('workspace_id', ws).single();
    if (error) throw error;
    return data as Wallet;
  },
});
