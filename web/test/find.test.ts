import { describe, expect, it } from 'vitest';
import { fold, localMatches, mergeHits, type LocalData } from '../src/find';

const data: LocalData = {
  counties: [['臺北市', 25.1215, 121.5411], ['新竹市', 24.79, 120.95]],
  towns: [
    ['大安區', 25.0263, 121.5434, '臺北市'],
    ['東區', 24.8, 120.99, '新竹市'],
    ['東區', 22.98, 120.22, '臺南市'],
  ],
  pois: [
    ['臺北大巨蛋', 25.0424, 121.5596, 'stadium', 6],
    ['大安森林公園', 25.0297, 121.5358, 'park', 26],
    ['大安國小', 25.03, 121.54, 'es', 1],
  ],
};
const taipei = { lat: 25.04, lng: 121.55 };

describe('fold', () => {
  it('treats 台 and 臺, full-width and spaces alike', () => {
    expect(fold('台北 １０１')).toBe(fold('臺北101'));
  });
});

describe('localMatches', () => {
  it('finds landmarks by part of the name and writes the county', () => {
    const [h] = localMatches('大巨蛋', data, taipei);
    expect(h).toMatchObject({ name: '臺北大巨蛋', kind: '體育場', area: '臺北市' });
  });
  it('puts exact names first, then names starting with it, nearest first', () => {
    expect(localMatches('大安', data, taipei).map((h) => h.name)).toEqual(['大安區', '大安國小', '大安森林公園']);
    expect(localMatches('大安區', data, taipei)[0]).toMatchObject({ kind: '鄉鎮市區', area: '臺北市', km: 4 });
  });
  it('picks the district of the written city, otherwise the nearest', () => {
    expect(localMatches('新竹市東區', data, taipei)).toEqual([expect.objectContaining({ name: '東區', area: '新竹市' })]);
    expect(localMatches('東區', data, { lat: 23, lng: 120.2 })[0].area).toBe('臺南市');
  });
  it('needs two characters to match inside a name', () => {
    expect(localMatches('巨', data, taipei)).toEqual([]);
    expect(localMatches('台北', data, taipei)[0]).toMatchObject({ name: '臺北市', kind: '縣市' });
  });
});

describe('mergeHits', () => {
  it('keeps the local one when the server finds the same place', () => {
    const local = [{ name: '臺北大巨蛋', area: '臺北市', kind: '體育場', lat: 25.0424, lng: 121.5596, km: 0.3 }];
    const server = [
      { name: '臺北大巨蛋', area: '臺北市信義區', kind: '體育場', lat: 25.0425, lng: 121.5597, km: 0.3 },
      { name: '臺北大巨蛋地下停車場', area: '臺北市信義區', kind: '', lat: 25.0423, lng: 121.5618, km: 0.3 },
    ];
    expect(mergeHits(local, server).map((h) => h.area)).toEqual(['臺北市', '臺北市信義區']);
  });
});
