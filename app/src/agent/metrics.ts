import type { StepResult, ToolSet } from 'ai';

/**
 * Everything the AI SDK and the provider report about one model step (one
 * request to the provider), flattened for storage (ADR 0008). Missing values
 * are `null`: providers fill different subsets, and a failed step has only
 * the model, the time and the error.
 */
export type StepMetrics = {
  callId: string;
  stepNumber: number;
  /** The SDK's provider id (`openrouter`) and the model asked for. */
  provider: string;
  model: string;
  /** The model that answered (`response.modelId`) and the upstream provider that served it (OpenRouter routing). */
  responseModel: string | null;
  upstreamProvider: string | null;
  responseId: string | null;
  finishReason: string | null;
  rawFinishReason: string | null;
  inputTokens: number | null;
  inputNoCacheTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  outputTextTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  /** In the provider's credits (US$ on OpenRouter). */
  cost: number | null;
  upstreamCost: number | null;
  stepMs: number | null;
  responseMs: number | null;
  firstOutputMs: number | null;
  outputTokensPerSecond: number | null;
  inputTokensPerSecond: number | null;
  effectiveOutputTokensPerSecond: number | null;
  effectiveTotalTokensPerSecond: number | null;
  chunkGapMs: { min: number; p10: number; median: number; avg: number; p90: number; max: number } | null;
  /** Time of each client-side tool, by call id. */
  toolMs: Record<string, number>;
  warnings: string[];
  /** Usage exactly as the provider sent it, and the provider metadata without reasoning text. */
  usageRaw: unknown;
  providerMetadata: unknown;
  /** Set only for a step that failed before giving a result. */
  error: string | null;
};

/** Flattens a finished step. Never throws: odd provider data just leaves fields `null`. */
export function stepMetrics(step: StepResult<ToolSet>): StepMetrics {
  const u = step.usage;
  const p = step.performance;
  const openrouter = record(record(step.providerMetadata)?.openrouter);
  const orUsage = record(openrouter?.usage);
  return {
    callId: step.callId,
    stepNumber: step.stepNumber,
    provider: step.model.provider,
    model: step.model.modelId,
    responseModel: str(step.response?.modelId),
    upstreamProvider: str(openrouter?.provider),
    responseId: str(step.response?.id),
    finishReason: str(step.finishReason),
    rawFinishReason: str(step.rawFinishReason),
    inputTokens: num(u?.inputTokens),
    inputNoCacheTokens: num(u?.inputTokenDetails?.noCacheTokens),
    cacheReadTokens: num(u?.inputTokenDetails?.cacheReadTokens),
    cacheWriteTokens: num(u?.inputTokenDetails?.cacheWriteTokens),
    outputTokens: num(u?.outputTokens),
    outputTextTokens: num(u?.outputTokenDetails?.textTokens),
    reasoningTokens: num(u?.outputTokenDetails?.reasoningTokens),
    totalTokens: num(u?.totalTokens),
    cost: num(orUsage?.cost),
    upstreamCost: num(record(orUsage?.costDetails)?.upstreamInferenceCost),
    stepMs: num(p?.stepTimeMs),
    responseMs: num(p?.responseTimeMs),
    firstOutputMs: num(p?.timeToFirstOutputMs),
    outputTokensPerSecond: num(p?.outputTokensPerSecond),
    inputTokensPerSecond: num(p?.inputTokensPerSecond),
    effectiveOutputTokensPerSecond: num(p?.effectiveOutputTokensPerSecond),
    effectiveTotalTokensPerSecond: num(p?.effectiveTotalTokensPerSecond),
    chunkGapMs: p?.timeBetweenOutputChunksMs ? { ...p.timeBetweenOutputChunksMs } : null,
    toolMs: { ...(p?.toolExecutionMs ?? {}) },
    warnings: (step.warnings ?? []).map((w) => JSON.stringify(w)),
    usageRaw: u?.raw ?? null,
    providerMetadata: withoutReasoning(step.providerMetadata),
    error: null,
  };
}

/** A step that failed before the provider gave a result: no usage, only who was asked and why it failed. */
export function failedStepMetrics(
  step: { callId: string; stepNumber: number; provider: string; modelId: string },
  error: string,
  stepMs: number | null,
): StepMetrics {
  return {
    callId: step.callId,
    stepNumber: step.stepNumber,
    provider: step.provider,
    model: step.modelId,
    responseModel: null,
    upstreamProvider: null,
    responseId: null,
    finishReason: 'error',
    rawFinishReason: null,
    inputTokens: null,
    inputNoCacheTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    outputTokens: null,
    outputTextTokens: null,
    reasoningTokens: null,
    totalTokens: null,
    cost: null,
    upstreamCost: null,
    stepMs,
    responseMs: null,
    firstOutputMs: null,
    outputTokensPerSecond: null,
    inputTokensPerSecond: null,
    effectiveOutputTokensPerSecond: null,
    effectiveTotalTokensPerSecond: null,
    chunkGapMs: null,
    toolMs: {},
    warnings: [],
    usageRaw: null,
    providerMetadata: null,
    error,
  };
}

/** Reasoning text can be long and is not a metric; everything else in the metadata is kept. */
function withoutReasoning(metadata: unknown): unknown {
  const m = record(metadata);
  if (!m) return null;
  const out: Record<string, unknown> = {};
  for (const [provider, value] of Object.entries(m)) {
    const v = record(value);
    if (!v) continue;
    const { reasoning_details: _drop, ...rest } = v;
    out[provider] = rest;
  }
  return out;
}

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}
