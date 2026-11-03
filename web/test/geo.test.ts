import { describe, expect, it } from 'vitest';
import { bearingDeg, compassLabel, formatKm, haversineKm, TAIWAN_EXTREMES, taiwanRadiusKm } from '../src/geo';

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
