import { EdjiAssistant, assistantLog, type AgentRoutineRun, type PendingCommand, type RoutineToolRun } from '../../modules/edji-assistant';
import { PLUGINS } from '@/plugins';
import { MESSAGES, ROUTINE_INSTRUCTIONS, runAgent, type AgentResult, type AgentTool, type ChatMessage } from '@/agent/agent';
import { applyMigrations, getDb, loadPluginStates, migratePlugins } from './db';
import { fallbackTitle } from '@/agent/light';
import { CHAT_MIGRATIONS, CHAT_SCHEMA_ID, createConversation, findVoiceConversation, savesVoiceConversations } from './chatStore';
import { runPersistedTurn, titleConversation } from './chatTurn';
import { emitChanged } from './events';
import { openRouterModel } from '@/agent/openrouter';
import type { PluginContext, Tool } from './plugin';
import { availableTools, enabledPlugins, toolLabel, validatePlugins } from './registry';
import { loadModelSettings, type ModelSettings } from '@/agent/settings';

let ready: Promise<void> | null = null;

/** Validates plugins and runs the chat and plugin migrations once per JS runtime (app or headless). */
export function ensureReady(): Promise<void> {
  ready ??= (async () => {
    validatePlugins(PLUGINS);
    const db = await getDb();
    await applyMigrations(db, CHAT_SCHEMA_ID, CHAT_MIGRATIONS);
    await migratePlugins(db, PLUGINS);
  })();
  return ready;
}

export async function contextFor(pluginId: string): Promise<PluginContext> {
  const db = await getDb();
  return {
    db,
    notifyChanged: () => emitChanged(pluginId),
    enabledTools: async () => availableTools(PLUGINS, await loadPluginStates(db)),
  };
}

/** Tools of the enabled plugins that pass [include], bound to their context, for the agent. */
export async function agentTools(include: (tool: Tool<any>, pluginId: string) => boolean = () => true): Promise<AgentTool[]> {
  const states = await loadPluginStates(await getDb());
  const plugins = enabledPlugins(PLUGINS, states);
  const bound = await Promise.all(
    plugins.map(async (p) => {
      const ctx = await contextFor(p.id);
      return (p.tools ?? []).filter((t) => include(t, p.id)).map(
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
      const { result, afterReply } = await answer(c);
      await EdjiAssistant.completeCommand(c.id, result.status, result.reply);
      assistantLog(`agente: comando ${c.id} → ${result.status}${result.status === 'done' ? '' : `: ${result.reply}`}`);
      // The title waits until the reply is on screen: it must never slow the answer down.
      await afterReply?.().catch(() => {});
      total++;
    }
  }
  return total;
}

type Answer = { result: AgentResult; afterReply?: () => Promise<void> };

/**
 * Answers one voice command. With saving on (the default), the session is a
 * conversation like any other: the history comes from `edji.db`, tools
 * included, and the turn is stored. With it off, nothing is stored and the
 * history is the session's own, as before.
 */
async function answer(c: PendingCommand): Promise<Answer> {
  const assistant = EdjiAssistant!;
  const controller = new AbortController();
  // The session may give up (timeout, closed) while the model sends nothing; stop then too.
  const poll = setInterval(() => {
    if (!assistant.isWaiting(c.id)) controller.abort();
  }, WAITING_POLL_MS);
  const startedAt = Date.now();
  let first = true;
  try {
    const db = await getDb();
    const settings = await loadModelSettings();
    const live = {
      signal: controller.signal,
      createModel: openRouterModel,
      tools: await agentTools(),
      onToolEvent: (e: { id: string; name: string; state: 'running' | 'done' | 'failed' }) => {
        if (!assistant.pushTool(c.id, e.id, toolLabel(PLUGINS, e.name), e.state)) controller.abort();
      },
      onText: (text: string) => {
        if (first) {
          first = false;
          assistantLog(`agente: primeiro texto em ${Date.now() - startedAt} ms`);
        }
        if (!assistant.pushReply(c.id, text)) controller.abort(); // session closed
      },
      onActivity: () => {
        if (!assistant.heartbeat(c.id)) controller.abort();
      },
    };
    if (c.sessionId && (await savesVoiceConversations(db))) {
      const conversation =
        (await findVoiceConversation(db, c.sessionId)) ??
        (await createConversation(db, { title: fallbackTitle(c.text), origin: 'voice', voiceSessionId: c.sessionId }));
      const result = await runPersistedTurn({ db, conversationId: conversation.id, userText: c.text, settings, ...live });
      return {
        result,
        afterReply: () => titleConversation(db, conversation, c.text, result, { settings, createModel: openRouterModel }),
      };
    }
    return { result: await runAgent({ messages: messagesFor(c), settings, ...live }) };
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
 * Runs every queued routine firing (ADR 0005): `run_tool` calls the plugin
 * tool directly; `ask_agent` asks the agent. Single-flight, like the voice
 * commands. Routines run with nobody present, so the agent gets
 * [ROUTINE_INSTRUCTIONS] and only the tools marked `routineAction` (never
 * routines tools, never ones that delete): text from a notification must not
 * be able to create or change routines, or erase data.
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
  // The model and its tools load only when some firing asks the agent.
  let agent: Promise<[ModelSettings, AgentTool[]]> | null = null;
  for (const run of runs) {
    let report: RoutineReport;
    if (run.kind === 'run_tool') {
      report = await runRoutineTool(run);
    } else {
      agent ??= Promise.all([loadModelSettings(), agentTools((t) => t.routineAction === true)]);
      const [settings, tools] = await agent;
      const result = await runAgent({
        messages: [{ role: 'user', content: run.prompt }],
        settings,
        tools,
        instructions: ROUTINE_INSTRUCTIONS,
        createModel: openRouterModel,
      });
      report = routineReport(run, result);
    }
    await EdjiAssistant.completeRoutineRun(run.id, report.outcome, report.detail, report.notifyText);
    assistantLog(`rotina: execução ${run.id} → ${report.outcome}`);
  }
  return runs.length;
}

export type RoutineReport = { outcome: 'done' | 'failed' | 'blocked' | 'retry'; detail: string; notifyText: string | null };

/** Longest tool reply kept in the run log. */
const MAX_DETAIL_LENGTH = 120;

/**
 * Calls the tool of a `run_tool` firing. Checked again here: the plugin may
 * have been turned off, or the tool unmarked, since the routine was saved.
 */
export async function runRoutineTool(run: Pick<RoutineToolRun, 'tool' | 'args'>): Promise<RoutineReport> {
  const states = await loadPluginStates(await getDb());
  const plugin = enabledPlugins(PLUGINS, states).find((p) => p.tools?.some((t) => t.name === run.tool && t.routineAction));
  const tool = plugin?.tools?.find((t) => t.name === run.tool);
  if (!plugin || !tool) return { outcome: 'blocked', detail: `${run.tool} não está disponível (plugin desligado?)`, notifyText: null };
  try {
    const result = await tool.run(run.args, await contextFor(plugin.id));
    // A success reply may quote the notification ("gasto em PADARIA X"), so the run log keeps a generic detail.
    if (result.ok) return { outcome: 'done', detail: `${run.tool}: feito`, notifyText: null };
    return { outcome: 'failed', detail: result.reply.slice(0, MAX_DETAIL_LENGTH), notifyText: null };
  } catch {
    return { outcome: 'failed', detail: `Algo falhou em ${run.tool}`, notifyText: null };
  }
}

/**
 * How an `ask_agent` firing ended. The detail goes to the run log, so it
 * never carries the agent's reply (which may quote the notification).
 */
export function routineReport(run: Pick<AgentRoutineRun, 'reply'>, result: AgentResult): RoutineReport {
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
