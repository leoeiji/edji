import type { SQLiteDatabase } from 'expo-sqlite';
import { openTestDb } from '@/testing/nodeSqlite';
import { applyMigrations } from '../db';
import {
  CHAT_MIGRATIONS,
  CHAT_SCHEMA_ID,
  addMessage,
  closeInterruptedMessages,
  createConversation,
  deleteAllConversations,
  deleteConversation,
  findVoiceConversation,
  getConversation,
  historyFor,
  listConversations,
  loadMessages,
  renameConversation,
  savePart,
  savesVoiceConversations,
  setMessageStatus,
  setSetting,
  settleTitle,
  SAVE_VOICE_SETTING,
} from '../chatStore';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

let db: SQLiteDatabase;

beforeEach(async () => {
  db = openTestDb();
  await db.execAsync('CREATE TABLE plugin_schema (id TEXT PRIMARY KEY, version INTEGER NOT NULL)');
  await applyMigrations(db, CHAT_SCHEMA_ID, CHAT_MIGRATIONS);
});

const count = async (table: string) => (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;

describe('chat migrations', () => {
  it('apply once and record the version', async () => {
    await applyMigrations(db, CHAT_SCHEMA_ID, CHAT_MIGRATIONS); // second run is a no-op, not a "table exists" error
    expect(await db.getFirstAsync('SELECT version FROM plugin_schema WHERE id = ?', CHAT_SCHEMA_ID)).toEqual({ version: 1 });
  });
});

describe('conversations', () => {
  it('lists the most recently active first', async () => {
    const a = await createConversation(db, { title: 'Gastos de novembro', origin: 'app', now: 1 });
    const b = await createConversation(db, { title: 'Rotina do carro', origin: 'app', now: 2 });
    await addMessage(db, a.id, { role: 'user', status: 'done', parts: [{ type: 'text', text: 'e dezembro?' }], now: 3 });
    expect((await listConversations(db)).map((c) => c.id)).toEqual([a.id, b.id]);
  });

  it('keeps a manual title over the light model', async () => {
    const c = await createConversation(db, { title: 'Quanto gastei com…', origin: 'app' });
    await renameConversation(db, c.id, '  Mercado  ');
    await settleTitle(db, c.id, 'Gastos com mercado');
    expect(await getConversation(db, c.id)).toMatchObject({ title: 'Mercado', titleStatus: 'manual' });
  });

  it('settles on the light model title, or on the first words when there is none', async () => {
    const a = await createConversation(db, { title: 'Quanto gastei com…', origin: 'app' });
    const b = await createConversation(db, { title: 'Oi', origin: 'app' });
    await settleTitle(db, a.id, 'Gastos com mercado');
    await settleTitle(db, b.id, null);
    expect(await getConversation(db, a.id)).toMatchObject({ title: 'Gastos com mercado', titleStatus: 'done' });
    expect(await getConversation(db, b.id)).toMatchObject({ title: 'Oi', titleStatus: 'local' });
  });

  it('ignores a blank rename', async () => {
    const c = await createConversation(db, { title: 'Oi', origin: 'app' });
    await renameConversation(db, c.id, '   ');
    expect(await getConversation(db, c.id)).toMatchObject({ title: 'Oi', titleStatus: 'pending' });
  });

  it('finds the conversation of a voice session', async () => {
    const c = await createConversation(db, { title: 'Oi', origin: 'voice', voiceSessionId: 's-1' });
    expect((await findVoiceConversation(db, 's-1'))?.id).toBe(c.id);
    expect(await findVoiceConversation(db, 's-2')).toBeNull();
  });

  it('deleting a conversation deletes its messages and tool calls', async () => {
    const c = await createConversation(db, { title: 'Oi', origin: 'app' });
    const keep = await createConversation(db, { title: 'Outra', origin: 'app' });
    await addMessage(db, c.id, {
      role: 'assistant',
      status: 'done',
      parts: [{ type: 'tool', id: 'c1', name: 'finance.add', input: { amount: 38 }, state: 'done', output: 'Anotado.' }],
    });
    await addMessage(db, keep.id, { role: 'user', status: 'done', parts: [{ type: 'text', text: 'oi' }] });
    await deleteConversation(db, c.id);
    expect(await count('chat_messages')).toBe(1);
    expect(await count('chat_parts')).toBe(1);
    await deleteAllConversations(db);
    expect(await count('chat_conversations')).toBe(0);
    expect(await count('chat_parts')).toBe(0);
  });
});

describe('messages', () => {
  it('round-trip text and tool parts in order', async () => {
    const c = await createConversation(db, { title: 'Oi', origin: 'app' });
    const id = await addMessage(db, c.id, { role: 'assistant', status: 'streaming', parts: [] });
    await savePart(db, id, 0, { type: 'text', text: 'Vou ' });
    await savePart(db, id, 1, { type: 'tool', id: 'c1', name: 'finance.add', input: { amount: 38, description: 'Padaria' }, state: 'running' });
    await savePart(db, id, 0, { type: 'text', text: 'Vou registrar.' });
    await savePart(db, id, 1, {
      type: 'tool',
      id: 'c1',
      name: 'finance.add',
      input: { amount: 38, description: 'Padaria' },
      state: 'done',
      output: 'Anotado.',
      durationMs: 120,
    });
    await setMessageStatus(db, id, 'done');
    const [m] = await loadMessages(db, c.id);
    expect(m.status).toBe('done');
    expect(m.parts).toEqual([
      { type: 'text', text: 'Vou registrar.' },
      { type: 'tool', id: 'c1', name: 'finance.add', input: { amount: 38, description: 'Padaria' }, state: 'done', output: 'Anotado.', durationMs: 120 },
    ]);
  });

  it('closes replies left streaming by a dead app, cutting their running tools', async () => {
    const c = await createConversation(db, { title: 'Oi', origin: 'app' });
    await addMessage(db, c.id, {
      role: 'assistant',
      status: 'streaming',
      parts: [{ type: 'tool', id: 'c1', name: 'finance.delete', input: {}, state: 'running' }],
    });
    await closeInterruptedMessages(db);
    const [m] = await loadMessages(db, c.id);
    expect(m.status).toBe('cancelled');
    expect(m.parts[0]).toMatchObject({ state: 'failed' });
  });
});

describe('historyFor', () => {
  it('sends back user turns and real replies, never our own error messages', async () => {
    const c = await createConversation(db, { title: 'Oi', origin: 'app' });
    await addMessage(db, c.id, { role: 'user', status: 'done', parts: [{ type: 'text', text: 'quanto gastei?' }] });
    await addMessage(db, c.id, { role: 'assistant', status: 'failed', parts: [{ type: 'text', text: 'Sem internet.' }] });
    await addMessage(db, c.id, { role: 'user', status: 'done', parts: [{ type: 'text', text: 'e agora?' }] });
    await addMessage(db, c.id, { role: 'assistant', status: 'done', parts: [{ type: 'text', text: 'R$ 842,30.' }] });
    expect(historyFor(await loadMessages(db, c.id)).map((m) => m.content)).toEqual(['quanto gastei?', 'e agora?', 'R$ 842,30.']);
  });
});

describe('voice setting', () => {
  it('saves voice conversations unless turned off', async () => {
    expect(await savesVoiceConversations(db)).toBe(true);
    await setSetting(db, SAVE_VOICE_SETTING, '0');
    expect(await savesVoiceConversations(db)).toBe(false);
    await setSetting(db, SAVE_VOICE_SETTING, '1');
    expect(await savesVoiceConversations(db)).toBe(true);
  });
});
