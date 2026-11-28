import type { Plugin } from '@/core/plugin';

/** A side-panel destination: the chat, an enabled plugin view or a fixed screen. */
export type Destination = {
  key: string;
  title: string;
  /** `agent` items sit together under the panel's "Agente" group. */
  group?: 'agent';
};

/** Title of the side panel's "Agente" group. */
export const AGENT_GROUP_TITLE = 'Agente';

/** The skills screen, first item of the Agente group (ADR 0010). */
export const SKILLS: Destination = { key: 'skills', title: 'Skills', group: 'agent' };

/** The chat is home; the panel reaches it through the conversations, not as an item. */
export const HOME: Destination = { key: 'home', title: 'Conversa' };

export const FIXED: Destination[] = [
  { key: 'settings', title: 'Configurações' },
  { key: 'permissions', title: 'Permissões' },
  { key: 'log', title: 'Registro' },
];

/** True for the fixed screens (settings, permissions, log), which the panel sets apart below the rest. */
export function isFixed(d: Destination): boolean {
  return FIXED.some((f) => f.key === d.key);
}

/**
 * Home, then the Agente group (Skills and the plugin views that ask for it,
 * like Uso), then the other enabled plugin views, then the fixed screens.
 */
export function destinationsFor(views: Plugin[]): Destination[] {
  const dest = (p: Plugin): Destination => ({ key: p.id, title: p.view!.title, ...(p.view!.group ? { group: p.view!.group } : {}) });
  const mapped = views.map(dest);
  return [HOME, SKILLS, ...mapped.filter((d) => d.group === 'agent'), ...mapped.filter((d) => d.group !== 'agent'), ...FIXED];
}
