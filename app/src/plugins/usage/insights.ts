import { summarize, type UsageSource, type UsageStep, type UsageSummary } from '@/core/usage';
import { formatInt, formatTokensShort } from '@/core/usageFormat';

/** Tokens of one day of the month, split as the chart stacks them. */
export type DayTokens = { day: number; fresh: number; cache: number; output: number };

export type SourceShare = { source: UsageSource; label: string; tokens: number; share: number };

export type ModelUsage = {
  model: string;
  tokens: number;
  cost: number | null;
  /** Upstream providers that served it, with their share of its steps, most used first. */
  providers: { name: string; share: number }[];
};

export type ConversationUsage = { conversationId: number; title: string; tokens: number; steps: number; cost: number | null; lastAt: number };

export type Speed = {
  firstOutputMedianMs: number | null;
  firstOutputP90Ms: number | null;
  tpmMedian: number | null;
  tpmP10: number | null;
};

/** A month of model use, as facts computed on the device; the sentences only describe, never guess a cause. */
export type UsageStory = {
  totals: UsageSummary;
  headline: string;
  sub: string | null;
  days: DayTokens[];
  peak: { day: number; tokens: number } | null;
  /** Share of all tokens that were input, 0..1. */
  inputShare: number;
  avgInputPerStep: number;
  /** Share of input tokens read from the provider's cache, 0..1. */
  cacheShare: number;
  sources: SourceShare[];
  models: ModelUsage[];
  speed: Speed;
  conversations: ConversationUsage[];
};

export const SOURCE_LABEL: Record<UsageSource, string> = {
  chat: 'Chat',
  voice: 'Voz',
  routine: 'Rotinas · perguntar ao agente',
  title: 'Títulos · modelo leve',
};

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "novembro de 2026". [month] is 1-12. */
export function monthName(year: number, month: number): string {
  return `${MONTHS[month - 1]} de ${year}`;
}

/** Start of [month] (1-12) and of the next one, in local time. */
export function monthRange(year: number, month: number): [number, number] {
  return [new Date(year, month - 1, 1).getTime(), new Date(year, month, 1).getTime()];
}

/** How many conversations [topConversations] lists. */
export const TOP_CONVERSATIONS = 3;

type Input = {
  year: number;
  month: number;
  steps: UsageStep[];
  /** Steps of the month before, for the comparison. */
  previous: UsageStep[];
  /** Day of the month to compare up to: today in the current month, the whole month otherwise. */
  throughDay: number | null;
  titles: Map<number, string>;
};

const tokensOf = (s: Pick<UsageStep, 'totalTokens' | 'inputTokens' | 'outputTokens'>) => s.totalTokens ?? (s.inputTokens ?? 0) + (s.outputTokens ?? 0);

export function usageStory({ year, month, steps, previous, throughDay, titles }: Input): UsageStory {
  const totals = summarize(steps);
  const total = totals.totalTokens;
  const daysInMonth = new Date(year, month, 0).getDate();

  const days: DayTokens[] = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, fresh: 0, cache: 0, output: 0 }));
  for (const s of steps) {
    const d = days[new Date(s.createdAt).getDate() - 1];
    const cache = s.cacheReadTokens ?? 0;
    d.cache += cache;
    d.fresh += Math.max(0, (s.inputTokens ?? 0) - cache);
    d.output += s.outputTokens ?? 0;
  }
  let peak: UsageStory['peak'] = null;
  for (const d of days) {
    const tokens = d.fresh + d.cache + d.output;
    if (tokens > 0 && (!peak || tokens > peak.tokens)) peak = { day: d.day, tokens };
  }

  const prevMonth = month === 1 ? 12 : month - 1;
  const comparable = throughDay === null ? previous : previous.filter((s) => new Date(s.createdAt).getDate() <= throughDay);
  const before = comparable.reduce((n, s) => n + tokensOf(s), 0);
  const headline = headlineFor(total, before, MONTHS[prevMonth - 1], throughDay);

  const conversations = new Set(steps.filter((s) => s.conversationId !== null && s.conversationId !== undefined && s.source !== 'routine').map((s) => s.conversationId));
  const routineCalls = new Set(steps.filter((s) => s.source === 'routine').map((s) => s.callId)).size;
  const requests = steps.length;
  const sub =
    requests === 0
      ? null
      : [
          `${requests === 1 ? '1 pedido' : `${formatInt(requests)} pedidos`} ao modelo`,
          conversations.size ? `em ${conversations.size === 1 ? '1 conversa' : `${conversations.size} conversas`}` : null,
          routineCalls ? `${conversations.size ? 'e ' : 'em '}${routineCalls === 1 ? '1 rotina' : `${routineCalls} rotinas`}` : null,
        ]
          .filter(Boolean)
          .join(' ') + '.';

  const bySource = new Map<UsageSource, number>();
  for (const s of steps) bySource.set(s.source, (bySource.get(s.source) ?? 0) + tokensOf(s));
  const sources = [...bySource]
    .map(([source, tokens]) => ({ source, label: SOURCE_LABEL[source], tokens, share: total ? tokens / total : 0 }))
    .filter((s) => s.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);

  const byModel = new Map<string, UsageStep[]>();
  for (const s of steps) {
    const key = s.responseModel ?? s.model;
    byModel.set(key, [...(byModel.get(key) ?? []), s]);
  }
  const models = [...byModel]
    .map(([model, list]): ModelUsage => {
      const sum = summarize(list);
      const counts = new Map<string, number>();
      for (const s of list) if (s.upstreamProvider) counts.set(s.upstreamProvider, (counts.get(s.upstreamProvider) ?? 0) + 1);
      const counted = [...counts.values()].reduce((a, b) => a + b, 0);
      const providers = [...counts]
        .map(([name, n]) => ({ name, share: n / counted }))
        .sort((a, b) => b.share - a.share);
      return { model, tokens: sum.totalTokens, cost: sum.cost, providers };
    })
    .sort((a, b) => b.tokens - a.tokens);

  const firstOutputs = steps
    .filter((s) => s.stepNumber === 0 && s.firstOutputMs !== null)
    .map((s) => s.firstOutputMs!)
    .sort((a, b) => a - b);
  const tpms = steps
    .filter((s) => (s.outputTokens ?? 0) > 0 && s.outputTokensPerSecond)
    .map((s) => s.outputTokensPerSecond! * 60)
    .sort((a, b) => a - b);
  const speed: Speed = {
    firstOutputMedianMs: quantile(firstOutputs, 0.5),
    firstOutputP90Ms: quantile(firstOutputs, 0.9),
    tpmMedian: quantile(tpms, 0.5),
    tpmP10: quantile(tpms, 0.1),
  };

  const byConversation = new Map<number, UsageStep[]>();
  for (const s of steps) {
    if (s.conversationId === null || s.conversationId === undefined) continue;
    byConversation.set(s.conversationId, [...(byConversation.get(s.conversationId) ?? []), s]);
  }
  const top = [...byConversation]
    .map(([conversationId, list]): ConversationUsage => {
      const sum = summarize(list);
      return {
        conversationId,
        title: titles.get(conversationId) ?? 'Conversa apagada',
        tokens: sum.totalTokens,
        steps: list.length,
        cost: sum.cost,
        lastAt: list[list.length - 1].createdAt,
      };
    })
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, TOP_CONVERSATIONS);

  return {
    totals,
    headline,
    sub,
    days,
    peak,
    inputShare: totals.inputTokens + totals.outputTokens ? totals.inputTokens / (totals.inputTokens + totals.outputTokens) : 0,
    avgInputPerStep: requests ? totals.inputTokens / requests : 0,
    cacheShare: totals.inputTokens ? totals.cacheReadTokens / totals.inputTokens : 0,
    sources,
    models,
    speed,
    conversations: top,
  };
}

/** "61,8 mil tokens", "1,21 milhão de tokens", "2,4 milhões de tokens". */
export function tokensPhrase(n: number): string {
  if (n < 1_000_000) return `${formatTokensShort(n)} ${n === 1 ? 'token' : 'tokens'}`;
  const m = (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
  return `${m} ${n < 2_000_000 ? 'milhão' : 'milhões'} de tokens`;
}

function headlineFor(total: number, before: number, prevName: string, throughDay: number | null): string {
  if (total === 0) return 'Nenhum token usado neste mês.';
  const phrase = tokensPhrase(total);
  if (before === 0) return `${phrase}.`;
  const change = Math.round(((total - before) / before) * 100);
  const when = throughDay === null ? `em ${prevName}` : `em ${prevName} até o dia ${throughDay}`;
  if (change === 0) return `${phrase}, o mesmo que ${when}.`;
  return `${phrase}, ${Math.abs(change)}% a ${change > 0 ? 'mais' : 'menos'} que ${when}.`;
}

/** Nearest-rank quantile of sorted values, or `null` with none. */
export function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}
