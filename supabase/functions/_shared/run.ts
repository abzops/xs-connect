// One AI turn for one conversation: load context, think, act, reply, deliver, meter.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { buildSystemPrompt, runAgentLoop, toModelMessages, type AgentContext, type ToolCall } from './agent.ts';
import { buildModel, chooseModel } from './llm.ts';
import { fetchVoice, transcribe, type VoiceTarget } from './voice.ts';
import { sendToMeta, type SendTarget } from './meta.ts';

export const GRAPH_VERSION = Deno.env.get('META_GRAPH_VERSION') ?? 'v24.0';

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}

async function call<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** Delivers a queued message on its channel and records the result. */
export async function deliver(db: SupabaseClient, messageId: string, userId: string | null): Promise<{ ok: boolean; error: string | null }> {
  const target = await call<SendTarget & { error?: string }>(db, 'service_send_target', { p_message: messageId, p_user: userId });
  if (target.error) {
    if (target.error !== 'not queued' && target.error !== 'forbidden') {
      await call(db, 'service_mark_sent', { p_message: messageId, p_external_id: null, p_ok: false, p_error: target.error });
    }
    return { ok: false, error: target.error };
  }
  const sent = await sendToMeta(target, GRAPH_VERSION);
  await call(db, 'service_mark_sent', { p_message: messageId, p_external_id: sent.externalId, p_ok: sent.ok, p_error: sent.error });
  return { ok: sent.ok, error: sent.error };
}

function toolRunner(db: SupabaseClient, conversationId: string) {
  return async (c: ToolCall): Promise<unknown> => {
    const i = c.input;
    switch (c.name) {
      case 'search_knowledge':
        return call(db, 'service_search_knowledge', { p_conversation: conversationId, p_query: String(i.query ?? '') });
      case 'update_lead':
        return call(db, 'service_update_lead', {
          p_conversation: conversationId, p_name: i.name ?? null, p_phone: i.phone ?? null, p_need: i.need ?? null,
          p_budget_paise: typeof i.budget_rupees === 'number' ? Math.round(i.budget_rupees * 100) : null,
          p_stage: i.stage ?? null, p_score: typeof i.score === 'number' ? Math.round(i.score) : null,
        });
      case 'create_order':
        return call(db, 'service_create_order', { p_conversation: conversationId, p_items: i.items ?? [], p_note: i.note ?? null });
      case 'schedule_followup': {
        const due = new Date(String(i.due_at ?? ''));
        if (Number.isNaN(due.getTime())) return { error: 'due_at is not a valid date' };
        return call(db, 'service_create_followup', { p_conversation: conversationId, p_due_at: due.toISOString(), p_note: String(i.note ?? '') });
      }
      case 'handoff_to_human':
        return call(db, 'service_handoff', { p_conversation: conversationId, p_reason: String(i.reason ?? 'Needs a person') });
      default:
        return { error: `unknown tool ${c.name}` };
    }
  };
}

export type RunOutcome = { outcome: 'replied' | 'drafted' | 'handoff' | 'skipped' | 'error'; detail?: string };

export async function runAgent(db: SupabaseClient, conversationId: string, opts: { userId?: string | null; waitMs?: number; expectMessageId?: string } = {}): Promise<RunOutcome> {
  // Customers often send three short messages in a row: wait, then answer them together.
  if (opts.waitMs) await new Promise((r) => setTimeout(r, opts.waitMs));
  const ctx = await call<AgentContext>(db, 'service_agent_context', { p_conversation: conversationId, p_user: opts.userId ?? null });
  if (!ctx.run) return { outcome: 'skipped', detail: ctx.why };
  if (opts.expectMessageId && ctx.last_message_id !== opts.expectMessageId) return { outcome: 'skipped', detail: 'a newer message arrived' };

  const choice = chooseModel((n) => Deno.env.get(n));
  const modelName = 'error' in choice ? 'none' : choice.model;
  const started = Date.now();
  const log = async (outcome: RunOutcome['outcome'], r: { tools: string[]; inputTokens: number; outputTokens: number; cachedTokens: number } | null, detail?: string) => {
    try {
      await call(db, 'service_log_run', {
        p_conversation: conversationId, p_model: modelName, p_input: r?.inputTokens ?? 0, p_output: r?.outputTokens ?? 0,
        p_cached: r?.cachedTokens ?? 0, p_tools: r?.tools ?? [], p_outcome: outcome, p_detail: detail ?? null,
      });
      await call(db, 'service_log_latency', { p_conversation: conversationId, p_latency_ms: Date.now() - started });
    } catch { /* logging must never break a reply */ }
  };

  if ('error' in choice) {
    await log('error', null, choice.error);
    return { outcome: 'error', detail: `The AI key is not set up yet: ${choice.error}. Add it to the project secrets.` };
  }
  try {
    const model = buildModel(choice);
    const result = await runAgentLoop(buildSystemPrompt(ctx, new Date()), toModelMessages(ctx.messages), model, toolRunner(db, conversationId));
    if (!result.reply) {
      await log(result.handedOff ? 'handoff' : 'error', result, 'no reply text');
      return { outcome: result.handedOff ? 'handoff' : 'error', detail: 'The AI did not produce a reply.' };
    }
    // After a handoff the chat's AI is off; p_force lets its closing line through.
    const saved = await call<{ message_id?: string; status?: string; stale?: boolean }>(db, 'service_ai_reply', {
      p_conversation: conversationId, p_body: result.reply, p_answering: ctx.last_message_id, p_force: result.handedOff,
    });
    if (saved.stale || !saved.message_id) { await log('skipped', result, 'stale'); return { outcome: 'skipped', detail: 'a newer message arrived' }; }
    if (saved.status === 'queued') await deliver(db, saved.message_id, null);
    const outcome = result.handedOff ? 'handoff' : saved.status === 'draft' ? 'drafted' : 'replied';
    await log(outcome, result);
    return { outcome };
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'unknown error';
    await log('error', null, detail);
    return { outcome: 'error', detail: 'The AI could not reply. The chat is waiting for a person.' };
  }
}

/** Turns one inbound voice note into text and stores it as the message body. Never throws. */
export async function transcribeVoice(db: SupabaseClient, messageId: string): Promise<{ ok: boolean; detail?: string }> {
  try {
    const target = await call<VoiceTarget & { error?: string }>(db, 'service_voice_target', { p_message: messageId });
    if (target.error) return { ok: false, detail: target.error };
    const audio = await fetchVoice(target, GRAPH_VERSION);
    if ('error' in audio) { console.error('voice note', messageId, audio.error); return { ok: false, detail: audio.error }; }
    const gem = (Deno.env.get('AI_MODEL') ?? '').startsWith('gemini') ? Deno.env.get('AI_MODEL') : undefined;
    const t = await transcribe(audio, {
      sarvam: Deno.env.get('SARVAM_API_KEY'), gemini: Deno.env.get('GEMINI_API_KEY'),
      sarvamModel: Deno.env.get('STT_MODEL'), geminiModel: gem, languageHint: Deno.env.get('STT_LANGUAGE_HINT'),
    });
    if (!t.text) { console.error('voice note', messageId, t.error); return { ok: false, detail: t.error }; }
    await call(db, 'service_set_transcript', { p_message: messageId, p_body: t.text, p_by: t.by });
    return { ok: true };
  } catch (e) {
    console.error('voice note', messageId, e instanceof Error ? e.message : e);
    return { ok: false, detail: 'voice note could not be read' };
  }
}
