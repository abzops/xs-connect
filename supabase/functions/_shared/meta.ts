// Meta platform glue shared by the edge functions. Pure functions only (no
// Deno or Node APIs beyond Web Crypto and fetch), so the unit tests can load it.

export type ChannelKind = 'whatsapp' | 'instagram' | 'messenger';

export type InboundMessage = {
  type: 'message';
  kind: ChannelKind;
  channelExternal: string;
  contactExternal: string;
  contactName: string | null;
  phone: string | null;
  messageExternal: string;
  msgKind: 'text' | 'image' | 'audio' | 'video' | 'document' | 'other';
  body: string;
  sentAt: string;
};
export type StatusUpdate = { type: 'status'; external: string; status: 'sent' | 'delivered' | 'read' | 'failed'; error: string | null };
export type WebhookEvent = InboundMessage | StatusUpdate;

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Checks Meta's X-Hub-Signature-256 header against the raw request body. */
export async function verifySignature(appSecret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const given = header.slice(7).toLowerCase();
  if (given.length !== expected.length) return false;
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const iso = (seconds: unknown, ms = false): string => {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(ms ? n : n * 1000).toISOString() : new Date().toISOString();
};

const MEDIA = new Set(['image', 'audio', 'video', 'document']);

function whatsapp(entry: Json, out: WebhookEvent[]) {
  for (const change of arr(entry.changes)) {
    const value = (change.value ?? {}) as Json;
    const phoneNumberId = str((value.metadata as Json | undefined)?.phone_number_id);
    if (!phoneNumberId) continue;
    const names = new Map(arr(value.contacts).map((c) => [str(c.wa_id), str((c.profile as Json | undefined)?.name)]));
    for (const m of arr(value.messages)) {
      const from = str(m.from);
      const id = str(m.id);
      if (!from || !id) continue;
      const t = str(m.type);
      const media = (m[t] ?? {}) as Json;
      const body = t === 'text' ? str((m.text as Json | undefined)?.body)
        : t === 'button' ? str((m.button as Json | undefined)?.text)
        : t === 'interactive' ? str(((m.interactive as Json | undefined)?.button_reply as Json | undefined)?.title
            ?? ((m.interactive as Json | undefined)?.list_reply as Json | undefined)?.title)
        : str(media.caption);
      out.push({
        type: 'message', kind: 'whatsapp', channelExternal: phoneNumberId, contactExternal: from,
        contactName: names.get(from) || null, phone: `+${from.replace(/\D/g, '')}`, messageExternal: id,
        msgKind: t === 'text' || t === 'button' || t === 'interactive' ? 'text' : MEDIA.has(t) ? (t as InboundMessage['msgKind']) : 'other',
        body, sentAt: iso(m.timestamp),
      });
    }
    for (const s of arr(value.statuses)) {
      const status = str(s.status);
      if (!['sent', 'delivered', 'read', 'failed'].includes(status)) continue;
      const err = arr(s.errors)[0];
      out.push({ type: 'status', external: str(s.id), status: status as StatusUpdate['status'], error: err ? str(err.title ?? err.message) : null });
    }
  }
}

function pageOrInstagram(kind: 'messenger' | 'instagram', entry: Json, out: WebhookEvent[]) {
  const account = str(entry.id);
  for (const ev of arr(entry.messaging)) {
    const message = ev.message as Json | undefined;
    const sender = str((ev.sender as Json | undefined)?.id);
    // Echoes are our own outgoing messages coming back; never treat them as inbound.
    if (!message || message.is_echo || !sender || sender === account) continue;
    const mid = str(message.mid);
    if (!mid) continue;
    const attachment = arr(message.attachments)[0];
    const at = attachment ? str(attachment.type) : '';
    out.push({
      type: 'message', kind, channelExternal: account, contactExternal: sender, contactName: null, phone: null,
      messageExternal: mid, msgKind: str(message.text) ? 'text' : MEDIA.has(at) ? (at as InboundMessage['msgKind']) : at === 'file' ? 'document' : 'other',
      body: str(message.text), sentAt: iso(ev.timestamp, true),
    });
  }
}

/** Turns one Meta webhook payload (any of the three products) into events. */
export function parseWebhook(payload: unknown): WebhookEvent[] {
  const out: WebhookEvent[] = [];
  const p = (payload ?? {}) as Json;
  const object = str(p.object);
  for (const entry of arr(p.entry)) {
    if (object === 'whatsapp_business_account') whatsapp(entry, out);
    else if (object === 'page') pageOrInstagram('messenger', entry, out);
    else if (object === 'instagram') pageOrInstagram('instagram', entry, out);
  }
  return out;
}

export type SendTarget = {
  kind: ChannelKind; channel_external: string; token: string; recipient: string; body: string; human_agent_tag: boolean;
};

/** The HTTP request that delivers one text message on the right Meta API. */
export function buildSendRequest(t: SendTarget, graphVersion: string): { url: string; init: RequestInit } {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` };
  if (t.kind === 'whatsapp') {
    return {
      url: `https://graph.facebook.com/${graphVersion}/${t.channel_external}/messages`,
      init: { method: 'POST', headers, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: t.recipient, type: 'text', text: { body: t.body } }) },
    };
  }
  const host = t.kind === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
  const payload: Json = { recipient: { id: t.recipient }, message: { text: t.body } };
  if (t.human_agent_tag) { payload.messaging_type = 'MESSAGE_TAG'; payload.tag = 'HUMAN_AGENT'; }
  else if (t.kind === 'messenger') payload.messaging_type = 'RESPONSE';
  return { url: `https://${host}/${graphVersion}/${t.channel_external}/messages`, init: { method: 'POST', headers, body: JSON.stringify(payload) } };
}

/** Sends and returns Meta's message id, or an error sentence. Never throws. */
export async function sendToMeta(t: SendTarget, graphVersion: string): Promise<{ ok: boolean; externalId: string | null; error: string | null }> {
  try {
    const { url, init } = buildSendRequest(t, graphVersion);
    const res = await fetch(url, init);
    const data = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) {
      const e = (data.error ?? {}) as Json;
      return { ok: false, externalId: null, error: str(e.message) || `Meta returned ${res.status}` };
    }
    const id = t.kind === 'whatsapp' ? str(arr(data.messages)[0]?.id) : str(data.message_id);
    return { ok: true, externalId: id || null, error: null };
  } catch (e) {
    return { ok: false, externalId: null, error: e instanceof Error ? e.message : 'network error' };
  }
}
