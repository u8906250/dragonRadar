import { describe, expect, it } from 'vitest';
import { REGION_MAP } from '../src/korea';
import { KR_LAND } from '../src/kr-land';

const inRing = (lat: number, lng: number, r: Array<[number, number]>): boolean => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][0] > lat !== r[j][0] > lat && lng < ((r[j][1] - r[i][1]) * (lat - r[i][0])) / (r[j][0] - r[i][0]) + r[i][1]) inside = !inside;
  }
  return inside;
};
const onLand = (lat: number, lng: number): boolean => KR_LAND.some((r) => inRing(lat, lng, r));

describe('korea', () => {
  it('has the 17 provinces and metropolitan cities and the big cities, all on South Korean land', () => {
    expect(REGION_MAP.far).toHaveLength(17);
    expect(REGION_MAP.far.map(([n]) => n)).toEqual(expect.arrayContaining(['首爾', '釜山', '京畿道', '江原道', '濟州道', '世宗']));
    expect(REGION_MAP.near.map(([n]) => n)).toEqual(expect.arrayContaining(['首爾', '釜山', '水原', '安東', '濟州', '江陵']));
    // 簡體字都改成繁體，廣域市、市拿掉
    for (const [name] of [...REGION_MAP.far, ...REGION_MAP.near]) expect(name).not.toMatch(/[东济]|廣域市|市$/);
    for (const [name, lat, lng] of [...REGION_MAP.far, ...REGION_MAP.near]) expect(onLand(lat, lng), name).toBe(true);
  });
  it('draws the province lines and the border with North Korea, and uses the East Asia coast', () => {
    expect(REGION_MAP.coast).toEqual([]);
    expect(REGION_MAP.lines.length).toBeGreaterThan(15);
    // 軍事分界線：北緯 37.7～38.7 之間橫過半島
    expect(REGION_MAP.lines.some((l) => l.some(([lat, lng]) => lat > 38.2 && lng > 128.2) && l.some(([lat, lng]) => lat < 38 && lng < 126.8))).toBe(true);
  });
  it('the land mask leaves out North Korea, Japan, China and the sea', () => {
    for (const [name, lat, lng] of [
      ['首爾', 37.57, 126.98],
      ['濟州', 33.5, 126.53],
      ['鬱陵島', 37.5, 130.87],
    ] as const) expect(onLand(lat, lng), name).toBe(true);
    for (const [name, lat, lng] of [
      ['開城', 37.97, 126.55],
      ['平壤', 39.02, 125.75],
      ['對馬', 34.4, 129.3],
      ['福岡', 33.59, 130.4],
      ['黃海', 36.0, 125.0],
    ] as const) expect(onLand(lat, lng), name).toBe(false);
  });
});
