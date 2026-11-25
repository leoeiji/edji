import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import type { Plugin } from './plugin';
import type { PluginStates } from './registry';

let opening: Promise<SQLiteDatabase> | null = null;

/** The app database (`edji.db`), opened once per JS runtime with core tables in place. */
export function getDb(): Promise<SQLiteDatabase> {
  opening ??= (async () => {
    const db = await openDatabaseAsync('edji.db');
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS plugin_state (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS plugin_schema (id TEXT PRIMARY KEY, version INTEGER NOT NULL);
    `);
    return db;
  })();
  return opening;
}

/** Applies each plugin's pending migrations in a transaction. Enabled or not: data is kept either way. */
export async function migratePlugins(db: SQLiteDatabase, plugins: Plugin[]): Promise<void> {
  for (const p of plugins) {
    const row = await db.getFirstAsync<{ version: number }>('SELECT version FROM plugin_schema WHERE id = ?', p.id);
    const current = row?.version ?? 0;
    const pending = (p.migrations ?? []).filter((m) => m.version > current);
    if (pending.length === 0) continue;
    await db.withExclusiveTransactionAsync(async (tx) => {
      for (const m of pending) await tx.execAsync(m.sql);
      await tx.runAsync(
        'INSERT INTO plugin_schema (id, version) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version',
        p.id,
        pending[pending.length - 1].version,
      );
    });
  }
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
