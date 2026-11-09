import { describe, expect, it } from 'vitest';
import { pageActivities, sessionActivities } from '../src/reports';
import { parseAccupassUrl } from '../src/sources/accupass';
import { eventPageText, parseEventPage, type PageSession } from '../src/sources/eventpage';
import { parseOpentixUrl } from '../src/sources/opentix';

const ld = (o: unknown): string => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const page = (...evs: Array<Record<string, unknown>>): string => `<html><head>${ld({ '@type': 'Organization', name: 'x' })}${evs.map((e) => ld({ '@context': 'https://schema.org', '@type': 'Event', ...e })).join('')}</head></html>`;
// 活動通：時間帶時區、地址是字串
const acc = {
  name: '讀書會－【讀品交義】11月份｜台北場',
  startDate: '2026-11-22T13:45:00+08:00',
  endDate: '2026-11-22T17:00:00+08:00',
  eventStatus: 'https://schema.org/EventScheduled',
  eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
  description: '一群熱愛閱讀的人舉辦的讀書會 #閱讀',
  location: { '@type': 'Place', address: '台灣台北市信義區松隆路327號B1', name: '植境plantārium-複合式空間' },
  organizer: { '@type': 'Organization', name: '職引' },
};
// OPENTIX：一場一個 Event、時間沒寫時區、地址是 PostalAddress
const otx = (date: string, venue: string, locality: string, street: string, status = 'EventScheduled'): Record<string, unknown> => ({
  name: '大型兒童魔術劇《怪盜神偷-阿呆警察的復仇》',
  startDate: `${date}T14:30:00`,
  endDate: `${date}T15:30:00`,
  eventStatus: `https://schema.org/${status}`,
  eventAttendanceMode: 'http://schema.org/OfflineEventAttendanceMode',
  description: '全台歡樂巡演',
  location: { '@type': 'Place', name: venue, address: { '@type': 'PostalAddress', streetAddress: street, addressCountry: 'Taiwan', addressLocality: locality } },
  organizer: { '@type': 'Organization', name: '魔術劇團' },
});
const now = Date.parse('2026-11-09T12:00:00+08:00') / 1000;

describe('活動頁的連結', () => {
  it('finds ACCUPASS event pages and share links', () => {
    expect(parseAccupassUrl('看這個 https://www.accupass.com/event/2610261742421131142843?utm=x')).toEqual({ id: '2610261742421131142843' });
    expect(parseAccupassUrl('https://accupass.com/go/abc-123')).toEqual({ go: 'abc-123' });
    expect(parseAccupassUrl('https://www.accupass.com/organizer/detail/123')).toBeNull();
  });
  it('finds OPENTIX event pages', () => {
    expect(parseOpentixUrl('https://www.opentix.life/event/1990673782438719489?x=1')).toEqual({ id: '1990673782438719489' });
    expect(parseOpentixUrl('https://opentix.life/event/1990673782438719489')).toEqual({ id: '1990673782438719489' });
    expect(parseOpentixUrl('https://www.opentix.life/')).toBeNull();
  });
});

describe('活動頁的資料', () => {
  it('reads one ACCUPASS event (name, times, place, organizer)', () => {
    const p = parseEventPage(page(acc), '1', false)!;
    expect(p.sessions[0]).toMatchObject({ cancelled: false, online: false, venue: '植境plantārium-複合式空間', address: '台北市信義區松隆路327號B1' });
    expect(eventPageText(p)).toBe('讀書會－【讀品交義】11月份｜台北場\n時間：11/22 13:45 – 11/22 17:00\n地點：植境plantārium-複合式空間　台北市信義區松隆路327號B1\n主辦：職引\n一群熱愛閱讀的人舉辦的讀書會 #閱讀');
  });
  it('reads every OPENTIX session, treating times without a zone as Taiwan time', () => {
    const p = parseEventPage(page(otx('2026-11-22', '桃園展演中心展演廳', '桃園市', '桃園區中正路1188號'), otx('2026-11-28', '苗栗縣政府文化觀光局中正堂', '苗栗縣', '苗栗市自治路50號')), '9', true)!;
    expect(p.sessions).toHaveLength(2);
    expect(p.sessions[0].address).toBe('桃園市桃園區中正路1188號');
    expect(eventPageText(p)).toContain('場次：11/22 14:30 – 11/22 15:30　桃園展演中心展演廳　桃園市桃園區中正路1188號');
    const acts = pageActivities(p, now) as Array<{ startAt: number; place: string }>;
    expect(acts.map((a) => a.place)).toEqual(['桃園市桃園區中正路1188號', '苗栗縣苗栗市自治路50號']);
    expect(acts[0].startAt).toBe(Date.parse('2026-11-22T14:30:00+08:00') / 1000);
  });
  it('skips cancelled and online-only sessions, and says why when nothing is left', () => {
    const two = parseEventPage(page(otx('2026-11-22', 'A 廳', '桃園市', '中正路1號', 'EventCancelled'), otx('2026-11-28', 'B 廳', '苗栗縣', '自治路50號')), '9', true)!;
    expect((pageActivities(two, now) as unknown[]).length).toBe(1);
    expect(pageActivities(parseEventPage(page({ ...acc, eventStatus: 'https://schema.org/EventCancelled' }), '1', false)!, now)).toBe('這場活動已經取消了');
    const online = parseEventPage(page({ ...acc, eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode', location: { '@type': 'VirtualLocation', url: 'https://x' } }), '1', false)!;
    expect(pageActivities(online, now)).toMatch(/線上活動/);
    expect(parseEventPage('<html>沒有資料</html>', '1', true)).toBeNull();
  });
});

describe('一場的時間 → 雷達上的一場一場', () => {
  const s = (startDate: string, endDate: string): PageSession => ({ name: '展覽', startDate, endDate, cancelled: false, online: false, venue: null, address: '台北市信義區松隆路327號' });
  it('keeps an event of up to 3 days as one', () => {
    expect(sessionActivities(s('2026-11-22T13:45:00+08:00', '2026-11-22T17:00:00+08:00'), now)).toHaveLength(1);
  });
  it('splits a long exhibition into daily sessions from today, at most 6', () => {
    const acts = sessionActivities(s('2026-11-01T10:00:00+08:00', '2026-11-30T18:00:00+08:00'), now) as Array<{ startAt: number; endAt: number | null }>;
    expect(acts).toHaveLength(6);
    expect(acts[0].startAt).toBe(Date.parse('2026-11-09T10:00:00+08:00') / 1000);
    expect(acts[0].endAt).toBe(Date.parse('2026-11-09T18:00:00+08:00') / 1000);
  });
  it('says why when the time or place is missing', () => {
    expect(sessionActivities({ ...s('', ''), startDate: null }, now)).toBe('活動頁沒有寫開始時間');
    expect(sessionActivities({ ...s('2026-11-22T13:45:00+08:00', ''), address: null }, now)).toBe('活動頁沒有寫地點');
  });
});

describe('場地名稱去掉廳名', () => {
  it('keeps the building name for map lookups', async () => {
    const { venueBuilding } = await import('../src/reports');
    expect(venueBuilding('桃園展演中心展演廳')).toBe('桃園展演中心');
    expect(venueBuilding('臺北表演藝術中心 大劇院')).toBe('臺北表演藝術中心');
    expect(venueBuilding('苗栗縣政府文化觀光局中正堂')).toBe('苗栗縣政府文化觀光局');
    expect(venueBuilding('國家音樂廳')).toBe('國家音樂廳');
    expect(venueBuilding('雲林表演廳')).toBe('雲林表演廳');
  });
});
