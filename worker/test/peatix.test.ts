import { describe, expect, it } from 'vitest';
import { pageActivities } from '../src/reports';
import { parsePeatixPage, parsePeatixUrl } from '../src/sources/peatix';
// 2026-11-16 抓的 Peatix 活動頁，只留 Event 那一段（東京、新加坡、線上各一場）
import online from './fixtures/peatix-online.html?raw';
import singapore from './fixtures/peatix-singapore.html?raw';
import tokyo from './fixtures/peatix-tokyo.html?raw';

const FIXTURES: Record<string, string> = { 'peatix-tokyo.html': tokyo, 'peatix-singapore.html': singapore, 'peatix-online.html': online };
const fixture = (name: string): string => FIXTURES[name];
// 台北的一場：照 Peatix 實際的 microdata 格式（東京那場換成台北的場地）
const taipei = fixture('peatix-tokyo.html')
  .replace('Le Goût de la Scène ', '城市散步：大稻埕老屋導覽')
  .replace('2026-12-12T17:00', '2026-11-22T14:00')
  .replace('Institut français du Japon - Tokyo', '大稻埕碼頭')
  .replace('15 Ichigayafunagawaramachi, Shinjuku City, Tokyo 162-8415, Japan', '台灣台北市大同區民生西路底')
  .replace('35.698347', '25.05663')
  .replace('139.739776', '121.50781');
const now = Date.parse('2026-11-16T12:00:00+08:00') / 1000;

describe('Peatix 的連結', () => {
  it('finds event pages in the usual URL forms', () => {
    expect(parsePeatixUrl('看這個 https://peatix.com/event/5267774?lang=ja')).toEqual({ id: '5267774' });
    expect(parsePeatixUrl('https://peatix.com/us/event/3576515')).toEqual({ id: '3576515' });
    expect(parsePeatixUrl('https://tomorrows-future.peatix.com/event/5080527/view')).toEqual({ id: '5080527' });
    expect(parsePeatixUrl('https://peatix.com/group/12345')).toBeNull();
    // 冒充的網域不算
    expect(parsePeatixUrl('https://peatix.com.example.com/event/1234567')).toBeNull();
  });
});

describe('Peatix 的活動頁', () => {
  it('reads the microdata: name, start time, venue, address, coordinates (offers are not the name)', () => {
    const p = parsePeatixPage(taipei, '1')!;
    expect(p.name).toBe('城市散步：大稻埕老屋導覽');
    const s = p.sessions[0];
    expect([s.startDate, s.endDate, s.venue, s.address, s.lat, s.lng, s.online, s.abroad]).toEqual(['2026-11-22T14:00', null, '大稻埕碼頭', '台北市大同區民生西路底', 25.05663, 121.50781, false, false]);
  });
  it('puts a Taipei event on the radar at its coordinates, Taiwan time, open end', () => {
    const acts = pageActivities(parsePeatixPage(taipei, '1')!, now);
    expect(Array.isArray(acts)).toBe(true);
    const [a] = acts as Exclude<typeof acts, string>;
    expect([a.startAt, a.endAt, a.lat, a.lng, a.place]).toEqual([Date.parse('2026-11-22T14:00:00+08:00') / 1000, null, 25.05663, 121.50781, '台北市大同區民生西路底']);
  });
  it('turns away events outside Taiwan (the time has no zone) and online ones', () => {
    for (const f of ['peatix-tokyo.html', 'peatix-singapore.html']) {
      const p = parsePeatixPage(fixture(f), '2')!;
      expect(p.sessions[0].abroad).toBe(true);
      expect(pageActivities(p, now)).toMatch(/不在台灣/);
    }
    const online = parsePeatixPage(fixture('peatix-online.html'), '3')!;
    expect(online.sessions[0].online).toBe(true);
    expect(pageActivities(online, now)).toMatch(/線上活動/);
  });
  it('decodes entities and drops the "powered by Peatix" tail of the description', () => {
    const p = parsePeatixPage(fixture('peatix-singapore.html'), '4')!;
    expect(p.name).toBe("Now Showing: Tomorrow's Future");
    expect(p.sessions[0].venue).toBe('Objectifs - Centre for Photography & Film');
    expect(parsePeatixPage(fixture('peatix-online.html'), '3')!.description).not.toMatch(/powered by Peatix/);
  });
  it('is null when the page has no event', () => {
    expect(parsePeatixPage('<html><body>not found</body></html>', '5')).toBeNull();
  });
});
