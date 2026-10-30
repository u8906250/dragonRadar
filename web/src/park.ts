/**
 * 中山公園（國父紀念館）：地球的雷達和汪星共用的一份畫法——資料（zhongshan.ts）、畫哪些東西、拉近到多少才畫、
 * 草和水波怎麼長、附近可以放大到多近，都只寫在這裡，改了兩邊一起變。
 * 兩邊只差在經緯度怎麼換到畫面上（ParkCanvas）：地球是雷達的平面（以雷達正中間為中心、北在上，整層跟著指北針轉，earthParkSvg），
 * 汪星是球面（ParkWorld 把台北的經緯度換成汪星的，space.ts）。地球上第一次在公園附近才載入
 */
import type { LatLng } from './geo';
import { RADAR_GEOM, type TripAt } from './radar';
import { ZHONGSHAN_PARK } from './zhongshan';
import { MALTESE, dogHeight } from './dog';
import { animateDogs, Dog, dogById, dogHeading, dogMarkup, wakeDogs, type DogYard } from './dogs';
export { onDogMove } from './dogs';

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
  /** 哪個世界（火箭停在哪一邊） */
  name: RocketWorld;
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
  name: RocketWorld;
  /** 台北的經緯度換成這個世界的 */
  to: (p: Pt) => Pt;
  outline: Pt[];
  outlineLine: Pt[];
  lawns: Pt[][];
  ponds: Pt[][];
  buildings: Pt[][];
  water: Pt[][];
  green: Pt[][];
  paths: Pt[][];
  statue: Pt;
  hatch: Pt[];
  O: { lat: number; lng: number; mx: number; my: number };
  lawnPatches: Patches;
  pondPatches: Patches;
  /** 發射口（廣場中間那塊草皮）：開關的時候兩片門上的草只長這一塊的 */
  hatchPatches: Patches;
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
    name: w.name,
    to: w.to,
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
    hatch: ZHONGSHAN_PARK.hatch.map(w.to),
    O,
    lawnPatches: patches(ZHONGSHAN_PARK.green.map((r) => [r])),
    pondPatches: patches(ZHONGSHAN_PARK.water),
    hatchPatches: patches([[ZHONGSHAN_PARK.hatch]]),
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

/**
 * 孫中山銅像：立體的，矮矮的石頭台座（約 2 公尺寬、離地 0.3 公尺，看得到上面和右邊）上坐著穿長袍的銅像（坐在椅子上，手放在膝蓋上），
 * 側面面向右邊（東邊，國父紀念館那邊），左上照光（背後亮、前面暗），地上一塊影子。
 * 單位是公尺，(0, 0) 是台座的中心（站的地方），往上是負的；整個約 2.3 公尺高（STATUE_H）。照真的大小畫，跟著縮放：
 * 雷達外圈約 500 公尺內（每公尺 STATUE_FROM 像素，跟草一樣）才看得到，先是一個點（慢慢變大），外圈約 28 公尺內（STATUE_FULL）才畫出整座銅像，
 * 這時候點得到（statue-hit，至少 STATUE_HIT 像素半徑）：點了叫出收在這一邊的火箭（summonRocket）。
 * 不管指北針怎麼轉都站著、面向東邊（radar.ts 照 data-at 轉回來，東邊轉到左邊就左右翻過來）
 */
const STATUE_H = 2.3;
const STATUE_FROM = 0.33;
const STATUE_FULL = INNER / 28;
const STATUE_HIT = 20;
const STATUE_SVG = (() => {
  const [fx, fy] = [0.175, -0.28];
  const n = (v: number): number => +v.toFixed(3);
  const p = (pts: Array<[number, number]>): string => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)} ${n(y)}`).join('') + 'Z';
  const at = (x: number, y: number): string => `${n(fx + x)} ${n(fy + y)}`;
  const xy = (x: number, y: number): string => `cx="${n(fx + x)}" cy="${n(fy + y)}"`;
  return (
    `<ellipse class="statue-shadow" cx="0.55" cy="0.1" rx="1.6" ry="0.38" />` +
    `<path class="statue-stone-front" d="${p([[-1, -0.05], [1, -0.05], [1, 0.25], [-1, 0.25]])}" />` +
    `<path class="statue-stone-side" d="${p([[1, -0.05], [1.35, -0.5], [1.35, -0.2], [1, 0.25]])}" />` +
    `<path class="statue-stone-top" d="${p([[-1, -0.05], [1, -0.05], [1.35, -0.5], [-0.65, -0.5]])}" />` +
    // 椅背（在背後）、椅座
    `<path class="statue-chair" d="M${at(-0.5, -0.45)}L${at(-0.5, -1.42)}Q${at(-0.5, -1.52)} ${at(-0.41, -1.52)}Q${at(-0.32, -1.52)} ${at(-0.32, -1.42)}L${at(-0.32, -0.45)}Z" />` +
    `<path class="statue-chair" d="M${at(-0.5, -0.5)}L${at(0.22, -0.5)}L${at(0.22, 0)}L${at(-0.5, 0)}Z" />` +
    // 上身（背後一條亮的、前面暗）
    `<path class="statue-body" d="M${at(-0.33, -0.5)}L${at(-0.3, -1.22)}Q${at(-0.27, -1.38)} ${at(-0.12, -1.38)}L${at(-0.02, -1.38)}Q${at(0.1, -1.36)} ${at(0.08, -1.2)}L${at(0.1, -0.5)}Z" />` +
    `<path class="statue-dark" d="M${at(-0.06, -1.38)}L${at(-0.02, -1.38)}Q${at(0.1, -1.36)} ${at(0.08, -1.2)}L${at(0.1, -0.5)}L${at(-0.04, -0.5)}Z" />` +
    `<path class="statue-lit" d="M${at(-0.28, -1.22)}L${at(-0.3, -0.55)}L${at(-0.22, -0.55)}L${at(-0.2, -1.28)}Z" />` +
    // 大腿（長袍蓋著，上面亮一點）、小腿垂下來、鞋子朝右
    `<path class="statue-body" d="M${at(-0.2, -0.78)}L${at(0.4, -0.76)}Q${at(0.47, -0.74)} ${at(0.47, -0.62)}L${at(0.47, -0.5)}L${at(-0.2, -0.5)}Z" />` +
    `<path class="statue-lit" d="M${at(-0.1, -0.78)}L${at(0.38, -0.765)}L${at(0.38, -0.72)}L${at(-0.1, -0.73)}Z" />` +
    `<path class="statue-body" d="M${at(0.2, -0.6)}L${at(0.47, -0.6)}L${at(0.5, -0.06)}L${at(0.18, -0.06)}Z" />` +
    `<path class="statue-dark" d="M${at(0.38, -0.6)}L${at(0.47, -0.6)}L${at(0.5, -0.06)}L${at(0.4, -0.06)}Z" />` +
    `<ellipse class="statue-dark" ${xy(0.44, -0.04)} rx="0.15" ry="0.05" />` +
    // 手垂下來放在膝蓋上
    `<path class="statue-arm" d="M${at(-0.14, -1.28)}L${at(-0.08, -0.92)}L${at(0.3, -0.82)}" />` +
    `<circle class="statue-body" ${xy(0.33, -0.81)} r="0.06" />` +
    // 脖子、頭（鼻子朝右、耳朵、鬍子，後腦一點亮）
    `<path class="statue-dark" d="${p([[fx - 0.1, fy - 1.46], [fx, fy - 1.46], [fx, fy - 1.36], [fx - 0.1, fy - 1.36]])}" />` +
    `<path class="statue-body" d="M${at(0.09, -1.6)}L${at(0.16, -1.53)}L${at(0.09, -1.5)}Z" />` +
    `<circle class="statue-body" ${xy(-0.05, -1.56)} r="0.15" />` +
    `<circle class="statue-dark" ${xy(-0.09, -1.55)} r="0.033" />` +
    `<circle class="statue-lit" ${xy(-0.12, -1.63)} r="0.045" />` +
    `<path class="statue-seam" d="M${at(0.04, -1.48)}L${at(0.12, -1.49)}" />`
  );
})();

/**
 * 汪星的狗（dog.ts 畫 3D 的狗、dogs.ts 讓牠動）：PARK_DOGS 是公園裡有哪幾隻（現在是使用者的馬爾濟斯小法，之後可以加），
 * 只在汪星，只走草地和步道（parkYard：照面積抽一塊草皮，不在發射口和銅像旁邊，火箭、銅像不會蓋住；走多遠照汪星的公尺算；
 * 有時候照步道走到附近另一塊草皮、去附近的湖邊喝水，不穿過建築、水池、廣場；每隻狗可以有不去的地方）。
 * 打開網頁第一次畫、搭火箭到汪星時（main.ts 的 moveDogs）換到隨機一塊草皮。跟銅像一樣：雷達外圈約 500 公尺內（STATUE_FROM）先是一個點
 * （照這一段 CSS 移過去，styles.css 的 dog-go），約 30 公尺內（DOG_FULL，整隻約 2 個 SVG 單位高：電腦約 7 像素、手機約 2 像素）畫出整隻、點得到（dog-hit，點了坐下）
 */
const DOG_FULL = INNER / 30;
/** 狗在哪個世界畫（汪星；算走多遠用這個世界的公尺），還沒畫過是地球 */
let dogWorld: ParkGeom | null = null;
/** 草皮的面積（照面積抽哪一塊） */
let lawnAreas: number[] | null = null;

/**
 * 狗走得到的地方（照使用者說的：只有草地和步道可以走）：在草皮裡（不在建築、水裡），或離步道 PATH_W 公尺內；
 * 一段直直走過去的路每 0.5 公尺都要走得到（不穿過建築、不橫越廣場）。換草皮、去湖邊照步道走（像導航：步道每 3 公尺一點、
 * 接在一起的步道連起來，最短的走法，再把看得到的點之間拉直）。算的時候換成公園附近的公尺（往東、往北）
 */
const PATH_W = 1.2;
const WALK_M0: Pt = [25.0394, 121.5596];
const WALK_MY = 110_574;
const WALK_MX = 111_320 * Math.cos(WALK_M0[0] * RAD);
const toM = ([a, b]: Pt): Pt => [(b - WALK_M0[1]) * WALK_MX, (a - WALK_M0[0]) * WALK_MY];
const fromM = ([x, y]: Pt): Pt => [WALK_M0[0] + y / WALK_MY, WALK_M0[1] + x / WALK_MX];
type Box = [number, number, number, number];
const boxOf = (r: Pt[]): Box => [Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), Math.max(...r.map((p) => p[0])), Math.max(...r.map((p) => p[1]))];
const inBox = ([x, y]: Pt, b: Box, pad = 0): boolean => x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad;
/** 點在不在一圈裡面（公尺座標，射線法） */
function inRingM([x, y]: Pt, r: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** 點到一段線多遠（公尺座標） */
function segDist([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt): number {
  const [dx, dy] = [bx - ax, by - ay];
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}

/** 公園裡走得到的地方（第一次用到才算）：草皮、擋住的（建築、水池）、步道的每一段（5 公尺一格的索引）、步道的路網 */
interface Walk {
  lawns: Array<{ ring: Pt[]; box: Box }>;
  blocks: Array<{ ring: Pt[]; box: Box }>;
  segs: Array<[Pt, Pt]>;
  grid: Map<string, number[]>;
  nodes: Pt[];
  nodeGrid: Map<string, number[]>;
  adj: Array<Array<[number, number]>>;
}
let walkData: Walk | null = null;
const CELL = 5;
const cellKey = (x: number, y: number): string => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
/** 這一點附近（r 公尺內）的格子裡的東西 */
function nearby(grid: Map<string, number[]>, [x, y]: Pt, r: number): number[] {
  const out: number[] = [];
  for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++)
    for (let j = Math.floor((y - r) / CELL); j <= Math.floor((y + r) / CELL); j++) for (const k of grid.get(`${i},${j}`) ?? []) out.push(k);
  return out;
}
function walkOf(): Walk {
  if (walkData) return walkData;
  const ringM = (r: Pt[]): { ring: Pt[]; box: Box } => {
    const ring = r.map(toM);
    return { ring, box: boxOf(ring) };
  };
  const lawns = ZHONGSHAN_PARK.green.map(ringM);
  const blocks = [...ZHONGSHAN_PARK.buildings.map(ringM), ...ZHONGSHAN_PARK.water.map((w) => ringM(w[0]))];
  const blocked = (p: Pt): boolean => blocks.some((b) => inBox(p, b.box) && inRingM(p, b.ring));
  const segs: Array<[Pt, Pt]> = [];
  const grid = new Map<string, number[]>();
  const nodes: Pt[] = [];
  const nodeGrid = new Map<string, number[]>();
  const adj: Array<Array<[number, number]>> = [];
  const addNode = (p: Pt): number => {
    nodes.push(p);
    adj.push([]);
    const k = cellKey(...p);
    nodeGrid.set(k, [...(nodeGrid.get(k) ?? []), nodes.length - 1]);
    return nodes.length - 1;
  };
  for (const line of ZHONGSHAN_PARK.paths) {
    const pts = line.map(toM);
    let prev = -1;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) {
        const [a, b] = [pts[i - 1], pts[i]];
        segs.push([a, b]);
        // 這一段經過的格子都記一下（段最長也才幾十公尺，每 2 公尺記一次）
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
        const keys = new Set<string>();
        for (let t = 0; t <= n; t++) keys.add(cellKey(a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n));
        for (const k of keys) grid.set(k, [...(grid.get(k) ?? []), segs.length - 1]);
        // 路網：每 3 公尺一點，經過建築、水裡的斷開
        const m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
        for (let t = 1; t <= m; t++) {
          const p: Pt = [a[0] + ((b[0] - a[0]) * t) / m, a[1] + ((b[1] - a[1]) * t) / m];
          if (blocked(p)) {
            prev = -1;
            continue;
          }
          const id = addNode(p);
          if (prev >= 0) {
            const d = Math.hypot(p[0] - nodes[prev][0], p[1] - nodes[prev][1]);
            adj[prev].push([id, d]);
            adj[id].push([prev, d]);
          }
          prev = id;
        }
      } else if (!blocked(pts[0])) prev = addNode(pts[0]);
      else prev = -1;
    }
  }
  // 接在一起的步道（端點、交叉的地方離不到 1.5 公尺）連起來
  nodes.forEach((p, i) => {
    for (const j of nearby(nodeGrid, p, 1.5)) {
      if (j <= i) continue;
      const d = Math.hypot(p[0] - nodes[j][0], p[1] - nodes[j][1]);
      if (d < 1.5 && !adj[i].some(([k]) => k === j)) {
        adj[i].push([j, d]);
        adj[j].push([i, d]);
      }
    }
  });
  return (walkData = { lawns, blocks, segs, grid, nodes, nodeGrid, adj });
}

/**
 * 中山公園給一隻狗待的地方（DogYard）：草皮和步道上，照面積抽一塊草皮，不在發射口和銅像旁邊（火箭、銅像不會蓋住）；
 * avoid 是這隻狗不去的地方（一圈圈台北的經緯度，例如小法不去公園最右上那一區）；走多遠照汪星的公尺算
 */
export function parkYard(o: { avoid?: Pt[][] } = {}): DogYard {
  const avoid = (o.avoid ?? []).map((r) => {
    const ring = r.map(toM);
    return { ring, box: boxOf(ring) };
  });
  /** 這一點走得到嗎（公尺座標）：不在建築、水裡、不去的地方，在草皮裡或離步道 PATH_W 內 */
  const okM = (p: Pt): boolean => {
    const w = walkOf();
    if (w.blocks.some((b) => inBox(p, b.box) && inRingM(p, b.ring))) return false;
    if (avoid.some((b) => inBox(p, b.box) && inRingM(p, b.ring))) return false;
    if (w.lawns.some((l) => inBox(p, l.box) && inRingM(p, l.ring))) return true;
    return nearby(w.grid, p, PATH_W).some((i) => segDist(p, ...w.segs[i]) <= PATH_W);
  };
  /** 從 a 直直走到 b 一路都走得到（每 0.5 公尺看一次，公尺座標） */
  const lineM = (a: Pt, b: Pt): boolean => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
    for (let i = 0; i <= n; i++) if (!okM([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n])) return false;
    return true;
  };
  /** 路網上這隻狗不去的點 */
  let banned: Set<number> | null = null;
  const bannedNodes = (): Set<number> => (banned ??= new Set(walkOf().nodes.flatMap((p, i) => (avoid.some((b) => inBox(p, b.box) && inRingM(p, b.ring)) ? [i] : []))));
  /** 照步道從 a 走到 b（公尺座標）：直直走得到就直接走；不然接上附近（12 公尺內、直直走得到）的步道，走最短的，最多 maxM 公尺；拉直後的轉折點（不含 a，最後一點是 b） */
  const routeM = (a: Pt, b: Pt, maxM: number): Pt[] | null => {
    if (lineM(a, b)) return [b];
    const w = walkOf();
    const ban = bannedNodes();
    const links = (p: Pt): Array<[number, number]> => nearby(w.nodeGrid, p, 12).flatMap((i): Array<[number, number]> => {
      const d = Math.hypot(w.nodes[i][0] - p[0], w.nodes[i][1] - p[1]);
      return d <= 12 && !ban.has(i) && lineM(p, w.nodes[i]) ? [[i, d]] : [];
    });
    const [starts, ends] = [links(a), links(b)];
    if (!starts.length || !ends.length) return null;
    const endAt = new Map(ends);
    // 最短的走法（Dijkstra，節點不多，用陣列找最小的就好）
    const dist = new Map<number, number>();
    const from = new Map<number, number>();
    const open = new Map<number, number>();
    for (const [i, d] of starts) open.set(i, Math.min(open.get(i) ?? Infinity, d));
    let best: { i: number; d: number } | null = null;
    while (open.size) {
      let [i, d] = [-1, Infinity];
      for (const [k, v] of open) if (v < d) [i, d] = [k, v];
      open.delete(i);
      if (d > maxM || (best && d >= best.d)) break;
      dist.set(i, d);
      const e = endAt.get(i);
      if (e !== undefined && (!best || d + e < best.d)) best = { i, d: d + e };
      for (const [j, step] of w.adj[i]) {
        if (dist.has(j) || ban.has(j)) continue;
        if (d + step < (open.get(j) ?? Infinity)) {
          open.set(j, d + step);
          from.set(j, i);
        }
      }
    }
    if (!best || best.d > maxM) return null;
    const pts: Pt[] = [];
    for (let i: number | undefined = best.i; i !== undefined; i = from.get(i)) pts.unshift(w.nodes[i]);
    const all = [a, ...pts, b];
    // 拉直：從現在這點直直走得到的最遠那一點
    const out: Pt[] = [];
    let at = 0;
    while (at < all.length - 1) {
      let k = all.length - 1;
      while (k > at + 1 && !lineM(all[at], all[k])) k--;
      out.push(all[k]);
      at = k;
    }
    return out;
  };
  const len = (from: Pt, path: Pt[]): number => path.reduce((s, p, i) => s + Math.hypot(p[0] - (i ? path[i - 1] : from)[0], p[1] - (i ? path[i - 1] : from)[1]), 0);
  /** 這塊草皮裡隨機一個走得到的地方（不在發射口和銅像旁邊）；near 是只在這一點附近幾公尺內抽；抽不到是 null */
  const spotIn = (ring: number, rand: () => number, near?: { at: Pt; m: number }): Pt | null => {
    const r = ZHONGSHAN_PARK.green[ring];
    const [my, mx] = [EARTH.my, EARTH.mx(HATCH_CENTER[0])];
    const far = (p: Pt, q: Pt, m: number): boolean => Math.abs((p[0] - q[0]) * my) > m || Math.abs((p[1] - q[1]) * mx) > m;
    let [a0, a1] = [Math.min(...r.map((q) => q[0])), Math.max(...r.map((q) => q[0]))];
    let [b0, b1] = [Math.min(...r.map((q) => q[1])), Math.max(...r.map((q) => q[1]))];
    if (near) {
      [a0, a1] = [Math.max(a0, near.at[0] - near.m / my), Math.min(a1, near.at[0] + near.m / my)];
      [b0, b1] = [Math.max(b0, near.at[1] - near.m / mx), Math.min(b1, near.at[1] + near.m / mx)];
      if (a0 > a1 || b0 > b1) return null;
    }
    for (let i = 0; i < 40; i++) {
      const at: Pt = [a0 + rand() * (a1 - a0), b0 + rand() * (b1 - b0)];
      if (inRing(at, r) && far(at, HATCH_CENTER, 6) && far(at, ZHONGSHAN_PARK.statue, 2.5) && okM(toM(at))) return at;
    }
    return null;
  };
  return {
    anywhere: (rand) => {
      const areas = (lawnAreas ??= ZHONGSHAN_PARK.green.map((r) => Math.abs(ringArea(r))));
      const total = areas.reduce((a, b) => a + b, 0);
      for (let tries = 0; tries < 1000; tries++) {
        let pick = rand() * total;
        const ring = Math.max(0, areas.findIndex((a) => (pick -= a) < 0));
        const at = spotIn(ring, rand);
        if (at) return { ring, at };
      }
      return null;
    },
    within: (ring, rand) => spotIn(ring, rand),
    canWalk: (a, b) => lineM(toM(a), toM(b)),
    route: (a, b, maxM = CROSS_MAX_M) => routeM(toM(a), toM(b), maxM)?.map(fromM) ?? null,
    // 附近的其他草皮（邊離這裡 CROSS_NEAR_M 內，在離這裡 CROSS_NEAR_M 內的那一部分抽一處），照步道走過去，最多 CROSS_MAX_M 公尺
    elsewhere: (ring, at, rand) => {
      const a = toM(at);
      const near = walkOf().lawns.map((l, i) => i).filter((i) => i !== ring && walkOf().lawns[i].ring.some((p, j, r) => segDist(a, p, r[(j + 1) % r.length]) < CROSS_NEAR_M));
      for (let tries = 0; tries < 12 && near.length; tries++) {
        const i = near[Math.floor(rand() * near.length)];
        const to = spotIn(i, rand, { at, m: CROSS_NEAR_M });
        const path = to ? routeM(a, toM(to), CROSS_MAX_M) : null;
        if (to && path) return { ring: i, path: path.map(fromM) };
      }
      return null;
    },
    // 附近的湖邊（翠湖、映池的岸，岸邊離這裡 CROSS_NEAR_M 內）：站在岸上離水 0.35 公尺（草皮或步道上）、面向水，照步道走過去
    water: (at, rand) => {
      const a = toM(at);
      const shores = ZHONGSHAN_PARK.water.flatMap((w) => w[0].map((p, i, r): [Pt[], Pt, Pt] => [r, p, r[(i + 1) % r.length]])).filter(([, p, q]) => segDist(a, toM(p), toM(q)) < CROSS_NEAR_M);
      for (let tries = 0; tries < 30 && shores.length; tries++) {
        const [pond, p0, p1] = shores[Math.floor(rand() * shores.length)];
        const t = rand();
        const edge: Pt = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
        // 岸的方向（公尺：往東、往北），往兩邊各 0.35 公尺，不在水裡的那邊是岸上
        const [ex, ey] = [(p1[1] - p0[1]) * WALK_MX, (p1[0] - p0[0]) * WALK_MY];
        const l = Math.hypot(ex, ey);
        if (l < 0.2) continue;
        const off = (m: number): Pt => [edge[0] + ((-ex / l) * m) / WALK_MY, edge[1] + ((ey / l) * m) / WALK_MX];
        const [p, q] = inRing(off(0.35), pond) ? [off(-0.35), off(0.35)] : [off(0.35), off(-0.35)];
        if (inRing(p, pond) || !inRing(q, pond) || !okM(toM(p))) continue;
        const path = routeM(a, toM(p), CROSS_MAX_M);
        if (path) return { path: path.map(fromM), face: q };
      }
      return null;
    },
    metres: (a, b) => {
      const g = dogWorld ?? parkGeom(EARTH);
      const [p, q] = [g.to(a), g.to(b)];
      return Math.hypot((p[0] - q[0]) * g.O.my, (p[1] - q[1]) * g.O.mx);
    },
  };
}

/** 換草皮、去湖邊：找邊離這裡多近的草皮、湖岸（直線，公尺），照步道走最多幾公尺（跑步不要跑太久） */
const CROSS_NEAR_M = 20;
const CROSS_MAX_M = 32;

/** 一般的公園（沒有不去的地方） */
export const PARK_YARD: DogYard = parkYard();

/** 小法不去的地方：公園最右上那一區（國父紀念館東邊那條南北向步道以東、橫過整個公園那條東西向步道以北，東北角那一排草皮） */
export const XIAOFA_AVOID: Pt[] = [[25.03932, 121.56098], [25.0413, 121.56098], [25.0413, 121.5618], [25.03932, 121.5618]];

/** 公園裡的狗：小法（使用者的馬爾濟斯；不去公園最右上那一區；之後可能單獨給他其他動作和個性，就給他自己的 nature） */
export const PARK_DOGS: Dog[] = [new Dog({ id: 'xiaofa', name: '小法', look: MALTESE, yard: parkYard({ avoid: [XIAOFA_AVOID] }) })];

/** 搭火箭到汪星：每隻狗換到隨機一塊草皮 */
export function moveDogs(): void {
  for (const d of PARK_DOGS) d.place();
}

/** 這隻狗現在在哪（台北的經緯度；鎖定時雷達正中間跟著牠）；沒有這隻是 null */
export function dogAt(id: string): Pt | null {
  return dogById(id)?.now().at ?? null;
}

/** 點了這隻狗：轉過來面向你坐下 */
export function petDog(id: string): void {
  dogById(id)?.pet();
}

/** 點在不在一圈裡面（射線法） */
function inRing([y, x]: Pt, r: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [yi, xi] = r[i];
    const [yj, xj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 一隻狗：這一段從哪走到哪（畫面上），拉遠是一個點（CSS 照 --t、--ms 移過去，--dx、--dy），約 30 公尺內畫出整隻 3D 的狗（之後每一格 animateDogs 重畫）；
 * 這一段結束時重畫（wakeDogs），這一段走過的路整條都在畫面外面就不畫
 */
function dogPart(g: ParkGeom, c: ParkCanvas, dog: Dog): string {
  const now = performance.now();
  const d = dog.now(now);
  const s = d.seg;
  wakeDogs(s.start + s.ms, now);
  const [a, b] = [c.at(...g.to(s.from)), c.at(...g.to(s.to))];
  if (!a || !b) return '';
  const h = dogHeight(dog.look) * c.ppm;
  // 這一段走過的路離雷達中心最近多遠（起點、終點都在畫面外面，中間可能經過畫面）
  const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
  const u = Math.max(0, Math.min(1, ((c.rx - a[0]) * vx + (c.ry - a[1]) * vy) / (vx * vx + vy * vy || 1)));
  if (Math.hypot(a[0] + vx * u - c.rx, a[1] + vy * u - c.ry) - h > INNER + 2) return '';
  const f1 = (v: number): string => v.toFixed(1);
  const moving = s.do === 'walk' || s.do === 'run';
  if (c.ppm < DOG_FULL) {
    const style = `--t:${-Math.round(d.e)}ms;--ms:${Math.round(s.ms)}ms${moving ? `;--dx:${f1(vx)}px;--dy:${f1(vy)}px` : ''}`;
    // 遠遠的白點：跟銅像的點一樣大，淡淡的邊（不會一眼就看到）
    return `<g class="woof-dog ${s.do}" data-dog="${dog.id}" style="${style}"><g class="dog-go"><circle class="dog-dot" cx="${f1(a[0])}" cy="${f1(a[1])}" r="${Math.min(4, Math.max(1.2, c.ppm * 0.75)).toFixed(1)}" /></g></g>`;
  }
  // 面向哪：從起點往這個方向 1 公尺的那一點在畫面上的方向（順時針、0 是上）
  const face = (dir: Pt): number => {
    const m = PARK_YARD.metres(s.from, [s.from[0] + dir[0], s.from[1] + dir[1]]) || 1;
    const q = c.at(...g.to([s.from[0] + dir[0] / m, s.from[1] + dir[1] / m]));
    return q ? (Math.atan2(q[0] - a[0], -(q[1] - a[1])) * 180) / Math.PI : 0;
  };
  animateDogs();
  return dogMarkup(dog, d, { ax: a[0], ay: a[1], bx: b[0], by: b[1], b0: face(s.dir0), b1: face(s.dir), k: c.ppm, start: s.start }, dogHeading());
}

/**
 * 火箭（地球和汪星共用一支，記得在哪一邊，存在 localStorage 的 dr.rocket，重新整理也還在；一開始收在地球的發射口底下）：
 * - stored：收在這一邊的發射口（廣場中間那塊草皮）底下，看不到；點這一邊的銅像叫出來；
 * - summon（SUMMON_MS）：發射口從中間分成兩半、帶著上面的草往兩邊滑進地底，底下是黑黑的井，火箭慢慢升上來，門再滑回來關上；
 * - parked：火箭停在草皮上，點得到（rocket-hit）：問要不要飛到另一邊（地球→汪星、汪星→地球）；再點銅像收回去：
 * - stow（STOW_MS）：發射口打開、火箭降回井裡、門關上，收著（stored）；
 * - depart（DEPART_MS）：點火（火焰、白煙、抖一抖）、離地，之後 away：main.ts 讓小火箭（tripSvg）從這裡接手、移到雷達正中間陪著飛
 *   （拉遠、鏡頭從這一顆移到另一顆、拉近），最後移到降落開始的地方交回來；
 * - arrive（ARRIVE_MS）：在另一邊的發射口，門打開，火箭從上面（畫面上半部）慢慢降下來、直接降進井裡，門關回來，收在那邊（stored）。
 * 存起來的只有在哪一邊、停在草皮上還是收在底下：飛走時就記成收在另一邊（飛到一半重新整理，火箭就在那邊）。
 * 動畫都是 CSS（styles.css 的 summon-*、depart-*、arrive-*），--t 是這一段已經過了多久（負的），中途重畫（拖曳、縮放）會接著播，不會重來
 */
export type RocketWorld = 'earth' | 'woof';
export type RocketPhase = 'stored' | 'summon' | 'parked' | 'stow' | 'depart' | 'away' | 'arrive';
export const SUMMON_MS = 5000;
export const STOW_MS = 5000;
export const DEPART_MS = 1600;
export const ARRIVE_MS = 5500;
/** 發射口的正中間（台北的經緯度）：火箭站的地方，飛到汪星時汪星轉到這裡、回地球時雷達正中間換到這裡 */
export const HATCH_CENTER: Pt = [ZHONGSHAN_PARK.hatch.reduce((s, p) => s + p[0], 0) / 4, ZHONGSHAN_PARK.hatch.reduce((s, p) => s + p[1], 0) / 4];
const LS_ROCKET = 'dr.rocket';
type Rocket = { world: RocketWorld; phase: RocketPhase; at: number };
let rocket: Rocket | null = null;
/** 存起來的火箭（在哪一邊、停著還是收著）；沒存過、讀不到是收在地球 */
function loadRocket(): Rocket {
  try {
    const v = JSON.parse(localStorage.getItem(LS_ROCKET) ?? 'null') as { world?: string; parked?: boolean } | null;
    if (v && (v.world === 'earth' || v.world === 'woof')) return { world: v.world, phase: v.parked ? 'parked' : 'stored', at: 0 };
  } catch {
    /* 沒有 localStorage（隱私模式、測試）就從地球開始 */
  }
  return { world: 'earth', phase: 'stored', at: 0 };
}
function saveRocket(world: RocketWorld, parked: boolean): void {
  try {
    localStorage.setItem(LS_ROCKET, JSON.stringify({ world, parked }));
  } catch {
    /* 存不了就只記在這一頁 */
  }
}
/** 火箭現在在哪、在做什麼、這一段過了幾毫秒（summon 播完是停著、arrive 播完是收著，depart 播完是飛走了） */
export function rocketNow(now = performance.now()): { world: RocketWorld; phase: RocketPhase; e: number } {
  rocket ??= loadRocket();
  const e = now - rocket.at;
  const { world, phase } = rocket;
  if (phase === 'summon' && e >= SUMMON_MS) return { world, phase: 'parked', e };
  if ((phase === 'arrive' && e >= ARRIVE_MS) || (phase === 'stow' && e >= STOW_MS)) return { world, phase: 'stored', e };
  if (phase === 'depart' && e >= DEPART_MS) return { world, phase: 'away', e };
  return { world, phase, e };
}
/** 點了這一邊的銅像：火箭收在這一邊就叫出來（回傳 false 是不在這一邊、或已經出來了） */
export function summonRocket(world: RocketWorld, now = performance.now()): boolean {
  const r = rocketNow(now);
  if (r.world !== world || r.phase !== 'stored') return false;
  rocket = { world, phase: 'summon', at: now };
  saveRocket(world, true);
  return true;
}
/** 火箭停在這一邊的草皮上時點了銅像：收回井裡（回傳 false 是沒有停在這一邊） */
export function stowRocket(world: RocketWorld, now = performance.now()): boolean {
  const r = rocketNow(now);
  if (r.world !== world || r.phase !== 'parked') return false;
  rocket = { world, phase: 'stow', at: now };
  saveRocket(world, false);
  return true;
}
/** 要飛了：停著才能飛，回傳要飛去哪一邊（null 是不能飛）；這時候就記成收在那一邊 */
export function departRocket(now = performance.now()): RocketWorld | null {
  const r = rocketNow(now);
  if (r.phase !== 'parked') return null;
  rocket = { world: r.world, phase: 'depart', at: now };
  const to: RocketWorld = r.world === 'earth' ? 'woof' : 'earth';
  saveRocket(to, false);
  return to;
}
/** 飛到了：在這一邊的發射口打開門、降進井裡、關上 */
export function arriveRocket(world: RocketWorld, now = performance.now()): void {
  rocket = { world, phase: 'arrive', at: now };
  saveRocket(world, false);
}
/** 下次用到時重新讀存起來的（測試用） */
export function resetRocket(): void {
  rocket = null;
}

/** 火箭（側面、站著）：底在 (0, 0)，約 8.5 公尺高、3.5 公尺寬（含尾翼），白色機身、紅色鼻錐和尾翼、一個圓窗；底下的火焰會閃，旁邊的白煙 */
const rocketSvg = (clip: string): string =>
  `<g class="rocket-fly">` +
  `<g class="rocket-flame"><g class="rocket-flicker"><path class="flame-out" d="M-0.62 0.15Q-0.75 1.7 0 3.6Q0.75 1.7 0.62 0.15Z" /><path class="flame-in" d="M-0.32 0.15Q-0.38 1.1 0 2.2Q0.38 1.1 0.32 0.15Z" /></g></g>` +
  `<g${clip ? ` clip-path="url(#${clip})"` : ''}><g class="rocket-rise">` +
  `<path class="rocket-red" d="M-0.9 -2.4L-1.75 -0.1L-1.75 0.15L-0.9 -0.35Z" /><path class="rocket-red rocket-red-dark" d="M0.9 -2.4L1.75 -0.1L1.75 0.15L0.9 -0.35Z" />` +
  `<path class="rocket-nozzle" d="M-0.55 -0.3L0.55 -0.3L0.72 0.18L-0.72 0.18Z" />` +
  `<path class="rocket-body" d="M-0.9 -0.3L-0.9 -5.4L0.9 -5.4L0.9 -0.3Z" /><path class="rocket-shade" d="M0.35 -5.4L0.9 -5.4L0.9 -0.3L0.35 -0.3Z" />` +
  `<path class="rocket-red" d="M-0.9 -1.35L0.9 -1.35L0.9 -1L-0.9 -1Z" />` +
  `<path class="rocket-red" d="M-0.9 -5.4Q-0.85 -7.3 0 -8.5Q0.85 -7.3 0.9 -5.4Z" /><path class="rocket-shade" d="M0.25 -5.4Q0.45 -7 0 -8.5Q0.85 -7.3 0.9 -5.4Z" />` +
  `<circle class="rocket-window" cx="0" cy="-3.9" r="0.4" /><circle class="rocket-glint" cx="-0.12" cy="-4.02" r="0.12" />` +
  `<path class="rocket-red" d="M-0.13 -1.9L0.13 -1.9L0.13 0.15L-0.13 0.15Z" />` +
  `</g></g></g>` +
  `<g class="rocket-smoke">${[
    [-2.4, 0.25, 1.1, 0],
    [-1.3, -0.3, 1.2, 80],
    [0, 0.4, 1.3, 40],
    [1.3, -0.2, 1.2, 120],
    [2.5, 0.3, 1, 60],
  ]
    .map(([x, y, r, d]) => `<circle style="--d:${d}ms" cx="${x}" cy="${y}" r="${r}" />`)
    .join('')}</g>`;
/** 火箭高幾公尺（點的範圍照這個大小） */
const ROCKET_H = 8.5;
const ROCKET_HIT = 20;

/** 飛行中小火箭在雷達正中間（固定大小） */
export const TRIP_AT: TripAt = { x: C, y: C + 12, k: 3.4 };
/** 降落開始時地圖上的火箭在哪（雷達外圈 scaleKm、正中間是發射口）：小火箭最後移到這裡交回來 */
export function arriveAt(scaleKm: number): TripAt {
  const ppm = INNER / (scaleKm * 1000);
  return { x: C, y: C - Math.min(45 * ppm, 0.35 * INNER), k: ppm };
}

/** 飛行中畫在雷達正中間的小火箭（火焰一直噴、左右晃，旁邊一道道往後的氣流）；rocket-tilt 繞火箭中間轉（頭朝要去的方向） */
export function tripSvg(): string {
  return (
    `<g class="rocket-trip" transform="translate(${TRIP_AT.x} ${TRIP_AT.y}) scale(${TRIP_AT.k})">` +
    `<g transform="translate(0 -4)"><g class="rocket-tilt"><g transform="translate(0 4)">` +
    `<path class="trip-streak" d="M-3 -16L-3 8M3.2 -12L3.2 12M-5.5 -6L-5.5 14M5.8 -18L5.8 4" />` +
    `<g class="rocket-wobble">${rocketSvg('')}</g></g></g></g></g>`
  );
}

/** 火箭這一段（已經過了 e 毫秒）：發射口的井和兩片門（叫出來、收回去、降進去時）、火箭（站著，跟銅像一樣照 data-at 轉回來） */
function rocketPart(g: ParkGeom, c: ParkCanvas, phase: RocketPhase, e: number): string {
  const q = g.hatch.map(([a, b]) => c.at(a, b));
  if (q.some((p) => !p)) return '';
  const [ne, nw, sw, se] = q as Pt[];
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [n, s] = [mid(ne, nw), mid(sw, se)];
  const o = mid(n, s);
  const f1 = (v: number): string => v.toFixed(1);
  const poly = (pts: Pt[]): string => `M${pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L')}Z`;
  const at = `${f1(o[0])} ${f1(o[1])}`;
  // 降落從畫面上半部（雷達中心上面外圈的 0.35 倍、最多 45 公尺）開始，一飛到就看得到
  const land = phase === 'arrive' ? `;--land:-${f1(Math.min(45, (0.35 * INNER) / c.ppm))}px` : '';
  const hatch = phase === 'summon' || phase === 'arrive' || phase === 'stow';
  let out = `<g class="park-launch ${phase}"${phase === 'parked' ? '' : ` style="--t:${-Math.round(e)}ms${land}"`}>`;
  if (hatch) {
    // 兩片門上的草：跟草地上的同一叢一叢（只長發射口這一塊），門滑開時跟著走；滑出發射口的部分收進地底（照發射口剪掉）
    const t = c.textures ? parkTexture(g, 'grass', c, g.hatchPatches) : null;
    const grass = t ? `<path class="park-grass" transform="scale(0.1)" stroke-width="${(t.w * 10).toFixed(1)}" d="${t.d}" />` : '';
    const door = (side: string, pts: Pt[], [dx, dy]: Pt): string =>
      `<g class="launch-door" style="--dx:${f1(dx)}px;--dy:${f1(dy)}px"><clipPath id="park-door-${side}"><path d="${poly(pts)}" /></clipPath>` +
      `<path class="door-base" d="${poly(pts)}" /><g clip-path="url(#park-door-${side})"><path class="door-top" d="${poly(pts)}" />${grass}</g></g>`;
    out +=
      `<clipPath id="park-hatch"><path d="${poly([ne, nw, sw, se])}" /></clipPath>` +
      `<path class="launch-shaft" d="${poly([ne, nw, sw, se])}" /><path class="launch-shaft-in" d="${poly([ne, nw, sw, se].map(([x, y]): Pt => [o[0] + (x - o[0]) * 0.75, o[1] + (y - o[1]) * 0.75]))}" />` +
      `<g clip-path="url(#park-hatch)">${door('w', [n, nw, sw, s], [nw[0] - n[0], nw[1] - n[1]])}${door('e', [ne, n, s, se], [ne[0] - n[0], ne[1] - n[1]])}</g>`;
  }
  out += `<g class="park-rocket" data-at="${at}"><g transform="translate(${at}) scale(${+c.ppm.toPrecision(4)})">`;
  out += hatch ? `<clipPath id="park-rocket-clip"><rect x="-4" y="-80" width="8" height="80.25" /></clipPath>${rocketSvg('park-rocket-clip')}` : rocketSvg('');
  out += `</g>`;
  if (phase === 'parked') out += `<circle class="rocket-hit" cx="${at.split(' ')[0]}" cy="${f1(o[1] - ROCKET_H * 0.45 * c.ppm)}" r="${f1(Math.max(ROCKET_HIT, ROCKET_H * 0.55 * c.ppm))}" />`;
  return `${out}</g></g>`;
}

/**
 * 中山公園：範圍淡淡填色、虛線的邊；拉近到 1.8 km 內再畫草地花圃（淡淡的草綠色、點線的邊）、水面（淡淡的水藍色、虛線的邊）、
 * 步道（跟街道的細線一樣）、建築（實線）、孫中山銅像（點了叫出火箭）、火箭、汪星的狗，拉近到幾百公尺內草地長出一叢叢的草、水面有一道道的水波
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
  // 狗只在汪星，畫在火箭、銅像後面（在它們後面一點時被擋住）
  if (g.name === 'woof' && c.ppm >= STATUE_FROM) {
    dogWorld = g;
    for (const dog of PARK_DOGS) out += dogPart(g, c, dog);
  }
  const r = rocketNow();
  if (r.world === g.name && r.phase !== 'away' && r.phase !== 'stored' && r.e >= 0) out += rocketPart(g, c, r.phase, r.e);
  const s = c.ppm >= STATUE_FROM ? c.at(...g.statue) : null;
  const h = STATUE_H * c.ppm;
  if (s && Math.hypot(s[0] - c.rx, s[1] - c.ry) - h < INNER + 2) {
    const [x, y] = s.map((v) => v.toFixed(1));
    out +=
      c.ppm < STATUE_FULL
        ? `<g class="park-statue" data-at="${x} ${y}"><circle class="statue-dot" cx="${x}" cy="${y}" r="${Math.min(4, Math.max(1.2, c.ppm * 0.75)).toFixed(1)}" /></g>`
        : `<g class="park-statue" data-at="${x} ${y}"><circle class="statue-hit" cx="${x}" cy="${(s[1] - h * 0.4).toFixed(1)}" r="${Math.max(STATUE_HIT, h * 0.6).toFixed(1)}" />` +
          `<g transform="translate(${x} ${y}) scale(${+c.ppm.toPrecision(4)})">${STATUE_SVG}</g></g>`;
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
/** 畫面上的草或水波（畫的座標乘 10）和線的粗細；太遠、畫面上沒有草地（水面）就是 null；only 是只長在這幾塊裡（跟長滿時同一叢一叢） */
export function parkTexture(g: ParkGeom, kind: 'grass' | 'ripple', c: Pick<ParkCanvas, 'ppm' | 'center' | 'rx' | 'ry' | 'at'>, only?: Patches): { d: string; w: number } | null {
  const [all, t, salt] = kind === 'grass' ? [g.lawnPatches, GRASS, 0] : [g.pondPatches, RIPPLES, 1];
  // only：只長這幾塊（發射口的門上），位置跟長滿草地時一樣
  const area = only ?? all;
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
export const EARTH: ParkWorld = { name: 'earth', to: (p) => p, my: 110_574, mx: (lat) => 111_320 * Math.cos(lat * RAD) };

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
