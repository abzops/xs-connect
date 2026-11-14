import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildSendRequest, parseWebhook, verifySignature } from '../../supabase/functions/_shared/meta';

describe('verifySignature', () => {
  const body = '{"object":"page"}';
  const sign = (secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  it('accepts the right signature', async () => expect(await verifySignature('s3cret', body, sign('s3cret'))).toBe(true));
  it('rejects a wrong secret, a missing header and an empty secret', async () => {
    expect(await verifySignature('s3cret', body, sign('other'))).toBe(false);
    expect(await verifySignature('s3cret', body, null)).toBe(false);
    expect(await verifySignature('', body, sign(''))).toBe(false);
  });
  it('rejects a changed body', async () => expect(await verifySignature('s3cret', body + ' ', sign('s3cret'))).toBe(false));
});

describe('parseWebhook', () => {
  it('reads a WhatsApp text message and a status', () => {
    const events = parseWebhook({
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp', metadata: { display_phone_number: '9190', phone_number_id: '1111' },
        contacts: [{ profile: { name: 'Anu' }, wa_id: '919812345678' }],
        messages: [{ from: '919812345678', id: 'wamid.A', timestamp: '1794700000', type: 'text', text: { body: 'Hi' } }],
        statuses: [{ id: 'wamid.B', status: 'delivered', timestamp: '1794700001', recipient_id: '919812345678' }],
      } }] }],
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'message', kind: 'whatsapp', channelExternal: '1111', contactExternal: '919812345678',
      contactName: 'Anu', phone: '+919812345678', messageExternal: 'wamid.A', msgKind: 'text', body: 'Hi' });
    expect(events[1]).toEqual({ type: 'status', external: 'wamid.B', status: 'delivered', error: null });
  });
  it('marks a WhatsApp voice note as audio', () => {
    const [e] = parseWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
      metadata: { phone_number_id: '1111' }, messages: [{ from: '91', id: 'wamid.C', timestamp: '1794700000', type: 'audio', audio: { id: 'media' } }] } }] }] });
    expect(e).toMatchObject({ msgKind: 'audio', body: '' });
  });
  it('reads Instagram and Messenger messages and skips echoes', () => {
    const ig = parseWebhook({ object: 'instagram', entry: [{ id: 'IG1', time: 1, messaging: [
      { sender: { id: 'U1' }, recipient: { id: 'IG1' }, timestamp: 1794700000000, message: { mid: 'm1', text: 'Price?' } },
      { sender: { id: 'IG1' }, recipient: { id: 'U1' }, timestamp: 1794700000001, message: { mid: 'm2', text: 'Hello', is_echo: true } },
    ] }] });
    expect(ig).toHaveLength(1);
    expect(ig[0]).toMatchObject({ kind: 'instagram', channelExternal: 'IG1', contactExternal: 'U1', messageExternal: 'm1', body: 'Price?', phone: null });
    const fb = parseWebhook({ object: 'page', entry: [{ id: 'P1', messaging: [{ sender: { id: 'U2' }, recipient: { id: 'P1' }, timestamp: 1794700000000, message: { mid: 'm3', attachments: [{ type: 'image', payload: {} }] } }] }] });
    expect(fb[0]).toMatchObject({ kind: 'messenger', msgKind: 'image', body: '' });
  });
  it('ignores unknown or malformed payloads', () => {
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({ object: 'user', entry: [{}] })).toEqual([]);
    expect(parseWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {} }] }] })).toEqual([]);
  });
});

describe('buildSendRequest', () => {
  const base = { channel_external: 'X', token: 'tok', recipient: 'R', body: 'Hello', human_agent_tag: false };
  it('targets the WhatsApp Cloud API', () => {
    const r = buildSendRequest({ ...base, kind: 'whatsapp' }, 'v24.0');
    expect(r.url).toBe('https://graph.facebook.com/v24.0/X/messages');
    expect(JSON.parse(r.init.body as string)).toMatchObject({ messaging_product: 'whatsapp', to: 'R', type: 'text', text: { body: 'Hello' } });
  });
  it('tags late human replies on Messenger and Instagram', () => {
    const fb = JSON.parse(buildSendRequest({ ...base, kind: 'messenger', human_agent_tag: true }, 'v24.0').init.body as string);
    expect(fb).toMatchObject({ messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' });
    const ig = buildSendRequest({ ...base, kind: 'instagram' }, 'v24.0');
    expect(ig.url).toBe('https://graph.instagram.com/v24.0/X/messages');
    expect(JSON.parse(ig.init.body as string).tag).toBeUndefined();
  });
});
