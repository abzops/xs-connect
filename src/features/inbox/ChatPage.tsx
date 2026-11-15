import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Clock, Mic, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useWorkspace } from '../../app/workspace';
import { ChannelChip, replyWindow } from '../../components/bits';
import { BackLink, Empty, Field, Loading, Notice, Sheet, useToast } from '../../components/ui';
import { formatTime } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { conversationsQuery, messagesQuery } from '../../lib/sections';
import { rpc, supabase } from '../../lib/supabase';
import { CHANNEL_LABEL, type Conversation, type Message } from '../../lib/types';

const BY: Record<Message['sender'], string> = { contact: '', ai: 'AI', staff: 'Team', system: '' };
const STATUS: Partial<Record<Message['status'], string>> = { queued: 'sending', delivered: 'delivered', read: 'read', failed: 'not delivered' };

/** Asks an edge function to act; a missing or failing function is reported, never silent. */
async function invoke(name: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error('XS503: could not reach the messaging service. Try again.');
  if (data && typeof data === 'object' && 'error' in data && data.error) throw new Error(`XS500: ${String(data.error)}`);
  return data as Record<string, unknown> | null;
}

export function ChatPage() {
  const { ws, can } = useWorkspace();
  const { conversationId } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery(conversationsQuery(ws.id));
  const conv = list.data?.find((c) => c.id === conversationId);
  const msgs = useQuery({ ...messagesQuery(ws.id, conversationId!), enabled: !!conversationId });
  const [text, setText] = useState('');
  const [asCustomer, setAsCustomer] = useState(false);
  const [draftText, setDraftText] = useState<string | null>(null);
  const [followup, setFollowup] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const canReply = can('inbox.reply');

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['messages', ws.id, conversationId] }),
    qc.invalidateQueries({ queryKey: ['conversations', ws.id] }),
    qc.invalidateQueries({ queryKey: ['overview', ws.id] }),
  ]);

  // Live updates for this chat.
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase.channel(`chat-${conversationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Opening a chat marks it read.
  useEffect(() => {
    if (conv && conv.unread > 0 && canReply) {
      void rpc('update_conversation', { p_ws: ws.id, p_conversation: conv.id, p_read: true }).then(refresh).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv?.id, conv?.unread]);

  const count = msgs.data?.length ?? 0;
  useEffect(() => { body.current?.scrollTo({ top: body.current.scrollHeight }); }, [count]);

  const send = useMutation({
    mutationFn: async ({ text: t, draft }: { text: string; draft?: string }) => {
      const m = await rpc<Message>('staff_send_message', { p_ws: ws.id, p_conversation: conversationId, p_body: t, p_draft: draft ?? null });
      if (m.status === 'queued') await invoke('send-message', { message_id: m.id });
      return m;
    },
    onSuccess: async () => { setText(''); setDraftText(null); await refresh(); },
    onError: async (e) => { toast(errorMessage(e), 'bad'); await refresh(); },
  });
  const customer = useMutation({
    mutationFn: async (t: string) => {
      await rpc('demo_inbound', { p_ws: ws.id, p_conversation: conversationId, p_body: t });
      await refresh();
      await invoke('ai-agent', { conversation_id: conversationId });
    },
    onSuccess: async () => { setText(''); await refresh(); },
    onError: async (e) => { setText(''); toast(errorMessage(e), 'bad'); await refresh(); },
  });
  const setAi = useMutation({
    mutationFn: (on: boolean) => rpc<Conversation>('update_conversation', { p_ws: ws.id, p_conversation: conversationId, p_ai_enabled: on }),
    onSuccess: async (_c, on) => { await refresh(); toast(on ? 'AI is handling this chat' : 'You are handling this chat'); },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const discard = useMutation({
    mutationFn: (id: string) => rpc('discard_draft', { p_ws: ws.id, p_message: id }),
    onSuccess: refresh,
  });

  if (list.isPending || msgs.isPending) return <Loading rows={6} />;
  if (list.error || msgs.error) return <Notice tone="bad">{errorMessage(list.error ?? msgs.error)}</Notice>;
  if (!conv) return <Empty title="Conversation not found"><BackLink className="btn" to="..">Back to inbox</BackLink></Empty>;

  const demo = conv.channels.mode === 'demo';
  const win = replyWindow(conv.channels.kind, conv.last_inbound_at);
  const open = demo || win.open;
  const busy = send.isPending || customer.isPending;
  const draft = msgs.data.find((m) => m.status === 'draft');
  const shown = msgs.data.filter((m) => m.status !== 'draft');
  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    if (asCustomer) customer.mutate(t); else send.mutate({ text: t });
  };

  return (
    <div className="chat">
      <header className="chat-head">
        <BackLink className="btn ghost icon-btn" to=".." relative="path" aria-label="Back to inbox"><ChevronLeft size={22} /></BackLink>
        <div className="who">
          <strong>{conv.contacts.display_name}</strong>
          <span><ChannelChip kind={conv.channels.kind} demo={demo} />{conv.contacts.phone}</span>
        </div>
        {canReply && (
          <button className="switch" aria-pressed={conv.ai_enabled} disabled={setAi.isPending} onClick={() => setAi.mutate(!conv.ai_enabled)}>
            AI <i aria-hidden />
          </button>
        )}
        {canReply && <button className="btn ghost icon-btn" onClick={() => setFollowup(true)} aria-label="Add follow-up"><Clock size={20} /></button>}
      </header>

      <div className="chat-body" ref={body}>
        {conv.handoff_reason && <Notice tone="warn">The AI handed this chat to you: {conv.handoff_reason}</Notice>}
        {shown.map((m) => (
          <div key={m.id} className={`bubble ${m.sender === 'system' ? 'system' : m.direction} ${m.status === 'failed' ? 'failed' : ''}`}>
            {m.kind === 'audio' && m.direction === 'in' ? (
              <>
                <span className="voice-tag"><Mic size={14} aria-hidden /> Voice note{m.transcribed_by ? ', written out' : ''}</span>
                {m.body || <em>Could not be written out. Listen to it in {CHANNEL_LABEL[conv.channels.kind]}.</em>}
              </>
            ) : (m.body || `[${m.kind}]`)}
            {m.sender !== 'system' && (
              <span className="by">{[BY[m.sender], formatTime(m.created_at, ws.timezone), m.direction === 'out' ? STATUS[m.status] : ''].filter(Boolean).join(' · ')}
                {m.status === 'failed' && m.error ? ` · ${m.error}` : ''}</span>
            )}
          </div>
        ))}
        {customer.isPending && <div className="bubble system">AI is writing…</div>}
        {draft && canReply && (
          <div className="draft">
            <span className="label">AI draft. Nothing is sent until you approve.</span>
            <textarea className="input" rows={3} value={draftText ?? draft.body} onChange={(e) => setDraftText(e.target.value)} />
            <div className="row end">
              <button className="btn small ghost" disabled={discard.isPending || busy} onClick={() => discard.mutate(draft.id)}>Discard</button>
              <button className="btn small primary" disabled={busy || !open || !(draftText ?? draft.body).trim()}
                onClick={() => send.mutate({ text: draftText ?? draft.body, draft: draft.id })}>
                {send.isPending ? <span className="spinner" /> : 'Approve and send'}
              </button>
            </div>
          </div>
        )}
      </div>

      {canReply && (
        <footer className="chat-foot">
          {!open && (
            <Notice tone="warn">
              The reply window has closed. {conv.channels.kind === 'whatsapp'
                ? 'On WhatsApp you can only send an approved template until the customer writes again.'
                : 'You can reply again when the customer writes.'}
            </Notice>
          )}
          {open && !demo && !win.aiOpen && <Notice tone="info">More than 24 hours since their last message: only a person may reply now, for {win.hoursLeft} more hours.</Notice>}
          {demo && (
            <button className="switch" aria-pressed={asCustomer} onClick={() => setAsCustomer((v) => !v)}>
              <i aria-hidden /> Type as the customer, to test the AI
            </button>
          )}
          <div className="composer">
            <textarea className="input" rows={1} value={text} disabled={!open} placeholder={asCustomer ? 'Customer says…' : 'Reply…'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); submit(); } }} />
            <button className="btn primary icon-btn" disabled={!open || busy || !text.trim()} onClick={submit} aria-label="Send">
              {busy ? <span className="spinner" /> : <Send size={18} />}
            </button>
          </div>
        </footer>
      )}
      {followup && <FollowupSheet conversationId={conv.id} onClose={() => setFollowup(false)} />}
    </div>
  );
}

function FollowupSheet({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const { ws } = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const [when, setWhen] = useState(`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T10:00`);
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () => rpc('save_followup', { p_ws: ws.id, p_followup: null, p_conversation: conversationId, p_due_at: new Date(when).toISOString(), p_note: note }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['followups', ws.id] }); toast('Follow-up saved'); onClose(); },
  });
  return (
    <Sheet title="Follow up" onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (note.trim()) save.mutate(); }}>
        <Field label="When"><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <Field label="What to do"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Ask if they decided" /></Field>
        {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
        <button className="btn primary block xl" disabled={save.isPending || !note.trim() || !when}>{save.isPending ? <span className="spinner" /> : 'Save follow-up'}</button>
      </form>
    </Sheet>
  );
}
