/**
 * 中山公園（國父紀念館）：地球的雷達和汪星共用的一份畫法——資料（zhongshan.ts）、畫哪些東西、拉近到多少才畫、
 * 草和水波怎麼長、附近可以放大到多近，都只寫在這裡，改了兩邊一起變。
 * 兩邊只差在經緯度怎麼換到畫面上（ParkCanvas）：地球是雷達的平面（以雷達正中間為中心、北在上，整層跟著指北針轉，earthParkSvg），
 * 汪星是球面（ParkWorld 把台北的經緯度換成汪星的，space.ts）。地球上第一次在公園附近才載入
 */
import type { LatLng } from './geo';
import { RADAR_GEOM, RADAR_VIEW, viewReach, viewRect, type TripAt } from './radar';
import { ZHONGSHAN_PARK } from './zhongshan';
import { MALTESE, dogHeight } from './dog';
import { animateDogs, Dog, dogById, dogHeading, dogMarkup, NATURE, wakeDogs, type DogNature, type DogYard } from './dogs';
export { onDogMove } from './dogs';

const { c: C, inner: INNER } = RADAR_GEOM;
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
  /** 建築的屋頂：填色的圈（逆時針），和每一棟當成四坡頂的長方形（roofOf） */
  roofs: Pt[][];
  water: Pt[][];
  green: Pt[][];
  paths: Pt[][];
  /** 翠湖的曲橋（步道那樣的線，bridgesSvg 畫成有欄杆的橋面） */
  bridges: Pt[][];
  statue: Pt;
  /** 映池前面的國旗旗桿（底座的中心）、旗台（填色的圈，從上面看） */
  flagpole: Pt;
  flagBase: Pt[];
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
    roofs: ZHONGSHAN_PARK.buildings.map(area),
    water: ZHONGSHAN_PARK.water.flat().map(loop),
    green: ZHONGSHAN_PARK.green.map(loop),
    paths: ZHONGSHAN_PARK.paths.map((l) => dense(l.map(w.to))),
    bridges: ZHONGSHAN_PARK.bridges.map((l) => dense(l.map(w.to))),
    statue: w.to(ZHONGSHAN_PARK.statue),
    flagpole: w.to(ZHONGSHAN_PARK.flagpole),
    flagBase: area(ZHONGSHAN_PARK.flagBase),
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
/**
 * 狗待的地方（照面積抽、在裡面走來走去、停下來休息；編號就是狗的 ring）：先是草皮（ZHONGSHAN_PARK.green 的編號），
 * 再來每一條步道（中線兩邊各 PATH_SPOT_M，太短的不算），最後是旗台。edges 是邊（公尺座標，找附近的地方用）
 */
interface ParkArea {
  kind: 'lawn' | 'path' | 'deck';
  m2: number;
  edges: Array<[Pt, Pt]>;
  /** 草皮、旗台：一圈台北的經緯度 */
  ring?: Pt[];
  /** 步道：中線（公尺座標）、每一點走了多遠 */
  line?: Pt[];
  cum: number[];
}
const PATH_SPOT_M = 0.8;
/** 在步道上走來走去：只在現在這裡前後幾公尺抽 */
const WITHIN_PATH_M = 15;
/** 不太會去的地方：抽到那裡的只留這麼多 */
const RARE_KEEP = 0.12;
let areaList: ParkArea[] | null = null;
export function parkAreas(): ParkArea[] {
  if (areaList) return areaList;
  const fromRing = (r: Pt[]): ParkArea => {
    const m = r.map(toM);
    return { kind: 'lawn', ring: r, m2: Math.abs(ringArea(m)), edges: m.map((p, i): [Pt, Pt] => [p, m[(i + 1) % m.length]]), cum: [] };
  };
  const paths = ZHONGSHAN_PARK.paths.flatMap((l): ParkArea[] => {
    const line = l.map(toM);
    const cum = line.map(() => 0);
    for (let i = 1; i < line.length; i++) cum[i] = cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    const len = cum[cum.length - 1];
    return len < 2 ? [] : [{ kind: 'path', line, cum, m2: len * 2 * PATH_SPOT_M, edges: line.slice(1).map((p, i): [Pt, Pt] => [line[i], p]) }];
  });
  return (areaList = [...ZHONGSHAN_PARK.green.map(fromRing), ...paths, { ...fromRing(ZHONGSHAN_PARK.flagBase), kind: 'deck' }]);
}

/**
 * 狗走得到的地方（照使用者說的：草地、步道、橋和旗台可以走）：在草皮、旗台上（不在建築、水裡，不上旗桿的底座），或離步道 PATH_W 公尺內；翠湖的曲橋上（橋面 BRIDGE_W_M 寬，
 * 離橋中線 BRIDGE_WALK_M 內）水上也走得到，橋接到的小島不算水（沒有橋的小島還是去不了）；
 * 一段直直走過去的路每 0.5 公尺都要走得到（不穿過建築、不橫越廣場）。換草皮、去湖邊照步道走（像導航：步道每 3 公尺一點、
 * 接在一起的步道連起來，最短的走法，再把看得到的點之間拉直）。算的時候換成公園附近的公尺（往東、往北）
 */
const PATH_W = 1.2;
const BRIDGE_WALK_M = 0.7;
/** 旗台上旗桿的底座（離旗桿這麼近）上不去 */
const POLE_BLOCK_M = 1.5;
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

/** 公園裡走得到的地方（第一次用到才算）：草皮、旗台、擋住的（建築、水池；holes 是水池裡橋接到的小島）、旗桿底座、橋上、步道的每一段（5 公尺一格的索引）、步道的路網 */
interface Walk {
  lawns: Array<{ ring: Pt[]; box: Box }>;
  deck: { ring: Pt[]; box: Box };
  pole: Pt;
  blocks: Array<{ ring: Pt[]; box: Box; holes: Pt[][] }>;
  onBridge: (p: Pt) => boolean;
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
  const deck = ringM(ZHONGSHAN_PARK.flagBase);
  const pole = toM(ZHONGSHAN_PARK.flagpole);
  const bridges = ZHONGSHAN_PARK.bridges.map((l) => l.map(toM));
  const onBridge = (p: Pt): boolean => bridges.some((l) => l.some((q, i) => i > 0 && segDist(p, l[i - 1], q) <= BRIDGE_WALK_M));
  // 水池裡的小島：橋的一頭在島上（或離島邊 1.5 公尺內）才走得到
  const linked = (r: Pt[]): boolean => bridges.some((l) => [l[0], l[l.length - 1]].some((q) => inRingM(q, r) || r.some((a, i) => segDist(q, a, r[(i + 1) % r.length]) < 1.5)));
  const blocks = [
    ...ZHONGSHAN_PARK.buildings.map((r) => ({ ...ringM(r), holes: [] })),
    ...ZHONGSHAN_PARK.water.map(([outer, ...islands]) => ({ ...ringM(outer), holes: islands.map((r) => r.map(toM)).filter(linked) })),
  ];
  const blocked = (p: Pt): boolean => !onBridge(p) && blocks.some((b) => inBox(p, b.box) && inRingM(p, b.ring) && !b.holes.some((h) => inRingM(p, h)));
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
  return (walkData = { lawns, deck, pole, blocks, onBridge, segs, grid, nodes, nodeGrid, adj });
}

/**
 * 中山公園給一隻狗待的地方（DogYard）：照面積抽一塊待的地方（parkAreas：草皮、每一條步道、旗台，跟草皮一樣可以走來走去、停下來休息），
 * 在公園裡、不在發射口和銅像旁邊（火箭、銅像不會蓋住）；avoid 是這隻狗不去的地方（一圈圈台北的經緯度，例如小法不去公園最右上那一區），
 * rare 是不太會去的地方（抽到那裡的只留 RARE_KEEP 的機會，路過可以）；走多遠照汪星的公尺算
 */
export function parkYard(o: { avoid?: Pt[][]; rare?: Pt[][] } = {}): DogYard {
  const zone = (rs: Pt[][]): Array<{ ring: Pt[]; box: Box }> =>
    rs.map((r) => {
      const ring = r.map(toM);
      return { ring, box: boxOf(ring) };
    });
  const avoid = zone(o.avoid ?? []);
  const rare = zone(o.rare ?? []);
  /** 不太會去的地方：要去那裡的只留 RARE_KEEP 的機會（換地方、一開始放在哪時用；已經在那裡就照常走） */
  const keep = (at: Pt, rand: () => number): boolean => !rare.some((b) => inBox(toM(at), b.box) && inRingM(toM(at), b.ring)) || rand() < RARE_KEEP;
  /** 這一點走得到嗎（公尺座標）：不去的地方、旗桿底座不行；橋上可以；不在建築、水裡（橋接到的小島可以），在草皮、旗台上或離步道 PATH_W 內 */
  const okM = (p: Pt): boolean => {
    const w = walkOf();
    if (avoid.some((b) => inBox(p, b.box) && inRingM(p, b.ring))) return false;
    if (Math.hypot(p[0] - w.pole[0], p[1] - w.pole[1]) < POLE_BLOCK_M) return false;
    if (w.onBridge(p)) return true;
    if (w.blocks.some((b) => inBox(p, b.box) && inRingM(p, b.ring) && !b.holes.some((h) => inRingM(p, h)))) return false;
    if (w.lawns.some((l) => inBox(p, l.box) && inRingM(p, l.ring))) return true;
    if (inBox(p, w.deck.box) && inRingM(p, w.deck.ring)) return true;
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
  /**
   * 這一塊待的地方裡隨機一個走得到的地方（在公園裡，不在發射口和銅像旁邊，不太會去的地方大多不要）；near 是只在這一點附近幾公尺內抽；抽不到是 null。
   * 草皮、旗台在範圍裡抽；步道沿著中線抽（near 時只抽投影到中線那一點前後幾公尺），往兩邊最多 PATH_SPOT_M
   */
  const spotIn = (ring: number, rand: () => number, near?: { at: Pt; m: number }): Pt | null => {
    const area = parkAreas()[ring];
    if (!area) return null;
    const [my, mx] = [EARTH.my, EARTH.mx(HATCH_CENTER[0])];
    const far = (p: Pt, q: Pt, m: number): boolean => Math.abs((p[0] - q[0]) * my) > m || Math.abs((p[1] - q[1]) * mx) > m;
    const good = (at: Pt): boolean =>
      inRing(at, ZHONGSHAN_PARK.outline) &&
      far(at, HATCH_CENTER, 6) &&
      far(at, ZHONGSHAN_PARK.statue, 2.5) &&
      okM(toM(at)) &&
      keep(at, rand);
    if (area.line) {
      const { line, cum } = area;
      const total = cum[cum.length - 1];
      let [s0, s1] = [0, total];
      if (near) {
        // 投影到中線最近的那一點，前後 near.m 公尺
        const a = toM(near.at);
        let best = { d: Infinity, s: 0 };
        for (let k = 1; k < line.length; k++) {
          const d = segDist(a, line[k - 1], line[k]);
          if (d < best.d) {
            const [dx, dy] = [line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]];
            const t = Math.max(0, Math.min(1, ((a[0] - line[k - 1][0]) * dx + (a[1] - line[k - 1][1]) * dy) / (dx * dx + dy * dy || 1)));
            best = { d, s: cum[k - 1] + t * (cum[k] - cum[k - 1]) };
          }
        }
        if (best.d > near.m) return null;
        [s0, s1] = [Math.max(0, best.s - near.m), Math.min(total, best.s + near.m)];
      }
      for (let i = 0; i < 40; i++) {
        const sAt = s0 + rand() * (s1 - s0);
        let k = 1;
        while (k < cum.length - 1 && cum[k] < sAt) k++;
        const len = cum[k] - cum[k - 1] || 1;
        const t = (sAt - cum[k - 1]) / len;
        const [dx, dy] = [(line[k][0] - line[k - 1][0]) / len, (line[k][1] - line[k - 1][1]) / len];
        const side = (rand() * 2 - 1) * PATH_SPOT_M;
        const at = fromM([line[k - 1][0] + (line[k][0] - line[k - 1][0]) * t - dy * side, line[k - 1][1] + (line[k][1] - line[k - 1][1]) * t + dx * side]);
        if (good(at)) return at;
      }
      return null;
    }
    const r = area.ring!;
    let [a0, a1] = [Math.min(...r.map((q) => q[0])), Math.max(...r.map((q) => q[0]))];
    let [b0, b1] = [Math.min(...r.map((q) => q[1])), Math.max(...r.map((q) => q[1]))];
    if (near) {
      [a0, a1] = [Math.max(a0, near.at[0] - near.m / my), Math.min(a1, near.at[0] + near.m / my)];
      [b0, b1] = [Math.max(b0, near.at[1] - near.m / mx), Math.min(b1, near.at[1] + near.m / mx)];
      if (a0 > a1 || b0 > b1) return null;
    }
    for (let i = 0; i < 40; i++) {
      const at: Pt = [a0 + rand() * (a1 - a0), b0 + rand() * (b1 - b0)];
      if (inRing(at, r) && good(at)) return at;
    }
    return null;
  };
  return {
    anywhere: (rand) => {
      const areas = parkAreas();
      const total = areas.reduce((a, b) => a + b.m2, 0);
      for (let tries = 0; tries < 1000; tries++) {
        let pick = rand() * total;
        const ring = Math.max(0, areas.findIndex((a) => (pick -= a.m2) < 0));
        const at = spotIn(ring, rand);
        if (at && keep(at, rand)) return { ring, at };
      }
      return null;
    },
    // 步道很長：只在現在這裡前後幾公尺抽（草皮、旗台整塊抽）
    within: (ring, rand, near) => (near && parkAreas()[ring]?.line ? spotIn(ring, rand, { at: near, m: WITHIN_PATH_M }) : spotIn(ring, rand)),
    canWalk: (a, b) => lineM(toM(a), toM(b)),
    route: (a, b, maxM = CROSS_MAX_M) => routeM(toM(a), toM(b), maxM)?.map(fromM) ?? null,
    // 附近的其他地方（草皮、步道、旗台，邊離這裡 CROSS_NEAR_M 內，照面積抽，在離這裡 CROSS_NEAR_M 內的那一部分抽一處），照步道走過去，最多 CROSS_MAX_M 公尺
    elsewhere: (ring, at, rand) => {
      const a = toM(at);
      const areas = parkAreas();
      const near = areas.flatMap((x, i) => (i !== ring && x.edges.some(([p, q]) => segDist(a, p, q) < CROSS_NEAR_M) ? [i] : []));
      const total = near.reduce((t, i) => t + areas[i].m2, 0);
      for (let tries = 0; tries < 12 && near.length; tries++) {
        let pick = rand() * total;
        const i = near.find((k) => (pick -= areas[k].m2) < 0) ?? near[near.length - 1];
        const to = spotIn(i, rand, { at, m: CROSS_NEAR_M });
        if (to && !keep(to, rand)) continue;
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
/** 小法不太會去的地方：國父紀念館後面（北邊，紀念館北牆以北、紀念館西牆到不去的那一區之間）；正面是映池、旗桿那邊（南邊） */
export const XIAOFA_RARE: Pt[] = [[25.04053, 121.55974], [25.0413, 121.55974], [25.0413, 121.56098], [25.04053, 121.56098]];

/**
 * 小法的個性：特別喜歡走走聞聞——在草皮裡走路大多邊走邊聞（約七成，一般的狗約四成），
 * 停下來大多低頭聞（白天約七成，一般的狗約一半）、每次聞久一點（3～7 秒）；站著、發呆、坐、趴、伸懶腰相對少，
 * 睡覺（停下來時睡的機率）、喝水、跑步、換草皮跟一般的狗一樣
 */
export const XIAOFA_NATURE: DogNature = {
  ...NATURE,
  nose: 0.7,
  stays: { sniff: 0.7, stand: 0.06, idle: 0.07, sit: 0.05, lie: 0.06, stretch: 0.06 },
  last: { ...NATURE.last, sniff: [3000, 7000] },
};

/** 公園裡的狗：小法（使用者的馬爾濟斯；不去公園最右上那一區、不太會去國父紀念館後面；特別喜歡走走聞聞） */
export const PARK_DOGS: Dog[] = [new Dog({ id: 'xiaofa', name: '小法', look: MALTESE, yard: parkYard({ avoid: [XIAOFA_AVOID], rare: [XIAOFA_RARE] }), nature: XIAOFA_NATURE })];

/** 搭火箭到汪星：每隻狗換到隨機一塊草皮 */
export function moveDogs(): void {
  for (const d of PARK_DOGS) d.place();
}

/** 這隻狗現在在哪（台北的經緯度；鎖定時雷達正中間跟著牠）；沒有這隻是 null */
export function dogAt(id: string): Pt | null {
  return dogById(id)?.now().at ?? null;
}

/** 點了這隻狗：轉過來面向你坐下（或只轉頭看你） */
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
  if (Math.hypot(a[0] + vx * u - c.rx, a[1] + vy * u - c.ry) - h > viewReach() + 2) return '';
  const f1 = (v: number): string => v.toFixed(1);
  const moving = s.do === 'walk' || s.do === 'run';
  if (c.ppm < DOG_FULL) {
    const style = `--t:${-Math.round(d.e)}ms;--ms:${Math.round(s.ms)}ms${moving ? `;--dx:${f1(vx)}px;--dy:${f1(vy)}px` : ''}`;
    // 遠遠的白點：跟銅像的點一樣大，淡淡的邊（不會一眼就看到），雷達掃過時淡淡地亮一下（sweep-lit，radar.ts 的 glint）；原地轉身的（以後腳為支點挪一點點）放在轉完的地方
    const o = moving ? a : b;
    return `<g class="woof-dog ${s.do}" data-dog="${dog.id}" style="${style}"><g class="dog-go"><circle class="dog-dot sweep-lit" cx="${f1(o[0])}" cy="${f1(o[1])}" r="${Math.min(4, Math.max(1.2, c.ppm * 0.75)).toFixed(1)}" /></g></g>`;
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
  // 旗台：映池前面的旗桿底下那一塊石頭鋪的平台（從上面看），旗桿站在中間
  const flagBase = c.area([g.flagBase]);
  if (flagBase) out += `<path class="park-flag-base" d="${flagBase}" />`;
  out += bridgesSvg(g, c);
  out += roofsSvg(g, c);
  out += `<path class="park-building" d="${c.lines(g.buildings)}" />`;
  // 狗只在汪星，畫在火箭、銅像後面（在它們後面一點時被擋住）
  if (g.name === 'woof' && c.ppm >= STATUE_FROM) {
    dogWorld = g;
    for (const dog of PARK_DOGS) out += dogPart(g, c, dog);
  }
  const r = rocketNow();
  if (r.world === g.name && r.phase !== 'away' && r.phase !== 'stored' && r.e >= 0) out += rocketPart(g, c, r.phase, r.e);
  // 映池前面的旗桿：跟銅像一樣站著畫，先是一個點，畫面上夠高才畫出底座和整根旗桿
  const fp = c.ppm >= STATUE_FROM ? c.at(...g.flagpole) : null;
  if (fp && Math.hypot(fp[0] - c.rx, fp[1] - c.ry) - FLAG_TOP * c.ppm < viewReach() + 2) {
    const [x, y] = fp.map((v) => v.toFixed(1));
    out +=
      `<g class="park-flagpole" data-at="${x} ${y}" data-flip="no">` +
      (c.ppm < FLAG_FULL
        ? `<circle class="flag-dot" cx="${x}" cy="${y}" r="${Math.min(4, Math.max(1.2, c.ppm * 0.9)).toFixed(1)}" />`
        : `<g transform="translate(${x} ${y}) scale(${+c.ppm.toPrecision(4)})">${FLAGPOLE_SVG}</g>`) +
      '</g>';
  }
  const s = c.ppm >= STATUE_FROM ? c.at(...g.statue) : null;
  const h = STATUE_H * c.ppm;
  if (s && Math.hypot(s[0] - c.rx, s[1] - c.ry) - h < viewReach() + 2) {
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
 * 映池前面的國旗旗桿：立體的，跟銅像一樣看得到上面和右邊、左上照光（地上一塊影子、旗桿的影子往右下拉長），不管指北針怎麼轉都站著（不左右翻）。
 * 站在旗台（parkSvg 從上面畫的那一塊）正中間，兩層石頭底座（下層約 2.4 公尺見方、上層 1.4 公尺，各高 0.35 公尺），上面一根往上變細的金屬旗桿（約 15 公尺，左邊亮右邊暗），
 * 頂上一顆金色的圓球，旁邊一條升旗的繩子。旗桿、底座的大小 OSM 沒有，是估的。單位是公尺，(0, 0) 是底座的中心（地上），往上是負的；
 * 雷達外圈約 500 公尺內（STATUE_FROM）先是一個點，畫面上旗桿有 10 個單位高（FLAG_FULL，外圈約 260 公尺內）才畫出整根
 */
const FLAG_POLE_H = 15;
const FLAG_TOP = FLAG_POLE_H + 1.4;
const FLAG_FULL = 10 / FLAG_TOP;
const FLAGPOLE_SVG = (() => {
  const n = (v: number): number => +v.toFixed(3);
  const p = (pts: Array<[number, number]>): string => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)} ${n(y)}`).join('') + 'Z';
  // 往後（往裡面）每公尺在畫面上斜斜的往右上
  const [ox, oy] = [0.156, -0.203];
  const tier = (cls: string, x0: number, y0: number, w: number, h: number, d: number): string => {
    const [dx, dy] = [ox * d, oy * d];
    return (
      `<path class="${cls}-front" d="${p([[x0, y0 - h], [x0 + w, y0 - h], [x0 + w, y0], [x0, y0]])}" />` +
      `<path class="${cls}-side" d="${p([[x0 + w, y0 - h], [x0 + w + dx, y0 - h + dy], [x0 + w + dx, y0 + dy], [x0 + w, y0]])}" />` +
      `<path class="${cls}-top" d="${p([[x0, y0 - h], [x0 + w, y0 - h], [x0 + w + dx, y0 - h + dy], [x0 + dx, y0 - h + dy]])}" />`
    );
  };
  // 上層在下層上面的正中間（往裡面退 0.5 公尺），旗桿在上層上面的正中間
  const [ux, uy] = [-0.7 + ox * 0.5, -0.35 + oy * 0.5];
  const [px, py] = [ux + 0.7 + ox * 0.7, uy - 0.35 + oy * 0.7];
  const [b, t] = [0.11, 0.06];
  const top = py - FLAG_POLE_H;
  return (
    `<ellipse class="flag-shadow" cx="0.7" cy="0.05" rx="1.9" ry="0.42" />` +
    `<path class="flag-shadow" d="${p([[px, py + 0.2], [px + 7, 0.75], [px + 7, 0.9], [px - 0.1, py + 0.45]])}" />` +
    tier('flag-stone', -1.2, 0, 2.4, 0.35, 2.4) +
    tier('flag-stone', ux, uy, 1.4, 0.35, 1.4) +
    `<path class="flag-rope" d="M${n(px + 0.1)} ${n(top + 0.25)}Q${n(px + 0.32)} ${n(py - FLAG_POLE_H / 2)} ${n(px + 0.18)} ${n(py - 1.1)}" />` +
    `<path class="flag-pole" d="${p([[px - b, py], [px - t, top], [px + t, top], [px + b, py]])}" />` +
    `<path class="flag-pole-dark" d="${p([[px + b * 0.25, py], [px + t * 0.25, top], [px + t, top], [px + b, py]])}" />` +
    `<path class="flag-pole-lit" d="${p([[px - b * 0.7, py], [px - t * 0.7, top], [px - t * 0.25, top], [px - b * 0.25, py]])}" />` +
    `<path class="flag-cleat" d="${p([[px + b, py - 1.2], [px + 0.24, py - 1.2], [px + 0.24, py - 1.0], [px + b, py - 1.0]])}" />` +
    `<circle class="flag-ball" cx="${n(px)}" cy="${n(top - 0.18)}" r="0.2" />` +
    `<circle class="flag-ball-lit" cx="${n(px - 0.07)}" cy="${n(top - 0.25)}" r="0.06" />`
  );
})();

/**
 * 翠湖的曲橋（從上面看）：淺色的石頭橋面約 BRIDGE_W_M 寬，兩邊深一點的欄杆（先畫寬一點的深色、再畫橋面，兩頭接岸邊不封起來，
 * 轉角是尖的）；拉近慢慢畫出一塊塊石板（真的間隔 BRIDGE_SLAB_M，畫面上太密就隔一塊畫一塊）和兩邊的欄杆柱（每 BRIDGE_POST_M 一根，轉角也有）。
 * 寬度照真的大小，太細就畫成最細
 */
const BRIDGE_W_M = 1.8;
const BRIDGE_SLAB_M = 0.6;
const BRIDGE_POST_M = 2;
function bridgesSvg(g: ParkGeom, c: ParkCanvas): string {
  const d = c.lines(g.bridges);
  if (!d) return '';
  const { O } = g;
  const ppm = c.ppm;
  const w = Math.max(1.6, BRIDGE_W_M * ppm);
  const rail = Math.max(0.5, 0.12 * ppm);
  const reach = viewReach() + 4;
  const f1 = (n: number): string => n.toFixed(1);
  let out = `<path class="park-bridge-rail" stroke-width="${f1(w + 2 * rail)}" d="${d}" /><path class="park-bridge" stroke-width="${f1(w)}" d="${d}" />`;
  // 石板：畫的這一層間隔 step（畫面上至少 5 像素），外圈約 60 公尺內才淡入；欄杆柱：畫面上間隔 8 像素以上才畫
  const f = Math.log2(5 / (ppm * BRIDGE_SLAB_M));
  const step = BRIDGE_SLAB_M * 2 ** Math.max(0, Math.ceil(f));
  const slabs = c.textures ? Math.max(0, Math.min(1, 2 - f)) : 0;
  const posts = c.textures && BRIDGE_POST_M * ppm >= 8;
  if (!slabs && !posts) return out;
  let slab = '';
  let post = '';
  const r = Math.max(0.6, 0.09 * ppm);
  for (const line of g.bridges) {
    // 每一段：兩頭換到畫面上，沿著段每隔 step 公尺一塊石板（橫跨橋面）、每隔 BRIDGE_POST_M 兩邊各一根柱子
    const pts = line.map(([lat, lng]) => c.at(lat, lng));
    for (let i = 1; i < line.length; i++) {
      const p = pts[i - 1];
      const q = pts[i];
      if (!p || !q) continue;
      const m = Math.hypot((line[i][1] - line[i - 1][1]) * O.mx, (line[i][0] - line[i - 1][0]) * O.my);
      const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
      const len = Math.hypot(dx, dy);
      if (!(m > 0) || !(len > 0)) continue;
      const [nx, ny] = [(-dy / len) * (w / 2), (dx / len) * (w / 2)];
      const near = (x: number, y: number): boolean => Math.hypot(x - c.rx, y - c.ry) <= reach;
      if (slabs) {
        for (let s = step; s < m; s += step) {
          const [x, y] = [p[0] + (dx * s) / m, p[1] + (dy * s) / m];
          if (near(x, y)) slab += `M${f1(x - nx)} ${f1(y - ny)}L${f1(x + nx)} ${f1(y + ny)}`;
        }
      }
      if (posts) {
        const n = Math.max(1, Math.round(m / BRIDGE_POST_M));
        for (let k = 0; k <= n; k++) {
          const [x, y] = [p[0] + (dx * k) / n, p[1] + (dy * k) / n];
          if (near(x, y)) for (const sd of [-1, 1]) post += `M${f1(x + sd * nx - r)} ${f1(y + sd * ny)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`;
        }
      }
    }
  }
  if (slab) out += `<path class="park-bridge-slab" stroke-width="${f1(Math.max(0.3, 0.04 * ppm))}" stroke-opacity="${(0.8 * slabs).toFixed(2)}" d="${slab}" />`;
  if (post) out += `<path class="park-bridge-post" d="${post}" />`;
  return out;
}

/**
 * 建築的屋頂（從上面看）：國父紀念館（最大的那棟）是黃色琉璃瓦，其他是紅褐色的瓦。每一棟用最小的外接長方形當成四坡頂（廡殿頂）：
 * 長邊方向一條屋脊、四個角的斜脊接到屋脊兩頭，照建築的形狀裁掉外面的；拉近（外圈約 150 公尺內）慢慢畫出一條條瓦溝，
 * 從屋簷往上到斜脊、屋脊（長邊那兩面直的、短邊那兩面橫的），真的間隔 ROOF_TILE_M，畫面上比 ROOF_TILE_PX 密就隔一條畫一條，
 * 細一層照拉近的程度慢慢淡入（拉近只會多、不會跳）。屋脊、瓦溝的粗細照真的寬度，太細就畫成最細
 */
const ROOF_TILE_M = 0.3;
const ROOF_TILE_PX = 4;
/** 瓦溝從畫面上的間隔約 ROOF_TILE_PX × 2^4 開始淡入 */
const ROOF_TILE_FROM = 4;
/** 太小的（柱子、小亭子：在台北短邊不到 2 公尺，地球、汪星同一批）只填色 */
const ROOF_MIN_M = 1;
interface RoofBox {
  /** 中心、長邊方向（單位向量），長、短邊的一半（公尺，攤平的） */
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  a: number;
  b: number;
  hall: boolean;
  /** 在台北短邊不到 2 公尺：只填色 */
  tiny: boolean;
}
const roofBoxes = new WeakMap<ParkGeom, RoofBox[]>();
/** 每一棟的最小外接長方形；國父紀念館是最大的那棟，太小的照台北真的大小算（地球、汪星同一批） */
function roofOf(g: ParkGeom): RoofBox[] {
  const had = roofBoxes.get(g);
  if (had) return had;
  const rings = g.roofs.map((r) => r.map(([lat, lng]): Pt => [(lng - g.O.lng) * g.O.mx, (lat - g.O.lat) * g.O.my]));
  const areas = rings.map((r) => Math.abs(ringArea(r)));
  const biggest = areas.indexOf(Math.max(...areas));
  const ky = EARTH.my;
  const kx = EARTH.mx(ZHONGSHAN_PARK.statue[0]);
  const boxes = rings.map((pts, i): RoofBox => ({
    ...minRect(pts),
    hall: i === biggest,
    tiny: minRect(ZHONGSHAN_PARK.buildings[i].map(([lat, lng]): Pt => [lng * kx, lat * ky])).b < ROOF_MIN_M,
  }));
  roofBoxes.set(g, boxes);
  return boxes;
}

/** 最小外接長方形（凸包每一條邊的方向試一次，面積最小的），長邊當 u */
function minRect(pts: Pt[]): Omit<RoofBox, 'hall' | 'tiny'> {
  const hull = convexHull(pts);
  let best: Omit<RoofBox, 'hall' | 'tiny'> = { cx: 0, cy: 0, ux: 1, uy: 0, a: 0, b: 0 };
  let bestArea = Infinity;
  for (let k = 0; k < hull.length; k++) {
    const [x1, y1] = hull[k];
    const [x2, y2] = hull[(k + 1) % hull.length];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len === 0) continue;
    const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len];
    let [s0, s1, t0, t1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const [x, y] of hull) {
      const s = x * ux + y * uy;
      const t = -x * uy + y * ux;
      [s0, s1, t0, t1] = [Math.min(s0, s), Math.max(s1, s), Math.min(t0, t), Math.max(t1, t)];
    }
    if ((s1 - s0) * (t1 - t0) >= bestArea) continue;
    bestArea = (s1 - s0) * (t1 - t0);
    const [sm, tm] = [(s0 + s1) / 2, (t0 + t1) / 2];
    const [cx, cy] = [sm * ux - tm * uy, sm * uy + tm * ux];
    best = s1 - s0 >= t1 - t0 ? { cx, cy, ux, uy, a: (s1 - s0) / 2, b: (t1 - t0) / 2 } : { cx, cy, ux: -uy, uy: ux, a: (t1 - t0) / 2, b: (s1 - s0) / 2 };
  }
  return best;
}

/** 凸包（Andrew monotone chain） */
function convexHull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((m, n) => m[0] - n[0] || m[1] - n[1]);
  const cross = (o: Pt, m: Pt, n: Pt): number => (m[0] - o[0]) * (n[1] - o[1]) - (m[1] - o[1]) * (n[0] - o[0]);
  const half = (list: Pt[]): Pt[] => {
    const h: Pt[] = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
}

function roofsSvg(g: ParkGeom, c: ParkCanvas): string {
  const { O } = g;
  const ppm = c.ppm;
  const reach = viewReach() + 2;
  const f1 = (n: number): string => n.toFixed(1);
  // 瓦溝：畫的這一層間隔 step（畫面上至少 ROOF_TILE_PX），細一層（中間那條）的淡入程度，整個瓦溝的淡入程度
  const f = Math.log2(ROOF_TILE_PX / (ppm * ROOF_TILE_M));
  const k = Math.max(0, Math.ceil(f));
  const step = ROOF_TILE_M * 2 ** k;
  const fine = k > 0 ? Math.min(1, k - f) : 0;
  const tiles = c.textures ? Math.max(0, Math.min(1, ROOF_TILE_FROM - f)) : 0;
  const ridgeW = Math.min(6, Math.max(0.9, 0.4 * ppm));
  const tileW = Math.min(2, Math.max(0.35, 0.08 * ppm));
  // 國父紀念館、其他建築各合成一條 path（填色、屋脊、瓦溝）；屋脊、瓦溝照所有建築的形狀一起裁
  const kinds = ['hall', 'other'] as const;
  const blank = (): Record<(typeof kinds)[number], string> => ({ hall: '', other: '' });
  const [fill, ridge, main, half] = [blank(), blank(), blank(), blank()];
  let clip = '';
  roofOf(g).forEach((r, i) => {
    const d = c.area([g.roofs[i]]);
    if (!d) return;
    const kind = r.hall ? 'hall' : 'other';
    fill[kind] += d;
    clip += d;
    if (r.tiny) return;
    // 長方形裡 (s, t)：沿長邊 s、沿短邊 t，換回經緯度再換到畫面上
    const at = (s: number, t: number): Pt | null => {
      const x = r.cx + s * r.ux - t * r.uy;
      const y = r.cy + s * r.uy + t * r.ux;
      return c.at(O.lat + y / O.my, O.lng + x / O.mx);
    };
    // 整棟都在畫面外面就不畫屋脊、瓦溝
    const mid = at(0, 0);
    if (!mid || Math.hypot(mid[0] - c.rx, mid[1] - c.ry) - Math.hypot(r.a, r.b) * ppm > reach) return;
    const seg = (s1: number, t1: number, s2: number, t2: number): string => {
      const p = at(s1, t1);
      const q = at(s2, t2);
      if (!p || !q) return '';
      // 線段離圓心最近的地方在看得到的範圍外面就不畫
      const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
      const u = Math.max(0, Math.min(1, ((c.rx - p[0]) * dx + (c.ry - p[1]) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(p[0] + dx * u - c.rx, p[1] + dy * u - c.ry) > reach) return '';
      return `M${f1(p[0])} ${f1(p[1])}L${f1(q[0])} ${f1(q[1])}`;
    };
    const { a, b } = r;
    ridge[kind] += seg(-(a - b), 0, a - b, 0) + [-1, 1].flatMap((ss) => [-1, 1].map((tt) => seg(ss * a, tt * b, ss * (a - b), 0))).join('');
    // 瓦溝：長邊那兩面（沿 s 每隔 every 一條，從屋簷 t = ±b 往上到斜脊或屋脊）、短邊那兩面（沿 t，從 s = ±a 往上）
    const grooves = (from: number, every: number): string => {
      let dd = '';
      for (let s = Math.ceil((-a - from) / every) * every + from; s < a; s += every) {
        const up = Math.max(0, b - (a - Math.abs(s)));
        dd += seg(s, b, s, up) + seg(s, -b, s, -up);
      }
      for (let t = Math.ceil((-b - from) / every) * every + from; t < b; t += every) {
        const up = a - (b - Math.abs(t));
        dd += seg(a, t, up, t) + seg(-a, t, -up, t);
      }
      return dd;
    };
    if (tiles > 0) main[kind] += grooves(0, step);
    if (tiles > 0 && fine > 0.02) half[kind] += grooves(step / 2, step);
  });
  let out = '';
  let lines = '';
  for (const kind of kinds) {
    const cls = kind === 'hall' ? ' hall' : '';
    if (fill[kind]) out += `<path class="park-roof${cls}" d="${fill[kind]}" />`;
    if (main[kind]) lines += `<path class="park-tile${cls}" stroke-width="${tileW.toFixed(2)}" stroke-opacity="${(0.5 * tiles).toFixed(2)}" d="${main[kind]}" />`;
    if (half[kind]) lines += `<path class="park-tile${cls}" stroke-width="${tileW.toFixed(2)}" stroke-opacity="${(0.5 * tiles * fine).toFixed(2)}" d="${half[kind]}" />`;
  }
  for (const kind of kinds) if (ridge[kind]) lines += `<path class="park-ridge${kind === 'hall' ? ' hall' : ''}" stroke-width="${ridgeW.toFixed(2)}" d="${ridge[kind]}" />`;
  if (lines) out += `<clipPath id="park-roofs-${g.name}"><path d="${clip}" /></clipPath><g clip-path="url(#park-roofs-${g.name})">${lines}</g>`;
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
  const [all, salt] = kind === 'grass' ? [g.lawnPatches, 0] : [g.pondPatches, 1];
  // only：只長這幾塊（發射口的門上），位置跟長滿草地時一樣
  const area = only ?? all;
  const box: Box = [area.box[0], area.box[1], area.box[2], area.box[3]];
  // 上一個所在的那一塊先看（旁邊的格子多半在同一塊）
  let list = area.list;
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
  // 只看範圍裡面的那幾塊
  return scatter(kind, c, g.O, box, inside, salt, (x0, y0, x1, y1) => {
    list = area.list.filter((l) => l.x1 >= x0 && l.x0 <= x1 && l.y1 >= y0 && l.y0 <= y1);
    return list.length > 0;
  });
}

/**
 * 草和水波撒在一塊地方：O 是攤平成公尺的原點（每度幾公尺），box 是這塊地方的範圍（攤平的公尺），inside 看一點在不在裡面；
 * near 是知道看得到的範圍後先篩一次（沒有東西就不畫）；salt 讓不同的地方亂數不一樣（汪星的海用自己的）
 */
export function scatter(
  kind: 'grass' | 'ripple',
  c: Pick<ParkCanvas, 'ppm' | 'center' | 'rx' | 'ry' | 'at'>,
  O: { lat: number; lng: number; mx: number; my: number },
  box: Box,
  inside: (x: number, y: number) => boolean,
  salt: number,
  near?: (x0: number, y0: number, x1: number, y1: number) => boolean,
): { d: string; w: number } | null {
  const t = kind === 'grass' ? GRASS : RIPPLES;
  const area = { box };
  const ppm = c.ppm;
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
  const half = ((viewReach() + 10) / ppm) * 1.15 + t.size;
  const cx = (c.center.lng - O.lng) * O.mx;
  const cy = (c.center.lat - O.lat) * O.my;
  const x0 = Math.max(cx - half, area.box[0]);
  const x1 = Math.min(cx + half, area.box[2]);
  const y0 = Math.max(cy - half, area.box[1]);
  const y1 = Math.min(cy + half, area.box[3]);
  if (x0 > x1 || y0 > y1) return null;
  if (near && !near(x0, y0, x1, y1)) return null;
  const w = Math.min(t.width[2], Math.max(t.width[1], t.width[0] * ppm));
  const reach = (viewReach() + 2) ** 2;
  const [bx0, by0, bx1, by1] = t.box.map((v) => v * big);
  // 全螢幕鋪滿時看得到的是畫面的長方形（雷達的圓比它大一倍多，撒在畫面外面的會把上限用完）：記號佔的範圍（中心、半徑）
  // 轉回畫面的方向（這一層跟著指北針轉）再比；鎖定跟著狗走時整層先平移最多 16 個單位才重畫，多留一點
  const [mx, my, mr] = [(bx0 + bx1) / 2, (by0 + by1) / 2, Math.hypot(bx1 - bx0, by1 - by0) / 2 + 18];
  const turn = (-RADAR_VIEW.heading * Math.PI) / 180;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  const [hx, hy] = [RADAR_VIEW.hx + mr, RADAR_VIEW.hy + mr];
  const shows = (bx: number, by: number): boolean => {
    if (RADAR_VIEW.fill) {
      const [dx, dy] = [bx + mx - c.rx, by + my - c.ry];
      return Math.abs(dx * cos - dy * sin) <= hx && Math.abs(dx * sin + dy * cos) <= hy;
    }
    // 平常：記號佔的範圍碰得到雷達的圓（草往上長：底在雷達下緣外面、草尖伸得進來的也要畫）
    const ex = Math.min(bx + bx1, Math.max(bx + bx0, c.rx)) - c.rx;
    const ey = Math.min(by + by1, Math.max(by + by0, c.ry)) - c.ry;
    return ex * ex + ey * ey <= reach;
  };
  // 萬一算錯也不會多到拖不動：看得到的範圍整片都是草地時大約幾個（每 p² × 3/4 一個）的 1.5 倍
  const cap = Math.max(1500, (1.5 * (RADAR_VIEW.fill ? 4 * hx * hy : Math.PI * reach)) / (p * p * 0.75));
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
        // 記號佔的範圍看得到才畫；在不在範圍裡比較慢，最後才看
        if (!shows(bx, by) || !inside(x, y)) continue;
        d += t.draw(bx, by, big, ppm, w, (n) => cellRand(i, j, kk, n), r1);
        if (++count >= cap) return { d, w };
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
  const [x0, y0, x1, y1] = viewRect(20);
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
