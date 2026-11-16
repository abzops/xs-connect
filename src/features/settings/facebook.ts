// Meta's Embedded Signup in the browser: load the Facebook SDK, open the
// login popup and collect what Meta sends back when the customer finishes.

type FBLoginResponse = { authResponse?: { code?: string } | null; status?: string };
type FBSDK = {
  init(o: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(cb: (r: FBLoginResponse) => void, o: Record<string, unknown>): void;
};
declare global { interface Window { FB?: FBSDK; fbAsyncInit?: () => void } }

let loading: Promise<FBSDK> | null = null;

/** Loads the SDK once. Call it when the screen opens, so the click can open the popup at once. */
export function loadFacebook(appId: string, version: string): Promise<FBSDK> {
  if (loading) return loading;
  loading = new Promise<FBSDK>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB!);
    };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/en_US/sdk.js';
    s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
    s.onerror = () => { loading = null; reject(new Error('Facebook could not be reached. Check the internet connection and try again.')); };
    document.head.appendChild(s);
  });
  return loading;
}

export type SignupOutcome =
  | { kind: 'done'; code: string; wabaId: string; phoneNumberId: string | null }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

type Session = { event: string; wabaId?: string; phoneNumberId?: string | null; error?: string };

/** Opens Meta's popup. Must be called straight from a click, or browsers block the popup. */
export function runSignup(fb: FBSDK, configId: string, keepPhoneApp: boolean): Promise<SignupOutcome> {
  return new Promise((resolve) => {
    let session: Session | null = null;
    let code: string | null = null;
    let settled = false;
    const finish = (o: SignupOutcome) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      resolve(o);
    };
    const tryFinish = () => {
      if (!code || !session) return;
      if (session.wabaId) finish({ kind: 'done', code, wabaId: session.wabaId, phoneNumberId: session.phoneNumberId ?? null });
    };
    const onMessage = (e: MessageEvent) => {
      let host = '';
      try { host = new URL(e.origin).hostname; } catch { return; }
      if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) return;
      let data: { type?: string; event?: string; data?: Record<string, unknown> };
      try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
      const d = data.data ?? {};
      const ev = String(data.event ?? '');
      if (ev === 'CANCEL') { finish({ kind: 'cancelled' }); return; }
      if (ev === 'ERROR') { finish({ kind: 'error', message: String(d.error_message ?? 'Meta reported a problem. Please try again.') }); return; }
      if (ev.startsWith('FINISH')) {
        session = { event: ev, wabaId: d.waba_id ? String(d.waba_id) : undefined, phoneNumberId: d.phone_number_id ? String(d.phone_number_id) : null };
        tryFinish();
      }
    };
    window.addEventListener('message', onMessage);

    fb.login((r) => {
      code = r.authResponse?.code ?? null;
      if (!code) { finish({ kind: 'cancelled' }); return; }
      tryFinish();
      // The account details usually arrive first; give them a moment if not.
      setTimeout(() => finish(session?.wabaId
        ? { kind: 'done', code: code!, wabaId: session.wabaId, phoneNumberId: session.phoneNumberId ?? null }
        : { kind: 'error', message: 'Meta did not send the account details. Please try again.' }), 8000);
    }, {
      config_id: configId,
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, sessionInfoVersion: '3', ...(keepPhoneApp ? { featureType: 'whatsapp_business_app_onboarding' } : {}) },
    });
  });
}
