/// <reference types="node" />
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

type Params = unknown[];

/**
 * An in-memory SQLite database behind the subset of the `expo-sqlite` API
 * the app uses, for tests: the real SQL runs (constraints, cascades,
 * upserts) without the native module. Only for Jest.
 */
export function openTestDb(): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON'); // as `getDb` does
  const bind = (params: Params): SQLInputValue[] => {
    const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
    return flat.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v as SQLInputValue)));
  };
  const db = {
    execAsync: async (sql: string) => raw.exec(sql),
    runAsync: async (sql: string, ...params: Params) => {
      const r = raw.prepare(sql).run(...bind(params));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    getFirstAsync: async (sql: string, ...params: Params) => raw.prepare(sql).get(...bind(params)) ?? null,
    getAllAsync: async (sql: string, ...params: Params) => raw.prepare(sql).all(...bind(params)),
    withExclusiveTransactionAsync: async (fn: (tx: unknown) => Promise<void>) => {
      raw.exec('BEGIN EXCLUSIVE');
      try {
        await fn(db);
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    withTransactionAsync: async (fn: () => Promise<void>) => db.withExclusiveTransactionAsync(fn),
  };
  return db as unknown as SQLiteDatabase;
}
