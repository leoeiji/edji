import type { Plugin, PluginContext, Tool, ToolResult } from '../plugin';
import { listSkills } from './catalog';
import { bumpLoadCount, createUserSkill, deleteUserSkill, updateUserSkill } from './store';
import type { Skill } from './types';
import { SKILL_TOOL_LABELS } from './types';

const READ_ONLY = 'Essa skill vem do sistema ou de um plugin e não pode ser alterada. Crie uma skill da pessoa com o texto adaptado.';

const fail = (reply: string): ToolResult => ({ ok: false, reply });

function idsHint(skills: Skill[]): string {
  const ids = skills.filter((s) => s.enabled).map((s) => s.id);
  return ids.length ? ` Skills disponíveis: ${ids.join(', ')}.` : '';
}

/**
 * The core's own tools for skills (ADR 0010): `skills.load` reads one;
 * `create`, `update` and `delete` change only the user's skills. They are not
 * plugin tools and never `routineAction`, so routines don't get them.
 */
export function skillTools(plugins: Plugin[]): Tool<any>[] {
  const all = (ctx: PluginContext) => listSkills(ctx.db, plugins);
  const idParam = { type: 'string', description: 'Id da skill, como no catálogo (ex.: user.resumo_da_semana).' } as const;

  const load: Tool<{ id: string }> = {
    name: 'skills.load',
    label: SKILL_TOOL_LABELS['skills.load'],
    description: 'Lê as instruções de uma skill do catálogo. Use quando o pedido combinar com o "quando usar" dela.',
    parameters: { type: 'object', properties: { id: idParam }, required: ['id'] },
    async run({ id }, ctx) {
      const skills = await all(ctx);
      const skill = skills.find((s) => s.id === id);
      if (!skill || !skill.enabled) return fail(`Não achei a skill ${String(id)}.${idsHint(skills)}`);
      if (skill.editable) await bumpLoadCount(ctx.db, skill.id);
      return { ok: true, reply: `# ${skill.name}\n${skill.instructions}` };
    },
  };

  const create: Tool<{ name: string; when: string; instructions: string }> = {
    name: 'skills.create',
    label: SKILL_TOOL_LABELS['skills.create'],
    description:
      'Cria uma skill da pessoa. Só faça isso quando ela pedir. Antes, leia a skill system.write_skill para escrever bem.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome curto.' },
        when: { type: 'string', description: 'Uma frase com o momento do pedido em que a skill vale. Não o conteúdo.' },
        instructions: { type: 'string', description: 'Passos curtos, citando as ferramentas pelo nome.' },
      },
      required: ['name', 'when', 'instructions'],
    },
    async run(params, ctx) {
      const r = await createUserSkill(ctx.db, params, 'agent');
      return r.ok ? { ok: true, reply: `Skill criada: ${r.skill.id} (${r.skill.name}).` } : fail(r.reason);
    },
  };

  const update: Tool<{ id: string; name?: string; when?: string; instructions?: string; enabled?: boolean }> = {
    name: 'skills.update',
    label: SKILL_TOOL_LABELS['skills.update'],
    description: 'Altera uma skill da pessoa (só as que começam com user.). Só faça isso quando ela pedir. Passe só o que muda.',
    parameters: {
      type: 'object',
      properties: {
        id: idParam,
        name: { type: 'string' },
        when: { type: 'string' },
        instructions: { type: 'string' },
        enabled: { type: 'boolean', description: 'Liga ou desliga a skill no catálogo.' },
      },
      required: ['id'],
    },
    async run({ id, ...patch }, ctx) {
      if (!String(id).startsWith('user.')) return fail(READ_ONLY);
      const r = await updateUserSkill(ctx.db, id, patch);
      return r.ok ? { ok: true, reply: `Skill alterada: ${r.skill.id}.` } : fail(r.reason);
    },
  };

  const remove: Tool<{ id: string }> = {
    name: 'skills.delete',
    label: SKILL_TOOL_LABELS['skills.delete'],
    description: 'Apaga uma skill da pessoa (só as que começam com user.). Só faça isso quando ela pedir.',
    parameters: { type: 'object', properties: { id: idParam }, required: ['id'] },
    async run({ id }, ctx) {
      if (!String(id).startsWith('user.')) return fail(READ_ONLY);
      return (await deleteUserSkill(ctx.db, id)) ? { ok: true, reply: `Skill apagada: ${id}.` } : fail(`Não achei a skill ${id}.`);
    },
  };

  return [load, create, update, remove];
}
