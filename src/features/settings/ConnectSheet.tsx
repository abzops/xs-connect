import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Phone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWorkspace } from '../../app/workspace';
import { Field, Notice, Sheet, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rpc, supabase } from '../../lib/supabase';
import { CHANNEL_LABEL, type Channel, type ChannelKind } from '../../lib/types';
import { loadFacebook, runSignup } from './facebook';

type MetaConfig = { ready: boolean; appId: string | null; configId: string | null; graphVersion: string };
type SetupRequest = { id: string; kind: ChannelKind; phone: string; status: 'open' | 'done' };

const ID_LABEL: Record<ChannelKind, string> = {
  whatsapp: 'Phone number ID', instagram: 'Instagram account ID', messenger: 'Facebook Page ID',
};
const TILE: Record<ChannelKind, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Facebook Messenger' };

export function ConnectSheet({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<ChannelKind | null>(null);
  return (
    <Sheet title={kind ? `Connect ${CHANNEL_LABEL[kind]}` : 'Connect a channel'} onClose={onClose}>
      {kind === null ? (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>Where do your customers message you?</p>
          {(Object.keys(TILE) as ChannelKind[]).map((k) => (
            <button key={k} type="button" className={`connect-tile ${k}`} onClick={() => setKind(k)}>{TILE[k]}</button>
          ))}
        </div>
      ) : (
        <div className="stack lg">
          <button type="button" className="btn ghost small back-link" onClick={() => setKind(null)}><ChevronLeft size={16} /> All channels</button>
          {kind === 'whatsapp' ? <WhatsAppConnect onDone={onClose} /> : <HelpRequest kind={kind} primary />}
          <Advanced kind={kind} onDone={onClose} />
        </div>
      )}
    </Sheet>
  );
}

function WhatsAppConnect({ onDone }: { onDone: () => void }) {
  const { ws } = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const [keepPhoneApp, setKeepPhoneApp] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const config = useQuery({
    queryKey: ['meta-config'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('connect-whatsapp', { body: { action: 'config' } });
      if (error) throw error;
      return data as MetaConfig;
    },
    staleTime: 10 * 60_000, retry: 1,
  });
  const ready = !!(config.data?.ready && config.data.appId && config.data.configId);
  // Load Facebook while the person reads, so the click opens the popup straight away.
  const [fbReady, setFbReady] = useState(false);
  useEffect(() => {
    if (!ready) return;
    loadFacebook(config.data!.appId!, config.data!.graphVersion).then(() => setFbReady(true), (e: Error) => setProblem(e.message));
  }, [ready, config.data]);

  const connect = useMutation({
    mutationFn: async () => {
      setProblem(null);
      const fb = await loadFacebook(config.data!.appId!, config.data!.graphVersion);
      const outcome = await runSignup(fb, config.data!.configId!, keepPhoneApp);
      if (outcome.kind === 'cancelled') return null;
      if (outcome.kind === 'error') throw new Error(outcome.message);
      const { data, error } = await supabase.functions.invoke('connect-whatsapp', { body: {
        action: 'complete', workspace_id: ws.id, code: outcome.code, waba_id: outcome.wabaId,
        phone_number_id: outcome.phoneNumberId, coexistence: keepPhoneApp,
      } });
      if (error) throw new Error('Could not reach XS Connect. Check the internet connection and try again.');
      if (data?.error) throw new Error(String(data.error));
      return data as { display_name: string; phone: string | null };
    },
    onSuccess: async (r) => {
      if (!r) { setProblem('The window was closed before finishing. Tap the button to start again.'); return; }
      await qc.invalidateQueries({ queryKey: ['channels', ws.id] });
      toast(`WhatsApp connected: ${r.display_name}`);
      onDone();
    },
    onError: (e) => setProblem(e instanceof Error ? e.message : 'Something went wrong. Please try again.'),
  });

  if (config.isPending) return <div className="spinner" aria-label="Loading" />;
  if (!ready) return <HelpRequest kind="whatsapp" primary />;

  return (
    <div className="stack lg">
      <ol className="connect-steps">
        <li>Log in with Facebook.</li>
        <li>Choose your business and your WhatsApp number.</li>
        <li>{keepPhoneApp ? 'Open WhatsApp Business on your phone and scan the QR code shown.' : 'Type the code WhatsApp sends to the new number.'}</li>
      </ol>
      <p className="muted" style={{ margin: 0 }}>
        {keepPhoneApp ? 'Your number and chats stay on your phone. You can keep replying from the app too.' : 'Use a number that is not on WhatsApp on any phone.'}
      </p>
      {problem && <Notice tone="bad">{problem}</Notice>}
      <button type="button" className="btn primary block xl wa-btn" disabled={connect.isPending || !fbReady} onClick={() => connect.mutate()}>
        {connect.isPending ? <span className="spinner" /> : 'Connect WhatsApp'}
      </button>
      <button type="button" className="btn ghost small" onClick={() => setKeepPhoneApp((v) => !v)}>
        {keepPhoneApp ? 'My number is not on WhatsApp yet' : 'I already use WhatsApp Business on my phone'}
      </button>
      <HelpRequest kind="whatsapp" />
    </div>
  );
}

/** The person asks Xelorsoft to call and connect the channel with them. */
function HelpRequest({ kind, primary = false }: { kind: ChannelKind; primary?: boolean }) {
  const { ws } = useWorkspace();
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const open = useQuery({
    queryKey: ['setup-requests', ws.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('setup_requests').select('id,kind,phone,status').eq('workspace_id', ws.id).eq('status', 'open');
      if (error) throw error;
      return data as SetupRequest[];
    },
  });
  const mine = open.data?.find((r) => r.kind === kind);
  const ask = useMutation({
    mutationFn: () => rpc<SetupRequest>('request_channel_setup', { p_ws: ws.id, p_kind: kind, p_phone: phone }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['setup-requests', ws.id] }),
  });
  const valid = phone.replace(/\D/g, '').length >= 10;

  if (mine) {
    return <Notice tone="ok">We have your request. Someone from Xelorsoft will call {mine.phone} and connect {CHANNEL_LABEL[kind]} with you.</Notice>;
  }
  return (
    <section className={primary ? 'stack' : 'stack help-box'}>
      {primary ? (
        <>
          <p style={{ margin: 0 }}>We will connect {CHANNEL_LABEL[kind]} for you. Leave your number and someone from Xelorsoft will call you. It takes about 10 minutes, and you only need your phone.</p>
        </>
      ) : <p className="muted" style={{ margin: 0 }}>Prefer help? We can call you and do it together.</p>}
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (valid) ask.mutate(); }}>
        <Field label="Your phone number"><input className="input" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98470 12345" /></Field>
        {ask.error && <Notice tone="bad">{errorMessage(ask.error)}</Notice>}
        <button className={primary ? 'btn primary block xl' : 'btn block'} disabled={!valid || ask.isPending}>
          {ask.isPending ? <span className="spinner" /> : <><Phone size={18} /> Call me to connect</>}
        </button>
      </form>
    </section>
  );
}

/** The old way: paste an ID and a token from Meta's developer dashboard. */
function Advanced({ kind, onDone }: { kind: ChannelKind; onDone: () => void }) {
  const { ws } = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const [externalId, setExternalId] = useState('');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const valid = externalId.trim().length > 0 && token.trim().length >= 20;
  const save = useMutation({
    mutationFn: () => rpc<Channel>('save_channel', { p_ws: ws.id, p_kind: kind, p_external_id: externalId, p_display_name: name, p_access_token: token.trim() }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['channels', ws.id] }); toast(`${CHANNEL_LABEL[kind]} connected`); onDone(); },
  });
  return (
    <details className="advanced">
      <summary>For developers: connect with an ID and token</summary>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
        <Field label={ID_LABEL[kind]} hint="From your Meta app dashboard."><input className="input" value={externalId} onChange={(e) => setExternalId(e.target.value)} autoComplete="off" /></Field>
        <Field label="Name shown in the inbox"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${ws.name} ${CHANNEL_LABEL[kind]}`} /></Field>
        <Field label="Access token" hint="Stored where only the server can read it."><input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></Field>
        {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
        <button className="btn block" disabled={!valid || save.isPending}>{save.isPending ? <span className="spinner" /> : 'Connect'}</button>
      </form>
    </details>
  );
}
