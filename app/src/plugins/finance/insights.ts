import { formatBRL, formatBRLRounded, monthOnly } from './money';
import { NO_CATEGORY, type Transaction } from './transaction';

/**
 * Facts about a month of spending, computed on the device with no model
 * (deterministic: the same entries always give the same sentences). Sentences
 * describe what changed, never why. Only spending (`out`) counts.
 */

/** Below this share of spending with a category, the per-category sections are hidden instead of telling a wrong story. */
export const MIN_COVERAGE = 0.6;
/**
 * A recurring charge (rent, a subscription): a description seen exactly once
 * in each of the last three months, every amount within 10% of this month's.
 * Two months were not enough: a pharmacy visited once a month passed.
 */
const RECURRING_TOLERANCE = 0.1;
/** Small things that add up: at least this many purchases, each below the month's median purchase. */
const SMALL_MIN_COUNT = 4;
const SMALL_MAX_ITEMS = 3;
/** Frequency share of an increase above which (or below 1 minus which) the headline names one cause. */
const SPLIT_DOMINANT = 0.7;
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export type CategoryChange = { name: string; uncategorized: boolean; nowCents: number; beforeCents: number; diffCents: number };

export type SplitRow = {
  name: string;
  diffCents: number;
  /** Part of the increase from buying more often, and from each purchase costing more; they add up to [diffCents]. */
  frequencyCents: number;
  priceCents: number;
  countBefore: number;
  countNow: number;
  avgBeforeCents: number;
  avgNowCents: number;
  caption: string;
};

export type DayCell = {
  day: number;
  weekday: number;
  future: boolean;
  /** Spending of the day without recurring charges, which would flatten the scale. */
  cents: number;
  /** 0 nothing, 1-4 by quartile of the month's spending days. */
  level: 0 | 1 | 2 | 3 | 4;
  hasRecurring: boolean;
};

export type SmallThing = { description: string; count: number; totalCents: number; avgCents: number; yearlyCents: number };
export type RecurringCharge = { description: string; cents: number };

export type MonthStory = {
  headline: string;
  sub: string | null;
  spentCents: number;
  /** Share of spending with a category, 0-1 (1 when nothing was spent). */
  coverage: number;
  showCategories: boolean;
  /** Per category against the same days of last month; null without last month's data. */
  changes: { headline: string | null; rows: CategoryChange[] } | null;
  split: { headline: string; rows: SplitRow[] } | null;
  calendar: { headline: string | null; firstWeekday: number; days: DayCell[] };
  small: SmallThing[];
  recurring: { items: RecurringCharge[]; monthlyCents: number };
};

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const key = (description: string) => description.toLocaleLowerCase('pt-BR');
const sum = (txs: Transaction[]) => txs.reduce((s, t) => s + t.amountCents, 0);
const dayOf = (t: Transaction) => new Date(t.occurredAt).getDate();

/**
 * Builds the story of [year]/[month] (1-12) from its entries ([current]),
 * last month's ([previous]) and the month before that ([older], only to find
 * recurring charges), as of [now]. A past month is read whole; the current
 * one up to today, against the same days of last month.
 */
export function buildMonthStory(
  current: Transaction[],
  previous: Transaction[],
  year: number,
  month: number,
  now: number,
  older: Transaction[] = [],
): MonthStory {
  const today = new Date(now);
  const isCurrent = today.getFullYear() === year && today.getMonth() + 1 === month;
  const total = daysInMonth(year, month);
  const day = isCurrent ? today.getDate() : total;
  const [prevYear, prevMonth] = month === 1 ? [year - 1, 12] : [year, month - 1];
  // The current month runs against the same days of last month; a past one against the whole of it.
  const cut = isCurrent ? Math.min(day, daysInMonth(prevYear, prevMonth)) : daysInMonth(prevYear, prevMonth);

  const out = current.filter((t) => t.direction === 'out' && dayOf(t) <= day);
  const prevOut = previous.filter((t) => t.direction === 'out');
  const prevSame = prevOut.filter((t) => dayOf(t) <= cut);
  const olderOut = older.filter((t) => t.direction === 'out');
  const recurringTx = recurringIds(out, prevOut, olderOut);
  const spent = sum(out);
  const before = sum(prevSame);
  const categorized = sum(out.filter((t) => t.categoryId !== null));
  const coverage = spent === 0 ? 1 : categorized / spent;
  const showCategories = coverage >= MIN_COVERAGE;
  const compare = prevOut.length > 0 && before > 0;

  // Headline
  const name = monthOnly(month);
  const prevName = monthOnly(prevMonth);
  let headline: string;
  let sub: string | null = null;
  if (compare) {
    const diff = spent - before;
    headline =
      Math.abs(diff) < before * 0.02
        ? `${capitalize(name)} está igual a ${prevName}.`
        : `${capitalize(name)} está ${formatBRLRounded(Math.abs(diff))} mais ${diff > 0 ? 'caro' : 'barato'} que ${prevName}.`;
    sub = `${formatBRL(spent)} ${isCurrent ? 'até hoje' : 'no mês'}, contra ${formatBRL(before)} ${isCurrent ? `até o dia ${cut} de ${prevName}` : `em ${prevName}`}.`;
  } else {
    headline = `Você gastou ${formatBRLRounded(spent)} em ${name}${isCurrent ? ' até agora' : ''}.`;
  }

  return {
    headline,
    sub,
    spentCents: spent,
    coverage,
    showCategories,
    changes: compare ? changes(out, prevSame) : null,
    split: compare && showCategories ? split(out, prevSame) : null,
    calendar: calendar(out, recurringTx, year, month, day, total),
    small: small(out, day),
    recurring: recurring(out, recurringTx),
  };
}

function byCategory(txs: Transaction[]): Map<string, { name: string; uncategorized: boolean; txs: Transaction[] }> {
  const groups = new Map<string, { name: string; uncategorized: boolean; txs: Transaction[] }>();
  for (const t of txs) {
    const k = t.categoryId === null ? '' : String(t.categoryId);
    const g = groups.get(k) ?? { name: t.category ?? NO_CATEGORY, uncategorized: t.categoryId === null, txs: [] };
    g.txs.push(t);
    groups.set(k, g);
  }
  return groups;
}

function changes(out: Transaction[], prevSame: Transaction[]): MonthStory['changes'] {
  const now = byCategory(out);
  const before = byCategory(prevSame);
  const rows: CategoryChange[] = [...new Set([...now.keys(), ...before.keys()])].map((k) => {
    const g = now.get(k) ?? before.get(k)!;
    const n = sum(now.get(k)?.txs ?? []);
    const b = sum(before.get(k)?.txs ?? []);
    return { name: g.name, uncategorized: g.uncategorized, nowCents: n, beforeCents: b, diffCents: n - b };
  });
  rows.sort((a, b) => b.diffCents - a.diffCents);
  const named = rows.filter((r) => !r.uncategorized);
  const up = named[0]?.diffCents > 0 ? named[0] : null;
  const down = named.length && named[named.length - 1].diffCents < 0 ? named[named.length - 1] : null;
  const parts = [
    up ? `${up.name} subiu ${formatBRLRounded(up.diffCents)}.` : null,
    down ? `${down.name} caiu ${formatBRLRounded(-down.diffCents)}.` : null,
  ].filter(Boolean);
  return { headline: parts.length ? parts.join(' ') : null, rows };
}

function split(out: Transaction[], prevSame: Transaction[]): MonthStory['split'] {
  const now = byCategory(out);
  const before = byCategory(prevSame);
  const rows: SplitRow[] = [];
  for (const [k, g] of now) {
    if (g.uncategorized) continue;
    const n = g.txs;
    const b = before.get(k)?.txs ?? [];
    const diff = sum(n) - sum(b);
    if (diff <= 0) continue;
    const avgNow = sum(n) / n.length;
    const avgBefore = b.length ? sum(b) / b.length : 0;
    // A category new this month is all frequency: there was no price to compare.
    const frequency = b.length ? (n.length - b.length) * avgBefore : diff;
    const price = diff - frequency;
    const change = Math.round(avgNow - avgBefore);
    const priceText = !b.length
      ? 'nova neste mês'
      : Math.abs(change) < 50
        ? 'mesmo valor médio'
        : `cada compra ${formatBRL(Math.abs(change))} mais ${change > 0 ? 'cara' : 'barata'} (${formatBRL(avgBefore)} → ${formatBRL(avgNow)})`;
    rows.push({
      name: g.name,
      diffCents: diff,
      frequencyCents: Math.round(frequency),
      priceCents: Math.round(price),
      countBefore: b.length,
      countNow: n.length,
      avgBeforeCents: Math.round(avgBefore),
      avgNowCents: Math.round(avgNow),
      caption: `${b.length} → ${n.length} ${n.length === 1 ? 'compra' : 'compras'} · ${priceText}`,
    });
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => b.diffCents - a.diffCents);
  // Negative parts (fewer purchases, or cheaper ones) don't count toward the share, so it stays within 0-100%.
  const f = rows.reduce((s, r) => s + Math.max(0, r.frequencyCents), 0);
  const p = rows.reduce((s, r) => s + Math.max(0, r.priceCents), 0);
  const share = f + p === 0 ? 0.5 : f / (f + p);
  const headline =
    share >= SPLIT_DOMINANT
      ? `${Math.round(share * 100)}% do aumento veio de comprar mais vezes.`
      : share <= 1 - SPLIT_DOMINANT
        ? `${Math.round((1 - share) * 100)}% do aumento veio de compras mais caras.`
        : 'O aumento veio tanto de comprar mais vezes quanto de compras mais caras.';
  return { headline, rows };
}

/** Ids of the entries of [out] that are recurring charges (see RECURRING_TOLERANCE). */
function recurringIds(out: Transaction[], prevOut: Transaction[], olderOut: Transaction[]): Set<number> {
  const group = (txs: Transaction[]) => {
    const m = new Map<string, Transaction[]>();
    for (const t of txs) m.set(key(t.description), [...(m.get(key(t.description)) ?? []), t]);
    return m;
  };
  const months = [group(prevOut), group(olderOut)];
  const ids = new Set<number>();
  for (const [k, txs] of group(out)) {
    if (txs.length !== 1) continue;
    const t = txs[0];
    const near = (m: Map<string, Transaction[]>) => {
      const other = m.get(k);
      return other?.length === 1 && Math.abs(other[0].amountCents - t.amountCents) <= t.amountCents * RECURRING_TOLERANCE;
    };
    if (months.every(near)) ids.add(t.id);
  }
  return ids;
}

function recurring(out: Transaction[], ids: Set<number>): MonthStory['recurring'] {
  const by = new Map<string, RecurringCharge>();
  for (const t of out) {
    if (!ids.has(t.id)) continue;
    const r = by.get(key(t.description)) ?? { description: t.description, cents: 0 };
    r.cents += t.amountCents;
    by.set(key(t.description), r);
  }
  const items = [...by.values()].sort((a, b) => b.cents - a.cents);
  return { items, monthlyCents: items.reduce((s, r) => s + r.cents, 0) };
}

function calendar(out: Transaction[], ids: Set<number>, year: number, month: number, day: number, total: number): MonthStory['calendar'] {
  const cents = new Array<number>(total + 1).fill(0);
  const any = new Array<boolean>(total + 1).fill(false);
  const fixed = new Array<boolean>(total + 1).fill(false);
  for (const t of out) {
    const d = dayOf(t);
    any[d] = true;
    if (ids.has(t.id)) fixed[d] = true;
    else cents[d] += t.amountCents;
  }
  const spending = cents.slice(1, day + 1).filter((c) => c > 0).sort((a, b) => a - b);
  const q = (p: number) => spending[Math.min(spending.length - 1, Math.floor(p * spending.length))];
  const level = (c: number): DayCell['level'] => (c <= 0 ? 0 : c <= q(0.25) ? 1 : c <= q(0.5) ? 2 : c <= q(0.75) ? 3 : 4);
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const days: DayCell[] = [];
  for (let d = 1; d <= total; d++) {
    const future = d > day;
    days.push({ day: d, weekday: (firstWeekday + d - 1) % 7, future, cents: future ? 0 : cents[d], level: future ? 0 : level(cents[d]), hasRecurring: fixed[d] });
  }
  let headline: string | null = null;
  const past = days.filter((d) => !d.future);
  const top = past.reduce<DayCell | null>((best, d) => (d.cents > (best?.cents ?? 0) ? d : best), null);
  if (top) {
    const free = past.filter((d) => !any[d.day]).length;
    const freeText = free === 0 ? 'Não teve dia sem gasto.' : free === 1 ? '1 dia sem gastar nada.' : `${free} dias sem gastar nada.`;
    headline = `${freeText} O dia mais caro foi ${WEEKDAYS[top.weekday]}, ${top.day}/${month}: ${formatBRLRounded(top.cents)}.`;
  }
  return { headline, firstWeekday, days };
}

function small(out: Transaction[], day: number): SmallThing[] {
  if (out.length === 0) return [];
  const amounts = out.map((t) => t.amountCents).sort((a, b) => a - b);
  const median = amounts[Math.floor(amounts.length / 2)];
  const by = new Map<string, Transaction[]>();
  for (const t of out) by.set(key(t.description), [...(by.get(key(t.description)) ?? []), t]);
  return [...by.values()]
    .filter((txs) => txs.length >= SMALL_MIN_COUNT && sum(txs) / txs.length <= median)
    .map((txs) => ({
      description: txs[0].description,
      count: txs.length,
      totalCents: sum(txs),
      avgCents: Math.round(sum(txs) / txs.length),
      yearlyCents: Math.round((sum(txs) / day) * 365),
    }))
    .sort((a, b) => b.totalCents - a.totalCents)
    .slice(0, SMALL_MAX_ITEMS);
}
