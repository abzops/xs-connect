// Voice notes: fetch the audio from Meta and turn it into text.
// Sarvam Saaras reads Indian languages best but takes 30 seconds at most on its
// quick API; anything longer, or any failure, goes to Gemini with the same audio.
// Pure functions (fetch is passed in) so the unit tests can drive them.

export type VoiceTarget = { kind: 'whatsapp' | 'instagram' | 'messenger'; token: string; media_ref: string; media_mime: string | null };
export type Audio = { bytes: Uint8Array; mime: string };
export type Transcript = { text: string; by: string } | { text: ''; error: string };

const MAX_BYTES = 16 * 1024 * 1024; // WhatsApp's own limit for audio
// Media is only ever fetched from Meta's hosts, whatever a webhook claims.
const META_HOSTS = ['.fbsbx.com', '.fbcdn.net', '.cdninstagram.com', '.facebook.com', '.whatsapp.net'];
export const isMetaUrl = (raw: string): boolean => {
  try { const u = new URL(raw); return u.protocol === 'https:' && META_HOSTS.some((h) => u.hostname.endsWith(h)); }
  catch { return false; }
};
const baseMime = (m: string | null | undefined) => (m ?? '').split(';')[0].trim().toLowerCase();

export async function fetchVoice(t: VoiceTarget, graphVersion: string, fetcher: typeof fetch = fetch): Promise<Audio | { error: string }> {
  let url = t.media_ref; let mime = baseMime(t.media_mime);
  const auth = { Authorization: `Bearer ${t.token}` };
  if (t.kind === 'whatsapp') {
    // WhatsApp gives an id; the id resolves to a short-lived download URL.
    const meta = await fetcher(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(t.media_ref)}`, { headers: auth });
    if (!meta.ok) return { error: `Meta media lookup returned ${meta.status}` };
    const info = await meta.json().catch(() => ({})) as { url?: string; mime_type?: string; file_size?: number };
    if (!info.url) return { error: 'Meta gave no download link' };
    if ((info.file_size ?? 0) > MAX_BYTES) return { error: 'voice note is too large' };
    url = info.url; mime = baseMime(info.mime_type) || mime;
  }
  if (!isMetaUrl(url)) return { error: 'media link is not from Meta' };
  const res = await fetcher(url, t.kind === 'whatsapp' ? { headers: auth } : {});
  if (!res.ok) return { error: `media download returned ${res.status}` };
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length) return { error: 'voice note is empty' };
  if (bytes.length > MAX_BYTES) return { error: 'voice note is too large' };
  return { bytes, mime: mime || baseMime(res.headers.get('content-type')) || 'audio/ogg' };
}

const EXT: Record<string, string> = {
  'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/webm': 'webm', 'video/mp4': 'm4a',
};

/** Sarvam Saaras. `tooLong` marks audio past its 30 second limit. */
export async function sarvamTranscribe(apiKey: string, a: Audio, model: string, fetcher: typeof fetch = fetch): Promise<{ text: string } | { error: string; tooLong: boolean }> {
  const form = new FormData();
  form.append('file', new Blob([a.bytes as BlobPart], { type: a.mime }), `voice.${EXT[a.mime] ?? 'ogg'}`);
  form.append('model', model);
  // codemix keeps English words in English and Malayalam in Malayalam script, as people actually speak.
  form.append('mode', 'codemix');
  const res = await fetcher('https://api.sarvam.ai/speech-to-text', { method: 'POST', headers: { 'api-subscription-key': apiKey }, body: form });
  if (!res.ok) return { error: `Sarvam returned ${res.status}: ${(await res.text()).slice(0, 200)}`, tooLong: res.status === 422 };
  const data = await res.json().catch(() => ({})) as { transcript?: string };
  const text = (data.transcript ?? '').trim();
  return text ? { text } : { error: 'Sarvam heard no words', tooLong: false };
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const NO_SPEECH = '[no speech]';
export async function geminiTranscribe(apiKey: string, a: Audio, model: string, fetcher: typeof fetch = fetch, hint = 'Malayalam'): Promise<{ text: string } | { error: string }> {
  const res = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType: a.mime === 'audio/opus' ? 'audio/ogg' : a.mime, data: base64(a.bytes) } },
        { text: `Write down exactly what is said in this voice note. The speaker is most likely speaking ${hint}, often mixed with English words; do not mistake it for a neighbouring language. Use the script of the language spoken (Malayalam in Malayalam script; English words in English). Write digits for numbers, one digit at a time for phone numbers. Output only the words spoken, with no notes or translation. If there is no speech, output ${NO_SPEECH}.` },
      ] }],
      generationConfig: { temperature: 0, maxOutputTokens: 2048 },
    }),
  });
  if (!res.ok) return { error: `Gemini returned ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const data = await res.json().catch(() => ({})) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  const text = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join(' ').trim();
  return text && text !== NO_SPEECH ? { text } : { error: 'Gemini heard no words' };
}

/** Sarvam first, Gemini when Sarvam cannot (too long, down, or no key). */
export async function transcribe(a: Audio, keys: { sarvam?: string; gemini?: string; sarvamModel?: string; geminiModel?: string; languageHint?: string }, fetcher: typeof fetch = fetch): Promise<Transcript> {
  const errors: string[] = [];
  if (keys.sarvam) {
    const model = keys.sarvamModel || 'saaras:v4';
    const r = await sarvamTranscribe(keys.sarvam, a, model, fetcher).catch((e) => ({ error: e instanceof Error ? e.message : 'Sarvam failed', tooLong: false }));
    if ('text' in r) return { text: r.text, by: model };
    errors.push(r.error);
  }
  if (keys.gemini) {
    const model = keys.geminiModel || 'gemini-3.5-flash-lite';
    const r = await geminiTranscribe(keys.gemini, a, model, fetcher, keys.languageHint || 'Malayalam').catch((e) => ({ error: e instanceof Error ? e.message : 'Gemini failed' }));
    if ('text' in r) return { text: r.text, by: model };
    errors.push(r.error);
  }
  return { text: '', error: errors.join('; ') || 'no transcription key is set (SARVAM_API_KEY or GEMINI_API_KEY)' };
}
