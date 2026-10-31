import { describe, expect, it } from 'vitest';
import { cleanTopic, guessedMidnight, missingActivityParts, normalizeActivities, reconcileRouteStops, routeStopLines, type ExtractedEvent } from '../src/extract';
import { applyManualFixes, atLocalTimes, markRoutes, startAtPostTime, profilePlanBetter, sortStops, stopNameOf, withoutStop, type ManualFix, type PlanItem } from '../src/events';
import { parseIsoToUnix } from '../src/util';
import type { Env } from '../src/env';
import { editItemsOf, editSummary, notListedWhy, parseEditItems, ReportError, reportModules, routePreviews } from '../src/reports';

describe('normalizeActivities', () => {
  it('keeps every event as a single activity and blanks a missing title', () => {
    const ex = normalizeActivities(
      JSON.stringify({
        is_event: true,
        events: [
          { title: '景華公園表演同樂會', start_at: '2026-10-26T14:00:00+08:00', end_at: '2026-10-26T17:00:00+08:00', place_text: '景華公園', place_query: '台北市 景華公園', confidence: 0.9 },
          { title: null, start_at: '2026-10-27T14:00:00+08:00', end_at: null, place_text: null, place_query: null, confidence: 0.6, country: 'TW' },
        ],
      }),
    );
    expect(ex?.is_event).toBe(true);
    expect(ex?.events).toHaveLength(2);
    expect(ex?.events.every((e) => e.kind === 'activity' && !e.spot && e.item === null && e.until === null)).toBe(true);
    expect(ex?.events[1].title).toBe('');
    expect(ex?.events[1].country).toBeNull();
  });
  it('drops events when the post is not an event and keeps the reason', () => {
    const ex = normalizeActivities({ is_event: false, reason: '這是活動心得，不是預告', events: [{ title: 'x' }] });
    expect(ex?.events).toEqual([]);
    expect(ex?.reason).toBe('這是活動心得，不是預告');
  });
  it('has no reason when the post is an event', () => {
    expect(normalizeActivities({ is_event: true, reason: '？', events: [] })?.reason).toBeNull();
  });
});

describe('normalizeActivities topic', () => {
  it('keeps the topic the model read from the post, for each event', () => {
    const ex = normalizeActivities({
      is_event: true,
      reason: null,
      events: [
        { topic: '遊行', title: '凱道同志遊行', start_at: null, end_at: null, place_text: '凱達格蘭大道', place_query: '台北市 凱達格蘭大道', confidence: 0.9 },
        { topic: '講座活動', title: '公館講座', start_at: null, end_at: null, place_text: '公館', place_query: '台北市 公館', confidence: 0.9 },
        { topic: null, title: '同樂會', start_at: null, end_at: null, place_text: '景華公園', place_query: '景華公園', confidence: 0.9 },
      ],
    });
    expect(ex?.events.map((e) => e.extra)).toEqual([{ topic: '遊行' }, { topic: '講座' }, null]);
  });
  it('cleans the topic: no symbols, no bare 活動, not a whole sentence', () => {
    expect(cleanTopic('「市集」')).toBe('市集');
    expect(cleanTopic('🎤 開講')).toBe('開講');
    expect(cleanTopic('活動')).toBeNull();
    expect(cleanTopic('null')).toBeNull();
    expect(cleanTopic('在公園舉辦的表演同樂會')).toBeNull();
    expect(cleanTopic(3)).toBeNull();
  });
});

describe('normalizeActivities place from the bio', () => {
  it('uses the query when the model copied the bio line into the place', () => {
    const ex = normalizeActivities({ is_event: true, reason: null, events: [{ title: '發飄帶', start_at: null, end_at: null, place_text: '@bloomteatw：簡介「可外送、自取 地址：板橋區文化路一段343號」', place_query: '新北市板橋區文化路一段343號', confidence: 0.9 }] });
    expect(ex?.events[0].place_text).toBe('新北市板橋區文化路一段343號');
    const ok = normalizeActivities({ is_event: true, reason: null, events: [{ title: '發飄帶', start_at: null, end_at: null, place_text: '板橋區文化路一段343號', place_query: '新北市板橋區文化路一段343號', confidence: 0.9 }] });
    expect(ok?.events[0].place_text).toBe('板橋區文化路一段343號');
    const handle = normalizeActivities({ is_event: true, reason: null, events: [{ title: '發小物', start_at: null, end_at: null, place_text: '@bellydailycafe', place_query: '台北市大安區新生南路三段19巷3號', confidence: 0.9 }] });
    expect(handle?.events[0].place_text).toBe('台北市大安區新生南路三段19巷3號');
  });
});

describe('missingActivityParts', () => {
  const full = { title: '保安宮市政開講', place_text: '保安宮', place_query: '台北市 大龍峒保安宮', start_at: '2026-10-26T19:00:00+08:00', end_at: '2026-10-26T21:00:00+08:00' };
  it('accepts content, place and start', () => {
    expect(missingActivityParts(full)).toEqual([]);
  });
  it('does not need an end time (shown as 發完為止)', () => {
    const { end_at: _end, ...noEnd } = full;
    expect(missingActivityParts(noEnd)).toEqual([]);
  });
  it('lists what is missing in order', () => {
    expect(missingActivityParts({ title: ' ', place_text: null, place_query: null, start_at: 'soon' })).toEqual(['content', 'place', 'start']);
  });
  it('takes the place from either field', () => {
    expect(missingActivityParts({ ...full, place_query: null })).toEqual([]);
    expect(missingActivityParts({ ...full, place_text: null })).toEqual([]);
  });
});

describe('notListedWhy incomplete', () => {
  it('merges what each activity lacks', () => {
    expect(
      notListedWhy([
        { group: 0, plan: null, reason: 'incomplete:start' },
        { group: 1, plan: null, reason: 'incomplete:place,start' },
      ]),
    ).toEqual({ reason: 'incomplete', missing: ['place', 'start'] });
  });
  it('says nothing for reasons from older rules (end time used to be required)', () => {
    expect(notListedWhy([{ group: 0, plan: null, reason: 'incomplete:end' }])).toBeUndefined();
  });
  it('stays generic when mixed with other reasons', () => {
    expect(notListedWhy([{ group: 0, plan: null, reason: 'incomplete:start' }, { group: 1, plan: null, reason: 'already_over' }])).toBeUndefined();
  });
});

describe('reportModules', () => {
  it('opens every module by default or with "true"', () => {
    expect(reportModules(undefined)).toEqual(['current', 'dog', 'badminton', 'food']);
    expect(reportModules('true')).toEqual(['current', 'dog', 'badminton', 'food']);
  });
  it('locks everything with "false"', () => {
    expect(reportModules('false')).toEqual([]);
  });
  it('opens only the listed modules', () => {
    expect(reportModules('current')).toEqual(['current']);
    expect(reportModules(' current , food ,nope')).toEqual(['current', 'food']);
  });
});

describe('guessedMidnight', () => {
  const midnightTw = Date.UTC(2026, 9, 26, 16) / 1000; // 10/27 00:00 台灣時間
  it('treats a date-only start the model filled as 00:00 as missing', () => {
    expect(guessedMidnight(midnightTw, null, '10/27 在大安森林公園發飄帶')).toBe(true);
  });
  it('keeps a midnight the post actually wrote', () => {
    expect(guessedMidnight(midnightTw, null, '10/27 00:00 跨夜發飄帶')).toBe(false);
    expect(guessedMidnight(midnightTw, null, '10/26 午夜開始發')).toBe(false);
    expect(guessedMidnight(midnightTw, null, '凌晨12點準時發')).toBe(false);
  });
  it('ignores other times', () => {
    expect(guessedMidnight(midnightTw + 3600, null, '10/27 1:00 發飄帶')).toBe(false);
  });
  it('uses the local time zone abroad', () => {
    const midnightLa = Date.UTC(2026, 9, 27, 7) / 1000; // 洛杉磯 10/27 00:00
    expect(guessedMidnight(midnightLa, 'America/Los_Angeles', 'Oct 27 Memorial Park')).toBe(true);
    expect(guessedMidnight(midnightLa, null, 'Oct 27 Memorial Park')).toBe(false);
  });
});

// 2026-10-26 18:00、20:00（台北）
const T18 = Date.UTC(2026, 9, 26, 10) / 1000;
const T20 = T18 + 7200;

describe('parseEditItems', () => {
  it('needs content, place and start; a blank end is open', () => {
    const [a] = parseEditItems([{ title: '  發飄帶 ', place: 'PEG coffee', startAt: T18, endAt: null, lat: null, lng: null }]);
    expect(a).toEqual({ title: '發飄帶', topic: null, startAt: T18, endAt: null, place: 'PEG coffee', lat: null, lng: null });
    // 主題可以不填；填了照判讀的規則整理（拿掉符號、後面的「活動」）
    expect(parseEditItems([{ title: 'x', topic: ' 遊行！', place: 'y', startAt: T18 }])[0].topic).toBe('遊行');
    expect(parseEditItems([{ title: 'x', topic: '活動', place: 'y', startAt: T18 }])[0].topic).toBeNull();
    expect(() => parseEditItems([{ title: '', place: 'PEG coffee', startAt: T18 }])).toThrow('請填活動內容');
    expect(() => parseEditItems([{ title: 'x', place: ' ', startAt: T18 }])).toThrow('請填地點');
    expect(() => parseEditItems([{ title: 'x', place: 'y' }, { title: 'x', place: 'y', startAt: 1.5 }])).toThrow('第 1 場：請填哪天幾點開始');
    expect(() => parseEditItems([])).toThrow(ReportError);
  });

  it('checks the end and keeps a pin only with both coordinates', () => {
    expect(() => parseEditItems([{ title: 'x', place: 'y', startAt: T18, endAt: T18 }])).toThrow('結束時間');
    expect(() => parseEditItems([{ title: 'x', place: 'y', startAt: T18, endAt: T18 + 25 * 3600 }])).toThrow('結束時間');
    expect(parseEditItems([{ title: 'x', place: 'y', startAt: T18, endAt: T20, lat: 25.02, lng: 121.53 }])[0]).toMatchObject({ endAt: T20, lat: 25.02, lng: 121.53 });
    expect(parseEditItems([{ title: 'x', place: 'y', startAt: T18, lat: 25.02 }])[0]).toMatchObject({ lat: null, lng: null });
    expect(parseEditItems([{ title: 'x', place: 'y', startAt: T18, lat: 95, lng: 121 }])[0]).toMatchObject({ lat: null, lng: null });
  });
});

describe('editItemsOf', () => {
  it('prefills planned and failed activities, skipping duplicates', () => {
    const plan = { kind: 'activity', title: '發飄帶', item: null, start_at: T18, end_at: T20, place_text: 'PEG coffee', place_query: 'PEG coffee', lat: 25.02, lng: 121.53, confidence: 1, all_day: false, spot: false, approx_area: null, end_open: true, until_open: false } as const;
    const items: PlanItem[] = [
      { group: 0, plan: { ...plan, extra: JSON.stringify({ topic: '發放' }) }, reason: 'planned' },
      { group: 1, plan: null, reason: 'duplicate_of_3' },
      { group: 2, plan: null, reason: 'incomplete:place', fail: { title: '市集', place: '本店', topic: '市集', reason: 'incomplete', missing: ['place'], selfPlace: '本店', startAt: T18, endAt: T20, endOpen: false } },
      { group: 3, plan: null, reason: 'incomplete:start', fail: { title: '講座', place: '公館', reason: 'incomplete', missing: ['start'], dateOnly: T18 - 10 * 3600 } },
    ];
    expect(editItemsOf(items)).toEqual([
      { title: '發飄帶', topic: '發放', startAt: T18, endAt: null, place: 'PEG coffee', lat: 25.02, lng: 121.53, approxArea: null },
      { title: '市集', topic: '市集', startAt: T18, endAt: T20, place: '', lat: null, lng: null },
      { title: '講座', topic: null, startAt: T18 - 10 * 3600, dateOnly: true, endAt: null, place: '公館', lat: null, lng: null },
    ]);
  });
});

describe('editSummary', () => {
  const before = [{ title: '發飄帶', startAt: T18, endAt: null, place: 'PEG coffee', lat: 25.02, lng: 121.53 }];
  it('lists only what the reporter changed', () => {
    expect(editSummary(before, [{ title: '發飄帶', startAt: T18, endAt: null, place: 'PEG coffee', lat: null, lng: null }])).toBeNull();
    expect(editSummary(before, [{ title: '發飄帶', startAt: T18, endAt: T20, place: 'PEG coffee', lat: 25.03, lng: 121.54 }])).toBe('改了時間 10/26 18:00–20:00、在地圖上標了位置');
  });
  it('mentions a changed topic', () => {
    const judged = [{ ...before[0], topic: '發放' }];
    expect(editSummary(judged, [{ ...judged[0], lat: null, lng: null }])).toBeNull();
    expect(editSummary(judged, [{ ...judged[0], topic: '市集', lat: null, lng: null }])).toBe('改了主題「市集」');
  });
  it('lists everything for an activity the AI did not read', () => {
    const acts = [{ title: 'A', startAt: T18, endAt: null, place: 'B', lat: null, lng: null }, { title: 'C', startAt: T20, endAt: null, place: 'D', lat: null, lng: null }];
    expect(editSummary([], acts)).toBe('改了第 1 場內容「A」、時間 10/26 18:00 開始、地點「B」；第 2 場內容「C」、時間 10/26 20:00 開始、地點「D」');
    // 沒排上雷達的那場不寫
    expect(editSummary([], acts, [false, true])).toBe('改了內容「C」、時間 10/26 20:00 開始、地點「D」');
  });
  it('writes overseas times in local time', () => {
    const acts = [{ title: 'A', startAt: Date.UTC(2026, 9, 28, 17, 0) / 1000, endAt: null, place: 'B', lat: null, lng: null }];
    expect(editSummary([], acts, [true], '場', ['America/Los_Angeles'])).toBe('改了內容「A」、時間 10/28 10:00 開始（當地時間）、地點「B」');
  });
});

describe('atLocalTimes', () => {
  // 寫了州和郵遞區號的不用查地點，env 用不到
  const env = {} as Env;
  it('reads the form times as local time for an overseas place', async () => {
    // 網頁照台北時間換的 10/28 11:00、13:00
    const tpe = (h: number): number => Date.UTC(2026, 9, 28, h - 8, 0) / 1000;
    const [us] = await atLocalTimes(env, [{ title: 'A', startAt: tpe(11), endAt: tpe(13), place: '12901 Alcosta Blvd D, San Ramon, CA 94583美國', lat: null, lng: null }]);
    // 加州 10/28 是夏令時間（UTC-7）
    expect(us.startAt).toBe(Date.UTC(2026, 9, 28, 18, 0) / 1000);
    expect(us.endAt).toBe(Date.UTC(2026, 9, 28, 20, 0) / 1000);
    const tw = { title: 'B', startAt: tpe(11), endAt: null, place: '台北市中正區忠孝東路二段94號', lat: null, lng: null };
    expect(await atLocalTimes(env, [tw])).toEqual([tw]);
  });
});

describe('markRoutes', () => {
  // 2026-10-27 14:00（台北）
  const T14 = Date.UTC(2026, 9, 27, 6) / 1000;
  const NOW = T14 - 86400;
  const planned = (title: string, place: string, at: number, approx: string | null = null): PlanItem => ({
    group: 0,
    // 每一站不同位置（差 20 分鐘差約 130 m）
    plan: { kind: 'activity', title, item: null, start_at: at, end_at: at + 7200, place_text: place, place_query: place, lat: 25 + (at - T14) / 1e6, lng: 121.5, confidence: 1, all_day: false, spot: false, approx_area: approx, end_open: true, until_open: false },
    reason: 'planned',
  });
  const stops = (): PlanItem[] => [
    planned('永福宮車掃', '鶯歌永福宮', T14),
    planned('服務處車掃', '蘇巧慧鶯歌服務處', T14 + 1200, '新北市鶯歌區'),
    planned('濟安宮車掃', '樹林濟安宮', T14 + 3600),
    { group: 3, plan: null, reason: 'unlocated', fail: { title: '鎮南宮', place: '樹林鎮南宮', reason: 'unlocated', startAt: T14 + 4500, endOpen: true } },
  ];

  it('turns same-day stops into one route', () => {
    const items = markRoutes(stops(), '10/27 報告號次大車掃', '蘇巧慧報告號次大車掃', NOW);
    expect(items.map((it) => [it.route?.seq, it.route?.kind, it.route?.stopTitle])).toEqual([
      [1, 'start', '蘇巧慧報告號次大車掃・鶯歌永福宮'],
      [2, 'cheer', '蘇巧慧報告號次大車掃・蘇巧慧鶯歌服務處'],
      [3, 'cheer', '蘇巧慧報告號次大車掃・樹林濟安宮'],
      [4, 'end', '蘇巧慧報告號次大車掃・樹林鎮南宮'],
    ]);
    // 每一站：預計經過前 10 分鐘到經過後 15 分鐘
    expect(items[0].plan).toMatchObject({ title: '蘇巧慧報告號次大車掃・鶯歌永福宮', start_at: T14 - 600, end_at: T14 + 900, end_open: false });
    expect(items[0].route).toMatchObject({ key: '2026-10-27', at: T14, lat: 25, lng: 121.5 });
    // 只定位到鄉鎮區：不放上雷達，帶著約略位置給回報的人標
    expect(items[1].plan).toBeNull();
    expect(items[1].reason).toBe('approximate');
    expect(items[1].fail).toMatchObject({ reason: 'approximate', area: '新北市鶯歌區', startAt: T14 + 1200, lat: 25.0012 });
    expect(items[1].route?.lat).toBeNull();
    expect(items[3].fail?.title).toBe('蘇巧慧報告號次大車掃・樹林鎮南宮');
  });

  it('keeps passed stops on the timetable only', () => {
    const items = markRoutes(stops(), '掃街', null, T14 + 1800);
    expect(items[0].plan).toBeNull();
    expect(items[0].reason).toBe('already_over');
    expect(items[0].route).toMatchObject({ title: '掃街路線', lat: 25 });
    expect(items[2].plan?.start_at).toBe(T14 + 3000);
  });

  it('needs the keyword, two stops a day and one listable stop', () => {
    expect(markRoutes(stops(), '發飄帶', null, NOW).some((it) => it.route)).toBe(false);
    expect(markRoutes([planned('a', 'A', T14), planned('b', 'B', T14 + 86400)], '車隊', null, NOW).some((it) => it.route)).toBe(false);
    expect(markRoutes([planned('a', 'A', T14, '新北市鶯歌區'), planned('b', 'B', T14 + 600, '新北市樹林區')], '車隊', null, NOW).some((it) => it.route)).toBe(false);
  });

  it('keeps the reporter titles when editing', () => {
    const items = markRoutes([planned('我改的標題', 'A', T14), planned('b', 'B', T14 + 600)], '車掃', 'X', NOW, false);
    expect(items[0].plan?.title).toBe('我改的標題');
    expect(items[0].route?.stopTitle).toBe('我改的標題');
  });

  it('names the stop from the title when the place is an address', () => {
    const addr = '239新北市鶯歌區東鶯里文化路175號';
    const items = markRoutes([planned('R・鶯歌永福宮', '鶯歌永福宮', T14), planned('R・蘇巧慧鶯歌服務處', addr, T14 + 1200)], '車掃', 'R', NOW, false);
    expect(items[0].route).toMatchObject({ name: '鶯歌永福宮' });
    expect(items[0].route?.place).toBeUndefined();
    expect(items[1].route).toMatchObject({ name: '蘇巧慧鶯歌服務處', place: addr, stopTitle: 'R・蘇巧慧鶯歌服務處' });
    expect(routePreviews(items)[0].stops[1]).toMatchObject({ name: '蘇巧慧鶯歌服務處', place: addr });
    // 雷達上的這一站照樣是地址
    expect(items[1].plan?.place_text).toBe(addr);
  });

  it('lists the route for the preview and prefills the stop times', () => {
    const items = markRoutes(stops(), '車掃', 'R', NOW);
    expect(routePreviews(items)).toEqual([
      {
        title: 'R',
        stops: [
          { kind: 'start', name: '鶯歌永福宮', at: T14, lat: 25, lng: 121.5, status: 'listed' },
          { kind: 'cheer', name: '蘇巧慧鶯歌服務處', at: T14 + 1200, lat: null, lng: null, status: 'approximate', area: '新北市鶯歌區' },
          { kind: 'cheer', name: '樹林濟安宮', at: T14 + 3600, lat: 25.0036, lng: 121.5, status: 'listed' },
          { kind: 'end', name: '樹林鎮南宮', at: T14 + 4500, lat: null, lng: null, status: 'unlocated' },
        ],
      },
    ]);
    const edit = editItemsOf(items);
    expect(edit.map((e) => [e.startAt, e.endAt])).toEqual([[T14, null], [T14 + 1200, null], [T14 + 3600, null], [T14 + 4500, null]]);
    expect(edit[1]).toMatchObject({ approxArea: '新北市鶯歌區', lat: 25.0012 });
  });
});

describe('profilePlanBetter', () => {
  const noTime: PlanItem = { group: 0, plan: null, reason: 'incomplete:start', fail: { title: '發飄帶', place: '板橋區文化路一段343號', reason: 'incomplete', missing: ['start'] } };
  const noPlace: PlanItem = { group: 0, plan: null, reason: 'incomplete:place,start', fail: { title: '發飄帶', place: null, reason: 'incomplete', missing: ['place', 'start'] } };
  const listed: PlanItem = {
    group: 0,
    plan: { kind: 'activity', title: '發飄帶', item: null, start_at: 1, end_at: 2, place_text: 'x', place_query: 'x', lat: 25, lng: 121.5, confidence: 1, all_day: false, spot: false, approx_area: null, end_open: true, until_open: false },
    reason: 'planned',
  };
  it('prefers the bio result when it finds the place, even without a time', () => {
    // 第一次判成不是活動（沒有任何一筆）、讀簡介後地點有了只缺時間
    expect(profilePlanBetter([], [noTime])).toBe(true);
    expect(profilePlanBetter([noPlace], [noTime])).toBe(true);
    expect(profilePlanBetter([noTime], [listed])).toBe(true);
  });
  it('keeps the first result when the bio does not help', () => {
    expect(profilePlanBetter([], [noPlace])).toBe(false);
    expect(profilePlanBetter([noTime], [noTime])).toBe(false);
    expect(profilePlanBetter([listed], [noTime])).toBe(false);
  });
});

describe('stopNameOf', () => {
  it('takes the stop name from the stop title', () => {
    expect(stopNameOf('蘇巧慧報告號次大車掃・蘇巧慧樹林服務處', '蘇巧慧報告號次大車掃', '238新北市樹林區大安路499號')).toBe('蘇巧慧樹林服務處');
    expect(stopNameOf('別的名稱・樹林濟安宮', 'R', '樹林濟安宮')).toBe('樹林濟安宮');
    expect(stopNameOf('R', 'R', '新北市樹林區大安路499號')).toBe('新北市樹林區大安路499號');
    expect(stopNameOf('R・', 'R', '樹林濟安宮')).toBe('樹林濟安宮');
    expect(stopNameOf('鶯歌永福宮出發', 'R', '新北市鶯歌區')).toBe('鶯歌永福宮出發');
  });
});

const SU_POST = `大新北水獺戰士集合！10/27報告號次大車掃🚗

🌟應援點🌟
① 14:00｜鶯歌永福宮
② 14:20｜蘇巧慧鶯歌服務處
③ 14:50｜蘇巧慧樹林服務處
④ 15:00｜樹林濟安宮
⑤ 15:15｜樹林鎮南宮
⑥ 15:50｜蘇巧慧新莊西盛服務處
⑦ 16:00｜新莊西盛庄福德宮

時間僅供參考，依實際行程狀況調整。`;

describe('routeStopLines', () => {
  it('reads one stop per line', () => {
    expect(routeStopLines(SU_POST).map((l) => `${l.hm} ${l.name}`)).toEqual([
      '14:00 鶯歌永福宮',
      '14:20 蘇巧慧鶯歌服務處',
      '14:50 蘇巧慧樹林服務處',
      '15:00 樹林濟安宮',
      '15:15 樹林鎮南宮',
      '15:50 蘇巧慧新莊西盛服務處',
      '16:00 新莊西盛庄福德宮',
    ]);
    expect(routeStopLines('1. 18:30 中山站 2號出口\n2. 19:00 雙連站（1號出口）')).toEqual([
      { hm: '18:30', name: '中山站 2號出口' },
      { hm: '19:00', name: '雙連站' },
    ]);
    // 時段、只有一行的不算
    expect(routeStopLines('14:00–16:00 發飄帶\n18:00–20:00 發飄帶')).toEqual([]);
    expect(routeStopLines('① 14:00｜鶯歌永福宮')).toEqual([]);
  });
});

describe('reconcileRouteStops', () => {
  const ev = (hm: string, place: string, query: string): ExtractedEvent => ({
    kind: 'activity', title: `${place}車掃`, item: null, start_at: `2026-10-27T${hm}:00+08:00`, end_at: null, place_text: place, place_query: query, confidence: 0.95, spot: false, until: null,
  });
  it('adds the stop the model dropped and fixes a query borrowed from another stop', () => {
    // 模型漏了第一站，又把鶯歌服務處查成永福宮
    const model = [
      ev('14:20', '蘇巧慧鶯歌服務處', '新北市鶯歌區永福宮'),
      ev('14:50', '蘇巧慧樹林服務處', '新北市樹林區'),
      ev('15:00', '樹林濟安宮', '新北市樹林區濟安宮'),
      ev('15:15', '樹林鎮南宮', '新北市樹林區鎮南宮'),
      ev('15:50', '蘇巧慧新莊西盛服務處', '新北市新莊區西盛服務處'),
      ev('16:00', '新莊西盛庄福德宮', '新北市新莊區西盛庄福德宮'),
    ];
    const out = reconcileRouteStops(model, SU_POST);
    expect(out).toHaveLength(7);
    expect(out[0].place_query).toBe('新北市 蘇巧慧鶯歌服務處');
    expect(out[2].place_query).toBe('新北市樹林區濟安宮');
    expect(out[6]).toMatchObject({ start_at: '2026-10-27T14:00:00+08:00', place_text: '鶯歌永福宮', place_query: '新北市 鶯歌永福宮', title: '鶯歌永福宮' });
  });
  it('leaves posts without the keyword alone', () => {
    const model = [ev('14:20', 'A', 'x')];
    expect(reconcileRouteStops(model, SU_POST.replace('車掃', '活動'))).toBe(model);
  });
});

describe('markRoutes same point', () => {
  const T14 = Date.UTC(2026, 9, 27, 6) / 1000;
  const at = (title: string, place: string, query: string, t: number): PlanItem => ({
    group: 0,
    plan: { kind: 'activity', title, item: null, start_at: t, end_at: t + 7200, place_text: place, place_query: query, lat: 24.9543, lng: 121.3417, confidence: 1, all_day: false, spot: false, approx_area: null, end_open: true, until_open: false },
    reason: 'planned',
  });
  it('drops the stop whose query names another stop', () => {
    const items = markRoutes([at('a', '鶯歌永福宮', '新北市鶯歌區永福宮', T14), at('b', '蘇巧慧鶯歌服務處', '新北市鶯歌區永福宮附近', T14 + 1200)], '車掃', 'R', T14 - 86400);
    expect(items[0].plan).not.toBeNull();
    expect(items[1].plan).toBeNull();
    expect(items[1].fail).toMatchObject({ reason: 'unlocated', sameAs: '鶯歌永福宮', title: 'R・蘇巧慧鶯歌服務處' });
    expect(routePreviews(items)[0].stops[1]).toMatchObject({ status: 'unlocated', sameAs: '鶯歌永福宮' });
  });
});

describe('withoutStop', () => {
  const st = (title: string, at: number | null, kind: 'start' | 'cheer' | 'end' = 'cheer') => ({ kind, title, at, name: title, lat: null, lng: null });
  const stops = [st('車掃・A', 100, 'start'), st('車掃・B', 200), st('車掃・C', 300), st('車掃・D', 400, 'end')];
  it('drops the stop and keeps start and end at the ends', () => {
    expect(withoutStop(stops, '車掃・B', { from: 200, to: 200 })?.map((s) => `${s.title}:${s.kind}`)).toEqual(['車掃・A:start', '車掃・C:cheer', '車掃・D:end']);
    // 拿掉出發那一站：下一站變出發
    expect(withoutStop(stops, '車掃・A', null)?.map((s) => s.kind)).toEqual(['start', 'cheer', 'end']);
    expect(withoutStop(stops, '車掃・D', { from: 350, to: 450 })?.map((s) => `${s.title}:${s.kind}`)).toEqual(['車掃・A:start', '車掃・B:cheer', '車掃・C:end']);
  });
  it('matches the time too (the same stop name on another day stays)', () => {
    expect(withoutStop(stops, '車掃・B', { from: 300, to: 400 })).toBeNull();
    expect(withoutStop(stops, '車掃・X', null)).toBeNull();
    expect(withoutStop([st('車掃・A', 100, 'start')], '車掃・A', null)).toEqual([]);
  });
});

describe('applyManualFixes', () => {
  const T14 = Date.UTC(2026, 9, 27, 6) / 1000;
  const ex = (place: string, start = '2026-10-27T14:00:00+08:00'): ExtractedEvent => ({ kind: 'activity', title: 'R', item: null, start_at: start, end_at: null, place_text: place, place_query: `新北市${place}`, confidence: 1, spot: false, until: null });
  const placeFix = (key: string, placeText: string | null): ManualFix => ({ kind: 'place', placeKey: key, atKey: 0, lat: 25.01, lng: 121.46, placeText, startAt: null, endAt: null });
  const timeFix = (key: string, at: number, startAt: number, endAt: number | null = null): ManualFix => ({ kind: 'time', placeKey: key, atKey: at, lat: null, lng: null, placeText: null, startAt, endAt });

  it('uses the pinned place and the new name, and remembers the name the AI read', () => {
    const e = ex('莒光路');
    const r = applyManualFixes(e, [placeFix('莒光路', '莒光路 1 號前')]);
    expect(r.point).toMatchObject({ lat: 25.01, lng: 121.46 });
    expect(r.placeFrom).toBe('莒光路');
    expect(e.place_text).toBe('莒光路 1 號前');
    expect(e.place_query).toBe('莒光路 1 號前');
    // 貼座標改的（名稱不變）
    const same = ex('莒光路');
    expect(applyManualFixes(same, [placeFix('莒光路', null)])).toMatchObject({ placeFrom: null, timeFixed: false });
    expect(same.place_text).toBe('莒光路');
    // 別的地點不動，也不比空白
    expect(applyManualFixes(ex('長泰街'), [placeFix('莒光路', 'X')]).point).toBeNull();
    expect(applyManualFixes(ex('莒光 路'), [placeFix('莒光路', 'X')]).point).not.toBeNull();
  });

  it('uses the new time only when the AI reads the same start at the same place', () => {
    const e = ex('莒光路');
    const r = applyManualFixes(e, [timeFix('莒光路', T14, T14 + 1800, T14 + 5400)]);
    expect(r.timeFixed).toBe(true);
    expect(parseIsoToUnix(e.start_at)).toBe(T14 + 1800);
    expect(parseIsoToUnix(e.end_at)).toBe(T14 + 5400);
    // 補充改了時間（判讀出別的時間）就照判讀的
    const later = ex('莒光路', '2026-10-27T15:00:00+08:00');
    expect(applyManualFixes(later, [timeFix('莒光路', T14, T14 + 1800)]).timeFixed).toBe(false);
    expect(later.start_at).toBe('2026-10-27T15:00:00+08:00');
    // 先改地點名稱再改時間：時間記在新的名稱
    const both = ex('莒光路');
    expect(applyManualFixes(both, [placeFix('莒光路', '莒光路 1 號前'), timeFix('莒光路1號前', T14, T14 + 600)]).timeFixed).toBe(true);
    expect(both.end_at).toBeNull();
  });

  it('keeps the stop name and skips the same-point check for a pinned stop on the route', () => {
    const at = (title: string, place: string, t: number, manualPlace?: PlanItem['manualPlace']): PlanItem => ({
      group: 0,
      plan: { kind: 'activity', title, item: null, start_at: t, end_at: t + 7200, place_text: place, place_query: place, lat: 25.01, lng: 121.46, confidence: 1, all_day: false, spot: false, approx_area: null, end_open: true, until_open: false },
      reason: 'planned',
      ...(manualPlace ? { manualPlace } : {}),
    });
    const items = markRoutes([at('a', '長泰街', T14), at('b', '莒光路 1 號前', T14 + 600, { from: '莒光路' })], '車掃', 'R', T14 - 86400);
    // 兩站在同一點也都留著（手動標的不算查錯）
    expect(items.every((it) => it.plan)).toBe(true);
    expect(items[1].route).toMatchObject({ name: '莒光路', place: '莒光路 1 號前', stopTitle: 'R・莒光路', lat: 25.01 });
    expect(items[1].plan).toMatchObject({ title: 'R・莒光路', place_text: '莒光路 1 號前' });
    expect(items[0].route?.place).toBeUndefined();
  });
});

describe('sortStops', () => {
  it('reorders the stops by time and renames start and end', () => {
    const st = (title: string, at: number | null) => ({ kind: 'cheer' as const, title, at });
    expect(sortStops([st('A', 100), st('B', 400), st('C', 300)]).map((s) => `${s.title}:${s.kind}`)).toEqual(['A:start', 'C:cheer', 'B:end']);
    expect(sortStops([st('A', null), st('B', 100)]).map((s) => s.title)).toEqual(['B', 'A']);
  });
});

describe('startAtPostTime', () => {
  // 2026-10-31 15:20（台北）發文
  const POSTED = Date.UTC(2026, 9, 31, 7, 20) / 1000;
  const iso = (t: number): string => new Date(t * 1000).toISOString();
  const ev = (start: string | null, end: string | null = null): ExtractedEvent => ({
    kind: 'activity', title: '市集', item: null, start_at: start, end_at: end, place_text: '華山', place_query: '台北市 華山1914', confidence: 0.9, spot: false, until: null,
  });
  it('starts at the post time when the post gives no start time at all', () => {
    const list = [ev(null), ev(null, '2026-10-31T18:00:00+08:00')];
    expect(startAtPostTime(list, '華山、松菸都有市集，歡迎來逛', POSTED)).toBe(2);
    expect(list.map((e) => e.start_at)).toEqual([iso(POSTED), iso(POSTED)]);
    // 結束照寫的（沒寫結束的之後照樣排兩小時）
    expect(list[1].end_at).toBe('2026-10-31T18:00:00+08:00');
  });
  it('treats a date-only start (00:00) as no time, but only on the posting day', () => {
    const today = [ev('2026-10-31T00:00:00+08:00')];
    expect(startAtPostTime(today, '今天在華山有市集', POSTED)).toBe(1);
    expect(today[0].start_at).toBe(iso(POSTED));
    const later = [ev('2026-11-02T00:00:00+08:00')];
    expect(startAtPostTime(later, '11/2 在華山有市集', POSTED)).toBe(0);
    expect(later[0].start_at).toBe('2026-11-02T00:00:00+08:00');
  });
  it('does not guess when some events have times, for routes, or when it already ended', () => {
    const mixed = [ev('2026-10-31T14:00:00+08:00'), ev(null)];
    expect(startAtPostTime(mixed, '14:00 在華山，松菸也有', POSTED)).toBe(0);
    expect(mixed[1].start_at).toBeNull();
    expect(startAtPostTime([ev(null)], '今天下午車掃，經過華山', POSTED)).toBe(0);
    const over = [ev(null, '2026-10-31T15:00:00+08:00')];
    expect(startAtPostTime(over, '市集到 15:00', POSTED)).toBe(0);
    expect(over[0].start_at).toBeNull();
  });
});
