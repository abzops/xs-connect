// Delivers a staff reply that the database has queued (staff_send_message).
import { cors, isUuid, json, userId } from '../_shared/http.ts';
import { deliver, serviceClient } from '../_shared/run.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'method not allowed' }, 405);
  const uid = await userId(req);
  if (!uid) return json(req, { error: 'sign in required' }, 401);
  const body = await req.json().catch(() => null) as { message_id?: unknown } | null;
  if (!isUuid(body?.message_id)) return json(req, { error: 'message_id is required' }, 400);
  try {
    const r = await deliver(serviceClient(), body.message_id, uid);
    if (r.error === 'forbidden') return json(req, { error: 'you do not have access to this message' }, 403);
    return json(req, r.ok ? { ok: true } : { error: r.error ?? 'could not send' });
  } catch {
    return json(req, { error: 'could not send; try again' }, 500);
  }
});
