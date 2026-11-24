/**
 * 汪星 3D：國館外面荒廢了幾萬年的街道（v1.812 使用者說「汪星除了國館整個做成 3D，走出國館看到的是荒廢幾萬年的街道」；
 * 範圍先做國館附近 2 公里、照汪星的大小彎、荒廢到還看得出街道，這三個是使用者選的）。park3d.ts 在汪星時才載入。
 * 街道、房子的位置和外框是真的（woof-city-data.ts：OpenStreetMap，經 OpenFreeMap 的圖磚，國館附近 2.3 公里），荒廢的樣子是想像的：
 * - 房子：灰白色的水泥殼，窗戶只剩洞、沒有玻璃；上面幾層塌了、牆頂參差不齊，牆腳長青苔、牆上垂著藤蔓，屋頂長滿草、有的長出小樹。
 *   高度照 OSM 寫的高度、樓層數；沒寫的照大小估（ESTIMATE_H），塌掉多少是亂數（固定的，每次一樣）
 * - 馬路：柏油裂成一塊塊、縫裡和一片片長草，大一點的路中間有淡到快看不見的標線（路寬照種類估的，ROAD_W）；高架、隧道不畫
 * - 樹：從人行道、空地、馬路的裂縫長出來，OSM 的草地、樹林長得密；大馬路邊的路燈歪了、生鏽，不會亮；沒有招牌、文字、車
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
}

export interface WoofCity {
  group: THREE.Group;
  /** 國館外面這裡站不站得住（房子、水、樹幹、路燈、太遠） */
  canStand(p: Pt): boolean;
  /** 超過走得到的範圍 */
  tooFar(p: Pt): boolean;
  /** 每一格：照鏡頭蓋附近的格子、顯示看得到的，蝴蝶、螢火蟲飛；回傳要不要重畫 */
  update(cam: THREE.Vector3, you: Pt, now: number, night: number): boolean;
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
    if (!ch) chunks.set(key, (ch = { c: [(i + 0.5) * CHUNK, (j + 0.5) * CHUNK], bs: [], roads: [], maxH: 0, root: null, trees: [], flowers: null }));
    return ch;
  };
  for (const b of buildings) {
    const ch = chunkOf(b.c);
    ch.bs.push(b);
    ch.maxH = Math.max(ch.maxH, b.h + FLOOR_H);
  }
  const rGrid = new Grid<{ a: Pt; b: Pt; hw: number }>(20);
  for (const s of WOOF_ROADS.split(';')) {
    const i = s.indexOf(':');
    const cls = s.slice(0, i);
    const w = ROAD_W[cls] ?? 5;
    const pts = decode(s.slice(i + 1));
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
  return {
    group,
    tooFar,
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
