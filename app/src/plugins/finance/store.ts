import type { SQLiteDatabase } from 'expo-sqlite';
import type { Category, CategoryWithCount, MonthTotals, NewTransaction, Transaction } from './transaction';
import { monthRange } from './transaction';

type Db = Pick<SQLiteDatabase, 'runAsync' | 'getAllAsync' | 'getFirstAsync'>;

type Row = {
  id: number;
  amount_cents: number;
  direction: Transaction['direction'];
  description: string;
  account: string | null;
  occurred_at: number;
  source: Transaction['source'];
  category_id: number | null;
  category: string | null;
};

/** Entries of descriptions that have no category yet, grouped (`finance.uncategorized`). */
export type UncategorizedGroup = { description: string; count: number; outCents: number; inCents: number };

/**
 * Schema of the `finance` plugin, in `edji.db`. `dedup_key` is unique so a
 * retried routine never records twice. 2: user categories; an entry points
 * to one or to none. `category_by_description` is 0 when the category was set
 * for that entry only, so new entries don't inherit it.
 */
export const FINANCE_MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE finance_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        direction TEXT NOT NULL CHECK (direction IN ('out', 'in')),
        description TEXT NOT NULL,
        account TEXT,
        occurred_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        dedup_key TEXT UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX finance_transactions_occurred_at ON finance_transactions (occurred_at);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE finance_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at INTEGER NOT NULL
      );
      ALTER TABLE finance_transactions ADD COLUMN category_id INTEGER;
      ALTER TABLE finance_transactions ADD COLUMN category_by_description INTEGER NOT NULL DEFAULT 1;
      CREATE INDEX finance_transactions_category ON finance_transactions (category_id);
      CREATE INDEX finance_transactions_description ON finance_transactions (description COLLATE NOCASE);
    `,
  },
];

const SELECT_TX = `SELECT t.*, c.name AS category FROM finance_transactions t LEFT JOIN finance_categories c ON c.id = t.category_id`;

/**
 * Category of the newest entry with the same description (ignoring case), so
 * a merchant categorized once stays categorized. Entries categorized one by
 * one don't count. Null for a new description.
 */
export async function categoryForDescription(db: Db, description: string): Promise<number | null> {
  const row = await db.getFirstAsync<{ category_id: number }>(
    `SELECT category_id FROM finance_transactions
     WHERE description = ? COLLATE NOCASE AND category_id IS NOT NULL AND category_by_description = 1
     ORDER BY occurred_at DESC, id DESC LIMIT 1`,
    description,
  );
  return row?.category_id ?? null;
}

/** Inserts [tx] with [categoryId]. Returns false when its dedup key was already recorded. */
export async function insertTransaction(db: Db, tx: NewTransaction, categoryId: number | null, now: number): Promise<boolean> {
  const result = await db.runAsync(
    `INSERT INTO finance_transactions (amount_cents, direction, description, account, occurred_at, source, dedup_key, category_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dedup_key) DO NOTHING`,
    tx.amountCents,
    tx.direction,
    tx.description,
    tx.account,
    tx.occurredAt,
    tx.source,
    tx.dedupKey,
    categoryId,
    now,
  );
  return result.changes > 0;
}

export async function deleteTransaction(db: Db, id: number): Promise<boolean> {
  return (await db.runAsync('DELETE FROM finance_transactions WHERE id = ?', id)).changes > 0;
}

/** Entries of a local month, newest first. */
export async function monthTransactions(db: Db, year: number, month: number): Promise<Transaction[]> {
  const [from, to] = monthRange(year, month);
  const rows = await db.getAllAsync<Row>(
    `${SELECT_TX} WHERE t.occurred_at >= ? AND t.occurred_at < ? ORDER BY t.occurred_at DESC, t.id DESC`,
    from,
    to,
  );
  return rows.map(fromRow);
}

/** Entries with [from] <= occurred_at < [to], newest first. */
export async function transactionsBetween(db: Db, from: number, to: number): Promise<Transaction[]> {
  const rows = await db.getAllAsync<Row>(`${SELECT_TX} WHERE t.occurred_at >= ? AND t.occurred_at < ? ORDER BY t.occurred_at DESC, t.id DESC`, from, to);
  return rows.map(fromRow);
}

/** Spending per category in a local month, biggest first; `name` null is "sem categoria". */
export async function monthCategoryTotals(db: Db, year: number, month: number): Promise<{ name: string | null; outCents: number }[]> {
  const [from, to] = monthRange(year, month);
  const rows = await db.getAllAsync<{ name: string | null; out_cents: number }>(
    `SELECT c.name AS name, SUM(t.amount_cents) AS out_cents
     FROM finance_transactions t LEFT JOIN finance_categories c ON c.id = t.category_id
     WHERE t.direction = 'out' AND t.occurred_at >= ? AND t.occurred_at < ?
     GROUP BY t.category_id ORDER BY out_cents DESC`,
    from,
    to,
  );
  return rows.map((r) => ({ name: r.name ?? null, outCents: r.out_cents }));
}

export async function recentTransactions(db: Db, limit: number): Promise<Transaction[]> {
  const rows = await db.getAllAsync<Row>(`${SELECT_TX} ORDER BY t.occurred_at DESC, t.id DESC LIMIT ?`, limit);
  return rows.map(fromRow);
}

export async function monthTotals(db: Db, year: number, month: number): Promise<MonthTotals> {
  const [from, to] = monthRange(year, month);
  const row = await db.getFirstAsync<{ out_cents: number | null; in_cents: number | null; n: number }>(
    `SELECT SUM(CASE WHEN direction = 'out' THEN amount_cents END) AS out_cents,
            SUM(CASE WHEN direction = 'in' THEN amount_cents END) AS in_cents,
            COUNT(*) AS n
     FROM finance_transactions WHERE occurred_at >= ? AND occurred_at < ?`,
    from,
    to,
  );
  return { outCents: row?.out_cents ?? 0, inCents: row?.in_cents ?? 0, count: row?.n ?? 0 };
}

// Categories

export async function listCategories(db: Db): Promise<Category[]> {
  return db.getAllAsync<Category>('SELECT id, name FROM finance_categories ORDER BY name COLLATE NOCASE');
}

/** Categories with how many entries each has, by name. */
export async function listCategoriesWithCounts(db: Db): Promise<CategoryWithCount[]> {
  return db.getAllAsync<CategoryWithCount>(
    `SELECT c.id, c.name, COUNT(t.id) AS count FROM finance_categories c
     LEFT JOIN finance_transactions t ON t.category_id = c.id
     GROUP BY c.id ORDER BY c.name COLLATE NOCASE`,
  );
}

export async function findCategory(db: Db, name: string): Promise<Category | null> {
  return (await db.getFirstAsync<Category>('SELECT id, name FROM finance_categories WHERE name = ? COLLATE NOCASE', name)) ?? null;
}

/**
 * Renames category [id] to [name] (already clean). When another category has
 * that name, moves the entries there and removes [id] instead: a merge. The
 * entries move first, so a stop halfway leaves at most an empty category.
 */
export async function renameCategory(db: Db, id: number, name: string): Promise<{ merged: boolean; id: number }> {
  const other = await findCategory(db, name);
  if (other && other.id !== id) {
    await db.runAsync('UPDATE finance_transactions SET category_id = ? WHERE category_id = ?', other.id, id);
    await db.runAsync('DELETE FROM finance_categories WHERE id = ?', id);
    return { merged: true, id: other.id };
  }
  await db.runAsync('UPDATE finance_categories SET name = ? WHERE id = ?', name, id);
  return { merged: false, id };
}

/** Removes category [id]; its entries stay, without a category. Returns how many entries it had. */
export async function deleteCategory(db: Db, id: number): Promise<number> {
  const changed = (await db.runAsync('UPDATE finance_transactions SET category_id = NULL WHERE category_id = ?', id)).changes;
  await db.runAsync('DELETE FROM finance_categories WHERE id = ?', id);
  return changed;
}

/** Id of the category called [name] (ignoring case), created if missing. [name] is already clean (`parseCategoryName`). */
export async function ensureCategory(db: Db, name: string, now: number): Promise<{ id: number; created: boolean }> {
  const created = (await db.runAsync('INSERT INTO finance_categories (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING', name, now)).changes > 0;
  const row = await findCategory(db, name);
  if (!row) throw new Error('category not saved');
  return { id: row.id, created };
}

/** Sets [categoryId] (or none) on every entry with [description], ignoring case. Returns how many changed. */
export async function categorizeDescription(db: Db, description: string, categoryId: number | null): Promise<number> {
  return (await db.runAsync('UPDATE finance_transactions SET category_id = ?, category_by_description = 1 WHERE description = ? COLLATE NOCASE', categoryId, description)).changes;
}

/** Sets [categoryId] (or none) on one entry. Returns false when it doesn't exist. */
export async function categorizeTransaction(db: Db, id: number, categoryId: number | null): Promise<boolean> {
  return (await db.runAsync('UPDATE finance_transactions SET category_id = ?, category_by_description = 0 WHERE id = ?', categoryId, id)).changes > 0;
}

/** Descriptions with entries still without a category, most frequent first. */
export async function uncategorizedGroups(db: Db, limit: number): Promise<{ groups: UncategorizedGroup[]; descriptions: number; entries: number }> {
  const rows = await db.getAllAsync<{ description: string; n: number; out_cents: number | null; in_cents: number | null }>(
    `SELECT MIN(description) AS description, COUNT(*) AS n,
            SUM(CASE WHEN direction = 'out' THEN amount_cents END) AS out_cents,
            SUM(CASE WHEN direction = 'in' THEN amount_cents END) AS in_cents
     FROM finance_transactions WHERE category_id IS NULL
     GROUP BY description COLLATE NOCASE ORDER BY n DESC, MAX(occurred_at) DESC`,
  );
  return {
    groups: rows.slice(0, limit).map((r) => ({ description: r.description, count: r.n, outCents: r.out_cents ?? 0, inCents: r.in_cents ?? 0 })),
    descriptions: rows.length,
    entries: rows.reduce((s, r) => s + r.n, 0),
  };
}

function fromRow(r: Row): Transaction {
  return {
    id: r.id,
    amountCents: r.amount_cents,
    direction: r.direction,
    description: r.description,
    account: r.account,
    occurredAt: r.occurred_at,
    source: r.source,
    categoryId: r.category_id ?? null,
    category: r.category ?? null,
  };
}
