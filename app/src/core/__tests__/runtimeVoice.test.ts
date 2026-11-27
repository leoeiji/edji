import { simulateReadableStream } from 'ai';
import type { PendingCommand } from '../../../modules/edji-assistant';
import { listConversations, loadMessages, SAVE_VOICE_SETTING, setSetting } from '../chatStore';
import { getDb } from '../db';
import { processPendingCommands } from '../runtime';

type Part = Parameters<typeof simulateReadableStream>[0]['chunks'][number];
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const step = (body: Part[], reason: 'stop' | 'tool-calls' = 'stop') =>
  [{ type: 'stream-start', warnings: [] }, ...body, { type: 'finish', finishReason: { unified: reason, raw: reason }, usage }] as Part[];
const say = (s: string) => [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: s }, { type: 'text-end', id: 't' }] as Part[];

let mockSteps: Part[][] = [];
let mockPrompts: unknown[] = [];

jest.mock('expo-sqlite', () => {
  const { openTestDb: open } = jest.requireActual('@/testing/nodeSqlite');
  const db = open();
  return { openDatabaseAsync: jest.fn(async () => db) };
});
jest.mock('@/agent/settings', () => ({ loadModelSettings: jest.fn(async () => ({ apiKey: 'k', model: 'autor/modelo', lightModel: null })) }));
jest.mock('@/agent/openrouter', () => {
  const { simulateReadableStream: simulate } = jest.requireActual('ai');
  const { MockLanguageModelV4: Mock } = jest.requireActual('ai/test');
  return {
    openRouterModel: jest.fn(
      () =>
        new Mock({
          doStream: async (options: { prompt: unknown }) => {
            mockPrompts.push(options.prompt);
            return { stream: simulate({ chunks: mockSteps.shift() ?? [] }) };
          },
        }),
    ),
  };
});

const mockNative = {
  pendingCommands: jest.fn<Promise<PendingCommand[]>, []>(),
  completeCommand: jest.fn(async () => true),
  pushReply: jest.fn(() => true),
  pushTool: jest.fn(() => true),
  isWaiting: jest.fn(() => true),
  heartbeat: jest.fn(() => true),
  log: jest.fn(),
};
jest.mock('../../../modules/edji-assistant', () => ({
  get EdjiAssistant() {
    return mockNative;
  },
  assistantLog: jest.fn(),
}));

const voice = (id: number, text: string, sessionId = 's-1'): PendingCommand => ({ id, text, createdAt: 0, sessionId, history: [] });

beforeEach(async () => {
  jest.clearAllMocks();
  mockSteps = [];
  mockPrompts = [];
  const db = await getDb();
  await db.execAsync('DELETE FROM chat_conversations').catch(() => {});
  await db.execAsync('DELETE FROM app_settings').catch(() => {});
});

describe('voice commands with saving on', () => {
  it('store the session as a voice conversation and send its history on the next turn', async () => {
    mockSteps = [step(say('R$ 842,30.')), step(say('Em outubro foram R$ 751,10.'))];
    mockNative.pendingCommands
      .mockResolvedValueOnce([voice(1, 'quanto gastei com mercado?')])
      .mockResolvedValueOnce([voice(2, 'e em outubro?')])
      .mockResolvedValueOnce([]);

    await processPendingCommands();

    const [conversation] = await listConversations(await getDb());
    expect(conversation).toMatchObject({ origin: 'voice', voiceSessionId: 's-1', title: 'Quanto gastei com mercado', titleStatus: 'local' });
    expect(await loadMessages(await getDb(), conversation.id)).toHaveLength(4);
    expect(JSON.stringify(mockPrompts[1])).toContain('R$ 842,30.');
    expect(mockNative.completeCommand).toHaveBeenLastCalledWith(2, 'done', 'Em outubro foram R$ 751,10.');
  });

  it('shows each tool call in the session with its Portuguese label', async () => {
    mockSteps = [
      step([{ type: 'tool-call', toolCallId: 'c1', toolName: 'finance__summary', input: '{}' }] as Part[], 'tool-calls'),
      step(say('R$ 842,30.')),
    ];
    mockNative.pendingCommands.mockResolvedValueOnce([voice(1, 'quanto gastei?')]).mockResolvedValueOnce([]);
    await processPendingCommands();
    expect(mockNative.pushTool.mock.calls.map((c) => (c as unknown[]).slice(1))).toEqual([
      ['c1', 'Finanças · Resumo do mês', 'running'],
      ['c1', 'Finanças · Resumo do mês', 'done'],
    ]);
  });
});

describe('voice commands with saving off', () => {
  it('store nothing and use the session history, as before', async () => {
    await setSetting(await getDb(), SAVE_VOICE_SETTING, '0');
    mockSteps = [step(say('Oi.'))];
    mockNative.pendingCommands
      .mockResolvedValueOnce([{ ...voice(1, 'e agora?'), history: [{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'Olá.' }] }])
      .mockResolvedValueOnce([]);
    await processPendingCommands();
    expect(await listConversations(await getDb())).toEqual([]);
    expect(JSON.stringify(mockPrompts[0])).toContain('Olá.');
  });
});
