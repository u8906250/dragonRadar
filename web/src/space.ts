/**
 * 雷達從「全球」再拉遠就是太空（第一次用到才載入）：跟雷達平常一樣用虛線畫，畫成 SVG 字串放在海岸線那一層。
 * - 地球：以你為中心、從太空看的地球（正射投影），海岸線、經緯線，夜晚的那一半照現在時間淡淡變暗
 * - 再拉遠：月球的軌道和月球，太陽、行星和它們的軌道（以地球為中心，距離照真實比例，位置照今天推算）
 */
import type { LatLng } from './geo';
import { RADAR_GEOM, TINY_EARTH } from './radar';
import { TAIPEI_DISTRICT_LINES, TAIPEI_DISTRICTS, TAIPEI_MAJOR_ROADS, TAIPEI_MINOR_ROADS, TAIPEI_OUTLINE } from './taipei';

const { c: C, inner: INNER } = RADAR_GEOM;
const RAD = Math.PI / 180;
const AU_KM = 149_597_870.7;
/** 月球平均距離（公里） */
const MOON_KM = 384_400;
const norm360 = (d: number): number => ((d % 360) + 360) % 360;
const norm180 = (d: number): number => norm360(d + 180) - 180;
const f1 = (n: number): string => n.toFixed(1);

/** 從 J2000.0 起算的天數 */
const daysJ2000 = (at: Date): number => at.getTime() / 86_400_000 + 2440587.5 - 2451545.0;

/** 太陽直射點的緯度、經度，和太陽的黃經（簡化公式，誤差不到 1 度） */
export function subsolar(at: Date): { lat: number; lng: number; eclLon: number } {
  const n = daysJ2000(at);
  const L = 280.46 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * RAD;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  // 太陽在頭頂：當地恆星時等於太陽的赤經
  const gmst = 280.46061837 + 360.98564736629 * n;
  return { lat: dec / RAD, lng: norm180(ra / RAD - gmst), eclLon: norm360(lam / RAD) };
}

/** 月球的黃經（度）、離地球多遠（公里）：簡化公式，誤差約 1、2 度 */
export function moonPosition(at: Date): { lon: number; lat: number; dist: number } {
  const d = daysJ2000(at);
  const L = 218.316 + 13.176396 * d;
  const M = (134.963 + 13.064993 * d) * RAD;
  const F = (93.272 + 13.22935 * d) * RAD;
  return { lon: norm360(L + 6.289 * Math.sin(M)), lat: 5.128 * Math.sin(F), dist: 385_001 - 20_905 * Math.cos(M) };
}

type Vec3 = [number, number, number];

/** 月球的軌道：繞地球一圈（平均距離），跟黃道面斜 5.1 度，升交點每天往回移一點 */
function moonOrbit(at: Date): Vec3[] {
  const node = (125.04 - 0.052954 * daysJ2000(at)) * RAD;
  const inc = 5.145 * RAD;
  const out: Vec3[] = [];
  for (let i = 0; i < 96; i++) {
    const u = (i / 96) * 2 * Math.PI;
    const x1 = MOON_KM * Math.cos(u);
    const y1 = MOON_KM * Math.sin(u) * Math.cos(inc);
    out.push([x1 * Math.cos(node) - y1 * Math.sin(node), x1 * Math.sin(node) + y1 * Math.cos(node), MOON_KM * Math.sin(u) * Math.sin(inc)]);
  }
  return out;
}

/** 經緯度 → 以 center 為中心的正射投影：x 往東、y 往北（地球半徑 = 1），z > 0 是看得到的這一面 */
export function ortho(center: LatLng, lat: number, lng: number): [number, number, number] {
  const p0 = center.lat * RAD;
  const p = lat * RAD;
  const dl = (lng - center.lng) * RAD;
  const cp = Math.cos(p);
  return [cp * Math.sin(dl), Math.cos(p0) * Math.sin(p) - Math.sin(p0) * cp * Math.cos(dl), Math.sin(p0) * Math.sin(p) + Math.cos(p0) * cp * Math.cos(dl)];
}

/** 地球上的點（半徑 1）→ SVG 座標，rg 是地球在雷達上的半徑 */
const at = (x: number, y: number, rg: number): string => `${f1(C + rg * x)} ${f1(C - rg * y)}`;

/**
 * 陸地（跟「全球」一樣淡淡填色、虛線海岸）：在另一面的那一段換成沿著地球邊緣走，從海岸線轉到另一面的方向走到轉回來的方向，走不到半圈的那一邊
 * （南美洲這種繞過正對面的，沿著每個點的方向走會繞地球一整圈，把整個地球塗滿）；整塊在另一面的不畫
 */
export function landPath(center: LatLng, rings: Array<Array<[number, number]>>, rg: number): string {
  let d = '';
  for (const ring of rings) {
    const pts = ring.map(([lat, lng]) => ortho(center, lat, lng));
    const start = pts.findIndex((p) => p[2] > 0);
    if (start < 0) continue;
    let seg = '';
    let from: number | null = null;
    let to = 0;
    const edge = (): void => {
      if (from === null) return;
      const delta = norm180((to - from) / RAD) * RAD;
      const steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.05));
      for (let k = 0; k <= steps; k++) {
        const a = from + (delta * k) / steps;
        seg += `L${at(Math.cos(a), Math.sin(a), rg)}`;
      }
      from = null;
    };
    // 從看得到的點開始繞一圈（另一面的那一段才會連在一起）
    for (let i = 0; i < pts.length; i++) {
      const [x, y, z] = pts[(start + i) % pts.length];
      if (z <= 0) {
        const ang = Math.atan2(y, x);
        if (from === null) from = ang;
        to = ang;
        continue;
      }
      edge();
      seg += `${seg ? 'L' : 'M'}${at(x, y, rg)}`;
    }
    edge();
    d += `${seg}Z`;
  }
  return d;
}

/** 線（每條是一串「緯度, 經度」）看得到這一面的部分，轉到另一面就斷開 */
function linesPath(center: LatLng, lines: Array<Array<[number, number]>>, rg: number): string {
  let d = '';
  for (const pts of lines) {
    let pen = false;
    for (const [lat, lng] of pts) {
      const [x, y, z] = ortho(center, lat, lng);
      if (z <= 0) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${at(x, y, rg)}`;
      pen = true;
    }
  }
  return d;
}

/** 經緯線：每 30 度一條，另一面的不畫 */
function graticule(center: LatLng, rg: number): string {
  const lines: Array<Array<[number, number]>> = [];
  const steps = (from: number, to: number, step: number): number[] => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
  for (let lng = -180; lng < 180; lng += 30) lines.push(steps(-90, 90, 3).map((lat) => [lat, lng]));
  for (let lat = -60; lat <= 60; lat += 30) lines.push(steps(-180, 180, 3).map((lng) => [lat, lng]));
  return linesPath(center, lines, rg);
}

/**
 * 夜晚的那一半：晨昏線（離太陽直射點 90 度的大圓）在看得到這一面的那一段，接上地球邊緣在夜晚那邊的半圈。
 * u、w 是晨昏線所在平面的兩個方向，u 在地球邊緣上（z = 0），所以晨昏線從 u 走到 -u
 */
export function nightPath(center: LatLng, sun: { lat: number; lng: number }, rg: number): string {
  return nightFrom(ortho(center, sun.lat, sun.lng), rg);
}

/** 夜晚的那一半：s 是太陽的方向（看的人的座標，長度 1：x 往右、y 往上、z 朝看的人） */
function nightFrom(s: Vec3, rg: number): string {
  if (s[2] > 0.9999) return '';
  if (s[2] < -0.9999) return `M${at(1, 0, rg)}A${rg} ${rg} 0 1 0 ${at(-1, 0, rg)}A${rg} ${rg} 0 1 0 ${at(1, 0, rg)}Z`;
  const h = Math.hypot(s[0], s[1]);
  const u = [s[1] / h, -s[0] / h, 0];
  const w = [s[1] * u[2] - s[2] * u[1], s[2] * u[0] - s[0] * u[2], s[0] * u[1] - s[1] * u[0]];
  const sign = w[2] >= 0 ? 1 : -1;
  let d = `M${at(u[0], u[1], rg)}`;
  for (let i = 1; i <= 64; i++) {
    const t = (sign * Math.PI * i) / 64;
    d += `L${at(Math.cos(t) * u[0] + Math.sin(t) * w[0], Math.cos(t) * u[1] + Math.sin(t) * w[1], rg)}`;
  }
  // 從 -u 沿著邊緣回到 u，走夜晚那邊（邊緣上背對太陽的那半圈，中點在 -(sx, sy) 的方向）
  const a0 = Math.atan2(-u[1], -u[0]);
  const mid = a0 + Math.PI / 2;
  const dir = Math.cos(mid) * s[0] + Math.sin(mid) * s[1] < 0 ? 1 : -1;
  for (let i = 1; i <= 64; i++) {
    const a = a0 + (dir * Math.PI * i) / 64;
    d += `L${at(Math.cos(a), Math.sin(a), rg)}`;
  }
  return `${d}Z`;
}

/**
 * 行星軌道根數（JPL「Approximate Positions of the Planets」表 1，1800–2050 年適用）：
 * a（AU）、e、I、L、近日點經度 ϖ、升交點經度 Ω，各自的每世紀變化。地球用地月質心
 */
type Elements = [number, number, number, number, number, number, number, number, number, number, number, number];
const PLANETS: Array<{ key: string; name: string; el: Elements }> = [
  { key: 'mercury', name: '水星', el: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.2503235, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081] },
  { key: 'venus', name: '金星', el: [0.72333566, 0.0000039, 0.00677672, -0.00004107, 3.39467605, -0.0007889, 181.9790995, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418] },
  { key: 'earth', name: '地球', el: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0, 0] },
  // 汪星：不是真的行星，放在地球和火星之間（1.26 AU，照克卜勒定律約 1.4 年繞一圈）
  { key: 'woof', name: '汪星', el: [1.26, 0, 0.03, 0, 1.2, 0, 140, 25453, 60, 0, 80, 0] },
  { key: 'mars', name: '火星', el: [1.52371034, 0.00001847, 0.0933941, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343] },
  { key: 'jupiter', name: '木星', el: [5.202887, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106] },
  { key: 'saturn', name: '土星', el: [9.53667594, -0.0012506, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794] },
  { key: 'uranus', name: '天王星', el: [19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939, 313.23810451, 428.48202785, 170.9542763, 0.40805281, 74.01692503, 0.04240589] },
  { key: 'neptune', name: '海王星', el: [30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372, -55.12002969, 218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664] },
];

/** 軌道根數換成這一刻的形狀：半長軸、離心率、平近點角，和軌道面轉到黃道座標的係數 */
function orbitOf(el: Elements, T: number) {
  const [a0, da, e0, de, i0, di, l0, dl, w0, dw, o0, dO] = el;
  const a = a0 + da * T;
  const e = e0 + de * T;
  const inc = (i0 + di * T) * RAD;
  const wbar = w0 + dw * T;
  const node = o0 + dO * T;
  const omega = (wbar - node) * RAD;
  const om = node * RAD;
  const [co, so, cO, sO, ci, si] = [Math.cos(omega), Math.sin(omega), Math.cos(om), Math.sin(om), Math.cos(inc), Math.sin(inc)];
  /** 偏近點角 E 的位置（日心黃道座標，AU） */
  const at = (E: number): Vec3 => {
    const xp = a * (Math.cos(E) - e);
    const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    return [(co * cO - so * sO * ci) * xp + (-so * cO - co * sO * ci) * yp, (co * sO + so * cO * ci) * xp + (-so * sO + co * cO * ci) * yp, so * si * xp + co * si * yp];
  };
  return { a, e, M: norm180(l0 + dl * T - wbar) * RAD, at };
}

/** 一顆行星的日心位置（AU）：解克卜勒方程式；a 是軌道半長軸 */
function helio(el: Elements, T: number): { x: number; y: number; z: number; a: number } {
  const o = orbitOf(el, T);
  let E = o.M + o.e * Math.sin(o.M);
  for (let i = 0; i < 8; i++) E -= (E - o.e * Math.sin(E) - o.M) / (1 - o.e * Math.cos(E));
  const [x, y, z] = o.at(E);
  return { x, y, z, a: o.a };
}

/** 行星（八大行星加汪星）現在的日心黃經、離太陽多遠（AU），和日心位置 */
export function planetPositions(when: Date): Array<{ key: string; name: string; lon: number; dist: number; x: number; y: number; z: number; a: number }> {
  const T = daysJ2000(when) / 36525;
  return PLANETS.map((p) => {
    const h = helio(p.el, T);
    return { key: p.key, name: p.name, lon: norm360(Math.atan2(h.y, h.x) / RAD), dist: Math.hypot(h.x, h.y), ...h };
  });
}

/**
 * 汪星的地表是台北市：市界的範圍攤開包住整顆汪星（緯度 ±80 度、經度 ±172 度，像把平面地圖貼到地球儀上，東西向拉寬了），
 * 市界外面是海，南北極和背面接縫的地方也是海
 */
const TP = {
  lat0: Math.min(...TAIPEI_OUTLINE.map((p) => p[0])),
  lat1: Math.max(...TAIPEI_OUTLINE.map((p) => p[0])),
  lng0: Math.min(...TAIPEI_OUTLINE.map((p) => p[1])),
  lng1: Math.max(...TAIPEI_OUTLINE.map((p) => p[1])),
};
/** 台北市的經緯度 → 汪星的經緯度 */
export const toWoof = ([lat, lng]: [number, number]): [number, number] => [
  -80 + (160 * (lat - TP.lat0)) / (TP.lat1 - TP.lat0),
  -172 + (344 * (lng - TP.lng0)) / (TP.lng1 - TP.lng0),
];

/** 每段切到 2 度以內（轉到另一面的地方才算得準）；closed 是一圈，最後一點接回第一點 */
function densify(pts: Array<[number, number]>, closed = false): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    const k = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / 2));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed) out.push(pts[pts.length - 1]);
  return out;
}

/** 平面上的有向面積（x 經度、y 緯度）：正的是逆時針 */
const ringArea = (r: Array<[number, number]>): number => r.reduce((s, p, i) => s + p[1] * r[(i + 1) % r.length][0] - r[(i + 1) % r.length][1] * p[0], 0) / 2;

/** 汪星的陸地（市界）：逆時針，陸地在海岸線的左手邊 */
export const WOOF_LAND: Array<Array<[number, number]>> = [TAIPEI_OUTLINE].map((r) => {
  const ring = densify(r.map(toWoof), true);
  return ringArea(ring) < 0 ? ring.reverse() : ring;
});
const woofLines = (lines: Array<Array<[number, number]>>): Array<Array<[number, number]>> => lines.map((l) => densify(l.map(toWoof)));
const WOOF_DISTRICT_LINES = woofLines(TAIPEI_DISTRICT_LINES);
const WOOF_MAJOR_ROADS = woofLines(TAIPEI_MAJOR_ROADS);
const WOOF_MINOR_ROADS = woofLines(TAIPEI_MINOR_ROADS);
const WOOF_NAMES = TAIPEI_DISTRICTS.map((d) => ({ name: d.name, at: toWoof(d.at) }));

/** 汪星上這個地方是不是陸地（陸地不會跨過南北極和背面的接縫，所以照平面的經緯度算就好） */
export function onWoofLand(lat: number, lng: number): boolean {
  let inside = false;
  for (const ring of WOOF_LAND) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ya, xa] = ring[i];
      const [yb, xb] = ring[j];
      if (ya > lat !== yb > lat && lng < xa + ((lat - ya) * (xb - xa)) / (yb - ya)) inside = !inside;
    }
  }
  return inside;
}

/**
 * 陸地在看得到這一面的部分（ring 要逆時針）：海岸線轉到另一面的地方沿著球的邊緣走，從轉過去的地方逆時針走到下一個轉回來的地方
 * （陸地在海岸線的左手邊，往外走的左手邊就是邊緣的逆時針方向）；整圈都在另一面的，正中間在陸地上（centerOnLand）就整面都是陸地。
 * 陸地比半個球大也畫得對（landPath 是走不到半圈的那邊，只適合地球的大陸）
 */
export function hemiPath(center: LatLng, ring: Array<[number, number]>, rg: number, centerOnLand: boolean): string {
  const pts = ring.map(([lat, lng]) => ortho(center, lat, lng));
  const n = pts.length;
  const start = pts.findIndex((p) => p[2] > 0);
  if (start < 0) return centerOnLand ? `M${at(1, 0, rg)}A${rg} ${rg} 0 1 0 ${at(-1, 0, rg)}A${rg} ${rg} 0 1 0 ${at(1, 0, rg)}Z` : '';
  /** 海岸線和邊緣的交點（邊緣上的角度） */
  const cross = (a: Vec3, b: Vec3): number => {
    const t = a[2] / (a[2] - b[2]);
    return Math.atan2(a[1] + t * (b[1] - a[1]), a[0] + t * (b[0] - a[0]));
  };
  // 看得到的一段段海岸線：from 是從邊緣轉回來的角度、to 是轉過去的角度
  type Piece = { d: string[]; from: number; to: number };
  const pieces: Piece[] = [];
  let cur: Piece | null = { d: [], from: NaN, to: NaN };
  for (let i = 0; i < n; i++) {
    const a = pts[(start + i) % n];
    const b = pts[(start + i + 1) % n];
    if (a[2] > 0) {
      cur!.d.push(at(a[0], a[1], rg));
      if (b[2] <= 0) {
        cur!.to = cross(a, b);
        cur!.d.push(at(Math.cos(cur!.to), Math.sin(cur!.to), rg));
        pieces.push(cur!);
        cur = null;
      }
    } else if (b[2] > 0) {
      const from = cross(a, b);
      cur = { d: [at(Math.cos(from), Math.sin(from), rg)], from, to: NaN };
    }
  }
  // 整圈都看得到
  if (pieces.length === 0) return `M${cur!.d.join('L')}Z`;
  // 從看得到的點開始繞，最後一段（轉回來之後）接上第一段
  if (cur) {
    pieces[0].d = [...cur.d, ...pieces[0].d];
    pieces[0].from = cur.from;
  }
  const TAU = 2 * Math.PI;
  let d = '';
  const used = new Set<number>();
  for (let first = 0; first < pieces.length; first++) {
    if (used.has(first)) continue;
    let i = first;
    d += `M${pieces[i].d.join('L')}`;
    used.add(i);
    for (;;) {
      // 沿著邊緣逆時針走到最近的轉回來的地方
      const to = pieces[i].to;
      let next = first;
      let best = Infinity;
      pieces.forEach((p, j) => {
        const delta = (((p.from - to) % TAU) + TAU) % TAU;
        if (delta < best) [best, next] = [delta, j];
      });
      const steps = Math.ceil(best / 0.05);
      for (let k = 1; k < steps; k++) d += `L${at(Math.cos(to + (best * k) / steps), Math.sin(to + (best * k) / steps), rg)}`;
      if (next === first || used.has(next)) break;
      i = next;
      used.add(i);
      d += `L${pieces[i].d.join('L')}`;
    }
    d += 'Z';
  }
  return d;
}

/** 一顆行星的整圈軌道（日心，AU） */
function orbitPath(key: string, when: Date): Vec3[] {
  const o = orbitOf(PLANETS.find((p) => p.key === key)!.el, daysJ2000(when) / 36525);
  return Array.from({ length: 128 }, (_, i) => o.at((i / 128) * 2 * Math.PI));
}

/** 雷達上的一個天體：圓點和名字（名字疊到別的就換位置，都疊到就不寫） */
interface Body {
  x: number;
  y: number;
  r: number;
  cls: string;
  name: string;
  /** 一定要寫名字（視野移開時的地球：你在哪裡），都疊到就放在下面 */
  force?: boolean;
}

/** 名字先放下面，疊到別的名字、天體就換上面、右邊、左邊 */
function labels(bodies: Body[]): string {
  const boxes: Array<[number, number, number, number]> = bodies.map((b) => [b.x - b.r, b.y - b.r, b.x + b.r, b.y + b.r]);
  const hit = (b: [number, number, number, number], own: number): boolean => boxes.some((o, j) => j !== own && b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  let out = '';
  bodies.forEach((b, i) => {
    const w = [...b.name].length * 11;
    const options: Array<{ box: [number, number, number, number]; tx: number; ty: number; anchor: string }> = [
      { box: [b.x - w / 2, b.y + b.r + 2, b.x + w / 2, b.y + b.r + 15], tx: b.x, ty: b.y + b.r + 13, anchor: 'middle' },
      { box: [b.x - w / 2, b.y - b.r - 15, b.x + w / 2, b.y - b.r - 2], tx: b.x, ty: b.y - b.r - 4, anchor: 'middle' },
      { box: [b.x + b.r + 3, b.y - 7, b.x + b.r + 3 + w, b.y + 6], tx: b.x + b.r + 3, ty: b.y + 4, anchor: 'start' },
      { box: [b.x - b.r - 3 - w, b.y - 7, b.x - b.r - 3, b.y + 6], tx: b.x - b.r - 3, ty: b.y + 4, anchor: 'end' },
    ];
    const pick = options.find((o) => !hit(o.box, i)) ?? (b.force ? options[0] : undefined);
    if (!pick) return;
    boxes.push(pick.box);
    out += `<text class="space-label" x="${f1(pick.tx)}" y="${f1(pick.ty)}" text-anchor="${pick.anchor}">${b.name}</text>`;
  });
  return out;
}

/** 天體的真實半徑（公里）、拉遠時最小畫多大（SVG 單位），淡淡的顏色（線條跟雷達一樣，顏色只是讓人認得出來） */
const LOOKS: Record<string, { km: number; min: number; tint: string }> = {
  sun: { km: 696_340, min: 6, tint: '' },
  mercury: { km: 2_440, min: 2.6, tint: '#a39e96' },
  venus: { km: 6_052, min: 3.4, tint: '#dcbf78' },
  earth: { km: 6_371, min: 3.6, tint: '#5b95d6' },
  moon: { km: 1_737, min: 2.2, tint: '#b3afa7' },
  woof: { km: 4_800, min: 3.2, tint: '#c98f55' },
  mars: { km: 3_390, min: 3, tint: '#cf6c40' },
  jupiter: { km: 69_911, min: 6, tint: '#cfa77d' },
  saturn: { km: 58_232, min: 5, tint: '#ddc88e' },
  uranus: { km: 25_362, min: 4.2, tint: '#86cbd2' },
  neptune: { km: 24_622, min: 4.2, tint: '#5876d6' },
};

/** 天體的真實半徑（公里）：中心換到這顆時，最多放大到剛好看得到整顆 */
export const bodyRadiusKm = (key: string): number => LOOKS[key]?.km ?? 0;

/** 圓裡面一條水平的弦（木星的條紋）：離圓心 dy，畫在圓裡面那一段 */
function chord(x: number, y: number, r: number, dy: number): string {
  const w = Math.sqrt(Math.max(0, r * r - dy * dy));
  return `M${f1(x - w)} ${f1(y + dy)}L${f1(x + w)} ${f1(y + dy)}`;
}

/**
 * 一顆星球：照真實大小畫（太小就畫最小的大小），背對太陽的那一半變暗；
 * 太陽有光芒、土星有環（後半圈被星球擋住）、天王星的環是直的、木星有條紋和大紅斑、火星有極冠、月球有坑
 */
function bodySvg(key: string, x: number, y: number, r: number, sun: { x: number; y: number } | null): string {
  const c = `cx="${f1(x)}" cy="${f1(y)}"`;
  if (key === 'sun') {
    let rays = '';
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      rays += `M${f1(x + (r + 2) * Math.cos(a))} ${f1(y + (r + 2) * Math.sin(a))}L${f1(x + (r + 5) * Math.cos(a))} ${f1(y + (r + 5) * Math.sin(a))}`;
    }
    return `<path class="space-sun-ray" d="${rays}" /><circle class="space-sun" ${c} r="${f1(r)}" />`;
  }
  const look = LOOKS[key];
  let out = '';
  const ringRx = r * 2.2;
  const ringRy = r * 0.7;
  if (key === 'saturn') out += `<ellipse class="space-ring" ${c} rx="${f1(ringRx)}" ry="${f1(ringRy)}" />`;
  if (key === 'uranus') out += `<ellipse class="space-ring" ${c} rx="${f1(r * 0.5)}" ry="${f1(r * 1.8)}" />`;
  out += `<circle class="space-planet" ${c} r="${f1(r)}" fill="${look.tint}" />`;
  if (key === 'jupiter' && r >= 4) {
    out += `<path class="space-detail" d="${chord(x, y, r, -r * 0.45)}${chord(x, y, r, -r * 0.1)}${chord(x, y, r, r * 0.3)}" />`;
    if (r >= 8) out += `<ellipse class="space-spot" cx="${f1(x + r * 0.32)}" cy="${f1(y + r * 0.45)}" rx="${f1(r * 0.22)}" ry="${f1(r * 0.12)}" />`;
  }
  if (key === 'neptune' && r >= 6) out += `<path class="space-detail" d="${chord(x, y, r, r * 0.2)}" /><ellipse class="space-spot" cx="${f1(x - r * 0.3)}" cy="${f1(y - r * 0.2)}" rx="${f1(r * 0.2)}" ry="${f1(r * 0.12)}" />`;
  if (key === 'mars' && r >= 5) out += `<ellipse class="space-cap" cx="${f1(x)}" cy="${f1(y - r * 0.82)}" rx="${f1(r * 0.4)}" ry="${f1(r * 0.16)}" />`;
  if (key === 'moon' && r >= 4) {
    // 放大看得清楚：暗暗的月海、更多坑
    if (r >= 20) {
      for (const [mx, my, mrx, mry] of [[-0.25, -0.3, 0.32, 0.22], [0.2, -0.1, 0.22, 0.18], [-0.05, 0.25, 0.26, 0.14]]) {
        out += `<ellipse class="space-mare" cx="${f1(x + r * mx)}" cy="${f1(y + r * my)}" rx="${f1(r * mrx)}" ry="${f1(r * mry)}" />`;
      }
    }
    const craters = r >= 20 ? [[-0.3, -0.2, 0.22], [0.35, 0.3, 0.15], [0.1, 0.6, 0.1], [0.55, -0.35, 0.09], [-0.6, 0.25, 0.12], [-0.1, -0.65, 0.07], [0.3, 0.05, 0.06]] : [[-0.3, -0.2, 0.22], [0.35, 0.3, 0.15]];
    for (const [cx, cy, cr] of craters) out += `<circle class="space-detail" cx="${f1(x + r * cx)}" cy="${f1(y + r * cy)}" r="${f1(r * cr)}" />`;
  }
  // 背對太陽的那一半：從朝太陽的方向轉 90 度到 -90 度，經過背面那一邊
  if (sun && r >= 3) {
    const a = Math.atan2(sun.y - y, sun.x - x);
    const p1 = [x + r * Math.cos(a + Math.PI / 2), y + r * Math.sin(a + Math.PI / 2)];
    const p2 = [x + r * Math.cos(a - Math.PI / 2), y + r * Math.sin(a - Math.PI / 2)];
    out += `<path class="space-shade" d="M${f1(p1[0])} ${f1(p1[1])}A${f1(r)} ${f1(r)} 0 0 1 ${f1(p2[0])} ${f1(p2[1])}Z" />`;
  }
  // 土星的環：前半圈蓋在星球上
  if (key === 'saturn') out += `<path class="space-ring" d="M${f1(x - ringRx)} ${f1(y)}A${f1(ringRx)} ${f1(ringRy)} 0 0 0 ${f1(x + ringRx)} ${f1(y)}" />`;
  return out;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * 汪星畫成跟地球一樣的球：正射投影，地表是台北市（WOOF_LAND），跟雷達畫台北一樣只用線條：
 * 市界是海岸（虛線，陸地淡淡填色，外面空白是海）、區界、道路（國道、快速道路粗線，主要幹道細線），夠大才畫道路、寫區名；
 * 經緯線每 30 度（夠大才畫）、虛線的邊，夜晚那一半照太陽真正的方向（toSun：看的人的座標）。
 * 正中間的經緯度跟著視角轉：左右拖轉經度、上下拖轉緯度
 */
function woofGlobe(x: number, y: number, r: number, view: SpaceView, toSun: Vec3): string {
  const center = { lat: Math.max(-80, Math.min(80, view.pitch / RAD)), lng: norm180(-view.yaw / RAD) };
  const n = Math.hypot(...toSun) || 1;
  let out = '';
  if (r >= 30) out += `<path class="space-grat" d="${graticule(center, r)}" />`;
  const land = WOOF_LAND.map((ring) => hemiPath(center, ring, r, onWoofLand(center.lat, center.lng))).join('');
  if (land) out += `<path class="region-outline" d="${land}" />`;
  if (r >= 30) out += `<path class="region-outline open county-line" d="${linesPath(center, WOOF_DISTRICT_LINES, r)}" />`;
  if (r >= 60) {
    out += `<path class="woof-road street-minor" d="${linesPath(center, WOOF_MINOR_ROADS, r)}" />`;
    out += `<path class="woof-road street-major" d="${linesPath(center, WOOF_MAJOR_ROADS, r)}" />`;
  }
  out += `<path class="space-night" d="${nightFrom([toSun[0] / n, toSun[1] / n, toSun[2] / n], r)}" />`;
  // 區名：轉到邊邊擠在一起的不寫
  if (r >= 80) {
    for (const d of WOOF_NAMES) {
      const [px, py, pz] = ortho(center, d.at[0], d.at[1]);
      if (pz > 0.35) out += `<text class="space-label woof-name" x="${f1(C + r * px)}" y="${f1(C - r * py + 4)}" text-anchor="middle">${d.name}</text>`;
    }
  }
  out += `<circle class="region-outline open space-limb" cx="${f1(C)}" cy="${f1(C)}" r="${f1(r)}" />`;
  return `<g class="space-globe" transform="translate(${f1(x - C)} ${f1(y - C)})">${out}</g>`;
}

/** 太陽系那幾層的看法：中心是哪一顆（null 是地球、你）、繞著中心左右轉幾度、往下傾斜幾度（0 是從黃道北邊正上方往下看） */
export interface SpaceView {
  focus: string | null;
  yaw: number;
  pitch: number;
}

export interface SpaceOpts {
  /** 你的位置（地球的正中間） */
  center: LatLng;
  /** 陸地（台灣加上全世界的海岸線） */
  land: Array<Array<[number, number]>>;
  when: Date;
  /** 雷達外圈代表幾公里 */
  scaleKm: number;
  /** 地球在雷達上的半徑（雷達照這個擺光點） */
  rg: number;
  view?: SpaceView;
}

/** 太陽系的天體在這一刻的位置（以地球為中心的黃道座標，公里） */
function bodyPositions(when: Date): Map<string, Vec3> {
  const ps = planetPositions(when);
  const e = ps.find((p) => p.key === 'earth')!;
  const out = new Map<string, Vec3>();
  out.set('earth', [0, 0, 0]);
  out.set('sun', [-e.x * AU_KM, -e.y * AU_KM, -e.z * AU_KM]);
  for (const p of ps) if (p.key !== 'earth') out.set(p.key, [(p.x - e.x) * AU_KM, (p.y - e.y) * AU_KM, (p.z - e.z) * AU_KM]);
  const m = moonPosition(when);
  const cl = Math.cos(m.lat * RAD);
  out.set('moon', [m.dist * cl * Math.cos(m.lon * RAD), m.dist * cl * Math.sin(m.lon * RAD), m.dist * Math.sin(m.lat * RAD)]);
  return out;
}

const NAMES: Record<string, string> = { sun: '太陽', moon: '月球', ...Object.fromEntries(PLANETS.map((p) => [p.key, p.name])) };

/**
 * 太空：地球（夠大、從正上方看你的時候畫海岸線、經緯線、晝夜），月球、太陽、行星照真實距離擺（黃道座標，春分點方向在右邊），
 * 軌道用虛線，星球照真實大小（太小就畫最小的大小）。view 是 3D 的看法：繞中心轉、傾斜，中心可以換成別的星球；
 * 遠的先畫，每顆星球可以點（data-body），不在雷達範圍裡的不畫
 */
export function spaceMarkup(o: SpaceOpts): string {
  const k = INNER / o.scaleKm;
  const view = o.view ?? { focus: null, yaw: 0, pitch: 0 };
  const topDown = view.yaw === 0 && view.pitch === 0;
  const pos = bodyPositions(o.when);
  const F = (view.focus && pos.get(view.focus)) || ([0, 0, 0] as Vec3);
  const [cy, sy, cp, sp] = [Math.cos(view.yaw), Math.sin(view.yaw), Math.cos(view.pitch), Math.sin(view.pitch)];
  /** 3D 的方向轉成看的人的座標：x 往右、y 往上、z 朝看的人 */
  const rot = (v: Vec3): Vec3 => {
    const x1 = v[0] * cy - v[1] * sy;
    const y1 = v[0] * sy + v[1] * cy;
    return [x1, y1 * cp + v[2] * sp, -y1 * sp + v[2] * cp];
  };
  /** 3D（公里，以地球為中心）→ 畫面座標和深度（越大越靠近看的人） */
  const proj = (p: Vec3): { x: number; y: number; d: number } => {
    const [x, y, d] = rot([p[0] - F[0], p[1] - F[1], p[2] - F[2]]);
    return { x: C + x * k, y: C - y * k, d };
  };
  const pathOf = (pts: Vec3[]): string => `M${pts.map((p) => { const q = proj(p); return `${f1(q.x)} ${f1(q.y)}`; }).join('L')}Z`;
  const inView = (x: number, y: number, r = 0): boolean => Math.hypot(x - C, y - C) - r <= INNER;
  const radius = (key: string): number => Math.max(LOOKS[key].min, LOOKS[key].km * k);
  const named: Body[] = [];
  let lines = '';
  // 地球：中心是你、從正上方看、大到看得出形狀，就畫海岸線、經緯線、晝夜（跟光點的位置一致）
  const globe = !view.focus && topDown && o.rg >= TINY_EARTH;
  if (globe) {
    lines += `<path class="space-night" d="${nightPath(o.center, subsolar(o.when), o.rg)}" />`;
    if (o.rg >= 30) lines += `<path class="space-grat" d="${graticule(o.center, o.rg)}" />`;
    lines += `<path class="region-outline" d="${landPath(o.center, o.land, o.rg)}" />`;
    lines += `<circle class="region-outline open space-limb" cx="${C}" cy="${C}" r="${f1(o.rg)}" />`;
  }
  // 軌道：月球繞地球、行星繞太陽；太小、太大（看起來是直線）的不畫
  if (MOON_KM * k >= 12 && MOON_KM * k <= INNER * 3) {
    const earth = pos.get('earth')!;
    lines += `<path class="region-outline open space-orbit" d="${pathOf(moonOrbit(o.when).map((p) => [p[0] + earth[0], p[1] + earth[1], p[2] + earth[2]] as Vec3))}" />`;
  }
  const sun = pos.get('sun')!;
  for (const p of PLANETS) {
    const a = p.el[0] * AU_KM * k;
    if (a < 6 || a > INNER * 12) continue;
    lines += `<path class="region-outline open space-orbit" d="${pathOf(orbitPath(p.key, o.when).map((q) => [q[0] * AU_KM + sun[0], q[1] * AU_KM + sun[1], q[2] * AU_KM + sun[2]] as Vec3))}" />`;
  }
  // 星球：遠的先畫，近的蓋在上面
  const sunAt = proj(sun);
  const list = [...pos.entries()]
    .filter(([key]) => !(key === 'earth' && globe))
    .map(([key, p]) => ({ key, ...proj(p), r: radius(key) }))
    .filter((b) => inView(b.x, b.y, b.r))
    .sort((a, b) => a.d - b.d);
  let bodies = '';
  for (const b of list) {
    // 汪星大到看得出形狀：跟地球一樣畫成球
    const look = b.key === 'woof' && b.r >= TINY_EARTH ? woofGlobe(b.x, b.y, b.r, view, rot(sub(sun, pos.get('woof')!))) : bodySvg(b.key, b.x, b.y, b.r, b.key === 'sun' ? null : sunAt);
    // 點星球飛過去：點擊範圍至少半徑 12
    bodies += `<g class="space-hit" data-body="${b.key}"><circle class="hit" cx="${f1(b.x)}" cy="${f1(b.y)}" r="${f1(Math.max(b.r + 3, 12))}" />${look}</g>`;
    // 中心換到別的星球：雷達中間的圓點不是你，你畫在地球那裡
    if (b.key === 'earth' && view.focus) bodies += `<circle class="space-me" cx="${f1(b.x)}" cy="${f1(b.y)}" r="3" />`;
    const name = b.key === 'earth' ? (view.focus ? '地球（你）' : '地球') : NAMES[b.key];
    const r = b.key === 'saturn' ? b.r * 2.2 : b.key === 'sun' ? b.r + 5 : b.r;
    named.push({ x: b.x, y: b.y, r, cls: b.key, name, force: b.key === 'earth' && !!view.focus });
  }
  // 名字照順序放：地球（你）最優先，再來是中心那顆、太陽
  const rank = (b: Body): number => (b.force ? 0 : b.cls === view.focus ? 1 : b.cls === 'sun' ? 2 : 3);
  named.sort((a, b) => rank(a) - rank(b));
  // 地球大到看得出形狀時（從正上方看你）不寫名字
  return `${lines}${bodies}${labels(named.filter((b) => !(b.cls === 'earth' && !view.focus && o.rg >= 24)))}`;
}
