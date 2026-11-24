import type { SQLiteDatabase } from 'expo-sqlite';
import { setPluginEnabled } from '../db';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

describe('setPluginEnabled', () => {
  it('only upserts the switch and never deletes plugin data', async () => {
    const runAsync = jest.fn(async () => ({ changes: 1, lastInsertRowId: 0 }));
    const db = { runAsync } as unknown as SQLiteDatabase;
    await setPluginEnabled(db, 'todo', false);
    await setPluginEnabled(db, 'todo', true);
    const sql = runAsync.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(sql.every((s) => s.startsWith('INSERT INTO plugin_state'))).toBe(true);
    expect(sql.some((s) => /DELETE|DROP/i.test(s))).toBe(false);
    expect((runAsync.mock.calls[0] as unknown[]).slice(1)).toEqual(['todo', 0]);
  });
});
