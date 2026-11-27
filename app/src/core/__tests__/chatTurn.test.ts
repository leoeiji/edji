import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { SQLiteDatabase } from 'expo-sqlite';
import { MESSAGES } from '@/agent/agent';
import { openTestDb } from '@/testing/nodeSqlite';
import { applyMigrations } from '../db';
import { CHAT_MIGRATIONS, CHAT_SCHEMA_ID, createConversation, getConversation, loadMessages } from '../chatStore';
import { runPersistedTurn, titleConversation } from '../chatTurn';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

type Part = Parameters<typeof simulateReadableStream>[0]['chunks'][number];
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const text = (id: string, deltas: string[]) =>
  [{ type: 'text-start', id }, ...deltas.map((delta) => ({ type: 'text-delta', id, delta })), { type: 'text-end', id }] as Part[];
const step = (body: Part[], reason: 'stop' | 'tool-calls' = 'stop') =>
  [{ type: 'stream-start', warnings: [] }, ...body, { type: 'finish', finishReason: { unified: reason, raw: reason }, usage }] as Part[];

function scripted(steps: Part[][]) {
  let i = 0;
  return new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: steps[i++] }) as never }) });
}

const settings = { apiKey: 'sk-or-test', model: 'autor/modelo', lightModel: null };
const addTool = {
  name: 'finance.add',
  description: 'Registra um gasto.',
  parameters: { type: 'object' as const, properties: { amount: { type: 'number' as const } } },
  execute: async () => ({ ok: true, reply: 'Anotado: R$ 38,00.' }),
};

let db: SQLiteDatabase;
beforeEach(async () => {
  db = openTestDb();
  await db.execAsync('CREATE TABLE plugin_schema (id TEXT PRIMARY KEY, version INTEGER NOT NULL)');
  await applyMigrations(db, CHAT_SCHEMA_ID, CHAT_MIGRATIONS);
});

describe('runPersistedTurn', () => {
  it('stores text and tool calls in stream order', async () => {
    const c = await createConversation(db, { title: 'Registra…', origin: 'app' });
    const model = scripted([
      step([...text('a', ['Vou ', 'registrar.']), { type: 'tool-call', toolCallId: 'c1', toolName: 'finance__add', input: '{"amount":38}' }], 'tool-calls'),
      step(text('b', ['Anotado.'])),
    ]);
    const result = await runPersistedTurn({
      db,
      conversationId: c.id,
      userText: 'registra 38 de padaria',
      settings,
      createModel: () => model,
      tools: [addTool],
    });
    expect(result.status).toBe('done');
    const [user, reply] = await loadMessages(db, c.id);
    expect(user.parts).toEqual([{ type: 'text', text: 'registra 38 de padaria' }]);
    expect(reply.status).toBe('done');
    expect(reply.parts.map((p) => (p.type === 'text' ? p.text : `${p.name}:${p.state}`))).toEqual([
      'Vou registrar.',
      'finance.add:done',
      'Anotado.',
    ]);
  });

  it('sends the stored history, tools included, on the next turn', async () => {
    const c = await createConversation(db, { title: 'Registra…', origin: 'app' });
    await runPersistedTurn({
      db,
      conversationId: c.id,
      userText: 'registra 38 de padaria',
      settings,
      createModel: () =>
        scripted([
          step([{ type: 'tool-call', toolCallId: 'c1', toolName: 'finance__add', input: '{"amount":38}' }], 'tool-calls'),
          step(text('b', ['Anotado.'])),
        ]),
      tools: [addTool],
    });
    const second = scripted([step(text('t', ['Apaguei.']))]);
    await runPersistedTurn({ db, conversationId: c.id, userText: 'apaga o que você registrou', settings, createModel: () => second, tools: [addTool] });
    const prompt = JSON.stringify(second.doStreamCalls[0].prompt);
    expect(prompt).toContain('finance__add');
    expect(prompt).toContain('Anotado: R$ 38,00.');
    expect(prompt).toContain('apaga o que você registrou');
  });

  it('stores an error reply with its status, and keeps it away from the model', async () => {
    const c = await createConversation(db, { title: 'Oi', origin: 'app' });
    const result = await runPersistedTurn({
      db,
      conversationId: c.id,
      userText: 'oi',
      settings: { ...settings, apiKey: null },
      createModel: () => scripted([]),
    });
    expect(result).toMatchObject({ status: 'setup', reply: MESSAGES.noKey });
    const [, reply] = await loadMessages(db, c.id);
    expect(reply).toMatchObject({ status: 'setup', parts: [{ type: 'text', text: MESSAGES.noKey }] });

    const next = scripted([step(text('t', ['Oi.']))]);
    await runPersistedTurn({ db, conversationId: c.id, userText: 'e agora?', settings, createModel: () => next });
    expect(JSON.stringify(next.doStreamCalls[0].prompt)).not.toContain(MESSAGES.noKey);
  });

  it('keeps what arrived when the turn is cancelled', async () => {
    const c = await createConversation(db, { title: 'Oi', origin: 'app' });
    const controller = new AbortController();
    const result = await runPersistedTurn({
      db,
      conversationId: c.id,
      userText: 'me explica com calma',
      settings,
      createModel: () => scripted([step(text('t', ['Primeira parte. ', 'Segunda.']))]),
      signal: controller.signal,
      onText: () => controller.abort(),
    });
    expect(result.status).toBe('cancelled');
    const [, reply] = await loadMessages(db, c.id);
    expect(reply.status).toBe('cancelled');
    expect(reply.parts[0]).toMatchObject({ type: 'text', text: 'Primeira parte. ' });
  });
});

describe('titleConversation', () => {
  it('titles only after the first answered turn, and only once', async () => {
    const c = await createConversation(db, { title: 'Quanto gastei…', origin: 'app' });
    const createModel = jest.fn(() =>
      new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [{ type: 'text', text: 'Gastos com mercado' }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage,
          warnings: [],
        }),
      }),
    );
    const deps = { settings: { ...settings, lightModel: 'autor/leve' }, createModel };
    await titleConversation(db, c, 'quanto gastei?', { status: 'failed', reply: MESSAGES.offline }, deps);
    expect(createModel).not.toHaveBeenCalled();
    await titleConversation(db, c, 'quanto gastei?', { status: 'done', reply: 'R$ 842,30.' }, deps);
    expect(await getConversation(db, c.id)).toMatchObject({ title: 'Gastos com mercado', titleStatus: 'done' });
    await titleConversation(db, (await getConversation(db, c.id))!, 'e agora?', { status: 'done', reply: 'Ok.' }, deps);
    expect(createModel).toHaveBeenCalledTimes(1);
  });

  it('settles on the first words without a light model, offline', async () => {
    const c = await createConversation(db, { title: 'Quanto gastei…', origin: 'app' });
    const createModel = jest.fn();
    await titleConversation(db, c, 'quanto gastei?', { status: 'done', reply: 'R$ 842,30.' }, { settings, createModel });
    expect(createModel).not.toHaveBeenCalled();
    expect(await getConversation(db, c.id)).toMatchObject({ title: 'Quanto gastei…', titleStatus: 'local' });
  });
});

describe('runPersistedTurn ids', () => {
  it('reports the stored user message before the reply starts', async () => {
    const c = await createConversation(db, { title: 'Oi', origin: 'app' });
    const order: string[] = [];
    await runPersistedTurn({
      db,
      conversationId: c.id,
      userText: 'oi',
      settings,
      createModel: () => scripted([step(text('t', ['Oi.']))]),
      onStored: (id) => order.push(`stored:${id}`),
      onParts: () => order.push('parts'),
    });
    const [userMessage] = await loadMessages(db, c.id);
    expect(order[0]).toBe(`stored:${userMessage.id}`);
  });
});
