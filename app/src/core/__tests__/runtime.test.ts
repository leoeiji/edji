import type { PendingCommand, PendingRoutineRun } from '../../../modules/edji-assistant';
import { MESSAGES, ROUTINE_INSTRUCTIONS, runAgent } from '@/agent/agent';
import { messagesFor, processPendingCommands, processPendingRoutineRuns, routineReport, WAITING_POLL_MS } from '../runtime';

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => ({ execAsync: jest.fn(), getFirstAsync: jest.fn(), getAllAsync: jest.fn(async () => []) })),
}));
jest.mock('@/agent/openrouter', () => ({ openRouterModel: jest.fn() }));
jest.mock('@/agent/settings', () => ({ loadModelSettings: jest.fn(async () => ({ apiKey: 'k', model: 'autor/modelo' })) }));
jest.mock('@/agent/agent', () => ({ ...jest.requireActual('@/agent/agent'), runAgent: jest.fn() }));

const mockNative = {
  pendingCommands: jest.fn<Promise<PendingCommand[]>, []>(),
  completeCommand: jest.fn(async () => true),
  pushReply: jest.fn(() => true),
  isWaiting: jest.fn(() => true),
  heartbeat: jest.fn(() => true),
  log: jest.fn(),
  pendingRoutineRuns: jest.fn<Promise<PendingRoutineRun[]>, []>(),
  completeRoutineRun: jest.fn(async () => true),
};
jest.mock('../../../modules/edji-assistant', () => ({
  get EdjiAssistant() {
    return mockNative;
  },
  assistantLog: jest.fn(),
}));

const command = (id: number, text: string): PendingCommand => ({ id, text, createdAt: 0, history: [] });
const mockedRunAgent = runAgent as jest.MockedFunction<typeof runAgent>;

beforeEach(() => {
  jest.clearAllMocks();
  mockNative.isWaiting.mockReturnValue(true);
});

describe('processPendingCommands', () => {
  it('answers a command stored while an earlier one was running', async () => {
    mockNative.pendingCommands
      .mockResolvedValueOnce([command(1, 'oi')])
      .mockResolvedValueOnce([command(2, 'e agora?')])
      .mockResolvedValueOnce([]);
    mockedRunAgent.mockResolvedValue({ status: 'done', reply: 'Oi.' });

    expect(await processPendingCommands()).toBe(2);
    expect(mockNative.completeCommand.mock.calls.map((c) => (c as unknown[])[0])).toEqual([1, 2]);
  });

  it('aborts when the session stops waiting, even if the model sends nothing', async () => {
    jest.useFakeTimers();
    mockNative.pendingCommands.mockResolvedValueOnce([command(1, 'oi')]).mockResolvedValueOnce([]);
    mockedRunAgent.mockImplementation(
      ({ signal }) =>
        new Promise((resolve) => signal!.addEventListener('abort', () => resolve({ status: 'cancelled', reply: '' }))),
    );

    const done = processPendingCommands();
    await jest.advanceTimersByTimeAsync(WAITING_POLL_MS);
    expect(mockNative.completeCommand).not.toHaveBeenCalled();
    mockNative.isWaiting.mockReturnValue(false);
    await jest.advanceTimersByTimeAsync(WAITING_POLL_MS);
    await done;
    expect(mockNative.completeCommand).toHaveBeenCalledWith(1, 'cancelled', '');
    jest.useRealTimers();
  });

  it('stops streaming once the session no longer takes the reply', async () => {
    mockNative.pendingCommands.mockResolvedValueOnce([command(1, 'oi')]).mockResolvedValueOnce([]);
    mockNative.pushReply.mockReturnValueOnce(false);
    let aborted = false;
    mockedRunAgent.mockImplementation(async ({ onText, signal }) => {
      onText?.('Oi');
      aborted = signal!.aborted;
      return { status: 'cancelled', reply: 'Oi' };
    });
    await processPendingCommands();
    expect(aborted).toBe(true);
  });
});

describe('messagesFor', () => {
  it('puts the new transcript after the session history', () => {
    const history = [
      { role: 'user' as const, content: 'qual a capital do Peru?' },
      { role: 'assistant' as const, content: 'Lima.' },
    ];
    expect(messagesFor({ text: 'e da Bolívia?', history })).toEqual([...history, { role: 'user', content: 'e da Bolívia?' }]);
  });
});

describe('agent tools', () => {
  it('offers the tools of the enabled plugins in voice commands', async () => {
    mockNative.pendingCommands.mockResolvedValueOnce([command(1, 'quais rotinas eu tenho?')]).mockResolvedValueOnce([]);
    mockedRunAgent.mockResolvedValue({ status: 'done', reply: 'Nenhuma.' });
    await processPendingCommands();
    expect(mockedRunAgent.mock.calls[0][0].tools?.map((t) => t.name)).toContain('routines.create');
  });
});

describe('processPendingRoutineRuns', () => {
  const run = (id: number, reply: 'silent' | 'notify' = 'silent'): PendingRoutineRun => ({
    id,
    routineId: 'r1',
    prompt: 'Registre: Compra aprovada de R$ 45,90 em PADARIA',
    reply,
    firedAt: 0,
  });

  it('runs the queued prompt without the routines tools and with the routine instructions', async () => {
    mockNative.pendingRoutineRuns.mockResolvedValueOnce([run(7, 'notify')]);
    mockedRunAgent.mockResolvedValue({ status: 'done', reply: 'Gasto de R$ 45,90 registrado.' });

    expect(await processPendingRoutineRuns()).toBe(1);
    const input = mockedRunAgent.mock.calls[0][0];
    expect(input.messages).toEqual([{ role: 'user', content: 'Registre: Compra aprovada de R$ 45,90 em PADARIA' }]);
    expect(input.instructions).toBe(ROUTINE_INSTRUCTIONS);
    expect(input.tools?.some((t) => t.name.startsWith('routines.'))).toBe(false);
    expect(mockNative.completeRoutineRun).toHaveBeenCalledWith(7, 'done', 'Agente respondeu', 'Gasto de R$ 45,90 registrado.');
  });

  it('does nothing when the queue is empty', async () => {
    mockNative.pendingRoutineRuns.mockResolvedValueOnce([]);
    expect(await processPendingRoutineRuns()).toBe(0);
    expect(mockedRunAgent).not.toHaveBeenCalled();
  });
});

describe('routineReport', () => {
  it('retries without network and never logs the reply', () => {
    expect(routineReport({ reply: 'silent' }, { status: 'failed', reply: MESSAGES.offline })).toEqual({
      outcome: 'retry',
      detail: MESSAGES.offline,
      notifyText: null,
    });
    expect(routineReport({ reply: 'silent' }, { status: 'done', reply: 'Gasto registrado: PADARIA' })).toEqual({
      outcome: 'done',
      detail: 'Agente respondeu',
      notifyText: null,
    });
  });

  it('blocks when the key or model is missing and fails on other errors', () => {
    expect(routineReport({ reply: 'notify' }, { status: 'setup', reply: MESSAGES.noKey }).outcome).toBe('blocked');
    expect(routineReport({ reply: 'notify' }, { status: 'failed', reply: MESSAGES.noCredits }).outcome).toBe('failed');
  });
});
