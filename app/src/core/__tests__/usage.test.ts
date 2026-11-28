import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { SQLiteDatabase } from 'expo-sqlite';
import { failedStepMetrics, type StepMetrics } from '@/agent/metrics';
import { openTestDb } from '@/testing/nodeSqlite';
import { CHAT_MIGRATIONS, CHAT_SCHEMA_ID, createConversation, deleteConversation, loadMessages } from '../chatStore';
import { runPersistedTurn, titleConversation } from '../chatTurn';
import { chatRows } from '../chatView';
import { applyMigrations } from '../db';
import {
  USAGE_MIGRATIONS,
  USAGE_SCHEMA_ID,
  byMessage,
  conversationSteps,
  firstStepAt,
  recordStep,
  stepsBetween,
  summarize,
  usageRecorder,
} from '../usage';
import { formatCost, formatInt, formatMs, formatTokensShort, formatTpm } from '../usageFormat';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

function metrics(over: Partial<StepMetrics> = {}): StepMetrics {
  return {
    ...failedStepMetrics({ callId: 'call-1', stepNumber: 0, provider: 'openrouter', modelId: 'google/gemini-2.5-flash' }, '', 1000),
    error: null,
    finishReason: 'stop',
    inputTokens: 1000,
    outputTokens: 100,
    totalTokens: 1100,
    ...over,
  };
}

let db: SQLiteDatabase;
beforeEach(async () => {
  db = openTestDb();
  await db.execAsync('CREATE TABLE plugin_schema (id TEXT PRIMARY KEY, version INTEGER NOT NULL)');
  await applyMigrations(db, CHAT_SCHEMA_ID, CHAT_MIGRATIONS);
  await applyMigrations(db, USAGE_SCHEMA_ID, USAGE_MIGRATIONS);
});

describe('usage store', () => {
  it('stores every metric of a step and reads it back', async () => {
    const m = metrics({
      upstreamProvider: 'Google AI Studio',
      cacheReadTokens: 400,
      cost: 0.0021,
      chunkGapMs: { min: 2, p10: 5, median: 18, avg: 20, p90: 41, max: 90 },
      toolMs: { c1: 38 },
      usageRaw: { cost: 0.0021 },
      providerMetadata: { openrouter: { provider: 'Google AI Studio' } },
    });
    await recordStep(db, { source: 'chat', conversationId: 7, messageId: 9 }, m, 1000);
    const [s] = await conversationSteps(db, 7);
    expect(s).toMatchObject({ ...m, source: 'chat', conversationId: 7, messageId: 9, createdAt: 1000 });
  });

  it('keeps usage when its conversation is deleted', async () => {
    const c = await createConversation(db, { title: 'Mercado', origin: 'app' });
    await recordStep(db, { source: 'chat', conversationId: c.id }, metrics(), 1000);
    await deleteConversation(db, c.id);
    expect(await stepsBetween(db, 0, 2000)).toHaveLength(1);
    expect(await firstStepAt(db)).toBe(1000);
  });

  it('records the steps of a run in order and waits for them on flush', async () => {
    const rec = usageRecorder(db, { source: 'routine' }, () => 5);
    rec.onStep(metrics({ stepNumber: 0 }));
    rec.onStep(metrics({ stepNumber: 1 }));
    await rec.flush();
    const steps = await stepsBetween(db, 0, 10);
    expect(steps.map((s) => [s.source, s.stepNumber])).toEqual([
      ['routine', 0],
      ['routine', 1],
    ]);
  });
});

describe('summarize', () => {
  it('adds a reply up over its tool steps', () => {
    const u = summarize([
      metrics({ inputTokens: 3180, outputTokens: 64, totalTokens: 3244, cost: 0.001, stepMs: 900, firstOutputMs: 640, toolMs: { c1: 38 } }),
      metrics({ inputTokens: 3420, outputTokens: 118, totalTokens: 3538, cost: 0.0011, stepMs: 1200, finishReason: 'stop' }),
    ]);
    expect(u).toMatchObject({ steps: 2, inputTokens: 6600, outputTokens: 182, totalTokens: 6782, totalMs: 2100, toolMs: 38, firstOutputMs: 640 });
    expect(u.cost).toBeCloseTo(0.0021);
  });

  it('counts tokens per minute over streaming time only', () => {
    // 60 tokens at 60/s (1 s) and 120 at 30/s (4 s): 180 tokens in 5 s = 2160 per minute.
    const u = summarize([metrics({ outputTokens: 60, outputTokensPerSecond: 60 }), metrics({ outputTokens: 120, outputTokensPerSecond: 30 })]);
    expect(u.tokensPerMinute).toBeCloseTo(2160);
  });

  it('has no cost and no speed when the provider reported none', () => {
    const u = summarize([metrics()]);
    expect(u.cost).toBeNull();
    expect(u.tokensPerMinute).toBeNull();
  });

  it('counts failed steps', () => {
    const u = summarize([metrics(), failedStepMetrics({ callId: 'c', stepNumber: 0, provider: 'openrouter', modelId: 'm' }, 'Sem internet.', 10)]);
    expect(u.failed).toBe(1);
    expect(u.inputTokens).toBe(1000);
  });
});

describe('usage of a chat turn', () => {
  type Part = Parameters<typeof simulateReadableStream>[0]['chunks'][number];
  const usage = {
    inputTokens: { total: 2900, noCache: 2900, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 40, text: 40, reasoning: undefined },
  };
  const step = (body: Part[], reason: 'stop' | 'tool-calls' = 'stop') =>
    [{ type: 'stream-start', warnings: [] }, ...body, { type: 'finish', finishReason: { unified: reason, raw: reason }, usage }] as Part[];
  const text = (deltas: string[]) =>
    [{ type: 'text-start', id: 't' }, ...deltas.map((delta) => ({ type: 'text-delta', id: 't', delta })), { type: 'text-end', id: 't' }] as Part[];
  function scripted(steps: Part[][]) {
    let i = 0;
    return new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: steps[i++] }) as never }) });
  }
  const settings = { apiKey: 'sk-or-test', model: 'autor/modelo', lightModel: 'autor/leve' };
  const summaryTool = {
    name: 'finance.summary',
    description: 'Resumo do mês.',
    parameters: { type: 'object' as const, properties: {} },
    execute: async () => ({ ok: true, reply: 'R$ 2.418,90 no mês.' }),
  };

  it('ties every step to the reply it produced, and shows the line under it', async () => {
    const c = await createConversation(db, { title: 'Quanto gastei', origin: 'app' });
    const model = scripted([
      step([{ type: 'tool-call', toolCallId: 'c1', toolName: 'finance__summary', input: '{}' }], 'tool-calls'),
      step(text(['R$ 2.418,90.'])),
    ]);
    const result = await runPersistedTurn({ db, conversationId: c.id, userText: 'quanto gastei esse mês?', settings, createModel: () => model, tools: [summaryTool] });
    expect(result.status).toBe('done');

    const steps = await conversationSteps(db, c.id);
    expect(steps.map((s) => [s.source, s.messageId, s.stepNumber])).toEqual([
      ['chat', result.messageId, 0],
      ['chat', result.messageId, 1],
    ]);
    expect(Object.keys(steps[0].toolMs)).toEqual(['c1']);

    const perMessage = new Map([...byMessage(steps)].map(([id, list]) => [id, summarize(list)]));
    const rows = chatRows(await loadMessages(db, c.id), null, perMessage);
    expect(rows.at(-1)).toMatchObject({ kind: 'usage', messageId: result.messageId, usage: { inputTokens: 5800, outputTokens: 80 } });
  });

  it('counts a voice turn with its session id', async () => {
    const c = await createConversation(db, { title: 'Voz', origin: 'voice', voiceSessionId: 's1' });
    await runPersistedTurn({
      db,
      conversationId: c.id,
      userText: 'que horas são em Lisboa?',
      settings,
      createModel: () => scripted([step(text(['Meio-dia.']))]),
      source: 'voice',
      voiceSessionId: 's1',
    });
    const [s] = await conversationSteps(db, c.id);
    expect(s).toMatchObject({ source: 'voice', voiceSessionId: 's1' });
  });

  it('counts the light model title under the conversation, with no message', async () => {
    const c = await createConversation(db, { title: 'Quanto gastei', origin: 'app' });
    const light = new MockLanguageModelV4({
      doGenerate: async () => ({ content: [{ type: 'text', text: 'Gastos do mês' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }),
    });
    await titleConversation(db, c, 'quanto gastei?', { status: 'done', reply: 'R$ 2.418,90.' }, { settings, createModel: () => light });
    const [s] = await conversationSteps(db, c.id);
    expect(s).toMatchObject({ source: 'title', messageId: null, inputTokens: 2900 });
  });
});

describe('usage formats', () => {
  it('writes numbers the Brazilian way', () => {
    expect(formatInt(6600)).toBe('6.600');
    expect(formatTokensShort(980)).toBe('980');
    expect(formatTokensShort(61_800)).toBe('61,8 mil');
    expect(formatTokensShort(1_210_000)).toBe('1,21 mi');
    expect(formatCost(0.42)).toBe('US$ 0,42');
    expect(formatCost(0.0021)).toBe('US$ 0,0021');
    expect(formatMs(640)).toBe('640 ms');
    expect(formatMs(2140)).toBe('2,1 s');
    expect(formatTpm(5160)).toBe('5.160 tpm');
  });
});
