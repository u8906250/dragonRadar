import { describe, expect, it, vi } from 'vitest';
import { decodeStreets, onTaiwan, STREET_TIERS, streetTiles, tileOf, type StreetLine } from '../src/streets';

/** 組一張只有 transportation 圖層的小圖磚（protobuf） */
function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}
const field = (no: number, bytes: number[]): number[] => [...varint((no << 3) | 2), ...varint(bytes.length), ...bytes];
const str = (no: number, s: string): number[] => field(no, [...new TextEncoder().encode(s)]);
const packed = (no: number, nums: number[]): number[] => field(no, nums.flatMap(varint));
const zz = (n: number): number => (n << 1) ^ (n >> 31);

function tile(features: Array<{ tags: number[]; type: number; geom: number[] }>, name = 'transportation'): Uint8Array {
  const layer = [
    ...str(1, name),
    ...features.flatMap((f) => field(2, [...packed(2, f.tags), ...varint((3 << 3) | 0), ...varint(f.type), ...packed(4, f.geom)])),
    ...str(3, 'class'),
    ...str(3, 'brunnel'),
    ...field(4, str(1, 'primary')),
    ...field(4, str(1, 'minor')),
    ...field(4, str(1, 'tunnel')),
    ...field(4, str(1, 'path')),
    ...varint((5 << 3) | 0),
    ...varint(4096),
  ];
  return new Uint8Array(field(3, layer));
}

describe('decodeStreets', () => {
  it('reads road lines from the transportation layer', () => {
    // 0/0/0 這張：從左上角畫到右上角、再往下到正中間
    const line = [(1 << 3) | 1, zz(0), zz(0), (2 << 3) | 2, zz(4096), zz(0), zz(-2048), zz(2048)];
    const out = decodeStreets(
      tile([
        { tags: [0, 0], type: 2, geom: line },
        // 小路
        { tags: [0, 1], type: 2, geom: [(1 << 3) | 1, zz(2048), zz(2048), (1 << 3) | 2, zz(10), zz(0)] },
        // 隧道不畫
        { tags: [0, 0, 1, 2], type: 2, geom: line },
        // 步道不畫
        { tags: [0, 3], type: 2, geom: line },
      ]),
      0,
      0,
      0,
    );
    expect(out.map((l) => l.cls)).toEqual(['major', 'minor']);
    const [lat0, lng0, lat1, lng1, lat2, lng2] = out[0].pts;
    expect(lng0).toBeCloseTo(-180);
    expect(lat0).toBeCloseTo(85.0511, 3);
    expect(lng1).toBeCloseTo(180);
    expect(lat1).toBeCloseTo(85.0511, 3);
    expect(lng2).toBeCloseTo(0);
    expect(lat2).toBeCloseTo(0);
    expect(out[0].box).toEqual([lat2, lng0, lat0, lng1]);
  });
  it('ignores other layers', () => {
    expect(decodeStreets(tile([{ tags: [0, 0], type: 2, geom: [(1 << 3) | 1, 0, 0, (1 << 3) | 2, 2, 2] }], 'water'), 0, 0, 0)).toEqual([]);
  });
});

describe('STREET_TIERS', () => {
  it('draws only Taiwan roads beyond 65 km, with z7 tiles', () => {
    const last = STREET_TIERS[STREET_TIERS.length - 1];
    expect(last).toMatchObject({ maxKm: Infinity, zoom: 7, taiwan: true });
    expect(last.classes).toMatchObject({ motorway: 'major', trunk: 'major', primary: 'minor' });
  });
  it('draws tertiary roads within 8 km, like secondary ones (other cities tag their arterials tertiary)', () => {
    const t = STREET_TIERS.find((t) => t.maxKm === 8)!;
    expect(t.classes).toMatchObject({ secondary: 'minor', tertiary: 'minor' });
  });
  it('fits the radar in at most 2 x 2 tiles', () => {
    // 圖磚寬度（緯度 25 度）要大於畫面直徑
    for (const t of STREET_TIERS.filter((t) => t.maxKm !== Infinity)) {
      expect((40075 * Math.cos((25 * Math.PI) / 180)) / 2 ** t.zoom).toBeGreaterThan(t.maxKm * 2 * 1.05);
    }
  });
});

describe('onTaiwan', () => {
  const line = (...pts: Array<[number, number]>): StreetLine => ({ cls: 'major', pts: Float64Array.from(pts.flat()), box: [0, 0, 0, 0] });
  it('keeps roads on Taiwan and its islands', () => {
    expect(onTaiwan(line([25.0478, 121.517], [25.05, 121.52]))).toBe(true); // 台北車站
    expect(onTaiwan(line([22.98, 121.15], [22.75, 121.14]))).toBe(true); // 台東的台 11 線
    expect(onTaiwan(line([23.57, 119.58], [23.56, 119.6]))).toBe(true); // 澎湖馬公
    expect(onTaiwan(line([24.44, 118.27], [24.44, 118.31]))).toBe(true); // 金門大橋
    expect(onTaiwan(line([26.16, 119.94], [26.15, 119.95]))).toBe(true); // 馬祖南竿
  });
  it('drops roads across the strait', () => {
    expect(onTaiwan(line([24.48, 118.09], [24.5, 118.15]))).toBe(false); // 廈門
    expect(onTaiwan(line([26.07, 119.3], [26.1, 119.28]))).toBe(false); // 福州
    expect(onTaiwan(line([25.5, 119.78], [25.52, 119.8]))).toBe(false); // 平潭
  });
});

describe('streetTiles', () => {
  it('fetches only the Taiwan tiles when zoomed out to all of Taiwan', () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    try {
      // 台北選「全台」（約 400 km）：z7 只抓台灣那六張，對岸、海上的不抓
      expect(streetTiles(25.0418, 121.5654, 420, 400, () => {}).pending).toBe(6);
      // 在國外（東京）範圍跟全台一樣大：圈內沒有台灣，一張都不抓
      expect(streetTiles(35.68, 139.77, 600, 600, () => {}).pending).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('tileOf', () => {
  it('finds the z13 tile of Taipei Main Station', () => {
    expect(tileOf(25.0478, 121.517, 13)).toEqual({ x: 6861, y: 3506 });
  });
});
