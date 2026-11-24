import type { SQLiteDatabase } from 'expo-sqlite';
import type { Migration } from '../../core/plugin';

export type TodoItem = { id: number; text: string; done: boolean; source: 'voz' | 'app'; createdAt: number };

export const migrations: Migration[] = [
  {
    version: 1,
    sql: `CREATE TABLE todo_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );`,
  },
];

type Row = { id: number; text: string; done: number; source: 'voz' | 'app'; created_at: number };

const toItem = (r: Row): TodoItem => ({ id: r.id, text: r.text, done: r.done === 1, source: r.source, createdAt: r.created_at });

/** Open items first, newest first within each group. */
export async function listItems(db: SQLiteDatabase): Promise<TodoItem[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM todo_items ORDER BY done ASC, id DESC');
  return rows.map(toItem);
}

export async function addItem(db: SQLiteDatabase, text: string, source: TodoItem['source']): Promise<number> {
  const r = await db.runAsync('INSERT INTO todo_items (text, source, created_at) VALUES (?, ?, ?)', text, source, Date.now());
  return r.lastInsertRowId;
}

export async function setDone(db: SQLiteDatabase, id: number, done: boolean): Promise<void> {
  await db.runAsync('UPDATE todo_items SET done = ? WHERE id = ?', done ? 1 : 0, id);
}

export async function removeItem(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM todo_items WHERE id = ?', id);
}
