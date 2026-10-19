import { describe, expect, it } from 'vitest';
import { resilientDb } from '../src/db';

/** 假的 D1：前 failTimes 次丟出 err，之後成功 */
function fakeDb(failTimes: number, err = 'D1_ERROR: internal error; reference = x') {
  let calls = 0;
  let batchCalls = 0;
  const batched: unknown[] = [];
  const stmt = (q: string): D1PreparedStatement =>
    ({
      q,
      bind() {
        return stmt(q);
      },
      async first() {
        calls++;
        if (calls <= failTimes) throw new Error(err);
        return { q };
      },
    }) as unknown as D1PreparedStatement;
  const db = {
    prepare: (q: string) => stmt(q),
    async batch(stmts: D1PreparedStatement[]) {
      batchCalls++;
      batched.push(...stmts);
      if (batchCalls <= failTimes) throw new Error(err);
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
  } as unknown as D1Database;
  return { db, calls: () => calls, batchCalls: () => batchCalls, batched };
}

describe('resilientDb', () => {
  it('retries a transient error and then succeeds', async () => {
    const f = fakeDb(2);
    expect(await resilientDb(f.db).prepare('SELECT 1').bind(1).first()).toEqual({ q: 'SELECT 1' });
    expect(f.calls()).toBe(3);
  });
  it('gives up after two retries', async () => {
    const f = fakeDb(5);
    await expect(resilientDb(f.db).prepare('SELECT 1').first()).rejects.toThrow(/internal error/);
    expect(f.calls()).toBe(3);
  });
  it('does not retry other errors', async () => {
    const f = fakeDb(5, 'D1_ERROR: no such column: foo');
    await expect(resilientDb(f.db).prepare('SELECT foo').first()).rejects.toThrow(/no such column/);
    expect(f.calls()).toBe(1);
  });
  it('retries batches and passes the original statements through', async () => {
    const f = fakeDb(1);
    const db = resilientDb(f.db);
    const r = await db.batch([db.prepare('A').bind(1), db.prepare('B')]);
    expect(r).toHaveLength(2);
    expect(f.batchCalls()).toBe(2);
    expect((f.batched[0] as { q: string }).q).toBe('A');
  });
});
