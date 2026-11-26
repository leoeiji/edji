import type { Plugin } from '@/core/plugin';

/** A side-panel destination: home, an enabled plugin view or a fixed screen. */
export type Destination = { key: string; title: string };

export const HOME: Destination = { key: 'home', title: 'Início' };

export const FIXED: Destination[] = [
  { key: 'settings', title: 'Configurações' },
  { key: 'permissions', title: 'Permissões' },
  { key: 'log', title: 'Registro' },
];

/** Home first, then the enabled plugin views, then the fixed screens. */
export function destinationsFor(views: Plugin[]): Destination[] {
  return [HOME, ...views.map((p) => ({ key: p.id, title: p.view!.title })), ...FIXED];
}
