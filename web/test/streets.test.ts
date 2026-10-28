import { describe, expect, it } from 'vitest';
import { decodeStreets, STREET_TIERS, tileOf } from '../src/streets';

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
  it('fits the radar in at most 2 x 2 tiles', () => {
    // 圖磚寬度（緯度 25 度）要大於畫面直徑
    for (const t of STREET_TIERS.filter((t) => t.maxKm !== Infinity)) {
      expect((40075 * Math.cos((25 * Math.PI) / 180)) / 2 ** t.zoom).toBeGreaterThan(t.maxKm * 2 * 1.05);
    }
  });
});

describe('tileOf', () => {
  it('finds the z13 tile of Taipei Main Station', () => {
    expect(tileOf(25.0478, 121.517, 13)).toEqual({ x: 6861, y: 3506 });
  });
});
