import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../app/auth';
import { useWorkspace } from '../../app/workspace';
import { AppearanceControl } from '../../components/Appearance';
import { ConnectSheet } from './ConnectSheet';
import { ChannelChip } from '../../components/bits';
import { Empty, Loading, Notice, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { channelsQuery, staffQuery, walletQuery } from '../../lib/sections';
import { rpc } from '../../lib/supabase';
import { ROLE_LABEL, type Channel } from '../../lib/types';

const WEBHOOK = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-webhook`;

export function SettingsPage() {
  const { ws, can } = useWorkspace();
  const { session } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const channels = useQuery(channelsQuery(ws.id));
  const staff = useQuery(staffQuery(ws.id));
  const wallet = useQuery(walletQuery(ws.id));
  const [connect, setConnect] = useState(false);
  const manage = can('channels.manage');
  const disconnect = useMutation({
    mutationFn: (c: Channel) => rpc('disconnect_channel', { p_ws: ws.id, p_channel: c.id }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['channels', ws.id] }); toast('Channel disconnected'); },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const seed = useMutation({
    mutationFn: () => rpc('seed_demo', { p_ws: ws.id }),
    onSuccess: async () => { await qc.invalidateQueries(); toast('Sample chats added'); },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const hasDemo = (channels.data ?? []).some((c) => c.mode === 'demo');

  return (
    <div className="stack lg">
      <div className="page-head"><h1>Settings</h1></div>

      <section className="card flush">
        <div className="card-head">
          <h2>Channels</h2>
          {manage && <button className="btn small" onClick={() => setConnect(true)}><Plus size={16} /> Connect</button>}
        </div>
        {channels.isPending ? <div style={{ padding: 16 }}><Loading rows={2} /></div> : channels.error ? <Notice tone="bad">{errorMessage(channels.error)}</Notice>
          : channels.data.length === 0 ? <Empty title="No channels connected">Connect WhatsApp, Instagram or Facebook to receive messages here.</Empty> : (
            <ul className="list">
              {channels.data.map((c) => (
                <li key={c.id} className="item">
                  <span className="main-col">
                    <span className="title">{c.display_name}</span>
                    <span className="meta"><ChannelChip kind={c.kind} demo={c.mode === 'demo'} /><span>{c.status === 'connected' ? 'Connected' : 'Disconnected'}</span></span>
                  </span>
                  {manage && c.mode === 'live' && c.status === 'connected' && (
                    <button className="btn small ghost danger" disabled={disconnect.isPending} onClick={() => disconnect.mutate(c)}>Disconnect</button>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>

      {manage && (
        <section className="card stack">
          <h2>Meta webhook</h2>
          <p className="muted" style={{ margin: 0 }}>In your Meta app, set this as the callback URL for WhatsApp, Instagram and Messenger. The verify token is the one saved as META_VERIFY_TOKEN.</p>
          <div className="codebox">{WEBHOOK}</div>
        </section>
      )}

      <section className="card stack">
        <h2>Usage and wallet</h2>
        {wallet.isPending ? <Loading rows={1} /> : wallet.error ? <Notice tone="bad">{errorMessage(wallet.error)}</Notice> : (
          <dl className="kv">
            <dt>Free conversations left</dt><dd className="num">{wallet.data.trial_conversations_left}</dd>
            <dt>Wallet balance</dt><dd className="num">{formatINR(wallet.data.balance_paise)}</dd>
            <dt>Price</dt><dd><span className="num">{formatINR(wallet.data.price_per_conversation_paise)}</span> per AI conversation (one customer, one day)</dd>
          </dl>
        )}
        <p className="muted" style={{ margin: 0 }}>Online recharge is not live yet. WhatsApp message charges are billed by Meta to your own WhatsApp Business account.</p>
      </section>

      <section className="card flush">
        <div className="card-head"><h2>Team</h2></div>
        {staff.isPending ? <div style={{ padding: 16 }}><Loading rows={2} /></div> : staff.error ? <Notice tone="bad">{errorMessage(staff.error)}</Notice> : (
          <ul className="list">
            {staff.data.map((s) => (
              <li key={s.id} className="item">
                <span className="main-col">
                  <span className="title">{s.display_name ?? s.email}{s.user_id === session?.user.id ? ' (you)' : ''}</span>
                  <span className="meta"><span>{ROLE_LABEL[s.role]}</span><span>{s.email}</span></span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card appearance-row"><h2>Appearance</h2><AppearanceControl /></section>

      {can('workspace.settings') && !hasDemo && channels.isSuccess && (
        <section className="card stack">
          <h2>Sample chats</h2>
          <p className="muted" style={{ margin: 0 }}>Add demo conversations to try the inbox and test the AI. Nothing is sent to anyone.</p>
          <div><button className="btn" disabled={seed.isPending} onClick={() => seed.mutate()}>{seed.isPending ? <span className="spinner" /> : 'Add sample chats'}</button></div>
        </section>
      )}

      {connect && <ConnectSheet onClose={() => setConnect(false)} />}
    </div>
  );
}
