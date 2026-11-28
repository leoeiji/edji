import type { Plugin, Tool } from '../plugin';
import { applyEnabledStates, availableTools, enabledPlugins, isEnabled, toolLabel, validatePlugins } from '../registry';

const tool = (name: string): Tool => ({
  name,
  label: 'Adicionar',
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

  it('accepts routine actions only with flat parameters and never from routines', () => {
    const action = (properties: Tool['parameters']['properties']): Tool => ({ ...tool('todo.add'), routineAction: true, parameters: { type: 'object', properties } });
    expect(() => validatePlugins([{ ...todo, tools: [action({ text: { type: 'string' }, n: { type: 'integer' } })] }])).not.toThrow();
    expect(() =>
      validatePlugins([{ ...todo, tools: [action({ tags: { type: 'array', items: { type: 'string' } } })] }]),
    ).toThrow('routine action parameter "tags"');
    const routines: Plugin = { ...todo, id: 'routines', tools: [{ ...tool('routines.create'), routineAction: true }] };
    expect(() => validatePlugins([routines])).toThrow("routines tools can't be routine actions");
  });

  it('reserves the ids of the skill origins and tools', () => {
    for (const id of ['skills', 'system', 'user']) expect(() => validatePlugins([{ ...todo, id }])).toThrow('reserved');
  });

  it('checks plugin skills: unique ids and filled text', () => {
    const skill = { id: 'analyze', name: 'Analisar', when: 'Quando pedir.', instructions: 'Passos.' };
    expect(() => validatePlugins([{ ...todo, skills: [skill] }])).not.toThrow();
    expect(() => validatePlugins([{ ...todo, skills: [skill, skill] }])).toThrow('Duplicate skill "todo.analyze"');
    expect(() => validatePlugins([{ ...todo, skills: [{ ...skill, id: 'Analisar' }] }])).toThrow('Invalid skill id');
    expect(() => validatePlugins([{ ...todo, skills: [{ ...skill, when: ' ' }] }])).toThrow('needs a name');
  });

  it('labels the core skill tools', () => {
    expect(toolLabel([], 'skills.load')).toBe('Skills · Ler skill');
  });

  it('requires migrations numbered from 1 without gaps', () => {
    expect(() => validatePlugins([{ ...todo, migrations: [{ version: 2, sql: '' }] }])).toThrow('numbered');
    expect(() => validatePlugins([{ ...todo, migrations: [{ version: 1, sql: '' }, { version: 2, sql: '' }] }])).not.toThrow();
  });
});

describe('applyEnabledStates', () => {
  it('tells each plugin whether it is on, and survives a failing hook', async () => {
    const onEnabledChange = jest.fn();
    const broken = { ...agenda, onEnabledChange: () => Promise.reject(new Error('no native')) };
    await applyEnabledStates([{ ...todo, onEnabledChange }, broken], { todo: false });
    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });
});

describe('tool labels', () => {
  it('rejects a tool without a label', () => {
    const bad: Plugin = { ...todo, tools: [{ ...tool('todo.add'), label: ' ' }] };
    expect(() => validatePlugins([bad])).toThrow('needs a label');
  });

  it('reads as plugin name and action, or the technical name when the tool is gone', () => {
    expect(toolLabel([todo, agenda], 'agenda.add')).toBe('Agenda · Adicionar');
    expect(toolLabel([todo], 'agenda.add')).toBe('agenda.add');
  });
});
