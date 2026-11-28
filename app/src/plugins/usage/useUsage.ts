import { useCallback, useEffect, useMemo, useState } from 'react';
import { listConversations } from '@/core/chatStore';
import { onChanged } from '@/core/events';
import type { PluginContext } from '@/core/plugin';
import { USAGE_TOPIC, firstStepAt, stepsBetween, type UsageStep } from '@/core/usage';
import { monthRange, usageStory } from './insights';

type Data = { year: number; month: number; steps: UsageStep[]; previous: UsageStep[]; titles: Map<number, string>; firstAt: number | null };

/** A month of usage from the core's `usage_steps`, reloaded as new steps land. Starts on the current month. */
export function useUsage(ctx: PluginContext) {
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [data, setData] = useState<Data | null>(null);

  const reload = useCallback(async () => {
    const { year, month } = ym;
    const [from, to] = monthRange(year, month);
    const [prevFrom] = monthRange(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);
    const [steps, previous, conversations, firstAt] = await Promise.all([
      stepsBetween(ctx.db, from, to),
      stepsBetween(ctx.db, prevFrom, from),
      listConversations(ctx.db),
      firstStepAt(ctx.db),
    ]);
    setData({ year, month, steps, previous, titles: new Map(conversations.map((c) => [c.id, c.title])), firstAt });
  }, [ctx.db, ym]);

  useEffect(() => {
    reload();
    return onChanged(USAGE_TOPIC, () => {
      reload();
    });
  }, [reload]);

  const isCurrent = ym.year === now.getFullYear() && ym.month === now.getMonth() + 1;
  const story = useMemo(
    () =>
      data &&
      usageStory({ ...data, throughDay: data.year === now.getFullYear() && data.month === now.getMonth() + 1 ? now.getDate() : null }),
    // `now` changes every render; the day only matters when the data reloads.
    [data],
  );
  const canGoBack = data?.firstAt !== null && data?.firstAt !== undefined && data.firstAt < monthRange(ym.year, ym.month)[0];

  return {
    data,
    story,
    isCurrent,
    canGoBack,
    reload,
    previousMonth: () => setYm(({ year, month }) => (month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 })),
    nextMonth: () => setYm(({ year, month }) => (month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 })),
  };
}
