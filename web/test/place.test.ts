import { describe, expect, it } from 'vitest';
import { shortAddress, splitPlace } from '../src/place';

describe('splitPlace', () => {
  it('takes the shop name before the address', () => {
    expect(splitPlace('Thebirdscafe鳥咖啡 110臺北市信義區中興里信義路四段399號')).toEqual({ name: 'Thebirdscafe鳥咖啡', address: '110臺北市信義區中興里信義路四段399號' });
    expect(splitPlace('蘭鄉排骨飯 台北市中正區青島東路25-2號')).toEqual({ name: '蘭鄉排骨飯', address: '台北市中正區青島東路25-2號' });
  });
  it('handles an address in brackets and an address without a city', () => {
    expect(splitPlace('張文潔服務處（中坡南路277號）')).toEqual({ name: '張文潔服務處', address: '中坡南路277號' });
    expect(splitPlace('小日子咖啡 永康街12號1樓')).toEqual({ name: '小日子咖啡', address: '永康街12號1樓' });
  });
  it('takes the shop name after the address', () => {
    expect(splitPlace('台北市中正區青島東路25-2號 蘭鄉排骨飯')).toEqual({ name: '蘭鄉排骨飯', address: '台北市中正區青島東路25-2號' });
  });
  it('takes the name before a location hint in brackets and keeps the hint as the place', () => {
    expect(splitPlace('日常生活 a day cafe(近忠孝復興站）')).toEqual({ name: '日常生活 a day cafe', address: '日常生活 a day cafe(近忠孝復興站）' });
  });
  it('does not take a location hint after the address as the name', () => {
    const text = '新北市板橋區文化路二段263巷18號 (近捷運江子翠捷運站二號出口，走路三分鐘。農村公園正對面)';
    expect(splitPlace(text)).toEqual({ name: null, address: text });
    expect(splitPlace('台北市中正區青島東路25-2號 近善導寺站').name).toBeNull();
    expect(splitPlace('台北市松山區復興北路167號14樓之4（三信大樓）').name).toBeNull();
    expect(splitPlace('新北市板橋區文化路二段263巷18號（棲木咖啡）')).toEqual({ name: '棲木咖啡', address: '新北市板橋區文化路二段263巷18號' });
  });
  it('has no name for a bare address or a landmark', () => {
    expect(splitPlace('台北市中正區青島東路25-2號').name).toBeNull();
    expect(splitPlace('捷運市政府站 2號出口').name).toBeNull();
  });
});

describe('splitPlace floors', () => {
  it('keeps the floor with the address instead of taking it as the name', () => {
    expect(splitPlace('臺北市大同區永樂里迪化街一段32巷1號2F')).toEqual({ name: null, address: '臺北市大同區永樂里迪化街一段32巷1號2F' });
    expect(splitPlace('台北市大安區光復南路290巷48號 B1')).toEqual({ name: null, address: '台北市大安區光復南路290巷48號 B1' });
    expect(splitPlace('台北市松山區復興北路167號14樓之4 TIA辦公室')).toEqual({ name: 'TIA辦公室', address: '台北市松山區復興北路167號14樓之4' });
    expect(splitPlace('台北市大同區迪化街一段32巷1號2F 爐鍋咖啡')).toEqual({ name: '爐鍋咖啡', address: '台北市大同區迪化街一段32巷1號2F' });
  });
});

describe('shortAddress', () => {
  it('drops the postal code and the village', () => {
    expect(shortAddress('239新北市鶯歌區東鶯里文化路175號')).toBe('新北市鶯歌區文化路175號');
    expect(shortAddress('242新北市新莊區光華里民安西路319號')).toBe('新北市新莊區民安西路319號');
    expect(shortAddress('Thebirdscafe鳥咖啡 110臺北市信義區中興里信義路四段399號')).toBe('Thebirdscafe鳥咖啡 臺北市信義區信義路四段399號');
    expect(shortAddress('台中市大里區大明里5鄰大明路1號')).toBe('台中市大里區大明路1號');
  });
  it('keeps districts and roads named with 里 and plain place names', () => {
    expect(shortAddress('新北市萬里區萬里路1號')).toBe('新北市萬里區萬里路1號');
    expect(shortAddress('新北市萬里區萬里國小')).toBe('新北市萬里區萬里國小');
    expect(shortAddress('鶯歌永福宮')).toBe('鶯歌永福宮');
    expect(shortAddress('台北市大安區大安森林公園')).toBe('台北市大安區大安森林公園');
  });
});
