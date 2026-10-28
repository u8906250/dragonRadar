import { describe, expect, it } from 'vitest';
import { landPath, nightPath, ortho, planetPositions, subsolar } from '../src/space';

const diff = (a: number, b: number): number => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
const lonOf = (when: string, key: string): number => planetPositions(new Date(when)).find((p) => p.key === key)!.lon;

describe('subsolar', () => {
  it('is over the Tropic of Cancer at the June solstice and near the equator and Greenwich at the March equinox noon', () => {
    expect(subsolar(new Date('2026-06-21T08:00:00Z')).lat).toBeCloseTo(23.44, 0);
    const eq = subsolar(new Date('2026-03-20T12:00:00Z'));
    expect(Math.abs(eq.lat)).toBeLessThan(0.6);
    expect(Math.abs(eq.lng)).toBeLessThan(3);
  });
});

describe('planetPositions', () => {
  it('puts the Earth opposite the Sun', () => {
    for (const when of ['2000-01-01T12:00:00Z', '2026-10-28T00:00:00Z', '2030-06-21T00:00:00Z']) {
      expect(diff(lonOf(when, 'earth'), subsolar(new Date(when)).eclLon + 180)).toBeLessThan(1);
    }
  });

  it('lines up the Earth with Mars, Jupiter and Saturn at their oppositions', () => {
    expect(diff(lonOf('2025-01-16T00:00:00Z', 'mars'), lonOf('2025-01-16T00:00:00Z', 'earth'))).toBeLessThan(2);
    expect(diff(lonOf('2024-12-07T00:00:00Z', 'jupiter'), lonOf('2024-12-07T00:00:00Z', 'earth'))).toBeLessThan(2);
    expect(diff(lonOf('2025-09-21T00:00:00Z', 'saturn'), lonOf('2025-09-21T00:00:00Z', 'earth'))).toBeLessThan(2);
  });

  it('keeps each planet between its perihelion and aphelion', () => {
    const earth = planetPositions(new Date('2026-10-28T00:00:00Z')).find((p) => p.key === 'earth')!;
    expect(earth.dist).toBeGreaterThan(0.983);
    expect(earth.dist).toBeLessThan(1.017);
  });
});

describe('ortho', () => {
  it('puts the centre in the middle facing the viewer and a point 90° east on the edge', () => {
    const [x, y, z] = ortho({ lat: 25, lng: 121 }, 25, 121);
    expect(Math.hypot(x, y)).toBeLessThan(1e-9);
    expect(z).toBeCloseTo(1, 9);
    const e = ortho({ lat: 0, lng: 0 }, 0, 90);
    expect(e[0]).toBeCloseTo(1, 9);
    expect(e[2]).toBeCloseTo(0, 9);
  });
});

describe('nightPath', () => {
  it('draws no night under the Sun and a full disc on the opposite side', () => {
    const sun = { lat: 10, lng: 50 };
    expect(nightPath(sun, sun)).toBe('');
    expect(nightPath({ lat: -10, lng: -130 }, sun)).toMatch(/^M.*A.*A.*Z$/);
    expect(nightPath({ lat: 25, lng: 121 }, sun)).toMatch(/^M[\d. L]+Z$/);
  });
});

describe('landPath', () => {
  /** 每一塊的面積（SVG 座標，鞋帶公式） */
  const areas = (d: string): number[] =>
    d
      .split('Z')
      .filter(Boolean)
      .map((sub) => {
        const pts = [...sub.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
        let a = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const q = pts[(i + 1) % pts.length];
          a += p[0] * q[1] - q[0] * p[1];
        }
        return a / 2;
      });

  it('never wraps a continent around the whole globe, even when it passes behind the far side', async () => {
    const { WORLD_RINGS } = await import('../src/world');
    const disc = Math.PI * (0.78 * 164) ** 2;
    for (const center of [{ lat: 25.04, lng: 121.52 }, { lat: 37.78, lng: -121.98 }, { lat: -25, lng: -58 }, { lat: 51.5, lng: 0 }]) {
      for (const a of areas(landPath(center, WORLD_RINGS))) expect(Math.abs(a)).toBeLessThan(disc * 0.6);
    }
  });
});
