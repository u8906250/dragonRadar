import { describe, expect, it } from 'vitest';
import { normalizeSessions } from '../src/badminton';
import { detectEnded } from '../src/events';

describe('normalizeSessions', () => {
  it('reads a weekly drop-in offer with its fee, level and slots', () => {
    const r = normalizeSessions({
      is_event: true,
      events: [
        { role: 'offer', title: '信義運動中心羽球臨打', start_at: '2026-10-29T19:00:00+08:00', end_at: '2026-10-29T22:00:00+08:00', place_text: '信義運動中心 4F', place_query: '台北市 信義運動中心', spot: true, weekdays: [3], until: null, fee: '$200/人', level: '中階', slots: '缺 2 位', shuttle: 'RSL 4 號', team: '週三羽球團', contact: 'DM', available: null, confidence: 0.9 },
      ],
    });
    expect(r?.events[0]).toMatchObject({ kind: 'session', item: '$200/人', spot: true, weekdays: [3] });
    expect(r?.events[0].extra).toEqual({ role: 'offer', available: null, fee: '$200/人', level: '中階', slots: '缺 2 位', shuttle: 'RSL 4 號', team: '週三羽球團', contact: 'dm' });
  });
  it('keeps a player looking for a game as a posting, never a weekly spot', () => {
    const r = normalizeSessions({ is_event: true, events: [{ role: 'seek', title: '中階找臨打（台北東區）', start_at: null, end_at: null, place_text: '台北東區', place_query: '台北市 大安區', spot: true, weekdays: [6], until: null, fee: null, level: '中階', slots: null, shuttle: null, team: null, contact: 'dm', available: '週末下午', confidence: 0.8 }] });
    expect(r?.events[0]).toMatchObject({ spot: false, extra: { role: 'seek', available: '週末下午', level: '中階' } });
  });
  it('drops everything when it is not about drop-in games', () => {
    expect(normalizeSessions('{"is_event":false,"events":[{"title":"賣球拍"}]}')).toEqual({ is_event: false, events: [] });
  });
});

describe('detectEnded for drop-in games', () => {
  it('sees a full or cancelled session', () => {
    expect(detectEnded('今晚臨打名額已滿，謝謝大家')).toBe(true);
    expect(detectEnded('下雨場地取消')).toBe(true);
    expect(detectEnded('缺 2 位，額滿為止')).toBe(false);
  });
});
