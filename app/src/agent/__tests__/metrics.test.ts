import { APICallError, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { MESSAGES, runAgent } from '../agent';
import { generateTitle } from '../light';
import type { StepMetrics } from '../metrics';

type Part = Parameters<typeof simulateReadableStream>[0]['chunks'][number];

const usage = {
  inputTokens: { total: 3100, noCache: 1052, cacheRead: 2048, cacheWrite: undefined },
  outputTokens: { total: 120, text: 100, reasoning: 20 },
  raw: { prompt_tokens: 3100, completion_tokens: 120, cost: 0.0021 },
};
const providerMetadata = {
  openrouter: {
    provider: 'Google AI Studio',
    reasoning_details: [{ type: 'reasoning.text', text: 'pensando sobre o mercado' }],
    usage: { promptTokens: 3100, completionTokens: 120, totalTokens: 3220, cost: 0.0021, costDetails: { upstreamInferenceCost: 0.0019 } },
  },
};

function model(deltas: string[], withMetadata = true) {
  const chunks = [
    { type: 'stream-start', warnings: [] },
    { type: 'response-metadata', id: 'gen-123', modelId: 'google/gemini-2.5-flash', timestamp: new Date(0) },
    { type: 'text-start', id: 't' },
    ...deltas.map((delta) => ({ type: 'text-delta', id: 't', delta })),
    { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage, ...(withMetadata ? { providerMetadata } : {}) },
  ] as Part[];
  return new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks }) as never }) });
}

const settings = { apiKey: 'sk-or-test', model: 'google/gemini-2.5-flash' };

describe('step metrics', () => {
  it('reports tokens, cost, upstream provider and timing of each step', async () => {
    const steps: StepMetrics[] = [];
    const result = await runAgent({
      messages: [{ role: 'user', content: 'quanto gastei com mercado?' }],
      settings,
      createModel: () => model(['R$ 812 ', 'no mercado.']),
      onStep: (m) => steps.push(m),
    });
    expect(result.status).toBe('done');
    expect(steps).toHaveLength(1);
    const [m] = steps;
    expect(m).toMatchObject({
      stepNumber: 0,
      responseModel: 'google/gemini-2.5-flash',
      upstreamProvider: 'Google AI Studio',
      responseId: 'gen-123',
      finishReason: 'stop',
      inputTokens: 3100,
      inputNoCacheTokens: 1052,
      cacheReadTokens: 2048,
      outputTokens: 120,
      outputTextTokens: 100,
      reasoningTokens: 20,
      totalTokens: 3220,
      cost: 0.0021,
      upstreamCost: 0.0019,
      error: null,
    });
    expect(m.usageRaw).toEqual(usage.raw);
    expect(typeof m.stepMs).toBe('number');
    expect(typeof m.firstOutputMs).toBe('number');
  });

  it('drops reasoning text from the stored provider metadata', async () => {
    const steps: StepMetrics[] = [];
    await runAgent({ messages: [{ role: 'user', content: 'oi' }], settings, createModel: () => model(['Oi.']), onStep: (m) => steps.push(m) });
    expect(JSON.stringify(steps[0].providerMetadata)).not.toContain('pensando');
    expect(steps[0].providerMetadata).toMatchObject({ openrouter: { provider: 'Google AI Studio' } });
  });

  it('leaves provider-specific fields empty when the provider does not send them', async () => {
    const steps: StepMetrics[] = [];
    await runAgent({ messages: [{ role: 'user', content: 'oi' }], settings, createModel: () => model(['Oi.'], false), onStep: (m) => steps.push(m) });
    expect(steps[0]).toMatchObject({ upstreamProvider: null, cost: null, inputTokens: 3100 });
  });

  it('reports a failed step with our short message, never the provider text', async () => {
    const steps: StepMetrics[] = [];
    const failing = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({ message: 'chave sk-or-secreta inválida', url: 'x', requestBodyValues: {}, statusCode: 401, isRetryable: false });
      },
    });
    const result = await runAgent({ messages: [{ role: 'user', content: 'oi' }], settings, createModel: () => failing, onStep: (m) => steps.push(m) });
    expect(result.status).toBe('setup');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ error: MESSAGES.badKey, finishReason: 'error', inputTokens: null });
  });

  it('never lets a metrics bug break the reply', async () => {
    const result = await runAgent({
      messages: [{ role: 'user', content: 'oi' }],
      settings,
      createModel: () => model(['Oi.']),
      onStep: () => {
        throw new Error('falhou ao gravar');
      },
    });
    expect(result).toEqual({ status: 'done', reply: 'Oi.' });
  });

  it('reports the light model call too', async () => {
    const steps: StepMetrics[] = [];
    const light = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'Gastos com mercado' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: [],
        providerMetadata,
      }),
    });
    const title = await generateTitle('quanto gastei com mercado?', 'R$ 812.', {
      settings: { apiKey: 'sk-or-test', lightModel: 'google/gemini-2.5-flash-lite' },
      createModel: () => light,
      onStep: (m) => steps.push(m),
    });
    expect(title).toBe('Gastos com mercado');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ outputTokens: 120, cost: 0.0021 });
  });
});
