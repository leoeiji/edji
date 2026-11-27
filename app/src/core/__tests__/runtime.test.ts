import type { AgentRoutineRun, PendingCommand, PendingRoutineRun, RoutineToolRun } from '../../../modules/edji-assistant';
import { MESSAGES, ROUTINE_INSTRUCTIONS, runAgent } from '@/agent/agent';
import { messagesFor, processPendingCommands, processPendingRoutineRuns, routineReport, WAITING_POLL_MS } from '../runtime';

const mockDb: Record<string, jest.Mock> = {
  execAsync: jest.fn(),
  getFirstAsync: jest.fn(),
  getAllAsync: jest.fn(async () => [] as unknown[]),
  runAsync: jest.fn(async () => ({ changes: 1, lastInsertRowId: 1 })),
  // The finance plugin has migrations; they run against this same fake.
  withExclusiveTransactionAsync: jest.fn(async (fn: (tx: unknown) => Promise<void>): Promise<void> => fn(mockDb)),
};
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));
jest.mock('@/agent/openrouter', () => ({ openRouterModel: jest.fn() }));
jest.mock('@/agent/settings', () => ({ loadModelSettings: jest.fn(async () => ({ apiKey: 'k', model: 'autor/modelo' })) }));
jest.mock('@/agent/agent', () => ({ ...jest.requireActual('@/agent/agent'), runAgent: jest.fn() }));

const mockNative = {
  pendingCommands: jest.fn<Promise<PendingCommand[]>, []>(),
  completeCommand: jest.fn(async () => true),
  pushReply: jest.fn(() => true),
  pushTool: jest.fn(() => true),
  markSaved: jest.fn(() => true),
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

const command = (id: number, text: string): PendingCommand => ({ id, text, createdAt: 0, sessionId: null, history: [] });
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
  const run = (id: number, reply: 'silent' | 'notify' = 'silent'): AgentRoutineRun => ({
    id,
    routineId: 'r1',
    kind: 'ask_agent',
    prompt: 'Registre: Compra aprovada de R$ 45,90 em PADARIA',
    reply,
    firedAt: 0,
  });
  const toolRun = (id: number, tool: string, args: Record<string, unknown>): RoutineToolRun => ({
    id,
    routineId: 'r1',
    kind: 'run_tool',
    tool,
    args,
    firedAt: 0,
  });

  it('calls the plugin tool of a run_tool firing directly, without the model', async () => {
    const firings: PendingRoutineRun[] = [
      toolRun(8, 'finance.add', { amount: 45.9, direction: 'out', description: 'PADARIA X', dedupKey: 'k|1' }),
    ];
    mockNative.pendingRoutineRuns.mockResolvedValueOnce(firings);

    expect(await processPendingRoutineRuns()).toBe(1);
    expect(mockedRunAgent).not.toHaveBeenCalled();
    // The reply quotes the notification, so the run log keeps a generic detail.
    expect(mockNative.completeRoutineRun).toHaveBeenCalledWith(8, 'done', 'finance.add: feito', null);
  });

  it('fails a run_tool firing the tool refuses, so it reaches the failure queue', async () => {
    mockNative.pendingRoutineRuns.mockResolvedValueOnce([toolRun(9, 'finance.add', { amount: null, direction: 'out', description: 'x' })]);
    await processPendingRoutineRuns();
    expect(mockNative.completeRoutineRun).toHaveBeenCalledWith(9, 'failed', 'Valor inválido. Use um número maior que zero, em reais.', null);
  });

  it('blocks a run_tool firing whose plugin is off or whose tool is not a routine action', async () => {
    mockDb.getAllAsync.mockResolvedValueOnce([{ id: 'finance', enabled: 0 }]);
    mockNative.pendingRoutineRuns.mockResolvedValueOnce([toolRun(10, 'finance.add', {})]);
    await processPendingRoutineRuns();
    expect(mockNative.completeRoutineRun).toHaveBeenCalledWith(10, 'blocked', 'finance.add não está disponível (plugin desligado?)', null);

    mockNative.pendingRoutineRuns.mockResolvedValueOnce([toolRun(11, 'finance.summary', {})]);
    await processPendingRoutineRuns();
    expect(mockNative.completeRoutineRun).toHaveBeenCalledWith(11, 'blocked', 'finance.summary não está disponível (plugin desligado?)', null);
  });

  it('runs the queued prompt without the routines tools and with the routine instructions', async () => {
    mockNative.pendingRoutineRuns.mockResolvedValueOnce([run(7, 'notify')]);
    mockedRunAgent.mockResolvedValue({ status: 'done', reply: 'Gasto de R$ 45,90 registrado.' });

    expect(await processPendingRoutineRuns()).toBe(1);
    const input = mockedRunAgent.mock.calls[0][0];
    expect(input.messages).toEqual([{ role: 'user', content: 'Registre: Compra aprovada de R$ 45,90 em PADARIA' }]);
    expect(input.instructions).toBe(ROUTINE_INSTRUCTIONS);
    // Only routine actions: never routines tools, never finance.delete.
    expect(input.tools?.map((t) => t.name)).toEqual(['finance.add']);
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
