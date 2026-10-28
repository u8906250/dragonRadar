import { describe, expect, it } from 'vitest';
import { globeFrac, SPACE_FROM_KM } from '../src/radar';
import { landPath, moonPosition, nightPath, ortho, planetPositions, spaceMarkup, subsolar } from '../src/space';

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
    expect(nightPath(sun, sun, 100)).toBe('');
    expect(nightPath({ lat: -10, lng: -130 }, sun, 100)).toMatch(/^M.*A.*A.*Z$/);
    expect(nightPath({ lat: 25, lng: 121 }, sun, 100)).toMatch(/^M[\d. L]+Z$/);
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
    const disc = Math.PI * 164 ** 2;
    for (const center of [{ lat: 25.04, lng: 121.52 }, { lat: 37.78, lng: -121.98 }, { lat: -25, lng: -58 }, { lat: 51.5, lng: 0 }]) {
      for (const a of areas(landPath(center, WORLD_RINGS, 164))) expect(Math.abs(a)).toBeLessThan(disc * 0.6);
    }
  });
});

describe('moonPosition', () => {
  it('lines up with the Sun at the 2024-04-08 eclipse and sits opposite it at the 2024-01-25 full moon', () => {
    const eclipse = new Date('2024-04-08T18:21:00Z');
    expect(diff(moonPosition(eclipse).lon, subsolar(eclipse).eclLon)).toBeLessThan(3);
    const full = new Date('2024-01-25T17:54:00Z');
    expect(diff(moonPosition(full).lon, subsolar(full).eclLon + 180)).toBeLessThan(3);
    expect(moonPosition(full).dist).toBeGreaterThan(356_000);
    expect(moonPosition(full).dist).toBeLessThan(407_000);
  });
});

describe('globeFrac', () => {
  it('fills the radar right after 全球 and reaches true scale four times further out', () => {
    expect(globeFrac(SPACE_FROM_KM)).toBe(1);
    expect(globeFrac(SPACE_FROM_KM * 1.0001)).toBeCloseTo(1, 3);
    expect(globeFrac(SPACE_FROM_KM * 4)).toBeCloseTo(6371 / (SPACE_FROM_KM * 4), 9);
    expect(globeFrac(1e6)).toBeCloseTo(6371 / 1e6, 9);
    // 越拉遠越小
    expect(globeFrac(30_000)).toBeLessThan(globeFrac(25_000));
  });
});

describe('spaceMarkup', () => {
  const opts = { center: { lat: 25.04, lng: 121.52 }, land: [] as Array<Array<[number, number]>>, when: new Date('2026-10-28T08:00:00Z') };
  it('shows the Moon only at Moon scale and the Sun and planets further out', () => {
    const moon = spaceMarkup({ ...opts, scaleKm: 500_000, rg: 164 * globeFrac(500_000) });
    expect(moon).toContain('>月球<');
    expect(moon).not.toContain('>太陽<');
    const inner = spaceMarkup({ ...opts, scaleKm: 3e8, rg: 164 * globeFrac(3e8) });
    expect(inner).toContain('>太陽<');
    expect(inner).toContain('>地球<');
    const all = spaceMarkup({ ...opts, scaleKm: 5e9, rg: 164 * globeFrac(5e9) });
    expect(all).toContain('>海王星<');
    expect((all.match(/space-orbit/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});

describe('spaceMarkup when the view is dragged away from the Earth', () => {
  const when = new Date('2026-10-28T08:00:00Z');
  const base = { center: { lat: 25.04, lng: 121.52 }, land: [] as Array<Array<[number, number]>>, when };
  it('can centre on Jupiter and zoom in to see its bands and Great Red Spot', () => {
    const ps = planetPositions(when);
    const e = ps.find((p) => p.key === 'earth')!;
    const j = ps.find((p) => p.key === 'jupiter')!;
    const AU = 149_597_870.7;
    const offset = { x: (j.x - e.x) * AU, y: (j.y - e.y) * AU };
    const near = spaceMarkup({ ...base, scaleKm: 1e6, rg: 164 * globeFrac(1e6), offset });
    expect(near).toContain('>木星<');
    expect(near).toContain('space-spot');
    expect(near).toContain('space-detail');
    // 地球在 6 億公里外，不在畫面上
    expect(near).not.toContain('space-me');
  });

  it('draws you on the Earth and names it when the view has moved', () => {
    const moved = spaceMarkup({ ...base, scaleKm: 3e8, rg: 164 * globeFrac(3e8), offset: { x: 5e7, y: 0 } });
    expect(moved).toContain('>地球（你）<');
    expect(moved).toContain('space-me');
    const still = spaceMarkup({ ...base, scaleKm: 3e8, rg: 164 * globeFrac(3e8) });
    expect(still).toContain('>地球<');
    expect(still).not.toContain('space-me');
  });
});
