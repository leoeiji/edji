import type { Tool } from '../../core/plugin';
import { addItem, listItems, setDone } from './store';
import { cleanTaskText, normalizeForMatch } from './text';

const addTool: Tool<{ text: string }> = {
  name: 'todo.add',
  description: 'Adiciona uma tarefa à lista.',
  parameters: {
    type: 'object',
    properties: { text: { type: 'string', description: 'Texto da tarefa' } },
    required: ['text'],
  },
  async run({ text }, ctx) {
    const task = cleanTaskText(text);
    if (!task) return { ok: false, reply: 'Não entendi. Pode repetir?' };
    await addItem(ctx.db, task, 'voz');
    ctx.notifyChanged();
    return { ok: true, reply: 'Anotado.' };
  },
};

const listTool: Tool<Record<string, never>> = {
  name: 'todo.list',
  description: 'Lê as tarefas em aberto.',
  parameters: { type: 'object', properties: {} },
  async run(_params, ctx) {
    const open = (await listItems(ctx.db)).filter((i) => !i.done);
    if (open.length === 0) return { ok: true, reply: 'Nada pendente.' };
    const first = open.slice(0, 3).map((i) => i.text).join(', ');
    const more = open.length > 3 ? ` e mais ${open.length - 3}` : '';
    return { ok: true, reply: `${open.length} pendentes: ${first}${more}.` };
  },
};

const completeTool: Tool<{ query: string }> = {
  name: 'todo.complete',
  description: 'Marca como concluída a tarefa em aberto cujo texto contém a busca.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Parte do texto da tarefa' } },
    required: ['query'],
  },
  async run({ query }, ctx) {
    const q = normalizeForMatch(query);
    const open = (await listItems(ctx.db)).filter((i) => !i.done);
    const match = q ? open.find((i) => normalizeForMatch(i.text).includes(q)) : undefined;
    if (!match) return { ok: false, reply: 'Não achei essa tarefa.' };
    await setDone(ctx.db, match.id, true);
    ctx.notifyChanged();
    return { ok: true, reply: 'Feito.' };
  },
};

export const todoTools = [addTool, listTool, completeTool];
