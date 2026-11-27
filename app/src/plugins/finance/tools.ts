import type { Tool, ToolResult } from '@/core/plugin';
import { formatBRL, monthName } from './money';
import {
  categorizeDescription,
  categorizeTransaction,
  categoryForDescription,
  deleteCategory,
  deleteTransaction,
  ensureCategory,
  findCategory,
  insertTransaction,
  listCategories,
  monthCategoryTotals,
  monthTotals,
  recentTransactions,
  renameCategory,
  uncategorizedGroups,
} from './store';
import { MAX_CATEGORY_LENGTH, NO_CATEGORY, parseCategoryName, parseMonth, parseTransaction, type Transaction } from './transaction';

const MAX_RECENT = 20;
const BAD_NAME = `Nome de categoria inválido: vazio, com mais de ${MAX_CATEGORY_LENGTH} letras ou “${NO_CATEGORY}”.`;

/** Descriptions listed per `finance.uncategorized` call; the agent categorizes and asks again. */
export const MAX_UNCATEGORIZED = 40;
/** Items per `finance.categorize` call. */
export const MAX_CATEGORIZE_ITEMS = 50;
/** Named categories read out by `finance.summary`; the rest are summed as "outras". */
const SUMMARY_CATEGORIES = 5;

/** "Por categoria: Mercado R$ 800,00, ... 82% dos gastos têm categoria." Empty when nothing was spent. */
export function describeCategoryTotals(rows: { name: string | null; outCents: number }[]): string {
  const total = rows.reduce((s, r) => s + r.outCents, 0);
  if (total === 0) return '';
  const named = rows.filter((r) => r.name !== null);
  const none = rows.find((r) => r.name === null)?.outCents ?? 0;
  if (named.length === 0) return 'Nenhum gasto tem categoria ainda.';
  const top = named.slice(0, SUMMARY_CATEGORIES).map((r) => `${r.name} ${formatBRL(r.outCents)}`);
  const rest = named.slice(SUMMARY_CATEGORIES).reduce((s, r) => s + r.outCents, 0);
  if (rest > 0) top.push(`outras ${formatBRL(rest)}`);
  if (none > 0) top.push(`sem categoria ${formatBRL(none)}`);
  const covered = Math.floor(((total - none) / total) * 100);
  return `Por categoria: ${top.join(', ')}.${none > 0 ? ` ${covered}% dos gastos têm categoria.` : ''}`;
}

/** Renames a category, merging into another one with the same name. Used by `finance.rename_category` and the screen. */
export async function renameCategoryByName(db: Db, from: string, to: string): Promise<{ ok: true; merged: boolean; name: string } | { ok: false; reason: string }> {
  const source = await findCategory(db, String(from ?? '').trim());
  if (!source) return { ok: false, reason: `Não achei a categoria ${String(from ?? '').trim() || '(vazia)'}.` };
  const name = parseCategoryName(to);
  if (!name) return { ok: false, reason: BAD_NAME };
  const { merged } = await renameCategory(db, source.id, name);
  return { ok: true, merged, name };
}

type Db = Parameters<typeof categorizeDescription>[0];

/** Who to categorize: every entry with a description (ignoring case), or one entry. */
export type CategoryTarget = { description: string } | { id: number };

export type AssignResult = { ok: true; changed: number; category: string | null; created: boolean } | { ok: false; reason: string };

/**
 * Puts [target] in the category called [name], creating it if needed, or
 * takes it out of any category when [name] is null. Used by
 * `finance.categorize` and by the screen. A description covers past entries
 * and, since new entries inherit it, future ones too.
 */
export async function assignCategory(db: Db, target: CategoryTarget, name: string | null, now: number): Promise<AssignResult> {
  let categoryId: number | null = null;
  let category: string | null = null;
  let created = false;
  if (name !== null) {
    category = parseCategoryName(name);
    if (!category) return { ok: false, reason: BAD_NAME };
    ({ id: categoryId, created } = await ensureCategory(db, category, now));
  }
  const changed =
    'id' in target
      ? Number(await categorizeTransaction(db, target.id, categoryId))
      : await categorizeDescription(db, target.description.trim().replace(/\s+/g, ' '), categoryId);
  return { ok: true, changed, category, created };
}

/** "gasto de R$ 45,90 em Padaria" or "entrada de R$ 1.000,00 de Fulano". */
export function describeTransaction(tx: Pick<Transaction, 'direction' | 'amountCents' | 'description'>): string {
  return tx.direction === 'out'
    ? `gasto de ${formatBRL(tx.amountCents)} em ${tx.description}`
    : `entrada de ${formatBRL(tx.amountCents)}: ${tx.description}`;
}

/**
 * Tools of the `finance` plugin. `finance.add` is a routine action: a routine
 * extracts amount and description from a bank notification with its own
 * steps and calls it with no model. No bank format is built in.
 */
export function financeTools(now: () => number = Date.now): Tool<any>[] {
  return [
    {
      name: 'finance.add',
      description:
        'Registra um gasto ou uma entrada de dinheiro. Rotinas podem chamar com dados de notificações do banco; ' +
        'nesse caso passe input.notification_id em dedupKey e input.posted_at em occurredAt.',
      routineAction: true,
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Valor em reais, positivo, ex.: 45.9' },
          direction: { type: 'string', enum: ['out', 'in'], description: 'out: gasto ou pagamento; in: dinheiro recebido' },
          description: { type: 'string', description: 'Loja, pessoa ou motivo' },
          account: { type: 'string', description: 'Opcional: banco ou conta, ex.: "Nubank"' },
          occurredAt: { type: 'string', description: 'Opcional: quando, em ISO 8601; padrão agora' },
          dedupKey: { type: 'string', description: 'Opcional: chave única; o mesmo valor nunca é registrado duas vezes' },
        },
        required: ['amount', 'direction', 'description'],
      },
      run: async (params: Record<string, unknown>, ctx): Promise<ToolResult> => {
        // A dedup key only comes from routines; by voice there is none.
        const parsed = parseTransaction(params, params.dedupKey ? 'routine' : 'agent', now());
        if (!parsed.ok) return { ok: false, reply: parsed.reason };
        // New descriptions stay uncategorized; a known one inherits its last category.
        const categoryId = await categoryForDescription(ctx.db, parsed.tx.description);
        if (!(await insertTransaction(ctx.db, parsed.tx, categoryId, now()))) return { ok: true, reply: 'Já estava anotado.' };
        ctx.notifyChanged();
        return { ok: true, reply: `Anotado: ${describeTransaction(parsed.tx)}.` };
      },
    },
    {
      name: 'finance.summary',
      description: 'Soma os gastos e as entradas de um mês, com os gastos por categoria.',
      parameters: {
        type: 'object',
        properties: { month: { type: 'string', description: 'YYYY-MM; padrão o mês atual' } },
      },
      run: async ({ month }: { month?: string }, ctx): Promise<ToolResult> => {
        const today = new Date(now());
        const [year, m] = month === undefined ? [today.getFullYear(), today.getMonth() + 1] : (parseMonth(month) ?? [0, 0]);
        if (!year) return { ok: false, reply: 'Mês inválido. Use AAAA-MM, ex.: 2026-11.' };
        const [totals, byCategory] = await Promise.all([monthTotals(ctx.db, year, m), monthCategoryTotals(ctx.db, year, m)]);
        if (totals.count === 0) return { ok: true, reply: `Nada registrado em ${monthName(year, m)}.` };
        const categories = describeCategoryTotals(byCategory);
        return {
          ok: true,
          reply:
            `Em ${monthName(year, m)}: gastos ${formatBRL(totals.outCents)}, entradas ${formatBRL(totals.inCents)} (${totals.count} registros).` +
            (categories ? ` ${categories}` : ''),
        };
      },
    },
    {
      name: 'finance.recent',
      description: 'Lista os últimos gastos e entradas com id.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', description: `Quantos, até ${MAX_RECENT}; padrão 5` } },
      },
      run: async ({ limit }: { limit?: number }, ctx): Promise<ToolResult> => {
        const n = Math.min(Math.max(Number.isInteger(limit) ? Number(limit) : 5, 1), MAX_RECENT);
        const txs = await recentTransactions(ctx.db, n);
        if (txs.length === 0) return { ok: true, reply: 'Nada registrado ainda.' };
        return {
          ok: true,
          reply: txs
            .map((t) => `${t.id} · ${new Date(t.occurredAt).toISOString()} · ${describeTransaction(t)} · ${t.category ?? 'sem categoria'}`)
            .join('\n'),
        };
      },
    },
    {
      name: 'finance.uncategorized',
      description:
        'Lista as descrições (lojas, pessoas) com gastos ou entradas sem categoria, e as categorias que já existem. ' +
        'Use antes de finance.categorize quando o usuário pedir para categorizar.',
      // An optional parameter: some providers refuse an object schema with no properties.
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', description: `Quantas descrições, até ${MAX_UNCATEGORIZED}; padrão ${MAX_UNCATEGORIZED}` } },
      },
      run: async ({ limit }: { limit?: number }, ctx): Promise<ToolResult> => {
        const n = Math.min(Math.max(Number.isInteger(limit) ? Number(limit) : MAX_UNCATEGORIZED, 1), MAX_UNCATEGORIZED);
        const [{ groups, descriptions, entries }, categories] = await Promise.all([
          uncategorizedGroups(ctx.db, n),
          listCategories(ctx.db),
        ]);
        const existing = categories.length ? categories.map((c) => c.name).join(', ') : 'nenhuma ainda';
        if (entries === 0) return { ok: true, reply: `Tudo categorizado. Categorias: ${existing}.` };
        const lines = groups.map((g) => {
          const money = [g.outCents ? `gastos ${formatBRL(g.outCents)}` : null, g.inCents ? `entradas ${formatBRL(g.inCents)}` : null];
          return `${g.description} · ${g.count}× · ${money.filter(Boolean).join(', ')}`;
        });
        const more = descriptions > groups.length ? `\n…e mais ${descriptions - groups.length} descrições.` : '';
        return {
          ok: true,
          reply: `Sem categoria: ${entries} registros em ${descriptions} descrições.\n${lines.join('\n')}${more}\nCategorias existentes: ${existing}.`,
        };
      },
    },
    {
      name: 'finance.categorize',
      description:
        'Põe gastos e entradas em categorias, em lote. Por descrição, vale para todos os registros com ela e para os próximos; ' +
        'por id, só para aquele. Reaproveite as categorias existentes (finance.uncategorized lista) e crie novas só quando nenhuma servir. ' +
        'Na dúvida sobre uma descrição, deixe-a de fora e pergunte ao usuário.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_CATEGORIZE_ITEMS,
            items: {
              type: 'object',
              properties: {
                description: { type: 'string', description: 'Descrição exata, como em finance.uncategorized' },
                id: { type: 'integer', description: 'Ou o id de um registro, de finance.recent' },
                category: { type: 'string', description: 'Nome da categoria, ex.: "Mercado"; vazio tira a categoria' },
              },
              required: ['category'],
            },
          },
        },
        required: ['items'],
      },
      run: async ({ items }: { items?: unknown }, ctx): Promise<ToolResult> => {
        if (!Array.isArray(items) || items.length === 0) return { ok: false, reply: 'Mande ao menos um item com descrição ou id e categoria.' };
        if (items.length > MAX_CATEGORIZE_ITEMS) return { ok: false, reply: `No máximo ${MAX_CATEGORIZE_ITEMS} itens por vez.` };
        const done: string[] = [];
        const missing: string[] = [];
        const problems: string[] = [];
        const created = new Set<string>();
        for (const item of items as Record<string, unknown>[]) {
          const target: CategoryTarget | null =
            typeof item?.description === 'string' && item.description.trim()
              ? { description: item.description }
              : Number.isInteger(item?.id)
                ? { id: Number(item.id) }
                : null;
          const label = target === null ? '?' : 'id' in target ? `#${target.id}` : target.description.trim().replace(/\s+/g, ' ');
          if (target === null || typeof item.category !== 'string') {
            problems.push(`${label}: falta descrição ou id, e categoria`);
            continue;
          }
          const result = await assignCategory(ctx.db, target, item.category.trim() ? item.category : null, now());
          if (!result.ok) problems.push(`${label}: ${result.reason}`);
          else if (result.changed === 0) missing.push(label);
          else {
            if (result.created && result.category) created.add(result.category);
            done.push(`${label} → ${result.category ?? 'sem categoria'} (${result.changed})`);
          }
        }
        if (done.length) ctx.notifyChanged();
        const reply = [
          done.length ? `Categorizado: ${done.join('; ')}.` : 'Nada mudou.',
          created.size ? `Categorias novas: ${[...created].join(', ')}.` : null,
          missing.length ? `Não achei: ${missing.join(', ')}.` : null,
          problems.length ? `Problemas: ${problems.join('; ')}.` : null,
        ];
        return { ok: done.length > 0, reply: reply.filter(Boolean).join(' ') };
      },
    },
    {
      name: 'finance.rename_category',
      description:
        'Renomeia uma categoria. Se já existir uma com o novo nome, junta as duas: os registros passam para ela. ' +
        'Só quando o usuário pedir.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Nome atual' },
          to: { type: 'string', description: 'Nome novo, ou de outra categoria para juntar' },
        },
        required: ['from', 'to'],
      },
      run: async ({ from, to }: { from: string; to: string }, ctx): Promise<ToolResult> => {
        const result = await renameCategoryByName(ctx.db, from, to);
        if (!result.ok) return { ok: false, reply: result.reason };
        ctx.notifyChanged();
        return { ok: true, reply: result.merged ? `Juntei em ${result.name}.` : `Agora se chama ${result.name}.` };
      },
    },
    {
      name: 'finance.delete_category',
      description: 'Apaga uma categoria; os registros ficam, sem categoria. Só quando o usuário pedir.',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'Nome da categoria' } }, required: ['name'] },
      run: async ({ name }: { name: string }, ctx): Promise<ToolResult> => {
        const category = await findCategory(ctx.db, String(name ?? '').trim());
        if (!category) return { ok: false, reply: 'Não achei essa categoria.' };
        const n = await deleteCategory(ctx.db, category.id);
        ctx.notifyChanged();
        return { ok: true, reply: `Apaguei ${category.name}. ${n === 1 ? '1 registro ficou' : `${n} registros ficaram`} sem categoria.` };
      },
    },
    {
      name: 'finance.delete',
      description: 'Apaga um registro pelo id. Só quando o usuário pedir.',
      parameters: { type: 'object', properties: { id: { type: 'integer', description: 'Id, de finance.recent' } }, required: ['id'] },
      run: async ({ id }: { id: number }, ctx): Promise<ToolResult> => {
        if (!(await deleteTransaction(ctx.db, Number(id)))) return { ok: false, reply: 'Não achei esse registro.' };
        ctx.notifyChanged();
        return { ok: true, reply: 'Apagado.' };
      },
    },
  ];
}
