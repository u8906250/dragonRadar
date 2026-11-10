/**
 * 雷達從「全球」再拉遠就是太空（第一次用到才載入）：跟雷達平常一樣用虛線畫，畫成 SVG 字串放在海岸線那一層。
 * - 地球：以你為中心、從太空看的地球（正射投影），海岸線、經緯線，夜晚的那一半照現在時間淡淡變暗
 * - 再拉遠：月球的軌道和月球，太陽、行星和它們的軌道（以地球為中心，距離照真實比例，位置照今天推算）
 */
import type { LatLng } from './geo';
import { BOTTLE_PATH, DEEP_FROM_KM, LY_KM, RADAR_GEOM, RADAR_VIEW, TINY_EARTH, viewReach, viewRect } from './radar';
import type { StreetClass, StreetLine } from './streets';
import { nearPark, PARK_MIN_KM, parkGeom, parkSvg, ringArea, scatter } from './park';
import { TAIPEI_MAJOR_ROADS, TAIPEI_MINOR_ROADS, TAIPEI_OUTLINE } from './taipei';
import { TAIPEI_HILLS } from './taipei-hills';
import { ZHONGSHAN_PARK } from './zhongshan';

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
/** 台北市的經緯度 → 汪星的經緯度（平的：整個市界照經緯度攤開） */
const toWoofFlat = ([lat, lng]: [number, number]): [number, number] => [
  -80 + (160 * (lat - TP.lat0)) / (TP.lat1 - TP.lat0),
  -172 + (344 * (lng - TP.lng0)) / (TP.lng1 - TP.lng0),
];
/** 汪星的經緯度 → 台北市的經緯度（平的） */
const fromWoofFlat = (lat: number, lng: number): [number, number] => [
  TP.lat0 + ((lat + 80) * (TP.lat1 - TP.lat0)) / 160,
  TP.lng0 + ((lng + 172) * (TP.lng1 - TP.lng0)) / 344,
];

/**
 * 中山公園附近不要被拉長（使用者要的：跟地球的差不多）：平的攤法在公園那裡東西向是真的 1.6 倍、南北向 0.66 倍，
 * 所以換到汪星之前，先把公園附近的台北經緯度像放大鏡一樣校正：公園中心 WARP_R0 公尺內東西向縮 WARP_X、南北向放大 WARP_Y
 * （兩個相乘是 1，面積不變），汪星上就跟地球一樣的比例（約真實的 1.04 倍）；WARP_R0～WARP_R1 之間慢慢回到平的（smoothstep，
 * 這一圈的街道會有一點彎），更遠的跟以前一樣。汪星上的東西都經過 toWoof、fromWoof（地形圖取顏色也是），所以一樣對得齊
 */
const WARP_C: [number, number] = [
  (Math.min(...ZHONGSHAN_PARK.outline.map((p) => p[0])) + Math.max(...ZHONGSHAN_PARK.outline.map((p) => p[0]))) / 2,
  (Math.min(...ZHONGSHAN_PARK.outline.map((p) => p[1])) + Math.max(...ZHONGSHAN_PARK.outline.map((p) => p[1]))) / 2,
];
const WARP_R0 = 600;
const WARP_R1 = 2600;
const WARP_KX = 111_320 * Math.cos(WARP_C[0] * RAD);
const WARP_KY = 110_574;
/** 平的攤法在公園那裡東西、南北每公尺換到汪星上的比例（只要兩個的比，跟汪星多大無關），校正成一樣 */
const [WARP_X, WARP_Y] = (() => {
  const sx = ((344 / (TP.lng1 - TP.lng0)) * Math.cos(toWoofFlat(WARP_C)[0] * RAD)) / WARP_KX;
  const sy = 160 / (TP.lat1 - TP.lat0) / WARP_KY;
  return [Math.sqrt(sy / sx), Math.sqrt(sx / sy)];
})();
/** 校正的程度（離公園中心 r 公尺）：WARP_R0 內是 1，到 WARP_R1 慢慢變 0；和它對 r 的微分 */
const warpW = (r: number): number => {
  if (r <= WARP_R0) return 1;
  if (r >= WARP_R1) return 0;
  const t = (r - WARP_R0) / (WARP_R1 - WARP_R0);
  return 1 - t * t * (3 - 2 * t);
};
const warpDW = (r: number): number => {
  if (r <= WARP_R0 || r >= WARP_R1) return 0;
  const t = (r - WARP_R0) / (WARP_R1 - WARP_R0);
  return (6 * t * t - 6 * t) / (WARP_R1 - WARP_R0);
};
/** 校正：台北的經緯度 → 換到汪星之前的台北經緯度 */
function warp([lat, lng]: [number, number]): [number, number] {
  const [x, y] = [(lng - WARP_C[1]) * WARP_KX, (lat - WARP_C[0]) * WARP_KY];
  const w = warpW(Math.hypot(x, y));
  if (w === 0) return [lat, lng];
  return [WARP_C[0] + (y * (1 + w * (WARP_Y - 1))) / WARP_KY, WARP_C[1] + (x * (1 + w * (WARP_X - 1))) / WARP_KX];
}
/** 校正倒回去（牛頓法，幾次就收斂；校正碰不到的地方原樣） */
function unwarp(p: [number, number]): [number, number] {
  const [lat, lng] = p;
  const [u, v] = [(lng - WARP_C[1]) * WARP_KX, (lat - WARP_C[0]) * WARP_KY];
  if (Math.hypot(u, v) >= WARP_R1 * Math.max(WARP_X, WARP_Y, 1)) return p;
  let [x, y] = [u / WARP_X, v / WARP_Y];
  for (let k = 0; k < 12; k++) {
    const r = Math.hypot(x, y) || 1e-9;
    const [w, dw] = [warpW(r), warpDW(r)];
    const [gx, gy] = [1 + w * (WARP_X - 1), 1 + w * (WARP_Y - 1)];
    const [fx, fy] = [x * gx - u, y * gy - v];
    if (Math.abs(fx) < 1e-6 && Math.abs(fy) < 1e-6) break;
    const [ax, ay] = [(x * (WARP_X - 1) * dw) / r, (y * (WARP_Y - 1) * dw) / r];
    const [j11, j12, j21, j22] = [gx + ax * x, ax * y, ay * x, gy + ay * y];
    const det = j11 * j22 - j12 * j21 || 1e-9;
    x -= (fx * j22 - fy * j12) / det;
    y -= (fy * j11 - fx * j21) / det;
  }
  return [WARP_C[0] + y / WARP_KY, WARP_C[1] + x / WARP_KX];
}
/** 台北市的經緯度 → 汪星的經緯度（公園附近校正過） */
export const toWoof = (p: [number, number]): [number, number] => toWoofFlat(warp(p));
/** 汪星的經緯度 → 台北市的經緯度 */
export const fromWoof = (lat: number, lng: number): [number, number] => unwarp(fromWoofFlat(lat, lng));

/** 校正那一圈裡的線先在台北的經緯度上切細（每段 WARP_STEP_M 公尺內），換到汪星上才會跟著彎；closed 是一圈 */
const WARP_STEP_M = 50;
function warpDense(pts: Array<[number, number]>, closed = false): Array<[number, number]> {
  const m = (p: [number, number]): [number, number] => [(p[1] - WARP_C[1]) * WARP_KX, (p[0] - WARP_C[0]) * WARP_KY];
  const out: Array<[number, number]> = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    out.push(a);
    const [[ax, ay], [bx, by]] = [m(a), m(b)];
    const [dx, dy] = [bx - ax, by - ay];
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(ax + dx * t, ay + dy * t) >= WARP_R1) continue;
    const k = Math.ceil(Math.hypot(dx, dy) / WARP_STEP_M);
    for (let j = 1; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed && pts.length) out.push(pts[pts.length - 1]);
  return out;
}

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


/** 台北的一圈換到汪星上（公園附近跟著校正彎過去、每 2 度一點）：逆時針，裡面在左手邊 */
const woofRing = (r: Array<[number, number]>): Array<[number, number]> => {
  const ring = densify(warpDense(r, true).map(toWoof), true);
  return ringArea(ring) < 0 ? ring.reverse() : ring;
};
/** 汪星的陸地（市界）：逆時針，陸地在海岸線的左手邊 */
export const WOOF_LAND: Array<Array<[number, number]>> = [TAIPEI_OUTLINE].map(woofRing);
/** 汪星的山（taipei-hills.ts）：一層一層的等高色塊，低的先畫；每一圈多記經緯度的範圍（判斷正中間在不在裡面先看範圍） */
export const WOOF_HILLS = TAIPEI_HILLS.map((b) =>
  b.rings.map((r) => {
    const ring = woofRing(r);
    const lats = ring.map(([a]) => a);
    const lngs = ring.map(([, b]) => b);
    return { ring, box: [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)] as const };
  }),
);
/** 這一點在不在這一圈裡面（汪星的經緯度，山不會跨過接縫和南北極，照平面算） */
const inRing = (lat: number, lng: number, ring: Array<[number, number]>): boolean => {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [ya, xa] = ring[a];
    const [yb, xb] = ring[b];
    if (ya > lat !== yb > lat && lng < xa + ((lat - ya) * (xb - xa)) / (yb - ya)) inside = !inside;
  }
  return inside;
};
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
const woofLines = (lines: Array<Array<[number, number]>>): Array<Array<[number, number]>> => lines.map((l) => densify(warpDense(l).map(toWoof)));

const WOOF_MAJOR_ROADS = woofLines(TAIPEI_MAJOR_ROADS);
const WOOF_MINOR_ROADS = woofLines(TAIPEI_MINOR_ROADS);

/** 中山公園（park.ts，跟地球的雷達共用）換到汪星上：台北的經緯度攤開成汪星的、每 2 度一點，草和水波的大小是汪星上的公尺 */
const WOOF_PARK = parkGeom({ name: 'woof', to: toWoof, my: WOOF_KM * 1000 * RAD, mx: (lat) => WOOF_KM * 1000 * RAD * Math.cos(lat * RAD), densify });

/** 汪星正中間的經緯度：跟著視角轉，左右拖轉經度、上下拖轉緯度（你在汪星時，這裡就是你的位置：撿漂流瓶照這裡算距離） */
export const woofCenter = (view: SpaceView): LatLng => ({ lat: Math.max(-80, Math.min(80, view.pitch / RAD)), lng: norm180(-view.yaw / RAD) });

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
  // 看得到的那一塊換成台北的經緯度範圍（公園附近校正過不是直的：看九個點）
  const grid = [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => fromWoof(center.lat + i * a, center.lng + (j * a) / Math.cos(top * RAD))));
  const [la0, la1] = [Math.min(...grid.map((q) => q[0])), Math.max(...grid.map((q) => q[0]))];
  const [ln0, ln1] = [Math.min(...grid.map((q) => q[1])), Math.max(...grid.map((q) => q[1]))];
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

/** Kepler-22b 的半徑：約地球的 2.1 倍（2023 年修正） */
const KEPLER22B_KM = 13_380;
/** 天體的真實半徑（公里）、拉遠時最小畫多大（SVG 單位），淡淡的顏色（線條跟雷達一樣，顏色只是讓人認得出來） */
const LOOKS: Record<string, { km: number; min: number; tint: string }> = {
  sun: { km: 696_340, min: 6, tint: '' },
  mercury: { km: 2_440, min: 2.6, tint: '#a39e96' },
  venus: { km: 6_052, min: 3.4, tint: '#dcbf78' },
  earth: { km: 6_371, min: 3.6, tint: '#5b95d6' },
  moon: { km: 1_737, min: 2.2, tint: '#b3afa7' },
  woof: { km: WOOF_KM, min: 3.2, tint: '#6fa34f' },
  mars: { km: 3_390, min: 3, tint: '#cf6c40' },
  jupiter: { km: 69_911, min: 6, tint: '#cfa77d' },
  saturn: { km: 58_232, min: 5, tint: '#ddc88e' },
  uranus: { km: 25_362, min: 4.2, tint: '#86cbd2' },
  neptune: { km: 24_622, min: 4.2, tint: '#5876d6' },
  // Kepler-22b：表面什麼樣子沒有人知道，可能是海洋行星，淡藍色是示意
  kepler22b: { km: KEPLER22B_KM, min: 3, tint: '#5fa8d8' },
};

/** 天體的真實半徑（公里）：中心換到這顆時，最多放大到剛好看得到整顆 */
export const bodyRadiusKm = (key: string): number => LOOKS[key]?.km ?? deepRadiusKm(key);

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
 * 汪星畫成跟地球一樣的球：正射投影，地表是台北市（WOOF_LAND）：陸地鋪滿草地的綠色，外面是海（淡淡的水色），
 * 道路（國道、快速道路粗線，主要幹道細線，夠大才畫）；山是一層一層的等高色塊（WOOF_HILLS，越高越深、最高的偏土黃，跟陸地一樣是線條畫的，放大縮小都清楚）；不畫虛線（經緯線、海岸線、區界、球的邊），
 * 海岸和球的邊看陸地、海的顏色；夜晚那一半照太陽真正的方向（toSun：看的人的座標）。
 * 正中間的經緯度跟著視角轉：左右拖轉經度、上下拖轉緯度。中心是汪星時可以放大到 100 公尺（focusMinKm），
 * 拉近到畫面上的台北半徑 2 km 內換成大街小巷（streets：跟雷達一樣的圖磚）；中山公園描繪出來（草地花圃草綠色、映池和翠湖水藍色，拉近長出一叢叢的草、一道道的水波），那裡可以放大到 0.5 公尺，看得到的那一小塊線切細
 */
function woofGlobe(x: number, y: number, r: number, view: SpaceView, toSun: Vec3, streets?: WoofStreets, bottles?: WoofBottleMark[]): string {
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
  // 山：一層一層疊上去（低的先畫），放大很多時只畫畫面附近的
  WOOF_HILLS.forEach((band, i) => {
    const d = band
      .filter(({ box }) => !near || (box[2] >= near.lat0 && box[0] <= near.lat1 && box[3] >= near.lng0 && box[1] <= near.lng1))
      .map(({ ring, box }) => hemiPath(center, ring, r, center.lat >= box[0] && center.lat <= box[2] && center.lng >= box[1] && center.lng <= box[3] && inRing(center.lat, center.lng, ring), near))
      .join('');
    if (d) out += `<path class="woof-hill h${i + 1}" d="${d}" />`;
  });
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
  // 漂到汪星海上的漂流瓶（v1.593）：畫在夜晚上面（晚上也看得到），朝著你的這一面才畫；大小不跟著縮放
  for (const b of bottles ?? []) {
    const [px, py, pz] = ortho(center, b.lat, b.lng);
    if (pz <= 0) continue;
    const cls = `bottle woof-bottle bottle-${b.state}${b.mine ? ' mine' : ''}${b.taken ? ' picked' : ''}${b.selected ? ' selected' : ''}`;
    out +=
      `<g class="${cls}" data-id="${b.id}" transform="translate(${f1(C + r * px)} ${f1(C - r * py)})" tabindex="0" role="button">` +
      `<circle class="hit" r="14" />${b.state === 'pick' ? '<circle class="reach" r="9" />' : ''}` +
      `<g class="body"><path class="glass" d="${BOTTLE_PATH}" transform="rotate(-20)" /></g><title>${b.mine ? '你丟的漂流瓶' : b.taken ? '漂流瓶（已經被收藏了）' : b.state === 'pick' ? '漂流瓶（走到附近了）' : '漂流瓶'}</title></g>`;
  }
  return `<g class="space-globe" transform="translate(${f1(ox)} ${f1(oy)})">${out}</g>`;
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
  /** 漂到汪星海上的漂流瓶（汪星的地圖看得到時才畫） */
  bottles?: WoofBottleMark[];
}

/** 汪星海上的漂流瓶：汪星的經緯度；pick 是你在汪星、走到撿得到的距離了 */
export interface WoofBottleMark {
  id: number;
  lat: number;
  lng: number;
  state: 'near' | 'pick';
  mine: boolean;
  selected: boolean;
  /** 已經被收藏了（淡淡的） */
  taken?: boolean;
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

/*
 * 太陽系外面（第 1 號願望，點子來自 jy：「能否產生 Kepler 22-b 這個星球；如果在其他星系，就讓雷達可以繼續縮小到可以看到其他星系」，v1.582）：
 * Kepler-22b 在銀河系裡（天鵝座，約 640 光年），使用者說「可以多畫幾個星系，先不用飛過去看」，所以再畫銀河系和本星系群的幾個大星系。
 * 位置照真實的赤經、赤緯、距離（換成跟行星一樣的黃道座標，以地球為中心；這麼遠以太陽為中心也一樣），大小照真實的直徑；
 * 銀河系的旋臂、星系的樣子是示意（只畫外框、核心、兩條或四條旋臂），星系盤的傾斜照觀測的傾角、方位角
 */
/** 黃赤交角（J2000，度） */
const OBLIQUITY = 23.4393;
/** 赤道座標的方向 → 黃道座標（x 春分點、z 黃道北極，跟 planetPositions 一樣） */
const eqToEclVec = (v: Vec3): Vec3 => {
  const e = OBLIQUITY * RAD;
  return [v[0], v[1] * Math.cos(e) + v[2] * Math.sin(e), -v[1] * Math.sin(e) + v[2] * Math.cos(e)];
};
/** 赤經（小時）、赤緯（度）的單位向量（赤道座標） */
const eqDir = (raH: number, decDeg: number): Vec3 => {
  const [a, d] = [raH * 15 * RAD, decDeg * RAD];
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
};
/** 赤經（小時）、赤緯（度）→ 黃道座標的單位向量 */
export const eclDir = (raH: number, decDeg: number): Vec3 => eqToEclVec(eqDir(raH, decDeg));
const scale3 = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * 星系盤的兩個方向（黃道座標的單位向量）：長軸在天空上的方位角 pa（從北往東量），盤面跟天空斜 incl 度；
 * 照這兩個方向畫一圈，從地球看是長短軸比 cos(incl) 的橢圓
 */
function diskAxes(raH: number, decDeg: number, pa: number, incl: number): [Vec3, Vec3] {
  const [a, d] = [raH * 15 * RAD, decDeg * RAD];
  const los = eqDir(raH, decDeg);
  const north: Vec3 = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
  const east: Vec3 = [-Math.sin(a), Math.cos(a), 0];
  const [cp, sp, ci, si] = [Math.cos(pa * RAD), Math.sin(pa * RAD), Math.cos(incl * RAD), Math.sin(incl * RAD)];
  const major = add3(scale3(north, cp), scale3(east, sp));
  const minorSky = add3(scale3(north, -sp), scale3(east, cp));
  return [eqToEclVec(major), eqToEclVec(add3(scale3(minorSky, ci), scale3(los, si)))];
}

/**
 * Kepler-22b：繞類太陽恆星 Kepler-22（天鵝座，赤經 19h16m52s、赤緯 +47°53′），離地球約 640 光年（Wikipedia）。
 * 軌道 0.849 AU、289.863876 天一圈，BJD 2454966.7001 從恆星前面經過（凌日，那時在恆星和地球中間）；半徑約地球 2.1 倍（2023 年修正），
 * 恆星半徑 0.979 個太陽（Wikipedia、NASA 系外行星資料庫）
 */
export const KEPLER22 = { ra: 19 + 16 / 60 + 52.19 / 3600, dec: 47 + 53 / 60 + 3.9 / 3600, ly: 640, aAu: 0.849, periodDays: 289.863876, transitJd: 2454966.7001, planetKm: KEPLER22B_KM, starKm: 0.979 * 696_340 };
/** 銀河系：中心（人馬座 A*，赤經 17h45m40s、赤緯 −29°00′）離我們約 26,670 光年，北銀極赤經 12h51m26s、赤緯 +27°07′42″，直徑約 10 萬光年 */
const MILKY_WAY = { ra: 17 + 45 / 60 + 40.04 / 3600, dec: -(29 + 0 / 60 + 28.1 / 3600), ly: 26_670, poleRa: 12 + 51 / 60 + 26.28 / 3600, poleDec: 27 + 7 / 60 + 42 / 3600, r: 50_000 };
/**
 * 本星系群的大星系（Wikipedia）：位置、距離、半徑（光年）、盤面的方位角和傾角（度）；麥哲倫雲是不規則星系，畫成橢圓（示意）
 */
export const GALAXIES: Array<{ key: string; name: string; ra: number; dec: number; ly: number; r: number; pa: number; incl: number; arms: number }> = [
  { key: 'lmc', name: '大麥哲倫雲', ra: 5 + 23 / 60 + 34.5 / 3600, dec: -(69 + 45 / 60 + 22 / 3600), ly: 163_000, r: 16_100, pa: 170, incl: 35, arms: 0 },
  { key: 'smc', name: '小麥哲倫雲', ra: 0 + 52 / 60 + 44.8 / 3600, dec: -(72 + 49 / 60 + 43 / 3600), ly: 203_000, r: 9_450, pa: 45, incl: 60, arms: 0 },
  { key: 'm31', name: '仙女座星系', ra: 0 + 42 / 60 + 44.3 / 3600, dec: 41 + 16 / 60 + 9 / 3600, ly: 2_500_000, r: 76_000, pa: 38, incl: 77, arms: 2 },
  { key: 'm33', name: '三角座星系', ra: 1 + 33 / 60 + 50.02 / 3600, dec: 30 + 39 / 60 + 36.7 / 3600, ly: 2_730_000, r: 30_550, pa: 23, incl: 54, arms: 2 },
];
/** 旋臂（示意）：對數螺線，傾角 12 度 */
const ARM_B = Math.tan(12 * RAD);

/**
 * 盤面上的一圈、核心、旋臂（示意）：center 是盤的中心（公里），u、v 是盤面的兩個方向，r 是半徑（公里）；
 * 旋臂從 r0 繞出去到外圈，arms 條平均分開，phase 是第一條的起點角度。照 v 轉的方向是 u 往 v（逆時針看 u × v 那一面）
 */
function diskLines(center: Vec3, u: Vec3, v: Vec3, r: number, arms: number, r0: number, phase: number): { rim: Vec3[]; core: Vec3[]; arms: Vec3[][] } {
  const at = (rr: number, t: number): Vec3 => add3(center, add3(scale3(u, rr * Math.cos(t)), scale3(v, rr * Math.sin(t))));
  const ring = (rr: number, n: number): Vec3[] => Array.from({ length: n }, (_, i) => at(rr, (i / n) * 2 * Math.PI));
  const span = Math.log(r / r0) / ARM_B;
  const out: Vec3[][] = [];
  for (let j = 0; j < arms; j++) {
    const t0 = phase + (j * 2 * Math.PI) / arms;
    const pts: Vec3[] = [];
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * span;
      pts.push(at(r0 * Math.exp(ARM_B * t), t0 + t));
    }
    out.push(pts);
  }
  return { rim: ring(r, 96), core: ring(r0, 32), arms: out };
}

/**
 * 銀河系：中心在人馬座 A* 的方向，盤面照北銀極；我們（太陽）在盤上離中心 26,670 光年。
 * 四條旋臂（示意）：從棒的兩端（約 6,000 光年）往外繞，太陽夾在兩條中間（人馬臂、英仙臂之間的獵戶臂一帶），往後拖（銀河系從北銀極看順時針轉）
 */
let milkyWayCache: { center: Vec3; lines: ReturnType<typeof diskLines> } | null = null;
function milkyWay(): { center: Vec3; lines: ReturnType<typeof diskLines> } {
  if (milkyWayCache) return milkyWayCache;
  const g1 = eclDir(MILKY_WAY.ra, MILKY_WAY.dec);
  const pole = eclDir(MILKY_WAY.poleRa, MILKY_WAY.poleDec);
  // 盤面的另一個方向（銀經 90 度，天鵝座那邊）
  const g2 = cross3(pole, g1);
  const center = scale3(g1, MILKY_WAY.ly * LY_KM);
  const r0 = 6_000;
  // 太陽在中心的反方向（角度 π）：讓那裡剛好在兩條旋臂中間
  const phase = Math.PI - Math.log(MILKY_WAY.ly / r0) / ARM_B + Math.PI / 4;
  milkyWayCache = { center, lines: diskLines(center, g1, g2, MILKY_WAY.r * LY_KM, 4, r0 * LY_KM, phase) };
  return milkyWayCache;
}

/** 恆星 Kepler-22 的位置（公里，以地球為中心的黃道座標） */
const kepler22Star = (): Vec3 => scale3(eclDir(KEPLER22.ra, KEPLER22.dec), KEPLER22.ly * LY_KM);
/**
 * Kepler-22b 的軌道：我們從側面看（傾角 89.76 度，所以看得到凌日），軌道面包含地球看過去的方向；
 * 繞著這個方向還能轉多少看不出來（示意：取從黃道北邊看最開的那一面）。凌日那一刻行星在恆星往地球那一邊
 */
function keplerOrbit(): { star: Vec3; u: Vec3; w: Vec3 } {
  const star = kepler22Star();
  const los = eclDir(KEPLER22.ra, KEPLER22.dec);
  const z: Vec3 = [0, 0, 1];
  const w0 = cross3(z, los);
  const n = Math.hypot(...w0);
  return { star, u: scale3(los, -1), w: scale3(w0, 1 / n) };
}
/** Kepler-22b 這一刻的位置（公里）：照凌日的時間和週期算轉到哪（圓軌道） */
export function keplerPlanet(when: Date): Vec3 {
  const { star, u, w } = keplerOrbit();
  const jd = when.getTime() / 86_400_000 + 2440587.5;
  const t = (2 * Math.PI * (jd - KEPLER22.transitJd)) / KEPLER22.periodDays;
  const a = KEPLER22.aAu * AU_KM;
  return add3(star, add3(scale3(u, a * Math.cos(t)), scale3(w, a * Math.sin(t))));
}

/** 太陽系外面可以點、當中心的（第 2 號願望：Kepler-22b、星系也可以點，然後放大） */
const DEEP_KEYS = new Set(['kepler22b', 'milkyway', ...GALAXIES.map((g) => g.key)]);
export const isDeepBody = (key: string): boolean => DEEP_KEYS.has(key);
/** 太陽系外面的東西的位置（公里）：Kepler-22b、星系的中心 */
function deepPosition(key: string, when: Date): Vec3 | undefined {
  if (key === 'kepler22b') return keplerPlanet(when);
  if (key === 'milkyway') return milkyWay().center;
  const g = GALAXIES.find((x) => x.key === key);
  return g ? scale3(eclDir(g.ra, g.dec), g.ly * LY_KM) : undefined;
}
/** 太陽系外面的東西的半徑（公里）：中心換到這裡時最多放大到剛好看得到整個 */
function deepRadiusKm(key: string): number {
  if (key === 'kepler22b') return KEPLER22.planetKm;
  if (key === 'milkyway') return MILKY_WAY.r * LY_KM;
  const g = GALAXIES.find((x) => x.key === key);
  return g ? g.r * LY_KM : 0;
}

/**
 * 中心是 Kepler-22b、拉近到太陽系的大小以內：恆星 Kepler-22（像太陽一樣有光芒）、軌道（虛線）、行星照真實大小（太小就畫最小的大小，背對恆星那一半變暗）
 */
function keplerSystemMarkup(proj: (p: Vec3) => { x: number; y: number; d: number }, k: number, inView: (x: number, y: number, r?: number) => boolean, when: Date): string {
  const { star, u, w } = keplerOrbit();
  const a = KEPLER22.aAu * AU_KM;
  let out = '';
  if (a * k >= 6 && a * k <= INNER * 12) {
    const pts = Array.from({ length: 128 }, (_, i) => {
      const t = (i / 128) * 2 * Math.PI;
      const q = proj(add3(star, add3(scale3(u, a * Math.cos(t)), scale3(w, a * Math.sin(t)))));
      return `${f1(q.x)} ${f1(q.y)}`;
    });
    out += `<path class="region-outline open space-orbit" d="M${pts.join('L')}Z" />`;
  }
  const sq = proj(star);
  const sr = Math.max(6, KEPLER22.starKm * k);
  const pq = proj(keplerPlanet(when));
  const pr = Math.max(3, KEPLER22.planetKm * k);
  const named: Body[] = [];
  const draw = [
    { key: 'kepler22', q: sq, r: sr, svg: bodySvg('sun', sq.x, sq.y, sr, null), name: 'Kepler-22', lr: sr + 5 },
    { key: 'kepler22b', q: pq, r: pr, svg: bodySvg('kepler22b', pq.x, pq.y, pr, sq), name: 'Kepler-22b', lr: pr },
  ].sort((x, y) => x.q.d - y.q.d);
  for (const b of draw) {
    if (!inView(b.q.x, b.q.y, b.r)) continue;
    out += b.key === 'kepler22b' ? `<g class="space-hit" data-body="kepler22b"><circle class="hit" cx="${f1(b.q.x)}" cy="${f1(b.q.y)}" r="${f1(Math.max(b.r + 3, 12))}" />${b.svg}</g>` : b.svg;
    named.push({ x: b.q.x, y: b.q.y, r: b.lr, cls: b.key, name: b.name, force: b.key === 'kepler22b' });
  }
  return `${out}${labels(named)}`;
}

/**
 * 太陽系外面那幾層（雷達外圈超過 DEEP_FROM_KM）：太陽系縮成一個點（你在這裡），Kepler-22b、銀河系、本星系群的星系；
 * proj 跟太陽系一樣（看法、中心都一樣），太小的星系畫成一個點，離太陽系太近（疊在一起）的不畫
 */
function deepMarkup(proj: (p: Vec3) => { x: number; y: number; d: number }, k: number, inView: (x: number, y: number, r?: number) => boolean, sunAt: { x: number; y: number }, F: Vec3, focus: string | null, when: Date): { lines: string; bodies: string; named: Body[] } {
  let lines = '';
  let bodies = '';
  const named: Body[] = [];
  const pathOf = (pts: Vec3[], closed: boolean): string => `M${pts.map((p) => { const q = proj(p); return `${f1(q.x)} ${f1(q.y)}`; }).join('L')}${closed ? 'Z' : ''}`;
  const apart = (q: { x: number; y: number }, min: number): boolean => Math.hypot(q.x - sunAt.x, q.y - sunAt.y) >= min;
  const disk = (key: string, name: string, center: Vec3, rKm: number, d: ReturnType<typeof diskLines>): void => {
    const q = proj(center);
    const rr = rKm * k;
    if (!inView(q.x, q.y, rr) || rr > INNER * 30) return;
    // 銀河系（我們在裡面）、中心那一個照樣畫；別的星系疊在太陽系上、或離中心遠到超過雷達範圍好幾倍（從正上方看會疊在附近，像是很近）就不畫
    if (key !== 'milkyway' && key !== focus && (!apart(q, 8) || Math.hypot(...sub(center, F)) * k > INNER * 6)) return;
    if (rr >= 3) {
      lines += `<path class="region-outline space-galaxy" d="${pathOf(d.rim, true)}" />`;
      if (rr >= 12) lines += `<path class="space-galaxy-core" d="${pathOf(d.core, true)}" />`;
      if (rr >= 18) lines += `<path class="region-outline open space-galaxy-arm" d="${d.arms.map((a) => pathOf(a, false)).join('')}" />`;
    }
    // 點星系（核心那一塊）飛過去當中心（第 2 號願望）
    const dot = rr < 3 ? `<circle class="space-galaxy-dot" cx="${f1(q.x)}" cy="${f1(q.y)}" r="2.4" />` : '';
    bodies += `<g class="space-hit" data-body="${key}"><circle class="hit" cx="${f1(q.x)}" cy="${f1(q.y)}" r="${f1(Math.max(12, Math.min(rr * 0.4, 40)))}" />${dot}</g>`;
    named.push({ x: q.x, y: q.y, r: Math.min(rr, 4), cls: key, name });
  };
  // 銀河系小到只剩幾個單位（拉到幾百萬光年）：整個銀河系也縮成你在的那一點
  const tinyMw = MILKY_WAY.r * LY_KM * k < 6;
  if (!tinyMw) {
    const mw = milkyWay();
    disk('milkyway', '銀河系', mw.center, MILKY_WAY.r * LY_KM, mw.lines);
  }
  for (const g of GALAXIES) {
    const [u, v] = diskAxes(g.ra, g.dec, g.pa, g.incl);
    const c = scale3(eclDir(g.ra, g.dec), g.ly * LY_KM);
    disk(g.key, g.name, c, g.r * LY_KM, diskLines(c, u, v, g.r * LY_KM, g.arms, g.r * 0.2 * LY_KM, 0));
  }
  // Kepler-22b（跟恆星 Kepler-22 只差 0.85 AU，這麼遠是同一個點）：離太陽系夠遠才畫，中心是它就一定畫；點了飛過去（第 2 號願望）
  // （點子來自誰寫在說明頁的「實現的願望」，v1.583 使用者說不用寫在這裡）
  const kp = proj(keplerPlanet(when));
  if (inView(kp.x, kp.y, 3) && (focus === 'kepler22b' || apart(kp, 10))) {
    bodies += `<g class="space-hit" data-body="kepler22b"><circle class="hit" cx="${f1(kp.x)}" cy="${f1(kp.y)}" r="12" /><circle class="space-planet space-exo" cx="${f1(kp.x)}" cy="${f1(kp.y)}" r="3" /></g>`;
    named.push({ x: kp.x, y: kp.y, r: 3, cls: 'kepler22b', name: 'Kepler-22b' });
  }
  // 太陽系（你）：太陽、地球、行星都在這一點（銀河系也小成一點時寫銀河系）。
  // 可以點（v1.586 使用者說「到其他星系後，銀河系點不回去」）：銀河系小成一點時點了回到銀河系，不然回到你（跟點地球一樣）
  bodies += `<g class="space-hit" data-body="${tinyMw ? 'milkyway' : 'earth'}"><circle class="hit" cx="${f1(sunAt.x)}" cy="${f1(sunAt.y)}" r="12" /><circle class="${tinyMw ? 'space-galaxy-dot' : 'space-sun'}" cx="${f1(sunAt.x)}" cy="${f1(sunAt.y)}" r="3.2" /><circle class="space-me" cx="${f1(sunAt.x)}" cy="${f1(sunAt.y)}" r="1.6" /></g>`;
  named.unshift({ x: sunAt.x, y: sunAt.y, r: 4, cls: 'sun', name: tinyMw ? '銀河系（你）' : '太陽系（你）', force: true });
  // 中心那一個的名字排在你後面
  const at = named.findIndex((b) => b.cls === focus);
  if (at > 1) named.splice(1, 0, ...named.splice(at, 1));
  return { lines, bodies, named };
}

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
  // 中心可以是太陽系外面的 Kepler-22b、星系（第 2 號願望）
  const F0 = (view.focus && (pos.get(view.focus) ?? deepPosition(view.focus, o.when))) || ([0, 0, 0] as Vec3);
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
  // 中心是 Kepler-22b、拉近到恆星系的大小：恆星、軌道、行星
  if (view.focus === 'kepler22b' && o.scaleKm <= DEEP_FROM_KM) return keplerSystemMarkup(proj, k, inView, o.when);
  // 太陽系外面：太陽系縮成一個點，畫 Kepler-22b、銀河系和附近的星系
  if (o.scaleKm > DEEP_FROM_KM || (view.focus && isDeepBody(view.focus))) {
    const deep = deepMarkup(proj, k, inView, proj(pos.get('sun')!), F, view.focus, o.when);
    return `${deep.lines}${deep.bodies}${labels(deep.named)}`;
  }
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
    const look = b.key === 'woof' && b.r >= TINY_EARTH && o.woofMap !== false ? woofGlobe(b.x, b.y, b.r, view, rot(sub(sun, pos.get('woof')!)), o.streets, o.bottles) : bodySvg(b.key, b.x, b.y, b.r, b.key === 'sun' ? null : sunAt);
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
