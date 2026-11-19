import { afterEach, describe, expect, it, vi } from 'vitest';
import { planPost, profilePlanBetter, type PlanItem } from '../src/events';
import { profileCandidates } from '../src/sources/profile';
import { normalizeTaipai } from '../src/taipai';

describe('台派雷達參考店家帳號的簡介（v1.768）', () => {
  it('checks the author and every tagged account for stores', () => {
    const text = '推薦 @slowcafe 跟 @islandbooks，都很棒';
    // 活動雷達：沒寫店家、發放的字，不看
    expect(profileCandidates(text, 'someone')).toEqual([]);
    expect(profileCandidates(text, 'someone', 3, true)).toEqual(['someone', 'slowcafe', 'islandbooks']);
  });
  it('keeps which fields came from the bio', () => {
    const r = normalizeTaipai({
      is_event: true,
      reason: null,
      tags: [],
      events: [
        { name: '慢工咖啡', type: 'cafe', hours: '11:00-20:00', place_text: '師大路 100 號', place_query: null, from_profile: ['hours', 'taipai', 'bogus'], confidence: 0.8 },
        { name: '島嶼書房', type: 'book', hours: null, place_text: '襄陽路', place_query: null, from_profile: [], confidence: 0.8 },
      ],
    });
    expect(r?.events[0].extra?.from_profile).toEqual(['taipai', 'hours']);
    expect(r?.events[1].extra).not.toHaveProperty('from_profile');
  });
  it('prefers the bio result when it adds opening hours to a store', () => {
    const store = (hours: string | null, lat: number | null = 25.02): PlanItem => ({
      group: 0,
      reason: 'planned',
      plan: { kind: 'store', title: '慢工咖啡', item: null, start_at: 1, end_at: 2, place_text: 'x', place_query: 'x', lat, lng: lat === null ? null : 121.5, confidence: 1, all_day: false, spot: false, approx_area: null, end_open: true, until_open: false, extra: JSON.stringify({ type: 'cafe', hours }) },
    });
    expect(profilePlanBetter([store(null)], [store('11:00-20:00')], true)).toBe(true);
    // 活動不比營業時間；讀了簡介反而查不到地點的不用
    expect(profilePlanBetter([store(null)], [store('11:00-20:00')])).toBe(false);
    expect(profilePlanBetter([store(null)], [store('11:00-20:00', null)], true)).toBe(false);
    expect(profilePlanBetter([store('10:00-18:00')], [store('11:00-20:00')], true)).toBe(false);
  });
});

describe('planPost reads the store account bio', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stmt = { bind: () => stmt, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) };
  const BIO = '<meta property="og:title" content="慢工咖啡 (@slowcafe) • Threads, Say more"><meta property="og:description" content="1,234 Followers • 台派咖啡｜週二至週日 11:00-20:00｜台北市大安區師大路 100 號">';
  /** 假的 AI：有帳號簡介時，營業時間和台派從簡介讀 */
  const ai = {
    run: vi.fn(async (_m: string, opts: { messages: Array<{ content: string }> }) => {
      // 判讀說明本身也寫了「【帳號簡介】」，要看簡介的內容
      const bio = opts.messages.some((x) => x.content.includes('台派咖啡｜'));
      const store = { name: '慢工咖啡', type: 'cafe', hours: bio ? '週二至週日 11:00-20:00' : null, place_text: '師大路 100 號', place_query: '台北市大安區師大路 100 號', from_profile: bio ? ['taipai', 'hours'] : [], confidence: 0.8 };
      return { response: { is_event: true, reason: null, tags: ['咖啡'], events: [store] } };
    }),
  };
  it('fills the hours from the bio and remembers where they came from', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.startsWith('https://www.threads.com/@slowcafe')) return new Response(BIO, { status: 200 });
        if (url.includes('nominatim')) return Response.json([{ lat: '25.0251', lon: '121.5288', display_name: '慢工咖啡, 100, 師大路, 大安區, 臺北市, 10647, 臺灣', class: 'amenity', type: 'cafe', category: 'amenity', importance: 0.3, address: { city: '臺北市', suburb: '大安區', road: '師大路', house_number: '100' } }]);
        if (url.includes('photon')) return Response.json({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [121.5288, 25.0251] }, properties: { type: 'house', name: '慢工咖啡', street: '師大路', housenumber: '100', city: '臺北市', district: '大安區', country: '臺灣', countrycode: 'TW' } }] });
        return Response.json({ elements: [] });
      }),
    );
    const env = { DB: { prepare: () => stmt, batch: async () => [] }, AI: ai, AI_MODEL: 'm' } as never;
    const post = { id: 'link-x', module: 'taipai', text: '推一家台派咖啡 @slowcafe，在師大路 100 號', posted_at: 1_800_000_000, source: 'link', username: 'someone', supplement: null } as never;
    const r = await planPost(env, post, 1_800_000_100);
    const it = r.items[0];
    expect(it.plan?.lat).not.toBeNull();
    expect(it.profileHint).toBe('@slowcafe');
    expect(JSON.parse(it.plan!.extra!)).toMatchObject({ hours: '週二至週日 11:00-20:00', from_profile: ['taipai', 'hours'], profile_from: '@slowcafe' });
    // 判讀的時候帶了簡介
    expect(ai.run.mock.calls.some(([, o]) => (o as { messages: Array<{ content: string }> }).messages.some((x) => x.content.includes('台派咖啡｜週二至週日')))).toBe(true);
  }, 60_000);
  it('does not look at accounts when the post already has the hours', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('photon')) return Response.json({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [121.5288, 25.0251] }, properties: { type: 'house', street: '師大路', housenumber: '100', city: '臺北市', district: '大安區' } }] });
      return Response.json({ elements: [] });
    });
    vi.stubGlobal('fetch', fetch);
    const run = vi.fn(async () => ({ response: { is_event: true, reason: null, tags: [], events: [{ name: '慢工咖啡', type: 'cafe', hours: '11:00-20:00', place_text: '師大路 100 號', place_query: '台北市大安區師大路 100 號', from_profile: ['hours'], confidence: 0.8 }] } }));
    const env = { DB: { prepare: () => stmt, batch: async () => [] }, AI: { run }, AI_MODEL: 'm' } as never;
    const post = { id: 'link-y', module: 'taipai', text: '台派咖啡 @slowcafe 師大路 100 號，11:00-20:00', posted_at: 1_800_000_000, source: 'link', username: 'someone', supplement: null } as never;
    const r = await planPost(env, post, 1_800_000_100);
    expect(run).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.some(([u]) => String(u).includes('threads.com'))).toBe(false);
    // 沒給簡介，判讀說「從簡介讀的」不算
    expect(JSON.parse(r.items[0].plan!.extra!)).not.toHaveProperty('from_profile');
  }, 60_000);
});
