import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useWorkspace } from '../../app/workspace';
import { ago, ChannelChip } from '../../components/bits';
import { Empty, initials, Loading, Notice, PushLink, Segmented } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { conversationsQuery } from '../../lib/sections';
import { supabase } from '../../lib/supabase';
import type { Conversation } from '../../lib/types';

type View = 'all' | 'you' | 'ai';

export const needsPerson = (c: Conversation) => c.status === 'open' && (!!c.handoff_reason || !c.ai_enabled);

/** Keeps the inbox live: any new or changed conversation refreshes the lists. */
export function useInboxRealtime(wsId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase.channel(`inbox-${wsId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `workspace_id=eq.${wsId}` }, () => {
        void qc.invalidateQueries({ queryKey: ['conversations', wsId] });
        void qc.invalidateQueries({ queryKey: ['overview', wsId] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [wsId, qc]);
}

export function InboxPage() {
  const { ws } = useWorkspace();
  const [view, setView] = useState<View>('all');
  const q = useQuery(conversationsQuery(ws.id));
  useInboxRealtime(ws.id);
  const all = q.data ?? [];
  const you = all.filter(needsPerson);
  const rows = view === 'you' ? you : view === 'ai' ? all.filter((c) => !needsPerson(c)) : all;

  return (
    <div className="stack lg">
      <div className="page-head"><h1>Inbox</h1></div>
      <Segmented label="Show" value={view} onChange={setView}
        options={[{ value: 'all', label: 'All' }, { value: 'you', label: `Needs you${you.length ? ` (${you.length})` : ''}` }, { value: 'ai', label: 'AI handling' }]} />
      {q.isPending ? <Loading /> : q.error ? <Notice tone="bad">{errorMessage(q.error)}</Notice> : rows.length === 0 ? (
        <div className="card"><Empty title={view === 'you' ? 'Nothing needs you' : 'No conversations yet'}>
          {view !== 'you' && 'Messages from WhatsApp, Instagram and Facebook appear here once a channel is connected.'}
        </Empty></div>
      ) : (
        <ul className="list card flush">
          {rows.map((c) => (
            <li key={c.id}>
              <PushLink className={`item row-link ${c.unread > 0 ? 'unread' : ''}`} to={c.id}>
                <span className="avatar" aria-hidden>{initials(c.contacts.display_name)}</span>
                <span className="main-col">
                  <span className="title">{c.contacts.display_name}</span>
                  <span className="preview">{c.handoff_reason ? `Handed to you: ${c.handoff_reason}` : c.last_preview}</span>
                </span>
                <span className="end-col">
                  <span className="when">{ago(c.last_message_at)}</span>
                  <span className="row" style={{ gap: 4 }}>
                    <span className={`pill ${needsPerson(c) ? 'you' : 'ai'}`}>{needsPerson(c) ? 'You' : 'AI'}</span>
                    <ChannelChip kind={c.channels.kind} />
                  </span>
                </span>
              </PushLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
