import { describe, expect, it } from 'vitest';
import { areaOf, cleanQuery, MAX_HITS, nearCell, nominatimHits, photonHits, QUERY_MAX, type PhotonFeature } from '../src/geo-search';

const f = (lat: number, lng: number, props: NonNullable<PhotonFeature['properties']>): PhotonFeature => ({ geometry: { coordinates: [lng, lat] }, properties: props });

describe('photonHits', () => {
  it('merges the segments of one road and centres on the middle one', () => {
    const hits = photonHits([
      f(25.0307, 121.5295, { type: 'street', osm_key: 'highway', osm_value: 'residential', name: '永康街', city: '臺北市', district: '大安區', extent: [121.5294, 25.0312, 121.5296, 25.0302] }),
      f(25.0283, 121.5296, { type: 'street', osm_key: 'highway', osm_value: 'service', name: '永康街', city: '臺北市', district: '大安區', extent: [121.5295, 25.0288, 121.5297, 25.0278] }),
      f(25.0325, 121.5297, { type: 'street', osm_key: 'highway', osm_value: 'residential', name: '永康街', city: '臺北市', district: '大安區', extent: [121.5296, 25.033, 121.5298, 25.032] }),
      f(25.0853, 121.4579, { type: 'street', osm_key: 'highway', osm_value: 'residential', name: '永康街', city: '新北市', district: '蘆洲區' }),
    ]);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ name: '永康街', area: '臺北市大安區', kind: '路', lat: 25.0307 });
    expect(hits[0].km).toBeGreaterThanOrEqual(0.5);
    expect(hits[1]).toMatchObject({ name: '永康街', area: '新北市蘆洲區' });
  });
  it('keeps two roads of the same name in one city apart when they are far away', () => {
    const hits = photonHits([
      f(24.99, 121.3, { type: 'street', osm_key: 'highway', osm_value: 'residential', name: '永康街', city: '桃園市' }),
      f(24.95, 121.22, { type: 'street', osm_key: 'highway', osm_value: 'residential', name: '永康街', city: '桃園市' }),
    ]);
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.km === 0.5)).toBe(true);
  });
  it('drops bus stops and platforms, keeps one of the same name close together', () => {
    const hits = photonHits([
      f(25.0462, 121.5175, { type: 'house', osm_key: 'railway', osm_value: 'station', name: '台北車站', city: '臺北市', district: '中正區' }),
      f(25.0485, 121.5143, { type: 'house', osm_key: 'railway', osm_value: 'stop', name: '台北車站', city: '臺北市' }),
      f(25.0487, 121.5143, { type: 'house', osm_key: 'building', osm_value: 'transportation', name: '台北車站', city: '臺北市' }),
      f(25.0257, 121.5362, { type: 'house', osm_key: 'highway', osm_value: 'bus_stop', name: '大安森林公園' }),
    ]);
    expect(hits).toEqual([{ name: '台北車站', area: '臺北市中正區', kind: '車站', lat: 25.0462, lng: 121.5175, km: 0.3 }]);
  });
  it('names a bare house number by its street, and skips 里 as the district', () => {
    const [h] = photonHits([f(25.0335, 121.5589, { type: 'house', osm_key: 'place', osm_value: 'house', street: '信義路四段395巷6弄', housenumber: '10號', city: '臺北市', district: '信義區' })]);
    expect(h).toMatchObject({ name: '信義路四段395巷6弄10號', kind: '門牌', area: '臺北市信義區' });
    const [m] = photonHits([f(24.8051, 120.9689, { type: 'house', osm_key: 'amenity', osm_value: 'marketplace', name: '東門市場', city: '新竹市', district: '東門里' })]);
    expect(m).toMatchObject({ kind: '市場', area: '新竹市' });
  });
  it('zooms out for big places', () => {
    const [park] = photonHits([f(25.0297, 121.5358, { type: 'other', osm_key: 'leisure', osm_value: 'park', name: '大安森林公園', city: '臺北市', extent: [121.533, 25.0334, 121.5374, 25.026] })]);
    expect(park.km).toBeGreaterThan(0.4);
    expect(park.km).toBeLessThan(1);
    const [town] = photonHits([f(24.8397, 121.0041, { type: 'city', osm_key: 'place', osm_value: 'town', name: '竹北市', county: '新竹縣' })]);
    expect(town).toMatchObject({ kind: '地名', area: '新竹縣', km: 3 });
  });
});

describe('nominatimHits', () => {
  it('reads name, area and kind', () => {
    const hits = nominatimHits([
      { lat: '25.0424', lon: '121.5596', name: '臺北大巨蛋', category: 'leisure', type: 'stadium', boundingbox: ['25.0416', '25.0432', '121.5585', '121.5607'], address: { city: '臺北市', suburb: '信義區' } },
      { lat: '25.05', lon: '121.55', name: '', display_name: '某公車站, 臺北市', category: 'highway', type: 'bus_stop' },
    ]);
    expect(hits).toEqual([{ name: '臺北大巨蛋', area: '臺北市信義區', kind: '體育場', lat: 25.0424, lng: 121.5596, km: 0.3 }]);
  });
});

describe('query helpers', () => {
  it('areaOf keeps county, city and district once', () => {
    expect(areaOf(['新竹縣', '竹北市', '鹿場'])).toBe('新竹縣竹北市');
    expect(areaOf([undefined, '臺北市', '臺北市'])).toBe('臺北市');
  });
  it('cleanQuery trims and caps the length', () => {
    expect(cleanQuery('  台北　車站 ')).toBe('台北 車站');
    expect(cleanQuery('路'.repeat(100))).toHaveLength(QUERY_MAX);
  });
  it('nearCell rounds to half a degree', () => {
    expect(nearCell(25.0331, 121.5654)).toEqual({ lat: 25, lng: 121.5 });
    expect(nearCell(24.81, 120.97)).toEqual({ lat: 25, lng: 121 });
    expect(nearCell(undefined, 121)).toBeNull();
    expect(nearCell(Number.NaN, 121)).toBeNull();
  });
  it('MAX_HITS is small', () => expect(MAX_HITS).toBeLessThanOrEqual(8));
});
