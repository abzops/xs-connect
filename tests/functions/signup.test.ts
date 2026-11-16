import { describe, expect, it } from 'vitest';
import { completeSignup, registrationPin } from '../../supabase/functions/_shared/signup';

const cfg = { appId: 'APP', appSecret: 'secret', graphVersion: 'v24.0' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function meta(overrides: Record<string, Response> = {}) {
  const calls: { url: string; method: string; auth?: string; body?: string }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', auth: (init?.headers as Record<string, string> | undefined)?.Authorization, body: init?.body as string | undefined });
    for (const [part, res] of Object.entries(overrides)) if (url.includes(part)) return res.clone();
    if (url.includes('/oauth/access_token')) return json({ access_token: 'BIZ_TOKEN' });
    if (url.includes('/phone_numbers')) return json({ data: [{ id: '1110001', display_phone_number: '+91 98400 00000' }] });
    if (url.includes('/subscribed_apps')) return json({ success: true });
    if (url.includes('/register')) return json({ success: true });
    return json({ display_phone_number: '+91 98400 00000', verified_name: 'Iron Temple Gym' });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

describe('completeSignup', () => {
  it('connects a WhatsApp Business app number without moving it off the phone', async () => {
    const { calls, fetcher } = meta();
    const r = await completeSignup({ code: 'CODE', wabaId: '2220002', phoneNumberId: null, coexistence: true }, cfg, fetcher);
    expect(r).toEqual({ ok: true, token: 'BIZ_TOKEN', phoneNumberId: '1110001', displayName: 'Iron Temple Gym', phone: '+91 98400 00000' });
    expect(calls[0].url).toBe('https://graph.facebook.com/v24.0/oauth/access_token?client_id=APP&client_secret=secret&code=CODE');
    expect(calls.map((c) => `${c.method} ${c.url.split('?')[0].split('v24.0')[1]}`)).toEqual([
      'GET /oauth/access_token', 'GET /2220002/phone_numbers', 'POST /2220002/subscribed_apps', 'GET /1110001',
    ]);
    expect(calls.slice(1).every((c) => c.auth === 'Bearer BIZ_TOKEN')).toBe(true);
  });

  it('registers a new number with a stable PIN', async () => {
    const { calls, fetcher } = meta();
    const r = await completeSignup({ code: 'CODE', wabaId: '2220002', phoneNumberId: '1110001', coexistence: false }, cfg, fetcher);
    expect(r.ok).toBe(true);
    const reg = calls.find((c) => c.url.endsWith('/1110001/register'))!;
    const pin = await registrationPin('secret', '1110001');
    expect(pin).toMatch(/^\d{6}$/);
    expect(await registrationPin('secret', '1110001')).toBe(pin);
    expect(JSON.parse(reg.body!)).toEqual({ messaging_product: 'whatsapp', pin });
  });

  it('explains a two-step PIN that blocks registration', async () => {
    const { fetcher } = meta({ '/register': json({ error: { code: 133005, message: 'PIN mismatch' } }, 400) });
    const r = await completeSignup({ code: 'CODE', wabaId: '2220002', phoneNumberId: '1110001', coexistence: false }, cfg, fetcher);
    expect(r).toEqual({ ok: false, error: 'This number has a two-step verification PIN. Turn it off in WhatsApp Manager, then connect again.' });
  });

  it('stops when Meta refuses the code, before touching the account', async () => {
    const { calls, fetcher } = meta({ '/oauth/access_token': json({ error: { message: 'Code was used' } }, 400) });
    const r = await completeSignup({ code: 'CODE', wabaId: '2220002', phoneNumberId: null, coexistence: true }, cfg, fetcher);
    expect(r).toEqual({ ok: false, error: 'Meta did not accept the login: Code was used' });
    expect(calls).toHaveLength(1);
  });

  it('refuses ids that are not Meta ids', async () => {
    const { calls, fetcher } = meta();
    const r = await completeSignup({ code: 'CODE', wabaId: '../me', phoneNumberId: null, coexistence: true }, cfg, fetcher);
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
