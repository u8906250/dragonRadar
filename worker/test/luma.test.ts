import { describe, expect, it } from 'vitest';
import { pageActivities } from '../src/reports';
import { parseEventPage } from '../src/sources/eventpage';
import { parseLumaUrl } from '../src/sources/luma';
// 2026-11-16 抓的 Luma 活動頁（台北的一場），只留 canonical 和 JSON-LD（拿掉圖片、票種）
import taipei from './fixtures/luma-taipei.html?raw';

const now = Date.parse('2026-11-16T12:00:00+08:00') / 1000;

describe('Luma 的連結', () => {
  it('finds event pages on luma.com and lu.ma, including custom URLs', () => {
    expect(parseLumaUrl('來看 https://luma.com/q3ptes8j?tk=abc')).toEqual({ go: 'q3ptes8j' });
    expect(parseLumaUrl('https://lu.ma/ocmyblw9')).toEqual({ go: 'ocmyblw9' });
    expect(parseLumaUrl('https://luma.com/day1taipei')).toEqual({ go: 'day1taipei' });
    expect(parseLumaUrl('（https://lu.ma/abc12345）')).toEqual({ go: 'abc12345' });
  });
  it('skips Luma pages that are not events', () => {
    expect(parseLumaUrl('https://luma.com/discover')).toBeNull();
    expect(parseLumaUrl('https://luma.com/user/usr-QMswGmeeOaqUxWm')).toBeNull();
    expect(parseLumaUrl('https://luma.com.example.com/abc12345')).toBeNull();
  });
});

describe('Luma 的活動頁', () => {
  it('reads the JSON-LD: times with zone, venue, English address, coordinates, first organizer', () => {
    const p = parseEventPage(taipei, 'q3ptes8j', false)!;
    expect(p.name).toBe('RNB AFTER DARK ; TAIPEI EDITION VOLUME 5');
    expect(p.organizer).toBe('BLCKTEETH');
    const s = p.sessions[0];
    expect([s.startDate, s.endDate, s.venue, s.address, s.lat, s.lng, s.online, s.cancelled]).toEqual([
      '2026-11-28T21:00:00.000+08:00',
      '2026-11-29T02:00:00.000+08:00',
      'Bar Root by -1',
      'Bar Root by -1, Dunhuang Village, Taipei City',
      25.0372682,
      121.55177180000001,
      false,
      false,
    ]);
  });
  it('puts it on the radar at its coordinates, until it ends after midnight', () => {
    const acts = pageActivities(parseEventPage(taipei, 'q3ptes8j', false)!, now);
    const [a] = acts as Exclude<typeof acts, string>;
    expect([a.startAt, a.endAt, a.lat, a.lng]).toEqual([Date.parse('2026-11-28T21:00:00+08:00') / 1000, Date.parse('2026-11-29T02:00:00+08:00') / 1000, 25.0372682, 121.55177180000001]);
  });
  it('turns away online and cancelled events', () => {
    const online = taipei.replace('OfflineEventAttendanceMode', 'OnlineEventAttendanceMode');
    expect(pageActivities(parseEventPage(online, 'x', false)!, now)).toMatch(/線上活動/);
    const cancelled = taipei.replace('EventScheduled', 'EventCancelled');
    expect(pageActivities(parseEventPage(cancelled, 'x', false)!, now)).toMatch(/取消/);
  });
  it('is not an event page when the page only lists events (a city page)', () => {
    expect(parseEventPage('<script type="application/ld+json">{"@type":"ItemList","itemListElement":[]}</script>', 'taipei', false)).toBeNull();
  });
});
