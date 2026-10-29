import { describe, expect, it } from 'vitest';
import { globeFrac, RADAR_GEOM, SPACE_FROM_KM } from '../src/radar';
import type { StreetLine } from '../src/streets';
import { focusMinKm, hemiPath, WOOF_KM, landPath, moonPosition, nightPath, onWoofLand, ortho, planetPositions, spaceMarkup, subsolar, toWoof } from '../src/space';

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

describe('spaceMarkup in 3D', () => {
  const when = new Date('2026-10-28T08:00:00Z');
  const base = { center: { lat: 25.04, lng: 121.52 }, land: [] as Array<Array<[number, number]>>, when };
  it('can fly to Jupiter and zoom in to see its bands and Great Red Spot', () => {
    const near = spaceMarkup({ ...base, scaleKm: 1e6, rg: 164 * globeFrac(1e6), view: { focus: 'jupiter', yaw: 0, pitch: 0 } });
    expect(near).toContain('>木星<');
    expect(near).toContain('space-spot');
    expect(near).toContain('data-body="jupiter"');
    // 地球在 6 億公里外，不在畫面上
    expect(near).not.toContain('space-me');
  });

  it('can fly to the Moon and zoom in below 全球 to see its maria and craters', () => {
    const moon = spaceMarkup({ ...base, scaleKm: 5000, rg: 164, view: { focus: 'moon', yaw: 0, pitch: 0 } });
    expect(moon).toContain('>月球<');
    expect(moon).toContain('space-mare');
    expect((moon.match(/space-detail/g) ?? []).length).toBeGreaterThanOrEqual(7);
    // 地球的海岸線不畫（中心不是你）
    expect(moon).not.toContain('space-limb');
  });

  it('draws you on the Earth and names it when the centre is somewhere else', () => {
    const moved = spaceMarkup({ ...base, scaleKm: 3e8, rg: 164 * globeFrac(3e8), view: { focus: 'venus', yaw: 0, pitch: 0 } });
    expect(moved).toContain('>地球（你）<');
    expect(moved).toContain('space-me');
    const still = spaceMarkup({ ...base, scaleKm: 3e8, rg: 164 * globeFrac(3e8) });
    expect(still).toContain('>地球<');
    expect(still).not.toContain('space-me');
  });

  it('squashes the orbits into ellipses when tilted', () => {
    const height = (d: string): number => {
      const ys = [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => Number(m[2]));
      return Math.max(...ys) - Math.min(...ys);
    };
    const orbit = (m: string): string => [...m.matchAll(/space-orbit" d="([^"]+)"/g)].at(-1)![1];
    const flat = spaceMarkup({ ...base, scaleKm: 5e9, rg: 164 * globeFrac(5e9) });
    const tilted = spaceMarkup({ ...base, scaleKm: 5e9, rg: 164 * globeFrac(5e9), view: { focus: null, yaw: 0, pitch: 1.2 } });
    expect(height(orbit(tilted))).toBeLessThan(height(orbit(flat)) * 0.5);
  });
});

describe('汪星', () => {
  const base = { center: { lat: 25.04, lng: 121.52 }, land: [] as Array<Array<[number, number]>>, when: new Date('2026-10-28T08:00:00Z') };
  it('orbits between the Earth and Mars', () => {
    for (const when of ['2026-10-28T00:00:00Z', '2027-06-01T00:00:00Z', '2030-01-01T00:00:00Z']) {
      const ps = planetPositions(new Date(when));
      const woof = ps.find((p) => p.key === 'woof')!;
      expect(woof.dist).toBeGreaterThan(ps.find((p) => p.key === 'earth')!.dist + 0.15);
      expect(woof.dist).toBeLessThan(ps.find((p) => p.key === 'mars')!.dist - 0.05);
    }
  });

  it('shows up with the planets, and as a globe like the Earth when you fly there', () => {
    const inner = spaceMarkup({ ...base, scaleKm: 3e8, rg: 164 * globeFrac(3e8) });
    expect(inner).toContain('>汪星<');
    expect(inner).toContain('data-body="woof"');
    const near = spaceMarkup({ ...base, scaleKm: (WOOF_KM * 164) / 39, rg: 164, view: { focus: 'woof', yaw: 0, pitch: 0 } });
    const woof = near.slice(near.indexOf('data-body="woof"'));
    for (const cls of ['space-globe', 'space-grat', 'space-night', 'space-limb', 'region-outline', 'county-line']) expect(woof).toContain(cls);
    // 還小：道路先不畫
    expect(woof).not.toContain('woof-road');
    // 拖曳轉視角：球跟著轉
    const turned = spaceMarkup({ ...base, scaleKm: (WOOF_KM * 164) / 39, rg: 164, view: { focus: 'woof', yaw: 0.5, pitch: 0.3 } });
    const grat = (m: string): string => /space-grat" d="([^"]+)"/.exec(m.slice(m.indexOf('data-body="woof"')))![1];
    expect(grat(turned)).not.toBe(grat(near));
  });

  it('wraps Taipei City around the whole planet, with the sea outside the city', () => {
    // 市界最西南、最東北的角落
    const sw = toWoof([24.9605, 121.4571]);
    const ne = toWoof([25.2103, 121.6659]);
    for (const [v, want] of [[sw[0], -80], [sw[1], -172], [ne[0], 80], [ne[1], 172]]) expect(Math.abs(v - want)).toBeLessThan(0.1);
    // 台北車站、台北 101 是陸地，板橋、三重（新北）是海
    for (const p of [[25.0478, 121.517], [25.034, 121.5645]] as Array<[number, number]>) expect(onWoofLand(...toWoof(p))).toBe(true);
    for (const p of [[25.0143, 121.4627], [25.0615, 121.4875]] as Array<[number, number]>) expect(onWoofLand(...toWoof(p))).toBe(false);
    // 南北極、背面的接縫是海
    expect(onWoofLand(89, 0)).toBe(false);
    expect(onWoofLand(0, 179)).toBe(false);
  });

  it('draws the city in lines like Taipei on the radar: coast, districts and roads', () => {
    // 正中間轉到台北車站
    const [lat, lng] = toWoof([25.0478, 121.517]);
    const near = spaceMarkup({ ...base, scaleKm: (WOOF_KM * 164) / 131, rg: 164, view: { focus: 'woof', yaw: (-lng * Math.PI) / 180, pitch: (lat * Math.PI) / 180 } });
    const woof = near.slice(near.indexOf('data-body="woof"'));
    // 陸地淡淡填色、海岸線虛線分開畫
    expect(woof).toMatch(/class="region-outline woof-land" d="M[\d. L]+Z"/);
    expect(woof).toMatch(/class="region-outline open" d="M[\d. LM]+"/);
    expect(woof).toMatch(/class="woof-road street-major" d="M/);
    expect(woof).toMatch(/class="woof-road street-minor" d="M/);
    // 區名不寫
    expect(woof).not.toContain('區<');
    // 沒有填顏色的底
    expect(woof).not.toContain('fill="#');
  });

  it('zooms in to 1 km, keeping the lines where they are on the sphere', () => {
    expect(focusMinKm('woof')).toBe(1);
    expect(focusMinKm('moon')).toBeCloseTo(1737 * 1.3);
    // 正中間放在北緯 30 度的緯線上、兩個點（經度 0、3 度）中間：拉近到 1 km，緯線還是要通過正中間
    const view = { focus: 'woof', yaw: (-1.5 * Math.PI) / 180, pitch: (30 * Math.PI) / 180 };
    const m = spaceMarkup({ ...base, scaleKm: 1, rg: 164, view });
    const woof = m.slice(m.indexOf('data-body="woof"'));
    const grat = /space-grat" d="([^"]+)"/.exec(woof)![1];
    const C = RADAR_GEOM.c;
    let best = Infinity;
    for (const part of grat.split('M').filter(Boolean)) {
      const pts = [...part.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((x) => [Number(x[1]), Number(x[2])]);
      for (let i = 0; i + 1 < pts.length; i++) {
        const [a, b] = [pts[i], pts[i + 1]];
        const t = Math.max(0, Math.min(1, ((C - a[0]) * (b[0] - a[0]) + (C - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1)));
        best = Math.min(best, Math.hypot(a[0] + t * (b[0] - a[0]) - C, a[1] + t * (b[1] - a[1]) - C));
      }
    }
    expect(best).toBeLessThan(2);
    // 放大很多：畫面外的線、球的邊不畫（虛線整圈有幾百萬公里長，要畫好幾秒）
    expect(m.length).toBeLessThan(40_000);
    expect(woof).not.toContain('space-limb');
    for (const d of woof.matchAll(/class="(?:space-grat|region-outline open[^"]*|woof-road[^"]*)" d="([^"]*)"/g)) {
      for (const n of d[1].matchAll(/-?\d+\.\d/g)) expect(Math.abs(Number(n[0]))).toBeLessThan(5_000);
    }
  });
});

describe('汪星的台北街道', () => {
  const base = { center: { lat: 25.04, lng: 121.52 }, land: [] as Array<Array<[number, number]>>, when: new Date('2026-10-28T08:00:00Z') };
  const line = (cls: 'major' | 'minor', pts: Array<[number, number]>): StreetLine => ({
    cls,
    pts: new Float64Array(pts.flat()),
    box: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))],
  });
  // 台北車站前東西向的一條街、板橋（新北，海）的一條街
  const station = line('minor', [[25.0478, 121.505], [25.0478, 121.53]]);
  const banqiao = line('minor', [[25.0143, 121.458], [25.0143, 121.466]]);
  const [lat, lng] = toWoof([25.0478, 121.517]);
  const view = { focus: 'woof', yaw: (-lng * Math.PI) / 180, pitch: (lat * Math.PI) / 180 };
  const roads = (m: string, cls: string): string => new RegExp(`woof-road street-${cls}" d="([^"]*)"`).exec(m)![1];

  it('loads the streets of the part of Taipei on screen once it is within 2 km, like the radar', () => {
    // 照台北的面積算：半徑約 6.6 km
    expect(WOOF_KM).toBeGreaterThan(6.3);
    expect(WOOF_KM).toBeLessThan(6.9);
    const calls: number[][] = [];
    const streets = (a: number, b: number, km: number, range: number): { lines: StreetLine[]; pending: number } => {
      calls.push([a, b, km, range]);
      return { lines: [station, banqiao], pending: 0 };
    };
    // 整顆看得到：用內建的道路，不載入
    spaceMarkup({ ...base, scaleKm: (WOOF_KM * 164) / 131, rg: 164, view, streets });
    expect(calls).toHaveLength(0);
    const m = spaceMarkup({ ...base, scaleKm: 1.2, rg: 164, view, streets });
    expect(calls).toHaveLength(1);
    const [a, b, , range] = calls[0];
    expect(Math.abs(a - 25.0478)).toBeLessThan(0.001);
    expect(Math.abs(b - 121.517)).toBeLessThan(0.001);
    expect(range).toBeLessThan(2);
    // 車站前的街從畫面正中間橫過去；板橋在海上不畫；這一級的圖磚沒有的粗線也不畫內建的
    const d = roads(m, 'minor');
    const C = RADAR_GEOM.c;
    const ys = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((x) => [Number(x[1]), Number(x[2])]).filter(([x]) => Math.abs(x - C) < 100);
    expect(ys.length).toBeGreaterThan(1);
    for (const [, y] of ys) expect(Math.abs(y - C)).toBeLessThan(3);
    expect(roads(m, 'major')).toBe('');
  });

  it('keeps the built-in roads until every tile is there, and draws nothing over the sea', () => {
    const builtIn = spaceMarkup({ ...base, scaleKm: 1.2, rg: 164, view });
    const loading = spaceMarkup({ ...base, scaleKm: 1.2, rg: 164, view, streets: () => ({ lines: [station], pending: 1 }) });
    expect(roads(loading, 'minor')).toBe(roads(builtIn, 'minor'));
    expect(spaceMarkup({ ...base, scaleKm: 1.2, rg: 164, view, streets: () => null })).toBe(builtIn);
    const sea = spaceMarkup({ ...base, scaleKm: 1.2, rg: 164, view, streets: () => ({ lines: [banqiao], pending: 0 }) });
    expect(roads(sea, 'minor')).toBe('');
  });
});

describe('hemiPath', () => {
  /** 平面上的長方形（逆時針，每 2 度一個點），[緯度, 經度] */
  const box = (lat0: number, lat1: number, lng0: number, lng1: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let x = lng0; x < lng1; x += 2) out.push([lat0, x]);
    for (let y = lat0; y < lat1; y += 2) out.push([y, lng1]);
    for (let x = lng1; x > lng0; x -= 2) out.push([lat1, x]);
    for (let y = lat1; y > lat0; y -= 2) out.push([y, lng0]);
    return out;
  };
  /** path 圍起來的面積（半徑 1）和有幾塊 */
  const areaOf = (d: string, rg: number): { area: number; parts: number } => {
    let area = 0;
    const parts = d.split('M').filter(Boolean);
    for (const part of parts) {
      const pts = [...part.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      for (let i = 0; i < pts.length; i++) {
        const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
        area += (a[0] * b[1] - b[0] * a[1]) / 2;
      }
    }
    return { area: Math.abs(area) / (rg * rg), parts: parts.length };
  };
  const band = box(-60, 60, -170, 170);

  it('draws land bigger than half the globe on the right side of the coast', () => {
    // 正面整片都是陸地，只有南北緯 60 度以外是海
    const front = areaOf(hemiPath({ lat: 0, lng: 0 }, band, 100, true), 100);
    expect(front.area).toBeCloseTo(Math.PI - 2 * (Math.acos(Math.sqrt(3) / 2) - Math.sqrt(3) / 4), 1);
    // 背面：中間有一條 20 度寬的海，陸地分成左右兩塊
    const back = areaOf(hemiPath({ lat: 0, lng: 180 }, band, 100, false), 100);
    expect(back.parts).toBe(2);
    expect(back.area).toBeCloseTo(2.446, 1);
  });

  it('fills the whole face when the coast is all on the other side and the middle is land', () => {
    const ring: Array<[number, number]> = [[-85, -175], [-85, 175], [85, 175], [85, -175]];
    expect(hemiPath({ lat: 0, lng: 0 }, ring, 100, true)).toContain('A100 100');
    expect(hemiPath({ lat: 0, lng: 0 }, ring, 100, false)).toBe('');
  });

  it('keeps a small island as is', () => {
    const d = hemiPath({ lat: 0, lng: 0 }, box(-10, 10, -20, 20), 100, false);
    expect(d.match(/M/g)).toHaveLength(1);
    expect(areaOf(d, 100).area).toBeGreaterThan(0.1);
  });
});
