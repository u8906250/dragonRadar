import { describe, expect, it } from 'vitest';
import { bearingDeg, compassLabel, formatKm, haversineKm, TAIWAN_EXTREMES, taiwanRadiusKm } from '../src/geo';
import { inShuangbei, SHUANGBEI_RINGS, shuangbeiRadiusKm } from '../src/shuangbei';

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

describe('shuangbeiRadiusKm', () => {
  it('covers every extreme point of Taipei and New Taipei from Taipei Main Station', () => {
    const r = shuangbeiRadiusKm(TAIPEI_MAIN);
    for (const [lat, lng] of SHUANGBEI_RINGS.flat()) expect(haversineKm(TAIPEI_MAIN, { lat, lng })).toBeLessThanOrEqual(r);
    expect(r % 5).toBe(0);
    expect(r).toBeLessThanOrEqual(60);
  });
  it('grows when the user is near the edge of the region', () => {
    expect(shuangbeiRadiusKm({ lat: 24.95, lng: 121.35 })).toBeGreaterThan(shuangbeiRadiusKm(TAIPEI_MAIN));
  });
});

describe('inShuangbei', () => {
  const at = (lat: number, lng: number): boolean => inShuangbei({ lat, lng });
  it('Taipei and New Taipei are inside', () => {
    expect(at(25.0478, 121.517)).toBe(true); // 台北車站
    expect(at(25.0616, 121.5586)).toBe(true); // 民權公園
    expect(at(25.0143, 121.4637)).toBe(true); // 板橋車站
    expect(at(25.1676, 121.4455)).toBe(true); // 淡水車站
    expect(at(24.8636, 121.5506)).toBe(true); // 烏來
    expect(at(25.1093, 121.8443)).toBe(true); // 九份
    expect(at(25.0177, 121.9454)).toBe(true); // 福隆車站（海邊）
  });
  it('Keelung, Taoyuan and Yilan are outside', () => {
    expect(at(25.1317, 121.7397)).toBe(false); // 基隆車站
    expect(at(24.9892, 121.3138)).toBe(false); // 桃園車站
    expect(at(24.6770, 121.7669)).toBe(false); // 羅東
    expect(at(25.0800, 121.2320)).toBe(false); // 桃園機場
  });
});

describe('taiwanRadiusKm', () => {
  it('covers the main island and outlying islands from Taipei', () => {
    const r = taiwanRadiusKm(TAIPEI_MAIN);
    for (const p of TAIWAN_EXTREMES) expect(haversineKm(TAIPEI_MAIN, p)).toBeLessThanOrEqual(r);
    expect(r % 50).toBe(0);
    expect(r).toBeGreaterThan(shuangbeiRadiusKm(TAIPEI_MAIN));
  });
});
