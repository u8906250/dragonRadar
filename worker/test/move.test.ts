import { describe, expect, it } from 'vitest';
import { moveEventPlace, SELF_MOVE_NOTE } from '../src/feedback';
import { PushError } from '../src/push';

/** 假的 D1：照 SQL 回答；記下跑過的寫入 */
function envWith(o: { status?: string; route?: boolean; owner?: string | null; moves?: number }): { env: never; writes: Array<{ q: string; b: unknown[] }> } {
  const writes: Array<{ q: string; b: unknown[] }> = [];
  const stmt = (q: string, b: unknown[] = []): unknown => ({
    bind: (...x: unknown[]) => stmt(q, x),
    async first() {
      if (/FROM events WHERE id = \?/.test(q) && /status/.test(q)) return o.status === undefined ? null : { id: 7, post_id: 'yt-abc', title: '市民之夜', place_text: '仁愛路大道', status: o.status };
      if (/SELECT post_id, place_text FROM events WHERE id/.test(q)) return { post_id: 'yt-abc', place_text: '仁愛路大道' };
      if (/FROM routes/.test(q)) return o.route ? { ok: 1 } : null;
      if (/FROM submissions/.test(q)) return o.owner && b[1] === o.owner ? { ok: 1 } : null;
      if (/COUNT\(\*\) AS n FROM event_feedback/.test(q)) return { n: o.moves ?? 0 };
      return null;
    },
    async all() {
      return { results: [] };
    },
    async run() {
      writes.push({ q, b });
      return { meta: { changes: /UPDATE events/.test(q) ? 2 : 1 } };
    },
  });
  return { env: { DB: { prepare: (q: string) => stmt(q), batch: async () => [] } } as never, writes };
}

const at = { lat: 25.0399868, lng: 121.5602911 };
const status = async (p: Promise<unknown>): Promise<number> => p.then(() => 200, (e: unknown) => (e instanceof PushError ? e.status : 500));

describe('地點錯誤直接移位置（v1.808）', () => {
  it('lets the reporter move their own report, and records it for the admin', async () => {
    const { env, writes } = envWith({ status: 'upcoming', owner: 'dev1' });
    expect(await moveEventPlace(env, 7, at, false, 'dev1', 'ip', 1000)).toEqual({ ok: true, moved: 2 });
    expect(writes.some((w) => /UPDATE events SET lat = \?/.test(w.q) && w.b[0] === at.lat && w.b[1] === at.lng)).toBe(true);
    const audit = writes.find((w) => /INSERT INTO event_feedback/.test(w.q));
    expect(audit?.b).toContain(SELF_MOVE_NOTE);
  });
  it('lets the admin move any report without a record', async () => {
    const { env, writes } = envWith({ status: 'active', owner: null });
    expect(await moveEventPlace(env, 7, at, true, null, 'ip', 1000)).toEqual({ ok: true, moved: 2 });
    expect(writes.some((w) => /INSERT INTO event_feedback/.test(w.q))).toBe(false);
  });
  it('refuses others, route stops, ended events, bad pins and too many moves', async () => {
    expect(await status(moveEventPlace(envWith({ status: 'upcoming', owner: 'dev1' }).env, 7, at, false, 'dev2', 'ip', 1000))).toBe(403);
    expect(await status(moveEventPlace(envWith({ status: 'upcoming', owner: 'dev1' }).env, 7, at, false, null, 'ip', 1000))).toBe(400);
    expect(await status(moveEventPlace(envWith({ status: 'upcoming', owner: 'dev1', route: true }).env, 7, at, false, 'dev1', 'ip', 1000))).toBe(400);
    expect(await status(moveEventPlace(envWith({ status: 'ended', owner: 'dev1' }).env, 7, at, false, 'dev1', 'ip', 1000))).toBe(409);
    expect(await status(moveEventPlace(envWith({}).env, 7, at, true, null, 'ip', 1000))).toBe(404);
    expect(await status(moveEventPlace(envWith({ status: 'upcoming', owner: 'dev1' }).env, 7, { lat: 'x' }, false, 'dev1', 'ip', 1000))).toBe(400);
    expect(await status(moveEventPlace(envWith({ status: 'upcoming', owner: 'dev1', moves: 20 }).env, 7, at, false, 'dev1', 'ip', 1000))).toBe(429);
  });
});
