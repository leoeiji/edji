import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import type { Migration, Plugin } from './plugin';
import type { PluginStates } from './registry';

let opening: Promise<SQLiteDatabase> | null = null;

/** The app database (`edji.db`), opened once per JS runtime with core tables in place. */
export function getDb(): Promise<SQLiteDatabase> {
  opening ??= (async () => {
    const db = await openDatabaseAsync('edji.db');
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS plugin_state (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS plugin_schema (id TEXT PRIMARY KEY, version INTEGER NOT NULL);
    `);
    return db;
  })();
  return opening;
}

/** Applies each plugin's pending migrations in a transaction. Enabled or not: data is kept either way. */
export async function migratePlugins(db: SQLiteDatabase, plugins: Plugin[]): Promise<void> {
  for (const p of plugins) await applyMigrations(db, p.id, p.migrations ?? []);
}

/**
 * Applies the migrations of [id] newer than its stored version, in one
 * transaction, and stores the new version in `plugin_schema`. Core modules
 * (like the chat) use ids starting with `_`, which no plugin id can.
 */
export async function applyMigrations(db: SQLiteDatabase, id: string, migrations: Migration[]): Promise<void> {
  const row = await db.getFirstAsync<{ version: number }>('SELECT version FROM plugin_schema WHERE id = ?', id);
  const current = row?.version ?? 0;
  const pending = migrations.filter((m) => m.version > current);
  if (pending.length === 0) return;
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const m of pending) await tx.execAsync(m.sql);
    await tx.runAsync(
      'INSERT INTO plugin_schema (id, version) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version',
      id,
      pending[pending.length - 1].version,
    );
  });
}

export async function loadPluginStates(db: SQLiteDatabase): Promise<PluginStates> {
  const rows = await db.getAllAsync<{ id: string; enabled: number }>('SELECT id, enabled FROM plugin_state');
  return Object.fromEntries(rows.map((r) => [r.id, r.enabled === 1]));
}

export async function setPluginEnabled(db: SQLiteDatabase, id: string, enabled: boolean): Promise<void> {
  await db.runAsync(
    'INSERT INTO plugin_state (id, enabled) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled',
    id,
    enabled ? 1 : 0,
  );
}
