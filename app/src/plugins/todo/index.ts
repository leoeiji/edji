import type { Plugin } from '../../core/plugin';
import { migrations } from './store';
import { todoTools } from './tools';
import { TodoView } from './TodoView';

/** To-do list: side-panel view plus tools to add, list and complete tasks. */
export const todoPlugin: Plugin = {
  id: 'todo',
  name: 'Tarefas',
  version: '0.1.0',
  enabledByDefault: true,
  tools: todoTools,
  view: { title: 'Tarefas', Component: TodoView },
  migrations,
};
