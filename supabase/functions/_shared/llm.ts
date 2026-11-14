// Model access. One provider today (Anthropic Messages API); the router keeps
// the model names in secrets so they can change without a deploy.
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

/** Tries the everyday model; on failure, the stronger one once. */
export function withFallback(primary: Model, fallback: Model | null): Model {
  return async (system, messages) => {
    try { return await primary(system, messages); }
    catch (e) { if (!fallback) throw e; return await fallback(system, messages); }
  };
}
