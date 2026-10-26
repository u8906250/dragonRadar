import { describe, expect, it } from 'vitest';
import { guessedMidnight, missingActivityParts, normalizeActivities } from '../src/extract';
import type { PlanItem } from '../src/events';
import { editItemsOf, editSummary, notListedWhy, parseEditItems, ReportError, reportModules } from '../src/reports';

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
    expect(a).toEqual({ title: '發飄帶', startAt: T18, endAt: null, place: 'PEG coffee', lat: null, lng: null });
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
      { group: 0, plan: { ...plan }, reason: 'planned' },
      { group: 1, plan: null, reason: 'duplicate_of_3' },
      { group: 2, plan: null, reason: 'incomplete:place', fail: { title: '市集', place: '本店', reason: 'incomplete', missing: ['place'], selfPlace: '本店', startAt: T18, endAt: T20, endOpen: false } },
      { group: 3, plan: null, reason: 'incomplete:start', fail: { title: '講座', place: '公館', reason: 'incomplete', missing: ['start'], dateOnly: T18 - 10 * 3600 } },
    ];
    expect(editItemsOf(items)).toEqual([
      { title: '發飄帶', startAt: T18, endAt: null, place: 'PEG coffee', lat: 25.02, lng: 121.53, approxArea: null },
      { title: '市集', startAt: T18, endAt: T20, place: '', lat: null, lng: null },
      { title: '講座', startAt: T18 - 10 * 3600, dateOnly: true, endAt: null, place: '公館', lat: null, lng: null },
    ]);
  });
});

describe('editSummary', () => {
  const before = [{ title: '發飄帶', startAt: T18, endAt: null, place: 'PEG coffee', lat: 25.02, lng: 121.53 }];
  it('lists only what the reporter changed', () => {
    expect(editSummary(before, [{ title: '發飄帶', startAt: T18, endAt: null, place: 'PEG coffee', lat: null, lng: null }])).toBeNull();
    expect(editSummary(before, [{ title: '發飄帶', startAt: T18, endAt: T20, place: 'PEG coffee', lat: 25.03, lng: 121.54 }])).toBe('改了時間 10/26 18:00–20:00、在地圖上標了位置');
  });
  it('lists everything for an activity the AI did not read', () => {
    const acts = [{ title: 'A', startAt: T18, endAt: null, place: 'B', lat: null, lng: null }, { title: 'C', startAt: T20, endAt: null, place: 'D', lat: null, lng: null }];
    expect(editSummary([], acts)).toBe('改了第 1 場內容「A」、時間 10/26 18:00 開始（發完為止）、地點「B」；第 2 場內容「C」、時間 10/26 20:00 開始（發完為止）、地點「D」');
    // 沒排上雷達的那場不寫
    expect(editSummary([], acts, [false, true])).toBe('改了內容「C」、時間 10/26 20:00 開始（發完為止）、地點「D」');
  });
});
