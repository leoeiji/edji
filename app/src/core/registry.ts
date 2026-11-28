import type { Plugin, Tool } from './plugin';
import { RESERVED_PLUGIN_IDS, skillToolLabel } from './skills/types';

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

/** Tells every plugin with an `onEnabledChange` hook whether it is on. Never throws. */
export async function applyEnabledStates(plugins: Plugin[], states: PluginStates): Promise<void> {
  for (const p of plugins) {
    try {
      await p.onEnabledChange?.(isEnabled(p, states));
    } catch {
      // A plugin's native side may be missing (tests, iOS); the switch still works in JS.
    }
  }
}

/**
 * Checks the plugin list at startup: unique ids, tool names namespaced with
 * the plugin id and unique, with a label, skills with unique ids and text, ids not reserved, routine actions with flat parameters and never
 * from `routines`, migrations in increasing order. Throws on error.
 */
export function validatePlugins(plugins: Plugin[]): void {
  const ids = new Set<string>();
  const tools = new Set<string>();
  for (const p of plugins) {
    if (!/^[a-z][a-z0-9_]*$/.test(p.id)) throw new Error(`Invalid plugin id "${p.id}"`);
    if (RESERVED_PLUGIN_IDS.includes(p.id)) throw new Error(`Plugin id "${p.id}" is reserved`);
    if (ids.has(p.id)) throw new Error(`Duplicate plugin id "${p.id}"`);
    ids.add(p.id);
    for (const t of p.tools ?? []) {
      if (!t.name.startsWith(`${p.id}.`)) throw new Error(`Tool "${t.name}" must start with "${p.id}."`);
      if (!t.label?.trim()) throw new Error(`Tool "${t.name}" needs a label`);
      if (tools.has(t.name)) throw new Error(`Duplicate tool "${t.name}"`);
      tools.add(t.name);
      if (t.routineAction) {
        if (p.id === 'routines') throw new Error(`Tool "${t.name}": routines tools can't be routine actions`);
        for (const [key, schema] of Object.entries(t.parameters.properties)) {
          if (!('type' in schema) || !['string', 'number', 'integer', 'boolean'].includes(schema.type)) {
            throw new Error(`Tool "${t.name}": routine action parameter "${key}" must be string, number, integer or boolean`);
          }
        }
      }
    }
    const skillIds = new Set<string>();
    for (const s of p.skills ?? []) {
      if (!/^[a-z][a-z0-9_]*$/.test(s.id)) throw new Error(`Invalid skill id "${p.id}.${s.id}"`);
      if (skillIds.has(s.id)) throw new Error(`Duplicate skill "${p.id}.${s.id}"`);
      skillIds.add(s.id);
      if (!s.name.trim() || !s.when.trim() || !s.instructions.trim()) {
        throw new Error(`Skill "${p.id}.${s.id}" needs a name, a "when" and instructions`);
      }
    }
    const versions = (p.migrations ?? []).map((m) => m.version);
    versions.forEach((v, i) => {
      if (v !== i + 1) throw new Error(`Plugin "${p.id}" migrations must be numbered 1, 2, 3...`);
    });
  }
}

/**
 * How a tool call reads on the chat card: "Finanças · Registrar gasto". A
 * tool that no longer exists (plugin removed) shows its technical name.
 */
export function toolLabel(plugins: Plugin[], name: string): string {
  const skill = skillToolLabel(name);
  if (skill) return skill;
  for (const p of plugins) {
    const t = p.tools?.find((x) => x.name === name);
    if (t) return `${p.name} · ${t.label}`;
  }
  return name;
}
