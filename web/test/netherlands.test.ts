import { describe, expect, it } from 'vitest';
import { nlCoast, nlLines, NL_BOX, NL_CITIES, NL_PROVINCES } from '../src/netherlands';
import { NL_LAND, NL_LAND_BOX } from '../src/nl-land';

const inRing = (lat: number, lng: number, r: Array<[number, number]>): boolean => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][0] > lat !== r[j][0] > lat && lng < ((r[j][1] - r[i][1]) * (lat - r[i][0])) / (r[j][0] - r[i][0]) + r[i][1]) inside = !inside;
  }
  return inside;
};
const onLand = (lat: number, lng: number): boolean => NL_LAND.some((r) => inRing(lat, lng, r));

describe('netherlands', () => {
  it('keeps the coast and lake shores inside the Netherlands box', () => {
    expect(nlCoast.length).toBeGreaterThan(10);
    for (const line of nlCoast) for (const [lat, lng] of line) {
      expect(lat).toBeGreaterThanOrEqual(NL_BOX.s);
      expect(lat).toBeLessThanOrEqual(NL_BOX.n);
      expect(lng).toBeGreaterThanOrEqual(NL_BOX.w);
      expect(lng).toBeLessThanOrEqual(NL_BOX.e);
    }
    expect(nlLines.length).toBeGreaterThan(10);
  });
  it('has the 12 provinces and the big cities, all on Dutch land', () => {
    expect(NL_PROVINCES).toHaveLength(12);
    expect(NL_CITIES.map(([n]) => n)).toEqual(expect.arrayContaining(['阿姆斯特丹', '鹿特丹', '海牙', '烏特勒支', '馬斯垂克']));
    for (const [name, lat, lng] of [...NL_PROVINCES, ...NL_CITIES]) expect(onLand(lat, lng), name).toBe(true);
  });
  it('the land mask leaves out Belgium, Germany and the North Sea', () => {
    for (const [name, lat, lng] of [
      ['泰瑟爾島', 53.07, 4.8],
      ['萊利斯塔德', 52.52, 5.47],
      ['弗利辛恩', 51.44, 3.57],
    ] as const) expect(onLand(lat, lng), name).toBe(true);
    for (const [name, lat, lng] of [
      ['安特衛普', 51.22, 4.4],
      ['杜塞道夫', 51.23, 6.78],
      ['北海', 52.6, 3.9],
      ['艾姆登', 53.37, 7.21],
    ] as const) expect(onLand(lat, lng), name).toBe(false);
    expect(NL_LAND_BOX.s).toBeLessThan(50.8);
    expect(NL_LAND_BOX.n).toBeGreaterThan(53.5);
  });
});
