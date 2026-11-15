import { describe, expect, it } from 'vitest';
import { fetchVoice, isMetaUrl, transcribe } from '../../supabase/functions/_shared/voice';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const audio = { bytes: new Uint8Array([1, 2, 3, 4]), mime: 'audio/ogg' };

describe('fetchVoice', () => {
  it('resolves a WhatsApp media id and downloads it with the channel token', async () => {
    const seen: [string, string | undefined][] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      seen.push([url, (init?.headers as Record<string, string> | undefined)?.Authorization]);
      return url.includes('graph.facebook.com')
        ? json({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'audio/ogg; codecs=opus', file_size: 4 })
        : new Response(new Uint8Array([9, 9, 9]));
    }) as unknown as typeof fetch;
    const a = await fetchVoice({ kind: 'whatsapp', token: 'tok', media_ref: '555', media_mime: null }, 'v24.0', fetcher);
    expect(a).toEqual({ bytes: new Uint8Array([9, 9, 9]), mime: 'audio/ogg' });
    expect(seen).toEqual([['https://graph.facebook.com/v24.0/555', 'Bearer tok'], ['https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', 'Bearer tok']]);
  });
  it('downloads Instagram audio from its link without sending the token', async () => {
    const fetcher = (async (_u: string, init?: RequestInit) => {
      expect(init?.headers).toBeUndefined();
      return new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mp4' } });
    }) as unknown as typeof fetch;
    expect(await fetchVoice({ kind: 'instagram', token: 'tok', media_ref: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1', media_mime: null }, 'v24.0', fetcher))
      .toEqual({ bytes: new Uint8Array([1]), mime: 'audio/mp4' });
  });
  it('never fetches from a host that is not Meta', async () => {
    const fetcher = (async () => { throw new Error('must not fetch'); }) as unknown as typeof fetch;
    expect(await fetchVoice({ kind: 'messenger', token: 't', media_ref: 'https://evil.example/a.ogg', media_mime: null }, 'v24.0', fetcher)).toEqual({ error: 'media link is not from Meta' });
    expect(isMetaUrl('http://lookaside.fbsbx.com/x')).toBe(false);
    expect(isMetaUrl('https://fbsbx.com.evil.example/x')).toBe(false);
  });
  it('refuses an oversized voice note before downloading', async () => {
    const fetcher = (async () => json({ url: 'https://lookaside.fbsbx.com/x', file_size: 17 * 1024 * 1024 })) as unknown as typeof fetch;
    expect(await fetchVoice({ kind: 'whatsapp', token: 't', media_ref: '1', media_mime: null }, 'v24.0', fetcher)).toEqual({ error: 'voice note is too large' });
  });
});

describe('transcribe', () => {
  it('uses Sarvam Saaras v4 in code-mixed mode', async () => {
    const fetcher = (async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.sarvam.ai/speech-to-text');
      expect((init.headers as Record<string, string>)['api-subscription-key']).toBe('s');
      const form = init.body as FormData;
      expect([form.get('model'), form.get('mode')]).toEqual(['saaras:v4', 'codemix']);
      expect((form.get('file') as File).name).toBe('voice.ogg');
      return json({ transcript: ' Premium plan-ന് എത്രയാ rate? ', language_code: 'ml-IN' });
    }) as unknown as typeof fetch;
    expect(await transcribe(audio, { sarvam: 's', gemini: 'g' }, fetcher)).toEqual({ text: 'Premium plan-ന് എത്രയാ rate?', by: 'saaras:v4' });
  });
  it('hands a voice note over 30 seconds to Gemini with the same audio', async () => {
    const urls: string[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url.includes('sarvam')) return json({ error: { message: 'audio over 30 seconds' } }, 422);
      const part = JSON.parse(init.body as string).contents[0].parts[0];
      expect(part.inlineData).toEqual({ mimeType: 'audio/ogg', data: 'AQIDBA==' });
      return json({ candidates: [{ content: { parts: [{ text: 'രണ്ട് Starter plan വേണം' }] } }] });
    }) as unknown as typeof fetch;
    expect(await transcribe(audio, { sarvam: 's', gemini: 'g' }, fetcher)).toEqual({ text: 'രണ്ട് Starter plan വേണം', by: 'gemini-3.5-flash-lite' });
    expect(urls).toHaveLength(2);
  });
  it('reports why nothing could be read', async () => {
    const fetcher = (async (url: string) => url.includes('sarvam') ? json({}, 503) : json({ candidates: [{ content: { parts: [{ text: '[no speech]' }] } }] })) as unknown as typeof fetch;
    const t = await transcribe(audio, { sarvam: 's', gemini: 'g' }, fetcher);
    expect(t.text).toBe('');
    expect('error' in t && t.error).toContain('Sarvam returned 503');
    expect(await transcribe(audio, {}, fetcher)).toEqual({ text: '', error: 'no transcription key is set (SARVAM_API_KEY or GEMINI_API_KEY)' });
  });
});
