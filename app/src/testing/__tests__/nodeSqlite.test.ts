import { openTestDb } from '../nodeSqlite';

describe('openTestDb', () => {
  it('runs real SQL with expo-sqlite style calls', async () => {
    const db = openTestDb();
    await db.execAsync('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const r = await db.runAsync('INSERT INTO t (v) VALUES (?)', 'a');
    expect(r.lastInsertRowId).toBe(1);
    expect(await db.getFirstAsync('SELECT v FROM t WHERE id = ?', [1])).toEqual({ v: 'a' });
  });
});
