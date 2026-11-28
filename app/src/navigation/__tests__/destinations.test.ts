import type { Plugin } from '@/core/plugin';
import { destinationsFor, isFixed } from '../destinations';

const plugin = (id: string, title: string, group?: 'agent') =>
  ({ id, name: id, version: 1, view: { title, group, Component: () => null } }) as unknown as Plugin;

describe('destinationsFor', () => {
  it('lists home, skills, the other plugin views, then settings, permissions and log', () => {
    expect(destinationsFor([plugin('notes', 'Notas')]).map((d) => d.key)).toEqual(['home', 'skills', 'notes', 'settings', 'permissions', 'log']);
  });

  it('puts plugin views that ask for the agent group right after Skills', () => {
    const keys = destinationsFor([plugin('routines', 'Rotinas'), plugin('usage', 'Uso', 'agent')]).map((d) => [d.key, d.group]);
    expect(keys.slice(0, 4)).toEqual([['home', undefined], ['skills', 'agent'], ['usage', 'agent'], ['routines', undefined]]);
  });

  it('has only home, skills and the fixed screens when no plugin has a view', () => {
    expect(destinationsFor([]).map((d) => d.title)).toEqual(['Conversa', 'Skills', 'Configurações', 'Permissões', 'Registro']);
  });

  it('tells the fixed screens apart', () => {
    expect(destinationsFor([plugin('notes', 'Notas')]).filter(isFixed).map((d) => d.key)).toEqual(['settings', 'permissions', 'log']);
  });
});
