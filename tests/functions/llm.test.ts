import { describe, expect, it } from 'vitest';
import { runAgentLoop } from '../../supabase/functions/_shared/agent';
import { buildModel, chooseModel, geminiModel, geminiSchema, toGeminiContents } from '../../supabase/functions/_shared/llm';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const env = (vars: Record<string, string>) => (n: string) => vars[n];

describe('chooseModel', () => {
  it('defaults to Gemini Flash-Lite', () => {
    expect(chooseModel(env({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }))).toMatchObject({ provider: 'gemini', model: 'gemini-3.5-flash-lite', thinkingLevel: 'minimal' });
  });
  it('follows the model name, then the provider setting', () => {
    expect(chooseModel(env({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', AI_MODEL: 'claude-haiku-5-5' }))).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5' });
    expect(chooseModel(env({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', AI_PROVIDER: 'anthropic', AI_MODEL: 'gemini-3.5-flash-lite' }))).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5' });
  });
  it('uses the only key there is', () => expect(chooseModel(env({ ANTHROPIC_API_KEY: 'a' }))).toMatchObject({ provider: 'anthropic' }));
  it('names the missing key', () => expect(chooseModel(env({}))).toEqual({ error: 'GEMINI_API_KEY is not set' }));
});

describe('geminiSchema', () => {
  it('drops the keywords Gemini does not accept', () => {
    expect(geminiSchema({ type: 'object', properties: { score: { type: 'integer', minimum: 0, maximum: 100, description: 'd' }, items: { type: 'array', minItems: 1, items: { type: 'string', enum: ['a'] } } }, required: ['score'] }))
      .toEqual({ type: 'object', properties: { score: { type: 'integer', description: 'd' }, items: { type: 'array', items: { type: 'string', enum: ['a'] } } }, required: ['score'] });
  });
});

describe('geminiModel', () => {
  it('runs a tool and sends the signed turn and the result back', async () => {
    const bodies: Record<string, unknown>[] = [];
    const answers = [
      { candidates: [{ content: { parts: [{ functionCall: { name: 'update_lead', args: { need: 'Monthly plan' } }, thoughtSignature: 'sig-1' }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 5, cachedContentTokenCount: 40 } },
      { candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: 'നമസ്കാരം! Monthly plan ₹2,500 ആണ്.' }] } }], usageMetadata: { promptTokenCount: 130, candidatesTokenCount: 20 } },
    ];
    const fetcher = (async (url: string, init: RequestInit) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
      expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
      bodies.push(JSON.parse(init.body as string));
      return reply(answers[bodies.length - 1]);
    }) as unknown as typeof fetch;

    const tools: string[] = [];
    const r = await runAgentLoop('You sell gym plans.', [{ role: 'user', content: 'plan rate ethra?' }],
      geminiModel('k', 'gemini-3.5-flash-lite', { thinkingLevel: 'minimal' }, fetcher), async (c) => { tools.push(`${c.name}:${JSON.stringify(c.input)}`); return { saved: true }; });

    expect(r.reply).toBe('നമസ്കാരം! Monthly plan ₹2,500 ആണ്.');
    expect(tools).toEqual(['update_lead:{"need":"Monthly plan"}']);
    expect(r).toMatchObject({ inputTokens: 230, outputTokens: 35, cachedTokens: 40 });

    const first = bodies[0] as { systemInstruction: unknown; tools: { functionDeclarations: { name: string }[] }[]; generationConfig: { thinkingConfig: unknown } };
    expect(first.systemInstruction).toEqual({ parts: [{ text: 'You sell gym plans.' }] });
    expect(first.tools[0].functionDeclarations.map((f) => f.name)).toContain('create_order');
    expect(first.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
    expect((bodies[1] as { contents: unknown }).contents).toEqual([
      { role: 'user', parts: [{ text: 'plan rate ethra?' }] },
      { role: 'model', parts: [{ functionCall: { name: 'update_lead', args: { need: 'Monthly plan' } }, thoughtSignature: 'sig-1' }] },
      { role: 'user', parts: [{ functionResponse: { name: 'update_lead', response: { result: { saved: true } } } }] },
    ]);
  });

  it('keeps the id Gemini gives a call', () => {
    const contents = toGeminiContents([
      { role: 'assistant', content: { gemini: true, parts: [{ functionCall: { id: 'fc1', name: 'handoff_to_human', args: {} } }], calls: [{ id: 'fc1', name: 'handoff_to_human', apiId: 'fc1' }] } },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'fc1', content: '{"ok":true}' }] },
    ]);
    expect(contents[1]).toEqual({ role: 'user', parts: [{ functionResponse: { id: 'fc1', name: 'handoff_to_human', response: { result: { ok: true } } } }] });
  });

  it('retries without the thinking setting when the model refuses it', async () => {
    const sent: boolean[] = [];
    const fetcher = (async (_u: string, init: RequestInit) => {
      const has = 'thinkingConfig' in JSON.parse(init.body as string).generationConfig;
      sent.push(has);
      return has ? reply({ error: { message: 'unknown field' } }, 400) : reply({ candidates: [{ content: { parts: [{ text: 'Hi' }] } }] });
    }) as unknown as typeof fetch;
    const t = await geminiModel('k', 'm', { thinkingLevel: 'minimal' }, fetcher)('s', [{ role: 'user', content: 'hi' }]);
    expect(t.text).toBe('Hi');
    expect(sent).toEqual([true, false]);
  });

  it('fails loudly on an empty or refused answer', async () => {
    const fetcher = (async () => reply({ candidates: [], promptFeedback: { blockReason: 'SAFETY' } })) as unknown as typeof fetch;
    await expect(geminiModel('k', 'm', {}, fetcher)('s', [{ role: 'user', content: 'hi' }])).rejects.toThrow('SAFETY');
  });

  it('falls back to the stronger model of the same provider', async () => {
    const used: string[] = [];
    const fetcher = (async (url: string) => {
      used.push(url.split('/models/')[1]);
      return used.length === 1 ? reply({}, 503) : reply({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
    }) as unknown as typeof fetch;
    const choice = chooseModel(env({ GEMINI_API_KEY: 'g', AI_MODEL_ESCALATION: 'gemini-3.6-flash' }));
    if ('error' in choice) throw new Error(choice.error);
    expect((await buildModel(choice, fetcher)('s', [{ role: 'user', content: 'hi' }])).text).toBe('ok');
    expect(used).toEqual(['gemini-3.5-flash-lite:generateContent', 'gemini-3.6-flash:generateContent']);
  });
});
