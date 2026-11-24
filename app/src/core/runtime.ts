import { EdjiAssistant, assistantLog } from '../../modules/edji-assistant';
import { PLUGINS } from '../plugins';
import { handleVoiceCommand } from './agent';
import { getDb, loadPluginStates, migratePlugins } from './db';
import { emitChanged } from './events';
import type { PluginContext } from './plugin';
import { availableTools, validatePlugins } from './registry';

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
 * Runs every pending voice command through the agent and reports each result
 * to the native inbox. Single-flight: the app and the headless task share one
 * runtime, and running twice would execute a tool twice.
 */
export function processPendingCommands(): Promise<number> {
  processing ??= run().finally(() => {
    processing = null;
  });
  return processing;
}

async function run(): Promise<number> {
  if (!EdjiAssistant) return 0;
  await ensureReady();
  const commands = await EdjiAssistant.pendingCommands();
  if (commands.length === 0) return 0;
  const db = await getDb();
  const tools = availableTools(PLUGINS, await loadPluginStates(db));
  for (const c of commands) {
    const result = await handleVoiceCommand(c.text, tools, contextFor);
    await EdjiAssistant.completeCommand(c.id, result.ok, result.reply);
    assistantLog(`agente: comando ${c.id} → ${result.ok ? 'ok' : 'falhou'}: ${result.reply}`);
  }
  return commands.length;
}
