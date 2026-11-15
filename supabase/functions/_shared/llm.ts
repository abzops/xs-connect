// Model access. Two providers: Google Gemini (default) and Anthropic. The
// provider and model names live in secrets, so they change without a deploy.
import { TOOLS, type Model, type ModelMessage, type ModelTurn, type ToolCall } from './agent.ts';

type Block = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> };

export function anthropicModel(apiKey: string, model: string, fetcher: typeof fetch = fetch): Model {
  return async (system: string, messages: ModelMessage[]): Promise<ModelTurn> => {
    const res = await fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 700,
        // The brand prompt is identical across a brand's chats: cache it.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS, messages,
      }),
    });
    if (!res.ok) throw new Error(`model ${model} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json() as { content: Block[]; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } };
    const toolCalls: ToolCall[] = data.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id!, name: b.name!, input: b.input ?? {} }));
    return {
      text: data.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n'),
      toolCalls, raw: data.content,
      inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0, cachedTokens: data.usage?.cache_read_input_tokens ?? 0,
    };
  };
}

// --------------------------------------------------------------------- Gemini

type GeminiPart = {
  text?: string; thought?: boolean; thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
};
/** What a Gemini turn leaves in the history: its parts untouched (they carry
 *  thought signatures the API wants back) and the ids we gave its tool calls. */
type GeminiRaw = { gemini: true; parts: GeminiPart[]; calls: { id: string; name: string; apiId?: string }[] };
const isGeminiRaw = (v: unknown): v is GeminiRaw => typeof v === 'object' && v !== null && (v as GeminiRaw).gemini === true;

const SCHEMA_KEYS = new Set(['type', 'description', 'properties', 'required', 'enum', 'items']);
/** Gemini accepts a subset of JSON Schema: keep the parts it knows. */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (typeof schema !== 'object' || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (!SCHEMA_KEYS.has(k)) continue;
    out[k] = k === 'properties'
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([name, s]) => [name, geminiSchema(s)]))
      : k === 'items' ? geminiSchema(v) : v;
  }
  return out;
}

/** Chat history in Gemini's shape. Tool results find their function name through the turn before them. */
export function toGeminiContents(messages: ModelMessage[]): { role: 'user' | 'model'; parts: GeminiPart[] }[] {
  const out: { role: 'user' | 'model'; parts: GeminiPart[] }[] = [];
  let lastCalls: GeminiRaw['calls'] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }); continue; }
    if (isGeminiRaw(m.content)) { lastCalls = m.content.calls; out.push({ role: 'model', parts: m.content.parts }); continue; }
    if (Array.isArray(m.content)) {
      const parts: GeminiPart[] = [];
      for (const r of m.content as { type?: string; tool_use_id?: string; content?: string }[]) {
        if (r.type !== 'tool_result') continue;
        const c = lastCalls.find((x) => x.id === r.tool_use_id);
        if (!c) continue;
        let result: unknown = r.content;
        try { result = JSON.parse(r.content ?? 'null'); } catch { /* keep the text */ }
        parts.push({ functionResponse: { ...(c.apiId ? { id: c.apiId } : {}), name: c.name, response: { result } } });
      }
      if (parts.length) out.push({ role: 'user', parts });
    }
  }
  return out;
}

export function geminiModel(apiKey: string, model: string, opts: { thinkingLevel?: string } = {}, fetcher: typeof fetch = fetch): Model {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const tools = [{ functionDeclarations: TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.input_schema) })) }];
  return async (system: string, messages: ModelMessage[]): Promise<ModelTurn> => {
    const send = (thinking: boolean) => fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: toGeminiContents(messages), tools,
        generationConfig: {
          maxOutputTokens: 1024, temperature: 0.4,
          // A chat reply should not wait on long reasoning.
          ...(thinking && opts.thinkingLevel ? { thinkingConfig: { thinkingLevel: opts.thinkingLevel } } : {}),
        },
      }),
    });
    let res = await send(true);
    // A model that does not know the thinking setting must not stop the chat.
    if (res.status === 400 && opts.thinkingLevel) res = await send(false);
    if (!res.ok) throw new Error(`model ${model} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json() as {
      candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    if (!parts.length) throw new Error(`model ${model} gave no reply (${data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason ?? 'empty'})`);
    const calls: GeminiRaw['calls'] = [];
    const toolCalls: ToolCall[] = [];
    for (const p of parts) {
      if (!p.functionCall) continue;
      const id = p.functionCall.id || `call_${calls.length + 1}_${p.functionCall.name}`;
      calls.push({ id, name: p.functionCall.name, apiId: p.functionCall.id });
      toolCalls.push({ id, name: p.functionCall.name, input: p.functionCall.args ?? {} });
    }
    const u = data.usageMetadata ?? {};
    return {
      text: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('\n'),
      toolCalls, raw: { gemini: true, parts, calls } satisfies GeminiRaw,
      inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      cachedTokens: u.cachedContentTokenCount ?? 0,
    };
  };
}

/** Tries the everyday model; on failure, the stronger one once. */
export function withFallback(primary: Model, fallback: Model | null): Model {
  return async (system, messages) => {
    try { return await primary(system, messages); }
    catch (e) { if (!fallback) throw e; return await fallback(system, messages); }
  };
}

export type Provider = 'gemini' | 'anthropic';
export type ModelChoice = { provider: Provider; key: string; model: string; escalation: string; thinkingLevel: string } | { error: string };

/** Reads the provider and model from secrets. Gemini is the default. */
export function chooseModel(env: (name: string) => string | undefined): ModelChoice {
  const named = (env('AI_MODEL') ?? '').trim();
  const wanted = (env('AI_PROVIDER') ?? '').trim().toLowerCase();
  const gemini = env('GEMINI_API_KEY'); const anthropic = env('ANTHROPIC_API_KEY');
  const provider: Provider = wanted === 'gemini' || wanted === 'anthropic' ? wanted
    : named.startsWith('claude') ? 'anthropic' : named.startsWith('gemini') ? 'gemini'
    : gemini ? 'gemini' : anthropic ? 'anthropic' : 'gemini';
  const key = provider === 'gemini' ? gemini : anthropic;
  if (!key) return { error: `${provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'} is not set` };
  const fits = (name: string) => name.startsWith(provider === 'gemini' ? 'gemini' : 'claude');
  const escalation = (env('AI_MODEL_ESCALATION') ?? '').trim();
  return {
    provider, key,
    model: named && fits(named) ? named : provider === 'gemini' ? 'gemini-3.5-flash-lite' : 'claude-haiku-5-5',
    escalation: escalation && fits(escalation) ? escalation : '',
    thinkingLevel: (env('AI_THINKING_LEVEL') ?? 'minimal').trim(),
  };
}

export function buildModel(c: Exclude<ModelChoice, { error: string }>, fetcher: typeof fetch = fetch): Model {
  const make = (name: string) => c.provider === 'gemini' ? geminiModel(c.key, name, { thinkingLevel: c.thinkingLevel }, fetcher) : anthropicModel(c.key, name, fetcher);
  return withFallback(make(c.model), c.escalation ? make(c.escalation) : null);
}
