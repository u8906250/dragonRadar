import { describe, expect, it } from 'vitest';
import { locateOnStreet, parseTwAddress } from '../src/address';

describe('parseTwAddress', () => {
  it('pulls the address out of a shop name with postcode and village', () => {
    expect(parseTwAddress('Thebirdscafe鳥咖啡 110臺北市信義區中興里信義路四段399號')).toMatchObject({ city: '臺北市', district: '信義區', street: '信義路四段', number: 399 });
  });
  it('handles 台, Arabic section numbers, lanes, alleys and 之', () => {
    expect(parseTwAddress('台北市大安區信義路4段30巷27弄10之1號1樓')).toMatchObject({ city: '臺北市', district: '大安區', street: '信義路四段30巷27弄', number: 10, raw: '10之1' });
  });
  it('works without a city', () => {
    expect(parseTwAddress('北平東路30-1號')).toMatchObject({ city: null, district: null, street: '北平東路', number: 30, raw: '30-1' });
    expect(parseTwAddress('中正區北平東路30號')).toMatchObject({ city: null, district: '中正區', street: '北平東路', number: 30 });
  });
  it('does not take a shop name ending in 鄉 or 飯 as the district', () => {
    expect(parseTwAddress('蘭鄉排骨飯 台北市中正區青島東路25-2號')).toMatchObject({ city: '臺北市', district: '中正區', street: '青島東路', number: 25, raw: '25-2' });
  });
  it('keeps roads that contain 市', () => {
    expect(parseTwAddress('臺北市信義區市府路1號')).toMatchObject({ street: '市府路', number: 1 });
    expect(parseTwAddress('台北市中正區市民大道一段100號')).toMatchObject({ street: '市民大道一段', number: 100 });
  });
  it('is null for landmarks', () => {
    expect(parseTwAddress('捷運市政府站 2號出口')).toBeNull();
  });
});

describe('locateOnStreet', () => {
  const rows = [
    { number: '395號', lat: 25.0, lng: 121.0 },
    { number: '401', lat: 25.0, lng: 121.006 },
    { number: '398號', lat: 25.1, lng: 121.1 },
    { number: '399之1號', lat: 25.0, lng: 121.0035 },
  ];
  it('uses the main number before 之幾 when the exact one is missing', () => {
    expect(locateOnStreet(rows, 399)).toEqual({ lat: 25.0, lng: 121.0035, how: 'exact' });
  });
  it('interpolates between same-side neighbours', () => {
    const p = locateOnStreet(rows, 397)!;
    expect(p.how).toBe('interpolated');
    expect(p.lng).toBeCloseTo(121.002, 5);
  });
  it('gives up when the nearest numbers are far apart', () => {
    expect(locateOnStreet([{ number: '1', lat: 0, lng: 0 }, { number: '201', lat: 0, lng: 1 }], 101)).toBeNull();
  });
});
