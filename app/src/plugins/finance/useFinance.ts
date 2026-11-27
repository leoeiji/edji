import { useCallback, useEffect, useMemo, useState } from 'react';
import { onChanged } from '@/core/events';
import type { PluginContext } from '@/core/plugin';
import { buildMonthStory, type MonthStory } from './insights';
import { deleteCategory, listCategoriesWithCounts, transactionsBetween } from './store';
import { assignCategory, renameCategoryByName, type AssignResult, type CategoryTarget } from './tools';
import { monthRange, type CategoryWithCount, type Transaction } from './transaction';

export type MonthRef = { year: number; month: number };

export type FinanceData = MonthRef & {
  transactions: Transaction[];
  previous: Transaction[];
  /** Two months back, only to find recurring charges. */
  older: Transaction[];
  categories: CategoryWithCount[];
  inCents: number;
  outCents: number;
};

const thisMonth = (): MonthRef => ({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 });
const shift = ({ year, month }: MonthRef, by: number): MonthRef => {
  const d = new Date(year, month - 1 + by, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
};

/**
 * A month's entries (and last month's, to compare), the user's categories and
 * the month's story. Reloads when `finance` data changes (a tool, a routine or
 * this screen wrote).
 */
export function useFinance(ctx: PluginContext) {
  const [shown, setShown] = useState<MonthRef>(thisMonth);
  const [data, setData] = useState<FinanceData | null>(null);

  const reload = useCallback(async () => {
    const prev = shift(shown, -1);
    const old = shift(shown, -2);
    const [from, to] = monthRange(shown.year, shown.month);
    const [prevFrom] = monthRange(prev.year, prev.month);
    const [oldFrom] = monthRange(old.year, old.month);
    const [transactions, previous, older, categories] = await Promise.all([
      transactionsBetween(ctx.db, from, to),
      transactionsBetween(ctx.db, prevFrom, from),
      transactionsBetween(ctx.db, oldFrom, prevFrom),
      listCategoriesWithCounts(ctx.db),
    ]);
    const total = (d: Transaction['direction']) => transactions.filter((t) => t.direction === d).reduce((s, t) => s + t.amountCents, 0);
    setData({ ...shown, transactions, previous, older, categories, inCents: total('in'), outCents: total('out') });
  }, [ctx, shown]);

  useEffect(() => {
    reload();
    return onChanged('finance', reload);
  }, [reload]);

  const story: MonthStory | null = useMemo(
    () => (data ? buildMonthStory(data.transactions, data.previous, data.year, data.month, Date.now(), data.older) : null),
    [data],
  );

  const now = thisMonth();
  const isCurrent = shown.year === now.year && shown.month === now.month;

  const done = useCallback(
    <T extends { ok: boolean }>(result: T): T => {
      if (result.ok) ctx.notifyChanged();
      return result;
    },
    [ctx],
  );

  return {
    data,
    story,
    reload,
    isCurrent,
    previousMonth: () => setShown((m) => shift(m, -1)),
    nextMonth: () => setShown((m) => (isCurrent ? m : shift(m, 1))),
    /** Puts [target] in category [name] (created if new) or in none. */
    categorize: async (target: CategoryTarget, name: string | null): Promise<AssignResult> =>
      done(await assignCategory(ctx.db, target, name, Date.now())),
    /** Renames a category; a name already in use merges the two. */
    renameCategory: async (from: string, to: string) => done(await renameCategoryByName(ctx.db, from, to)),
    /** Removes a category; its entries stay, without one. */
    deleteCategory: async (id: number) => done({ ok: true as const, count: await deleteCategory(ctx.db, id) }),
  };
}
