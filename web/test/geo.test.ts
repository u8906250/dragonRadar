import { describe, expect, it } from 'vitest';
import { bearingDeg, bottleSize, compassLabel, formatKm, haversineKm, lookFrom, simplifyLatLng, TAIWAN_EXTREMES, taiwanRadiusKm, unitVectors } from '../src/geo';

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
