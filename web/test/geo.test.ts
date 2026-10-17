import { describe, expect, it } from 'vitest';
import { bearingDeg, compassLabel, formatKm, haversineKm } from '../src/geo';

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
