import { describe, expect, it } from 'vitest';
import { editItemsOf, editSummary, parseEditItems, reportModules } from '../src/reports';
import { normalizeTaipai, storeExtra } from '../src/taipai';
import { planEdited, type PlanItem } from '../src/events';

/** 假的 D1：什麼都查不到 */
const fakeEnv = (): never => {
  const stmt = { bind: () => stmt, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) };
  return { DB: { prepare: () => stmt, batch: async () => [] } } as never;
};

describe('normalizeTaipai', () => {
  it('reads each store with its type and hours', () => {
    const r = normalizeTaipai({
      is_event: true,
      reason: null,
      tags: ['咖啡', '手沖'],
      events: [
        { name: '慢工咖啡', type: 'cafe', hours: '週二至週日 11:00–20:00，週一公休', place_text: '師大路 100 號', place_query: '台北市大安區師大路100號', confidence: 0.9 },
        { name: '島嶼書房', type: 'BOOK', hours: null, place_text: null, place_query: null, confidence: 0.6 },
        { name: '', type: 'eat', hours: null, place_text: null, place_query: null, confidence: 0.9 },
      ],
    });
    expect(r?.events).toHaveLength(2);
    expect(r?.events[0]).toMatchObject({ kind: 'store', title: '慢工咖啡', place_query: '台北市大安區師大路100號', start_at: null, spot: false });
    expect(r?.events[0].extra).toMatchObject({ type: 'cafe', hours: '週二至週日 11:00–20:00，週一公休' });
    expect((r?.events[0].extra?.open as unknown[]).length).toBe(6);
    // 只有店名：拿店名去查；類型大小寫不分，沒寫營業時間就不知道有沒有開
    expect(r?.events[1]).toMatchObject({ title: '島嶼書房', place_text: '島嶼書房', place_query: '島嶼書房', extra: { type: 'book', hours: null, open: null } });
    expect(r?.tags).toEqual(['咖啡', '手沖']);
  });
  it('keeps the reason when it is not a taipai store', () => {
    const r = normalizeTaipai({ is_event: false, reason: '沒寫這家店是台派', tags: ['咖啡'], events: [{ name: 'x', type: 'cafe', hours: null, place_text: 'x', place_query: null, confidence: 0.9 }] });
    expect(r).toMatchObject({ is_event: false, reason: '沒寫這家店是台派', events: [] });
  });
  it('unknown types become other', () => {
    expect(storeExtra('casino', null)).toEqual({ type: 'other', hours: null, open: null });
  });
});

describe('台派雷達的修改表單', () => {
  const plan = (extra: Record<string, unknown>): PlanItem => ({
    group: 0,
    reason: 'planned',
    plan: { kind: 'store', title: '慢工咖啡', item: null, start_at: 100, end_at: 200, place_text: '師大路 100 號', place_query: '師大路 100 號', lat: 25.02, lng: 121.53, confidence: 0.9, all_day: false, spot: false, approx_area: null, end_open: true, until_open: false, weekdays: null, tz: null, extra: JSON.stringify(extra) },
  });
  it('lists name, place, hours and type without times', () => {
    const [it] = editItemsOf([plan({ type: 'cafe', hours: '11:00-20:00', tags: ['咖啡'] })], 'taipai');
    expect(it).toMatchObject({ ref: 0, title: '慢工咖啡', place: '師大路 100 號', startAt: null, endAt: null, hours: '11:00-20:00', storeType: 'cafe', tags: ['咖啡'] });
  });
  it('parses stores without asking for a time', () => {
    const [a] = parseEditItems([{ title: ' 慢工咖啡 ', place: '師大路 100 號', hours: ' 週一公休 ', storeType: 'cafe', ref: 0 }], 'taipai');
    expect(a).toMatchObject({ title: '慢工咖啡', hours: '週一公休', storeType: 'cafe', ref: 0, lat: null });
    expect(parseEditItems([{ title: 'x', place: 'y', storeType: 'casino', hours: '' }], 'taipai')[0]).toMatchObject({ storeType: 'other', hours: null });
    expect(() => parseEditItems([{ title: '', place: 'y' }], 'taipai')).toThrow('請填店名');
  });
  it('writes what changed', () => {
    const before = editItemsOf([plan({ type: 'cafe', hours: '11:00-20:00' })], 'taipai');
    const after = parseEditItems([{ title: '慢工咖啡', place: '師大路 100 號', hours: '11:00-21:00', storeType: 'book', ref: 0 }], 'taipai');
    expect(editSummary(before, after, [true], '家')).toBe('改了類型「書店」、營業時間「11:00-21:00」');
  });
  it('plans an edited store from the form: hours read again, shown for a year', async () => {
    const now = 1_800_000_000;
    const acts = parseEditItems([{ title: '慢工咖啡', place: '師大路 100 號', lat: 25.0251, lng: 121.5288, hours: '週二至週日 11:00-20:00，週一公休', storeType: 'cafe', tags: ['咖啡'], ref: 0 }], 'taipai');
    const [it] = await planEdited(fakeEnv(), { id: 'link-x', module: 'taipai', text: '台派咖啡', posted_at: now - 86400, source: 'link' } as never, acts, [plan({ type: 'eat', hours: null, open: null })], now);
    expect(it.plan).toMatchObject({ kind: 'store', title: '慢工咖啡', lat: 25.0251, lng: 121.5288, start_at: now, end_at: now + 365 * 86400, end_open: true, spot: false });
    const extra = JSON.parse(it.plan!.extra!) as { type: string; hours: string; open: unknown[]; tags: string[] };
    expect([extra.type, extra.hours, extra.open.length, extra.tags]).toEqual(['cafe', '週二至週日 11:00-20:00，週一公休', 6, ['咖啡']]);
  });
  it('takes reports like the other radars', () => {
    expect(reportModules('true')).toContain('taipai');
  });
});
