import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWorkspace } from '../../app/workspace';
import { Empty, Field, Loading, Notice, Segmented, Sheet, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatINR, parseINR } from '../../lib/money';
import { catalogQuery, knowledgeQuery, profileQuery } from '../../lib/sections';
import { rpc } from '../../lib/supabase';
import type { BrandProfile, CatalogItem, KnowledgeItem } from '../../lib/types';

type Tab = 'profile' | 'catalog' | 'answers';

export function BrainPage() {
  const [tab, setTab] = useState<Tab>('profile');
  return (
    <div className="stack lg">
      <div className="page-head"><h1>Brand Brain</h1></div>
      <p className="muted" style={{ margin: 0 }}>What the AI knows about your business. It answers customers only from what is written here.</p>
      <Segmented label="Section" value={tab} onChange={setTab}
        options={[{ value: 'profile', label: 'Business' }, { value: 'catalog', label: 'Prices' }, { value: 'answers', label: 'Answers' }]} />
      {tab === 'profile' ? <ProfileForm /> : tab === 'catalog' ? <Catalog /> : <Answers />}
    </div>
  );
}

const FIELDS: { key: keyof BrandProfile & string; label: string; hint: string; rows: number }[] = [
  { key: 'about', label: 'About the business', hint: 'What you do, who it is for, what makes you different.', rows: 4 },
  { key: 'services', label: 'Services and solutions', hint: 'What a customer can buy or book. Prices go under Prices.', rows: 4 },
  { key: 'offers', label: 'Current offers', hint: 'Leave empty if there are none. The AI never invents discounts.', rows: 2 },
  { key: 'hours', label: 'Working hours', hint: 'e.g. Mon to Sat, 9 am to 8 pm', rows: 1 },
  { key: 'location', label: 'Location and delivery area', hint: '', rows: 2 },
  { key: 'policies', label: 'Policies', hint: 'Refunds, delivery time, payment methods, warranty.', rows: 3 },
  { key: 'tone', label: 'How the AI should talk', hint: 'e.g. Warm and brief. Malayalam if the customer writes in Malayalam.', rows: 2 },
  { key: 'never_say', label: 'Never say or promise', hint: 'e.g. Never promise same-day delivery.', rows: 2 },
];

function ProfileForm() {
  const { ws, can } = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery(profileQuery(ws.id));
  const [form, setForm] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState('');
  const [autopilot, setAutopilot] = useState(true);
  useEffect(() => {
    if (!q.data) return;
    setForm(Object.fromEntries(FIELDS.map((f) => [f.key, String(q.data[f.key] ?? '')])));
    setLimit(q.data.handoff_above_paise == null ? '' : String(q.data.handoff_above_paise / 100));
    setAutopilot(q.data.autopilot);
  }, [q.data]);
  const limitPaise = limit.trim() ? parseINR(limit) : null;
  const badLimit = !!limit.trim() && limitPaise === null;
  const editable = can('brain.manage');
  const save = useMutation({
    mutationFn: () => rpc<BrandProfile>('save_brand_profile', {
      p_ws: ws.id, p_profile: { ...form, autopilot, handoff_above_paise: limitPaise == null ? '' : String(limitPaise) },
    }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['brain', ws.id] }); toast('Brand Brain saved'); },
  });
  if (q.isPending) return <Loading rows={5} />;
  if (q.error) return <Notice tone="bad">{errorMessage(q.error)}</Notice>;
  return (
    <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (!badLimit && editable) save.mutate(); }}>
      <section className="card stack">
        <button type="button" className="switch" aria-pressed={autopilot} disabled={!editable} onClick={() => setAutopilot((v) => !v)}>
          <i aria-hidden /> The AI sends replies on its own
        </button>
        <p className="muted" style={{ margin: 0 }}>
          {autopilot ? 'On: the AI replies to customers straight away and hands over to your team when it is unsure.'
            : 'Off: the AI writes a draft for every message and nothing is sent until a person approves it.'}
        </p>
        <Field label="Hand over to a person above (₹)" hint="Orders larger than this always go to your team. Leave empty for no limit." error={badLimit ? 'Enter a number, like 10000.' : null}>
          <input className="input" inputMode="decimal" value={limit} disabled={!editable} onChange={(e) => setLimit(e.target.value)} />
        </Field>
      </section>
      <section className="card stack lg">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint || undefined}>
            <textarea className="input" rows={f.rows} value={form[f.key] ?? ''} disabled={!editable}
              onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />
          </Field>
        ))}
      </section>
      {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
      {editable && <button className="btn primary block xl" disabled={save.isPending || badLimit}>{save.isPending ? <span className="spinner" /> : 'Save'}</button>}
    </form>
  );
}

function Catalog() {
  const { ws, can } = useWorkspace();
  const q = useQuery(catalogQuery(ws.id));
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null);
  const editable = can('brain.manage');
  return (
    <div className="stack">
      {editable && <div className="row end"><button className="btn primary" onClick={() => setEditing('new')}><Plus size={18} /> Add item</button></div>}
      {q.isPending ? <Loading /> : q.error ? <Notice tone="bad">{errorMessage(q.error)}</Notice> : q.data.length === 0 ? (
        <div className="card"><Empty title="No prices yet">The AI quotes only the prices listed here. Add your products or services.</Empty></div>
      ) : (
        <ul className="list card flush">
          {q.data.map((c) => (
            <li key={c.id}>
              <button className="item" disabled={!editable} onClick={() => setEditing(c)}>
                <span className="main-col">
                  <span className="title">{c.name}</span>
                  <span className="meta"><span>{c.kind === 'service' ? 'Service' : 'Product'}</span>{c.description && <span>{c.description}</span>}{!c.in_stock && <span className="late">Not available</span>}</span>
                </span>
                <span className="end-col"><strong className="num">{formatINR(c.price_paise)}</strong>{c.unit && <span className="when">per {c.unit}</span>}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <CatalogSheet item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CatalogSheet({ item, onClose }: { item: CatalogItem | null; onClose: () => void }) {
  const { ws } = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<CatalogItem['kind']>(item?.kind ?? 'product');
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [price, setPrice] = useState(item ? String(item.price_paise / 100) : '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [inStock, setInStock] = useState(item?.in_stock ?? true);
  const paise = parseINR(price);
  const valid = name.trim().length > 0 && paise !== null;
  const save = useMutation({
    mutationFn: (status: CatalogItem['status']) => rpc<CatalogItem>('save_catalog_item', {
      p_ws: ws.id, p_item: item?.id ?? null, p_kind: kind, p_name: name, p_description: description, p_price_paise: paise ?? item?.price_paise ?? 0,
      p_unit: unit, p_in_stock: inStock, p_status: status,
    }),
    onSuccess: async (_c, status) => { await qc.invalidateQueries({ queryKey: ['brain', ws.id] }); toast(status === 'archived' ? 'Item removed' : 'Item saved'); onClose(); },
  });
  return (
    <Sheet title={item ? item.name : 'New item'} onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate('active'); }}>
        <Segmented label="Type" value={kind} onChange={setKind} options={[{ value: 'product', label: 'Product' }, { value: 'service', label: 'Service' }]} />
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid-2">
          <Field label="Price (₹)"><input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label="Per" hint="e.g. month, kg, session"><input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
        </div>
        <Field label="Details"><textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <button type="button" className="switch" aria-pressed={inStock} onClick={() => setInStock((v) => !v)}><i aria-hidden /> Available now</button>
        {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
        <button className="btn primary block xl" disabled={!valid || save.isPending}>{save.isPending ? <span className="spinner" /> : 'Save item'}</button>
        {item && <button type="button" className="btn block ghost danger" disabled={save.isPending} onClick={() => save.mutate('archived')}>Remove item</button>}
      </form>
    </Sheet>
  );
}

function Answers() {
  const { ws, can } = useWorkspace();
  const q = useQuery(knowledgeQuery(ws.id));
  const [editing, setEditing] = useState<KnowledgeItem | 'new' | null>(null);
  const editable = can('brain.manage');
  return (
    <div className="stack">
      {editable && <div className="row end"><button className="btn primary" onClick={() => setEditing('new')}><Plus size={18} /> Add answer</button></div>}
      {q.isPending ? <Loading /> : q.error ? <Notice tone="bad">{errorMessage(q.error)}</Notice> : q.data.length === 0 ? (
        <div className="card"><Empty title="No answers yet">Write the questions customers ask most, with your answer. The AI uses them word for word.</Empty></div>
      ) : (
        <ul className="list card flush">
          {q.data.map((k) => (
            <li key={k.id}>
              <button className="item" disabled={!editable} onClick={() => setEditing(k)}>
                <span className="main-col"><span className="title">{k.title}</span><span className="preview">{k.body}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <AnswerSheet item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AnswerSheet({ item, onClose }: { item: KnowledgeItem | null; onClose: () => void }) {
  const { ws } = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const valid = title.trim().length > 0 && body.trim().length > 0;
  const save = useMutation({
    mutationFn: (status: KnowledgeItem['status']) => rpc('save_knowledge_item', { p_ws: ws.id, p_item: item?.id ?? null, p_title: title, p_body: body, p_status: status }),
    onSuccess: async (_k, status) => { await qc.invalidateQueries({ queryKey: ['brain', ws.id] }); toast(status === 'archived' ? 'Answer removed' : 'Answer saved'); onClose(); },
  });
  return (
    <Sheet title={item ? 'Edit answer' : 'New answer'} onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate('active'); }}>
        <Field label="Question"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Do you deliver to Kochi?" /></Field>
        <Field label="Answer"><textarea className="input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
        <button className="btn primary block xl" disabled={!valid || save.isPending}>{save.isPending ? <span className="spinner" /> : 'Save answer'}</button>
        {item && <button type="button" className="btn block ghost danger" disabled={save.isPending} onClick={() => save.mutate('archived')}>Remove answer</button>}
      </form>
    </Sheet>
  );
}
