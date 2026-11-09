import { describe, expect, it } from 'vitest';
import { accupassActivities } from '../src/reports';
import { accupassText, parseAccupassHtml, parseAccupassUrl } from '../src/sources/accupass';

const page = (ev: Record<string, unknown>): string =>
  `<html><head><script type="application/ld+json">{"@type":"Organization","name":"x"}</script><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Event', ...ev })}</script></head></html>`;
const sample = {
  name: '讀書會－【讀品交義】11月份｜台北場',
  startDate: '2026-11-22T13:45:00+08:00',
  endDate: '2026-11-22T17:00:00+08:00',
  eventStatus: 'https://schema.org/EventScheduled',
  eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
  description: '一群熱愛閱讀的人舉辦的讀書會 #閱讀',
  location: { '@type': 'Place', address: '台灣台北市信義區松隆路327號B1', name: '植境plantārium-複合式空間' },
  organizer: { '@type': 'Organization', name: '職引' },
};

describe('活動通的連結', () => {
  it('finds event pages and share links in pasted text', () => {
    expect(parseAccupassUrl('看這個 https://www.accupass.com/event/2610261742421131142843?utm=x')).toEqual({ id: '2610261742421131142843' });
    expect(parseAccupassUrl('https://accupass.com/event/2610261742421131142843')).toEqual({ id: '2610261742421131142843' });
    expect(parseAccupassUrl('https://accupass.com/go/abc-123')).toEqual({ go: 'abc-123' });
    expect(parseAccupassUrl('https://www.threads.com/@a/post/abc')).toBeNull();
    expect(parseAccupassUrl('https://www.accupass.com/organizer/detail/123')).toBeNull();
  });
});

describe('活動頁的資料', () => {
  it('reads name, times, place and organizer from the schema.org Event', () => {
    const ev = parseAccupassHtml(page(sample), '1')!;
    expect(ev).toMatchObject({ name: sample.name, startDate: sample.startDate, cancelled: false, online: false, venue: '植境plantārium-複合式空間', address: '台北市信義區松隆路327號B1', organizer: '職引' });
    expect(accupassText(ev)).toBe('讀書會－【讀品交義】11月份｜台北場\n時間：11/22 13:45 – 11/22 17:00\n地點：植境plantārium-複合式空間　台北市信義區松隆路327號B1\n主辦：職引\n一群熱愛閱讀的人舉辦的讀書會 #閱讀');
  });
  it('knows cancelled and online-only events, and postal addresses', () => {
    expect(parseAccupassHtml(page({ ...sample, eventStatus: 'https://schema.org/EventCancelled' }), '1')!.cancelled).toBe(true);
    const online = parseAccupassHtml(page({ ...sample, eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode', location: { '@type': 'VirtualLocation', url: 'https://x' } }), '1')!;
    expect(online.online).toBe(true);
    const postal = parseAccupassHtml(page({ ...sample, location: { '@type': 'Place', name: '場地', address: { '@type': 'PostalAddress', addressRegion: '台北市', addressLocality: '大同區', streetAddress: '迪化街一段32巷' } } }), '1')!;
    expect(postal.address).toBe('台北市大同區迪化街一段32巷');
    expect(parseAccupassHtml('<html>沒有資料</html>', '1')).toBeNull();
  });
});

describe('活動頁的時間 → 一場一場', () => {
  const now = Date.parse('2026-11-09T12:00:00+08:00') / 1000;
  it('keeps an event of up to 3 days as one', () => {
    const acts = accupassActivities(parseAccupassHtml(page(sample), '1')!, now);
    expect(acts).toEqual([{ title: sample.name, startAt: Date.parse(sample.startDate) / 1000, endAt: Date.parse(sample.endDate) / 1000, place: '台北市信義區松隆路327號B1', lat: null, lng: null }]);
  });
  it('splits a long exhibition into daily sessions from today, at most 6', () => {
    const ev = parseAccupassHtml(page({ ...sample, startDate: '2026-11-01T10:00:00+08:00', endDate: '2026-11-30T18:00:00+08:00' }), '1')!;
    const acts = accupassActivities(ev, now) as Array<{ startAt: number; endAt: number | null }>;
    expect(acts).toHaveLength(6);
    expect(acts[0].startAt).toBe(Date.parse('2026-11-09T10:00:00+08:00') / 1000);
    expect(acts[0].endAt).toBe(Date.parse('2026-11-09T18:00:00+08:00') / 1000);
    expect(acts[5].startAt).toBe(Date.parse('2026-11-14T10:00:00+08:00') / 1000);
  });
  it('says why when the time or place is missing', () => {
    expect(accupassActivities(parseAccupassHtml(page({ ...sample, startDate: undefined }), '1')!, now)).toBe('活動頁沒有寫開始時間');
    expect(accupassActivities(parseAccupassHtml(page({ ...sample, location: { '@type': 'Place' } }), '1')!, now)).toBe('活動頁沒有寫地點');
  });
});
