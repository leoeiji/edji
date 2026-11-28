import type { AssistantPart, ToolPart } from '@/agent/agent';
import type { Attachment } from '@/agent/attachments';
import { messageAttachments, type ChatPart, type Conversation, type MessageStatus, type StoredMessage } from './chatStore';
import type { UsageSummary } from './usage';

/**
 * One row of the chat list. A reply is split into rows: each text part is a
 * bubble and each tool call a card, in stream order. `error` is our own
 * message (no key, offline); `setup` ones get a button to the settings.
 */
export type ChatRow =
  | { kind: 'user'; key: string; text: string; attachments: Attachment[] }
  | { kind: 'text'; key: string; text: string; streaming: boolean }
  | { kind: 'tool'; key: string; tool: ToolPart }
  | { kind: 'error'; key: string; text: string; setup: boolean }
  | { kind: 'thinking'; key: string }
  | { kind: 'stopped'; key: string }
  | { kind: 'usage'; key: string; messageId: number; usage: UsageSummary };

/**
 * The turn streaming now, as the screen shows it. The turn is stored as it
 * goes, so stored messages from [fromMessageId] on are this same turn and
 * are left out while it is live.
 */
export type LiveTurn = { userText: string; attachments?: Attachment[]; parts: AssistantPart[]; fromMessageId?: number };

/**
 * Rows oldest first; the screen's inverted list reverses them. A finished
 * reply with counted tokens in [usage] (by message id) ends with its usage line.
 */
export function chatRows(messages: StoredMessage[], live: LiveTurn | null, usage: Map<number, UsageSummary> = new Map()): ChatRow[] {
  const rows: ChatRow[] = [];
  const cut = live?.fromMessageId;
  for (const m of messages) {
    if (live && cut !== undefined && m.id >= cut) continue;
    if (m.role === 'user') {
      rows.push({ kind: 'user', key: `m${m.id}`, text: partsText(m.parts), attachments: messageAttachments(m.parts) });
    } else {
      rows.push(...replyRows(`m${m.id}`, m.parts.filter(isAssistantPart), m.status));
      const u = usage.get(m.id);
      if (u && u.totalTokens > 0 && m.status !== 'streaming') rows.push({ kind: 'usage', key: `m${m.id}-usage`, messageId: m.id, usage: u });
    }
  }
  if (live) {
    rows.push({ kind: 'user', key: 'live-user', text: live.userText, attachments: live.attachments ?? [] });
    rows.push(...replyRows('live', live.parts, 'streaming'));
  }
  return rows;
}

function replyRows(key: string, parts: AssistantPart[], status: MessageStatus): ChatRow[] {
  if (status === 'failed' || status === 'setup') {
    // The error text is the last part; what streamed before it (if anything) still shows.
    const before = parts.slice(0, -1);
    const last = parts.at(-1);
    return [
      ...partRows(key, before, false),
      { kind: 'error', key: `${key}-error`, text: last?.type === 'text' ? last.text : '', setup: status === 'setup' },
    ];
  }
  const rows = partRows(key, parts, status === 'streaming');
  if (status === 'streaming' && (parts.length === 0 || parts.at(-1)?.type === 'tool')) rows.push({ kind: 'thinking', key: `${key}-thinking` });
  if (status === 'cancelled') rows.push({ kind: 'stopped', key: `${key}-stopped` });
  return rows;
}

function partRows(key: string, parts: AssistantPart[], streaming: boolean): ChatRow[] {
  return parts.flatMap((p, i): ChatRow[] => {
    if (p.type === 'tool') return [{ kind: 'tool', key: `${key}-${i}`, tool: p }];
    const text = p.text.trim();
    return text ? [{ kind: 'text', key: `${key}-${i}`, text, streaming: streaming && i === parts.length - 1 }] : [];
  });
}

function isAssistantPart(p: ChatPart): p is AssistantPart {
  return p.type !== 'attachment';
}

function partsText(parts: ChatPart[]): string {
  return parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
}

/** "0,2 s", "1,4 s", "12 s": how long a tool took, as the card shows it. */
export function formatDuration(ms: number): string {
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1).replace('.', ',')} s` : `${Math.round(s)} s`;
}

export type ConversationGroup = { title: string; items: Conversation[] };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Conversations by last activity, in the side panel's groups: Hoje, Ontem,
 * Esta semana (the last 7 days) and Antes. Empty groups are left out.
 */
export function groupConversations(conversations: Conversation[], now: number): ConversationGroup[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  const groups: ConversationGroup[] = [
    { title: 'Hoje', items: [] },
    { title: 'Ontem', items: [] },
    { title: 'Esta semana', items: [] },
    { title: 'Antes', items: [] },
  ];
  for (const c of conversations) {
    const at = c.updatedAt;
    const index = at >= today ? 0 : at >= today - DAY_MS ? 1 : at >= today - 6 * DAY_MS ? 2 : 3;
    groups[index].items.push(c);
  }
  return groups.filter((g) => g.items.length > 0);
}
