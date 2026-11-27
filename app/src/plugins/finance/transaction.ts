import { toCents } from './money';

/** `out`: a purchase or payment; `in`: money received. */
export type Direction = 'out' | 'in';

/** One entry of the ledger (`finance_transactions`). Amounts are positive cents; [direction] gives the sign. */
export type Transaction = {
  id: number;
  amountCents: number;
  direction: Direction;
  description: string;
  account: string | null;
  occurredAt: number;
  /** `routine` when a routine recorded it, `agent` when asked by voice. */
  source: 'routine' | 'agent';
  /** Null until the user or the agent picks one; a new entry inherits the category of the last one with the same description. */
  categoryId: number | null;
  category: string | null;
};

export type NewTransaction = Omit<Transaction, 'id' | 'categoryId' | 'category'> & { dedupKey: string | null };

/** A user category (`finance_categories`). None is built in. */
export type Category = { id: number; name: string };

export type CategoryWithCount = Category & { count: number };

export type TransactionResult = { ok: true; tx: NewTransaction } | { ok: false; reason: string };

export const MAX_DESCRIPTION_LENGTH = 100;
const MAX_ACCOUNT_LENGTH = 40;
const MAX_DEDUP_KEY_LENGTH = 200;
/** One billion reais: anything above is a parsing mistake, not a purchase. */
const MAX_CENTS = 100_000_000_000;

export const TX_ERRORS = {
  badAmount: 'Valor inválido. Use um número maior que zero, em reais.',
  badDirection: 'Diga se é gasto (out) ou entrada (in).',
  noDescription: 'Falta a descrição, ex.: o nome da loja.',
  badDate: 'Data inválida. Use ISO 8601, ex.: 2026-11-26T10:30:00Z.',
} as const;

/**
 * Checks the input of `finance.add`. Never throws. Routines call it with
 * values pulled from notifications, so everything is checked here, not trusted.
 */
export function parseTransaction(input: Record<string, unknown>, source: Transaction['source'], now: number): TransactionResult {
  const amount = typeof input.amount === 'number' ? input.amount : Number.NaN;
  const amountCents = Number.isFinite(amount) ? toCents(amount) : Number.NaN;
  if (!(amountCents > 0) || amountCents > MAX_CENTS) return { ok: false, reason: TX_ERRORS.badAmount };
  if (input.direction !== 'out' && input.direction !== 'in') return { ok: false, reason: TX_ERRORS.badDirection };
  const description = typeof input.description === 'string' ? input.description.trim().replace(/\s+/g, ' ') : '';
  if (!description) return { ok: false, reason: TX_ERRORS.noDescription };
  const account = typeof input.account === 'string' && input.account.trim() ? input.account.trim().slice(0, MAX_ACCOUNT_LENGTH) : null;
  let occurredAt = now;
  if (typeof input.occurredAt === 'string' && input.occurredAt.trim()) {
    occurredAt = Date.parse(input.occurredAt.trim());
    if (!Number.isFinite(occurredAt)) return { ok: false, reason: TX_ERRORS.badDate };
  }
  const dedupKey = typeof input.dedupKey === 'string' && input.dedupKey.trim() ? input.dedupKey.trim().slice(0, MAX_DEDUP_KEY_LENGTH) : null;
  return {
    ok: true,
    tx: {
      amountCents,
      direction: input.direction,
      description: description.slice(0, MAX_DESCRIPTION_LENGTH),
      account,
      occurredAt,
      source,
      dedupKey,
    },
  };
}

/** Start (inclusive) and end (exclusive) of a local month, in ms. [month] is 1-12. */
export function monthRange(year: number, month: number): [number, number] {
  return [new Date(year, month - 1, 1).getTime(), new Date(year, month, 1).getTime()];
}

/** `YYYY-MM` → [year, month], or null. */
export function parseMonth(input: unknown): [number, number] | null {
  const m = typeof input === 'string' ? input.trim().match(/^(\d{4})-(0[1-9]|1[0-2])$/) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export const MAX_CATEGORY_LENGTH = 40;

/** What the screens call entries without a category; no category may take this name. */
export const NO_CATEGORY = 'Sem categoria';

/** Trims, collapses spaces and capitalizes the first letter ("  delivery " → "Delivery"). Null when empty, too long or "Sem categoria". */
export function parseCategoryName(input: unknown): string | null {
  const name = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > MAX_CATEGORY_LENGTH || name.toLocaleLowerCase('pt-BR') === NO_CATEGORY.toLocaleLowerCase('pt-BR')) return null;
  return name.charAt(0).toLocaleUpperCase('pt-BR') + name.slice(1);
}

export type MonthTotals = { outCents: number; inCents: number; count: number };
