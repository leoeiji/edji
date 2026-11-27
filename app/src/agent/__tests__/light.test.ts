import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { cleanTitle, fallbackTitle, generateTitle, runLight } from '../light';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function answering(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    }),
    doStream: async () => ({ stream: simulateReadableStream({ chunks: [] }) as never }),
  });
}

const settings = { apiKey: 'sk-or-test', lightModel: 'autor/leve' };

describe('runLight', () => {
  it('never builds a model without a key or a light model', async () => {
    const createModel = jest.fn(() => answering('nunca'));
    expect(await runLight({ settings: { apiKey: 'k', lightModel: null }, createModel }, 'i', 'p')).toBeNull();
    expect(await runLight({ settings: { apiKey: null, lightModel: 'a/b' }, createModel }, 'i', 'p')).toBeNull();
    expect(createModel).not.toHaveBeenCalled();
  });

  it('uses the light model, not the conversation one', async () => {
    const createModel = jest.fn(() => answering('ok'));
    await runLight({ settings, createModel }, 'i', 'p');
    expect(createModel).toHaveBeenCalledWith('sk-or-test', 'autor/leve');
  });

  it('turns a failure into null', async () => {
    const failing = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('offline');
      },
    });
    expect(await runLight({ settings, createModel: () => failing }, 'i', 'p')).toBeNull();
  });
});

describe('generateTitle', () => {
  it('cleans what the model sends back', async () => {
    const title = await generateTitle('quanto gastei com mercado?', 'R$ 842,30.', {
      settings,
      createModel: () => answering('"Gastos com mercado em novembro."'),
    });
    expect(title).toBe('Gastos com mercado em novembro');
  });
});

describe('cleanTitle', () => {
  it('keeps the first line, drops quotes, labels and the final period, and caps the words', () => {
    expect(cleanTitle('Título: “rotina do spotify no carro”.\nOutra linha')).toBe('Rotina do spotify no carro');
    expect(cleanTitle('um dois três quatro cinco seis sete oito')).toBe('Um dois três quatro cinco seis');
    expect(cleanTitle('  "" ')).toBeNull();
  });
});

describe('fallbackTitle', () => {
  it('uses the first words of the request, with an ellipsis when cut', () => {
    expect(fallbackTitle('registra 38 reais de padaria')).toBe('Registra 38 reais de padaria');
    expect(fallbackTitle('quero uma rotina pro spotify quando eu entrar no carro')).toBe('Quero uma rotina pro spotify quando…');
    expect(fallbackTitle('   ')).toBe('Conversa');
  });
});
