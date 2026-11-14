import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { useWorkspace } from '../../app/workspace';
import { ago, ChannelChip } from '../../components/bits';
import { Empty, Field, Loading, Notice, PushLink, Segmented, Sheet, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatINR, parseINR } from '../../lib/money';
import { leadsQuery } from '../../lib/sections';
import { rpc } from '../../lib/supabase';
import { STAGE_LABEL, type Lead, type LeadStage } from '../../lib/types';

type View = 'open' | 'won' | 'lost';
const OPEN: LeadStage[] = ['new', 'qualified', 'proposal'];

export function LeadsPage() {
  const { ws, can } = useWorkspace();
  const [view, setView] = useState<View>('open');
  const [editing, setEditing] = useState<Lead | null>(null);
  const q = useQuery(leadsQuery(ws.id));
  const all = q.data ?? [];
  const open = all.filter((l) => OPEN.includes(l.stage));
  const rows = view === 'open' ? [...open].sort((a, b) => b.score - a.score) : all.filter((l) => l.stage === view);
  const won = all.filter((l) => l.stage === 'won');
  const closed = won.length + all.filter((l) => l.stage === 'lost').length;
  const pipeline = open.reduce((s, l) => s + (l.value_paise ?? 0), 0);

  return (
    <div className="stack lg">
      <div className="page-head"><h1>Leads</h1></div>
      <div className="tiles">
        <div className="tile"><span className="label">Open</span><span className="value num">{open.length}</span><span className="sub">in the pipeline</span></div>
        <div className="tile"><span className="label">Pipeline value</span><span className="value num">{formatINR(pipeline)}</span><span className="sub">open leads</span></div>
        <div className="tile"><span className="label">Won</span><span className="value num">{won.length}</span><span className="sub">{formatINR(won.reduce((s, l) => s + (l.value_paise ?? 0), 0))}</span></div>
        <div className="tile"><span className="label">Conversion</span><span className="value num">{closed ? `${Math.round((won.length / closed) * 100)}%` : '—'}</span><span className="sub">of closed leads</span></div>
      </div>
      <Segmented label="Show" value={view} onChange={setView}
        options={[{ value: 'open', label: `Open${open.length ? ` (${open.length})` : ''}` }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }]} />
      {q.isPending ? <Loading /> : q.error ? <Notice tone="bad">{errorMessage(q.error)}</Notice> : rows.length === 0 ? (
        <div className="card"><Empty title={view === 'open' ? 'No open leads' : `No ${view} leads`}>
          {view === 'open' && 'Every new person who messages becomes a lead here automatically.'}
        </Empty></div>
      ) : (
        <ul className="list card flush">
          {rows.map((l) => (
            <li key={l.id} className="item enquiry">
              <button type="button" className="main-col plain" onClick={() => setEditing(l)}>
                <span className="title">{l.contacts.display_name}</span>
                <span className="meta">
                  <span className={`pill ${l.stage}`}>{STAGE_LABEL[l.stage]}</span>
                  {l.need && <span>{l.need}</span>}
                  {l.value_paise != null && <span className="num">{formatINR(l.value_paise)}</span>}
                  <span>{ago(l.updated_at)} ago</span>
                </span>
              </button>
              <span className="end-col">
                {l.source !== 'manual' && <ChannelChip kind={l.source} />}
                {l.conversation_id && <PushLink className="btn small ghost" to={`../inbox/${l.conversation_id}`} relative="path" aria-label={`Open chat with ${l.contacts.display_name}`}><MessageSquare size={16} /></PushLink>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing && <LeadSheet lead={editing} readOnly={!can('leads.write')} onClose={() => setEditing(null)} />}
    </div>
  );
}

function LeadSheet({ lead, readOnly, onClose }: { lead: Lead; readOnly: boolean; onClose: () => void }) {
  const { ws } = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const rupees = (p: number | null) => (p == null ? '' : String(p / 100));
  const [stage, setStage] = useState<LeadStage>(lead.stage);
  const [need, setNeed] = useState(lead.need ?? '');
  const [budget, setBudget] = useState(rupees(lead.budget_paise));
  const [value, setValue] = useState(rupees(lead.value_paise));
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [reason, setReason] = useState(lead.lost_reason ?? '');
  const money = (s: string) => (s.trim() ? parseINR(s) : null);
  const bad = (budget.trim() && money(budget) === null) || (value.trim() && money(value) === null);
  const save = useMutation({
    mutationFn: () => rpc<Lead>('save_lead', {
      p_ws: ws.id, p_lead: lead.id, p_stage: stage, p_need: need, p_budget_paise: money(budget), p_value_paise: money(value),
      p_notes: notes, p_lost_reason: reason,
    }),
    onSuccess: async () => {
      await Promise.all(['leads', 'overview'].map((k) => qc.invalidateQueries({ queryKey: [k, ws.id] })));
      toast('Lead saved'); onClose();
    },
  });
  return (
    <Sheet title={lead.contacts.display_name} onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (!bad && !readOnly) save.mutate(); }}>
        <Field label="Stage">
          <select className="input" value={stage} disabled={readOnly} onChange={(e) => setStage(e.target.value as LeadStage)}>
            {Object.entries(STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="What they want"><input className="input" value={need} disabled={readOnly} onChange={(e) => setNeed(e.target.value)} /></Field>
        <div className="grid-2">
          <Field label="Their budget (₹)"><input className="input" inputMode="decimal" value={budget} disabled={readOnly} onChange={(e) => setBudget(e.target.value)} /></Field>
          <Field label="Deal value (₹)"><input className="input" inputMode="decimal" value={value} disabled={readOnly} onChange={(e) => setValue(e.target.value)} /></Field>
        </div>
        {stage === 'lost' && <Field label="Why was it lost"><input className="input" value={reason} disabled={readOnly} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Price, went elsewhere" /></Field>}
        <Field label="Notes"><textarea className="input" rows={2} value={notes} disabled={readOnly} onChange={(e) => setNotes(e.target.value)} /></Field>
        {bad && <Notice tone="bad">Enter amounts as numbers, like 2500.</Notice>}
        {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
        {!readOnly && <button className="btn primary block xl" disabled={save.isPending || !!bad}>{save.isPending ? <span className="spinner" /> : 'Save lead'}</button>}
      </form>
    </Sheet>
  );
}
