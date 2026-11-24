import { describe, expect, it } from 'vitest';
import { normalizeSessions } from '../src/badminton';
import { detectEnded } from '../src/events';
import { datedSpotsToSingle, type ExtractedEvent } from '../src/extract';

describe('normalizeSessions', () => {
  it('reads a weekly drop-in offer with its fee, level and slots', () => {
    const r = normalizeSessions({
      is_event: true,
      events: [
        { role: 'offer', title: '信義運動中心羽球臨打', start_at: '2026-10-29T19:00:00+08:00', end_at: '2026-10-29T22:00:00+08:00', place_text: '信義運動中心 4F', place_query: '台北市 信義運動中心', spot: true, weekdays: [3], until: null, fee: '$200/人', level: '中階', slots: '缺 2 位', capacity: '16 人', courts: '2 面', shuttle: 'RSL 4 號', team: '週三羽球團', contact: 'DM', available: null, confidence: 0.9 },
      ],
    });
    expect(r?.events[0]).toMatchObject({ kind: 'session', item: '$200/人', spot: true, weekdays: [3] });
    expect(r?.events[0].extra).toEqual({ role: 'offer', available: null, fee: '$200/人', level: '中階', slots: '缺 2 位', capacity: '16 人', courts: '2 面', shuttle: 'RSL 4 號', team: '週三羽球團', contact: 'dm' });
  });
  it('keeps a player looking for a game as a posting, never a weekly spot', () => {
    const r = normalizeSessions({ is_event: true, events: [{ role: 'seek', title: '中階找臨打（台北東區）', start_at: null, end_at: null, place_text: '台北東區', place_query: '台北市 大安區', spot: true, weekdays: [6], until: null, fee: null, level: '中階', slots: null, shuttle: null, team: null, contact: 'dm', available: '週末下午', confidence: 0.8 }] });
    expect(r?.events[0]).toMatchObject({ spot: false, extra: { role: 'seek', available: '週末下午', level: '中階' } });
  });
  it('drops everything when it is not about drop-in games', () => {
    expect(normalizeSessions('{"is_event":false,"tags":["球拍"],"events":[{"title":"賣球拍"}]}')).toEqual({ is_event: false, events: [], tags: null });
  });
});

describe('detectEnded for drop-in games', () => {
  it('sees a full or cancelled session', () => {
    expect(detectEnded('今晚臨打名額已滿，謝謝大家')).toBe(true);
    expect(detectEnded('下雨場地取消')).toBe(true);
    expect(detectEnded('12/6 的場地已出讓，謝謝')).toBe(true);
    expect(detectEnded('缺 2 位，額滿為止')).toBe(false);
  });
  it('reads 場地出讓 as a single session (v1.832)', () => {
    const r = normalizeSessions({ is_event: true, events: [{ role: 'transfer', title: '黃瓜羽球館場地出讓', start_at: '2026-12-06T10:00:00+08:00', end_at: '2026-12-06T12:00:00+08:00', place_text: '黃瓜羽球館 CCB badminton', place_query: '黃瓜羽球館', spot: true, weekdays: null, until: null, fee: '$900/2hr', level: null, slots: null, capacity: '12 人', courts: '1 面', shuttle: null, team: null, contact: 'dm', available: null, confidence: 0.85 }] });
    const e = r?.events[0];
    expect(e?.title).toBe('黃瓜羽球館場地出讓');
    expect(e?.spot).toBe(false);
    expect(e?.item).toBe('$900/2hr');
    expect(e?.extra).toMatchObject({ role: 'transfer', fee: '$900/2hr', courts: '1 面', capacity: null, available: null });
    expect(normalizeSessions({ is_event: true, events: [{ role: 'transfer', title: null }] })?.events[0].title).toBe('羽球場地出讓');
  });
  it('drops the weekly session when the same place has a dated one (v1.839)', () => {
    const base = { role: 'offer', title: '三重運動中心五樓羽球臨打', place_text: '三重運動中心五樓', place_query: '新北市三重區集美街55號', until: null, fee: '200', level: null, slots: '缺 6 位', capacity: '15 人', courts: null, shuttle: '勝利比賽級', team: null, contact: 'dm', available: null, confidence: 0.9 };
    const r = normalizeSessions({ is_event: true, events: [
      { ...base, start_at: '2026-11-28T12:00:00+08:00', end_at: '2026-11-28T14:00:00+08:00', spot: true, weekdays: [6] },
      { ...base, start_at: '2026-11-28T12:00:00+08:00', end_at: '2026-11-28T14:00:00+08:00', spot: false, weekdays: null },
    ] });
    expect(r?.events.map((e) => e.spot)).toEqual([false]);
    // 只有固定場（沒有寫哪一天的單場）照舊留著
    const only = normalizeSessions({ is_event: true, events: [{ ...base, start_at: '2026-11-28T12:00:00+08:00', end_at: '2026-11-28T14:00:00+08:00', spot: true, weekdays: [6] }] });
    expect(only?.events.map((e) => e.spot)).toEqual([true]);
  });
});

describe('datedSpotsToSingle (v1.845)', () => {
  const ev = (start: string, kind: 'session' | 'food' | 'activity' = 'session') => ({ kind, title: 't', item: null, start_at: start, end_at: null, place_text: 'p', place_query: 'p', confidence: 0.9, spot: true, until: '2026-12-31', weekdays: [4] }) as unknown as ExtractedEvent;
  it('turns a weekly session into the dated one when the post names that date', () => {
    const a = ev('2026-11-26T14:00:00+08:00');
    datedSpotsToSingle([a], '日期：11/26(四）每週四開團喔！');
    expect([a.spot, a.weekdays, a.until]).toEqual([false, null, null]);
    const b = ev('2026-11-28T12:00:00+08:00');
    datedSpotsToSingle([b], '時間：11／28（六） 12：00～14：00\n2.每週六固定徵零打');
    expect(b.spot).toBe(false);
    const c = ev('2026-12-05T10:00:00+08:00', 'food');
    datedSpotsToSingle([c], '12月5日（六）在市集擺攤，每週六都在');
    expect(c.spot).toBe(false);
  });
  it('keeps weekly sessions without a date, other dates, and other radars', () => {
    const a = ev('2026-11-26T14:00:00+08:00');
    datedSpotsToSingle([a], '每週四下午 2:00-4:30 固定開團');
    expect(a.spot).toBe(true);
    const b = ev('2026-11-26T14:00:00+08:00');
    datedSpotsToSingle([b], '2026/11/12 開始，每週四固定 11/126');
    expect(b.spot).toBe(true);
    const c = ev('2026-11-26T14:00:00+08:00', 'activity');
    datedSpotsToSingle([c], '11/26 起每週四');
    expect(c.spot).toBe(true);
  });
});
