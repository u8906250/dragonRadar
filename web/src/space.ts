/**
 * 雷達的「太空」範圍（第一次用到才載入）：畫成 SVG 字串，雷達放在最底層，掃描照樣蓋在上面。
 * - 地球：以你為中心、從太空看的地球（正射投影），陸地、經緯線、星空，夜晚的那一半照現在時間變暗
 * - 太陽系：從北邊往下看，八大行星照今天的位置（公式推算），軌道等距排、不照比例
 */
import type { LatLng } from './geo';
import { GLOBE_FRAC, RADAR_GEOM } from './radar';

const { c: C, r: R, inner: INNER } = RADAR_GEOM;
/** 地球在雷達上的半徑 */
const RG = GLOBE_FRAC * INNER;
const RAD = Math.PI / 180;
const norm360 = (d: number): number => ((d % 360) + 360) % 360;
const norm180 = (d: number): number => norm360(d + 180) - 180;
const f1 = (n: number): string => n.toFixed(1);

/** 儒略日（從 J2000.0 起算的天數） */
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

/** 經緯度 → 以 center 為中心的正射投影：x 往東、y 往北（地球半徑 = 1），z > 0 是看得到的這一面 */
export function ortho(center: LatLng, lat: number, lng: number): [number, number, number] {
  const p0 = center.lat * RAD;
  const p = lat * RAD;
  const dl = (lng - center.lng) * RAD;
  const cp = Math.cos(p);
  return [cp * Math.sin(dl), Math.cos(p0) * Math.sin(p) - Math.sin(p0) * cp * Math.cos(dl), Math.sin(p0) * Math.sin(p) + Math.cos(p0) * cp * Math.cos(dl)];
}

const at = (x: number, y: number, r = RG): string => `${f1(C + r * x)} ${f1(C - r * y)}`;

/** 星星：固定的亂數，每次畫的位置一樣；avoid 半徑內（地球、太陽）不畫 */
function stars(avoid: number): string {
  let seed = 20261028;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let out = '';
  for (let i = 0; i < 160; i++) {
    const x = rnd() * 2 - 1;
    const y = rnd() * 2 - 1;
    const size = 0.35 + rnd() * rnd() * 1.2;
    const op = 0.3 + rnd() * 0.6;
    const d = Math.hypot(x, y) * R;
    if (d > R - 3 || d < avoid) continue;
    out += `<circle cx="${f1(C + x * R)}" cy="${f1(C + y * R)}" r="${size.toFixed(2)}" opacity="${op.toFixed(2)}"/>`;
  }
  return `<g class="space-stars">${out}</g>`;
}

/**
 * 陸地：在另一面的那一段換成沿著地球邊緣走，從海岸線轉到另一面的方向走到轉回來的方向，走不到半圈的那一邊
 * （南美洲這種繞過正對面的，沿著每個點的方向走會繞地球一整圈，把整個地球塗滿）；整塊在另一面的不畫
 */
export function landPath(center: LatLng, rings: Array<Array<[number, number]>>): string {
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
        seg += `L${at(Math.cos(a), Math.sin(a))}`;
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
      seg += `${seg ? 'L' : 'M'}${at(x, y)}`;
    }
    edge();
    d += `${seg}Z`;
  }
  return d;
}

/** 經緯線：每 30 度一條，另一面的不畫 */
function graticule(center: LatLng): string {
  let d = '';
  const line = (pts: Array<[number, number]>): void => {
    let pen = false;
    for (const [lat, lng] of pts) {
      const [x, y, z] = ortho(center, lat, lng);
      if (z <= 0) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${at(x, y)}`;
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
export function nightPath(center: LatLng, sun: { lat: number; lng: number }): string {
  const s = ortho(center, sun.lat, sun.lng);
  if (s[2] > 0.9999) return '';
  if (s[2] < -0.9999) return `M${at(1, 0)}A${RG} ${RG} 0 1 0 ${at(-1, 0)}A${RG} ${RG} 0 1 0 ${at(1, 0)}Z`;
  const h = Math.hypot(s[0], s[1]);
  const u = [s[1] / h, -s[0] / h, 0];
  const w = [s[1] * u[2] - s[2] * u[1], s[2] * u[0] - s[0] * u[2], s[0] * u[1] - s[1] * u[0]];
  const sign = w[2] >= 0 ? 1 : -1;
  let d = `M${at(u[0], u[1])}`;
  for (let i = 1; i <= 64; i++) {
    const t = (sign * Math.PI * i) / 64;
    d += `L${at(Math.cos(t) * u[0] + Math.sin(t) * w[0], Math.cos(t) * u[1] + Math.sin(t) * w[1])}`;
  }
  // 從 -u 沿著邊緣回到 u，走夜晚那邊（邊緣上背對太陽的那半圈，中點在 -(sx, sy) 的方向）
  const a0 = Math.atan2(-u[1], -u[0]);
  const mid = a0 + Math.PI / 2;
  const dir = Math.cos(mid) * s[0] + Math.sin(mid) * s[1] < 0 ? 1 : -1;
  for (let i = 1; i <= 64; i++) {
    const a = a0 + (dir * Math.PI * i) / 64;
    d += `L${at(Math.cos(a), Math.sin(a))}`;
  }
  return `${d}Z`;
}

/** 從太空看的地球：center 在正中間（北在上，指北針模式由雷達整組轉） */
export function globeMarkup(center: LatLng, land: Array<Array<[number, number]>>, when: Date): string {
  const sun = subsolar(when);
  return `
    <defs>
      <radialGradient id="sp-atmo" cx="50%" cy="50%" r="50%">
        <stop offset="${(RG / (RG + 14)).toFixed(3)}" stop-color="#7fb8ff" stop-opacity="0.55" />
        <stop offset="1" stop-color="#7fb8ff" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="sp-shade" cx="38%" cy="32%" r="70%">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.14" />
        <stop offset="0.7" stop-color="#000000" stop-opacity="0" />
        <stop offset="1" stop-color="#000000" stop-opacity="0.3" />
      </radialGradient>
    </defs>
    <g class="space-rot">
      ${stars(RG + 12)}
      <circle cx="${C}" cy="${C}" r="${RG + 14}" fill="url(#sp-atmo)" />
      <circle class="space-ocean" cx="${C}" cy="${C}" r="${RG}" />
      <path class="space-grat" d="${graticule(center)}" />
      <path class="space-land" d="${landPath(center, land)}" />
      <path class="space-night" d="${nightPath(center, sun)}" />
      <circle cx="${C}" cy="${C}" r="${RG}" fill="url(#sp-shade)" />
      <circle class="space-limb" cx="${C}" cy="${C}" r="${RG}" />
    </g>`;
}

/**
 * 行星軌道根數（JPL「Approximate Positions of the Planets」表 1，1800–2050 年適用）：
 * a（AU）、e、I、L、近日點經度 ϖ、升交點經度 Ω，各自的每世紀變化。地球用地月質心
 */
type Elements = [number, number, number, number, number, number, number, number, number, number, number, number];
const PLANETS: Array<{ key: string; name: string; size: number; color: string; el: Elements }> = [
  { key: 'mercury', name: '水星', size: 2.4, color: '#b9b4ac', el: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.2503235, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081] },
  { key: 'venus', name: '金星', size: 3.6, color: '#e8cf94', el: [0.72333566, 0.0000039, 0.00677672, -0.00004107, 3.39467605, -0.0007889, 181.9790995, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418] },
  { key: 'earth', name: '地球', size: 3.8, color: '#4f9be8', el: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0, 0] },
  { key: 'mars', name: '火星', size: 3, color: '#d9693f', el: [1.52371034, 0.00001847, 0.0933941, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343] },
  { key: 'jupiter', name: '木星', size: 7, color: '#d8b48a', el: [5.202887, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106] },
  { key: 'saturn', name: '土星', size: 6, color: '#e6d39a', el: [9.53667594, -0.0012506, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794] },
  { key: 'uranus', name: '天王星', size: 4.6, color: '#9fd8df', el: [19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939, 313.23810451, 428.48202785, 170.9542763, 0.40805281, 74.01692503, 0.04240589] },
  { key: 'neptune', name: '海王星', size: 4.4, color: '#5f7fe0', el: [30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372, -55.12002969, 218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664] },
];

/** 一顆行星的日心黃經（度）、離太陽多遠（AU）：解克卜勒方程式 */
function helio(el: Elements, T: number): { lon: number; dist: number } {
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
  const x = (co * cO - so * sO * ci) * xp + (-so * cO - co * sO * ci) * yp;
  const y = (co * sO + so * cO * ci) * xp + (-so * sO + co * cO * ci) * yp;
  return { lon: norm360(Math.atan2(y, x) / RAD), dist: Math.hypot(x, y) };
}

/** 八大行星現在的日心黃經、離太陽多遠 */
export function planetPositions(when: Date): Array<{ key: string; name: string; lon: number; dist: number }> {
  const T = daysJ2000(when) / 36525;
  return PLANETS.map((p) => ({ key: p.key, name: p.name, ...helio(p.el, T) }));
}

/** 太陽系：從黃道北邊往下看（行星逆時針轉），春分點方向在右邊；軌道等距排，不照比例 */
export function solarMarkup(when: Date): string {
  const pos = planetPositions(when);
  const sunR = 11;
  const first = sunR + 12;
  const last = INNER * 0.93;
  const orbitR = (i: number): number => first + ((last - first) * i) / (PLANETS.length - 1);
  let orbits = '';
  let bodies = '';
  const placed = PLANETS.map((p, i) => {
    const r = orbitR(i);
    const a = pos[i].lon * RAD;
    return { p, r, x: C + r * Math.cos(a), y: C - r * Math.sin(a) };
  });
  // 標籤先放下面，跟別的標籤、行星、太陽疊到就換上面、右邊、左邊；地球先放
  const boxes: Array<[number, number, number, number]> = [[C - sunR, C - sunR, C + sunR, C + sunR], ...placed.map(({ p, x, y }): [number, number, number, number] => [x - p.size, y - p.size, x + p.size, y + p.size])];
  const hit = (b: [number, number, number, number], own: number): boolean =>
    boxes.some((o, j) => j !== own + 1 && b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  const labels = new Map<string, string>();
  for (const k of [2, 0, 1, 3, 4, 5, 6, 7]) {
    const { p, x, y } = placed[k];
    const text = p.key === 'earth' ? '地球（你在這裡）' : p.name;
    const w = [...text].length * 9.5;
    const s = p.size;
    const options: Array<{ box: [number, number, number, number]; tx: number; ty: number; anchor: string }> = [
      { box: [x - w / 2, y + s + 1, x + w / 2, y + s + 12], tx: x, ty: y + s + 10, anchor: 'middle' },
      { box: [x - w / 2, y - s - 13, x + w / 2, y - s - 2], tx: x, ty: y - s - 4, anchor: 'middle' },
      { box: [x + s + 3, y - 7, x + s + 3 + w, y + 5], tx: x + s + 3, ty: y + 3.5, anchor: 'start' },
      { box: [x - s - 3 - w, y - 7, x - s - 3, y + 5], tx: x - s - 3, ty: y + 3.5, anchor: 'end' },
    ];
    const pick = options.find((o) => !hit(o.box, k)) ?? options[0];
    boxes.push(pick.box);
    labels.set(p.key, `<text class="space-planet-label${p.key === 'earth' ? ' earth' : ''}" x="${f1(pick.tx)}" y="${f1(pick.ty)}" text-anchor="${pick.anchor}">${text}</text>`);
  }
  for (const { p, r, x, y } of placed) {
    orbits += `<circle class="space-orbit${p.key === 'earth' ? ' earth' : ''}" cx="${C}" cy="${C}" r="${f1(r)}" />`;
    const ring = p.key === 'saturn' ? `<ellipse class="space-saturn-ring" cx="${f1(x)}" cy="${f1(y)}" rx="${f1(p.size * 1.9)}" ry="${f1(p.size * 0.6)}" />` : '';
    const me = p.key === 'earth' ? `<circle class="space-earth-ring" cx="${f1(x)}" cy="${f1(y)}" r="${f1(p.size + 3.5)}" />` : '';
    bodies += `${me}<circle class="space-planet" cx="${f1(x)}" cy="${f1(y)}" r="${p.size}" fill="${p.color}" />${ring}`;
  }
  bodies += [...labels.values()].join('');
  return `
    <defs>
      <radialGradient id="sp-sun" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#fff6c8" />
        <stop offset="0.55" stop-color="#ffc83d" />
        <stop offset="1" stop-color="#ff8a1d" />
      </radialGradient>
      <radialGradient id="sp-sun-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0.4" stop-color="#ffb23d" stop-opacity="0.5" />
        <stop offset="1" stop-color="#ffb23d" stop-opacity="0" />
      </radialGradient>
    </defs>
    ${stars(0)}
    ${orbits}
    <circle cx="${C}" cy="${C}" r="${sunR * 2.2}" fill="url(#sp-sun-glow)" />
    <circle cx="${C}" cy="${C}" r="${sunR}" fill="url(#sp-sun)" />
    ${bodies}`;
}
