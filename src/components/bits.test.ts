import { describe, expect, it } from 'vitest';
import { ago, replyWindow } from './bits';

const now = Date.parse('2026-11-15T12:00:00Z');
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

describe('replyWindow', () => {
  it('WhatsApp closes after 24 hours', () => {
    expect(replyWindow('whatsapp', hoursAgo(23), now).open).toBe(true);
    expect(replyWindow('whatsapp', hoursAgo(25), now).open).toBe(false);
  });
  it('Instagram stays open to people for 7 days but to AI for 24 hours', () => {
    const w = replyWindow('instagram', hoursAgo(30), now);
    expect(w.open).toBe(true);
    expect(w.aiOpen).toBe(false);
    expect(replyWindow('messenger', hoursAgo(24 * 7 + 1), now).open).toBe(false);
  });
  it('is closed when the customer never wrote', () => {
    expect(replyWindow('whatsapp', null, now).open).toBe(false);
  });
});

describe('ago', () => {
  it('formats short durations', () => {
    expect(ago(hoursAgo(0), now)).toBe('now');
    expect(ago(hoursAgo(3), now)).toBe('3 h');
    expect(ago(hoursAgo(50), now)).toBe('2 d');
  });
});
