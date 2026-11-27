import type { Conversation, StoredMessage } from '../chatStore';
import { chatRows, formatDuration, groupConversations } from '../chatView';

const user = (id: number, text: string): StoredMessage => ({ id, role: 'user', status: 'done', createdAt: 0, parts: [{ type: 'text', text }] });

describe('chatRows', () => {
  it('splits a reply into bubbles and tool cards, in order', () => {
    const rows = chatRows(
      [
        user(1, 'registra 38 de padaria'),
        {
          id: 2,
          role: 'assistant',
          status: 'done',
          createdAt: 0,
          parts: [
            { type: 'tool', id: 'c1', name: 'finance.add', input: {}, state: 'done', output: 'Anotado.' },
            { type: 'text', text: 'Anotado.' },
          ],
        },
      ],
      null,
    );
    expect(rows.map((r) => r.kind)).toEqual(['user', 'tool', 'text']);
  });

  it('shows our errors as errors, with the settings button only for setup', () => {
    const rows = chatRows(
      [user(1, 'oi'), { id: 2, role: 'assistant', status: 'setup', createdAt: 0, parts: [{ type: 'text', text: 'Falta a chave.' }] }],
      null,
    );
    expect(rows.at(-1)).toEqual({ kind: 'error', key: 'm2-error', text: 'Falta a chave.', setup: true });
  });

  it('shows thinking while waiting for the first text or after a tool, and marks stopped replies', () => {
    expect(chatRows([], { userText: 'oi', parts: [] }).map((r) => r.kind)).toEqual(['user', 'thinking']);
    const afterTool = chatRows([], { userText: 'oi', parts: [{ type: 'tool', id: 'c1', name: 'finance.summary', input: {}, state: 'done' }] });
    expect(afterTool.at(-1)?.kind).toBe('thinking');
    const stopped = chatRows([{ id: 2, role: 'assistant', status: 'cancelled', createdAt: 0, parts: [{ type: 'text', text: 'Primeira' }] }], null);
    expect(stopped.map((r) => r.kind)).toEqual(['text', 'stopped']);
  });
});

describe('formatDuration', () => {
  it('uses a comma and one decimal below ten seconds', () => {
    expect(formatDuration(240)).toBe('0,2 s');
    expect(formatDuration(12_400)).toBe('12 s');
  });
});

describe('groupConversations', () => {
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
  const conv = (id: number, updatedAt: number): Conversation => ({
    id,
    title: `c${id}`,
    titleStatus: 'done',
    origin: 'app',
    voiceSessionId: null,
    createdAt: updatedAt,
    updatedAt,
  });

  it('groups by last activity and leaves empty groups out', () => {
    const now = at(2026, 11, 27, 9);
    const groups = groupConversations([conv(1, at(2026, 11, 27, 8)), conv(2, at(2026, 11, 26, 23)), conv(3, at(2026, 10, 1))], now);
    expect(groups.map((g) => [g.title, g.items.map((c) => c.id)])).toEqual([
      ['Hoje', [1]],
      ['Ontem', [2]],
      ['Antes', [3]],
    ]);
  });
});
