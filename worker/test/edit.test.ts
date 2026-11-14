import { describe, expect, it } from 'vitest';
import { keepLocated } from '../src/reports';

describe('補充資料沒改地點：沿用判讀時查到的位置', () => {
  const plan = (place: string, lat: number | null, approx: string | null = null) => ({ group: 0, reason: 'upcoming', plan: { place_text: place, lat, lng: lat === null ? null : 121.5, approx_area: approx } }) as never;
  const act = (place: string, lat: number | null = null) => ({ title: '市集', startAt: 1, endAt: null, place, lat, lng: lat === null ? null : 121.6 });
  it('keeps the coordinates when the place text is the same (newlines and spaces as the browser sends them)', () => {
    // 輸入欄的值會拿掉換行（不是換成空白），送出時空白縮成一個
    const [a] = keepLocated([act('迪化街一段32 巷口')], [plan('迪化街一段\n32  巷口', 25.05)]);
    expect([a.lat, a.lng]).toEqual([25.05, 121.5]);
  });
  it('looks the place up again when it was changed, pinned, or only located to a district', () => {
    expect(keepLocated([act('大稻埕碼頭')], [plan('迪化街', 25.05)])[0].lat).toBeNull();
    expect(keepLocated([act('迪化街', 25.1)], [plan('迪化街', 25.05)])[0].lat).toBe(25.1);
    expect(keepLocated([act('大同區')], [plan('大同區', 25.06, '大同區')])[0].lat).toBeNull();
    expect(keepLocated([act('迪化街')], [plan('迪化街', null)])[0].lat).toBeNull();
  });
});

import { planEdited } from '../src/events';
import { editItemsOf, parseEditItems } from '../src/reports';

/** 假的 D1：查重複、設定都查不到 */
const fakeEnv = (): never => {
  const stmt = { bind: () => stmt, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) };
  return { DB: { prepare: () => stmt, batch: async () => [] } } as never;
};
const NOW = Date.parse('2026-11-14T10:00:00+08:00') / 1000;
const at = (s: string): number => Date.parse(`${s}+08:00`) / 1000;
const plan = (o: Record<string, unknown>) =>
  ({
    group: 0,
    reason: 'planned',
    plan: { kind: 'session', title: '羽球臨打', item: '200元', start_at: at('2026-11-15T19:00:00'), end_at: at('2026-11-15T21:00:00'), place_text: '台大綜合體育館', place_query: '台大綜合體育館', lat: 25.0213, lng: 121.5355, confidence: 0.9, all_day: false, spot: false, approx_area: null, end_open: false, until_open: false, weekdays: null, tz: null, extra: JSON.stringify({ role: 'offer', fee: '200元', level: '中階', tags: ['羽球'] }), ...o },
  }) as never;
const post = (module: string) => ({ id: 'link-x', module, text: '徵臨打', posted_at: at('2026-11-14T08:00:00'), source: 'link' }) as never;
const act = (o: Record<string, unknown>) => ({ title: '週六羽球臨打', startAt: at('2026-11-15T19:00:00'), endAt: at('2026-11-15T21:00:00'), place: '台大綜合體育館', lat: null, lng: null, ref: 0, ...o }) as never;

describe('其他雷達的補充資料比照洋流（v1.715）', () => {
  it('fills the form with each radar\'s own time: sessions, the agreed time of a posting, and work days', () => {
    const [s] = editItemsOf([plan({})], 'badminton');
    expect([s.ref, s.startAt, s.endAt, s.tags, s.topic]).toEqual([0, at('2026-11-15T19:00:00'), at('2026-11-15T21:00:00'), ['羽球'], undefined]);
    const [p] = editItemsOf([plan({ start_at: at('2026-11-14T08:00:00'), extra: JSON.stringify({ role: 'seek', play_at: at('2026-11-16T20:00:00'), play_end: at('2026-11-16T22:00:00') }) })], 'badminton');
    expect([p.startAt, p.endAt]).toEqual([at('2026-11-16T20:00:00'), at('2026-11-16T22:00:00')]);
    const [j] = editItemsOf([plan({ kind: 'job', extra: JSON.stringify({ role: 'hire', work_from: '2026-11-20', work_to: '2026-11-22', pay: '時薪200' }) })], 'dog');
    expect([j.days, j.startAt, j.endAt]).toEqual([true, at('2026-11-20T00:00:00'), at('2026-11-22T00:00:00')]);
    // 沒排上雷達、沒有資料的不列
    expect(editItemsOf([{ group: 0, plan: null, reason: 'no_place' } as never], 'food')).toEqual([]);
  });

  it('checks work days for dog sitting and jobs (up to 7 days in a row) and reads the item it came from', () => {
    const base = { title: '遛狗', place: '大安區', startAt: at('2026-11-20T00:00:00') };
    expect(parseEditItems([{ ...base, endAt: at('2026-11-26T00:00:00'), ref: 2 }], 'dog')[0].ref).toBe(2);
    expect(() => parseEditItems([{ ...base, endAt: at('2026-11-27T00:00:00') }], 'dog')).toThrow('最多連續 7 天');
    expect(() => parseEditItems([{ ...base, endAt: at('2026-11-26T00:00:00') }], 'badminton')).toThrow('3 天內');
    expect(parseEditItems([{ ...base, ref: -1 }], 'work')[0].ref).toBeUndefined();
  });

  it('keeps fee and level, takes the new title, time, pin and tags for a session', async () => {
    const [it] = await planEdited(fakeEnv(), post('badminton'), [act({ startAt: at('2026-11-16T19:00:00'), endAt: at('2026-11-16T22:00:00'), place: '大安運動中心', lat: 25.0213, lng: 121.5435, tags: ['臨打'] })], [plan({})], NOW);
    const p = it.plan!;
    expect([p.kind, p.title, p.item, p.start_at, p.end_at, p.place_text, p.lat, p.lng]).toEqual(['session', '週六羽球臨打', '200元', at('2026-11-16T19:00:00'), at('2026-11-16T22:00:00'), '大安運動中心', 25.0213, 121.5435]);
    expect(JSON.parse(p.extra!)).toMatchObject({ role: 'offer', fee: '200元', level: '中階', tags: ['臨打'] });
  });

  it('reuses the located position when the place was not changed', async () => {
    const [it] = await planEdited(fakeEnv(), post('badminton'), [act({ title: '改標題' })], [plan({})], NOW);
    expect([it.plan?.lat, it.plan?.lng, it.plan?.place_query]).toEqual([25.0213, 121.5355, '台大綜合體育館']);
  });

  it('plans a posting from the post time to the end of the agreed time', async () => {
    const seek = plan({ start_at: at('2026-11-14T08:00:00'), end_at: at('2026-11-16T22:00:00'), extra: JSON.stringify({ role: 'seek', level: '初階', play_at: at('2026-11-16T20:00:00'), play_end: at('2026-11-16T22:00:00') }) });
    const [it] = await planEdited(fakeEnv(), post('badminton'), [act({ startAt: at('2026-11-17T20:00:00'), endAt: at('2026-11-17T23:00:00') })], [seek], NOW);
    const p = it.plan!;
    expect([p.start_at, p.end_at]).toEqual([at('2026-11-14T08:00:00'), at('2026-11-17T23:00:00')]);
    expect(JSON.parse(p.extra!)).toMatchObject({ role: 'seek', level: '初階', play_at: at('2026-11-17T20:00:00'), play_end: at('2026-11-17T23:00:00') });
  });

  it('plans dog sitting by work days and keeps the pay', async () => {
    const job = plan({ kind: 'job', title: '徵遛狗', item: '時薪200', start_at: at('2026-11-14T08:00:00'), end_at: at('2026-11-21T00:00:00'), place_text: '大安區', place_query: '大安區', extra: JSON.stringify({ role: 'hire', work_from: '2026-11-20', work_to: null, slots: ['09:00-11:00'], pay: '時薪200', employer: null, contact: 'dm', requirements: null }) });
    const [it] = await planEdited(fakeEnv(), post('dog'), [act({ title: '徵遛狗', startAt: at('2026-11-22T00:00:00'), endAt: at('2026-11-23T00:00:00'), place: '大安區', ref: 0 })], [job], NOW);
    const p = it.plan!;
    expect([p.kind, p.item, p.start_at, p.end_at]).toEqual(['job', '時薪200', at('2026-11-14T08:00:00'), at('2026-11-24T00:00:00')]);
    expect(JSON.parse(p.extra!)).toMatchObject({ work_from: '2026-11-22', work_to: '2026-11-23', slots: ['09:00-11:00'], pay: '時薪200', contact: 'dm' });
  });

  it('plans a newly added item without a judged one by the radar\'s own kind', async () => {
    const [it] = await planEdited(fakeEnv(), post('food'), [act({ title: '餐車出攤', place: '華山文創園區', lat: 25.044, lng: 121.529, ref: null })], [], NOW);
    expect(it.plan?.kind).toBe('food');
    expect(JSON.parse(it.plan!.extra!)).toMatchObject({ role: 'vendor' });
  });
});
