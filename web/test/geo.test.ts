import { describe, expect, it } from 'vitest';
import { bearingDeg, bottleSize, compassLabel, cutAtBox, formatKm, haversineKm, lookFrom, outsideBox, ringHas, simplifyLatLng, splitAntimeridian, TAIWAN_EXTREMES, taiwanRadiusKm, unitVectors } from '../src/geo';

const TAIPEI_MAIN = { lat: 25.0478, lng: 121.517 };
const TAIPEI_101 = { lat: 25.034, lng: 121.5645 };

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(TAIPEI_MAIN, TAIPEI_MAIN)).toBe(0);
  });
  it('measures Taipei Main Station to Taipei 101 at about 5 km', () => {
    const d = haversineKm(TAIPEI_MAIN, TAIPEI_101);
    expect(d).toBeGreaterThan(4.5);
    expect(d).toBeLessThan(5.5);
  });
});

describe('bearingDeg', () => {
  it('points north for a point directly north', () => {
    expect(bearingDeg({ lat: 25, lng: 121 }, { lat: 26, lng: 121 })).toBeCloseTo(0, 5);
  });
  it('points east for a point directly east', () => {
    expect(bearingDeg({ lat: 0, lng: 121 }, { lat: 0, lng: 122 })).toBeCloseTo(90, 5);
  });
  it('puts Taipei 101 roughly east of Taipei Main Station', () => {
    const b = bearingDeg(TAIPEI_MAIN, TAIPEI_101);
    expect(b).toBeGreaterThan(95);
    expect(b).toBeLessThan(125);
    expect(compassLabel(b)).toBe('東');
  });
});

describe('formatKm', () => {
  it('switches units sensibly', () => {
    expect(formatKm(0.42)).toBe('420 m');
    expect(formatKm(3.14)).toBe('3.1 km');
    expect(formatKm(12.6)).toBe('13 km');
  });
});

describe('taiwanRadiusKm', () => {
  it('covers the main island and outlying islands from Taipei', () => {
    const r = taiwanRadiusKm(TAIPEI_MAIN);
    for (const p of TAIWAN_EXTREMES) expect(haversineKm(TAIPEI_MAIN, p)).toBeLessThanOrEqual(r);
    expect(r % 50).toBe(0);
    expect(r).toBeGreaterThan(50);
  });
});

import { destination } from '../src/geo';

describe('destination', () => {
  it('walks the given bearing and distance', () => {
    const p = destination(TAIPEI_MAIN, 90, 5);
    expect(haversineKm(TAIPEI_MAIN, p)).toBeCloseTo(5, 3);
    expect(bearingDeg(TAIPEI_MAIN, p)).toBeCloseTo(90, 0);
    const back = destination(p, bearingDeg(p, TAIPEI_MAIN), haversineKm(p, TAIPEI_MAIN));
    expect(back.lat).toBeCloseTo(TAIPEI_MAIN.lat, 5);
    expect(back.lng).toBeCloseTo(TAIPEI_MAIN.lng, 5);
  });
  it('wraps longitude across the antimeridian', () => {
    const p = destination({ lat: 0, lng: 179.9 }, 90, 50);
    expect(p.lng).toBeLessThan(-179);
  });
});

describe('bottleSize', () => {
  it('full size within 1 km, half at 10 km, a light blue dot (0) beyond 10 km', () => {
    expect(bottleSize(0.5)).toBe(1);
    expect(bottleSize(1)).toBe(1);
    expect(bottleSize(3)).toBeGreaterThan(0.5);
    expect(bottleSize(3)).toBeLessThan(1);
    expect(bottleSize(10)).toBeCloseTo(0.5);
    expect(bottleSize(10.1)).toBe(0);
    expect(bottleSize(50)).toBe(0);
  });
});

describe('lookFrom', () => {
  it('matches bearingDeg and haversineKm from Taipei to near and far points', () => {
    const pts: Array<[number, number]> = [
      [TAIPEI_101.lat, TAIPEI_101.lng],
      [25.0479, 121.5171],
      [35.68, 139.69],
      [-33.87, 151.21],
      [51.5, -0.12],
      [-25, -58.5],
    ];
    const look = lookFrom(TAIPEI_MAIN);
    const v = unitVectors(pts);
    pts.forEach(([lat, lng], i) => {
      const r = look(v, i);
      expect(r.distanceKm).toBeCloseTo(haversineKm(TAIPEI_MAIN, { lat, lng }), 6);
      expect(r.bearing).toBeCloseTo(bearingDeg(TAIPEI_MAIN, { lat, lng }), 4);
    });
  });
});

describe('simplifyLatLng', () => {
  // 北緯 60 度、跨換日線的一圈（經度 150 到 -170）
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < 360; i++) {
    const lng = 170 + 20 * Math.cos((i * Math.PI) / 180);
    ring.push([60 + 5 * Math.sin((i * Math.PI) / 180), lng > 180 ? lng - 360 : lng]);
  }
  ring.push(ring[0]);
  it('drops points closer than the tolerance and keeps the ring closed', () => {
    const s = simplifyLatLng(ring, 5);
    expect(s.length).toBeLessThan(60);
    expect(s.length).toBeGreaterThan(8);
    expect(s[0]).toBe(ring[0]);
    expect(s[s.length - 1]).toBe(ring[ring.length - 1]);
    // 留下的都是原本的點
    for (const p of s) expect(ring).toContain(p);
  });
  it('keeps every point of a straight-ish short line under a tiny tolerance', () => {
    const line: Array<[number, number]> = [
      [25, 121],
      [25.5, 121.9],
      [25.2, 122.4],
    ];
    expect(simplifyLatLng(line, 0.01)).toEqual(line);
    expect(simplifyLatLng(line, 500)).toEqual([line[0], line[2]]);
  });
});

/** 經緯度當平面算的面積（正負看方向） */
const area = (r: Array<[number, number]>): number => {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [p, q] = [r[i], r[(i + 1) % r.length]];
    a += p[1] * q[0] - q[1] * p[0];
  }
  return a / 2;
};

describe('cutAtBox', () => {
  const box = { s: 0, w: 0, n: 10, e: 10 };
  it('drops the segments that run along the box edge and keeps the real coast in one piece', () => {
    // 陸地從方框左邊進來、右邊出去（上面是海）：切開的地方沿著左、下、右邊走
    const land: Array<[number, number]> = [[0, 0], [5, 0], [6, 3], [7, 7], [5, 10], [0, 10], [0, 5], [0, 0]];
    expect(cutAtBox([land], box)).toEqual([[[5, 0], [6, 3], [7, 7], [5, 10]]]);
  });
  it('keeps islands that never touch the edge as whole rings', () => {
    const island: Array<[number, number]> = [[2, 2], [3, 2], [3, 3], [2, 2]];
    expect(cutAtBox([island], box)).toEqual([island]);
  });
});

describe('outsideBox', () => {
  const box = { s: 0, w: 0, n: 10, e: 10 };
  it('returns rings away from the box untouched and drops rings inside it', () => {
    const far: Array<[number, number]> = [[20, 20], [21, 20], [21, 21], [20, 20]];
    expect(outsideBox(far, box)[0]).toBe(far);
    expect(outsideBox([[2, 2], [3, 2], [3, 3], [2, 2]], box)).toEqual([]);
  });
  it('cuts out the box: the pieces cover the rest of the ring exactly', () => {
    // 20×20 的方塊中間挖掉 10×10
    const big: Array<[number, number]> = [[-5, -5], [15, -5], [15, 15], [-5, 15], [-5, -5]];
    const pieces = outsideBox(big, box);
    expect(pieces.reduce((a, r) => a + Math.abs(area(r)), 0)).toBeCloseTo(400 - 100, 6);
    for (const r of pieces) for (const [lat, lng] of r) expect(lat <= 0 || lat >= 10 || lng <= 0 || lng >= 10).toBe(true);
  });
});

describe('ringHas', () => {
  it('tells inside from outside', () => {
    const r: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    expect(ringHas(r, 5, 5)).toBe(true);
    expect(ringHas(r, 5, 15)).toBe(false);
    expect(ringHas(r, -1, 5)).toBe(false);
  });
});

describe('splitAntimeridian', () => {
  it('leaves ordinary rings alone', () => {
    const r: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 0]];
    expect(splitAntimeridian(r)).toEqual([r]);
  });
  it('cuts a ring that jumps from 180 to -180 into two rings that meet on the antimeridian', () => {
    // 跨過換日線的島：東經 179～西經 179
    const r: Array<[number, number]> = [[-16, 179], [-16, -179], [-17, -179], [-17, 179], [-16, 179]];
    const parts = splitAntimeridian(r);
    expect(parts).toHaveLength(2);
    for (const p of parts) {
      expect(p[0]).toEqual(p[p.length - 1]);
      const lngs = p.map(([, lng]) => lng);
      expect(Math.max(...lngs) - Math.min(...lngs)).toBeCloseTo(1, 6);
      expect(lngs.some((l) => Math.abs(Math.abs(l) - 180) < 1e-9)).toBe(true);
    }
    expect(parts.reduce((a, p) => a + Math.abs(area(p)), 0)).toBeCloseTo(2, 6);
  });
});
