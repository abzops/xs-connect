import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useWorkspace } from '../../app/workspace';
import { Loading, Notice, Segmented } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { overviewQuery } from '../../lib/sections';
import { CHANNEL_LABEL, STAGE_LABEL, type ChannelKind, type LeadStage } from '../../lib/types';

type Range = '7' | '30' | '90';

/** A labelled share-of-total row list. Values are always printed, never only drawn. */
function Breakdown({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.label}>
          <span>{r.label}</span>
          <span className="track" aria-hidden><span className="fill" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="num">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function AnalyticsPage() {
  const { ws } = useWorkspace();
  const [range, setRange] = useState<Range>('30');
  const q = useQuery(overviewQuery(ws.id, Number(range)));
  const o = q.data;
  const closed = o ? o.leads_won + o.leads_lost : 0;
  const replies = o ? o.ai_replies + o.staff_replies : 0;
  return (
    <div className="stack lg">
      <div className="page-head"><h1>Analytics</h1></div>
      <Segmented label="Period" value={range} onChange={setRange}
        options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
      {q.isPending ? <Loading /> : q.error ? <Notice tone="bad">{errorMessage(q.error)}</Notice> : o && (
        <>
          <div className="tiles">
            <div className="tile"><span className="label">Conversations</span><span className="value num">{o.conversations}</span><span className="sub">active in the period</span></div>
            <div className="tile"><span className="label">New leads</span><span className="value num">{o.leads_new}</span><span className="sub">{o.leads_won} won, {o.leads_lost} lost</span></div>
            <div className="tile"><span className="label">Lead conversion</span><span className="value num">{closed ? `${Math.round((o.leads_won / closed) * 100)}%` : '—'}</span><span className="sub">of closed leads</span></div>
            <div className="tile"><span className="label">Paid revenue</span><span className="value num">{formatINR(o.revenue_paise)}</span><span className="sub">{o.orders} orders</span></div>
            <div className="tile"><span className="label">Answered by AI</span><span className="value num">{replies ? `${Math.round((o.ai_replies / replies) * 100)}%` : '—'}</span><span className="sub">{o.ai_replies} AI, {o.staff_replies} team replies</span></div>
            <div className="tile"><span className="label">AI conversations billed</span><span className="value num">{o.billable_conversations}</span><span className="sub">{formatINR(o.spend_paise)} spent</span></div>
          </div>
          <div className="two-col">
            <section className="card stack">
              <h2>Conversations by channel</h2>
              <Breakdown rows={(Object.keys(CHANNEL_LABEL) as ChannelKind[]).map((k) => ({ label: CHANNEL_LABEL[k], value: o.by_channel[k] ?? 0 }))} />
            </section>
            <section className="card stack">
              <h2>Leads by stage</h2>
              <Breakdown rows={(Object.keys(STAGE_LABEL) as LeadStage[]).map((k) => ({ label: STAGE_LABEL[k], value: o.by_stage[k] ?? 0 }))} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
