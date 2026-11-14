import { CHANNEL_LABEL, type ChannelKind } from '../lib/types';

const SHORT: Record<ChannelKind, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' };

export function ChannelChip({ kind, demo = false }: { kind: ChannelKind; demo?: boolean }) {
  return <span className={`ch ${kind}`} title={CHANNEL_LABEL[kind]}>{SHORT[kind]}{demo ? ' · demo' : ''}</span>;
}

/** '5 min', '3 h', '2 d' since the timestamp. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86_400)} d`;
}

/**
 * Time left to reply. WhatsApp allows free-form replies for 24 hours after the
 * customer's last message; on Instagram and Messenger a person may reply for 7 days.
 */
export function replyWindow(kind: ChannelKind, lastInbound: string | null, now = Date.now()) {
  if (!lastInbound) return { open: false, aiOpen: false, hoursLeft: 0 };
  const age = now - Date.parse(lastInbound);
  const day = 86_400_000;
  const limit = kind === 'whatsapp' ? day : 7 * day;
  return { open: age < limit, aiOpen: age < day, hoursLeft: Math.max(0, Math.floor((limit - age) / 3_600_000)) };
}
