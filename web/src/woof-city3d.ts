/**
 * 汪星 3D：國館外面荒廢了幾萬年的街道（v1.812 使用者說「汪星除了國館整個做成 3D，走出國館看到的是荒廢幾萬年的街道」；
 * 範圍先做國館附近 2 公里、照汪星的大小彎、荒廢到還看得出街道，這三個是使用者選的）。park3d.ts 在汪星時才載入。
 * 街道、房子的位置和外框是真的（woof-city-data.ts：OpenStreetMap，經 OpenFreeMap 的圖磚，國館附近 2.3 公里），荒廢的樣子是想像的：
 * - 房子：灰白色的水泥殼，窗戶只剩洞、沒有玻璃；上面幾層塌了、牆頂參差不齊，牆腳長青苔、牆上垂著藤蔓，屋頂長滿草、有的長出小樹。
 *   高度照 OSM 寫的高度、樓層數；沒寫的照大小估（ESTIMATE_H），塌掉多少是亂數（固定的，每次一樣）
 * - 馬路：柏油裂成一塊塊、縫裡和一片片長草，大一點的路中間有淡到快看不見的標線（路寬照種類估的，ROAD_W）；高架、隧道不畫
 * - 樹：從人行道、空地、馬路的裂縫長出來，OSM 的草地、樹林長得密；大馬路邊的路燈歪了、生鏽，不會亮；沒有招牌、文字
 * - v1.821 使用者說畫廢棄的車子、讓它更接近真實（選了四樣）：路邊褪色生鏽的汽車（輪胎扁了、車頂長青苔小花）、巷子邊一排排機車（有的倒了）、
 *   面對馬路的一樓是生鏽的鐵捲門（有的半開）、大馬路路口歪掉不亮的紅綠燈、公車亭（沒有站名）、高樓旁邊塌下來的水泥碎塊；
 *   擺在哪是照馬路、房子的位置用固定的亂數擺的（不是真的位置），汽車、紅綠燈、公車亭、碎石擋路
 * - 白天身邊有幾隻蝴蝶、地上有小花；晚上（照台北的時間）有螢火蟲
 * 分成 CHUNK 公尺一格：走近才蓋（每一格畫面只蓋一點點，不會卡），看得到才畫（汪星很小、地平線很近：照鏡頭和房子的高度算看不看得到）。
 * 人不能走進房子、水裡，樹幹、路燈擋路；離國館中間 CITY_WALK_M 公尺以外走不過去
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WOOF_BUILDINGS, WOOF_GREEN, WOOF_Q, WOOF_ROADS, WOOF_WATER } from './woof-city-data';

type Pt = [number, number];

/** 離國館中間多遠以內走得到（公尺；使用者選的「先做國館附近 2 公里」） */
export const CITY_WALK_M = 2000;
/** 一格多大（公尺） */
const CHUNK = 200;
/** 一層樓多高、窗戶一個開間多寬（公尺，估的）；牆的圖一張是 4 間 × 4 層 */
const FLOOR_H = 3.2;
const BAY_W = 3;
/** 牆腳的青苔長到多高（公尺） */
const MOSS_H = 3.5;
/** 馬路多寬（公尺，照種類估的；大路兩個方向分開畫的是一邊的寬） */
const ROAD_W: Record<string, number> = { motorway: 12, trunk: 14, primary: 14, secondary: 11, tertiary: 9, minor: 6, service: 4, pedestrian: 5 };
/** 路中間畫標線的種類 */
const LINED = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
/** 路燈：這幾種路的路邊每 LAMP_EVERY 公尺一支，高 LAMP_H（估的） */
const LAMP_ROADS = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const LAMP_EVERY = 32;
const LAMP_H = 7.5;
/** 馬路的圖一張多大（公尺） */
const ROAD_TILE = 16;
/** 人多胖：離牆、水邊多近就擋（公尺） */
const BODY = 0.3;
/** 樹、路燈最多畫到多遠（公尺；從火箭上看也不會全部畫），小花多遠以內才畫 */
const TREE_FAR = 500;
const FLOWER_FAR = 110;
/** 房子最多畫到多遠（公尺，跟汪星的霧一樣遠） */
const FAR_M = 1600;
/** 每一格畫面最多花幾毫秒蓋新的格子 */
const BUILD_MS = 8;
/**
 * 汪星彎的時候只有頂點會沉下去（park3d.ts 的 BEND_VERTEX），三角形太大中間會浮起來：馬路切成 SPLIT_M 公尺以內一段；
 * 地面是跟著你的一大片圓（身邊密、遠的疏），每 GROUND_SNAP 公尺挪一次（草地的圖是 2 公尺一張，挪整數倍接得起來）
 */
const SPLIT_M = 8;
const GROUND_SNAP = 4;
const GROUND_R = 2600;
const GROUND_SEG = 96;

/**
 * OSM 沒寫高度、樓層的房子照大小估（a 是平方公尺、k 是 0～1 的亂數）：小於 30 平方公尺的小屋 3 公尺、小於 120 平方公尺 2～4 層、更大的 4～6 層
 * （台北常見的公寓；都是估的）
 */
const ESTIMATE_H = (a: number, k: number): number => (a < 30 ? 3 : a < 120 ? (2 + Math.floor(k * 3)) * FLOOR_H : (4 + Math.floor(k * 3)) * FLOOR_H);
/** 塌掉以後剩多高：高的剩 55～95%、矮的剩 75～100%，至少 2.4 公尺 */
const RUIN_H = (h: number, k: number): number => Math.max(2.4, h * (h > 8 ? 0.55 + 0.4 * k : 0.75 + 0.25 * k));

const hash = (i: number): number => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** 這個位置的亂數（公尺座標，固定的） */
const hashAt = (x: number, y: number, k = 0): number => hash(Math.round(x * 4) * 1013 + Math.round(y * 4) * 7919 + k * 131);

const decode = (s: string): Pt[] => {
  const v = s.split(',').map(Number);
  const out: Pt[] = [];
  let [x, y] = [0, 0];
  for (let i = 0; i + 1 < v.length; i += 2) {
    x += v[i];
    y += v[i + 1];
    out.push([x / WOOF_Q, y / WOOF_Q]);
  }
  return out;
};
const ringArea = (r: Pt[]): number => {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [a, b] = [r[i], r[(i + 1) % r.length]];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};
function inRing([x, y]: Pt, r: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < xi + ((y - yi) * (xj - xi)) / (yj - yi)) inside = !inside;
  }
  return inside;
}
const segDist = (p: Pt, a: Pt, b: Pt): number => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
};
type Box = [number, number, number, number];
const boxOf = (r: Pt[]): Box => {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of r) {
    b[0] = Math.min(b[0], x);
    b[1] = Math.min(b[1], y);
    b[2] = Math.max(b[2], x);
    b[3] = Math.max(b[3], y);
  }
  return b;
};
const inBox = (p: Pt, b: Box, m = 0): boolean => p[0] >= b[0] - m && p[0] <= b[2] + m && p[1] >= b[1] - m && p[1] <= b[3] + m;

/** 一格一格的索引（cell 公尺見方） */
class Grid<T> {
  private cells = new Map<number, T[]>();
  constructor(private readonly cell: number) {}
  private key(i: number, j: number): number {
    return (i + 20000) * 40000 + (j + 20000);
  }
  add(b: Box, v: T): void {
    for (let i = Math.floor(b[0] / this.cell); i <= Math.floor(b[2] / this.cell); i++)
      for (let j = Math.floor(b[1] / this.cell); j <= Math.floor(b[3] / this.cell); j++) {
        const k = this.key(i, j);
        const list = this.cells.get(k);
        if (list) list.push(v);
        else this.cells.set(k, [v]);
      }
  }
  at(p: Pt): T[] {
    return this.cells.get(this.key(Math.floor(p[0] / this.cell), Math.floor(p[1] / this.cell))) ?? [];
  }
}

interface Building {
  /** 外圈逆時針、洞順時針（牆朝每一邊的右手邊，就是朝外） */
  rings: Pt[][];
  box: Box;
  c: Pt;
  /** 塌掉以後的高度（屋頂在這裡） */
  h: number;
  area: number;
  /** 這一棟的亂數（顏色、牆頂） */
  k: number;
}
interface Road {
  cls: string;
  w: number;
  pts: Pt[];
}
interface Chunk {
  c: Pt;
  bs: Building[];
  roads: Road[];
  /** 路口的紅綠燈、路邊的公車亭（v1.821）：站的地方、朝哪（繞 y 轉多少） */
  lights: Array<{ p: Pt; yaw: number; k: number }>;
  shelters: Array<{ p: Pt; yaw: number; k: number }>;
  maxH: number;
  root: THREE.Group | null;
  trees: THREE.Object3D[];
  flowers: THREE.Object3D | null;
}

export interface WoofCityOptions {
  /** 國館的外框（公尺，東、北）：裡面的房子、路、樹都不放（國館照舊） */
  outline: Pt[];
  /** 國館裡的水面（外圈，公尺）：地面不能蓋到（水面比地面低） */
  lakes: Pt[][];
  /** 國館中間（公尺）：走得到的範圍從這裡算 */
  center: Pt;
  /** 屋頂長滿草：用國館草地同一個材質（uv 是公尺） */
  grass: THREE.Material;
  /** 汪星的半徑（公尺）：看得到多遠照這個算 */
  radiusM: number;
  anisotropy: number;
  /** 地圖上畫的國館（公尺，東、北）：草地、水面（外圈、小島）、步道中線、建築、樹（中心、樹冠半徑） */
  parkMap: { lawns: Pt[][]; water: Array<{ outer: Pt[]; islands: Pt[][] }>; paths: Pt[][]; buildings: Pt[][]; trees: Array<[number, number, number]> };
}

export interface WoofCity {
  group: THREE.Group;
  /** 走得到多遠（公尺，離國館中間；大地圖照這個決定範圍） */
  walkM: number;
  /** 國館外面這裡站不站得住（房子、水、樹幹、路燈、太遠） */
  canStand(p: Pt): boolean;
  /** 超過走得到的範圍 */
  tooFar(p: Pt): boolean;
  /** 每一格：照鏡頭蓋附近的格子、顯示看得到的，蝴蝶、螢火蟲飛；回傳要不要重畫 */
  update(cam: THREE.Vector3, you: Pt, now: number, night: number): boolean;
  /**
   * 畫地圖（v1.818 使用者說 3D 裡可以打開小地圖）：北朝上，中間是 c（公尺），每像素 mpp 公尺，畫滿 w×h 的 g
   * （草地底、公園綠地、水、馬路、房子、國館、走得到的邊界）；你的箭頭 park3d.ts 畫
   */
  drawMap(g: CanvasRenderingContext2D, c: Pt, mpp: number, w: number, h: number): void;
}

/** 畫一張重複鋪的圖（S 像素見方，左右上下接得起來：畫在邊上的東西另一邊也畫一份） */
function tileTex(S: number, anisotropy: number, draw: (g: CanvasRenderingContext2D, wrap: (f: (dx: number, dy: number) => void) => void) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  [cv.width, cv.height] = [S, S];
  const g = cv.getContext('2d')!;
  draw(g, (f) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) f(dx, dy);
  });
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

export function buildWoofCity(o: WoofCityOptions): WoofCity {
  const group = new THREE.Group();
  group.name = 'woof-city';
  const R = o.radiusM;
  /** 站在 h 公尺高看得到多遠的地面（汪星的地平線） */
  const horizon = (h: number): number => Math.sqrt(2 * R * Math.max(0, h));
  const inPark = (p: Pt): boolean => inRing(p, o.outline);
  const parkBox = boxOf(o.outline);
  const nearPark = (p: Pt, m: number): boolean => inBox(p, parkBox, m) && (inPark(p) || o.outline.some((a, i) => segDist(p, a, o.outline[(i + 1) % o.outline.length]) < m));

  // ---- 資料
  const buildings: Building[] = [];
  const bGrid = new Grid<Building>(20);
  for (const s of WOOF_BUILDINGS.split(';')) {
    const i = s.indexOf(':');
    const rings = s
      .slice(i + 1)
      .split('/')
      .map(decode)
      .filter((r) => r.length >= 3);
    if (!rings.length) continue;
    const outer = rings[0];
    const c: Pt = [outer.reduce((a, p) => a + p[0], 0) / outer.length, outer.reduce((a, p) => a + p[1], 0) / outer.length];
    if (inPark(c)) continue;
    let area = ringArea(outer);
    if (area < 0) {
      outer.reverse();
      area = -area;
    }
    if (area < 4) continue;
    const holes = rings.slice(1).map((h) => (ringArea(h) > 0 ? h.reverse() : h));
    const k = hashAt(c[0], c[1]);
    const h = RUIN_H(Number(s.slice(0, i)) || ESTIMATE_H(area, k), hash(k * 977 + 1));
    const b: Building = { rings: [outer, ...holes], box: boxOf(outer), c, h, area, k };
    buildings.push(b);
    bGrid.add(b.box, b);
  }
  const inBuilding = (p: Pt, m: number): boolean =>
    bGrid.at(p).some(
      (b) =>
        inBox(p, b.box, m) &&
        ((inRing(p, b.rings[0]) && !b.rings.slice(1).some((h) => inRing(p, h))) || (m > 0 && b.rings.some((r) => r.some((a, i) => segDist(p, a, r[(i + 1) % r.length]) < m)))),
    );

  // 馬路：每一段照中點分到格子裡，國館裡面的不要
  const chunks = new Map<string, Chunk>();
  const chunkOf = (p: Pt): Chunk => {
    const [i, j] = [Math.floor(p[0] / CHUNK), Math.floor(p[1] / CHUNK)];
    const key = `${i},${j}`;
    let ch = chunks.get(key);
    if (!ch) chunks.set(key, (ch = { c: [(i + 0.5) * CHUNK, (j + 0.5) * CHUNK], bs: [], roads: [], lights: [], shelters: [], maxH: 0, root: null, trees: [], flowers: null }));
    return ch;
  };
  for (const b of buildings) {
    const ch = chunkOf(b.c);
    ch.bs.push(b);
    ch.maxH = Math.max(ch.maxH, b.h + FLOOR_H);
  }
  const rGrid = new Grid<{ a: Pt; b: Pt; hw: number }>(20);
  /** 大馬路（畫標線的）整條留著：找路口放紅綠燈、每隔一段放公車亭（v1.821） */
  const bigRoads: Road[] = [];
  for (const s of WOOF_ROADS.split(';')) {
    const i = s.indexOf(':');
    const cls = s.slice(0, i);
    const w = ROAD_W[cls] ?? 5;
    const pts = decode(s.slice(i + 1));
    if (LINED.has(cls)) bigRoads.push({ cls, w, pts });
    let cur: Road | null = null;
    let curCh: Chunk | null = null;
    for (let k = 1; k < pts.length; k++) {
      const [a, b] = [pts[k - 1], pts[k]];
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (inPark(mid)) {
        cur = null;
        continue;
      }
      rGrid.add([Math.min(a[0], b[0]) - w / 2, Math.min(a[1], b[1]) - w / 2, Math.max(a[0], b[0]) + w / 2, Math.max(a[1], b[1]) + w / 2], { a, b, hw: w / 2 });
      const ch = chunkOf(mid);
      if (!cur || ch !== curCh) {
        cur = { cls, w, pts: [a] };
        curCh = ch;
        ch.roads.push(cur);
      }
      cur.pts.push(b);
    }
  }
  const onRoad = (p: Pt, m = 0): boolean => rGrid.at(p).some((s) => segDist(p, s.a, s.b) < s.hw + m);
  const waters = WOOF_WATER ? WOOF_WATER.split(';').map((s) => s.split('/').map(decode)) : [];
  const water = waters.filter((w) => w[0].length >= 3 && !inPark(w[0][0])).map((w) => ({ rings: w, box: boxOf(w[0]) }));
  const inWater = (p: Pt): boolean => water.some((w) => inBox(p, w.box) && inRing(p, w.rings[0]) && !w.rings.slice(1).some((h) => inRing(p, h)));
  const gGrid = new Grid<{ rings: Pt[][]; box: Box }>(50);
  for (const s of WOOF_GREEN ? WOOF_GREEN.split(';') : []) {
    const rings = s.split('/').map(decode);
    if (rings[0].length < 3) continue;
    const g = { rings, box: boxOf(rings[0]) };
    gGrid.add(g.box, g);
  }
  const inGreen = (p: Pt): boolean => gGrid.at(p).some((g) => inBox(p, g.box) && inRing(p, g.rings[0]) && !g.rings.slice(1).some((h) => inRing(p, h)));
  const inReach = (p: Pt): boolean => p[0] ** 2 + p[1] ** 2 < 2300 ** 2;

  // ---- 路口的紅綠燈（v1.821）：三條以上大馬路接在同一點的是路口（雙向分開畫的大路路口會更多條），30 公尺內只放一支，放在一個路角、燈臂伸向路口
  {
    const ends = new Map<string, { p: Pt; ids: Set<number>; w: number; dir: Pt }>();
    bigRoads.forEach((r, id) =>
      r.pts.forEach((p, k) => {
        const key = `${Math.round(p[0])},${Math.round(p[1])}`;
        const e = ends.get(key) ?? { p, ids: new Set<number>(), w: 0, dir: [1, 0] as Pt };
        if (!e.ids.size) {
          const q = r.pts[k + 1] ?? r.pts[k - 1];
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
          e.dir = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
        }
        e.ids.add(id);
        e.w = Math.max(e.w, r.w);
        ends.set(key, e);
      }),
    );
    const placed: Pt[] = [];
    for (const e of ends.values()) {
      if (e.ids.size < 3 || placed.some((q) => Math.hypot(q[0] - e.p[0], q[1] - e.p[1]) < 30)) continue;
      const k = hashAt(e.p[0], e.p[1], 31);
      const [ux, uy] = e.dir;
      const s = k < 0.5 ? 1 : -1;
      const off = e.w / 2 + 2;
      const p: Pt = [e.p[0] + ux * off - uy * off * s, e.p[1] + uy * off + ux * off * s];
      if (!inReach(p) || nearPark(p, 6) || inBuilding(p, 1) || inWater(p)) continue;
      placed.push(e.p);
      chunkOf(p).lights.push({ p, yaw: Math.atan2(e.p[1] - p[1], e.p[0] - p[0]), k });
    }
  }
  // ---- 公車亭（v1.821）：大馬路邊大約每 300 公尺一個（有的沒有），在路外面、開口朝馬路
  for (const r of bigRoads) {
    if (r.cls !== 'primary' && r.cls !== 'secondary' && r.cls !== 'trunk') continue;
    let walked = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const [a, b] = [r.pts[i - 1], r.pts[i]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-3) continue;
      const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      for (let t = Math.ceil(walked / 300) * 300 - walked + 150; t <= len; t += 300) {
        const k = hashAt(a[0] + ux * t, a[1] + uy * t, 41);
        if (k > 0.6) continue;
        const s = k < 0.3 ? 1 : -1;
        const off = r.w / 2 + 2.4;
        const p: Pt = [a[0] + ux * t - uy * off * s, a[1] + uy * t + ux * off * s];
        if (!inReach(p) || nearPark(p, 5) || inBuilding(p, 2) || inWater(p) || onRoad(p, 1)) continue;
        // 開口（形狀的 +z）朝馬路：往路的方向是 (uy·s, -ux·s)，繞 y 轉 θ 時 +z 變成 (sin θ, 0, cos θ)，世界的 z 是往南
        const [tx, ty] = [uy * s, -ux * s];
        chunkOf(p).shelters.push({ p, yaw: Math.atan2(tx, -ty), k });
      }
      walked += len;
    }
  }
  /** 樹幹、路燈（擋路） */
  const trunks = new Grid<[number, number, number]>(5);
  const hitTrunk = (p: Pt): boolean => trunks.at(p).some(([x, y, r]) => Math.hypot(p[0] - x, p[1] - y) < r + BODY);

  // ---- 材質
  // 牆：灰白的水泥（每一棟照頂點顏色上一點色），一間一個只剩洞的窗戶（有的沒有窗、有的塌到地上），斑駁、雨水流下的痕跡，藤蔓從上面垂下來
  const wallTex = tileTex(512, o.anisotropy, (g, wrap) => {
    g.fillStyle = '#eeebe4';
    g.fillRect(0, 0, 512, 512);
    for (let k = 0; k < 160; k++) {
      const [x, y, r] = [hash(k * 3 + 1) * 512, hash(k * 3 + 2) * 512, 8 + hash(k * 3 + 3) * 40];
      g.fillStyle = hash(k + 50) < 0.6 ? `rgba(110, 104, 90, ${0.04 + hash(k + 70) * 0.06})` : `rgba(160, 150, 110, ${0.04 + hash(k + 90) * 0.05})`;
      wrap((dx, dy) => {
        g.beginPath();
        g.ellipse(x + dx, y + dy, r, r * (0.5 + hash(k + 30)), 0, 0, Math.PI * 2);
        g.fill();
      });
    }
    for (let k = 0; k < 50; k++) {
      const [x, y, len] = [hash(k * 5 + 400) * 512, hash(k * 5 + 401) * 512, 40 + hash(k * 5 + 402) * 160];
      const lg = g.createLinearGradient(0, y, 0, y + len);
      lg.addColorStop(0, 'rgba(95, 92, 82, 0.12)');
      lg.addColorStop(1, 'rgba(95, 92, 82, 0)');
      g.fillStyle = lg;
      wrap((dx, dy) => g.fillRect(x + dx, y + dy, 3 + hash(k + 410) * 6, len));
    }
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const h = hash(i * 7 + j * 31 + 600);
        if (h < 0.1) continue;
        const [x, y, w] = [i * 128 + 22, j * 128 + 30, 84];
        const hh = h > 0.92 ? 98 : 60;
        const lg = g.createLinearGradient(0, y, 0, y + hh);
        lg.addColorStop(0, '#2f3b38');
        lg.addColorStop(1, '#45534c');
        g.fillStyle = lg;
        g.fillRect(x, y, w, hh);
        // 窗台（淡一點）、窗台上長出來的小草
        g.fillStyle = 'rgba(250, 248, 240, 0.7)';
        g.fillRect(x - 4, y + hh, w + 8, 5);
        if (hash(i * 13 + j * 17 + 700) < 0.5) {
          g.strokeStyle = '#7aa651';
          g.lineWidth = 2;
          for (let t = 0; t < 7; t++) {
            const gx = x + 6 + hash(i * 100 + j * 10 + t + 800) * (w - 12);
            g.beginPath();
            g.moveTo(gx, y + hh);
            g.lineTo(gx + (hash(t + i + j * 5 + 900) - 0.5) * 8, y + hh - 6 - hash(t * 3 + i + 950) * 10);
            g.stroke();
          }
        }
      }
    // 藤蔓：從上面垂下來，一路長著小葉子
    for (let k = 0; k < 10; k++) {
      let [x, y] = [hash(k * 9 + 1000) * 512, -10];
      const len = 120 + hash(k * 9 + 1001) * 300;
      const pts: Pt[] = [[x, y]];
      while (y < len) {
        y += 8;
        x += (hash(k * 97 + y) - 0.5) * 7;
        pts.push([x, y]);
      }
      wrap((dx, dy) => {
        g.strokeStyle = '#5d8a3c';
        g.lineWidth = 2.5;
        g.beginPath();
        pts.forEach(([px, py], n) => (n ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy)));
        g.stroke();
        pts.forEach(([px, py], n) => {
          if (n % 2) return;
          g.fillStyle = hash(k * 31 + n) < 0.5 ? '#7cb04f' : '#94c463';
          g.beginPath();
          g.ellipse(px + dx + (n % 4 ? 4 : -4), py + dy, 5, 3, n % 4 ? 0.5 : -0.5, 0, Math.PI * 2);
          g.fill();
        });
      });
    }
  });
  wallTex.repeat.set(1 / (BAY_W * 4), 1 / (FLOOR_H * 4));
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex, vertexColors: true });
  // 馬路：淡灰的柏油裂成一塊塊（縫是深色、長著草），一片片草、露出來的土、草裡的小花
  const roadTex = tileTex(512, o.anisotropy, (g, wrap) => {
    g.fillStyle = '#928f88';
    g.fillRect(0, 0, 512, 512);
    for (let k = 0; k < 2500; k++) {
      const v = 128 + Math.floor(hash(k + 2000) * 40);
      g.fillStyle = `rgba(${v}, ${v - 2}, ${v - 6}, 0.5)`;
      g.fillRect(hash(k * 2 + 2100) * 512, hash(k * 2 + 2101) * 512, 2 + hash(k + 2200) * 3, 2 + hash(k + 2300) * 3);
    }
    for (let k = 0; k < 10; k++) {
      const [x, y, r] = [hash(k * 3 + 2400) * 512, hash(k * 3 + 2401) * 512, 14 + hash(k * 3 + 2402) * 26];
      g.fillStyle = 'rgba(160, 140, 108, 0.75)';
      wrap((dx, dy) => {
        g.beginPath();
        g.ellipse(x + dx, y + dy, r, r * 0.7, hash(k + 2450) * 3, 0, Math.PI * 2);
        g.fill();
      });
    }
    // 裂縫：一條條折線，深色的縫、兩邊長草
    const cracks: Pt[][] = [];
    for (let k = 0; k < 28; k++) {
      let [x, y] = [hash(k * 4 + 2500) * 512, hash(k * 4 + 2501) * 512];
      let a = hash(k * 4 + 2502) * Math.PI * 2;
      const l: Pt[] = [[x, y]];
      for (let n = 0; n < 6 + Math.floor(hash(k + 2550) * 8); n++) {
        a += (hash(k * 50 + n + 2600) - 0.5) * 1.4;
        const st = 14 + hash(k * 50 + n + 2700) * 26;
        x += Math.cos(a) * st;
        y += Math.sin(a) * st;
        l.push([x, y]);
      }
      cracks.push(l);
    }
    for (const [w, c] of [
      [7, 'rgba(118, 160, 76, 0.85)'],
      [2, '#5d5a54'],
    ] as Array<[number, string]>)
      for (const l of cracks)
        wrap((dx, dy) => {
          g.strokeStyle = c;
          g.lineWidth = w;
          g.lineJoin = 'round';
          g.beginPath();
          l.forEach(([px, py], n) => (n ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy)));
          g.stroke();
        });
    // 一片片的草（邊緣毛毛的）和草葉、小花
    for (let k = 0; k < 18; k++) {
      const [x, y, r] = [hash(k * 3 + 2800) * 512, hash(k * 3 + 2801) * 512, 16 + hash(k * 3 + 2802) * 34];
      wrap((dx, dy) => {
        for (let n = 0; n < 14; n++) {
          const a = (n / 14) * Math.PI * 2;
          const rr = r * (0.55 + hash(k * 20 + n + 2900) * 0.45);
          g.fillStyle = n % 3 ? 'rgba(124, 170, 80, 0.9)' : 'rgba(104, 150, 66, 0.9)';
          g.beginPath();
          g.arc(x + dx + Math.cos(a) * rr * 0.5, y + dy + Math.sin(a) * rr * 0.5, rr * 0.6, 0, Math.PI * 2);
          g.fill();
        }
        g.strokeStyle = 'rgba(160, 205, 105, 0.9)';
        g.lineWidth = 1.5;
        for (let n = 0; n < 30; n++) {
          const [gx, gy] = [x + dx + (hash(k * 40 + n + 3000) - 0.5) * r * 1.4, y + dy + (hash(k * 40 + n + 3100) - 0.5) * r * 1.2];
          g.beginPath();
          g.moveTo(gx, gy);
          g.lineTo(gx + (hash(n + k + 3200) - 0.5) * 6, gy - 7);
          g.stroke();
        }
        for (let n = 0; n < 5; n++) {
          g.fillStyle = ['#fbfbf2', '#f4d35e', '#f3a6c0'][n % 3];
          g.beginPath();
          g.arc(x + dx + (hash(k * 9 + n + 3300) - 0.5) * r, y + dy + (hash(k * 9 + n + 3400) - 0.5) * r * 0.8, 2.2, 0, Math.PI * 2);
          g.fill();
        }
      });
    }
  });
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const lineMat = new THREE.MeshLambertMaterial({ color: 0xf4f1e6, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const waterMat = new THREE.MeshLambertMaterial({ color: 0x8fbdb2, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7c6248 });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const lampMat = new THREE.MeshLambertMaterial({ color: 0x8e6d57 });
  const flowerMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

  // ---- 樹、路燈、小花的形狀（一份，每一格用 InstancedMesh 擺）
  const trunkGeo = new THREE.CylinderGeometry(0.6, 1, 1, 5).translate(0, 0.5, 0);
  // 樹冠：三顆圓圓的球疊在一起（單位大小，照每一棵放大）；樹很多，球只用 20 面，法線照球面（看起來圓圓的、不是一面面的）
  const blob = (r: number, x: number, y: number, z: number): THREE.BufferGeometry => {
    const g = new THREE.IcosahedronGeometry(r, 0);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
    }
    return g.translate(x, y, z);
  };
  const crownGeo = mergeGeometries([blob(1, 0, 0, 0), blob(0.72, 0.62, -0.22, 0.3), blob(0.66, -0.5, -0.18, -0.38)])!;
  const lampGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.08, 0.11, LAMP_H, 6).translate(0, LAMP_H / 2, 0),
    new THREE.BoxGeometry(1.5, 0.08, 0.08).translate(0.75, LAMP_H - 0.15, 0),
    new THREE.BoxGeometry(0.5, 0.14, 0.24).translate(1.4, LAMP_H - 0.25, 0),
  ])!;
  const flowerGeo = mergeGeometries([
    new THREE.OctahedronGeometry(0.06).translate(0, 0.2, 0),
    new THREE.OctahedronGeometry(0.05).translate(0.11, 0.14, 0.05),
    new THREE.OctahedronGeometry(0.055).translate(-0.08, 0.16, -0.09),
  ])!;
  // ---- 廢棄的東西（v1.821）：一個形狀擺很多個，顏色畫在頂點上（照高度：底下生鏽、上面長青苔），汽車、機車再乘上褪色的烤漆顏色
  const col = (h: string): THREE.Color => new THREE.Color(h);
  const [WHITE, RUST, GLASS, TIRE, SEAT, METAL, MOSSY, CONCRETE] = ['#ffffff', '#b07c5c', '#3d4648', '#2e2e2c', '#4d4037', '#8d918c', '#7fa75a', '#c9c5bc'].map(col);
  /** 形狀換成不共用頂點，照每個頂點的高度上色 */
  const paint = (g: THREE.BufferGeometry, color: (y: number) => THREE.Color): THREE.BufferGeometry => {
    const n = g.index ? g.toNonIndexed() : g;
    const p = n.getAttribute('position');
    const c: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const k = color(p.getY(i));
      c.push(k.r, k.g, k.b);
    }
    n.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    return n;
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const wheel = (r: number, w: number, x: number, y: number, z: number): THREE.BufferGeometry => new THREE.CylinderGeometry(r, r, w, 10).rotateX(Math.PI / 2).translate(x, y, z);
  // 汽車（長 4.2 公尺，車頭朝 +x）：車身下緣生鏽、車窗暗暗的，輪胎扁了（車身低低的）
  const carGeo = mergeGeometries([
    paint(box(4.2, 0.72, 1.72, 0, 0.62, 0), (y) => (y < 0.4 ? RUST : WHITE)),
    paint(box(2.2, 0.62, 1.56, -0.25, 1.29, 0), (y) => (y > 1.55 ? WHITE : GLASS)),
    ...[-1.35, 1.35].flatMap((x) => [-0.8, 0.8].map((z) => paint(wheel(0.33, 0.22, x, 0.22, z), () => TIRE))),
  ])!;
  const carMossGeo = new THREE.SphereGeometry(1, 10, 5).scale(1.05, 0.14, 0.72).translate(-0.25, 1.6, 0);
  // 機車（長 1.8 公尺，車頭朝 +x）
  const scooterGeo = mergeGeometries([
    paint(box(1.25, 0.3, 0.36, -0.05, 0.42, 0), (y) => (y < 0.33 ? RUST : WHITE)),
    paint(box(0.75, 0.32, 0.38, -0.35, 0.72, 0), () => WHITE),
    paint(box(0.7, 0.1, 0.32, -0.35, 0.93, 0), () => SEAT),
    paint(box(0.16, 0.7, 0.3, 0.55, 0.75, 0), () => WHITE),
    paint(box(0.08, 0.08, 0.62, 0.6, 1.12, 0), () => TIRE),
    ...[-0.62, 0.62].map((x) => paint(wheel(0.24, 0.1, x, 0.2, 0), () => TIRE)),
  ])!;
  // 紅綠燈：燈臂朝 +x，燈頭三個暗暗的燈（不亮），柱子底下長青苔
  const lightGeo = mergeGeometries([
    paint(new THREE.CylinderGeometry(0.1, 0.13, 5.6, 8).translate(0, 2.8, 0), (y) => (y < 1.3 ? MOSSY : METAL)),
    paint(box(3.4, 0.1, 0.1, 1.7, 5.3, 0), () => METAL),
    paint(box(0.34, 0.95, 0.34, 3.25, 4.75, 0), () => col('#56635b')),
    ...[0.3, 0, -0.3].map((dy) => paint(wheel(0.1, 0.05, 3.25, 4.75 + dy, 0.19), () => col('#2b302e'))),
  ])!;
  // 公車亭：開口朝 +z，頂上長青苔，沒有玻璃、沒有站名
  const shelterGeo = mergeGeometries([
    paint(box(3.8, 0.12, 1.7, 0, 2.45, 0), (y) => (y > 2.48 ? MOSSY : METAL)),
    ...[-1.8, 1.8].flatMap((x) => [-0.75, 0.7].map((z) => paint(box(0.1, 2.4, 0.1, x, 1.2, z), (y) => (y < 0.6 ? RUST : METAL)))),
    paint(box(3.6, 0.06, 0.06, 0, 2.0, -0.75), () => RUST),
    paint(box(3.6, 0.06, 0.06, 0, 0.9, -0.75), () => RUST),
    paint(box(2.4, 0.08, 0.42, 0, 0.46, -0.48), () => col('#9e9182')),
    ...[-1.1, 1.1].map((x) => paint(box(0.08, 0.42, 0.3, x, 0.21, -0.48), () => METAL)),
  ])!;
  // 水泥碎塊：幾塊歪七扭八堆在一起，上面有的長青苔
  const rubbleGeo = mergeGeometries(
    Array.from({ length: 7 }, (_, i) => {
      const [sx, sy, sz] = [0.35 + hash(i * 3 + 5000) * 0.6, 0.2 + hash(i * 3 + 5001) * 0.35, 0.3 + hash(i * 3 + 5002) * 0.6];
      const [a, r] = [hash(i * 7 + 5100) * Math.PI * 2, hash(i * 7 + 5101) * 0.9];
      const moss = hash(i + 5400) < 0.5;
      return paint(new THREE.BoxGeometry(sx, sy, sz).rotateY(hash(i + 5200) * 3).rotateZ((hash(i + 5300) - 0.5) * 0.6).translate(Math.cos(a) * r, sy * 0.35, Math.sin(a) * r), (y) => (moss && y > 0.22 ? MOSSY : CONCRETE));
    }),
  )!;
  const propMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mossMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  /** 汽車、機車褪色的烤漆（乘在白色的地方） */
  const CAR_PAINT = ['#d8c7b2', '#b9c6cb', '#d6aea0', '#dcd8c8', '#c1bd98', '#a9b9c8', '#c9b3c4'].map(col);
  const MOSS_TONES = ['#7fa75a', '#8cb563', '#6f9a50'].map(col);
  // 鐵捲門：一條條橫的波浪鋼板，下半部生鏽、最底下長青苔（再照頂點顏色上一點色）
  const shutterTex = tileTex(128, o.anisotropy, (g) => {
    g.fillStyle = '#cdd0cc';
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 6) {
      g.fillStyle = 'rgba(70, 76, 76, 0.35)';
      g.fillRect(0, y, 128, 2);
      g.fillStyle = 'rgba(255, 255, 255, 0.28)';
      g.fillRect(0, y + 2, 128, 1);
    }
    for (let k = 0; k < 26; k++) {
      const [x, y, r] = [hash(k * 3 + 6000) * 128, 50 + hash(k * 3 + 6001) * 78, 4 + hash(k * 3 + 6002) * 14];
      g.fillStyle = `rgba(160, 100, 66, ${0.22 + hash(k + 6100) * 0.25})`;
      g.beginPath();
      g.ellipse(x, y, r, r * 1.6, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(122, 166, 80, 0.75)';
    for (let x = 0; x < 128; x += 4) g.fillRect(x, 128 - 6 - hash(x + 6200) * 12, 4, 20);
  });
  const shutterMat = new THREE.MeshLambertMaterial({ map: shutterTex, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const SHUTTER_TINTS = ['#dfe2e0', '#cdd8c8', '#e3d6c2', '#c9cdd2'].map(col);
  const DARK = col('#262a2b');

  const CROWNS = ['#7fb25a', '#8cbd62', '#6fa552', '#9cc66c', '#78ab57', '#88b85c'].map((c) => new THREE.Color(c));
  const FLOWERS = ['#ffffff', '#fff3a8', '#ffc4d6', '#dccbff', '#ffe08a'].map((c) => new THREE.Color(c));
  const TINTS = ['#f1eee8', '#e6dfd2', '#ecdfd5', '#dbe1e0', '#e6ddc8', '#dad4cc'].map((c) => new THREE.Color(c));
  const MOSS = new THREE.Color('#6d9450');

  // ---- 水面（整片一次蓋好，沒幾塊）
  if (water.length) {
    const geos = water.map(({ rings }) => {
      const shape = new THREE.Shape(rings[0].map(([x, y]) => new THREE.Vector2(x, y)));
      shape.holes = rings.slice(1).map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
      return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, 0.012, 0);
    });
    const m = new THREE.Mesh(mergeGeometries(geos)!, waterMat);
    m.receiveShadow = true;
    group.add(m);
  }

  // ---- 蓋一格
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const tmpC = new THREE.Color();
  function wallsAndRoofs(bs: Building[]): { walls: THREE.BufferGeometry; roofs: THREE.BufferGeometry } {
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const rPos: number[] = [];
    const rUv: number[] = [];
    for (const b of bs) {
      const tint = TINTS[Math.floor(b.k * TINTS.length)];
      const colorAt = (y: number, top: number): THREE.Color =>
        tmpC.copy(tint).lerp(MOSS, y <= MOSS_H ? 0.6 * (1 - y / MOSS_H) : (0.14 * (y - MOSS_H)) / Math.max(0.1, top - MOSS_H));
      const u0 = b.k * 11;
      let edge = 0;
      for (const r of b.rings) {
        let u = u0;
        for (let i = 0; i < r.length; i++) {
          const [a, c] = [r[i], r[(i + 1) % r.length]];
          const [dx, dy] = [c[0] - a[0], c[1] - a[1]];
          const len = Math.hypot(dx, dy);
          if (len < 0.05) continue;
          // 牆頂參差不齊：有的牆比屋頂高一點（塌剩的女兒牆、上一層的牆）
          const jag = hash(b.k * 1000 + edge++);
          const top = b.h + (jag < 0.45 ? 0 : jag * Math.min(FLOOR_H * 0.8, b.h * 0.3));
          const [nx, nz] = [dy / len, dx / len];
          const bands: Array<[number, number]> = top > MOSS_H + 0.3 ? [[0, MOSS_H], [MOSS_H, top]] : [[0, top]];
          for (const [y0, y1] of bands) {
            const u1 = u + len;
            const quad: Array<[Pt, number, number]> = [
              [a, y0, u],
              [c, y0, u1],
              [c, y1, u1],
              [a, y0, u],
              [c, y1, u1],
              [a, y1, u],
            ];
            for (const [p, y, uu] of quad) {
              pos.push(p[0], y, -p[1]);
              nrm.push(nx, 0, nz);
              uv.push(uu, y);
              const cc = colorAt(y, top);
              col.push(cc.r, cc.g, cc.b);
            }
          }
          u += len;
        }
      }
      // 屋頂：長滿草的平頂
      const v2 = (r: Pt[]): THREE.Vector2[] => r.map(([x, y]) => new THREE.Vector2(x, y));
      const flat = b.rings.flat();
      for (const f of THREE.ShapeUtils.triangulateShape(v2(b.rings[0]), b.rings.slice(1).map(v2))) {
        let [p, q, s] = [flat[f[0]], flat[f[1]], flat[f[2]]];
        // 朝上：(q - p) × (s - p) 在東北平面上是逆時針
        if ((q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]) < 0) [q, s] = [s, q];
        for (const v of [p, q, s]) {
          rPos.push(v[0], b.h, -v[1]);
          rUv.push(v[0], v[1]);
        }
      }
    }
    const walls = new THREE.BufferGeometry();
    walls.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    walls.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    walls.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    walls.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const roofs = new THREE.BufferGeometry();
    roofs.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
    roofs.setAttribute('normal', new THREE.Float32BufferAttribute(rPos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    roofs.setAttribute('uv', new THREE.Float32BufferAttribute(rUv, 2));
    return { walls, roofs };
  }
  /** 馬路（一段段的長方形，轉角補一個圓，貼圖照世界座標鋪：重疊的地方看不出來）和路中間淡淡的虛線 */
  function roadGeo(roads: Road[]): { road: THREE.BufferGeometry | null; lines: THREE.BufferGeometry | null } {
    const pos: number[] = [];
    const uv: number[] = [];
    const lPos: number[] = [];
    const Y = 0.03;
    const tri = (out: number[], ps: Pt[], y: number, uvOut?: number[]): void => {
      for (const p of ps) {
        out.push(p[0], y, -p[1]);
        uvOut?.push(p[0] / ROAD_TILE, p[1] / ROAD_TILE);
      }
    };
    /** 東北平面上一個長方形（a→b 為中線，半寬 hw），朝上 */
    const rect = (out: number[], a: Pt, b: Pt, hw: number, y: number, uvOut?: number[]): void => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-3) return;
      const [lx, ly] = [(-(b[1] - a[1]) / len) * hw, ((b[0] - a[0]) / len) * hw];
      const n = Math.ceil(len / SPLIT_M);
      for (let k = 0; k < n; k++) {
        const [s0, s1] = [k / n, (k + 1) / n];
        const [p, q]: Pt[] = [
          [a[0] + (b[0] - a[0]) * s0, a[1] + (b[1] - a[1]) * s0],
          [a[0] + (b[0] - a[0]) * s1, a[1] + (b[1] - a[1]) * s1],
        ];
        const [p1, p2, p3, p4]: Pt[] = [
          [p[0] - lx, p[1] - ly],
          [q[0] - lx, q[1] - ly],
          [q[0] + lx, q[1] + ly],
          [p[0] + lx, p[1] + ly],
        ];
        tri(out, [p1, p2, p3, p1, p3, p4], y, uvOut);
      }
    };
    for (const r of roads) {
      const hw = r.w / 2;
      for (let i = 1; i < r.pts.length; i++) rect(pos, r.pts[i - 1], r.pts[i], hw, Y, uv);
      // 轉角、頭尾：八角形補起來
      for (const p of r.pts)
        for (let k = 0; k < 8; k++) {
          const [a0, a1] = [(k / 8) * Math.PI * 2, ((k + 1) / 8) * Math.PI * 2];
          tri(pos, [p, [p[0] + Math.cos(a0) * hw, p[1] + Math.sin(a0) * hw], [p[0] + Math.cos(a1) * hw, p[1] + Math.sin(a1) * hw]], Y, uv);
        }
      if (!LINED.has(r.cls)) continue;
      // 標線：3 公尺一段、空 6 公尺，有的已經磨掉了
      let walked = 0;
      for (let i = 1; i < r.pts.length; i++) {
        const [a, b] = [r.pts[i - 1], r.pts[i]];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let t = Math.ceil(walked / 9) * 9 - walked; t + 3 <= len; t += 9) {
          if (hashAt(a[0] + t, a[1], 5) < 0.35) continue;
          const at = (s: number): Pt => [a[0] + ((b[0] - a[0]) * s) / len, a[1] + ((b[1] - a[1]) * s) / len];
          rect(lPos, at(t), at(t + 3), 0.08, Y + 0.01);
        }
        walked += len;
      }
    }
    const make = (p: number[], u?: number[]): THREE.BufferGeometry | null => {
      if (!p.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(p.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      if (u) g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
      return g;
    };
    return { road: make(pos, uv), lines: make(lPos) };
  }
  /**
   * 一格裡廢棄的東西（v1.821）：路邊的汽車、巷子邊一排排機車、面對馬路的一樓鐵捲門、高樓旁的碎石、路口的紅綠燈、公車亭。
   * 都用固定的亂數（同一個地方每次一樣），擋路的加進 trunks
   */
  function buildProps(ch: Chunk, root: THREE.Group): void {
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Array<{ m: THREE.Matrix4; c?: THREE.Color }>): void => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((x, i) => {
        im.setMatrixAt(i, x.m);
        if (x.c) im.setColorAt(i, x.c);
      });
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      root.add(im);
      ch.trees.push(im);
    };
    const mtx = (p: Pt, y: number, yaw: number, tiltX = 0, tiltZ = 0, s = 1): THREE.Matrix4 => {
      tmpE.set(tiltX, yaw, tiltZ, 'YXZ');
      return new THREE.Matrix4().compose(new THREE.Vector3(p[0], y, -p[1]), new THREE.Quaternion().setFromEuler(tmpE), new THREE.Vector3(s, s, s));
    };
    const block = (p: Pt, r: number): void => trunks.add([p[0] - r, p[1] - r, p[0] + r, p[1] + r], [p[0], p[1], r]);
    const free = (p: Pt, m: number): boolean => inReach(p) && !nearPark(p, 3) && !inBuilding(p, m) && !inWater(p);
    const pick = <T,>(list: T[], k: number): T => list[Math.floor(k * list.length) % list.length];

    // 汽車（停在路邊，順著馬路，頭朝前朝後都有）、一排排機車（巷子邊，垂直馬路，有的倒了）
    const cars: Array<{ m: THREE.Matrix4; c: THREE.Color }> = [];
    const carMoss: Array<{ m: THREE.Matrix4; c: THREE.Color }> = [];
    const carFlowers: Array<{ m: THREE.Matrix4; c: THREE.Color }> = [];
    const scooters: Array<{ m: THREE.Matrix4; c: THREE.Color }> = [];
    for (const r of ch.roads) {
      const carP = r.cls === 'minor' ? 0.17 : r.cls === 'service' ? 0.1 : r.cls === 'pedestrian' || r.cls === 'motorway' ? 0 : 0.07;
      const rowP = r.cls === 'minor' || r.cls === 'service' ? 0.12 : 0;
      let walked = 0;
      for (let i = 1; i < r.pts.length; i++) {
        const [a, b] = [r.pts[i - 1], r.pts[i]];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-3) continue;
        const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        for (let t = Math.ceil(walked / 7) * 7 - walked; t <= len; t += 7) {
          const c0: Pt = [a[0] + ux * t, a[1] + uy * t];
          const k = hashAt(c0[0], c0[1], 21);
          const side = hash(k * 977) < 0.5 ? 1 : -1;
          if (k < carP) {
            const off = Math.max(0.9, r.w / 2 - 1.15);
            const p: Pt = [c0[0] - uy * off * side, c0[1] + ux * off * side];
            if (!free(p, 1.2)) continue;
            const yaw = Math.atan2(uy, ux) + (hash(k * 31) < 0.5 ? Math.PI : 0) + (hash(k * 37) - 0.5) * 0.25;
            const m = mtx(p, 0, yaw, (hash(k * 41) - 0.5) * 0.06, (hash(k * 43) - 0.5) * 0.08);
            cars.push({ m, c: pick(CAR_PAINT, hash(k * 47)) });
            if (hash(k * 53) < 0.6) carMoss.push({ m, c: pick(MOSS_TONES, hash(k * 59)) });
            if (hash(k * 61) < 0.35) carFlowers.push({ m: mtx(p, 1.62, yaw, 0, 0, 1.3), c: pick(FLOWERS, hash(k * 67)) });
            for (const d of [-1.4, 0, 1.4]) block([p[0] + ux * d, p[1] + uy * d], 0.95);
          } else if (k > 1 - rowP) {
            const n = 3 + Math.floor(hash(k * 71) * 5);
            const off = r.w / 2 + 0.8;
            for (let j = 0; j < n; j++) {
              const along = (j - (n - 1) / 2) * 0.8;
              const p: Pt = [c0[0] + ux * along - uy * off * side, c0[1] + uy * along + ux * off * side];
              if (!free(p, 0.6)) continue;
              const kk = hash(k * 73 + j * 7);
              const yaw = Math.atan2(ux * side, -uy * side) + (kk < 0.5 ? Math.PI : 0) + (hash(kk * 79) - 0.5) * 0.3;
              scooters.push({ m: mtx(p, 0, yaw, hash(kk * 83) < 0.12 ? 1.35 : 0, (hash(kk * 89) - 0.5) * 0.06), c: pick(CAR_PAINT, hash(kk * 97)) });
              block(p, 0.35);
            }
          }
        }
        walked += len;
      }
    }
    inst(carGeo, propMat, cars);
    inst(carMossGeo, mossMat, carMoss);
    inst(flowerGeo, flowerMat, carFlowers);
    inst(scooterGeo, propMat, scooters);

    // 面對馬路的一樓：生鏽的鐵捲門（一間一片，有的半開、下面黑黑的，有的已經不見了）
    const sPos: number[] = [];
    const sNrm: number[] = [];
    const sUv: number[] = [];
    const sCol: number[] = [];
    const quad = (pa: Pt, pc: Pt, y0: number, y1: number, n: Pt, w: number, c: THREE.Color): void => {
      const vs: Array<[Pt, number, number]> = [
        [pa, y0, 0],
        [pc, y0, w],
        [pc, y1, w],
        [pa, y0, 0],
        [pc, y1, w],
        [pa, y1, 0],
      ];
      for (const [p, y, u] of vs) {
        sPos.push(p[0] + n[0] * 0.06, y, -(p[1] + n[1] * 0.06));
        sNrm.push(n[0], 0, -n[1]);
        sUv.push(u / 2.5, y / 2.7);
        sCol.push(c.r, c.g, c.b);
      }
    };
    const rubble: Array<{ m: THREE.Matrix4 }> = [];
    for (const b of ch.bs) {
      const ring = b.rings[0];
      if (b.h >= 3)
        ring.forEach((a, i) => {
          const c = ring[(i + 1) % ring.length];
          const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
          if (len < 2.6) return;
          const [ux, uy] = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
          const n: Pt = [uy, -ux];
          const mid: Pt = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
          if (!onRoad([mid[0] + n[0] * 3, mid[1] + n[1] * 3], 3)) return;
          const nb = Math.max(1, Math.round(len / 3.4));
          const bw = len / nb;
          const top = Math.min(2.7, b.h - 0.3);
          for (let j = 0; j < nb; j++) {
            const k = hash(b.k * 313 + i * 17 + j);
            if (k < 0.15) continue;
            const [s0, s1] = [j * bw + 0.2, (j + 1) * bw - 0.2];
            if (s1 - s0 < 1) continue;
            const pa: Pt = [a[0] + ux * s0, a[1] + uy * s0];
            const pc: Pt = [a[0] + ux * s1, a[1] + uy * s1];
            const tint = pick(SHUTTER_TINTS, hash(k * 37));
            if (k < 0.4) {
              quad(pa, pc, 0, 0.9, n, s1 - s0, DARK);
              quad(pa, pc, 0.9, top, n, s1 - s0, tint);
            } else quad(pa, pc, 0, top, n, s1 - s0, tint);
          }
        });
      // 高樓旁邊塌下來的水泥碎塊
      if (b.h > 12 && hash(b.k * 919) < 0.55) {
        const i = Math.floor(hash(b.k * 929) * ring.length);
        const [a, c] = [ring[i], ring[(i + 1) % ring.length]];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
        const n: Pt = [(c[1] - a[1]) / len, -(c[0] - a[0]) / len];
        const d = 1.6 + hash(b.k * 937) * 1.2;
        const p: Pt = [(a[0] + c[0]) / 2 + n[0] * d, (a[1] + c[1]) / 2 + n[1] * d];
        if (free(p, 0.5)) {
          const s = 0.8 + hash(b.k * 941) * 0.8;
          rubble.push({ m: mtx(p, 0, hash(b.k * 947) * 6, 0, 0, s) });
          block(p, 1.0 * s);
        }
      }
    }
    if (sPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(sNrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(sUv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(sCol, 3));
      const m = new THREE.Mesh(g, shutterMat);
      m.receiveShadow = true;
      root.add(m);
      ch.trees.push(m);
    }
    inst(rubbleGeo, propMat, rubble);

    // 路口歪掉的紅綠燈、公車亭（位置在讀資料時就找好了）
    inst(
      lightGeo,
      propMat,
      ch.lights.map(({ p, yaw, k }) => {
        block(p, 0.15);
        return { m: mtx(p, 0, yaw, (hash(k * 7) - 0.5) * 0.25, (hash(k * 11) - 0.5) * 0.25) };
      }),
    );
    inst(
      shelterGeo,
      propMat,
      ch.shelters.map(({ p, yaw }) => {
        // 柱子、後面的欄杆擋路（形狀的 x、z 換到東北：+x 是 (cos θ, sin θ)、+z 是 (sin θ, -cos θ)）
        const at = (x: number, z: number): Pt => [p[0] + x * Math.cos(yaw) + z * Math.sin(yaw), p[1] + x * Math.sin(yaw) - z * Math.cos(yaw)];
        for (const [x, z] of [[-1.8, -0.75], [-0.9, -0.75], [0, -0.75], [0.9, -0.75], [1.8, -0.75], [-1.8, 0.7], [1.8, 0.7]]) block(at(x, z), 0.3);
        return { m: mtx(p, 0, yaw) };
      }),
    );
  }

  function build(ch: Chunk): void {
    const root = new THREE.Group();
    ch.root = root;
    group.add(root);
    if (ch.bs.length) {
      const { walls, roofs } = wallsAndRoofs(ch.bs);
      const w = new THREE.Mesh(walls, wallMat);
      w.castShadow = w.receiveShadow = true;
      const r = new THREE.Mesh(roofs, o.grass);
      r.castShadow = r.receiveShadow = true;
      root.add(w, r);
    }
    const { road, lines } = roadGeo(ch.roads);
    if (road) {
      const m = new THREE.Mesh(road, roadMat);
      m.receiveShadow = true;
      root.add(m);
    }
    if (lines) root.add(new THREE.Mesh(lines, lineMat));
    // 路燈：大馬路兩邊輪流，每 LAMP_EVERY 公尺一支，往路中間伸出去，歪向隨便一邊
    const lamps: THREE.Matrix4[] = [];
    for (const r of ch.roads) {
      if (!LAMP_ROADS.has(r.cls)) continue;
      let walked = 0;
      for (let i = 1; i < r.pts.length; i++) {
        const [a, b] = [r.pts[i - 1], r.pts[i]];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-3) continue;
        const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        for (let t = Math.ceil(walked / LAMP_EVERY) * LAMP_EVERY - walked; t <= len; t += LAMP_EVERY) {
          const side = Math.round((walked + t) / LAMP_EVERY) % 2 ? 1 : -1;
          const off = r.w / 2 + 0.7;
          const p: Pt = [a[0] + ux * t - uy * off * side, a[1] + uy * t + ux * off * side];
          if (nearPark(p, 3) || inBuilding(p, 0.5) || p[0] ** 2 + p[1] ** 2 > 2300 ** 2) continue;
          const k = hashAt(p[0], p[1], 9);
          // 燈臂（形狀的 +x）朝路中間：繞 y 轉 θ 時 +x 變成 (cos θ, 0, -sin θ)；往隨便一邊歪，最多約 14 度
          const toRoad = Math.atan2(-ux * side, uy * side);
          tmpE.set((hash(k * 31) - 0.5) * 0.5, toRoad, (hash(k * 37) - 0.5) * 0.5, 'YXZ');
          lamps.push(new THREE.Matrix4().compose(new THREE.Vector3(p[0], 0, -p[1]), tmpQ.setFromEuler(tmpE), new THREE.Vector3(1, 1, 1)));
          trunks.add([p[0] - 0.2, p[1] - 0.2, p[0] + 0.2, p[1] + 0.2], [p[0], p[1], 0.12]);
        }
        walked += len;
      }
    }
    const trees: Array<{ p: Pt; y: number; h: number; r: number; k: number }> = [];
    // 樹：每 8 公尺看一次（挪一點點），綠地長得密、空地人行道有一些、馬路的裂縫偶爾一棵
    const [x0, y0] = [ch.c[0] - CHUNK / 2, ch.c[1] - CHUNK / 2];
    for (let gx = x0 + 4; gx < x0 + CHUNK; gx += 8)
      for (let gy = y0 + 4; gy < y0 + CHUNK; gy += 8) {
        const p: Pt = [gx + (hashAt(gx, gy, 1) - 0.5) * 6, gy + (hashAt(gx, gy, 2) - 0.5) * 6];
        if (p[0] ** 2 + p[1] ** 2 > 2300 ** 2 || nearPark(p, 4) || inWater(p) || inBuilding(p, 1.2)) continue;
        const k = hashAt(p[0], p[1], 3);
        const green = inGreen(p);
        const road = !green && onRoad(p);
        if (k > (green ? 0.6 : road ? 0.04 : 0.24)) continue;
        const s = hash(k * 501);
        const [h, r] = green ? [8 + s * 6, 3 + s * 2] : road ? [3 + s * 2, 1.2 + s * 0.8] : [5 + s * 4, 2 + s * 1.5];
        trees.push({ p, y: 0, h, r, k });
        trunks.add([p[0] - 1, p[1] - 1, p[0] + 1, p[1] + 1], [p[0], p[1], 0.12 + r * 0.05]);
      }
    // 屋頂上長出來的小樹（大一點、不太高的房子）
    for (const b of ch.bs) {
      if (b.area < 120 || b.h > 40 || hash(b.k * 733) > 0.45 || !inRing(b.c, b.rings[0])) continue;
      const s = hash(b.k * 811);
      trees.push({ p: b.c, y: b.h, h: 2 + s * 2.5, r: 1 + s * 0.9, k: b.k });
    }
    if (trees.length) {
      const tr = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
      const cr = new THREE.InstancedMesh(crownGeo, crownMat, trees.length);
      trees.forEach(({ p, y, h, r, k }, i) => {
        const tw = 0.12 + r * 0.05;
        const trunkH = Math.max(0.6, h - r * 0.9);
        tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(k * 17) * Math.PI * 2);
        tmpM.compose(new THREE.Vector3(p[0], y, -p[1]), tmpQ, new THREE.Vector3(tw, trunkH + 0.3, tw));
        tr.setMatrixAt(i, tmpM);
        tmpM.compose(new THREE.Vector3(p[0], y + trunkH + r * 0.55, -p[1]), tmpQ, new THREE.Vector3(r, r * 0.82, r));
        cr.setMatrixAt(i, tmpM);
        cr.setColorAt(i, CROWNS[Math.floor(hash(k * 23) * CROWNS.length)]);
      });
      for (const m of [tr, cr]) {
        m.castShadow = m.receiveShadow = true;
        m.computeBoundingSphere();
        root.add(m);
        ch.trees.push(m);
      }
    }
    if (lamps.length) {
      const lm = new THREE.InstancedMesh(lampGeo, lampMat, lamps.length);
      lamps.forEach((m, i) => lm.setMatrixAt(i, m));
      lm.castShadow = lm.receiveShadow = true;
      lm.computeBoundingSphere();
      root.add(lm);
      ch.trees.push(lm);
    }
    buildProps(ch, root);
    // 小花：每 4 公尺看一次，草地上一叢叢的（馬路上少）
    const flowers: THREE.Matrix4[] = [];
    const fCol: THREE.Color[] = [];
    for (let gx = x0 + 2; gx < x0 + CHUNK; gx += 4)
      for (let gy = y0 + 2; gy < y0 + CHUNK; gy += 4) {
        const p: Pt = [gx + (hashAt(gx, gy, 6) - 0.5) * 3.5, gy + (hashAt(gx, gy, 7) - 0.5) * 3.5];
        const k = hashAt(p[0], p[1], 8);
        if (k > 0.3 || nearPark(p, 1) || inBuilding(p, 0.3) || inWater(p) || (onRoad(p) && k > 0.04)) continue;
        tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), k * 40);
        flowers.push(new THREE.Matrix4().compose(new THREE.Vector3(p[0], 0, -p[1]), tmpQ, new THREE.Vector3(1, 0.8 + k, 1)));
        fCol.push(FLOWERS[Math.floor(hash(k * 97) * FLOWERS.length)]);
      }
    if (flowers.length) {
      const fm = new THREE.InstancedMesh(flowerGeo, flowerMat, flowers.length);
      flowers.forEach((m, i) => {
        fm.setMatrixAt(i, m);
        fm.setColorAt(i, fCol[i]);
      });
      fm.computeBoundingSphere();
      fm.receiveShadow = true;
      root.add(fm);
      ch.flowers = fm;
    }
  }

  // ---- 地面：跟著你的一大片圓形草地（身邊密、遠的疏），國館裡面（國館自己有地面）、碰到國館的水的那幾格不鋪
  const radii = [0];
  for (let r = 1; r < GROUND_R; r = r * 1.07 + 0.8) radii.push(r);
  const gPos: number[] = [0, -0.01, 0];
  const gUv: number[] = [0, 0];
  for (const r of radii.slice(1))
    for (let k = 0; k < GROUND_SEG; k++) {
      const a = (k / GROUND_SEG) * Math.PI * 2;
      const [x, n] = [Math.cos(a) * r, Math.sin(a) * r];
      gPos.push(x, -0.01, -n);
      gUv.push(x, n);
    }
  const vid = (i: number, k: number): number => (i === 0 ? 0 : 1 + (i - 1) * GROUND_SEG + (k % GROUND_SEG));
  /** 所有的三角形（東北平面上逆時針，朝上） */
  const gTris: number[] = [];
  for (let i = 0; i + 1 < radii.length; i++)
    for (let k = 0; k < GROUND_SEG; k++) {
      if (i === 0) gTris.push(0, vid(1, k), vid(1, k + 1));
      else gTris.push(vid(i, k), vid(i + 1, k), vid(i + 1, k + 1), vid(i, k), vid(i + 1, k + 1), vid(i, k + 1));
    }
  const groundGeo = new THREE.BufferGeometry();
  groundGeo.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
  groundGeo.setAttribute('normal', new THREE.Float32BufferAttribute(gPos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  groundGeo.setAttribute('uv', new THREE.Float32BufferAttribute(gUv, 2));
  const ground = new THREE.Mesh(groundGeo, o.grass);
  ground.receiveShadow = true;
  ground.frustumCulled = false;
  group.add(ground);
  const lakeBoxes = o.lakes.map(boxOf);
  let groundAt = '';
  /** 地面挪到 c（公尺）：三個角都在國館裡、或碰到國館的水的三角形不鋪 */
  function moveGround(c: Pt): void {
    ground.position.set(c[0], 0, -c[1]);
    const nv = gPos.length / 3;
    const inP = new Uint8Array(nv);
    for (let v = 0; v < nv; v++) {
      const p: Pt = [c[0] + gPos[v * 3], c[1] - gPos[v * 3 + 2]];
      inP[v] = inBox(p, parkBox) && inPark(p) ? 1 : 0;
    }
    const idx: number[] = [];
    for (let t = 0; t < gTris.length; t += 3) {
      const [a, b, d] = [gTris[t], gTris[t + 1], gTris[t + 2]];
      if (inP[a] && inP[b] && inP[d]) continue;
      if (inP[a] || inP[b] || inP[d]) {
        const xs = [a, b, d].map((v) => c[0] + gPos[v * 3]);
        const ys = [a, b, d].map((v) => c[1] - gPos[v * 3 + 2]);
        const tb: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        if (lakeBoxes.some((l) => tb[0] <= l[2] && tb[2] >= l[0] && tb[1] <= l[3] && tb[3] >= l[1])) continue;
      }
      idx.push(a, b, d);
    }
    groundGeo.setIndex(idx);
  }

  // ---- 蝴蝶（白天）、螢火蟲（晚上）：在你身邊飛（離太遠就換到你附近）
  const critters = new THREE.Group();
  group.add(critters);
  const wingTex = (color: string): THREE.CanvasTexture => {
    const cv = document.createElement('canvas');
    [cv.width, cv.height] = [64, 64];
    const g = cv.getContext('2d')!;
    // 右邊一片翅膀（左邊是鏡射）：上面大、下面小，邊緣深一點、中間一個小圓點
    g.fillStyle = color;
    g.strokeStyle = 'rgba(80, 70, 60, 0.6)';
    g.lineWidth = 3;
    for (const [cx, cy, rx, ry] of [
      [34, 22, 28, 20],
      [28, 46, 20, 15],
    ]) {
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.fillStyle = 'rgba(90, 80, 70, 0.55)';
    g.beginPath();
    g.arc(40, 22, 5, 0, Math.PI * 2);
    g.fill();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const wingGeo = new THREE.PlaneGeometry(0.12, 0.12).rotateX(-Math.PI / 2).translate(0.06, 0, 0);
  const butterflies = ['#fff3a6', '#ffffff', '#bfe0ff', '#ffd6a6', '#ffe9f2', '#fff3a6', '#d8f0b8'].map((c, i) => {
    const m = new THREE.MeshLambertMaterial({ map: wingTex(c), side: THREE.DoubleSide, alphaTest: 0.5 });
    const g = new THREE.Group();
    const r = new THREE.Mesh(wingGeo, m);
    const l = new THREE.Mesh(wingGeo, m);
    l.scale.x = -1;
    g.add(r, l);
    critters.add(g);
    return { g, r, l, home: [Infinity, Infinity] as Pt, ph: i * 1.7, sp: 0.8 + hash(i + 40) * 0.5 };
  });
  const FIREFLIES = 60;
  const ffGeo = new THREE.BufferGeometry();
  ffGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(FIREFLIES * 3), 3));
  ffGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(FIREFLIES * 3), 3));
  const ffTex = (() => {
    const cv = document.createElement('canvas');
    [cv.width, cv.height] = [32, 32];
    const g = cv.getContext('2d')!;
    const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(cv);
  })();
  const fireflies = new THREE.Points(
    ffGeo,
    new THREE.PointsMaterial({ size: 0.28, map: ffTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  fireflies.frustumCulled = false;
  critters.add(fireflies);
  const ffs = Array.from({ length: FIREFLIES }, (_, i) => ({ home: [Infinity, Infinity] as Pt, ph: hash(i + 500) * 20, sp: 0.6 + hash(i + 600) * 0.8, h: 0.4 + hash(i + 700) * 1.8 }));
  /** 換到你附近一個站得住的地方（r0～r1 公尺） */
  const reseed = (you: Pt, r0: number, r1: number, seed: number): Pt => {
    for (let n = 0; n < 6; n++) {
      const a = Math.random() * Math.PI * 2;
      const r = r0 + Math.random() * (r1 - r0);
      const p: Pt = [you[0] + Math.cos(a) * r, you[1] + Math.sin(a) * r];
      if (!inBuilding(p, 1) && !inWater(p)) return p;
    }
    return [you[0] + Math.cos(seed) * r0, you[1] + Math.sin(seed) * r0];
  };
  let critAt = 0;
  function animate(now: number, you: Pt, night: number): boolean {
    const [day, dark] = [night < 0.4, night > 0.3];
    let changed = butterflies[0].g.visible !== day || fireflies.visible !== dark;
    for (const b of butterflies) b.g.visible = day;
    fireflies.visible = dark;
    // 一秒 30 格就好（站著不動時不用一直全速畫）
    if (now - critAt < 33) return changed;
    critAt = now;
    const t = now / 1000;
    if (day)
      for (const b of butterflies) {
        if (Math.hypot(b.home[0] - you[0], b.home[1] - you[1]) > 26) b.home = reseed(you, 5, 16, b.ph);
        const w = t * b.sp;
        const x = b.home[0] + Math.sin(w * 0.5 + b.ph) * 3 + Math.sin(w * 1.3 + b.ph * 2) * 0.6;
        const y = b.home[1] + Math.cos(w * 0.4 + b.ph) * 3 + Math.cos(w * 1.1 + b.ph) * 0.6;
        const vx = Math.cos(w * 0.5 + b.ph) * 1.5 + Math.cos(w * 1.3 + b.ph * 2) * 0.78;
        const vy = -Math.sin(w * 0.4 + b.ph) * 1.2 - Math.sin(w * 1.1 + b.ph) * 0.66;
        b.g.position.set(x, 0.7 + 0.5 * (1 + Math.sin(w * 0.8 + b.ph)) + 0.12 * Math.sin(w * 9 + b.ph), -y);
        b.g.rotation.y = Math.atan2(vx, -vy) + Math.PI;
        const flap = 0.2 + 0.95 * (0.5 + 0.5 * Math.sin(t * 20 * b.sp + b.ph));
        b.r.rotation.z = flap;
        b.l.rotation.z = -flap;
      }
    if (dark) {
      const p = ffGeo.getAttribute('position') as THREE.BufferAttribute;
      const c = ffGeo.getAttribute('color') as THREE.BufferAttribute;
      ffs.forEach((f, i) => {
        if (Math.hypot(f.home[0] - you[0], f.home[1] - you[1]) > 28) f.home = reseed(you, 3, 22, f.ph);
        const w = t * f.sp * 0.3;
        p.setXYZ(i, f.home[0] + Math.sin(w + f.ph) * 1.6, f.h + Math.sin(w * 1.7 + f.ph) * 0.35, -(f.home[1] + Math.cos(w * 0.8 + f.ph) * 1.6));
        const blink = Math.max(0, Math.sin(t * 1.2 * f.sp + f.ph)) ** 3 * Math.min(1, (night - 0.3) / 0.4);
        c.setXYZ(i, 0.8 * blink, 1 * blink, 0.42 * blink);
      });
      p.needsUpdate = c.needsUpdate = true;
    }
    return changed || day || dark;
  }

  const list = [...chunks.values()];
  const tooFar = (p: Pt): boolean => Math.hypot(p[0] - o.center[0], p[1] - o.center[1]) > CITY_WALK_M;

  // ---- 地圖（小地圖、大地圖）：每一樣先記住範圍，畫的時候只畫看得到的
  const mapRoads = list.flatMap((ch) => ch.roads).map((r) => ({ r, box: boxOf(r.pts) }));
  const mapGreens: Array<{ rings: Pt[][]; box: Box }> = [];
  for (const s of WOOF_GREEN ? WOOF_GREEN.split(';') : []) {
    const rings = s.split('/').map(decode);
    if (rings[0].length >= 3 && !inPark(rings[0][0])) mapGreens.push({ rings, box: boxOf(rings[0]) });
  }
  const pm = o.parkMap;
  const parkLawns = pm.lawns.map((r) => ({ r, box: boxOf(r) }));
  function drawMap(g: CanvasRenderingContext2D, c: Pt, mpp: number, w: number, h: number): void {
    const view: Box = [c[0] - (w / 2) * mpp, c[1] - (h / 2) * mpp, c[0] + (w / 2) * mpp, c[1] + (h / 2) * mpp];
    const seen = (b: Box, m = 0): boolean => b[0] - m <= view[2] && b[2] + m >= view[0] && b[1] - m <= view[3] && b[3] + m >= view[1];
    const X = (x: number): number => w / 2 + (x - c[0]) / mpp;
    const Y = (y: number): number => h / 2 - (y - c[1]) / mpp;
    const ring = (r: Pt[]): void => {
      r.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.closePath();
    };
    const line = (l: Pt[]): void => l.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    // 草地星球的底
    g.fillStyle = '#cfe2ae';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b6d58e';
    g.beginPath();
    for (const gr of mapGreens) if (seen(gr.box)) gr.rings.forEach(ring);
    g.fill('evenodd');
    g.fillStyle = '#a6d2e4';
    g.beginPath();
    for (const wt of water) if (seen(wt.box)) wt.rings.forEach(ring);
    g.fill('evenodd');
    // 馬路：淡淡的柏油色，照路寬畫（太細的至少 1 像素）
    g.strokeStyle = '#efe9dc';
    g.lineCap = g.lineJoin = 'round';
    for (const { r, box } of mapRoads) {
      if (!seen(box, r.w)) continue;
      g.lineWidth = Math.max(1, r.w / mpp);
      g.beginPath();
      line(r.pts);
      g.stroke();
    }
    // 房子
    g.fillStyle = '#bdb7ab';
    g.strokeStyle = 'rgba(90, 86, 78, 0.55)';
    g.lineWidth = mpp < 1.5 ? 1 : 0.5;
    g.beginPath();
    for (const b of buildings) if (seen(b.box)) b.rings.forEach(ring);
    g.fill('evenodd');
    if (mpp < 4) g.stroke();
    // 國館：地面、草地、水（小島挖回草地）、步道、樹、建築，外框一圈
    g.fillStyle = '#ece4d2';
    g.beginPath();
    ring(o.outline);
    g.fill();
    g.fillStyle = '#a8cf7e';
    g.beginPath();
    for (const l of parkLawns) if (seen(l.box)) ring(l.r);
    g.fill();
    for (const wt of pm.water) {
      g.fillStyle = '#9fcde0';
      g.beginPath();
      ring(wt.outer);
      g.fill();
      g.fillStyle = '#a8cf7e';
      g.beginPath();
      wt.islands.forEach(ring);
      g.fill();
    }
    g.strokeStyle = '#f6f0e2';
    g.lineWidth = Math.max(1, 2.5 / mpp);
    g.beginPath();
    pm.paths.forEach(line);
    g.stroke();
    if (mpp < 3) {
      g.fillStyle = 'rgba(86, 140, 62, 0.45)';
      g.beginPath();
      for (const [x, y, r] of pm.trees) {
        g.moveTo(X(x) + Math.max(1, r / mpp), Y(y));
        g.arc(X(x), Y(y), Math.max(1, r / mpp), 0, Math.PI * 2);
      }
      g.fill();
    }
    g.fillStyle = '#c9a77c';
    g.beginPath();
    pm.buildings.forEach(ring);
    g.fill();
    g.strokeStyle = 'rgba(90, 86, 78, 0.6)';
    g.lineWidth = 1;
    g.beginPath();
    ring(o.outline);
    g.stroke();
    // 走得到的邊界（2 公里）：粉紅色虛線
    g.strokeStyle = 'rgba(232, 120, 150, 0.85)';
    g.setLineDash([6, 5]);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(X(o.center[0]), Y(o.center[1]), CITY_WALK_M / mpp, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  return {
    group,
    walkM: CITY_WALK_M,
    tooFar,
    drawMap,
    canStand: (p) => !tooFar(p) && !inWater(p) && !inBuilding(p, BODY) && !hitTrunk(p),
    update(cam, you, now, night) {
      let changed = false;
      const gc: Pt = [Math.round(cam.x / GROUND_SNAP) * GROUND_SNAP, Math.round(-cam.z / GROUND_SNAP) * GROUND_SNAP];
      if (`${gc}` !== groundAt) {
        groundAt = `${gc}`;
        moveGround(gc);
        changed = true;
      }
      const hzEye = horizon(cam.y);
      const todo: Array<[number, Chunk]> = [];
      for (const ch of list) {
        const d = Math.max(0, Math.hypot(ch.c[0] - cam.x, ch.c[1] + cam.z) - CHUNK * 0.71);
        const want = d < FAR_M && d < hzEye + horizon(Math.max(ch.maxH, 15));
        if (!ch.root) {
          if (want) todo.push([d, ch]);
          continue;
        }
        if (ch.root.visible !== want) {
          ch.root.visible = want;
          changed = true;
        }
        if (!want) continue;
        const trees = d < TREE_FAR && d < hzEye + horizon(15);
        for (const t of ch.trees)
          if (t.visible !== trees) {
            t.visible = trees;
            changed = true;
          }
        const fl = d < FLOWER_FAR;
        if (ch.flowers && ch.flowers.visible !== fl) {
          ch.flowers.visible = fl;
          changed = true;
        }
      }
      // 近的先蓋；每一格畫面最多蓋 BUILD_MS 毫秒（至少一格），還沒蓋完下一格接著蓋
      todo.sort((a, b) => a[0] - b[0]);
      const t0 = performance.now();
      for (const [, ch] of todo) {
        build(ch);
        changed = true;
        if (performance.now() - t0 > BUILD_MS) break;
      }
      if (animate(now, you, night)) changed = true;
      return changed;
    },
  };
}
