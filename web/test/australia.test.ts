import { describe, expect, it } from 'vitest';
import { AU_LAND } from '../src/au-land';
import { REGION_MAP as CENTRAL } from '../src/australia-central';
import { REGION_MAP as NORTH } from '../src/australia-north';
import { REGION_MAP as SOUTHEAST } from '../src/australia-southeast';
import { REGION_MAP as TAS } from '../src/australia-tas';
import { REGION_MAP as WEST } from '../src/australia-west';

const inRing = (lat: number, lng: number, r: Array<[number, number]>): boolean => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][0] > lat !== r[j][0] > lat && lng < ((r[j][1] - r[i][1]) * (lat - r[i][0])) / (r[j][0] - r[i][0]) + r[i][1]) inside = !inside;
  }
  return inside;
};
const onLand = (lat: number, lng: number): boolean => AU_LAND.some((r) => inRing(lat, lng, r));
const BLOCKS = [
  { name: '西澳', map: WEST, box: { s: -35.5, w: 112.5, n: -13.4, e: 129.0 } },
  { name: '中部', map: CENTRAL, box: { s: -38.2, w: 129.0, n: -10.8, e: 141.0 } },
  { name: '昆士蘭', map: NORTH, box: { s: -29.0, w: 141.0, n: -9.0, e: 154.0 } },
  { name: '東南', map: SOUTHEAST, box: { s: -39.2, w: 141.0, n: -29.0, e: 154.0 } },
  { name: '塔斯馬尼亞', map: TAS, box: { s: -43.8, w: 143.5, n: -39.2, e: 149.0 } },
];

describe('australia', () => {
  it('has the 6 states and 2 territories once each and the big cities, all on Australian land', () => {
    const states = BLOCKS.flatMap((b) => b.map.far.map(([n]) => n));
    expect(new Set(states)).toEqual(new Set(['西澳州', '北領地', '南澳州', '昆士蘭州', '新南威爾斯州', '維多利亞州', '澳洲首都領地', '塔斯馬尼亞州']));
    expect(states).toHaveLength(8);
    const cities = BLOCKS.flatMap((b) => b.map.near.map(([n]) => n));
    expect(cities).toEqual(expect.arrayContaining(['雪梨', '墨爾本', '布里斯本', '伯斯', '阿得雷德', '坎培拉', '荷巴特', '達爾文', '黃金海岸', '凱恩斯', '吉朗', '愛麗絲泉']));
    // Natural Earth 把 Geelong 寫成「基隆」、Brisbane 寫成「布里斯班」：改成台灣常用的；簡體字都改成繁體
    expect(cities).not.toContain('基隆');
    expect(cities).not.toContain('布里斯班');
    for (const [name] of BLOCKS.flatMap((b) => [...b.map.far, ...b.map.near])) expect(name).not.toMatch(/[亚湾尔兹奥杰逊兰库纳]|區政府|省$/);
    for (const [name, lat, lng] of BLOCKS.flatMap((b) => [...b.map.far, ...b.map.near])) expect(onLand(lat, lng), name).toBe(true);
  });
  it('keeps each block inside its box, with state lines', () => {
    for (const { name, map, box } of BLOCKS) {
      expect(map.coast.length, name).toBeGreaterThan(0);
      expect(map.nearKm, name).toBe(200);
      for (const line of [...map.coast, ...map.lines]) for (const [lat, lng] of line) expect(lat >= box.s - 1e-3 && lat <= box.n + 1e-3 && lng >= box.w - 1e-3 && lng <= box.e + 1e-3, name).toBe(true);
    }
    // 州界：南澳和北領地、新南威爾斯和維多利亞（墨累河）都有；西澳只有一個州、塔斯馬尼亞是島，沒有州界
    expect(CENTRAL.lines.length).toBeGreaterThan(3);
    expect(SOUTHEAST.lines.length).toBeGreaterThan(2);
    expect(WEST.lines).toEqual([]);
    expect(TAS.lines).toEqual([]);
  });
  it('the land mask leaves out Papua New Guinea, Timor, New Zealand and the sea', () => {
    for (const [name, lat, lng] of [
      ['雪梨', -33.87, 151.21],
      ['伯斯', -31.95, 115.86],
      ['荷巴特', -42.88, 147.33],
      ['達爾文', -12.46, 130.84],
      ['愛麗絲泉', -23.7, 133.88],
    ] as const) expect(onLand(lat, lng), name).toBe(true);
    for (const [name, lat, lng] of [
      ['莫士比港', -9.44, 147.18],
      ['帝力', -8.56, 125.57],
      ['威靈頓', -41.29, 174.78],
      ['巴斯海峽', -39.8, 146.0],
      ['卡本塔利亞灣', -14.0, 139.0],
    ] as const) expect(onLand(lat, lng), name).toBe(false);
  });
});
