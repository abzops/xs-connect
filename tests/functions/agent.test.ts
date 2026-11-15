import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, runAgentLoop, toModelMessages, type AgentContext, type ModelTurn } from '../../supabase/functions/_shared/agent';

const ctx: AgentContext = {
  run: true, workspace: { id: 'w', name: 'Iron Temple', vertical: 'gym', timezone: 'Asia/Kolkata' },
  channel: { kind: 'instagram', mode: 'live' }, last_message_id: 'm',
  profile: { about: 'A gym in Kochi.', services: '', offers: '', hours: '6 am to 10 pm', location: '', policies: '', tone: 'Warm', never_say: 'Never promise results', handoff_above_paise: 1000000, autopilot: true },
  catalog: [{ id: 'c1', kind: 'service', name: 'Monthly', description: null, price_paise: 250000, unit: 'month', in_stock: true }],
  contact: { name: 'Rahul', phone: null }, lead: null, messages: [],
};
const turn = (t: Partial<ModelTurn>): ModelTurn => ({ text: '', toolCalls: [], raw: [], inputTokens: 10, outputTokens: 5, cachedTokens: 0, ...t });

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt(ctx, new Date('2026-11-15T06:00:00Z'));
  it('carries the brand, its prices and its limits', () => {
    expect(prompt).toContain('Iron Temple');
    expect(prompt).toContain('Monthly (service, id c1): ₹2,500 per month');
    expect(prompt).toContain('Never promise results');
    expect(prompt).toContain('above ₹10,000');
  });
  it('asks for a WhatsApp number on Instagram only', () => {
    expect(prompt).toContain('WhatsApp number');
    expect(buildSystemPrompt({ ...ctx, channel: { kind: 'whatsapp', mode: 'live' } }, new Date())).not.toContain("ask for the customer's WhatsApp number");
  });
  it('leaves out empty sections', () => expect(prompt).not.toContain('## Current offers'));
});

describe('toModelMessages', () => {
  it('starts with the customer, merges runs and names media', () => {
    const out = toModelMessages([
      { direction: 'out', sender: 'ai', kind: 'text', body: 'Welcome' },
      { direction: 'in', sender: 'contact', kind: 'text', body: 'Hi' },
      { direction: 'in', sender: 'contact', kind: 'audio', body: '' },
      { direction: 'out', sender: 'staff', kind: 'text', body: 'Hello!' },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'Hi\n[The customer sent a voice note that could not be read]' },
      { role: 'assistant', content: 'Hello!' },
    ]);
  });
});

describe('runAgentLoop', () => {
  it('runs tools, feeds results back and returns the final words', async () => {
    const seen: unknown[] = [];
    const turns = [
      turn({ toolCalls: [{ id: 't1', name: 'create_order', input: { items: [{ catalog_item_id: 'c1', qty: 1 }] } }], raw: [{ type: 'tool_use' }] }),
      turn({ text: 'Booked! The total is ₹2,500.' }),
    ];
    const r = await runAgentLoop('sys', [{ role: 'user', content: 'Book monthly' }],
      async (_s, messages) => { seen.push(structuredClone(messages)); return turns.shift()!; },
      async () => ({ ok: true, total_paise: 250000 }));
    expect(r.reply).toBe('Booked! The total is ₹2,500.');
    expect(r.tools).toEqual(['create_order']);
    expect(r.inputTokens).toBe(20);
    const second = seen[1] as { role: string; content: { type: string; content: string }[] }[];
    expect(second[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect(second[2].content[0].content).toContain('250000');
  });
  it('flags a handoff and survives a failing tool', async () => {
    const turns = [
      turn({ toolCalls: [{ id: 'a', name: 'handoff_to_human', input: { reason: 'refund' } }, { id: 'b', name: 'update_lead', input: {} }] }),
      turn({ text: 'A team member will reply soon.' }),
    ];
    const r = await runAgentLoop('sys', [{ role: 'user', content: 'Refund!' }], async () => turns.shift()!,
      async (c) => { if (c.name === 'update_lead') throw new Error('db down'); return { ok: true }; });
    expect(r.handedOff).toBe(true);
    expect(r.reply).toBe('A team member will reply soon.');
  });
  it('stops after the turn limit', async () => {
    let calls = 0;
    const r = await runAgentLoop('sys', [{ role: 'user', content: 'x' }],
      async () => { calls++; return turn({ toolCalls: [{ id: `t${calls}`, name: 'search_knowledge', input: { query: 'x' } }] }); },
      async () => [], 3);
    expect(calls).toBe(3);
    expect(r.reply).toBe('');
  });
});

describe('voice notes in the chat history', () => {
  it('marks a transcript so the model knows it was spoken', () => {
    expect(toModelMessages([{ direction: 'in', sender: 'contact', kind: 'audio', body: 'രണ്ട് Starter plan വേണം' }]))
      .toEqual([{ role: 'user', content: '[Voice note] രണ്ട് Starter plan വേണം' }]);
  });
  it('tells the model to confirm orders taken from a voice note', () => {
    expect(buildSystemPrompt(ctx, new Date())).toContain('[Voice note] are automatic transcripts');
  });
});
