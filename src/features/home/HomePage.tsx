import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Link } from 'react-router';
import { useWorkspace } from '../../app/workspace';
import { ago, ChannelChip } from '../../components/bits';
import { Loading, Notice, PushLink, useToast } from '../../components/ui';
import { formatDateTime } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { catalogQuery, channelsQuery, conversationsQuery, followupsQuery, overviewQuery, profileQuery } from '../../lib/sections';
import { rpc } from '../../lib/supabase';

export function HomePage() {
  const { ws, can } = useWorkspace();
  const base = `/b/${ws.slug}`;
  const qc = useQueryClient();
  const toast = useToast();
  const overview = useQuery(overviewQuery(ws.id, 30));
  const channels = useQuery(channelsQuery(ws.id));
  const profile = useQuery({ ...profileQuery(ws.id), enabled: can('brain.read') });
  const catalog = useQuery({ ...catalogQuery(ws.id), enabled: can('brain.read') });
  const followups = useQuery(followupsQuery(ws.id));
  const conversations = useQuery(conversationsQuery(ws.id));
  const seed = useMutation({
    mutationFn: () => rpc('seed_demo', { p_ws: ws.id }),
    onSuccess: async () => { await qc.invalidateQueries(); toast('Sample chats added'); },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  const o = overview.data;
  const live = (channels.data ?? []).some((c) => c.mode === 'live' && c.status === 'connected');
  const hasDemo = (channels.data ?? []).some((c) => c.mode === 'demo');
  const steps = [
    { done: (profile.data?.about.trim().length ?? 0) > 20, text: 'Tell the AI about your business', to: `${base}/brain` },
    { done: (catalog.data?.length ?? 0) > 0, text: 'Add your products or services with prices', to: `${base}/brain` },
    { done: live, text: 'Connect WhatsApp, Instagram or Facebook', to: `${base}/settings` },
  ];
  const setupLeft = steps.filter((s) => !s.done).length;
  const waiting = (conversations.data ?? []).filter((c) => c.status === 'open' && (c.handoff_reason || (!c.ai_enabled && c.unread > 0))).slice(0, 5);
  const due = (followups.data ?? []).filter((f) => Date.parse(f.due_at) <= Date.now()).slice(0, 5);

  return (
    <div className="stack lg">
      <div className="page-head"><h1>Home</h1></div>
      {overview.error && <Notice tone="bad">{errorMessage(overview.error)}</Notice>}
      {overview.isPending ? <Loading rows={2} /> : o && (
        <div className="tiles">
          <Link className="tile" to={`${base}/inbox`}><span className="label">Waiting for you</span><span className="value num">{o.waiting + o.drafts}</span><span className="sub">{o.drafts} draft{o.drafts === 1 ? '' : 's'} to approve</span></Link>
          <Link className="tile" to={`${base}/leads`}><span className="label">Open leads</span><span className="value num">{o.leads_open}</span><span className="sub">{o.leads_won} won in 30 days</span></Link>
          <Link className="tile" to={`${base}/orders`}><span className="label">Orders</span><span className="value num">{o.orders}</span><span className="sub">last 30 days</span></Link>
          <div className="tile"><span className="label">Paid revenue</span><span className="value num">{formatINR(o.revenue_paise)}</span><span className="sub">last 30 days</span></div>
        </div>
      )}

      {can('workspace.settings') && setupLeft > 0 && (
        <section className="card">
          <h2>Get started</h2>
          <ul className="checklist">
            {steps.map((s) => (
              <li key={s.text} className={s.done ? 'done' : ''}>
                <span className="tick">{s.done && <Check size={14} strokeWidth={3} />}</span>
                <span className="txt">{s.text}</span>
                {!s.done && <Link to={s.to}>Open</Link>}
              </li>
            ))}
          </ul>
          {!hasDemo && !live && channels.isSuccess && (
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" disabled={seed.isPending} onClick={() => seed.mutate()}>
                {seed.isPending ? <span className="spinner" /> : 'Try it with sample chats'}
              </button>
              <span className="muted">Adds demo conversations. Nothing is sent to anyone.</span>
            </div>
          )}
        </section>
      )}

      <section className="card flush">
        <div className="card-head"><h2>Needs a person</h2><Link to={`${base}/inbox`}>Inbox</Link></div>
        {conversations.isPending ? <div style={{ padding: 16 }}><Loading rows={2} /></div> : waiting.length === 0
          ? <p className="muted" style={{ padding: '4px 18px 18px', margin: 0 }}>Nothing is waiting. The AI is handling the rest.</p> : (
            <ul className="list">
              {waiting.map((c) => (
                <li key={c.id}>
                  <PushLink className="item row-link" to={`${base}/inbox/${c.id}`}>
                    <span className="main-col">
                      <span className="title">{c.contacts.display_name}</span>
                      <span className="preview">{c.handoff_reason ?? c.last_preview}</span>
                    </span>
                    <span className="end-col"><ChannelChip kind={c.channels.kind} /><span className="when">{ago(c.last_message_at)}</span></span>
                  </PushLink>
                </li>
              ))}
            </ul>
          )}
      </section>

      {due.length > 0 && (
        <section className="card flush">
          <div className="card-head"><h2>Follow-ups due</h2></div>
          <ul className="list">
            {due.map((f) => (
              <li key={f.id}>
                <PushLink className="item row-link" to={`${base}/inbox/${f.conversation_id}`}>
                  <span className="main-col">
                    <span className="title">{f.conversations.contacts.display_name}</span>
                    <span className="preview">{f.note}</span>
                  </span>
                  <span className="end-col"><ChannelChip kind={f.conversations.channels.kind} /><span className="when">{formatDateTime(f.due_at, ws.timezone)}</span></span>
                </PushLink>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
