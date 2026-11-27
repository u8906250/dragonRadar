import { describe, expect, it } from 'vitest';
import { cleanVenues } from '../src/night';

describe('市民之夜直播派對地點', () => {
  it('留下有名稱、座標的地點，型別不認得的當觀看點', () => {
    const v = cleanVenues({
      venues: [
        { id: 'v-1', type: 'shop', name: '角公園咖啡', area: '大同', address: '台北市大同區太原路131號2樓', note: '', capacity: '35人', lat: 25.053105, lng: 121.516094 },
        { id: 'v-2', type: 'office', name: '某某服務處', area: '中山', address: '臺北市中山區長春路107號', note: '', capacity: '', lat: '25.05', lng: '121.53' },
        { id: 'v-3', type: 'party', name: '沒寫型別', lat: 25.04, lng: 121.5, capacity: 50 },
        { id: 'v-1', type: 'shop', name: '重複的', lat: 25, lng: 121.5 },
        { id: 'v-4', type: 'shop', name: '', lat: 25, lng: 121.5 },
        { id: 'v-5', type: 'shop', name: '座標錯的', lat: 0, lng: 0 },
        null,
      ],
    });
    expect(v.map((x) => [x.id, x.type])).toEqual([
      ['v-1', 'shop'],
      ['v-2', 'office'],
      ['v-3', 'shop'],
    ]);
    expect(v[0]).toMatchObject({ name: '角公園咖啡', area: '大同', capacity: '35人', lat: 25.053105 });
    expect(v[1].lat).toBe(25.05);
    expect(v[2].capacity).toBe('50');
  });
  it('格式不對回傳空的', () => {
    expect(cleanVenues(null)).toEqual([]);
    expect(cleanVenues({ venues: 'x' })).toEqual([]);
    expect(cleanVenues([])).toEqual([]);
  });
});
