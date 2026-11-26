import { EdjiAssistant, assistantLog, type PendingCommand, type PendingRoutineRun } from '../../modules/edji-assistant';
import { PLUGINS } from '@/plugins';
import { MESSAGES, ROUTINE_INSTRUCTIONS, runAgent, type AgentResult, type AgentTool, type ChatMessage } from '@/agent/agent';
import { getDb, loadPluginStates, migratePlugins } from './db';
import { emitChanged } from './events';
import { openRouterModel } from '@/agent/openrouter';
import type { PluginContext } from './plugin';
import { enabledPlugins, validatePlugins } from './registry';
import { loadModelSettings } from '@/agent/settings';

let ready: Promise<void> | null = null;

/** Validates plugins and runs migrations once per JS runtime (app or headless). */
export function ensureReady(): Promise<void> {
  ready ??= (async () => {
    validatePlugins(PLUGINS);
    await migratePlugins(await getDb(), PLUGINS);
  })();
  return ready;
}

export async function contextFor(pluginId: string): Promise<PluginContext> {
  const db = await getDb();
  return { db, notifyChanged: () => emitChanged(pluginId) };
}

/** Tools of the enabled plugins, bound to their context, for the agent. */
export async function agentTools(exclude: (pluginId: string) => boolean = () => false): Promise<AgentTool[]> {
  const states = await loadPluginStates(await getDb());
  const plugins = enabledPlugins(PLUGINS, states).filter((p) => !exclude(p.id));
  const bound = await Promise.all(
    plugins.map(async (p) => {
      const ctx = await contextFor(p.id);
      return (p.tools ?? []).map(
        (t): AgentTool => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          execute: (params) => t.run(params, ctx),
        }),
      );
    }),
  );
  return bound.flat();
}

let processing: Promise<number> | null = null;

/**
 * Answers every pending voice command with the agent, streaming the reply to
 * the open session. Single-flight: running twice would call the model twice.
 * Only the headless task calls this; commands of a closed session are
 * cancelled natively, so nothing is ever sent after the fact.
 */
export function processPendingCommands(): Promise<number> {
  processing ??= run().finally(() => {
    processing = null;
  });
  return processing;
}

/** How often a running turn checks that its session still waits for it. */
export const WAITING_POLL_MS = 1000;

async function run(): Promise<number> {
  if (!EdjiAssistant) return 0;
  await ensureReady();
  let total = 0;
  // Loop until empty: a command stored while this run was busy must not be dropped.
  for (;;) {
    const commands = await EdjiAssistant.pendingCommands();
    if (commands.length === 0) break;
    for (const c of commands) {
      const result = await answer(c);
      await EdjiAssistant.completeCommand(c.id, result.status, result.reply);
      assistantLog(`agente: comando ${c.id} → ${result.status}${result.status === 'done' ? '' : `: ${result.reply}`}`);
      total++;
    }
  }
  return total;
}

async function answer(c: PendingCommand): Promise<AgentResult> {
  const assistant = EdjiAssistant!;
  const controller = new AbortController();
  // The session may give up (timeout, closed) while the model sends nothing; stop then too.
  const poll = setInterval(() => {
    if (!assistant.isWaiting(c.id)) controller.abort();
  }, WAITING_POLL_MS);
  const startedAt = Date.now();
  let first = true;
  try {
    return await runAgent({
      messages: messagesFor(c),
      settings: await loadModelSettings(),
      signal: controller.signal,
      createModel: openRouterModel,
      tools: await agentTools(),
      onText: (text) => {
        if (first) {
          first = false;
          assistantLog(`agente: primeiro texto em ${Date.now() - startedAt} ms`);
        }
        if (!assistant.pushReply(c.id, text)) controller.abort(); // session closed
      },
      onActivity: () => {
        if (!assistant.heartbeat(c.id)) controller.abort();
      },
    });
  } finally {
    clearInterval(poll);
  }
}

/** The session's earlier turns followed by the new transcript. */
export function messagesFor(c: Pick<PendingCommand, 'text' | 'history'>): ChatMessage[] {
  return [...c.history, { role: 'user', content: c.text }];
}

let routineProcessing: Promise<number> | null = null;

/**
 * Runs every queued `ask_agent` firing (ADR 0005). Single-flight, like the
 * voice commands. Routines run with nobody present, so the agent gets
 * [ROUTINE_INSTRUCTIONS] and never the routines tools: text from a
 * notification must not be able to create or change routines.
 */
export function processPendingRoutineRuns(): Promise<number> {
  routineProcessing ??= runRoutines().finally(() => {
    routineProcessing = null;
  });
  return routineProcessing;
}

/** Failures worth trying again later instead of giving up. */
const RETRYABLE: string[] = [MESSAGES.offline, MESSAGES.rateLimited];

async function runRoutines(): Promise<number> {
  if (!EdjiAssistant) return 0;
  await ensureReady();
  const runs = await EdjiAssistant.pendingRoutineRuns();
  if (runs.length === 0) return 0;
  const [settings, tools] = await Promise.all([loadModelSettings(), agentTools((id) => id === 'routines')]);
  for (const run of runs) {
    const result = await runAgent({
      messages: [{ role: 'user', content: run.prompt }],
      settings,
      tools,
      instructions: ROUTINE_INSTRUCTIONS,
      createModel: openRouterModel,
    });
    const report = routineReport(run, result);
    await EdjiAssistant.completeRoutineRun(run.id, report.outcome, report.detail, report.notifyText);
    assistantLog(`rotina: execução ${run.id} → ${report.outcome}`);
  }
  return runs.length;
}

/**
 * How an `ask_agent` firing ended. The detail goes to the run log, so it
 * never carries the agent's reply (which may quote the notification).
 */
export function routineReport(
  run: Pick<PendingRoutineRun, 'reply'>,
  result: AgentResult,
): { outcome: 'done' | 'failed' | 'blocked' | 'retry'; detail: string; notifyText: string | null } {
  switch (result.status) {
    case 'done':
      return { outcome: 'done', detail: 'Agente respondeu', notifyText: run.reply === 'notify' ? result.reply : null };
    case 'setup':
      return { outcome: 'blocked', detail: result.reply, notifyText: null };
    case 'cancelled':
      return { outcome: 'retry', detail: 'Interrompida', notifyText: null };
    case 'failed':
      return RETRYABLE.includes(result.reply)
        ? { outcome: 'retry', detail: result.reply, notifyText: null }
        : { outcome: 'failed', detail: result.reply, notifyText: null };
  }
}
