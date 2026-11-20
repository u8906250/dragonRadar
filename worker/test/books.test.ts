import { describe, expect, it } from 'vitest';
import { editItemsOf, editSummary, parseEditItems, reportModules } from '../src/reports';
import { BOOK_TYPES, BOOKS_SPEC, normalizeBooks } from '../src/books';
import { moduleSpec, planEdited, type PlanItem } from '../src/events';
import { isStoreModule } from '../src/modules';
import { isStoreTypeOf, STORE_TYPE_NAMES } from '../src/stores';
import { STORE_TYPES } from '../src/taipai';

/** 假的 D1：什麼都查不到 */
const fakeEnv = (): never => {
  const stmt = { bind: () => stmt, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) };
  return { DB: { prepare: () => stmt, batch: async () => [] } } as never;
};

describe('normalizeBooks', () => {
  it('reads each bookstore with its type and hours', () => {
    const r = normalizeBooks({
      is_event: true,
      reason: null,
      tags: ['女性主義', '同志'],
      events: [
        { name: '瑯嬛書屋', type: 'issue', hours: '週二至週日 12:00–21:00，週一公休', place_text: '中壢', place_query: '瑯嬛書屋 中壢', from_profile: ['hours'], confidence: 0.9 },
        { name: '舊香居', type: 'USED', hours: null, place_text: null, place_query: null, from_profile: ['taipai'], confidence: 0.6 },
        { name: '', type: 'kids', hours: null, place_text: null, place_query: null, confidence: 0.9 },
      ],
    });
    expect(r?.events).toHaveLength(2);
    expect(r?.events[0]).toMatchObject({ kind: 'store', title: '瑯嬛書屋', place_query: '瑯嬛書屋 中壢', start_at: null, spot: false });
    expect(r?.events[0].extra).toMatchObject({ type: 'issue', hours: '週二至週日 12:00–21:00，週一公休', from_profile: ['hours'] });
    expect((r?.events[0].extra?.open as unknown[]).length).toBe(6);
    // 只有店名：拿店名去查；類型大小寫不分；書店雷達沒有「台派是從簡介讀的」
    expect(r?.events[1]).toMatchObject({ title: '舊香居', place_query: '舊香居', extra: { type: 'used', hours: null, open: null } });
    expect(r?.events[1].extra).not.toHaveProperty('from_profile');
    expect(r?.tags).toEqual(['女性主義', '同志']);
    expect(r).not.toHaveProperty('not_taipai');
  });
  it('keeps the reason when it is not an independent bookstore', () => {
    const r = normalizeBooks({ is_event: false, reason: '是連鎖書店', tags: ['書'], events: [{ name: '誠品', type: 'general', hours: null, place_text: 'x', place_query: null, confidence: 0.9 }] });
    expect(r).toMatchObject({ is_event: false, reason: '是連鎖書店', events: [] });
  });
  it('only takes bookstore types, and taipai store types are not bookstore types', () => {
    expect(normalizeBooks({ is_event: true, reason: null, tags: [], events: [{ name: 'x', type: 'cafe', hours: null, place_text: 'y', place_query: null, confidence: 0.9 }] })?.events[0].extra).toMatchObject({ type: 'other' });
    // 類型的 key 不重複（「其他」共用），分享連結、補充說明照 key 查名稱
    expect(Object.keys(BOOK_TYPES).filter((k) => k !== 'other' && k in STORE_TYPES)).toEqual([]);
    expect(STORE_TYPE_NAMES.issue).toBe('社會議題');
    expect(STORE_TYPE_NAMES.cafe).toBe('咖啡甜點');
    expect(isStoreTypeOf('books', 'used')).toBe(true);
    expect(isStoreTypeOf('books', 'cafe')).toBe(false);
    expect(isStoreTypeOf('taipai', 'used')).toBe(false);
  });
  it('turns away chains and event announcements', () => {
    expect(BOOKS_SPEC.system).toContain('連鎖書店（誠品、金石堂');
    expect(BOOKS_SPEC.system).toContain('主要在宣傳書店辦的活動（講座、讀書會、簽書會、市集、展覽）的不收');
    expect(moduleSpec('books')).toBe(BOOKS_SPEC);
  });
});

describe('書店雷達的修改表單', () => {
  const plan = (extra: Record<string, unknown>): PlanItem => ({
    group: 0,
    reason: 'planned',
    plan: { kind: 'store', title: '瑯嬛書屋', item: null, start_at: 100, end_at: 200, place_text: '中壢', place_query: '瑯嬛書屋 中壢', lat: 24.96, lng: 121.22, confidence: 0.9, all_day: false, spot: false, approx_area: null, end_open: true, until_open: false, weekdays: null, tz: null, extra: JSON.stringify(extra) },
  });
  it('lists and parses bookstores with bookstore types', () => {
    const [it] = editItemsOf([plan({ type: 'issue', hours: null })], 'books');
    expect(it).toMatchObject({ ref: 0, title: '瑯嬛書屋', startAt: null, hours: null, storeType: 'issue' });
    expect(parseEditItems([{ title: '瑯嬛書屋', place: '中壢', storeType: 'lit' }], 'books')[0]).toMatchObject({ storeType: 'lit', startAt: 0 });
    // 台派雷達的類型不能選
    expect(parseEditItems([{ title: 'x', place: 'y', storeType: 'cafe' }], 'books')[0]).toMatchObject({ storeType: 'other' });
    expect(() => parseEditItems([{ title: '', place: 'y' }], 'books')).toThrow('請填店名');
  });
  it('writes what changed with the bookstore type name', () => {
    const before = editItemsOf([plan({ type: 'issue', hours: null })], 'books');
    const after = parseEditItems([{ title: '瑯嬛書屋', place: '中壢', hours: '13:00-21:00', storeType: 'used', ref: 0 }], 'books');
    expect(editSummary(before, after, [true], '家')).toBe('改了類型「二手書」、營業時間「13:00-21:00」');
  });
  it('plans an edited bookstore for a year with its type kept', async () => {
    const now = 1_800_000_000;
    const acts = parseEditItems([{ title: '瑯嬛書屋', place: '中壢', lat: 24.96, lng: 121.22, hours: '週二至週日 12:00-21:00，週一公休', storeType: 'issue', tags: ['女性主義'], ref: 0 }], 'books');
    const [it] = await planEdited(fakeEnv(), { id: 'link-x', module: 'books', text: '獨立書店', posted_at: now - 86400, source: 'link' } as never, acts, [plan({ type: 'general', hours: null, open: null })], now);
    expect(it.plan).toMatchObject({ kind: 'store', title: '瑯嬛書屋', start_at: now, end_at: now + 365 * 86400, end_open: true });
    const extra = JSON.parse(it.plan!.extra!) as { type: string; open: unknown[]; tags: string[] };
    expect([extra.type, extra.open.length, extra.tags]).toEqual(['issue', 6, ['女性主義']]);
  });
  it('is a store radar that takes reports', () => {
    expect(isStoreModule('books')).toBe(true);
    expect(isStoreModule('food')).toBe(false);
    expect(reportModules('true')).toContain('books');
  });
});
