import { APICallError, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import {
  CHAT_INSTRUCTIONS,
  INSTRUCTIONS,
  INTERRUPTED_TOOL,
  MESSAGES,
  describeError,
  runAgent,
  toModelMessages,
  type ChatMessage,
  type ToolEvent,
} from '../agent';

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

  it('calls a plugin tool and then answers with what it returned', async () => {
    const steps: Part[][] = [
      [
        { type: 'stream-start', warnings: [] },
        { type: 'tool-call', toolCallId: 'c1', toolName: 'routines__set_enabled', input: '{"id":"r1","enabled":false}' },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
      ] as Part[],
      [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'Desativei a rotina do carro.' },
        { type: 'text-end', id: 't' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
      ] as Part[],
    ];
    let step = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => ({ stream: simulateReadableStream({ chunks: steps[step++] }) as never }),
    });
    const execute = jest.fn(async () => ({ ok: true, reply: 'Rotina "Spotify no carro" desativada.' }));
    const result = await runAgent({
      messages: ask('desativa a rotina do carro'),
      settings,
      createModel: () => model,
      tools: [
        {
          name: 'routines.set_enabled',
          description: 'Ativa ou desativa uma rotina.',
          parameters: { type: 'object', properties: { id: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['id', 'enabled'] },
          execute,
        },
      ],
    });

    expect(execute).toHaveBeenCalledWith({ id: 'r1', enabled: false });
    expect(result).toEqual({ status: 'done', reply: 'Desativei a rotina do carro.' });
    expect(model.doStreamCalls[0].tools?.map((t) => t.name)).toEqual(['routines__set_enabled']);
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain('Rotina \\"Spotify no carro\\" desativada.');
  });

  it('offers no tools when none are given', async () => {
    const model = textModel(['Oi.']);
    await runAgent({ messages: ask('oi'), settings, createModel: () => model, tools: [] });
    expect(model.doStreamCalls[0].tools).toBeUndefined();
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

/** A model that calls `finance__add` once, then answers. */
function toolThenTextModel(reply: string) {
  const steps = [
    [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'finance__add', input: '{"amount":38,"description":"Padaria"}' },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
    ] as Part[],
    [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: reply },
      { type: 'text-end', id: 't' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
    ] as Part[],
  ];
  let step = 0;
  return new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: steps[step++] }) as never }) });
}

const addTool = (execute: () => Promise<{ ok: boolean; reply: string }>) => ({
  name: 'finance.add',
  description: 'Registra um gasto.',
  parameters: { type: 'object' as const, properties: { amount: { type: 'number' as const }, description: { type: 'string' as const } } },
  execute,
});

describe('tool events', () => {
  it('reports each call as running, then done, with the plugin name and the input', async () => {
    const events: ToolEvent[] = [];
    await runAgent({
      messages: ask('registra 38 reais de padaria'),
      settings,
      createModel: () => toolThenTextModel('Anotado.'),
      tools: [addTool(async () => ({ ok: true, reply: 'Anotado: R$ 38,00, Padaria.' }))],
      onToolEvent: (e) => events.push(e),
    });
    expect(events.map((e) => [e.id, e.name, e.state])).toEqual([
      ['c1', 'finance.add', 'running'],
      ['c1', 'finance.add', 'done'],
    ]);
    expect(events[0].input).toEqual({ amount: 38, description: 'Padaria' });
    expect(events[1].output).toBe('Anotado: R$ 38,00, Padaria.');
    expect(events[1].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('marks the call failed when the handler says so or throws, while the model still gets a reply', async () => {
    for (const execute of [
      async () => ({ ok: false, reply: 'Valor inválido.' }),
      async (): Promise<{ ok: boolean; reply: string }> => {
        throw new Error('boom');
      },
    ]) {
      const events: ToolEvent[] = [];
      const result = await runAgent({
        messages: ask('registra padaria'),
        settings,
        createModel: () => toolThenTextModel('Não consegui registrar.'),
        tools: [addTool(execute)],
        onToolEvent: (e) => events.push(e),
      });
      expect(events.at(-1)?.state).toBe('failed');
      expect(result.status).toBe('done');
    }
  });
});

describe('toModelMessages with attachments', () => {
  it('puts the files before the text and turns each kind into the right part', () => {
    const out = toModelMessages([
      {
        role: 'user',
        content: 'lança esses gastos',
        attachments: [
          { type: 'image', name: 'cupom.jpg', mime: 'image/jpeg', data: 'AAA' },
          { type: 'pdf', name: 'fatura.pdf', mime: 'application/pdf', data: 'BBB' },
          { type: 'text', name: 'gastos.csv', text: 'padaria,38' },
          { type: 'omitted', name: 'antigo.png' },
        ],
      },
    ]);
    expect(out).toEqual([
      {
        role: 'user',
        content: [
          { type: 'file', data: 'AAA', mediaType: 'image/jpeg' },
          { type: 'file', data: 'BBB', mediaType: 'application/pdf', filename: 'fatura.pdf' },
          { type: 'text', text: '[Arquivo: gastos.csv]\npadaria,38' },
          { type: 'text', text: '[Anexo enviado antes: antigo.png]' },
          { type: 'text', text: 'lança esses gastos' },
        ],
      },
    ]);
  });

  it('sends only the files when the message has no text', () => {
    const out = toModelMessages([{ role: 'user', content: '', attachments: [{ type: 'image', name: 'a.jpg', mime: 'image/jpeg', data: 'AAA' }] }]);
    expect(out).toEqual([{ role: 'user', content: [{ type: 'file', data: 'AAA', mediaType: 'image/jpeg' }] }]);
  });
});

describe('toModelMessages', () => {
  it('replays a turn with tools as call and result pairs, step by step', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'registra 38 de padaria' },
      {
        role: 'assistant',
        content: 'Vou registrar. Anotado.',
        parts: [
          { type: 'text', text: 'Vou registrar.' },
          { type: 'tool', id: 'c1', name: 'finance.add', input: { amount: 38 }, state: 'done', output: 'Anotado.' },
          { type: 'text', text: 'Anotado.' },
        ],
      },
    ];
    expect(toModelMessages(history)).toEqual([
      { role: 'user', content: 'registra 38 de padaria' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Vou registrar.' },
          { type: 'tool-call', toolCallId: 'c1', toolName: 'finance__add', input: { amount: 38 } },
        ],
      },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'finance__add', output: { type: 'text', value: 'Anotado.' } }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Anotado.' }] },
    ]);
  });

  it('gives a cut-off call a result, so the pair stays complete', () => {
    const out = toModelMessages([
      { role: 'user', content: 'apaga o último gasto' },
      { role: 'assistant', content: '', parts: [{ type: 'tool', id: 'c9', name: 'finance.delete', input: {}, state: 'running' }] },
    ]);
    expect(JSON.stringify(out)).toContain(INTERRUPTED_TOOL);
  });

  it('sends only the text when no tools are on offer', () => {
    const out = toModelMessages(
      [
        { role: 'user', content: 'registra 38' },
        {
          role: 'assistant',
          content: 'Anotado.',
          parts: [
            { type: 'tool', id: 'c1', name: 'finance.add', input: {}, state: 'done', output: 'ok' },
            { type: 'text', text: 'Anotado.' },
          ],
        },
      ],
      { withTools: false },
    );
    expect(out).toEqual([
      { role: 'user', content: 'registra 38' },
      { role: 'assistant', content: 'Anotado.' },
    ]);
  });

  it('keeps plain turns as text', () => {
    expect(toModelMessages([{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'Oi.' }])).toEqual([
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'Oi.' },
    ]);
  });
});

describe('CHAT_INSTRUCTIONS', () => {
  it('drops the voice-only rules but keeps the tone', () => {
    expect(CHAT_INSTRUCTIONS).not.toContain('reconhecimento de voz');
    expect(INSTRUCTIONS).toContain('reconhecimento de voz');
    expect(CHAT_INSTRUCTIONS).toContain('português do Brasil');
  });
});
