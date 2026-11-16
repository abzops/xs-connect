// One-tap WhatsApp connection (Meta Embedded Signup).
// {action:'config'}: tells the app whether one-tap is ready, and the public
// Meta app and configuration ids it needs. {action:'complete', ...}: finishes
// the connection after the customer logs in and scans the QR code.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { cors, isUuid, json, userId } from '../_shared/http.ts';
import { completeSignup } from '../_shared/signup.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'method not allowed' }, 405);
  const appId = Deno.env.get('META_APP_ID') ?? '';
  const configId = Deno.env.get('META_CONFIG_ID') ?? '';
  const appSecret = Deno.env.get('META_APP_SECRET') ?? '';
  const graphVersion = Deno.env.get('META_GRAPH_VERSION') ?? 'v24.0';
  const ready = !!(appId && configId && appSecret);

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (body?.action === 'config') return json(req, { ready, appId: ready ? appId : null, configId: ready ? configId : null, graphVersion });
  if (body?.action !== 'complete') return json(req, { error: 'unknown action' }, 400);
  if (!ready) return json(req, { error: 'One-tap connection is not switched on yet.' }, 503);

  const uid = await userId(req);
  if (!uid) return json(req, { error: 'sign in required' }, 401);
  if (!isUuid(body.workspace_id)) return json(req, { error: 'workspace_id is required' }, 400);

  // Act as the signed-in person, so the database applies their permissions.
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get('authorization')! } },
  });
  const allowed = await asUser.rpc('check_permission', { p_ws: body.workspace_id, p_permission: 'channels.manage' });
  if (allowed.error || allowed.data !== true) return json(req, { error: 'you do not have permission to connect channels' }, 403);

  const r = await completeSignup({
    code: String(body.code ?? ''), wabaId: String(body.waba_id ?? ''),
    phoneNumberId: body.phone_number_id ? String(body.phone_number_id) : null, coexistence: body.coexistence !== false,
  }, { appId, appSecret, graphVersion });
  if (!r.ok) return json(req, { error: r.error });

  const saved = await asUser.rpc('save_channel', {
    p_ws: body.workspace_id, p_kind: 'whatsapp', p_external_id: r.phoneNumberId, p_display_name: r.displayName, p_access_token: r.token,
  });
  if (saved.error) return json(req, { error: saved.error.message.replace(/^XS\d+:\s*/, '') });
  return json(req, { ok: true, display_name: r.displayName, phone: r.phone });
});
