import { describe, expect, it } from 'vitest';
import { matchOfficial, stopNames, taipeiDate, type Candidate, type OfficialStop } from '../src/sources/merge';

const OFFICIAL_TEXT = `台北大洋流 松山信義艦隊 車掃
日期：2026-10-18
時間：17:30 出發，18:30 抵達民權公園
終點：民權公園
路線：五分埔公園 → 中坡北路 → 張文潔服務處（中坡南路277號） → 松山路 → 民權公園`;

const stops: OfficialStop[] = [
  {
    postId: 'voyage-u25fb7',
    date: '2026-10-18',
    names: stopNames(OFFICIAL_TEXT, ['五分埔公園', '張文潔服務處（中坡南路277號）', '洪健益服務處（永吉路234號）', '民權公園']),
    points: [[25.04683, 121.5806], [25.06205, 121.55745]],
  },
];

const at = (iso: string): number => Date.parse(iso) / 1000;
const cand = (over: Partial<Candidate>): Candidate => ({
  id: 1,
  kind: 'activity',
  title: '',
  placeText: '',
  text: '',
  startAt: at('2026-10-18T17:30:00+08:00'),
  lat: null,
  lng: null,
  ...over,
});

describe('official parade names', () => {
  it('districts, abbreviation, stops, people and roads', () => {
    const n = stops[0].names;
    for (const x of ['松山信義', '松山', '信義', '松信', '五分埔公園', '張文潔服務處', '張文潔', '洪健益', '民權公園', '中坡北路']) expect(n).toContain(x);
    expect(n).not.toContain('時間');
  });

  it('taipei date', () => {
    expect(taipeiDate(at('2026-10-18T00:30:00+08:00'))).toBe('2026-10-18');
    expect(taipeiDate(at('2026-10-17T23:59:00+08:00'))).toBe('2026-10-17');
  });
});

describe('merge news into the official parade', () => {
  it('today’s three news reports', () => {
    // NOWnews：AI 把「下午」猜成 14:00，地點是「松山、信義」
    expect(matchOfficial(cand({ title: '台北大洋流車掃', placeText: '松山、信義', startAt: at('2026-10-18T14:00:00+08:00'), text: '台北大洋流航向松信！1.6萬人報名沿途打氣' }), stops)).toBe('voyage-u25fb7');
    expect(matchOfficial(cand({ title: '大洋流車掃', placeText: '松山信義', text: '「大洋流車掃」航向松山信義 沈伯洋將重返五分埔' }), stops)).toBe('voyage-u25fb7');
    expect(matchOfficial(cand({ title: '松信車掃市政開講', placeText: '民權公園', text: '預計下午5時30分從五分埔公園出發，晚間6時30分抵達民權公園舉行市政開講' }), stops)).toBe('voyage-u25fb7');
  });

  it('matches by distance when no name is mentioned', () => {
    expect(matchOfficial(cand({ title: '洋流號掃街', placeText: '某巷口', lat: 25.05, lng: 121.575 }), stops)).toBe('voyage-u25fb7');
  });

  it('giveaways are never merged, even at the same park', () => {
    expect(matchOfficial(cand({ kind: 'giveaway', title: '市政開講現場發飄帶', placeText: '民權公園' }), stops)).toBeNull();
  });

  it('needs parade words', () => {
    expect(matchOfficial(cand({ title: '松山區後援會成立', placeText: '松山區' }), stops)).toBeNull();
  });

  it('needs the same day', () => {
    expect(matchOfficial(cand({ title: '大洋流車掃', placeText: '松山信義', startAt: at('2026-10-25T17:30:00+08:00') }), stops)).toBeNull();
  });

  it('needs a matching place or nearby coordinates', () => {
    expect(matchOfficial(cand({ title: '大洋流車掃', placeText: '台中市西屯區', text: '台中也有車掃', lat: 24.16, lng: 120.64 }), stops)).toBeNull();
  });
});
