import { describe, expect, it } from 'vitest';
import { US_LAND } from '../src/us-land';
import { REGION_MAP as ALASKA } from '../src/usa-alaska';
import { REGION_MAP as EAST } from '../src/usa-east';
import { REGION_MAP as HAWAII } from '../src/usa-hawaii';
import { REGION_MAP as WEST } from '../src/usa-west';

const inRing = (lat: number, lng: number, r: Array<[number, number]>): boolean => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][0] > lat !== r[j][0] > lat && lng < ((r[j][1] - r[i][1]) * (lat - r[i][0])) / (r[j][0] - r[i][0]) + r[i][1]) inside = !inside;
  }
  return inside;
};
const onLand = (lat: number, lng: number): boolean => US_LAND.some((r) => inRing(lat, lng, r));
const BLOCKS = [
  { name: '本土西半', map: WEST, box: { s: 24.3, w: -125.0, n: 49.5, e: -100.0 } },
  { name: '本土東半', map: EAST, box: { s: 24.3, w: -100.0, n: 49.5, e: -66.8 } },
  { name: '阿拉斯加', map: ALASKA, box: { s: 51.0, w: -180.0, n: 71.6, e: -129.9 } },
  { name: '夏威夷', map: HAWAII, box: { s: 18.8, w: -160.6, n: 22.4, e: -154.7 } },
];

describe('usa', () => {
  it('has the 50 states once each and the big cities, all on US land', () => {
    const states = BLOCKS.flatMap((b) => b.map.far.map(([n]) => n));
    expect(states).toHaveLength(50);
    expect(new Set(states).size).toBe(50);
    expect(states).toEqual(expect.arrayContaining(['加州', '德州', '紐約州', '佛羅里達州', '阿拉斯加州', '夏威夷州', '華盛頓州', '麻州', '賓州']));
    const cities = BLOCKS.flatMap((b) => b.map.near.map(([n]) => n));
    expect(cities).toEqual(expect.arrayContaining(['紐約', '洛杉磯', '舊金山', '西雅圖', '芝加哥', '華盛頓', '檀香山', '安克拉治', '休士頓', '波士頓']));
    // 華盛頓州的溫哥華不寫（會被當成加拿大的）；簡體字都改成繁體
    expect(cities).not.toContain('溫哥華');
    for (const [name] of BLOCKS.flatMap((b) => [...b.map.far, ...b.map.near])) expect(name).not.toMatch(/[亚湾尔兹奥杰逊兰]/);
    // 陸地範圍畫得粗（約 5 km），阿拉斯加沙嘴上的小鎮（波因特霍普）不一定在裡面：阿拉斯加只看州名
    for (const [name, lat, lng] of [WEST, EAST, HAWAII].flatMap((m) => [...m.far, ...m.near]).concat(ALASKA.far)) expect(onLand(lat, lng), name).toBe(true);
  });
  it('keeps each block inside its box, with open lake shores and state lines', () => {
    for (const { name, map, box } of BLOCKS) {
      expect(map.coast.length, name).toBeGreaterThan(0);
      for (const line of [...map.coast, ...map.lines]) for (const [lat, lng] of line) expect(lat >= box.s - 1e-3 && lat <= box.n + 1e-3 && lng >= box.w - 1e-3 && lng <= box.e + 1e-3, name).toBe(true);
    }
    expect(WEST.lines.length).toBeGreaterThan(20);
    expect(EAST.lines.length).toBeGreaterThan(50);
    expect(HAWAII.lines).toEqual([]);
    // 五大湖的湖岸：蘇必略湖北岸（加拿大那邊）也在
    expect(EAST.coast.some((l) => l.some(([lat, lng]) => lat > 48.3 && lng > -89 && lng < -86))).toBe(true);
  });
  it('the land mask leaves out Canada, Mexico, Cuba and the sea', () => {
    for (const [name, lat, lng] of [
      ['紐約', 40.71, -74.0],
      ['洛杉磯', 34.05, -118.24],
      ['邁阿密', 25.77, -80.19],
      ['安克拉治', 61.22, -149.9],
      ['檀香山', 21.31, -157.86],
    ] as const) expect(onLand(lat, lng), name).toBe(true);
    for (const [name, lat, lng] of [
      ['溫哥華', 49.28, -123.12],
      ['多倫多', 43.65, -79.38],
      ['蒙特雷', 25.69, -100.32],
      ['哈瓦那', 23.11, -82.37],
      ['墨西哥灣', 27.0, -90.0],
    ] as const) expect(onLand(lat, lng), name).toBe(false);
  });
});
