/**
 * 雷達從「全球」再拉遠就是太空（第一次用到才載入）：跟雷達平常一樣用虛線畫，畫成 SVG 字串放在海岸線那一層。
 * - 地球：以你為中心、從太空看的地球（正射投影），海岸線、經緯線，夜晚的那一半照現在時間淡淡變暗
 * - 再拉遠：月球的軌道和月球，太陽、行星和它們的軌道（以地球為中心，距離照真實比例，位置照今天推算）
 */
import type { LatLng } from './geo';
import { RADAR_GEOM, TINY_EARTH } from './radar';

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
export function moonPosition(at: Date): { lon: number; dist: number } {
  const d = daysJ2000(at);
  const L = 218.316 + 13.176396 * d;
  const M = (134.963 + 13.064993 * d) * RAD;
  return { lon: norm360(L + 6.289 * Math.sin(M)), dist: 385_001 - 20_905 * Math.cos(M) };
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

/** 經緯線：每 30 度一條，另一面的不畫 */
function graticule(center: LatLng, rg: number): string {
  let d = '';
  const line = (pts: Array<[number, number]>): void => {
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
  };
  const steps = (from: number, to: number, step: number): number[] => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
  for (let lng = -180; lng < 180; lng += 30) line(steps(-90, 90, 3).map((lat) => [lat, lng]));
  for (let lat = -60; lat <= 60; lat += 30) line(steps(-180, 180, 3).map((lng) => [lat, lng]));
  return d;
}

/**
 * 夜晚的那一半：晨昏線（離太陽直射點 90 度的大圓）在看得到這一面的那一段，接上地球邊緣在夜晚那邊的半圈。
 * u、w 是晨昏線所在平面的兩個方向，u 在地球邊緣上（z = 0），所以晨昏線從 u 走到 -u
 */
export function nightPath(center: LatLng, sun: { lat: number; lng: number }, rg: number): string {
  const s = ortho(center, sun.lat, sun.lng);
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
  { key: 'mars', name: '火星', el: [1.52371034, 0.00001847, 0.0933941, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343] },
  { key: 'jupiter', name: '木星', el: [5.202887, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106] },
  { key: 'saturn', name: '土星', el: [9.53667594, -0.0012506, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794] },
  { key: 'uranus', name: '天王星', el: [19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939, 313.23810451, 428.48202785, 170.9542763, 0.40805281, 74.01692503, 0.04240589] },
  { key: 'neptune', name: '海王星', el: [30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372, -55.12002969, 218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664] },
];

/** 一顆行星在黃道面上的日心位置（AU）：解克卜勒方程式；a 是軌道半長軸 */
function helio(el: Elements, T: number): { x: number; y: number; a: number } {
  const [a0, da, e0, de, i0, di, l0, dl, w0, dw, o0, dO] = el;
  const a = a0 + da * T;
  const e = e0 + de * T;
  const inc = (i0 + di * T) * RAD;
  const wbar = w0 + dw * T;
  const node = o0 + dO * T;
  const omega = (wbar - node) * RAD;
  const om = node * RAD;
  const M = norm180(l0 + dl * T - wbar) * RAD;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const [co, so, cO, sO, ci] = [Math.cos(omega), Math.sin(omega), Math.cos(om), Math.sin(om), Math.cos(inc)];
  return {
    x: (co * cO - so * sO * ci) * xp + (-so * cO - co * sO * ci) * yp,
    y: (co * sO + so * cO * ci) * xp + (-so * sO + co * cO * ci) * yp,
    a,
  };
}

/** 八大行星現在的日心黃經、離太陽多遠（AU） */
export function planetPositions(when: Date): Array<{ key: string; name: string; lon: number; dist: number; x: number; y: number; a: number }> {
  const T = daysJ2000(when) / 36525;
  return PLANETS.map((p) => {
    const h = helio(p.el, T);
    return { key: p.key, name: p.name, lon: norm360(Math.atan2(h.y, h.x) / RAD), dist: Math.hypot(h.x, h.y), ...h };
  });
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
  mars: { km: 3_390, min: 3, tint: '#cf6c40' },
  jupiter: { km: 69_911, min: 6, tint: '#cfa77d' },
  saturn: { km: 58_232, min: 5, tint: '#ddc88e' },
  uranus: { km: 25_362, min: 4.2, tint: '#86cbd2' },
  neptune: { km: 24_622, min: 4.2, tint: '#5876d6' },
};

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
  if (key === 'moon' && r >= 4) out += `<circle class="space-detail" cx="${f1(x - r * 0.3)}" cy="${f1(y - r * 0.2)}" r="${f1(r * 0.22)}" /><circle class="space-detail" cx="${f1(x + r * 0.35)}" cy="${f1(y + r * 0.3)}" r="${f1(r * 0.15)}" />`;
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
  /** 太陽系那幾層拖曳移開的視野：中心離地球多遠（公里，黃道面，x 往春分點方向、y 往上） */
  offset?: { x: number; y: number };
}

/**
 * 太空：地球（夠大才畫海岸線、經緯線、晝夜），月球、太陽、行星照真實距離擺在地球周圍（黃道面，春分點方向在右邊），
 * 軌道用虛線，星球照真實大小（太小就畫最小的大小）；不在雷達範圍裡的不畫
 */
export function spaceMarkup(o: SpaceOpts): string {
  const k = INNER / o.scaleKm;
  const inView = (x: number, y: number, r = 0): boolean => Math.hypot(x - C, y - C) - r <= INNER;
  // 地球（你）在畫面上的位置：視野沒移開就在正中間
  const ox = o.offset?.x ?? 0;
  const oy = o.offset?.y ?? 0;
  const moved = ox !== 0 || oy !== 0;
  const ex = C - ox * k;
  const ey = C + oy * k;
  const planets = planetPositions(o.when);
  const earth = planets.find((p) => p.key === 'earth')!;
  const sun = { x: ex - earth.x * AU_KM * k, y: ey + earth.y * AU_KM * k };
  const radius = (key: string): number => Math.max(LOOKS[key].min, LOOKS[key].km * k);
  const named: Body[] = [];
  let lines = '';
  let bodies = '';
  // 地球：大到看得出形狀就畫海岸線、經緯線、晝夜（視野移開了就整顆搬過去）
  if (o.rg >= TINY_EARTH) {
    if (inView(ex, ey, o.rg)) {
      const s = subsolar(o.when);
      let globe = `<path class="space-night" d="${nightPath(o.center, s, o.rg)}" />`;
      if (o.rg >= 30) globe += `<path class="space-grat" d="${graticule(o.center, o.rg)}" />`;
      globe += `<path class="region-outline" d="${landPath(o.center, o.land, o.rg)}" />`;
      globe += `<circle class="region-outline open space-limb" cx="${C}" cy="${C}" r="${f1(o.rg)}" />`;
      lines += moved ? `<g transform="translate(${f1(ex - C)} ${f1(ey - C)})">${globe}</g>` : globe;
      if (moved) bodies += `<circle class="space-me" cx="${f1(ex)}" cy="${f1(ey)}" r="4" />`;
    }
  } else if (inView(ex, ey)) {
    bodies += bodySvg('earth', ex, ey, radius('earth'), sun);
    // 視野移開了：雷達中間的圓點（你）不在地球上，在地球那裡畫一個
    if (moved) bodies += `<circle class="space-me" cx="${f1(ex)}" cy="${f1(ey)}" r="3" />`;
  }
  // 地球小到看不出形狀：寫名字（中間的圓點是你）
  if (o.rg < 24 && inView(ex, ey)) named.push({ x: ex, y: ey, r: Math.max(o.rg, radius('earth')), cls: 'earth', name: moved ? '地球（你）' : '地球', force: moved });
  // 月球：軌道看得出來才畫
  const moonR = MOON_KM * k;
  if (moonR >= 12 && moonR <= INNER * 3 && Math.hypot(ex - C, ey - C) - moonR < INNER) {
    lines += `<circle class="region-outline open space-orbit" cx="${f1(ex)}" cy="${f1(ey)}" r="${f1(moonR)}" />`;
    const m = moonPosition(o.when);
    const x = ex + m.dist * k * Math.cos(m.lon * RAD);
    const y = ey - m.dist * k * Math.sin(m.lon * RAD);
    const r = radius('moon');
    if (inView(x, y, r)) {
      bodies += bodySvg('moon', x, y, r, sun);
      named.push({ x, y, r, cls: 'moon', name: '月球' });
    }
  }
  // 太陽、行星：以地球為中心（行星的日心位置減掉地球的）
  const sunDist = Math.hypot(sun.x - C, sun.y - C);
  for (const p of planets) {
    const orbit = p.a * AU_KM * k;
    // 軌道：太小、太大（看起來是直線）、跟雷達範圍沒交集的不畫
    if (orbit >= 6 && orbit <= INNER * 12 && sunDist - orbit < INNER && orbit - sunDist < INNER) {
      lines += `<circle class="region-outline open space-orbit" cx="${f1(sun.x)}" cy="${f1(sun.y)}" r="${f1(orbit)}" />`;
    }
    if (p.key === 'earth') continue;
    const x = ex + (p.x - earth.x) * AU_KM * k;
    const y = ey - (p.y - earth.y) * AU_KM * k;
    const r = radius(p.key);
    if (!inView(x, y, r)) continue;
    bodies += bodySvg(p.key, x, y, r, sun);
    named.push({ x, y, r: p.key === 'saturn' ? r * 2.2 : r, cls: p.key, name: p.name });
  }
  const sunR = radius('sun');
  if (inView(sun.x, sun.y, sunR)) {
    bodies += bodySvg('sun', sun.x, sun.y, sunR, null);
    // 名字照順序放：地球（你）最優先，再來是太陽
    named.splice(named[0]?.cls === 'earth' ? 1 : 0, 0, { x: sun.x, y: sun.y, r: sunR + 5, cls: 'sun', name: '太陽' });
  }
  return `${lines}${bodies}${labels(named)}`;
}
