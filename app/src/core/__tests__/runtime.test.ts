import type { PendingCommand } from '../../../modules/edji-assistant';
import { runAgent } from '../agent';
import { messagesFor, processPendingCommands, WAITING_POLL_MS } from '../runtime';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => ({ execAsync: jest.fn(), getFirstAsync: jest.fn() })) }));
jest.mock('../openrouter', () => ({ openRouterModel: jest.fn() }));
jest.mock('../settings', () => ({ loadModelSettings: jest.fn(async () => ({ apiKey: 'k', model: 'autor/modelo' })) }));
jest.mock('../agent', () => ({ runAgent: jest.fn() }));

const mockNative = {
  pendingCommands: jest.fn<Promise<PendingCommand[]>, []>(),
  completeCommand: jest.fn(async () => true),
  pushReply: jest.fn(() => true),
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
