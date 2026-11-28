import { failedStepMetrics } from '@/agent/metrics';
import type { UsageStep } from '@/core/usage';
import { quantile, tokensPhrase, usageStory } from '../insights';

let nextId = 1;
function step(day: number, over: Partial<UsageStep> = {}, month = 11): UsageStep {
  return {
    ...failedStepMetrics({ callId: `call-${nextId}`, stepNumber: 0, provider: 'openrouter', modelId: 'google/gemini-2.5-flash' }, '', 1000),
    error: null,
    finishReason: 'stop',
    inputTokens: 1000,
    outputTokens: 50,
    totalTokens: 1050,
    id: nextId++,
    createdAt: new Date(2026, month - 1, day, 12).getTime(),
    source: 'chat',
    conversationId: 1,
    messageId: null,
    voiceSessionId: null,
    ...over,
  };
}

const base = { year: 2026, month: 11, titles: new Map([[1, 'Gastos do mês'], [2, 'Rotina do banco']]) };

describe('usageStory', () => {
  it('compares with the same days of last month while the month runs', () => {
    const story = usageStory({
      ...base,
      steps: [step(3), step(10)],
      previous: [step(2, {}, 10), step(25, {}, 10)], // day 25 is after today (the 10th): left out
      throughDay: 10,
    });
    expect(story.headline).toBe('2.100 tokens, 100% a mais que em outubro até o dia 10.');
  });

  it('compares whole months once the month is over', () => {
    const story = usageStory({ ...base, steps: [step(3)], previous: [step(2, {}, 10), step(25, {}, 10)], throughDay: null });
    expect(story.headline).toBe('1.050 tokens, 50% a menos que em outubro.');
  });

  it('says so when nothing was used', () => {
    const story = usageStory({ ...base, steps: [], previous: [], throughDay: 28 });
    expect(story.headline).toBe('Nenhum token usado neste mês.');
    expect(story.sub).toBeNull();
    expect(story.peak).toBeNull();
  });

  it('stacks each day as fresh input, cached input and output, and finds the peak', () => {
    const story = usageStory({
      ...base,
      steps: [step(5, { inputTokens: 1000, cacheReadTokens: 400, outputTokens: 50 }), step(21, { inputTokens: 5000, outputTokens: 200, totalTokens: 5200 })],
      previous: [],
      throughDay: 28,
    });
    expect(story.days).toHaveLength(30);
    expect(story.days[4]).toEqual({ day: 5, fresh: 600, cache: 400, output: 50 });
    expect(story.peak).toEqual({ day: 21, tokens: 5200 });
    expect(story.cacheShare).toBeCloseTo(400 / 6000);
  });

  it('splits tokens by source, conversations and routines', () => {
    const story = usageStory({
      ...base,
      steps: [
        step(1, { totalTokens: 600 }),
        step(1, { source: 'voice', conversationId: null, totalTokens: 300 }),
        step(2, { source: 'routine', conversationId: null, callId: 'r1', totalTokens: 100 }),
      ],
      previous: [],
      throughDay: 28,
    });
    expect(story.sources.map((s) => [s.source, s.share])).toEqual([
      ['chat', 0.6],
      ['voice', 0.3],
      ['routine', 0.1],
    ]);
    expect(story.sub).toBe('3 pedidos ao modelo em 1 conversa e 1 rotina.');
  });

  it('lists models with the upstream providers that served them', () => {
    const story = usageStory({
      ...base,
      steps: [
        step(1, { upstreamProvider: 'Google AI Studio', cost: 0.002 }),
        step(1, { upstreamProvider: 'Google AI Studio', cost: 0.002 }),
        step(1, { upstreamProvider: 'Google Vertex', cost: 0.002 }),
        step(1, { upstreamProvider: 'Google Vertex', cost: 0.002 }),
        step(2, { model: 'google/gemini-2.5-flash-lite', totalTokens: 100, source: 'title' }),
      ],
      previous: [],
      throughDay: 28,
    });
    expect(story.models[0]).toMatchObject({ model: 'google/gemini-2.5-flash', providers: [{ name: 'Google AI Studio', share: 0.5 }, { name: 'Google Vertex', share: 0.5 }] });
    expect(story.models[0].cost).toBeCloseTo(0.008);
    expect(story.models[1]).toMatchObject({ model: 'google/gemini-2.5-flash-lite', cost: null, providers: [] });
  });

  it('ranks conversations by tokens and names deleted ones', () => {
    const story = usageStory({
      ...base,
      steps: [step(1, { conversationId: 1, totalTokens: 100 }), step(2, { conversationId: 2, totalTokens: 900 }), step(3, { conversationId: 9, totalTokens: 500 })],
      previous: [],
      throughDay: 28,
    });
    expect(story.conversations.map((c) => [c.title, c.tokens])).toEqual([
      ['Rotina do banco', 900],
      ['Conversa apagada', 500],
      ['Gastos do mês', 100],
    ]);
  });

  it('takes speed from the first step of each call and from streaming steps', () => {
    const story = usageStory({
      ...base,
      steps: [
        step(1, { firstOutputMs: 500, outputTokensPerSecond: 80 }),
        step(1, { firstOutputMs: 700, outputTokensPerSecond: 100 }),
        step(1, { stepNumber: 1, firstOutputMs: 5000 }),
      ],
      previous: [],
      throughDay: 28,
    });
    expect(story.speed.firstOutputMedianMs).toBe(500);
    expect(story.speed.firstOutputP90Ms).toBe(700);
    expect(story.speed.tpmMedian).toBe(4800);
  });
});

describe('helpers', () => {
  it('names token counts in Portuguese', () => {
    expect(tokensPhrase(61_800)).toBe('61,8 mil tokens');
    expect(tokensPhrase(1_210_000)).toBe('1,21 milhão de tokens');
    expect(tokensPhrase(2_400_000)).toBe('2,4 milhões de tokens');
  });

  it('takes nearest-rank quantiles', () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(quantile([1, 2, 3, 4], 0.9)).toBe(4);
  });
});
