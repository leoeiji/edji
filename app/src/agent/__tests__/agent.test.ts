import { APICallError, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { INSTRUCTIONS, MESSAGES, describeError, runAgent, type ChatMessage } from '../agent';

type Part = Parameters<typeof simulateReadableStream>[0]['chunks'][number];

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function textModel(deltas: string[]) {
  const chunks = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't' },
    ...deltas.map((delta) => ({ type: 'text-delta', id: 't', delta })),
    { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
  ] as Part[];
  return new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks }) as never }) });
}

function failingModel(error: unknown) {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw error;
    },
  });
}

const settings = { apiKey: 'sk-or-test', model: 'autor/modelo' };
const ask = (content: string): ChatMessage[] => [{ role: 'user', content }];

describe('runAgent', () => {
  it('streams the reply so far, in order, and returns the whole text', async () => {
    const model = textModel(['O biológico ', 'usa leveduras', ' vivas.']);
    const seen: string[] = [];
    const result = await runAgent({
      messages: ask('qual a diferença entre fermento químico e biológico?'),
      settings,
      createModel: () => model,
      onText: (t) => seen.push(t),
    });
    expect(seen).toEqual(['O biológico ', 'O biológico usa leveduras', 'O biológico usa leveduras vivas.']);
    expect(result).toEqual({ status: 'done', reply: 'O biológico usa leveduras vivas.' });
  });

  it('sends the instructions and the earlier turns of the session', async () => {
    const model = textModel(['O biológico.']);
    const messages: ChatMessage[] = [
      { role: 'user', content: 'qual a diferença entre fermento químico e biológico?' },
      { role: 'assistant', content: 'O biológico usa leveduras vivas.' },
      { role: 'user', content: 'e pra pão de forma qual eu uso?' },
    ];
    await runAgent({ messages, settings, createModel: () => model });

    const prompt = model.doStreamCalls[0].prompt;
    expect(prompt[0]).toEqual({ role: 'system', content: INSTRUCTIONS });
    const turns = prompt.slice(1).map((m) => ({
      role: m.role,
      content: (m.content as { type: string; text: string }[]).map((p) => p.text).join(''),
    }));
    expect(turns).toEqual(messages);
  });

  it('passes the key and the model id to the provider', async () => {
    const createModel = jest.fn(() => textModel(['Oi.']));
    await runAgent({ messages: ask('oi'), settings, createModel });
    expect(createModel).toHaveBeenCalledWith('sk-or-test', 'autor/modelo');
  });

  it('never builds a model without a key or a model id', async () => {
    const createModel = jest.fn(() => textModel(['nunca']));
    expect(await runAgent({ messages: ask('oi'), settings: { apiKey: null, model: 'a/b' }, createModel })).toEqual({
      status: 'setup',
      reply: MESSAGES.noKey,
    });
    expect(await runAgent({ messages: ask('oi'), settings: { apiKey: 'k', model: null }, createModel })).toEqual({
      status: 'setup',
      reply: MESSAGES.noModel,
    });
    expect(createModel).not.toHaveBeenCalled();
  });

  it('reports an empty answer instead of showing nothing', async () => {
    const result = await runAgent({ messages: ask('oi'), settings, createModel: () => textModel(['  ']) });
    expect(result).toEqual({ status: 'failed', reply: MESSAGES.empty });
  });

  it('stops and reports cancelled when the session closes mid-reply', async () => {
    const controller = new AbortController();
    const model = textModel(['Primeira parte. ', 'Segunda parte.', ' Terceira.']);
    const result = await runAgent({
      messages: ask('me explica com calma'),
      settings,
      createModel: () => model,
      signal: controller.signal,
      onText: () => controller.abort(),
    });
    expect(result.status).toBe('cancelled');
  });

  it('turns provider errors into short messages', async () => {
    const error = new APICallError({ message: 'unauthorized', url: 'u', requestBodyValues: {}, statusCode: 401, isRetryable: false });
    const result = await runAgent({ messages: ask('oi'), settings, createModel: () => failingModel(error) });
    expect(result).toEqual({ status: 'setup', reply: MESSAGES.badKey });
  });
});

describe('describeError', () => {
  const api = (statusCode: number) =>
    new APICallError({ message: 'x', url: 'u', requestBodyValues: {}, statusCode, isRetryable: false });

  it.each([
    [401, 'setup', MESSAGES.badKey],
    [402, 'failed', MESSAGES.noCredits],
    [404, 'setup', MESSAGES.unknownModel],
    [429, 'failed', MESSAGES.rateLimited],
    [500, 'failed', MESSAGES.failed],
  ])('HTTP %i → %s', (code, status, reply) => {
    expect(describeError(api(code))).toEqual({ status, reply });
  });

  it('looks inside retry wrappers', () => {
    expect(describeError({ lastError: api(404) })).toEqual({ status: 'setup', reply: MESSAGES.unknownModel });
  });

  it('recognizes a missing connection', () => {
    expect(describeError(new TypeError('Network request failed'))).toEqual({ status: 'failed', reply: MESSAGES.offline });
  });

  it('never puts the key in the message', () => {
    const error = new Error('bad key sk-or-test');
    expect(describeError(error).reply).not.toContain('sk-or');
  });
});
