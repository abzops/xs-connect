// Webhook gateway for WhatsApp, Instagram and Messenger.
// GET: Meta's one-time verification. POST: signed events. Fails closed: with no
// app secret configured, or a bad signature, nothing is accepted.
import { parseWebhook, verifySignature } from '../_shared/meta.ts';
import { runAgent, serviceClient } from '../_shared/run.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const token = Deno.env.get('META_VERIFY_TOKEN');
    if (token && url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === token) {
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const raw = await req.text();
  const secret = Deno.env.get('META_APP_SECRET') ?? '';
  if (!(await verifySignature(secret, raw, req.headers.get('x-hub-signature-256')))) {
    return new Response('Invalid signature', { status: 401 });
  }

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new Response('Bad request', { status: 400 }); }

  const db = serviceClient();
  const work: Promise<unknown>[] = [];
  for (const ev of parseWebhook(payload)) {
    if (ev.type === 'status') {
      work.push(Promise.resolve(db.rpc('service_message_status', { p_external_id: ev.external, p_status: ev.status, p_error: ev.error })));
      continue;
    }
    const { data, error } = await db.rpc('service_ingest', {
      p_kind: ev.kind, p_channel_external: ev.channelExternal, p_contact_external: ev.contactExternal,
      p_contact_name: ev.contactName, p_phone: ev.phone, p_message_external: ev.messageExternal,
      p_msg_kind: ev.msgKind, p_body: ev.body, p_sent_at: ev.sentAt,
    });
    // A database failure must make Meta retry, so the message is not lost.
    if (error) return new Response('Temporary failure', { status: 500 });
    const r = data as { conversation_id?: string; message_id?: string; ai_enabled?: boolean };
    if (r.conversation_id && r.message_id && r.ai_enabled) {
      work.push(runAgent(db, r.conversation_id, { waitMs: 6000, expectMessageId: r.message_id }).catch(() => {}));
    }
  }
  // Answer Meta at once; the AI turn continues in the background.
  const all = Promise.allSettled(work);
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(all); else await all;
  return new Response('EVENT_RECEIVED', { status: 200 });
});
