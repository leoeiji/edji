import type { Plugin, Tool } from './plugin';

/** Enabled flag per plugin id, as stored. Missing ids fall back to the plugin default. */
export type PluginStates = Record<string, boolean>;

export function isEnabled(plugin: Plugin, states: PluginStates): boolean {
  return states[plugin.id] ?? plugin.enabledByDefault;
}

export function enabledPlugins(plugins: Plugin[], states: PluginStates): Plugin[] {
  return plugins.filter((p) => isEnabled(p, states));
}

/** Tools the agent may call: only those of enabled plugins. */
export function availableTools(plugins: Plugin[], states: PluginStates): Tool<any>[] {
  return enabledPlugins(plugins, states).flatMap((p) => p.tools ?? []);
}

/**
 * Checks the plugin list at startup: unique ids, tool names namespaced with
 * the plugin id and unique, migrations in increasing order. Throws on error.
 */
export function validatePlugins(plugins: Plugin[]): void {
  const ids = new Set<string>();
  const tools = new Set<string>();
  for (const p of plugins) {
    if (!/^[a-z][a-z0-9_]*$/.test(p.id)) throw new Error(`Invalid plugin id "${p.id}"`);
    if (ids.has(p.id)) throw new Error(`Duplicate plugin id "${p.id}"`);
    ids.add(p.id);
    for (const t of p.tools ?? []) {
      if (!t.name.startsWith(`${p.id}.`)) throw new Error(`Tool "${t.name}" must start with "${p.id}."`);
      if (tools.has(t.name)) throw new Error(`Duplicate tool "${t.name}"`);
      tools.add(t.name);
    }
    const versions = (p.migrations ?? []).map((m) => m.version);
    versions.forEach((v, i) => {
      if (v !== i + 1) throw new Error(`Plugin "${p.id}" migrations must be numbered 1, 2, 3...`);
    });
  }
}
