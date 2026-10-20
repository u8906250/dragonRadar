import { addressOf } from '../src/events';
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
  it('prefers the exact 之 number when the address has one', () => {
    expect(locateOnStreet(rows, 399, '399-1')).toEqual({ lat: 25.0, lng: 121.0035, how: 'exact' });
    expect(locateOnStreet([{ number: '25號', lat: 1, lng: 1 }, { number: '25之2號', lat: 2, lng: 2 }], 25, '25-2')).toMatchObject({ lat: 2 });
    expect(locateOnStreet([{ number: '25號', lat: 1, lng: 1 }, { number: '25之2號', lat: 2, lng: 2 }], 25, '25')).toMatchObject({ lat: 1 });
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

describe('dailyWindows', () => {
  it('finds every daily window', async () => {
    const { dailyWindows } = await import('../src/spots');
    expect(dailyWindows('領取時間：11:00-14:00 17:00-19:00')).toEqual([
      { open: '11:00', close: '14:00' },
      { open: '17:00', close: '19:00' },
    ]);
    expect(dailyWindows('營業時間 13:00–20:00')).toEqual([{ open: '13:00', close: '20:00' }]);
    expect(dailyWindows('9:30～12：00')).toEqual([{ open: '09:30', close: '12:00' }]);
  });
});

describe('singleDay', () => {
  it('flags a post that names only one day', async () => {
    const { singleDay } = await import('../src/spots');
    expect(singleDay('10/20 洋流小物 / 好豐盛的洋流小物自助餐 / 洋流小物發放時間 12:00-13:30；18:00-20:30 / #洋流 #台北順起來 #soon')).toBe('10/20');
  });
  it('lets through posts that say from / every day / opening hours, or no date at all', async () => {
    const { singleDay } = await import('../src/spots');
    expect(singleDay('10/16起，只要你帶著毛小孩來…都可以來鳥咖啡索取')).toBeNull();
    expect(singleDay('10/19（ㄧ）感謝暖心支援 ☀️ 每日上午 11:00 起 洋流小物｜限量供應自取')).toBeNull();
    expect(singleDay('洋流飄帶又來了喔！歡迎來店索取 領取時間：11:00-14:00 17:00-19:00')).toBeNull();
    expect(singleDay('10/17~10/19 每日 11:00~18:00')).toBeNull();
  });
});

describe('addressOf (events)', () => {
  it('takes the house number and borrows the city from the other field', () => {
    expect(addressOf('台南市 善化服務處', '善化服務處\n地址：善化區中正路188巷12-1號')).toMatchObject({
      text: '臺南市善化區中正路188巷12-1號',
      area: '臺南市善化區',
    });
    expect(addressOf('台南市 玉井區中山路96號', '賴懋慶聯合服務處\n地址：玉井區中山路96號')).toMatchObject({
      text: '臺南市玉井區中山路96號',
      area: '臺南市玉井區',
    });
  });
  it('does not guess the city', () => {
    expect(addressOf('善化服務處', '地址：善化區中正路188巷12-1號')).toMatchObject({ text: '', area: null });
  });
  it('returns null without a house number', () => {
    expect(addressOf('台北市 捷運忠孝復興站', '忠孝復興站 2 號出口')).toBeNull();
  });
});
