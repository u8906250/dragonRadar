import { describe, expect, it } from 'vitest';
import { clipLine, clipRing } from '../src/radar';

describe('道路切成格子（v1.720）', () => {
  const r: [number, number, number, number] = [0, 0, 10, 10];
  it('cuts a line at the cell border and keeps the inside pieces joined', () => {
    expect(clipLine([-5, 5, 5, 5, 15, 5], r)).toEqual([[0, 5, 5, 5, 10, 5]]);
    // 出去又回來：兩段
    expect(clipLine([2, 2, 2, 15, 8, 15, 8, 2], r)).toEqual([
      [2, 2, 2, 10],
      [8, 10, 8, 2],
    ]);
    // 整條在外面、只碰到邊外面
    expect(clipLine([20, 0, 30, 10], r)).toEqual([]);
  });
  it('clips a ring to the cell and keeps its direction', () => {
    // 外圈（逆時針）比格子大：剩下格子的四個角
    const big = clipRing([-5, -5, 15, -5, 15, 15, -5, 15], r);
    expect(big.length).toBe(8);
    const area = (p: number[]): number => {
      let a = 0;
      for (let q = 0; q < p.length; q += 2) a += p[q] * p[(q + 3) % p.length] - p[(q + 2) % p.length] * p[q + 1];
      return a / 2;
    };
    expect(area(big)).toBeCloseTo(100);
    // 順時針的（挖空的圈）切完還是順時針
    expect(area(clipRing([2, 2, 2, 8, 8, 8, 8, 2], r))).toBeCloseTo(-36);
    // 整圈在外面
    expect(clipRing([20, 20, 30, 20, 30, 30], r)).toEqual([]);
  });
});
