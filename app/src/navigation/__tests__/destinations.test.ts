import type { Plugin } from '@/core/plugin';
import { destinationsFor } from '../destinations';

const plugin = (id: string, title: string) => ({ id, name: id, version: 1, view: { title, Component: () => null } }) as unknown as Plugin;

describe('destinationsFor', () => {
  it('lists home, then the plugin views, then settings and log', () => {
    expect(destinationsFor([plugin('notes', 'Notas')]).map((d) => d.key)).toEqual(['home', 'notes', 'settings', 'log']);
  });

  it('has only the fixed screens when no plugin has a view', () => {
    expect(destinationsFor([]).map((d) => d.title)).toEqual(['Início', 'Configurações', 'Registro']);
  });
});
