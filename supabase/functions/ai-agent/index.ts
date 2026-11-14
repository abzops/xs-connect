// Runs one AI turn on request from a signed-in staff member (demo chats, retries).
// Live inbound messages trigger the same run from meta-webhook.
import { cors, isUuid, json, userId } from '../_shared/http.ts';
import { runAgent, serviceClient } from '../_shared/run.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'method not allowed' }, 405);
  const uid = await userId(req);
  if (!uid) return json(req, { error: 'sign in required' }, 401);
  const body = await req.json().catch(() => null) as { conversation_id?: unknown } | null;
  if (!isUuid(body?.conversation_id)) return json(req, { error: 'conversation_id is required' }, 400);
  const r = await runAgent(serviceClient(), body.conversation_id, { userId: uid });
  if (r.outcome === 'error') return json(req, { error: r.detail ?? 'the AI could not reply' });
  if (r.outcome === 'skipped' && r.detail === 'forbidden') return json(req, { error: 'you do not have access to this chat' }, 403);
  return json(req, r);
});
