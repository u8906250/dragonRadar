import { afterEach, describe, expect, it, vi } from 'vitest';
import { RADAR_GEOM } from '../src/radar';
import { ARRIVE_MS, arriveRocket, DEPART_MS, departRocket, DOG_H, dogNow, EARTH, earthParkSvg, HATCH_CENTER, moveDog, nearPark, petDog, PARK_MIN_KM, parkGeom, parkTexture, resetRocket, rocketNow, STOW_MS, stowRocket, SUMMON_MS, summonRocket } from '../src/park';
import { ZHONGSHAN_PARK } from '../src/zhongshan';
import { bodyBearing, spaceMarkup, toWoof, WOOF_KM } from '../src/space';

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
  // 火箭是 park.ts 裡的狀態：每個測試完都收掉（中途失敗也不會影響下一個）
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRocket();
  });

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

  it('puts a dog somewhere on a lawn, only on 汪星', () => {
    /** 汪星正中間轉到台北的這個地方、外圈 km 公里 */
    const woofAt = (km: number, p: [number, number]): string => {
      const [la, ln] = toWoof(p);
      return spaceMarkup({ center: { lat: 25.04, lng: 121.52 }, land: [], when: new Date('2026-10-28T08:00:00Z'), scaleKm: km, rg: 164, view: { focus: 'woof', yaw: (-ln * Math.PI) / 180, pitch: (la * Math.PI) / 180 } });
    };
    const inRing = ([y, x]: [number, number], r: Array<[number, number]>): boolean => r.reduce((on, [yi, xi], i) => {
      const [yj, xj] = r[(i + r.length - 1) % r.length];
      return yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi ? !on : on;
    }, false);
    // 每次抽到的地方都在某一塊草皮裡面，不在發射口（約 8 公尺見方）和銅像旁邊；面向左右都有
    let seed = 7;
    const rand = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const spots = Array.from({ length: 200 }, () => moveDog(rand));
    for (const { at } of spots) {
      expect(ZHONGSHAN_PARK.green.some((r) => inRing(at, r))).toBe(true);
      expect(Math.hypot((at[0] - HATCH_CENTER[0]) * EARTH.my, (at[1] - HATCH_CENTER[1]) * EARTH.mx(at[0]))).toBeGreaterThan(6);
    }
    expect(new Set(spots.map((d) => d.left))).toEqual(new Set([true, false]));
    // 散在很多塊草皮上
    expect(new Set(spots.map(({ at }) => ZHONGSHAN_PARK.green.findIndex((r) => inRing(at, r)))).size).toBeGreaterThan(15);
    // 坐著的銅像腳（腳底到膝蓋約 0.72 公尺）的一半高
    expect(DOG_H).toBeCloseTo(0.36, 2);
    const dog = dogNow().at;
    // 地球的雷達上沒有
    expect(at(0.005, dog)).not.toContain('woof-dog');
    // 汪星：拉遠到約 500 公尺外看不到，再近是一個點，拉近到約 6 公尺內畫出整隻（照真的大小）、點得到
    expect(woofAt(1, dog)).not.toContain('woof-dog');
    expect(woofAt(0.3, dog)).toMatch(/class="woof-dog \w+" style="--t:-?\d+ms;--ms:\d+ms[^"]*"><g class="dog-go"><circle class="dog-dot"/);
    expect(woofAt(0.008, dog)).toContain('dog-dot');
    const full = woofAt(0.005, dog);
    for (const cls of ['dog-fur', 'dog-far', 'dog-ear', 'dog-nose', 'dog-eye', 'dog-hit']) expect(full).toContain(`class="${cls}"`);
    // 白色的馬爾濟斯：脖子上不戴東西
    expect(full).not.toMatch(/scarf|collar/);
    const [, ax, ay, kx, ky] = /<g data-at="([\d.]+) ([\d.]+)"><circle class="dog-hit"[^>]*\/><g transform="translate\([\d.]+ [\d.]+\) scale\(([-\d.]+) ([\d.]+)\)"/.exec(full)!.map(Number);
    expect(Math.hypot(ax - C, ay - C)).toBeLessThan(2);
    expect(Math.abs(kx)).toBeCloseTo(ky);
    expect(kx < 0).toBe(dogNow().left);
    // 在畫面外面就不畫
    expect(woofAt(0.005, hall)).not.toContain('woof-dog');
  });

  it('lets the dog walk, run, stop, sniff and sit on its lawn, and hop and bark when tapped', () => {
    const inRing = ([y, x]: [number, number], r: Array<[number, number]>): boolean => r.reduce((on, [yi, xi], i) => {
      const [yj, xj] = r[(i + r.length - 1) % r.length];
      return yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi ? !on : on;
    }, false);
    let seed = 11;
    const rand = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    // 先畫過汪星（小狗走在汪星上，走多遠照汪星的公尺算），再從頭開始
    const [la, ln] = toWoof(hall);
    spaceMarkup({ center: { lat: 25.04, lng: 121.52 }, land: [], when: new Date('2026-10-28T08:00:00Z'), scaleKm: 0.3, rg: 164, view: { focus: 'woof', yaw: (-ln * Math.PI) / 180, pitch: (la * Math.PI) / 180 } });
    moveDog(rand, 0);
    // 十分鐘，每半秒看一次：每一段都在一開始那塊草皮裡，一段接一段（沒有跳）
    const segs = new Map<number, ReturnType<typeof dogNow>['seg']>();
    for (let t = 0; t <= 600_000; t += 500) {
      const d = dogNow(t, rand);
      segs.set(d.seg.start, d.seg);
    }
    const list = [...segs.values()].sort((a, b) => a.start - b.start);
    const ring = ZHONGSHAN_PARK.green[list[0].ring];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      expect(s.ring).toBe(list[0].ring);
      expect(inRing(s.to, ring)).toBe(true);
      if (i > 0) {
        expect(s.start).toBeCloseTo(list[i - 1].start + list[i - 1].ms, 6);
        expect(s.from).toEqual(list[i - 1].to);
      }
      // 停著的不動；走的、跑的照速度（汪星上的公尺／秒）
      if (s.do === 'walk' || s.do === 'run') {
        const [p, q] = [toWoof(s.from), toWoof(s.to)];
        const my = (WOOF_KM * 1000 * Math.PI) / 180;
        const m = Math.hypot((q[0] - p[0]) * my, (q[1] - p[1]) * my * Math.cos((p[0] * Math.PI) / 180));
        expect(m / (s.ms / 1000)).toBeCloseTo(s.do === 'walk' ? 0.5 : 2.4, 1);
      } else expect(s.to).toEqual(s.from);
    }
    expect(new Set(list.map((s) => s.do))).toEqual(new Set(['stand', 'sniff', 'sit', 'walk', 'run']));
    // 點了：停在原地跳兩下、叫「汪！」，接著跑開
    const before = dogNow(600_200, rand);
    petDog(600_200);
    const happy = dogNow(600_300, rand);
    expect(happy.seg.do).toBe('happy');
    expect(happy.at).toEqual(before.at);
    expect(dogNow(600_200 + 1700, rand).seg.do).toBe('run');
  });

  it('summons the rocket stored under the middle lawn, parks it, flies it to 汪星 and stores it there', () => {
    const statue: [number, number] = [25.040048, 121.5594];
    const now = performance.now();
    // 一開始收在地球的發射口底下：看不到；汪星的銅像叫不出來
    expect(rocketNow()).toMatchObject({ world: 'earth', phase: 'stored' });
    expect(at(0.025, statue)).not.toContain('park-launch');
    expect(summonRocket('woof', now)).toBe(false);
    // 點地球的銅像：發射口打開（兩片門帶著草滑開）、火箭升上來；播完前再點不算
    expect(summonRocket('earth', now - 1000)).toBe(true);
    expect(summonRocket('earth', now)).toBe(false);
    const m = at(0.025, statue);
    const t = Number(/class="park-launch summon" style="--t:(-\d+)ms"/.exec(m)![1]);
    // 已經過了 1 秒多（測試跑得慢也還在播：門要 5 秒才關上）
    expect(t).toBeLessThanOrEqual(-1000);
    expect(t).toBeGreaterThan(-1000 - SUMMON_MS / 2);
    for (const cls of ['launch-shaft', 'launch-door', 'door-top', 'park-rocket', 'rocket-rise']) expect(m).toContain(`class="${cls}"`);
    expect(m).not.toContain('rocket-hit');
    // 門上的草：跟草地上同一叢一叢（只長發射口那一塊），兩片門各一份
    const tufts = (d: string): string[] => d.match(/M-?\d+ -?\d+/g) ?? [];
    const lawnGrass = tufts(/class="park-grass"[^>]* d="([^"]*)"/.exec(m)![1]);
    const doors = [...m.matchAll(/class="launch-door"[\s\S]*?class="park-grass"[^>]* d="([^"]*)"/g)].map((x) => tufts(x[1]));
    expect(doors).toHaveLength(2);
    expect(doors[0].length).toBeGreaterThan(3);
    expect(doors[0].every((p) => lawnGrass.includes(p))).toBe(true);
    // 火箭站在發射口的正中間（銅像西邊約 5 公尺）
    const [rx] = /class="park-rocket" data-at="([-\d.]+) ([-\d.]+)"/.exec(m)!.slice(1).map(Number);
    expect((C - rx) / (INNER / 25)).toBeGreaterThan(3.5);
    expect((C - rx) / (INNER / 25)).toBeLessThan(6.5);
    // 門關上後停著：點得到火箭，沒有井和門
    expect(rocketNow(now - 1000 + SUMMON_MS + 1).phase).toBe('parked');
    resetRocket();
    summonRocket('earth', now - SUMMON_MS - 1);
    const parked = at(0.025, statue);
    expect(parked).toContain('class="park-launch parked"');
    expect(parked).toContain('class="rocket-hit"');
    expect(parked).not.toContain('launch-shaft');
    // 停著時再點銅像：門打開、火箭降回井裡、門關上（汪星那邊的銅像沒反應）
    expect(stowRocket('woof', now)).toBe(false);
    const ts = performance.now();
    expect(stowRocket('earth', ts)).toBe(true);
    const stowing = at(0.025, statue);
    for (const cls of ['park-launch stow', 'launch-shaft', 'launch-door', 'rocket-rise']) expect(stowing).toContain(`class="${cls}"`);
    expect(stowing).not.toContain('rocket-hit');
    expect(rocketNow(ts + STOW_MS + 1).phase).toBe('stored');
    // 再叫出來、停好
    resetRocket();
    summonRocket('earth', now - SUMMON_MS - 1);
    // 飛走：點火、飛出畫面，之後不畫（每一段都用當下的時間：測試跑得慢也還在播；播完的時間多 1 毫秒，小數相減差一點點）
    const t1 = performance.now();
    expect(departRocket(t1)).toBe('woof');
    expect(departRocket(t1)).toBe(null);
    expect(at(0.025, statue)).toContain('class="park-launch depart"');
    expect(rocketNow(t1 + DEPART_MS + 1).phase).toBe('away');
    // 汪星上同一個地方：門打開、降進井裡、門關上，收在汪星；地球上沒有、地球的銅像叫不出來
    const t2 = performance.now();
    arriveRocket('woof', t2);
    expect(at(0.025, statue)).not.toContain('park-rocket');
    const [la, ln] = toWoof(HATCH_CENTER);
    const woof = (): string => spaceMarkup({ center: { lat: 25.04, lng: 121.52 }, land: [], when: new Date('2026-10-28T08:00:00Z'), scaleKm: 0.025, rg: 164, view: { focus: 'woof', yaw: (-ln * Math.PI) / 180, pitch: (la * Math.PI) / 180 } });
    const arriving = woof();
    expect(arriving).toContain('class="park-launch arrive"');
    expect(arriving).toContain('class="launch-door"');
    expect(/class="park-rocket" data-at="([-\d.]+) ([-\d.]+)"/.exec(arriving)!.slice(1).map(Number)).toEqual([C, C]);
    expect(rocketNow(t2 + ARRIVE_MS + 1)).toMatchObject({ world: 'woof', phase: 'stored' });
    expect(summonRocket('earth', t2 + ARRIVE_MS + 1)).toBe(false);
    expect(summonRocket('woof', t2 + ARRIVE_MS + 1)).toBe(true);
  });

  it('remembers which side the rocket is on (and whether it is out) across reloads', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    resetRocket();
    expect(rocketNow()).toMatchObject({ world: 'earth', phase: 'stored' });
    const now = performance.now();
    summonRocket('earth', now - SUMMON_MS - 1);
    expect(JSON.parse(store.get('dr.rocket')!)).toEqual({ world: 'earth', parked: true });
    // 重新整理：停在地球的草皮上
    resetRocket();
    expect(rocketNow()).toMatchObject({ world: 'earth', phase: 'parked' });
    // 一起飛就記成收在汪星（飛到一半重新整理，火箭就在汪星）
    departRocket(now);
    resetRocket();
    expect(rocketNow()).toMatchObject({ world: 'woof', phase: 'stored' });
    // 存的東西壞掉：從地球開始
    store.set('dr.rocket', '{oops');
    resetRocket();
    expect(rocketNow()).toMatchObject({ world: 'earth', phase: 'stored' });
  });

  it('moves the camera from Earth to 汪星 while the rocket flies (no jump at either end)', () => {
    const when = new Date('2026-10-28T08:00:00Z');
    const far = (view: { focus: string | null; yaw: number; pitch: number; toward?: string; u?: number }): string => spaceMarkup({ center: { lat: 25.04, lng: 121.52 }, land: [], when, scaleKm: 4e8, rg: 164, view });
    /** 這顆星球在畫面上的位置（點的那一圈的圓心） */
    const body = (m: string, key: string): number[] => {
      const r = new RegExp(`data-body="${key}"><circle class="hit" cx="([-\\d.]+)" cy="([-\\d.]+)"`).exec(m);
      return r ? r.slice(1).map(Number) : [];
    };
    // 中心是地球（地球不畫成可以點的星球）：汪星、火星在哪
    const start = far({ focus: null, yaw: 0, pitch: 0 });
    const [wx, wy] = body(start, 'woof');
    const mars = body(start, 'mars');
    expect(Math.hypot(wx - C, wy - C)).toBeGreaterThan(10);
    // 火箭的頭朝汪星（畫面上汪星的方向，順時針、0 是上）
    const a = (Math.atan2(wx - C, C - wy) * 180) / Math.PI;
    expect(Math.abs(((a - bodyBearing('earth', 'woof', when) + 540) % 360) - 180)).toBeLessThan(1);
    // 鏡頭移到一半：汪星離中心剩一半；移到底跟中心換成汪星一樣
    const half = body(far({ focus: null, yaw: 0, pitch: 0, toward: 'woof', u: 0.5 }), 'woof');
    expect(half[0] - C).toBeCloseTo((wx - C) / 2, 0);
    expect(half[1] - C).toBeCloseTo((wy - C) / 2, 0);
    const end = far({ focus: null, yaw: 0, pitch: 0, toward: 'woof', u: 1 });
    expect(body(end, 'woof')).toEqual([C, C]);
    expect(body(end, 'mars')).toEqual(body(far({ focus: 'woof', yaw: 0, pitch: 0 }), 'mars'));
    // 回地球：從汪星往地球移到底，跟中心是地球一樣
    const back = far({ focus: 'woof', yaw: 0, pitch: 0, toward: 'earth', u: 1 });
    expect(body(back, 'woof')).toEqual([wx, wy]);
    expect(body(back, 'mars')).toEqual(mars);
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
