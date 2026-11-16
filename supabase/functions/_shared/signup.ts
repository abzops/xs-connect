// WhatsApp Embedded Signup, server side. After the customer logs in with
// Facebook and scans the QR code in their WhatsApp Business app, Meta gives the
// page a one-time code. This turns it into a working channel. Pure functions
// (fetch is passed in) so the unit tests can drive them.

export type SignupInput = { code: string; wabaId: string; phoneNumberId: string | null; coexistence: boolean };
export type SignupConfig = { appId: string; appSecret: string; graphVersion: string };
export type SignupResult =
  | { ok: true; token: string; phoneNumberId: string; displayName: string; phone: string | null }
  | { ok: false; error: string };

type Json = Record<string, unknown>;
const ID = /^\d{5,25}$/;

async function graph(fetcher: typeof fetch, url: string, init?: RequestInit): Promise<{ ok: boolean; data: Json }> {
  const res = await fetcher(url, init);
  const data = await res.json().catch(() => ({})) as Json;
  return { ok: res.ok && !data.error, data };
}
const metaError = (data: Json, fallback: string) => {
  const e = (data.error ?? {}) as { message?: string; code?: number; error_user_msg?: string };
  return { code: e.code, text: e.error_user_msg || e.message || fallback };
};

/** A 6-digit two-step PIN that is the same every time for one number, without storing it. */
export async function registrationPin(secret: string, phoneNumberId: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`wa-register-pin:${phoneNumberId}`)));
  const n = ((mac[0] << 24) | (mac[1] << 16) | (mac[2] << 8) | mac[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, '0');
}

export async function completeSignup(input: SignupInput, cfg: SignupConfig, fetcher: typeof fetch = fetch): Promise<SignupResult> {
  if (!input.code || !ID.test(input.wabaId) || (input.phoneNumberId && !ID.test(input.phoneNumberId))) {
    return { ok: false, error: 'Meta did not send back the account details. Please try again.' };
  }
  const g = `https://graph.facebook.com/${cfg.graphVersion}`;

  // 1. The one-time code becomes a token for this customer's account only.
  const q = new URLSearchParams({ client_id: cfg.appId, client_secret: cfg.appSecret, code: input.code });
  const ex = await graph(fetcher, `${g}/oauth/access_token?${q}`);
  const token = typeof ex.data.access_token === 'string' ? ex.data.access_token : '';
  if (!ex.ok || !token) return { ok: false, error: `Meta did not accept the login: ${metaError(ex.data, 'no token').text}` };
  const auth = { Authorization: `Bearer ${token}` };

  // 2. The business app flow can leave out the phone number id; look it up.
  let phoneNumberId = input.phoneNumberId ?? '';
  if (!phoneNumberId) {
    const list = await graph(fetcher, `${g}/${input.wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`, { headers: auth });
    const first = Array.isArray(list.data.data) ? (list.data.data as Json[])[0] : undefined;
    phoneNumberId = typeof first?.id === 'string' ? first.id : '';
    if (!phoneNumberId) return { ok: false, error: 'No phone number was found on this WhatsApp account.' };
  }

  // 3. Send this account's messages to XS Connect.
  const sub = await graph(fetcher, `${g}/${input.wabaId}/subscribed_apps`, { method: 'POST', headers: auth });
  if (!sub.ok) return { ok: false, error: `Could not link the account to XS Connect: ${metaError(sub.data, 'subscribe failed').text}` };

  // 4. A new number must be registered for the API. A number from the WhatsApp
  //    Business app is already registered; registering it again would move it off the phone.
  if (!input.coexistence) {
    const pin = await registrationPin(cfg.appSecret, phoneNumberId);
    const reg = await graph(fetcher, `${g}/${phoneNumberId}/register`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
    });
    if (!reg.ok) {
      const e = metaError(reg.data, 'register failed');
      return { ok: false, error: e.code === 133005
        ? 'This number has a two-step verification PIN. Turn it off in WhatsApp Manager, then connect again.'
        : `Could not switch on the number: ${e.text}` };
    }
  }

  // 5. The name and number to show in the inbox.
  const info = await graph(fetcher, `${g}/${phoneNumberId}?fields=display_phone_number,verified_name`, { headers: auth });
  const phone = typeof info.data.display_phone_number === 'string' ? info.data.display_phone_number : null;
  const name = typeof info.data.verified_name === 'string' && info.data.verified_name ? info.data.verified_name : phone ?? 'WhatsApp';
  return { ok: true, token, phoneNumberId, displayName: name, phone };
}
