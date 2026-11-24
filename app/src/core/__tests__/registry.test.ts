import type { Plugin, Tool } from '../plugin';
import { availableTools, enabledPlugins, isEnabled, validatePlugins } from '../registry';

const tool = (name: string): Tool => ({
  name,
  description: name,
  parameters: { type: 'object', properties: {} },
  run: async () => ({ ok: true, reply: 'ok' }),
});

const todo: Plugin = { id: 'todo', name: 'Tarefas', version: '1', enabledByDefault: true, tools: [tool('todo.add')] };
const agenda: Plugin = { id: 'agenda', name: 'Agenda', version: '1', enabledByDefault: false, tools: [tool('agenda.add')] };

describe('registry', () => {
  it('uses the plugin default when there is no stored state', () => {
    expect(isEnabled(todo, {})).toBe(true);
    expect(isEnabled(agenda, {})).toBe(false);
  });

  it('stored state overrides the default', () => {
    expect(isEnabled(todo, { todo: false })).toBe(false);
    expect(isEnabled(agenda, { agenda: true })).toBe(true);
  });

  it('offers only tools of enabled plugins', () => {
    expect(availableTools([todo, agenda], {}).map((t) => t.name)).toEqual(['todo.add']);
    expect(availableTools([todo, agenda], { todo: false, agenda: true }).map((t) => t.name)).toEqual(['agenda.add']);
    expect(availableTools([todo, agenda], { todo: false })).toEqual([]);
  });

  it('lists enabled plugins in declaration order', () => {
    expect(enabledPlugins([todo, agenda], { agenda: true }).map((p) => p.id)).toEqual(['todo', 'agenda']);
  });

  it('rejects tools outside the plugin namespace', () => {
    expect(() => validatePlugins([{ ...todo, tools: [tool('add')] }])).toThrow('must start with "todo."');
  });

  it('rejects duplicate plugin ids and tool names', () => {
    expect(() => validatePlugins([todo, todo])).toThrow('Duplicate plugin id');
    expect(() => validatePlugins([{ ...todo, tools: [tool('todo.add'), tool('todo.add')] }])).toThrow('Duplicate tool');
  });

  it('requires migrations numbered from 1 without gaps', () => {
    expect(() => validatePlugins([{ ...todo, migrations: [{ version: 2, sql: '' }] }])).toThrow('numbered');
    expect(() => validatePlugins([{ ...todo, migrations: [{ version: 1, sql: '' }, { version: 2, sql: '' }] }])).not.toThrow();
  });
});
