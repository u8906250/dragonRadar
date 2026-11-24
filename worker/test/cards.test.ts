import { describe, expect, it } from 'vitest';
import { cleanCode, CREDITS_PER_DAY, jerkyMilestone, makeCode, parseClaim, parsePick, parseTeleport, REPORTS_PER_JERKY, spendTeleport, taipeiDayStart, TELEPORT_COST } from '../src/cards';

describe('parseClaim', () => {
  it('takes a known card and one of its places', () => {
    expect(parseClaim({ card: 'xiaofa', place: '碑林' })).toEqual({ card: 'xiaofa', place: '碑林' });
    // 不認得的地點寫「中山公園」
    expect(parseClaim({ card: 'xiaofa', place: '我家' })).toEqual({ card: 'xiaofa', place: '中山公園' });
    expect(parseClaim({ card: 'xiaofa' })).toEqual({ card: 'xiaofa', place: '中山公園' });
  });
  it('refuses unknown cards', () => {
    expect(parseClaim({ card: 'toString' })).toBe('沒有這張卡');
    expect(parseClaim({ card: 'lucky' })).toBe('沒有這張卡');
    // 肉乾卡要回報累計才拿得到，不能直接拿
    expect(parseClaim({ card: 'jerky', place: '回報' })).toBe('這張卡要照規則拿，不能直接拿');
    // 你的市長：瀏覽器判斷看完、點完才領，地點只有洋流總部
    expect(parseClaim({ card: 'mayor', place: '洋流總部' })).toEqual({ card: 'mayor', place: '洋流總部' });
    expect(parseClaim({ card: 'mayor' })).toEqual({ card: 'mayor', place: '洋流總部' });
    expect(parseClaim(null)).toBe('沒有這張卡');
  });
});

describe('transfer codes', () => {
  it('makes 8 easy-to-read characters, split in two', () => {
    const code = makeCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(makeCode(() => new Uint8Array([0, 1, 2, 3, 31, 32, 255, 8]))).toBe('ABCD-9A9J');
    expect(new Set(Array.from({ length: 50 }, () => makeCode())).size).toBe(50);
  });
  it('cleans what people type', () => {
    expect(cleanCode('kx7p-4m2q')).toBe('KX7P4M2Q');
    expect(cleanCode(' KX7P 4M2Q ')).toBe('KX7P4M2Q');
    expect(cleanCode('KX7P4M2Q')).toBe('KX7P4M2Q');
    // 0、O、1、I 不會出現在引繼碼裡；太短、太長、不是字串的不要
    expect(cleanCode('KX7P-4M2O')).toBeNull();
    expect(cleanCode('KX7P-4M21')).toBeNull();
    expect(cleanCode('KX7P-4M2')).toBeNull();
    expect(cleanCode('KX7P-4M2QQ')).toBeNull();
    expect(cleanCode(12345678)).toBeNull();
  });
});

describe('回報累計（古錐媽的肉乾）', () => {
  it('gives the card and a 順幣 every 5 reports, at most 20 a day', () => {
    expect(REPORTS_PER_JERKY).toBe(5);
    expect(CREDITS_PER_DAY).toBe(20);
    expect([0, 4, 5, 9, 10, 14, 15, 23].map(jerkyMilestone)).toEqual([0, 0, 5, 5, 10, 10, 15, 20]);
  });
  it('counts a day in Taiwan time (00:00 +08:00)', () => {
    // 2026-11-03 23:59:59 和 2026-11-04 00:00:00（台灣時間）
    const late = Date.UTC(2026, 10, 3, 15, 59, 59) / 1000;
    const next = late + 1;
    expect(taipeiDayStart(late)).toBe(Date.UTC(2026, 10, 2, 16) / 1000);
    expect(taipeiDayStart(next)).toBe(next);
    expect(taipeiDayStart(next + 3600)).toBe(next);
  });
});

describe('選獎勵（肉乾或順幣）', () => {
  it('takes jerky or a 順幣 only', () => {
    expect(parsePick({ item: 'jerky' })).toBe('jerky');
    expect(parsePick({ item: 'coin' })).toBe('coin');
    expect(parsePick({ item: 'pick' })).toBe('只能選古錐媽的肉乾或順幣');
    expect(parsePick({})).toBe('只能選古錐媽的肉乾或順幣');
    expect(parsePick(null)).toBe('只能選古錐媽的肉乾或順幣');
  });
});

describe('瞬間移動（花一枚順幣）', () => {
  it('only goes to 汪星 or back to 地球', () => {
    expect(TELEPORT_COST).toBe(1);
    expect(parseTeleport({ to: 'woof' })).toBe('woof');
    expect(parseTeleport({ to: 'earth' })).toBe('earth');
    expect(parseTeleport({ to: 'kepler22b' })).toBe('不能瞬間移動到那裡');
    expect(parseTeleport({ to: 'toString' })).toBe('不能瞬間移動到那裡');
    expect(parseTeleport(null)).toBe('不能瞬間移動到那裡');
  });
  /** 假的 D1：記下送出的 SQL；UPDATE 改到幾筆照 changes */
  const fakeDb = (changes: number) => {
    const sql: Array<{ q: string; binds: unknown[] }> = [];
    const stmt = (q: string) => ({
      bind: (...binds: unknown[]) => ({
        run: async () => (sql.push({ q, binds }), { meta: { changes } }),
        all: async () => ({ results: [] }),
      }),
    });
    return { sql, env: { DB: { prepare: stmt, batch: async () => [{ results: [] }, { results: [{ item: 'coin', count: 2 }] }] } } as never };
  };
  it('spends one coin and says where to', async () => {
    const db = fakeDb(1);
    const r = await spendTeleport(db.env, 'dev', { to: 'woof' }, 100);
    expect(r.to).toBe('woof');
    expect(r.items).toEqual([{ item: 'coin', count: 2 }]);
    expect(db.sql[0].q).toContain("item = 'coin' AND used_at IS NULL ORDER BY id LIMIT 1");
    expect(db.sql[0].binds).toEqual([100, 'teleport:woof', 'dev']);
  });
  it('refuses without coins, a device or a known place', async () => {
    await expect(spendTeleport(fakeDb(0).env, 'dev', { to: 'woof' }, 100)).rejects.toThrow('順幣不夠');
    await expect(spendTeleport(fakeDb(1).env, null, { to: 'woof' }, 100)).rejects.toThrow('裝置代碼');
    await expect(spendTeleport(fakeDb(1).env, 'dev', { to: 'mars' }, 100)).rejects.toThrow('不能瞬間移動');
  });
});
