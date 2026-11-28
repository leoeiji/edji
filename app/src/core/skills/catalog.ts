import type { SQLiteDatabase } from 'expo-sqlite';
import type { Plugin } from '../plugin';
import { isEnabled, type PluginStates } from '../registry';
import { loadPluginStates } from '../db';
import { SYSTEM_SKILLS } from './system';
import { listUserSkills } from './store';
import type { PluginSkill, Skill } from './types';

function fromCode(s: PluginSkill, prefix: string, origin: Skill['origin'], enabled: boolean): Skill {
  return { id: `${prefix}.${s.id}`, name: s.name, when: s.when, instructions: s.instructions, origin, enabled, editable: false };
}

/**
 * Every skill, from the three origins: the system's, the plugins' (enabled
 * only when their plugin is) and the user's, in that order.
 */
export function collectSkills(plugins: Plugin[], states: PluginStates, user: Skill[]): Skill[] {
  const system = SYSTEM_SKILLS.map((s) => fromCode(s, 'system', { kind: 'system' }, true));
  const fromPlugins = plugins.flatMap((p) =>
    (p.skills ?? []).map((s) => fromCode(s, p.id, { kind: 'plugin', pluginId: p.id, pluginName: p.name }, isEnabled(p, states))),
  );
  return [...system, ...fromPlugins, ...user];
}

/** [collectSkills] reading the user's skills and the plugin states from [db]. */
export async function listSkills(db: SQLiteDatabase, plugins: Plugin[]): Promise<Skill[]> {
  const [states, user] = await Promise.all([loadPluginStates(db), listUserSkills(db)]);
  return collectSkills(plugins, states, user);
}

/**
 * The catalog the model reads at the end of its instructions: one line per
 * enabled skill with its id and when to use it. The text of a skill is not
 * here; the model asks for it with `skills__load`.
 */
export function catalogText(skills: Skill[]): string {
  const active = skills.filter((s) => s.enabled);
  if (active.length === 0) return '';
  return [
    'Skills: instruções que você pode ler com a ferramenta skills__load (parâmetro id) antes de agir.',
    'Carregue uma só quando o pedido combinar com o "quando usar" dela, e siga o que ela diz.',
    ...active.map((s) => `- ${s.id}: ${s.name}. ${s.when}`),
  ].join('\n');
}
