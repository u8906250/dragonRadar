import { describe, expect, it } from 'vitest';
import { splitPlace } from '../src/place';

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
  it('has no name for a bare address or a landmark', () => {
    expect(splitPlace('台北市中正區青島東路25-2號').name).toBeNull();
    expect(splitPlace('捷運市政府站 2號出口').name).toBeNull();
  });
});
