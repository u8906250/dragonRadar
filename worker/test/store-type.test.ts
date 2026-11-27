import { describe, expect, it } from 'vitest';
import { feedbackMessage, SELF_TYPE_NOTE, setStoreTypeDirect, submitFeedback } from '../src/feedback';
import { PushError } from '../src/push';

/** 假的 D1：照 SQL 回答；記下跑過的寫入（batch 的也記） */
function envWith(o: { status?: string; kind?: string; module?: string; owner?: string | null; fixes?: number }): { env: never; writes: Array<{ q: string; b: unknown[] }> } {
  const writes: Array<{ q: string; b: unknown[] }> = [];
  const ev = o.status === undefined ? null : { id: 7, post_id: 'link-abc.taipai', kind: o.kind ?? 'store', title: '角公園咖啡', place_text: '台北市大安區', status: o.status, module: o.module ?? 'taipai' };
  const stmt = (q: string, b: unknown[] = []): { q: string; b: unknown[]; bind: (...x: unknown[]) => unknown; first: () => Promise<unknown>; all: () => Promise<unknown>; run: () => Promise<unknown> } => ({
    q,
    b,
    bind: (...x: unknown[]) => stmt(q, x),
    async first() {
      if (/FROM events e LEFT JOIN posts p/.test(q)) return ev;
      if (/SELECT post_id, place_text, kind FROM events WHERE id/.test(q)) return ev;
      if (/FROM submissions/.test(q)) return o.owner && b[1] === o.owner ? { ok: 1 } : null;
      if (/COUNT\(\*\) AS n FROM event_feedback/.test(q)) return { n: o.fixes ?? 0 };
      if (/FROM event_feedback WHERE event_id/.test(q)) return null;
      if (/INSERT INTO event_feedback/.test(q)) {
        writes.push({ q, b });
        return { id: 1, kind: b[4], title: b[2], note: b[5], topic: b[13] };
      }
      return null;
    },
    async all() {
      return { results: [] };
    },
    async run() {
      writes.push({ q, b });
      return { meta: { changes: 1 } };
    },
  });
  const batch = async (list: Array<{ q: string; b: unknown[] }>): Promise<unknown[]> => {
    for (const s of list) writes.push({ q: s.q, b: s.b });
    return list.map((s) => ({ meta: { changes: /UPDATE events/.test(s.q) ? 2 : 1 } }));
  };
  return { env: { DB: { prepare: (q: string) => stmt(q), batch } } as never, writes };
}

const status = async (p: Promise<unknown>): Promise<number> => p.then(() => 200, (e: unknown) => (e instanceof PushError ? e.status : 500));

describe('店家類型錯誤直接改', () => {
  it('lets the reporter fix their own store type, and records it for the admin', async () => {
    const { env, writes } = envWith({ status: 'active', owner: 'dev1' });
    expect(await setStoreTypeDirect(env, 7, { type: 'venue' }, false, 'dev1', 'ip', 1000)).toEqual({ ok: true, changed: 2 });
    expect(writes.some((w) => /UPDATE events SET extra = json_set/.test(w.q) && w.q.includes("'$.type'") && w.b[0] === 'venue')).toBe(true);
    expect(writes.some((w) => /INSERT INTO manual_fixes/.test(w.q) && w.b.includes('venue'))).toBe(true);
    const audit = writes.find((w) => /INSERT INTO event_feedback/.test(w.q));
    expect(audit?.b).toContain(SELF_TYPE_NOTE);
    expect(audit?.b).toContain('venue');
  });
  it('lets the admin fix any store without a record', async () => {
    const { env, writes } = envWith({ status: 'active', owner: null });
    expect(await setStoreTypeDirect(env, 7, { type: 'cafe' }, true, null, 'ip', 1000)).toEqual({ ok: true, changed: 2 });
    expect(writes.some((w) => /INSERT INTO event_feedback/.test(w.q))).toBe(false);
  });
  it('refuses others, activities, other radars’ types, ended stores and too many fixes', async () => {
    expect(await status(setStoreTypeDirect(envWith({ status: 'active', owner: 'dev1' }).env, 7, { type: 'venue' }, false, 'dev2', 'ip', 1000))).toBe(403);
    expect(await status(setStoreTypeDirect(envWith({ status: 'active', owner: 'dev1' }).env, 7, { type: 'venue' }, false, null, 'ip', 1000))).toBe(400);
    expect(await status(setStoreTypeDirect(envWith({ status: 'active', owner: 'dev1', kind: 'activity' }).env, 7, { type: 'venue' }, false, 'dev1', 'ip', 1000))).toBe(400);
    // 書店雷達不能選台派雷達的類型
    expect(await status(setStoreTypeDirect(envWith({ status: 'active', owner: 'dev1', module: 'books' }).env, 7, { type: 'venue' }, false, 'dev1', 'ip', 1000))).toBe(400);
    expect(await status(setStoreTypeDirect(envWith({ status: 'active', owner: 'dev1', module: 'books' }).env, 7, { type: 'used' }, false, 'dev1', 'ip', 1000))).toBe(200);
    expect(await status(setStoreTypeDirect(envWith({ status: 'active', owner: 'dev1' }).env, 7, { type: '咖啡甜點' }, false, 'dev1', 'ip', 1000))).toBe(400);
    expect(await status(setStoreTypeDirect(envWith({ status: 'ended', owner: 'dev1' }).env, 7, { type: 'venue' }, false, 'dev1', 'ip', 1000))).toBe(409);
    expect(await status(setStoreTypeDirect(envWith({}).env, 7, { type: 'venue' }, true, null, 'ip', 1000))).toBe(404);
    expect(await status(setStoreTypeDirect(envWith({ status: 'active', owner: 'dev1', fixes: 20 }).env, 7, { type: 'venue' }, false, 'dev1', 'ip', 1000))).toBe(429);
  });
});

describe('店家回報類型錯誤送管理者', () => {
  it('takes the store type key and names it in the push', async () => {
    const { env } = envWith({ status: 'active' });
    const { created } = await submitFeedback(env, 7, { kind: 'topic', topic: 'venue' }, 'dev2', 'ip', 1000);
    expect(created?.topic).toBe('venue');
    expect(feedbackMessage({ kind: 'topic', title: '角公園咖啡', note: null, topic: 'venue' }, 1).body).toBe('角公園咖啡｜應該是「場地租借」');
  });
  it('refuses activity topics for stores and store keys for activities', async () => {
    expect(await status(submitFeedback(envWith({ status: 'active' }).env, 7, { kind: 'topic', topic: '講座' }, 'dev2', 'ip', 1000))).toBe(400);
    expect(await status(submitFeedback(envWith({ status: 'active', kind: 'activity', module: 'current' }).env, 7, { kind: 'topic', topic: 'venue' }, 'dev2', 'ip', 1000))).toBe(400);
    expect(await status(submitFeedback(envWith({ status: 'active', kind: 'activity', module: 'current' }).env, 7, { kind: 'topic', topic: '講座' }, 'dev2', 'ip', 1000))).toBe(200);
    expect(await status(submitFeedback(envWith({ status: 'active', kind: 'giveaway', module: 'current' }).env, 7, { kind: 'topic', topic: '講座' }, 'dev2', 'ip', 1000))).toBe(400);
  });
});
