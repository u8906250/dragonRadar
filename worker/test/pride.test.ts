import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { listRoutes } from '../src/sources/voyage';
import sql from '../migrations/0040_pride_2026.sql?raw';

/** 假的 D1：記下查詢、回傳給定的路線 */
function fakeEnv(rows: object[]): { env: Env; sql: () => string } {
  let sql = '';
  const env = {
    DB: {
      prepare: (q: string) => ({
        bind: () => ({
          all: async () => {
            sql = q;
            return { results: rows };
          },
        }),
      }),
    },
  } as unknown as Env;
  return { env, sql: () => sql };
}

const row = (id: string, style: string | null) => ({ id, post_id: id, title: id, depart_at: 1, arrive_at: 2, show_until: 3, claim_url: null, stops: '[]', segments: '[]', updated_at: 0, style });

describe('同志遊行（彩虹路線）', () => {
  it('lists routes with a style before their day, and passes the rainbow style on', async () => {
    const f = fakeEnv([row('pride-2026', 'rainbow'), row('2026-10-18-x', null)]);
    const out = await listRoutes(f.env, 0);
    expect(f.sql()).toContain('style IS NOT NULL');
    expect(out[0]).toMatchObject({ id: 'pride-2026', source: 'official', style: 'rainbow' });
    expect(out[1].style).toBeUndefined();
  });

  it('puts the north and south loops from the plaza back to the plaza, 13:00–18:40 on 10/31', () => {
    const strings = [...sql.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
    const stops = JSON.parse(strings.find((s) => s.startsWith('[{"kind"'))!) as Array<{ kind: string; at: number; lat: number; lng: number }>;
    const segs = JSON.parse(strings.find((s) => s.startsWith('[{"seq"'))!) as Array<{ from: string; path: Array<[number, number]>; lengthM: number }>;
    const plaza = [stops[0].lat, stops[0].lng];
    expect(segs.map((s) => s.from)).toEqual(['北路線', '南路線']);
    for (const s of segs) {
      expect(s.path[0]).toEqual(plaza);
      expect(s.path.at(-1)).toEqual(plaza);
      expect(s.lengthM).toBeGreaterThan(3000);
      expect(s.lengthM).toBeLessThan(4500);
    }
    // 台北時間 14:05 出發、17:35 回來
    const hm = (t: number): string => new Date(t * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 16);
    expect(stops.map((s) => `${s.kind} ${hm(s.at)}`)).toEqual(['start 2026-10-31 14:05', 'end 2026-10-31 17:35']);
    expect(sql).toMatch(/'upcoming'/);
    expect(sql).toContain("'site'");
  });
});
