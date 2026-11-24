import { handleVoiceCommand, pluginIdOf } from '../agent';
import type { PluginContext, Tool } from '../plugin';

const ctx = {} as PluginContext;
const contextFor = jest.fn(async () => ctx);

describe('handleVoiceCommand (MVP router)', () => {
  beforeEach(() => contextFor.mockClear());

  it('sends the whole transcript to todo.add with its plugin context', async () => {
    const run = jest.fn(async () => ({ ok: true, reply: 'Anotado.' }));
    const add: Tool = { name: 'todo.add', description: '', parameters: { type: 'object', properties: {} }, run };
    const result = await handleVoiceCommand('a gente precisa comprar pão', [add], contextFor);
    expect(result).toEqual({ ok: true, reply: 'Anotado.' });
    expect(run).toHaveBeenCalledWith({ text: 'a gente precisa comprar pão' }, ctx);
    expect(contextFor).toHaveBeenCalledWith('todo');
  });

  it('answers clearly when no enabled plugin takes voice commands', async () => {
    const result = await handleVoiceCommand('comprar pão', [], contextFor);
    expect(result.ok).toBe(false);
    expect(result.reply).toMatch(/Nenhum plugin/);
  });

  it('turns a tool exception into a failed result', async () => {
    const add: Tool = {
      name: 'todo.add',
      description: '',
      parameters: { type: 'object', properties: {} },
      run: async () => {
        throw new Error('disco cheio');
      },
    };
    const result = await handleVoiceCommand('comprar pão', [add], contextFor);
    expect(result).toEqual({ ok: false, reply: 'Falha em todo.add: disco cheio' });
  });

  it('derives the plugin id from the tool name', () => {
    expect(pluginIdOf('todo.complete')).toBe('todo');
  });
});
