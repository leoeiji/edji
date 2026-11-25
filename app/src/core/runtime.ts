import { EdjiAssistant, assistantLog, type PendingCommand } from '../../modules/edji-assistant';
import { PLUGINS } from '@/plugins';
import { runAgent, type AgentResult, type ChatMessage } from '@/agent/agent';
import { getDb, migratePlugins } from './db';
import { emitChanged } from './events';
import { openRouterModel } from '@/agent/openrouter';
import type { PluginContext } from './plugin';
import { validatePlugins } from './registry';
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
