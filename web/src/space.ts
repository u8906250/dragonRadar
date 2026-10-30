/**
 * 雷達從「全球」再拉遠就是太空（第一次用到才載入）：跟雷達平常一樣用虛線畫，畫成 SVG 字串放在海岸線那一層。
 * - 地球：以你為中心、從太空看的地球（正射投影），海岸線、經緯線，夜晚的那一半照現在時間淡淡變暗
 * - 再拉遠：月球的軌道和月球，太陽、行星和它們的軌道（以地球為中心，距離照真實比例，位置照今天推算）
 */
import type { LatLng } from './geo';
import { RADAR_GEOM, RADAR_VIEW, TINY_EARTH, viewReach, viewRect } from './radar';
import type { StreetClass, StreetLine } from './streets';
import { nearPark, PARK_MIN_KM, parkGeom, parkSvg, ringArea, scatter } from './park';
import { TAIPEI_MAJOR_ROADS, TAIPEI_MINOR_ROADS, TAIPEI_OUTLINE } from './taipei';

const { c: C, inner: INNER, size: SIZE } = RADAR_GEOM;
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

/**
 * 放大到很近時看得到的那一小塊（經緯度範圍，含邊緣多留的一點）和要切多細（度）：
 * 線每 2 度一點，連起來在球上是弦（汪星上約差 1 公尺），在中山公園放大到幾百公尺內看得出偏離，這一塊裡面的再切細；
 * 看得到的範圍還很大就是 null
 */
interface Near {
  lat0: number;
  lat1: number;
  lng0: number;
  lng1: number;
  step: number;
}
export function nearOf(center: LatLng, rg: number): Near | null {
  // 看得到的範圍（全螢幕鋪滿時是畫面的角）多留一些
  const a = Math.asin(Math.min(1, (viewReach() * 1.5) / rg)) / RAD;
  if (a / 16 >= 1) return null;
  // 切到弦離球面不到 0.05 像素就好（弦長 L 弧度離球面約 rg L² / 8）：放大很多時比看得到的範圍的 1/16 粗很多
  const step = Math.min(1, Math.max(a / 16, Math.sqrt(0.4 / rg) / RAD));
  // 多留 0.1 度：2 度的弦離球面最多約半徑的萬分之一點五
  const m = a + 0.1;
  const top = Math.max(Math.abs(center.lat - m), Math.abs(center.lat + m));
  const dl = top >= 89 ? 360 : m / Math.cos(top * RAD);
  return { lat0: center.lat - m, lat1: center.lat + m, lng0: center.lng - dl, lng1: center.lng + dl, step };
}

/**
 * 線（closed 是一圈）在 near 那一塊裡面的那一段切細到 near.step（只切那一段：整段都切的話，放大很多時一段 1 度的邊要切成幾千點）；
 * near 是 null 就照原本的
 */
function refine(pts: Array<[number, number]>, near: Near | null, closed = false): Array<[number, number]> {
  if (!near) return pts;
  const out: Array<[number, number]> = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    out.push(a);
    const [dy, dx] = [b[0] - a[0], b[1] - a[1]];
    for (const s of [-360, 0, 360]) {
      // 這一段在 near 裡面的部分：從 t0 到 t1（a 是 0、b 是 1）
      let [t0, t1] = [0, 1];
      const clip = (p: number, q: number): boolean => {
        if (p === 0) return q >= 0;
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
        return t0 <= t1;
      };
      if (!(clip(-dy, a[0] - near.lat0) && clip(dy, near.lat1 - a[0]) && clip(-dx, a[1] + s - near.lng0) && clip(dx, near.lng1 - a[1] - s))) continue;
      const k = Math.ceil(((t1 - t0) * Math.max(Math.abs(dy), Math.abs(dx))) / near.step);
      for (let j = 0; j <= k; j++) {
        const t = t0 + ((t1 - t0) * j) / k;
        if (t > 0 && t < 1) out.push([a[0] + dy * t, a[1] + dx * t]);
      }
      break;
    }
  }
  if (!closed) out.push(pts[pts.length - 1]);
  return out;
}

/**
 * 線（每條是一串「緯度, 經度」）看得到這一面的部分，轉到另一面就斷開；
 * near：放大時切細；box：畫面的範圍（x0, y0, x1, y1），兩點都在同一邊外面的段不畫（放大很多時 path 不會太長）
 */
function linesPath(center: LatLng, lines: Array<Array<[number, number]>>, rg: number, box?: [number, number, number, number], near: Near | null = null): string {
  let d = '';
  for (const line of lines) {
    // prev：前一個看得到的點；drawn：prev 已經畫進目前這一筆
    let prev: [number, number] | null = null;
    let drawn = false;
    for (const [lat, lng] of refine(line, near)) {
      const [x, y, z] = ortho(center, lat, lng);
      if (z <= 0) {
        prev = null;
        drawn = false;
        continue;
      }
      const cur: [number, number] = [C + rg * x, C - rg * y];
      if (prev) {
        const out = box && ((prev[0] < box[0] && cur[0] < box[0]) || (prev[0] > box[2] && cur[0] > box[2]) || (prev[1] < box[1] && cur[1] < box[1]) || (prev[1] > box[3] && cur[1] > box[3]));
        if (out) drawn = false;
        else {
          if (!drawn) d += `M${f1(prev[0])} ${f1(prev[1])}`;
          d += `L${f1(cur[0])} ${f1(cur[1])}`;
          drawn = true;
        }
      }
      prev = cur;
    }
  }
  return d;
}

/** 經緯線：每 30 度一條，另一面的不畫 */
export function graticule(center: LatLng, rg: number, box?: [number, number, number, number], near: Near | null = null): string {
  const lines: Array<Array<[number, number]>> = [];
  const steps = (from: number, to: number, step: number): number[] => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
  for (let lng = -180; lng < 180; lng += 30) lines.push(steps(-90, 90, 3).map((lat) => [lat, lng]));
  for (let lat = -60; lat <= 60; lat += 30) lines.push(steps(-180, 180, 3).map((lng) => [lat, lng]));
  return linesPath(center, lines, rg, box, near);
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
 * 市界外面是海，南北極和背面接縫的地方也是海；汪星的大小照台北市的面積算（WOOF_KM）
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


/** 汪星的陸地（市界）：逆時針，陸地在海岸線的左手邊 */
export const WOOF_LAND: Array<Array<[number, number]>> = [TAIPEI_OUTLINE].map((r) => {
  const ring = densify(r.map(toWoof), true);
  return ringArea(ring) < 0 ? ring.reverse() : ring;
});
/** 台北市的面積（平方公里，平面近似） */
const TAIPEI_KM2 = (() => {
  const kx = 111.32 * Math.cos(((TP.lat0 + TP.lat1) / 2) * RAD);
  return Math.abs(ringArea(TAIPEI_OUTLINE.map(([lat, lng]) => [lat * 110.574, lng * kx])));
})();
/**
 * 汪星的半徑（公里）：陸地的面積跟台北市一樣（約 6.6 km），平均來說是台北的真實大小
 * （東西向赤道附近寬約 1.9 倍、南北向約 0.66 倍）。球面上經緯度圍起來的面積 = R² ∮ -sin(緯度) d經度（弧度）
 */
export const WOOF_KM = (() => {
  const ring = WOOF_LAND[0];
  let unit = 0;
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
    unit -= ((Math.sin(a[0] * RAD) + Math.sin(b[0] * RAD)) / 2) * (b[1] - a[1]) * RAD;
  }
  return Math.sqrt(TAIPEI_KM2 / Math.abs(unit));
})();
const woofLines = (lines: Array<Array<[number, number]>>): Array<Array<[number, number]>> => lines.map((l) => densify(l.map(toWoof)));

const WOOF_MAJOR_ROADS = woofLines(TAIPEI_MAJOR_ROADS);
const WOOF_MINOR_ROADS = woofLines(TAIPEI_MINOR_ROADS);

/** 中山公園（park.ts，跟地球的雷達共用）換到汪星上：台北的經緯度攤開成汪星的、每 2 度一點，草和水波的大小是汪星上的公尺 */
const WOOF_PARK = parkGeom({ name: 'woof', to: toWoof, my: WOOF_KM * 1000 * RAD, mx: (lat) => WOOF_KM * 1000 * RAD * Math.cos(lat * RAD), densify });

/** 汪星正中間的經緯度：跟著視角轉，左右拖轉經度、上下拖轉緯度 */
const woofCenter = (view: SpaceView): LatLng => ({ lat: Math.max(-80, Math.min(80, view.pitch / RAD)), lng: norm180(-view.yaw / RAD) });

/** 汪星的正中間在不在中山公園附近（可以放大到 PARK_MIN_KM） */
export function atPark(view: SpaceView): boolean {
  const c = woofCenter(view);
  return nearPark(...fromWoof(c.lat, c.lng));
}

/** 汪星上這個地方是不是陸地（陸地不會跨過南北極和背面的接縫，所以照平面的經緯度算就好） */
export function onWoofLand(lat: number, lng: number): boolean {
  // 只看這個緯度那一條帶子裡的邊（海上的水波每一道都要看一次，整條市界跑一遍太慢）
  const bands = (landBands ??= bandEdges());
  const list = bands[Math.max(0, Math.min(LAND_BANDS - 1, Math.floor(((lat + 90) / 180) * LAND_BANDS)))];
  let inside = false;
  for (let k = 0; k < list.length; k += 4) {
    const [ya, xa, yb, xb] = [list[k], list[k + 1], list[k + 2], list[k + 3]];
    if (ya > lat !== yb > lat && lng < xa + ((lat - ya) * (xb - xa)) / (yb - ya)) inside = !inside;
  }
  return inside;
}
/** 市界的邊照緯度分成一條條帶子（每條帶子記住跨過它的邊：兩端的緯度、經度） */
const LAND_BANDS = 720;
let landBands: number[][] | null = null;
function bandEdges(): number[][] {
  const bands: number[][] = Array.from({ length: LAND_BANDS }, () => []);
  const band = (lat: number): number => Math.max(0, Math.min(LAND_BANDS - 1, Math.floor(((lat + 90) / 180) * LAND_BANDS)));
  for (const ring of WOOF_LAND) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ya, xa] = ring[i];
      const [yb, xb] = ring[j];
      for (let b = band(Math.min(ya, yb)); b <= band(Math.max(ya, yb)); b++) bands[b].push(ya, xa, yb, xb);
    }
  }
  return bands;
}

/** 汪星的經緯度 → 台北市的經緯度 */
const fromWoof = (lat: number, lng: number): [number, number] => [
  TP.lat0 + ((lat + 80) * (TP.lat1 - TP.lat0)) / 160,
  TP.lng0 + ((lng + 172) * (TP.lng1 - TP.lng0)) / 344,
];

/** 台北市的經緯度在不在市界裡面 */
function inTaipei(lat: number, lng: number): boolean {
  if (lat < TP.lat0 || lat > TP.lat1 || lng < TP.lng0 || lng > TP.lng1) return false;
  let inside = false;
  const r = TAIPEI_OUTLINE;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ya, xa] = r[i];
    const [yb, xb] = r[j];
    if (ya > lat !== yb > lat && lng < xa + ((lat - ya) * (xb - xa)) / (yb - ya)) inside = !inside;
  }
  return inside;
}

/**
 * 拉近時載入台北的街道（跟雷達一樣的圖磚）：涵蓋台北 (lat, lng) 方圓 km、範圍 rangeKm 決定用哪一級；
 * pending 是還沒抓到的圖磚，抓到了外面會重畫
 */
export type WoofStreets = (lat: number, lng: number, km: number, rangeKm: number) => { lines: StreetLine[]; pending: number } | null;

/** 畫面上的台北比這個小（半徑，公里，南北、東西平均）就載入街道：跟雷達 2 km 內一樣大街小巷都畫；比較大的用內建的國道、快速道路、幹道 */
export const WOOF_STREET_KM = 2;

/** 一條街換成汪星的經緯度，市界外面（海）的切掉、每 2 度一點（筆直的長街在球上是彎的）；圖磚記住的街道不變，算過的記起來 */
const woofOfStreet = new WeakMap<StreetLine, Array<Array<[number, number]>>>();
function streetOnWoof(l: StreetLine): Array<Array<[number, number]>> {
  let got = woofOfStreet.get(l);
  if (got) return got;
  got = [];
  let cur: Array<[number, number]> = [];
  for (let i = 0; i < l.pts.length; i += 2) {
    if (inTaipei(l.pts[i], l.pts[i + 1])) {
      cur.push(toWoof([l.pts[i], l.pts[i + 1]]));
      continue;
    }
    if (cur.length > 1) got.push(densify(cur));
    cur = [];
  }
  if (cur.length > 1) got.push(densify(cur));
  woofOfStreet.set(l, got);
  return got;
}

/**
 * 畫面上看得到的台北街道（粗線、細線）：畫面上的台北半徑超過 WOOF_STREET_KM、還沒載入、圖磚還沒全部抓到是 null（畫內建的道路）。
 * r 是汪星在雷達上的半徑：雷達外圈看得到的範圍決定畫多細，抓的範圍多留一點
 */
function woofStreetLines(center: LatLng, r: number, streets: WoofStreets): Record<StreetClass, Array<Array<[number, number]>>> | null {
  // 從球心看的角度（度）
  const a = Math.asin(Math.min(1, (viewReach() * 1.1) / r)) / RAD;
  const ring = Math.asin(Math.min(1, INNER / r)) / RAD;
  const top = Math.min(89, Math.abs(center.lat) + a);
  // 看得到的那一塊換成台北的經緯度範圍
  const [la0, ln0] = fromWoof(center.lat - a, center.lng - a / Math.cos(top * RAD));
  const [la1, ln1] = fromWoof(center.lat + a, center.lng + a / Math.cos(top * RAD));
  const kx = 111.32 * Math.cos(((TP.lat0 + TP.lat1) / 2) * RAD);
  const [hy, hx] = [((la1 - la0) / 2) * 110.574, ((ln1 - ln0) / 2) * kx];
  // 南北壓扁、東西拉寬：用兩個方向的平均決定畫多細（跟雷達的範圍一樣），抓的範圍要涵蓋比較大的那個方向
  const rangeKm = (Math.sqrt(hy * hx) * ring) / a;
  if (rangeKm > WOOF_STREET_KM) return null;
  // 整塊都在台北外面（海）：不用抓
  if (la1 < TP.lat0 || la0 > TP.lat1 || ln1 < TP.lng0 || ln0 > TP.lng1) return { major: [], minor: [] };
  const got = streets((la0 + la1) / 2, (ln0 + ln1) / 2, Math.max(hy, hx) * 1.05, rangeKm);
  if (!got || got.pending > 0) return null;
  const out: Record<StreetClass, Array<Array<[number, number]>>> = { major: [], minor: [] };
  for (const l of got.lines) {
    if (l.box[0] > la1 || l.box[2] < la0 || l.box[1] > ln1 || l.box[3] < ln0) continue;
    out[l.cls].push(...streetOnWoof(l));
  }
  return out;
}

/**
 * 陸地在看得到這一面的部分（ring 要逆時針）：海岸線轉到另一面的地方沿著球的邊緣走，從轉過去的地方逆時針走到下一個轉回來的地方
 * （陸地在海岸線的左手邊，往外走的左手邊就是邊緣的逆時針方向）；整圈都在另一面的，正中間在陸地上（centerOnLand）就整面都是陸地。
 * 陸地比半個球大也畫得對（landPath 是走不到半圈的那邊，只適合地球的大陸）。near：放大時切細
 */
export function hemiPath(center: LatLng, ring: Array<[number, number]>, rg: number, centerOnLand: boolean, near: Near | null = null): string {
  const pts = refine(ring, near, true).map(([lat, lng]) => ortho(center, lat, lng));
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
  woof: { km: WOOF_KM, min: 3.2, tint: '#c98f55' },
  mars: { km: 3_390, min: 3, tint: '#cf6c40' },
  jupiter: { km: 69_911, min: 6, tint: '#cfa77d' },
  saturn: { km: 58_232, min: 5, tint: '#ddc88e' },
  uranus: { km: 25_362, min: 4.2, tint: '#86cbd2' },
  neptune: { km: 24_622, min: 4.2, tint: '#5876d6' },
};

/** 天體的真實半徑（公里）：中心換到這顆時，最多放大到剛好看得到整顆 */
export const bodyRadiusKm = (key: string): number => LOOKS[key]?.km ?? 0;

/** 從一顆星球看另一顆在太空那一層的哪個方向（從黃道北邊正上方看，順時針、0 是上，度）：火箭飛過去時頭朝這邊 */
export function bodyBearing(from: string, to: string, when = new Date()): number {
  const pos = bodyPositions(when);
  const [a, b] = [pos.get(from) ?? [0, 0, 0], pos.get(to) ?? [0, 0, 0]];
  return Math.atan2(b[0] - a[0], b[1] - a[1]) / RAD;
}

/**
 * 中心換到這顆時最多放大到多少（雷達外圈幾公里）：剛好看得到整顆；汪星可以放大到 100 公尺看地表（海上的水波），正中間在中山公園附近可以到 0.5 公尺
 * （woofMap 是 false：還沒搭火箭過去、看不到地圖，跟別的星球一樣只到整顆）
 */
export const focusMinKm = (key: string, view?: SpaceView, woofMap = true): number => (key === 'woof' && woofMap ? (view && atPark(view) ? PARK_MIN_KM : WOOF_MIN_KM) : bodyRadiusKm(key) * 1.3);
/** 汪星（公園以外）最多拉近到多少：外圈 100 公尺（海上的水波外圈約 500 公尺內才長出來） */
export const WOOF_MIN_KM = 0.1;

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
 * 汪星畫成跟地球一樣的球：正射投影，地表是台北市（WOOF_LAND）：陸地淡淡填色，外面是海（淡淡的水色），
 * 道路（國道、快速道路粗線，主要幹道細線，夠大才畫）；山是另外一層的地形圖（paintWoofRelief）；不畫虛線（經緯線、海岸線、區界、球的邊），
 * 海岸和球的邊看陸地、海的顏色；夜晚那一半照太陽真正的方向（toSun：看的人的座標）。
 * 正中間的經緯度跟著視角轉：左右拖轉經度、上下拖轉緯度。中心是汪星時可以放大到 100 公尺（focusMinKm），
 * 拉近到畫面上的台北半徑 2 km 內換成大街小巷（streets：跟雷達一樣的圖磚）；中山公園描繪出來（草地花圃草綠色、映池和翠湖水藍色，拉近長出一叢叢的草、一道道的水波），那裡可以放大到 0.5 公尺，看得到的那一小塊線切細
 */
function woofGlobe(x: number, y: number, r: number, view: SpaceView, toSun: Vec3, streets?: WoofStreets): string {
  const center = woofCenter(view);
  const n = Math.hypot(...toSun) || 1;
  const near = view.focus === 'woof' ? nearOf(center, r) : null;
  // 畫面（球的座標：球心在 C）
  const [ox, oy] = [x - C, y - C];
  const [bx0, by0, bx1, by1] = viewRect(20);
  const box: [number, number, number, number] = [bx0 - ox, by0 - oy, bx1 - ox, by1 - oy];
  const lines = (ls: Array<Array<[number, number]>>): string => linesPath(center, ls, r, box, near);
  let out = '';
  // 陸地：填色和海岸線分開畫（放大很多時陸地比畫面大上千倍，整圈虛線要畫好幾秒）
  const land = WOOF_LAND.map((ring) => hemiPath(center, ring, r, onWoofLand(center.lat, center.lng), near)).join('');
  // 海：整顆汪星挖掉陸地（evenodd），淡淡的水色（陸地是半透明的，不能整顆鋪在下面）；
  // 放大很多時汪星比畫面大上千倍，雷達整個在球上就用畫面的範圍（太大的圓瀏覽器畫不準）
  const disc =
    r - Math.hypot(ox, oy) > viewReach() + 40
      ? `M${f1(box[0])} ${f1(box[1])}H${f1(box[2])}V${f1(box[3])}H${f1(box[0])}Z`
      : `M${f1(C - r)} ${f1(C)}A${f1(r)} ${f1(r)} 0 1 0 ${f1(C + r)} ${f1(C)}A${f1(r)} ${f1(r)} 0 1 0 ${f1(C - r)} ${f1(C)}Z`;
  out += `<path class="woof-sea" d="${disc}${land}" />`;
  // 汪星不畫虛線（經緯線、海岸線、區界、球的邊都不畫）：海岸和球的邊看陸地、海的顏色就看得出來
  if (land) out += `<path class="region-outline woof-land" d="${land}" />`;
  if (r >= 60) {
    // 拉近到畫面上的台北半徑 2 km 內：換成大街小巷（抓到圖磚之前先畫內建的）
    const fine = view.focus === 'woof' && streets ? woofStreetLines(center, r, streets) : null;
    out += `<path class="woof-road street-minor" d="${lines(fine?.minor ?? WOOF_MINOR_ROADS)}" />`;
    out += `<path class="woof-road street-major" d="${lines(fine?.major ?? WOOF_MAJOR_ROADS)}" />`;
  }
  // 海上的水波（跟公園的水池一樣，拉近到外圈約 500 公尺內才長出來；要飛過去當中心才畫）：照中山公園那裡攤平成公尺撒，不在陸地上的才畫
  if (view.focus === 'woof') {
    const O = WOOF_PARK.O;
    const waves = scatter(
      'ripple',
      { ppm: r / (WOOF_KM * 1000), center, rx: C - ox, ry: C - oy, at: (lat, lng) => { const [px, py, pz] = ortho(center, lat, lng); return pz > 0 ? [C + r * px, C - r * py] : null; } },
      O,
      [-1e9, -1e9, 1e9, 1e9],
      (x, y) => !onWoofLand(O.lat + y / O.my, O.lng + x / O.mx),
      2,
    );
    if (waves) out += `<path class="woof-ripple" transform="scale(0.1)" stroke-width="${(waves.w * 10).toFixed(1)}" d="${waves.d}" />`;
  }
  // 中山公園（park.ts，跟地球的雷達共用）：放大很多時只填看得到的那一小塊附近的；草和水波要飛過去當中心才畫
  const nearRing = (ring: Array<[number, number]>): boolean => !near || (ring.some(([a]) => a >= near.lat0) && ring.some(([a]) => a <= near.lat1) && ring.some(([, b]) => b >= near.lng0) && ring.some(([, b]) => b <= near.lng1));
  out += parkSvg(WOOF_PARK, {
    ppm: r / (WOOF_KM * 1000),
    center,
    rx: C - ox,
    ry: C - oy,
    textures: view.focus === 'woof',
    area: (rings) => rings.filter(nearRing).map((ring) => hemiPath(center, ring, r, false, near)).join(''),
    lines,
    at: (lat, lng) => {
      const [px, py, pz] = ortho(center, lat, lng);
      return pz > 0 ? [C + r * px, C - r * py] : null;
    },
  });
  out += `<path class="space-night" d="${nightFrom([toSun[0] / n, toSun[1] / n, toSun[2] / n], r)}" />`;
  return `<g class="space-globe" transform="translate(${f1(ox)} ${f1(oy)})">${out}</g>`;
}

/** 汪星的地形圖（woof-relief.webp 解開的像素）：寬、高、RGBA；經度 -172～172、緯度 80～-80 平均攤開（跟 toWoof 一樣） */
export interface ReliefTexture {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/**
 * 汪星的地形圖貼到球上（雷達下面另外一層 canvas，radar.ts 的 paintRelief）：out 是 n×n 的 RGBA（以圓心為中心、邊長 span 的正方形：
 * 平常是整個雷達的正方形，全螢幕鋪滿時大到蓋住整個長方形），
 * 每一個像素反推回汪星的經緯度（正射投影反過來，扣掉指北針轉的角度）去地形圖上取顏色，球外面、海是透明的。
 * 取顏色時附近四格照距離混在一起（拉近不會一格一格的）。中心要是汪星才畫；拉近慢慢變淡（外圈約 3 公里內開始，約 400 公尺內不畫），
 * 讓道路、公園清楚。回傳這一層要多不透明（0 是不用畫）
 */
export function paintWoofRelief(out: Uint8ClampedArray, n: number, tex: ReliefTexture, view: SpaceView, scaleKm: number, heading: number, j0 = 0, j1 = n, span = SIZE): number {
  if (view.focus !== 'woof') return 0;
  const r = (WOOF_KM * INNER) / scaleKm;
  const ppm = r / (WOOF_KM * 1000);
  const fade = Math.max(0, Math.min(1, 1 - Math.log(ppm / 0.05) / Math.log(0.4 / 0.05)));
  if (fade <= 0 || r < TINY_EARTH) return 0;
  const center = woofCenter(view);
  const p0 = center.lat * RAD;
  const [sp0, cp0] = [Math.sin(p0), Math.cos(p0)];
  const [ch, sh] = [Math.cos(heading * RAD), Math.sin(heading * RAD)];
  const s = span / n;
  const { w: tw, h: th, data } = tex;
  /** 雷達上第 (i, j) 個像素（可以是小數）在汪星上的經緯度；球外面是 null */
  const geo = (i: number, j: number): [number, number] | null => {
    const [dx, dy] = [i * s - span / 2, j * s - span / 2];
    // 雷達上的點 → 汪星那一層的座標（那一層跟著指北針轉了 -heading）→ 球上（半徑 1）
    const x = (ch * dx - sh * dy) / r;
    const y = -(sh * dx + ch * dy) / r;
    const d2 = x * x + y * y;
    if (d2 >= 1) return null;
    const z = Math.sqrt(1 - d2);
    const lat = Math.asin(Math.max(-1, Math.min(1, y * cp0 + z * sp0))) / RAD;
    let lng = center.lng + Math.atan2(x, z * cp0 - y * sp0) / RAD;
    if (lng > 180) lng -= 360;
    else if (lng < -180) lng += 360;
    return [lat, lng];
  };
  // 經緯度每 B 個像素精算一次（反三角函數很慢），中間照比例內插；四個角有一個在球外面、跨過經度 180 度就每一點都精算（球的邊、接縫）
  // 只畫 j0～j1 那幾列（radar.ts 畫細的時候分好幾次畫，不會卡住畫面）
  const B = 4;
  const m = Math.ceil(n / B) + 1;
  const g0 = Math.floor(j0 / B);
  const nodes: Array<[number, number] | null> = [];
  for (let gj = g0; gj <= Math.floor((j1 - 1) / B) + 1; gj++) for (let gi = 0; gi < m; gi++) nodes.push(geo(gi * B + 0.5, gj * B + 0.5));
  for (let j = j0; j < j1; j++) {
    const gj = Math.floor(j / B) - g0;
    const fj = (j - (gj + g0) * B) / B;
    for (let i = 0; i < n; i++) {
      const o = (j * n + i) * 4;
      const gi = Math.floor(i / B);
      const fi = (i - gi * B) / B;
      const [p00, p10, p01, p11] = [nodes[gj * m + gi], nodes[gj * m + gi + 1], nodes[(gj + 1) * m + gi], nodes[(gj + 1) * m + gi + 1]];
      let ll: [number, number] | null;
      if (p00 && p10 && p01 && p11 && Math.max(p00[1], p10[1], p01[1], p11[1]) - Math.min(p00[1], p10[1], p01[1], p11[1]) < 90) {
        const [w00, w10, w01, w11] = [(1 - fi) * (1 - fj), fi * (1 - fj), (1 - fi) * fj, fi * fj];
        ll = [p00[0] * w00 + p10[0] * w10 + p01[0] * w01 + p11[0] * w11, p00[1] * w00 + p10[1] * w10 + p01[1] * w01 + p11[1] * w11];
      } else ll = geo(i + 0.5, j + 0.5);
      if (!ll) {
        out[o + 3] = 0;
        continue;
      }
      const [lat, lng] = ll;
      // 地形圖上的位置（像素中心對齊），附近四格照距離混
      const fu = ((lng + 172) / 344) * tw - 0.5;
      const fv = ((80 - lat) / 160) * th - 0.5;
      if (fu < -0.5 || fu > tw - 0.5 || fv < -0.5 || fv > th - 0.5) {
        out[o + 3] = 0;
        continue;
      }
      const u0 = Math.max(0, Math.min(tw - 2, Math.floor(fu)));
      const v0 = Math.max(0, Math.min(th - 2, Math.floor(fv)));
      const a = Math.max(0, Math.min(1, fu - u0));
      const b = Math.max(0, Math.min(1, fv - v0));
      const t00 = (v0 * tw + u0) * 4;
      const t10 = t00 + 4;
      const t01 = t00 + tw * 4;
      const t11 = t01 + 4;
      const [w00, w10, w01, w11] = [(1 - a) * (1 - b), a * (1 - b), (1 - a) * b, a * b];
      for (let c = 0; c < 4; c++) out[o + c] = data[t00 + c] * w00 + data[t10 + c] * w10 + data[t01 + c] * w01 + data[t11 + c] * w11;
    }
  }
  return fade;
}

/**
 * 太陽系那幾層的看法：中心是哪一顆（null 是地球、你）、繞著中心左右轉幾度、往下傾斜幾度（0 是從黃道北邊正上方往下看）；
 * toward、u：中心從這一顆往 toward（'earth'、'woof'…）移了多少（0～1，火箭飛過去時鏡頭跟著走）
 */
export interface SpaceView {
  focus: string | null;
  yaw: number;
  pitch: number;
  toward?: string;
  u?: number;
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
  /** 汪星拉近時載入台北的街道；沒給就只畫內建的道路 */
  streets?: WoofStreets;
  /** 你在哪一顆（搭火箭到汪星就在汪星，點別的星球只是看過去，不會回到地球）；沒給是地球 */
  you?: 'earth' | 'woof';
  /** 汪星的地圖（台北的陸地、道路、中山公園）看不看得到：false 是你在地球、火箭還沒飛過去，汪星畫成普通的星球；沒給是看得到 */
  woofMap?: boolean;
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
  const F0 = (view.focus && pos.get(view.focus)) || ([0, 0, 0] as Vec3);
  // 鏡頭從中心那一顆往 toward 移了 u（火箭飛行）
  const T = view.toward ? pos.get(view.toward) : undefined;
  const u = T ? (view.u ?? 0) : 0;
  const F: Vec3 = T ? [F0[0] + (T[0] - F0[0]) * u, F0[1] + (T[1] - F0[1]) * u, F0[2] + (T[2] - F0[2]) * u] : F0;
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
  // 全螢幕鋪滿時看整個長方形，平常看圓裡面
  const inView = (x: number, y: number, r = 0): boolean =>
    RADAR_VIEW.fill ? Math.abs(x - C) - r <= RADAR_VIEW.hx && Math.abs(y - C) - r <= RADAR_VIEW.hy : Math.hypot(x - C, y - C) - r <= INNER;
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
  // 你在哪一顆（中心是你在的地球時，雷達中間的圓點就是你，不另外標）
  const you = o.you === 'woof' ? 'woof' : view.focus ? 'earth' : null;
  for (const b of list) {
    // 汪星大到看得出形狀：跟地球一樣畫成球（地圖要搭火箭飛過去才看得到，之前是普通的星球）
    const look = b.key === 'woof' && b.r >= TINY_EARTH && o.woofMap !== false ? woofGlobe(b.x, b.y, b.r, view, rot(sub(sun, pos.get('woof')!)), o.streets) : bodySvg(b.key, b.x, b.y, b.r, b.key === 'sun' ? null : sunAt);
    // 點星球飛過去：點擊範圍至少半徑 12
    bodies += `<g class="space-hit" data-body="${b.key}"><circle class="hit" cx="${f1(b.x)}" cy="${f1(b.y)}" r="${f1(Math.max(b.r + 3, 12))}" />${look}</g>`;
    // 中心換到別的星球：雷達中間的圓點不是你，你畫在你在的那一顆（地球；在汪星上是汪星，汪星大到畫成球時不畫）
    const here = b.key === you;
    if (here && b.r < TINY_EARTH) bodies += `<circle class="space-me" cx="${f1(b.x)}" cy="${f1(b.y)}" r="3" />`;
    const name = `${b.key === 'earth' ? '地球' : NAMES[b.key]}${here ? '（你）' : ''}`;
    const r = b.key === 'saturn' ? b.r * 2.2 : b.key === 'sun' ? b.r + 5 : b.r;
    named.push({ x: b.x, y: b.y, r, cls: b.key, name, force: here });
  }
  // 名字照順序放：你在的那一顆（地球（你）、汪星（你））最優先，再來是中心那顆、太陽
  const rank = (b: Body): number => (b.force ? 0 : b.cls === view.focus ? 1 : b.cls === 'sun' ? 2 : 3);
  named.sort((a, b) => rank(a) - rank(b));
  // 地球大到看得出形狀時（從正上方看你）不寫名字
  return `${lines}${bodies}${labels(named.filter((b) => !(b.cls === 'earth' && !view.focus && o.rg >= 24)))}`;
}
