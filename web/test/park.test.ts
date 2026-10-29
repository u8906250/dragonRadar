import { describe, expect, it } from 'vitest';
import { RADAR_GEOM } from '../src/radar';
import { EARTH, earthParkSvg, LAUNCH_MS, launchRocket, nearPark, PARK_MIN_KM, parkGeom, parkTexture } from '../src/park';
import { spaceMarkup, toWoof } from '../src/space';

const { c: C, inner: INNER } = RADAR_GEOM;
const hall: [number, number] = [25.0400096, 121.5602923];
const lawn: [number, number] = [25.0383215, 121.5608674];
const pond: [number, number] = [25.039066, 121.56026];
const lake: [number, number] = [25.0384268, 121.5593159];
const island: [number, number] = [25.0383369, 121.558924];
const at = (km: number, [lat, lng]: [number, number]): string => earthParkSvg({ lat, lng }, km);
const count = (m: string, cls: string): number => (new RegExp(`class="${cls}"[^>]* d="([^"]*)"`).exec(m)?.[1].match(/M/g) ?? []).length;
/** 地球的雷達上的畫法（北在上，跟 earthParkSvg 一樣） */
const earthCanvas = (km: number, [lat, lng]: [number, number]) => {
  const ppm = INNER / (km * 1000);
  return { ppm, center: { lat, lng }, rx: C, ry: C, at: (a: number, b: number): [number, number] => [C + (b - lng) * EARTH.mx(lat) * ppm, C - (a - lat) * EARTH.my * ppm] };
};

describe('地球的雷達上的中山公園（跟汪星共用一份）', () => {
  it('lets the radar zoom in to 0.5 m only around the park', () => {
    expect(nearPark(...hall)).toBe(true);
    expect(nearPark(...lake)).toBe(true);
    // 台北車站
    expect(nearPark(25.0478, 121.517)).toBe(false);
    expect(PARK_MIN_KM * 1000).toBeLessThan(1);
  });

  it('draws the same layers as on 汪星 at the same zoom', () => {
    // 汪星外圈 1 km 跟地球外圈 1 km 一樣每公尺 0.164 像素
    const [la, ln] = toWoof(hall);
    const woof = spaceMarkup({ center: { lat: 25.04, lng: 121.52 }, land: [], when: new Date('2026-10-28T08:00:00Z'), scaleKm: 1, rg: 164, view: { focus: 'woof', yaw: (-ln * Math.PI) / 180, pitch: (la * Math.PI) / 180 } });
    const layers = (m: string): string[] => [...m.matchAll(/class="(park-[^"]*)"/g)].map((x) => x[1]);
    expect(layers(at(1, hall))).toEqual(layers(woof));
    expect(layers(at(1, hall))).toEqual(['park-area', 'park-edge', 'park-lawn', 'park-pond', 'park-green', 'park-water', 'park-path street-minor', 'park-building']);
    // 拉近到銅像旁邊（25 公尺）：兩邊都有草和整座銅像
    const statue: [number, number] = [25.040048, 121.5594];
    const [sa, sn] = toWoof(statue);
    const near = spaceMarkup({ center: { lat: 25.04, lng: 121.52 }, land: [], when: new Date('2026-10-28T08:00:00Z'), scaleKm: 0.025, rg: 164, view: { focus: 'woof', yaw: (-sn * Math.PI) / 180, pitch: (sa * Math.PI) / 180 } });
    expect(layers(at(0.025, statue))).toEqual(layers(near));
    expect(layers(near)).toContain('park-grass');
    expect(near).toContain('class="statue-stone-front"');
  });

  it('shows the park only when it is on the radar', () => {
    expect(at(1, [25.0478, 121.517])).toBe('');
    // 18 km 內畫範圍，1.8 km 內才畫裡面的東西
    expect(at(18, hall)).toContain('class="park-area"');
    expect(at(18, hall)).not.toContain('park-building');
    expect(at(30, hall)).toBe('');
    for (const cls of ['park-edge', 'park-green', 'park-water', 'park-path street-minor', 'park-building']) expect(at(1, hall)).toMatch(new RegExp(`class="${cls}" d="M`));
  });

  it('draws 孫中山銅像 sitting just east of the middle lawn in the square plaza, level with its middle', () => {
    const statue: [number, number] = [25.040048, 121.5594];
    /** 銅像站的地方（畫面上）和放大幾倍（每公尺幾像素） */
    const place = (m: string): number[] => /class="park-statue" data-at="([-\d.]+) ([-\d.]+)"><circle class="statue-hit"[^>]*\/><g transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)"/.exec(m)!.slice(1).map(Number);
    // 照真的大小：拉遠到約 500 公尺外看不到，再近一點是一個點，拉近到約 28 公尺內才畫出整座銅像（每公尺幾像素就放大幾倍）
    expect(at(1, statue)).not.toContain('park-statue');
    expect(at(0.3, statue)).toMatch(/class="park-statue" data-at="200.0 200.0"><circle class="statue-dot" cx="200.0" cy="200.0" r="1.2" \/>/);
    expect(at(0.03, statue)).toMatch(/class="statue-dot"[^>]* r="4.0"/);
    const [ax, ay, x, y, k] = place(at(0.025, statue));
    expect([ax, ay, x, y]).toEqual([C, C, C, C]);
    expect(k).toBeCloseTo(INNER / 25, 2);
    expect(place(at(0.005, statue))[4]).toBeCloseTo(INNER / 5, 0);
    // 立體的人形：石頭台座三面、坐在椅子上的銅像；整座畫出來才點得到
    expect(at(0.03, statue)).not.toContain('statue-hit');
    for (const cls of ['statue-stone-front', 'statue-stone-top', 'statue-stone-side', 'statue-chair', 'statue-body', 'statue-arm', 'statue-hit']) expect(at(0.025, statue)).toContain(`class="${cls}`);
    // 廣場中間那塊草皮（約 8 公尺見方）的東邊外面 3 公尺內、南北對齊草皮的中間
    const g = parkGeom(EARTH);
    const mid = g.lawns.find((r) => r.length === 4 && r.some((p) => Math.abs(p[0] - statue[0]) < 0.0001 && Math.abs(p[1] - statue[1]) < 0.0001))!;
    const east = Math.max(...mid.map((p) => p[1]));
    const mx = EARTH.mx(statue[0]);
    expect((statue[1] - east) * mx).toBeGreaterThan(1);
    expect((statue[1] - east) * mx).toBeLessThan(3);
    expect(Math.abs(statue[0] - mid.reduce((s, p) => s + p[0], 0) / 4) * EARTH.my).toBeLessThan(0.5);
    // 拉近到別的地方、看不到就不畫
    expect(at(0.01, hall)).not.toContain('park-statue');
    expect(at(2, hall)).not.toContain('park-statue');
  });

  it('opens the middle lawn and launches a rocket when 孫中山銅像 is tapped (once at a time, picks up where it was when redrawn)', () => {
    const statue: [number, number] = [25.040048, 121.5594];
    const now = performance.now();
    expect(at(0.025, statue)).not.toContain('park-launch');
    expect(launchRocket(now - 2000)).toBe(true);
    // 還在播：再點不會重來
    expect(launchRocket(now)).toBe(false);
    const m = at(0.025, statue);
    const t = Number(/class="park-launch" style="--t:(-\d+)ms"/.exec(m)![1]);
    expect(t).toBeLessThanOrEqual(-2000);
    expect(t).toBeGreaterThan(-2500);
    for (const cls of ['launch-shaft', 'launch-door launch-door-w', 'launch-door launch-door-e', 'park-rocket', 'rocket-fly', 'rocket-rise', 'rocket-flame', 'rocket-smoke']) expect(m).toContain(`class="${cls}"`);
    // 火箭站在發射口（廣場中間那塊草皮）的正中間，往西 4.5 公尺左右；發射口在銅像左邊
    const [rx] = /class="park-rocket" data-at="([-\d.]+) ([-\d.]+)"/.exec(m)!.slice(1).map(Number);
    expect((C - rx) / (INNER / 25)).toBeGreaterThan(3.5);
    expect((C - rx) / (INNER / 25)).toBeLessThan(6);
    // 播完可以再點（這裡是在 LAUNCH_MS 之後才點的那一下，那個時間還沒到就不畫）
    expect(launchRocket(now + LAUNCH_MS)).toBe(true);
    expect(at(0.025, statue)).not.toContain('park-launch');
  });

  it('grows grass on the lawns and ripples on 映池 and 翠湖 (not on the islands)', () => {
    expect(count(at(1, lawn), 'park-grass')).toBe(0);
    for (const km of [0.3, 0.03, 0.003, PARK_MIN_KM]) {
      expect(count(at(km, lawn), 'park-grass')).toBeGreaterThan(40);
      expect(count(at(km, lawn), 'park-grass')).toBeLessThan(2500);
      expect(count(at(km, pond), 'park-ripple')).toBeGreaterThan(km === 0.3 ? 0 : 10);
    }
    expect(count(at(0.003, hall), 'park-grass')).toBe(0);
    expect(count(at(0.003, lake), 'park-ripple')).toBeGreaterThan(10);
    expect(count(at(0.003, island), 'park-ripple')).toBe(0);
    // 映池一圈、翠湖外框和 6 個小島
    expect(/class="park-pond" d="([^"]*)"/.exec(at(1, lake))![1].match(/M/g)).toHaveLength(8);
    expect(at(0.003, lawn)).toBe(at(0.003, lawn));
  });

  it('keeps lines inside the picture when zoomed in a lot', () => {
    const m = at(PARK_MIN_KM, [25.0400096, 121.5595]);
    for (const d of m.matchAll(/class="park-(?:edge|green|water|path street-minor|building)" d="([^"]*)"/g)) {
      for (const n of d[1].matchAll(/-?\d+\.\d/g)) expect(Math.abs(Number(n[0]))).toBeLessThan(500);
    }
    expect(m.length).toBeLessThan(60_000);
    expect(at(PARK_MIN_KM, lawn).length).toBeLessThan(100_000);
  });

  it('keeps every tuft in place while zooming in (only adds more)', () => {
    const g = parkGeom(EARTH);
    /** 草的根（離中心幾公尺，跟放大多少無關） */
    const roots = (km: number): Array<[number, number]> => {
      const c = earthCanvas(km, lawn);
      return [...parkTexture(g, 'grass', c)!.d.matchAll(/M(-?\d+) (-?\d+)/g)].map((m) => [(Number(m[1]) / 10 - C) / c.ppm, (C - Number(m[2]) / 10) / c.ppm]);
    };
    const far = roots(0.03);
    const near = roots(0.02);
    // 拉近後還在畫面裡的（離中心不到外圈的 0.6 倍）都還在原來的地方（同一叢的草根左右差一點點）
    const kept = far.filter(([x, y]) => Math.hypot(x, y) < 0.6 * 20);
    expect(kept.length).toBeGreaterThan(100);
    const tol = 3 / earthCanvas(0.03, lawn).ppm;
    expect(kept.filter(([x, y]) => near.some(([u, v]) => Math.abs(u - x) < tol && Math.abs(v - y) < tol))).toHaveLength(kept.length);
    expect(near.length).toBeGreaterThan(far.length * 0.9);
    // 水波跟草用不同的亂數：位置不會跟草一樣
    const c = earthCanvas(0.03, pond);
    expect(parkTexture(g, 'ripple', c)!.d.slice(0, 40)).not.toBe(parkTexture(g, 'grass', c)?.d.slice(0, 40));
  });
});
