/**
 * 中山公園（國父紀念館）：地球的雷達和汪星共用的一份畫法——資料（zhongshan.ts）、畫哪些東西、拉近到多少才畫、
 * 草和水波怎麼長、附近可以放大到多近，都只寫在這裡，改了兩邊一起變。
 * 兩邊只差在經緯度怎麼換到畫面上（ParkCanvas）：地球是雷達的平面（以雷達正中間為中心、北在上，整層跟著指北針轉，earthParkSvg），
 * 汪星是球面（ParkWorld 把台北的經緯度換成汪星的，space.ts）。地球上第一次在公園附近才載入
 */
import type { LatLng } from './geo';
import { RADAR_GEOM } from './radar';
import { ZHONGSHAN_PARK } from './zhongshan';

const { c: C, inner: INNER, size: SIZE } = RADAR_GEOM;
const RAD = Math.PI / 180;
type Pt = [number, number];

/** 平面上的有向面積（x 經度、y 緯度）：正的是逆時針 */
export const ringArea = (r: Pt[]): number => r.reduce((s, p, i) => s + p[1] * r[(i + 1) % r.length][0] - r[(i + 1) % r.length][1] * p[0], 0) / 2;

/** 中山公園附近可以放大到這麼近（雷達外圈，公里）：0.5 公尺 */
export const PARK_MIN_KM = 0.0005;
/** 中山公園附近（公園外面多留約 50 公尺）：台北的經緯度範圍 */
const PARK_BOX = (() => {
  const o = ZHONGSHAN_PARK.outline;
  const m = 0.0005;
  return [Math.min(...o.map((p) => p[0])) - m, Math.min(...o.map((p) => p[1])) - m, Math.max(...o.map((p) => p[0])) + m, Math.max(...o.map((p) => p[1])) + m];
})();
/** 台北的這個地方在不在中山公園附近（雷達正中間在這裡就可以放大到 PARK_MIN_KM） */
export const nearPark = (lat: number, lng: number): boolean => lat >= PARK_BOX[0] && lat <= PARK_BOX[2] && lng >= PARK_BOX[1] && lng <= PARK_BOX[3];

/** 每公尺幾像素以上才畫：公園的範圍（汪星整顆看得到時、地球的雷達約 18 km 內）、裡面的東西（約 1.8 km 內） */
const FILL_PPM = 0.009;
const DETAIL_PPM = 0.09;

/** 畫在哪個世界：台北的經緯度換成這個世界的經緯度、每度幾公尺，要不要把線切細（汪星畫在球上，每 2 度一點） */
export interface ParkWorld {
  to: (p: Pt) => Pt;
  /** 南北、東西（照緯度）每度幾公尺 */
  my: number;
  mx: (lat: number) => number;
  densify?: (pts: Pt[], closed?: boolean) => Pt[];
}

/**
 * 一塊塊的範圍（每一塊是一組圈：外框和裡面挖掉的小島）攤平成公尺，加上外框的範圍；
 * 邊照南北切成一條條的帶子（bands），看一個點在不在裡面只要看它那一條帶子裡的邊
 */
interface Patch {
  /** 每個邊四個數字：兩端的 x、y */
  edges: Float64Array;
  bands: number[][];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Patches {
  list: Patch[];
  box: [number, number, number, number];
}

/** 這個世界的公園：填色的圈（逆時針）、線，草地、水面攤平成公尺（O 是公園中間，x 往東、y 往北） */
export interface ParkGeom {
  outline: Pt[];
  outlineLine: Pt[];
  lawns: Pt[][];
  ponds: Pt[][];
  buildings: Pt[][];
  water: Pt[][];
  green: Pt[][];
  paths: Pt[][];
  statue: Pt;
  O: { lat: number; lng: number; mx: number; my: number };
  lawnPatches: Patches;
  pondPatches: Patches;
}

const geoms = new WeakMap<ParkWorld, ParkGeom>();
/** 公園換到這個世界（第一次用到才算，記起來） */
export function parkGeom(w: ParkWorld): ParkGeom {
  const had = geoms.get(w);
  if (had) return had;
  const dense = w.densify ?? ((pts: Pt[]): Pt[] => pts);
  const ring = (r: Pt[]): Pt[] => dense(r.map(w.to), true);
  const area = (r: Pt[]): Pt[] => {
    const x = ring(r);
    return ringArea(x) < 0 ? x.reverse() : x;
  };
  const loop = (r: Pt[]): Pt[] => {
    const x = ring(r);
    return [...x, x[0]];
  };
  const outline = area(ZHONGSHAN_PARK.outline);
  const lat = (Math.min(...outline.map((p) => p[0])) + Math.max(...outline.map((p) => p[0]))) / 2;
  const lng = (Math.min(...outline.map((p) => p[1])) + Math.max(...outline.map((p) => p[1]))) / 2;
  const O = { lat, lng, my: w.my, mx: w.mx(lat) };
  const patches = (groups: Pt[][][]): Patches => {
    const list = groups.map((g) => {
      const rings = g.map((r) => r.map(w.to).map(([a, b]): Pt => [(b - O.lng) * O.mx, (a - O.lat) * O.my]));
      const [x0, y0, x1, y1] = [Math.min(...rings[0].map((p) => p[0])), Math.min(...rings[0].map((p) => p[1])), Math.max(...rings[0].map((p) => p[0])), Math.max(...rings[0].map((p) => p[1]))];
      const edges = new Float64Array(rings.flatMap((pts) => pts.flatMap((a, i) => [...a, ...pts[(i + 1) % pts.length]])));
      const n = edges.length / 4;
      const bands: number[][] = Array.from({ length: Math.max(1, Math.min(256, Math.ceil(n / 4))) }, () => []);
      const h = (y1 - y0) / bands.length || 1;
      const band = (y: number): number => Math.max(0, Math.min(bands.length - 1, Math.floor((y - y0) / h)));
      for (let e = 0; e < n; e++) {
        const [ya, yb] = [edges[e * 4 + 1], edges[e * 4 + 3]];
        for (let b = band(Math.min(ya, yb)); b <= band(Math.max(ya, yb)); b++) bands[b].push(e * 4);
      }
      return { edges, bands, x0, y0, x1, y1 };
    });
    return { list, box: [Math.min(...list.map((l) => l.x0)), Math.min(...list.map((l) => l.y0)), Math.max(...list.map((l) => l.x1)), Math.max(...list.map((l) => l.y1))] };
  };
  const g: ParkGeom = {
    outline,
    outlineLine: [...outline, outline[0]],
    lawns: ZHONGSHAN_PARK.green.map(area),
    // 水面的小島疊在外框上面，填色用 evenodd 挖掉
    ponds: ZHONGSHAN_PARK.water.flat().map(area),
    buildings: ZHONGSHAN_PARK.buildings.map(loop),
    water: ZHONGSHAN_PARK.water.flat().map(loop),
    green: ZHONGSHAN_PARK.green.map(loop),
    paths: ZHONGSHAN_PARK.paths.map((l) => dense(l.map(w.to))),
    statue: w.to(ZHONGSHAN_PARK.statue),
    O,
    lawnPatches: patches(ZHONGSHAN_PARK.green.map((r) => [r])),
    pondPatches: patches(ZHONGSHAN_PARK.water),
  };
  geoms.set(w, g);
  return g;
}

/** 畫在畫面上：每公尺幾像素、雷達正中間（這個世界的經緯度）和圓心，填色、線、一個點換到畫面上（看不到是 null） */
export interface ParkCanvas {
  ppm: number;
  center: LatLng;
  rx: number;
  ry: number;
  /** 畫不畫草和水波（汪星要飛過去當中心才畫） */
  textures: boolean;
  area: (rings: Pt[][]) => string;
  lines: (lines: Pt[][]) => string;
  at: (lat: number, lng: number) => Pt | null;
}

/** 孫中山銅像（從上面看）：方的台座、上面圓的銅像，真的台座約 2 公尺見方，畫面上至少 9 像素 */
const STATUE_M = 2;
const STATUE_MIN = 9;

/**
 * 中山公園：範圍淡淡填色、虛線的邊；拉近到 1.8 km 內再畫草地花圃（淡淡的草綠色、點線的邊）、水面（淡淡的水藍色、虛線的邊）、
 * 步道（跟街道的細線一樣）、建築（實線）、孫中山銅像，拉近到幾百公尺內草地長出一叢叢的草、水面有一道道的水波
 */
export function parkSvg(g: ParkGeom, c: ParkCanvas): string {
  if (c.ppm < FILL_PPM) return '';
  let out = '';
  const fill = c.area([g.outline]);
  if (fill) out += `<path class="park-area" d="${fill}" />`;
  out += `<path class="park-edge" d="${c.lines([g.outlineLine])}" />`;
  if (c.ppm < DETAIL_PPM) return out;
  const texture = (cls: string, kind: 'grass' | 'ripple'): string => {
    const t = c.textures ? parkTexture(g, kind, c) : null;
    return t ? `<path class="${cls}" transform="scale(0.1)" stroke-width="${(t.w * 10).toFixed(1)}" d="${t.d}" />` : '';
  };
  const lawn = c.area(g.lawns);
  if (lawn) out += `<path class="park-lawn" d="${lawn}" />`;
  out += texture('park-grass', 'grass');
  const pond = c.area(g.ponds);
  if (pond) out += `<path class="park-pond" d="${pond}" />`;
  out += texture('park-ripple', 'ripple');
  out += `<path class="park-green" d="${c.lines(g.green)}" />`;
  out += `<path class="park-water" d="${c.lines(g.water)}" />`;
  out += `<path class="park-path street-minor" d="${c.lines(g.paths)}" />`;
  out += `<path class="park-building" d="${c.lines(g.buildings)}" />`;
  const s = c.at(...g.statue);
  const h = Math.max(STATUE_M * c.ppm, STATUE_MIN) / 2;
  if (s && Math.hypot(s[0] - c.rx, s[1] - c.ry) - h * Math.SQRT2 < INNER + 2) {
    const [x, y] = s.map((v) => v.toFixed(1));
    out += `<g class="park-statue"><rect x="${(s[0] - h).toFixed(1)}" y="${(s[1] - h).toFixed(1)}" width="${(2 * h).toFixed(1)}" height="${(2 * h).toFixed(1)}" /><circle cx="${x}" cy="${y}" r="${(h * 0.45).toFixed(1)}" /></g>`;
  }
  return out;
}

/**
 * 草和水波：草地花圃裡一叢一叢的草、水面上一道道的水波，位置照地方固定，同一個地方每次看都一樣。
 * 一層層的格子（每層邊長減半），每一格有一個、在格子裡的哪裡用亂數決定：畫的那一層在畫面上約間隔的 1.15～2.3 倍像素一格，
 * 再細一層照拉近的程度慢慢加進來（拉近只會多、不會跳），畫面上大約每 px 像素見方一個（雷達 400 見方）。
 * 用真的大小畫，畫面上太小就畫成固定大小的記號；拉遠到每公尺不到 TEXTURE_FROM 像素（雷達外圈約 500 公尺）就不畫
 */
interface Texture {
  /** 畫面上大約每幾像素見方一個 */
  px: number;
  /** 最大的真實大小（公尺）、畫面上至少幾像素 */
  size: number;
  min: number;
  /** 大小（畫面上）比間隔的 1 / dense 倍還大就不再變密，只跟著變大（放大到 1 公尺內不會密成一片） */
  dense: number;
  /** 一個記號相對於它的底佔的範圍（左、上、右、下，乘上大小） */
  box: [number, number, number, number];
  /** 線的粗細：每公尺幾像素的幾倍，最細、最粗 */
  width: [number, number, number];
  /** 畫一個：底在 (x, y)、大小 big（畫面上），rnd(n) 是這一格的第 n 個亂數，r1 把座標寫成整數 */
  draw: (x: number, y: number, big: number, ppm: number, w: number, rnd: (n: number) => number, r1: (v: number) => number) => string;
}
const TEXTURE_FROM = 0.33;
const TEXTURE_MIN_M = 0.01;
const TEXTURE_TOP = 15;
/** 草：每叢 2～4 根，真的長度 4～10 公分，往上長、往兩邊散開一點；太短畫成草地記號 */
const GRASS: Texture = {
  px: 12.5,
  size: 0.1,
  min: 6,
  dense: 2,
  box: [-0.3, -1, 0.3, 0],
  width: [0.004, 0.6, 1.6],
  draw: (x, y, _big, ppm, w, rnd, r1) => {
    const n = 2 + Math.floor(rnd(4) * 3);
    let d = '';
    for (let b = 0; b < n; b++) {
      const h = rnd(5 + b);
      const len = Math.max((0.04 + 0.06 * h) * ppm, 4 + 2 * h);
      const a = (b - (n - 1) / 2) * 0.35 + (h - 0.5) * 0.4;
      const [sx, sy] = [Math.sin(a) * len, Math.cos(a) * len];
      d += `M${r1(x + (b - (n - 1) / 2) * w)} ${r1(y)}q${r1(sx * 0.25)} ${r1(-sy * 0.6)} ${r1(sx * 1.2)} ${r1(-sy)}`;
    }
    return d;
  },
};
/** 水波：一道（一半多一道在下面）左右彎一下的波紋，真的長度 15～35 公分；太短畫成水的記號（翠湖的小島上沒有） */
const RIPPLES: Texture = {
  px: 16,
  size: 0.35,
  min: 12,
  dense: 1.8,
  box: [-0.5, -0.1, 0.5, 0.4],
  width: [0.003, 0.6, 1.4],
  draw: (x, y, _big, ppm, _w, rnd, r1) => {
    const wave = (cx: number, cy: number, len: number): string => `M${r1(cx - len / 2)} ${r1(cy)}q${r1(len / 4)} ${r1(-len * 0.2)} ${r1(len / 2)} 0t${r1(len / 2)} 0`;
    const len = Math.max((0.15 + 0.2 * rnd(4)) * ppm, 9 + 3 * rnd(4));
    let d = wave(x, y, len);
    if (rnd(5) < 0.5) d += wave(x + len * (rnd(6) - 0.5) * 0.3, y + len * 0.3, len * 0.7);
    return d;
  },
};
/** 格子 (i, j)、第 k 層的第 n 個亂數（0～1，每次都一樣） */
function cellRand(i: number, j: number, k: number, n: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k * 16 + n + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** 畫面上的草或水波（畫的座標乘 10）和線的粗細；太遠、畫面上沒有草地（水面）就是 null */
export function parkTexture(g: ParkGeom, kind: 'grass' | 'ripple', c: Pick<ParkCanvas, 'ppm' | 'center' | 'rx' | 'ry' | 'at'>): { d: string; w: number } | null {
  const [area, t, salt] = kind === 'grass' ? [g.lawnPatches, GRASS, 0] : [g.pondPatches, RIPPLES, 1];
  const { ppm, O } = { ppm: c.ppm, O: g.O };
  if (ppm < TEXTURE_FROM) return null;
  // 每公尺 0.33 到 0.66 像素之間（雷達外圈約 500 到 250 公尺）慢慢長出來
  const fade = Math.min(1, ppm / TEXTURE_FROM - 1);
  // 最大在畫面上幾像素；比間隔大很多（放大到 1 公尺內）就不再加，只是跟著變大，不會密成一片
  const big = Math.max(t.size * ppm, t.min);
  const p = Math.max(t.px, big / t.dense) * Math.sqrt(4 / 3);
  // 畫的這一層：格子在畫面上 p～2p 像素；再細一層加進來的比例讓每像素的個數不變
  const k0 = Math.min(TEXTURE_TOP, Math.max(1, Math.ceil(Math.log2(p / ppm / TEXTURE_MIN_M))));
  const cell = TEXTURE_MIN_M * 2 ** k0 * ppm;
  const more = Math.min(1, ((cell / p) ** 2 - 1) / 3);
  // 看得到的範圍（攤平的公尺，多留一點：球面和攤平的方向差一點點）
  const half = ((INNER + 10) / ppm) * 1.15 + t.size;
  const cx = (c.center.lng - O.lng) * O.mx;
  const cy = (c.center.lat - O.lat) * O.my;
  const x0 = Math.max(cx - half, area.box[0]);
  const x1 = Math.min(cx + half, area.box[2]);
  const y0 = Math.max(cy - half, area.box[1]);
  const y1 = Math.min(cy + half, area.box[3]);
  if (x0 > x1 || y0 > y1) return null;
  // 只看範圍裡面的那幾塊
  const list = area.list.filter((l) => l.x1 >= x0 && l.x0 <= x1 && l.y1 >= y0 && l.y0 <= y1);
  if (!list.length) return null;
  // 上一個所在的那一塊先看（旁邊的格子多半在同一塊）
  let hit = 0;
  const inside = (x: number, y: number): boolean => {
    for (let m = 0; m < list.length; m++) {
      const l = list[(hit + m) % list.length];
      if (x < l.x0 || x > l.x1 || y < l.y0 || y > l.y1) continue;
      // 外框裡面、小島外面（往東的射線穿過的邊是單數）
      let odd = false;
      const { edges } = l;
      for (const e of l.bands[Math.max(0, Math.min(l.bands.length - 1, Math.floor(((y - l.y0) / (l.y1 - l.y0 || 1)) * l.bands.length)))]) {
        const [xa, ya, xb, yb] = [edges[e], edges[e + 1], edges[e + 2], edges[e + 3]];
        if (ya > y !== yb > y && x < xa + ((y - ya) * (xb - xa)) / (yb - ya)) odd = !odd;
      }
      if (odd) {
        hit = (hit + m) % list.length;
        return true;
      }
    }
    return false;
  };
  const w = Math.min(t.width[2], Math.max(t.width[1], t.width[0] * ppm));
  const reach = (INNER + 2) ** 2;
  const [bx0, by0, bx1, by1] = t.box.map((v) => v * big);
  // 座標乘 10 寫成整數（小數轉字串慢好幾倍），畫的時候縮回 0.1 倍
  const r1 = (v: number): number => Math.round(v * 10);
  let d = '';
  let count = 0;
  for (let k = k0 - 1; k <= TEXTURE_TOP; k++) {
    const s = TEXTURE_MIN_M * 2 ** k;
    const kk = k + salt * 64;
    for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++) {
      for (let j = Math.floor(y0 / s); j <= Math.floor(y1 / s); j++) {
        if (cellRand(i, j, kk, 0) >= fade || (k < k0 && cellRand(i, j, kk, 1) >= more)) continue;
        const x = (i + 0.1 + 0.8 * cellRand(i, j, kk, 2)) * s;
        const y = (j + 0.1 + 0.8 * cellRand(i, j, kk, 3)) * s;
        const at = c.at(O.lat + y / O.my, O.lng + x / O.mx);
        if (!at) continue;
        const [bx, by] = at;
        // 記號佔的範圍碰得到雷達才畫（草往上長：底在雷達下緣外面、草尖伸得進來的也要畫）；在不在範圍裡比較慢，最後才看
        const ex = Math.min(bx + bx1, Math.max(bx + bx0, c.rx)) - c.rx;
        const ey = Math.min(by + by1, Math.max(by + by0, c.ry)) - c.ry;
        if (ex * ex + ey * ey > reach || !inside(x, y)) continue;
        d += t.draw(bx, by, big, ppm, w, (n) => cellRand(i, j, kk, n), r1);
        // 萬一算錯也不會多到拖不動
        if (++count >= 1500) return { d, w };
      }
    }
  }
  return d ? { d, w } : null;
}

/** 地球：台北的經緯度就是地球的，每度的公尺數跟雷達的街道一樣 */
export const EARTH: ParkWorld = { to: (p) => p, my: 110_574, mx: (lat) => 111_320 * Math.cos(lat * RAD) };

/**
 * 地球的雷達上的中山公園（北在上，雷達整層跟著指北針轉）：origin 是雷達正中間、scaleKm 是外圈幾公里；
 * 範圍不大，用平面近似（跟街道一樣）。線切到畫面的範圍裡（放大很多時虛線整條有幾萬像素長）
 */
export function earthParkSvg(origin: LatLng, scaleKm: number): string {
  const ppm = INNER / (scaleKm * 1000);
  if (ppm < FILL_PPM) return '';
  const g = parkGeom(EARTH);
  const kx = EARTH.mx(origin.lat) * ppm;
  const ky = EARTH.my * ppm;
  const xy = (lat: number, lng: number): Pt => [C + (lng - origin.lng) * kx, C - (lat - origin.lat) * ky];
  const [x0, y0, x1, y1] = [-20, -20, SIZE + 20, SIZE + 20];
  const f1 = (n: number): string => n.toFixed(1);
  /** 一圈投影後的範圍碰不碰得到畫面 */
  const shows = (pts: Pt[]): boolean => {
    let [a, b, c, d] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of pts) [a, b, c, d] = [Math.min(a, x), Math.min(b, y), Math.max(c, x), Math.max(d, y)];
    return c >= x0 && a <= x1 && d >= y0 && b <= y1;
  };
  // 整個公園都在畫面外面就不畫
  if (!shows(g.outline.map(([lat, lng]) => xy(lat, lng)))) return '';
  const canvas: ParkCanvas = {
    ppm,
    center: origin,
    rx: C,
    ry: C,
    textures: true,
    area: (rings) =>
      rings
        .map((r) => r.map(([lat, lng]) => xy(lat, lng)))
        .filter(shows)
        .map((pts) => `M${pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L')}Z`)
        .join(''),
    // 每一段切到畫面範圍裡面（Liang–Barsky），斷開的地方重新 M
    lines: (ls) => {
      let d = '';
      for (const l of ls) {
        let last: Pt | null = null;
        for (let i = 1; i < l.length; i++) {
          const [ax, ay] = xy(l[i - 1][0], l[i - 1][1]);
          const [bx, by] = xy(l[i][0], l[i][1]);
          const [dx, dy] = [bx - ax, by - ay];
          let [t0, t1] = [0, 1];
          const clip = (p: number, q: number): boolean => {
            if (p === 0) return q >= 0;
            const t = q / p;
            if (p < 0) t0 = Math.max(t0, t);
            else t1 = Math.min(t1, t);
            return t0 <= t1;
          };
          if (!(clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay))) {
            last = null;
            continue;
          }
          const [sx, sy, ex, ey] = [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
          if (!last || Math.abs(last[0] - sx) > 0.05 || Math.abs(last[1] - sy) > 0.05) d += `M${f1(sx)} ${f1(sy)}`;
          d += `L${f1(ex)} ${f1(ey)}`;
          last = t1 < 1 ? null : [ex, ey];
        }
      }
      return d;
    },
    at: (lat, lng) => xy(lat, lng),
  };
  return parkSvg(g, canvas);
}
