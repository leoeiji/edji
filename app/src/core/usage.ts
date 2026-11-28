import type { SQLiteDatabase } from 'expo-sqlite';
import type { StepMetrics } from '@/agent/metrics';
import { emitChanged } from './events';
import type { Migration } from './plugin';

/** Schema id of the usage table in `plugin_schema`; the `_` keeps it apart from plugin ids. */
export const USAGE_SCHEMA_ID = '_usage';

/** Topic of `onChanged` when a step is stored. */
export const USAGE_TOPIC = '_usage';

/**
 * Where a model call came from: the text chat, a voice session, an
 * `ask_agent` routine, or the light model naming a conversation.
 */
export type UsageSource = 'chat' | 'voice' | 'routine' | 'title';

/**
 * One row per model step (ADR 0008), on the phone only. No foreign keys to
 * the chat: deleting a conversation keeps its usage, which then just loses
 * the link. Nothing here holds message text.
 */
export const USAGE_MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE usage_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        conversation_id INTEGER,
        message_id INTEGER,
        voice_session_id TEXT,
        call_id TEXT NOT NULL,
        step_number INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        response_model TEXT,
        upstream_provider TEXT,
        response_id TEXT,
        finish_reason TEXT,
        raw_finish_reason TEXT,
        input_tokens INTEGER,
        input_no_cache_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        output_tokens INTEGER,
        output_text_tokens INTEGER,
        reasoning_tokens INTEGER,
        total_tokens INTEGER,
        cost REAL,
        upstream_cost REAL,
        step_ms REAL,
        response_ms REAL,
        first_output_ms REAL,
        output_tps REAL,
        input_tps REAL,
        effective_output_tps REAL,
        effective_total_tps REAL,
        chunk_gap_min_ms REAL,
        chunk_gap_p10_ms REAL,
        chunk_gap_median_ms REAL,
        chunk_gap_avg_ms REAL,
        chunk_gap_p90_ms REAL,
        chunk_gap_max_ms REAL,
        tool_ms_json TEXT,
        warnings_json TEXT,
        usage_raw_json TEXT,
        provider_metadata_json TEXT,
        error TEXT
      );
      CREATE INDEX usage_steps_created ON usage_steps(created_at);
      CREATE INDEX usage_steps_conversation ON usage_steps(conversation_id);
      CREATE INDEX usage_steps_message ON usage_steps(message_id);
    `,
  },
];

/** What a step belongs to. Only `source` is required: an unsaved voice session or a routine has no conversation. */
export type UsageOrigin = {
  source: UsageSource;
  conversationId?: number | null;
  messageId?: number | null;
  voiceSessionId?: string | null;
};

export type UsageStep = StepMetrics & UsageOrigin & { id: number; createdAt: number };

export async function recordStep(db: SQLiteDatabase, origin: UsageOrigin, m: StepMetrics, now = Date.now()): Promise<void> {
  const gap = m.chunkGapMs;
  await db.runAsync(
    `INSERT INTO usage_steps (
      created_at, source, conversation_id, message_id, voice_session_id, call_id, step_number, provider, model,
      response_model, upstream_provider, response_id, finish_reason, raw_finish_reason,
      input_tokens, input_no_cache_tokens, cache_read_tokens, cache_write_tokens,
      output_tokens, output_text_tokens, reasoning_tokens, total_tokens, cost, upstream_cost,
      step_ms, response_ms, first_output_ms, output_tps, input_tps, effective_output_tps, effective_total_tps,
      chunk_gap_min_ms, chunk_gap_p10_ms, chunk_gap_median_ms, chunk_gap_avg_ms, chunk_gap_p90_ms, chunk_gap_max_ms,
      tool_ms_json, warnings_json, usage_raw_json, provider_metadata_json, error
    ) VALUES (${Array(42).fill('?').join(', ')})`,
    now,
    origin.source,
    origin.conversationId ?? null,
    origin.messageId ?? null,
    origin.voiceSessionId ?? null,
    m.callId,
    m.stepNumber,
    m.provider,
    m.model,
    m.responseModel,
    m.upstreamProvider,
    m.responseId,
    m.finishReason,
    m.rawFinishReason,
    m.inputTokens,
    m.inputNoCacheTokens,
    m.cacheReadTokens,
    m.cacheWriteTokens,
    m.outputTokens,
    m.outputTextTokens,
    m.reasoningTokens,
    m.totalTokens,
    m.cost,
    m.upstreamCost,
    m.stepMs,
    m.responseMs,
    m.firstOutputMs,
    m.outputTokensPerSecond,
    m.inputTokensPerSecond,
    m.effectiveOutputTokensPerSecond,
    m.effectiveTotalTokensPerSecond,
    gap?.min ?? null,
    gap?.p10 ?? null,
    gap?.median ?? null,
    gap?.avg ?? null,
    gap?.p90 ?? null,
    gap?.max ?? null,
    JSON.stringify(m.toolMs),
    JSON.stringify(m.warnings),
    m.usageRaw === null || m.usageRaw === undefined ? null : JSON.stringify(m.usageRaw),
    m.providerMetadata === null || m.providerMetadata === undefined ? null : JSON.stringify(m.providerMetadata),
    m.error,
  );
  emitChanged(USAGE_TOPIC);
}

/**
 * Records the steps of one run as they end, one write after another, for
 * callers that are not a stored chat turn (routines, unsaved voice, titles).
 * `flush` waits for the writes; a failed write is dropped, never thrown.
 */
export function usageRecorder(db: SQLiteDatabase, origin: UsageOrigin, now: () => number = Date.now) {
  let queue: Promise<void> = Promise.resolve();
  return {
    onStep(m: StepMetrics) {
      const at = now();
      queue = queue.then(() => recordStep(db, origin, m, at)).catch(() => {});
    },
    flush: () => queue,
  };
}

type StepRow = {
  id: number;
  created_at: number;
  source: UsageSource;
  conversation_id: number | null;
  message_id: number | null;
  voice_session_id: string | null;
  call_id: string;
  step_number: number;
  provider: string;
  model: string;
  response_model: string | null;
  upstream_provider: string | null;
  response_id: string | null;
  finish_reason: string | null;
  raw_finish_reason: string | null;
  input_tokens: number | null;
  input_no_cache_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  output_tokens: number | null;
  output_text_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  cost: number | null;
  upstream_cost: number | null;
  step_ms: number | null;
  response_ms: number | null;
  first_output_ms: number | null;
  output_tps: number | null;
  input_tps: number | null;
  effective_output_tps: number | null;
  effective_total_tps: number | null;
  chunk_gap_min_ms: number | null;
  chunk_gap_p10_ms: number | null;
  chunk_gap_median_ms: number | null;
  chunk_gap_avg_ms: number | null;
  chunk_gap_p90_ms: number | null;
  chunk_gap_max_ms: number | null;
  tool_ms_json: string | null;
  warnings_json: string | null;
  usage_raw_json: string | null;
  provider_metadata_json: string | null;
  error: string | null;
};

function toStep(r: StepRow): UsageStep {
  const gap =
    r.chunk_gap_median_ms === null
      ? null
      : {
          min: r.chunk_gap_min_ms ?? 0,
          p10: r.chunk_gap_p10_ms ?? 0,
          median: r.chunk_gap_median_ms,
          avg: r.chunk_gap_avg_ms ?? 0,
          p90: r.chunk_gap_p90_ms ?? 0,
          max: r.chunk_gap_max_ms ?? 0,
        };
  return {
    id: r.id,
    createdAt: r.created_at,
    source: r.source,
    conversationId: r.conversation_id,
    messageId: r.message_id,
    voiceSessionId: r.voice_session_id,
    callId: r.call_id,
    stepNumber: r.step_number,
    provider: r.provider,
    model: r.model,
    responseModel: r.response_model,
    upstreamProvider: r.upstream_provider,
    responseId: r.response_id,
    finishReason: r.finish_reason,
    rawFinishReason: r.raw_finish_reason,
    inputTokens: r.input_tokens,
    inputNoCacheTokens: r.input_no_cache_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheWriteTokens: r.cache_write_tokens,
    outputTokens: r.output_tokens,
    outputTextTokens: r.output_text_tokens,
    reasoningTokens: r.reasoning_tokens,
    totalTokens: r.total_tokens,
    cost: r.cost,
    upstreamCost: r.upstream_cost,
    stepMs: r.step_ms,
    responseMs: r.response_ms,
    firstOutputMs: r.first_output_ms,
    outputTokensPerSecond: r.output_tps,
    inputTokensPerSecond: r.input_tps,
    effectiveOutputTokensPerSecond: r.effective_output_tps,
    effectiveTotalTokensPerSecond: r.effective_total_tps,
    chunkGapMs: gap,
    toolMs: parse(r.tool_ms_json, {}) as Record<string, number>,
    warnings: parse(r.warnings_json, []) as string[],
    usageRaw: parse(r.usage_raw_json, null),
    providerMetadata: parse(r.provider_metadata_json, null),
    error: r.error,
  };
}

function parse(json: string | null, fallback: unknown): unknown {
  if (json === null) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/** Every step of a conversation (its turns and its title), oldest first. */
export async function conversationSteps(db: SQLiteDatabase, conversationId: number): Promise<UsageStep[]> {
  const rows = await db.getAllAsync<StepRow>('SELECT * FROM usage_steps WHERE conversation_id = ? ORDER BY id', conversationId);
  return rows.map(toStep);
}

/** Steps stored in `[from, to)`, oldest first. */
export async function stepsBetween(db: SQLiteDatabase, from: number, to: number): Promise<UsageStep[]> {
  const rows = await db.getAllAsync<StepRow>('SELECT * FROM usage_steps WHERE created_at >= ? AND created_at < ? ORDER BY id', from, to);
  return rows.map(toStep);
}

/** When the first step was stored, or `null` with none: the dashboard does not go back past it. */
export async function firstStepAt(db: SQLiteDatabase): Promise<number | null> {
  const r = await db.getFirstAsync<{ at: number | null }>('SELECT MIN(created_at) AS at FROM usage_steps');
  return r?.at ?? null;
}

/**
 * Sums of several steps: one reply (its tool steps too), a conversation, a
 * month. Counts skip steps that did not report them; `tokensPerMinute` is
 * output tokens over the time spent streaming them, so tool time and the
 * wait for the first token do not lower it.
 */
export type UsageSummary = {
  steps: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  /** `null` when no step reported a cost. */
  cost: number | null;
  /** From the first step: what the user waited for before anything showed. */
  firstOutputMs: number | null;
  /** Sum of the steps' time, tools included. */
  totalMs: number;
  toolMs: number;
  tokensPerMinute: number | null;
  models: string[];
  upstreamProviders: string[];
  finishReason: string | null;
};

export function summarize(steps: Pick<UsageStep, keyof StepMetrics>[]): UsageSummary {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let reasoningTokens = 0;
  let cost: number | null = null;
  let totalMs = 0;
  let toolMs = 0;
  let streamedTokens = 0;
  let streamSeconds = 0;
  let failed = 0;
  const models = new Set<string>();
  const upstream = new Set<string>();
  for (const s of steps) {
    if (s.error) failed++;
    inputTokens += s.inputTokens ?? 0;
    outputTokens += s.outputTokens ?? 0;
    totalTokens += s.totalTokens ?? (s.inputTokens ?? 0) + (s.outputTokens ?? 0);
    cacheReadTokens += s.cacheReadTokens ?? 0;
    cacheWriteTokens += s.cacheWriteTokens ?? 0;
    reasoningTokens += s.reasoningTokens ?? 0;
    if (s.cost !== null) cost = (cost ?? 0) + s.cost;
    totalMs += s.stepMs ?? 0;
    toolMs += Object.values(s.toolMs).reduce((a, b) => a + b, 0);
    const out = s.outputTokens ?? 0;
    const tps = s.outputTokensPerSecond ?? s.effectiveOutputTokensPerSecond;
    if (out > 0 && tps && tps > 0) {
      streamedTokens += out;
      streamSeconds += out / tps;
    }
    models.add(s.responseModel ?? s.model);
    if (s.upstreamProvider) upstream.add(s.upstreamProvider);
  }
  const last = steps.at(-1);
  return {
    steps: steps.length,
    failed,
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    cost,
    firstOutputMs: steps[0]?.firstOutputMs ?? null,
    totalMs,
    toolMs,
    tokensPerMinute: streamSeconds > 0 ? (streamedTokens / streamSeconds) * 60 : null,
    models: [...models],
    upstreamProviders: [...upstream],
    finishReason: last?.finishReason ?? null,
  };
}

/** Steps grouped by the message they answered, for the line under each reply. */
export function byMessage(steps: UsageStep[]): Map<number, UsageStep[]> {
  const out = new Map<number, UsageStep[]>();
  for (const s of steps) {
    if (s.messageId === null || s.messageId === undefined) continue;
    const list = out.get(s.messageId) ?? [];
    list.push(s);
    out.set(s.messageId, list);
  }
  return out;
}
