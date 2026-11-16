import { describe, expect, it } from 'vitest';
import { REGION_MAP } from '../src/japan';
import { JP_LAND } from '../src/jp-land';

const inRing = (lat: number, lng: number, r: Array<[number, number]>): boolean => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][0] > lat !== r[j][0] > lat && lng < ((r[j][1] - r[i][1]) * (lat - r[i][0])) / (r[j][0] - r[i][0]) + r[i][1]) inside = !inside;
  }
  return inside;
};
const onLand = (lat: number, lng: number): boolean => JP_LAND.some((r) => inRing(lat, lng, r));

describe('japan', () => {
  it('has the 47 prefectures and the big cities, all on Japanese land', () => {
    expect(REGION_MAP.far).toHaveLength(47);
    expect(REGION_MAP.far.map(([n]) => n)).toEqual(expect.arrayContaining(['北海道', '東京都', '大阪府', '京都府', '沖繩縣', '鹿兒島縣']));
    expect(REGION_MAP.near.map(([n]) => n)).toEqual(expect.arrayContaining(['東京', '大阪', '橫濱', '札幌', '仙台', '那霸', '津市']));
    for (const [name, lat, lng] of [...REGION_MAP.far, ...REGION_MAP.near]) expect(onLand(lat, lng), name).toBe(true);
  });
  it('draws the Lake Biwa shore as open lines and the prefecture borders', () => {
    expect(REGION_MAP.coast).toHaveLength(2);
    for (const line of REGION_MAP.coast) {
      expect(line[0]).not.toEqual(line[line.length - 1]);
      for (const [lat, lng] of line) {
        expect(lat).toBeGreaterThan(34.9);
        expect(lat).toBeLessThan(35.6);
        expect(lng).toBeGreaterThan(135.8);
        expect(lng).toBeLessThan(136.3);
      }
    }
    expect(REGION_MAP.lines.length).toBeGreaterThan(40);
  });
  it('the land mask leaves out Korea, Russia, Taiwan and the sea', () => {
    for (const [name, lat, lng] of [
      ['與那國', 24.47, 123.0],
      ['佐渡', 38.02, 138.37],
      ['瀨戶大橋', 34.4, 133.81],
    ] as const) expect(onLand(lat, lng), name).toBe(true);
    for (const [name, lat, lng] of [
      ['釜山', 35.18, 129.08],
      ['濟州', 33.5, 126.53],
      ['海參崴', 43.12, 131.89],
      ['台北', 25.04, 121.52],
      ['日本海', 38.5, 135.0],
    ] as const) expect(onLand(lat, lng), name).toBe(false);
  });
});
