/**
 * 雷達上的道路（範圍到全台）：OpenFreeMap 的向量圖磚（OpenMapTiles 格式，資料來自 OpenStreetMap），
 * 只取 transportation 圖層的道路（不含隧道、步道、服務道路、鐵路），第一次用到才載入。
 * 範圍越大用越粗一級的圖磚（OpenMapTiles 已經簡化過，越粗的只留越大的路），畫的路也越少。
 * 圖磚是 Mapbox Vector Tile（protobuf），這裡只解讀用得到的欄位，不另外加函式庫。
 */

import { JP_LAND } from './jp-land';
import { KR_LAND } from './kr-land';
import { NL_LAND } from './nl-land';
import { TAIWAN_RINGS } from './taiwan';
import { US_LAND } from './us-land';
// 雷達上寫的縣市、鄉鎮市區名稱跟著街道一起載入（v1.691）
export { TW_COUNTIES, TW_TOWNS } from './places-tw';

/** 粗線、細線；lane 巷弄、path 步道（2 km 內、全螢幕才畫，v1.781） */
export type StreetClass = 'major' | 'minor' | 'lane' | 'path';

/** 一條街：pts 是 [緯度, 經度, 緯度, 經度, …]；box 是 [最小緯度, 最小經度, 最大緯度, 最大經度] */
export interface StreetLine {
  cls: StreetClass;
  pts: Float64Array;
  box: [number, number, number, number];
  /** 橋（brunnel=bridge）：畫街道照畫，洋流總部的行道樹不長在橋上 */
  bridge?: boolean;
}

/** OpenMapTiles 的道路種類 → 畫法；沒列的（service、track、path、rail、ferry、施工中…）不畫 */
type Classes = Record<string, StreetClass>;
/** 國道、快速道路粗線 */
const HIGHWAYS: Classes = { motorway: 'major', trunk: 'major' };

/**
 * 雷達範圍（半徑）→ 用哪一級圖磚、畫哪些路。一張圖磚的寬度（台灣約緯度 25 度）要大於畫面直徑，最多才四張（16 km 那一級例外，最多九張）：
 * z13 約 4.4 km、z11 約 18 km、z10 約 35 km、z9 約 71 km、z8 約 142 km、z7 約 284 km。
 * 2 km 內大街小巷都畫（z14 多了建築、門牌、店家，市區一張壓縮後就六百多 KB，用不到）。
 * 再大（到全台）都用 z7（z6 只剩國道、快速道路，東部的台 9 線沒有）：regional 只畫 REGIONS 那幾個地方的，
 * 台灣只畫台灣（本島、離島）的路、只抓台灣那六張圖磚（共約 460 KB；全台的範圍對岸也在圈內）；荷蘭也是六張（約 1.2 MB）
 */
export const STREET_TIERS: Array<{ maxKm: number; zoom: number; classes: Classes; regional?: boolean; coast?: boolean; names?: string[]; stations?: boolean; green?: boolean }> = [
  // names：雷達上寫路名的道路種類（transportation_name 圖層）；stations：寫車站名（poi 圖層，z13 才有）
  // 巷弄（service，只畫標成 alley 的）、步道（path：人行步道、自行車道、階梯）v1.781 使用者說 2 km 內加巷弄跟步道（全螢幕才畫，main.ts）
  { maxKm: 2, zoom: 13, classes: { motorway: 'major', trunk: 'major', primary: 'major', secondary: 'major', tertiary: 'minor', minor: 'minor', service: 'lane', path: 'path' }, coast: true, names: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'], stations: true, green: true },
  // 市區的幹道台北多半標 secondary，其他縣市很多標 tertiary（新竹 8 km 內 secondary 約 90 km、tertiary 約 400 km）：都畫，各地一樣細；
  // 16 km 內也是（z10 沒有 tertiary，所以用 z11，一張約 18 km 寬，最多九張）
  // z11 的路名只有國道、快速道路
  { maxKm: 16, zoom: 11, classes: { ...HIGHWAYS, primary: 'minor', secondary: 'minor', tertiary: 'minor' }, coast: true, names: ['motorway', 'trunk'], green: true },
  { maxKm: 33, zoom: 9, classes: { ...HIGHWAYS, primary: 'minor' }, green: true },
  { maxKm: 65, zoom: 8, classes: { ...HIGHWAYS, primary: 'minor' }, green: true },
  { maxKm: Infinity, zoom: 7, classes: { ...HIGHWAYS, primary: 'minor' }, regional: true, green: true },
];
/** 台灣（含金門、馬祖、澎湖）的範圍：regional 那一級在台灣只抓這裡面的圖磚 */
const TAIWAN_BOX = { s: 21.88, w: 118.2, n: 26.45, e: 122.1 };
/** 馬祖（TAIWAN_RINGS 沒有馬祖）：對岸的黃岐半島在東經 119.9 以西 */
const MATSU_BOX = { s: 25.9, w: 119.9, n: 26.45, e: 120.55 };
const RING_BOXES = TAIWAN_RINGS.map((r) => ({
  r,
  s: Math.min(...r.map((p) => p[0])),
  n: Math.max(...r.map((p) => p[0])),
  w: Math.min(...r.map((p) => p[1])),
  e: Math.max(...r.map((p) => p[1])),
}));
const inRing = (lat: number, lng: number, r: Array<[number, number]>): boolean => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][0] > lat !== r[j][0] > lat && lng < ((r[j][1] - r[i][1]) * (lat - r[i][0])) / (r[j][0] - r[i][0]) + r[i][1]) inside = !inside;
  }
  return inside;
};
/** 這條路有一點在台灣的陸地上（海岸線簡化過，沿海的路不一定每一點都在裡面） */
export function onTaiwan(l: StreetLine): boolean {
  for (let i = 0; i < l.pts.length; i += 2) {
    const [lat, lng] = [l.pts[i], l.pts[i + 1]];
    if (lat >= MATSU_BOX.s && lat <= MATSU_BOX.n && lng >= MATSU_BOX.w && lng <= MATSU_BOX.e) return true;
    for (const b of RING_BOXES) if (lat >= b.s && lat <= b.n && lng >= b.w && lng <= b.e && inRing(lat, lng, b.r)) return true;
  }
  return false;
}
type Box = { s: number; w: number; n: number; e: number };
/** 一個地方的陸地範圍（好幾圈）：每一圈的外框（先看外框，再看在不在那一圈裡）、整個的外框、在不在裡面 */
function landOf(rings: Array<Array<[number, number]>>): { boxes: Array<Box & { r: Array<[number, number]> }>; box: Box; inside: (lat: number, lng: number) => boolean } {
  const boxes = rings.map((r) => ({
    r,
    s: Math.min(...r.map((p) => p[0])),
    n: Math.max(...r.map((p) => p[0])),
    w: Math.min(...r.map((p) => p[1])),
    e: Math.max(...r.map((p) => p[1])),
  }));
  const box = { s: Math.min(...boxes.map((b) => b.s)), w: Math.min(...boxes.map((b) => b.w)), n: Math.max(...boxes.map((b) => b.n)), e: Math.max(...boxes.map((b) => b.e)) };
  const inside = (lat: number, lng: number): boolean => boxes.some((b) => lat >= b.s && lat <= b.n && lng >= b.w && lng <= b.e && inRing(lat, lng, b.r));
  return { boxes, box, inside };
}
/**
 * 一條線（路、河）切到這個地方裡面：連續在裡面的幾點是一段，頭尾接到邊界上（跨過邊界的那一小段對半找 8 次，約差 1/256 段）；
 * 不切的話路、河跨過國界整條畫，一路畫進德國、比利時
 */
function clipRuns(pts: Float64Array, inside: (lat: number, lng: number) => boolean): Array<{ pts: Float64Array; box: [number, number, number, number] }> {
  const n = pts.length / 2;
  const isIn = Array.from({ length: n }, (_, i) => inside(pts[i * 2], pts[i * 2 + 1]));
  /** 從裡面的 a 點往外面的 b 點走，邊界在哪 */
  const edge = (a: number, b: number): [number, number] => {
    let [lo, hi] = [0, 1];
    for (let k = 0; k < 8; k++) {
      const m = (lo + hi) / 2;
      if (inside(pts[a * 2] + (pts[b * 2] - pts[a * 2]) * m, pts[a * 2 + 1] + (pts[b * 2 + 1] - pts[a * 2 + 1]) * m)) lo = m;
      else hi = m;
    }
    return [pts[a * 2] + (pts[b * 2] - pts[a * 2]) * lo, pts[a * 2 + 1] + (pts[b * 2 + 1] - pts[a * 2 + 1]) * lo];
  };
  const out: Array<{ pts: Float64Array; box: [number, number, number, number] }> = [];
  for (let i = 0; i < n; i++) {
    if (!isIn[i]) continue;
    let j = i;
    while (j + 1 < n && isIn[j + 1]) j++;
    const run = [...(i > 0 ? edge(i, i - 1) : []), ...pts.subarray(i * 2, j * 2 + 2), ...(j + 1 < n ? edge(j, j + 1) : [])];
    if (run.length >= 4) out.push(withBox(run));
    i = j;
  }
  return out;
}
/** 只留這個地方的：路、河切在邊界上；綠地、湖看外框的中心或第一點（一塊一塊每一點都查太慢） */
function keepIn(inside: (lat: number, lng: number) => boolean): (t: TileData) => TileData {
  const area = (a: GreenArea): boolean => inside((a.box[0] + a.box[2]) / 2, (a.box[1] + a.box[3]) / 2) || (a.rings[0]?.length > 1 && inside(a.rings[0][0], a.rings[0][1]));
  return (t) => ({
    ...t,
    lines: t.lines.flatMap((l) => clipRuns(l.pts, inside).map((r) => ({ ...l, ...r }))),
    green: t.green.filter(area),
    water: t.water.filter(area),
    waterways: t.waterways.flatMap((l) => clipRuns(l.pts, inside).map((r) => ({ ...l, ...r }))),
  });
}
const NL = landOf(NL_LAND);
const JP = landOf(JP_LAND);
const KR = landOf(KR_LAND);
const US = landOf(US_LAND);

/**
 * 拉遠（regional 那一級）只畫這幾個地方，只抓 box 裡面的圖磚（同一張圖磚各地方留的不一樣，快取照 id 分開）：
 * 台灣只畫台灣（本島、離島）的路（對岸不畫）；荷蘭（v1.745）、日本（v1.746）、南韓、美國（v1.754）的路、綠地、河湖都只畫它的，
 * 路、河切在國界、海岸上，不會被圖磚切成方的。land：只抓碰到陸地的圖磚（全是海的不抓）；far：超過 km 改用那一級的圖磚
 * （日本很大，z7 拉到 600 km 全螢幕要七、八十張，超過圖磚快取的 MAX_TILES 會一直重抓；z6 只剩國道、快速道路，拉那麼遠也只看得到這些；
 * 美國的圖磚路多，400 km 以上再用 z5）。has：雷達中心在不在這個地方（日本的範圍包住南韓，中心在哪個地方的陸地上就用哪個）
 */
const REGIONS: Array<{ id: string; box: Box; keep: (t: TileData) => TileData; land?: Box[]; far?: Array<{ km: number; zoom: number }>; has: (lat: number, lng: number) => boolean }> = [
  { id: 'tw', box: TAIWAN_BOX, keep: (t) => ({ ...t, lines: t.lines.filter(onTaiwan) }), has: (lat, lng) => lat >= TAIWAN_BOX.s && lat <= TAIWAN_BOX.n && lng >= TAIWAN_BOX.w && lng <= TAIWAN_BOX.e },
  { id: 'nl', box: NL.box, keep: keepIn(NL.inside), land: NL.boxes, has: NL.inside },
  { id: 'kr', box: KR.box, keep: keepIn(KR.inside), land: KR.boxes, has: KR.inside },
  { id: 'jp', box: JP.box, keep: keepIn(JP.inside), land: JP.boxes, far: [{ km: 200, zoom: 6 }], has: JP.inside },
  { id: 'us', box: US.box, keep: keepIn(US.inside), land: US.boxes, far: [{ km: 200, zoom: 6 }, { km: 400, zoom: 5 }], has: US.inside },
];
export const tierOf = (km: number): (typeof STREET_TIERS)[number] => STREET_TIERS.find((t) => km <= t.maxKm) ?? STREET_TIERS[STREET_TIERS.length - 1];
const TILEJSON = 'https://tiles.openfreemap.org/planet';
/** 最多記住幾張圖磚（拖來拖去不要一直重抓） */
const MAX_TILES = 64;

/** protobuf 讀取：只需要 varint 和長度前綴 */
export class Pbf {
  pos = 0;
  constructor(
    private readonly buf: Uint8Array,
    private end = buf.length,
  ) {}
  more(): boolean {
    return this.pos < this.end;
  }
  varint(): number {
    let v = 0;
    let mul = 1;
    let b: number;
    do {
      b = this.buf[this.pos++];
      v += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    return v;
  }
  /** 長度前綴的一段，回傳新的讀取器 */
  sub(): Pbf {
    const len = this.varint();
    const r = new Pbf(this.buf, this.pos + len);
    r.pos = this.pos;
    this.pos += len;
    return r;
  }
  string(): string {
    const r = this.sub();
    return new TextDecoder().decode(this.buf.subarray(r.pos, r.end));
  }
  /** 打包的 varint 陣列 */
  packed(): number[] {
    const r = this.sub();
    const out: number[] = [];
    while (r.more()) out.push(r.varint());
    return out;
  }
  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) {
      const len = this.varint();
      this.pos += len;
    }
    else if (wire === 5) this.pos += 4;
    else throw new Error(`unknown wire type ${wire}`);
  }
}

/**
 * 圖磚裡寫在雷達上的名稱（v1.691 使用者說在雷達上適度放路名、地標）：
 * 有名字的路（transportation_name 圖層，同一條路常常切成好幾段）、車站（poi 圖層的捷運、火車站）
 */
export interface RoadName {
  name: string;
  cls: string;
  /** [緯度, 經度, …] */
  pts: Float64Array;
}
export interface StationName {
  name: string;
  lat: number;
  lng: number;
}
/**
 * 公園綠地（全螢幕雷達塗淡綠，v1.705 使用者說的；v1.707 拉遠到整個台灣也塗，那時主要是山上的樹林）：landcover 圖層的草地（公園、草地、高爾夫球場）、樹林；
 * rings 是外圈和挖空的圈（[緯度, 經度, …]）：外圈在地圖上順時針、挖空的逆時針，雷達用 nonzero 填色（v1.707）；
 * 一塊只有一個外圈（v1.708）
 */
export interface GreenArea {
  rings: Float64Array[];
  box: [number, number, number, number];
  /** 海（water 圖層 class=ocean，16 km 內才有） */
  sea?: boolean;
}
const GREEN_CLASSES = new Set(['grass', 'wood']);
/** 塗淡藍的水域（water 圖層的 class）：游泳池不塗；海（ocean）只有拿海岸線的那幾級（16 km 內）塗 */
const WATER_CLASSES = new Set(['river', 'lake', 'pond', 'reservoir', 'basin', 'dock']);
/** 河、溪的線（waterway 圖層）：pts 是 [緯度, 經度, …]，box 跟 StreetLine 一樣；cls 是 river（河、運河）或 stream（溪） */
export interface WaterLine {
  pts: Float64Array;
  box: [number, number, number, number];
  cls: 'river' | 'stream';
}

/**
 * 面的幾圈照圖磚的規格分成一塊一塊放進 out：外圈在地圖上順時針（ringArea 負的），後面跟著它挖空的圈（逆時針）。
 * v1.708：同一張圖磚裡同一類的合成一個 feature（例如福建和台灣的樹林），整個當一塊的話拉遠時半邊沒畫、或畫到中國
 */
function polygonsOf(rings: number[][], out: GreenArea[]): void {
  let box: [number, number, number, number] | null = null;
  let poly: Float64Array[] = [];
  const flush = (): void => {
    if (box) out.push({ rings: poly, box });
    box = null;
    poly = [];
  };
  for (const r of rings) {
    const a = ringArea(r);
    if (a < 0) {
      flush();
      // 太小的外圈不收，它挖空的圈也一起不收
      if (r.length >= 6) {
        const w = withBox(r);
        box = w.box;
        poly = [w.pts];
      }
    } else if (a > 0 && box && r.length >= 6) poly.push(Float64Array.from(r));
  }
  flush();
}

/** 雷達上寫車站的 poi 種類（class=railway 的 subclass） */
const STATION_KINDS = new Set(['subway', 'station', 'halt', 'light_rail']);

/** 幾何指令：MoveTo(1)、LineTo(2) 後面跟 zigzag 編碼的位移；一個 feature 可以有好幾段線（點的話每一個 MoveTo 一點） */
function geomParts(geom: number[], toLatLng: (cx: number, cy: number) => [number, number]): number[][] {
  const parts: number[][] = [];
  let cx = 0;
  let cy = 0;
  let line: number[] = [];
  for (let i = 0; i < geom.length; ) {
    const cmd = geom[i] & 7;
    const count = geom[i] >> 3;
    i++;
    if (cmd === 7) continue;
    for (let j = 0; j < count && i + 1 < geom.length; j++, i += 2) {
      if (cmd === 1) {
        if (line.length) parts.push(line);
        line = [];
      }
      cx += (geom[i] >> 1) ^ -(geom[i] & 1);
      cy += (geom[i + 1] >> 1) ^ -(geom[i + 1] & 1);
      line.push(...toLatLng(cx, cy));
    }
  }
  if (line.length) parts.push(line);
  return parts;
}

/** 一圈（[緯度, 經度, …]）的面積，經度當 x、緯度當 y：在地圖上逆時針是正的、順時針是負的 */
export function ringArea(r: ArrayLike<number>): number {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j + 1] * r[i] - r[i + 1] * r[j];
  return a / 2;
}

/** 一個 feature：tags、種類（1 點、2 線、3 面）、幾何 */
function readFeature(f: Pbf): { tags: number[]; type: number; geom: number[] } {
  let tags: number[] = [];
  let type = 0;
  let geom: number[] = [];
  while (f.more()) {
    const k = f.varint();
    const field = k >> 3;
    if (field === 2) tags = f.packed();
    else if (field === 3) type = f.varint();
    else if (field === 4) geom = f.packed();
    else f.skip(k & 7);
  }
  return { tags, type, geom };
}

/** 海岸線的一段：pts 是 [緯度, 經度, …]，box 跟 StreetLine 一樣 */
export interface CoastLine {
  pts: Float64Array;
  box: [number, number, number, number];
}

/** 圖磚裡的 transportation 圖層 → 要畫的道路（classes 有列的種類；座標換成經緯度） */
export function decodeStreets(buf: Uint8Array, x: number, y: number, z: number, classes: Classes = STREET_TIERS[0].classes): StreetLine[] {
  return decodeTile(buf, x, y, z, classes, false).lines;
}

/** 一串經緯度 → 有外框的一段 */
function withBox(line: number[]): { pts: Float64Array; box: [number, number, number, number] } {
  const pts = Float64Array.from(line);
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minLat = Math.min(minLat, pts[i]);
    maxLat = Math.max(maxLat, pts[i]);
    minLng = Math.min(minLng, pts[i + 1]);
    maxLng = Math.max(maxLng, pts[i + 1]);
  }
  return { pts, box: [minLat, minLng, maxLat, maxLng] };
}

/**
 * 圖磚 → 道路，coast 的話再加海岸線（v1.640 使用者說「不管放大到什麼程度都要有邊界」）：
 * water 圖層 class=ocean 的多邊形邊就是海岸；多邊形在圖磚邊上被切開的那幾段（兩端都在圖磚外面）不是海岸，不畫
 */
export function decodeTile(
  buf: Uint8Array,
  x: number,
  y: number,
  z: number,
  classes: Classes,
  coast: boolean,
  names: { roads?: string[]; stations?: boolean; green?: boolean } = {},
): { lines: StreetLine[]; coast: CoastLine[]; roads: RoadName[]; stations: StationName[]; green: GreenArea[]; water: GreenArea[]; waterways: WaterLine[] } {
  const tile = new Pbf(buf);
  const coastOut: CoastLine[] = [];
  const roadsOut: RoadName[] = [];
  const stationsOut: StationName[] = [];
  const greenOut: GreenArea[] = [];
  const waterOut: GreenArea[] = [];
  const waterwaysOut: WaterLine[] = [];
  const nameClasses = new Set(names.roads ?? []);
  // 圖層照字母排（landcover、poi、transportation、transportation_name、water、waterway）：要名稱、綠地（河、湖）、海岸線就讀完整張
  const whole = coast || nameClasses.size > 0 || !!names.stations || !!names.green;
  let linesOut: StreetLine[] = [];
  while (tile.more()) {
    const key = tile.varint();
    if (key >> 3 !== 3 || (key & 7) !== 2) {
      tile.skip(key & 7);
      continue;
    }
    const layer = tile.sub();
    let name = '';
    let extent = 4096;
    const keys: string[] = [];
    const values: Array<string | null> = [];
    const features: Pbf[] = [];
    while (layer.more()) {
      const k = layer.varint();
      const field = k >> 3;
      if (field === 1) name = layer.string();
      else if (field === 2) features.push(layer.sub());
      else if (field === 3) keys.push(layer.string());
      else if (field === 4) {
        // Value：字串（field 1）；整數（field 5、6，例如步道的 indoor=1）也記成字串，其他的用不到
        const v = layer.sub();
        let s: string | null = null;
        while (v.more()) {
          const vk = v.varint();
          if (vk >> 3 === 1) s = v.string();
          else if ((vk >> 3 === 5 || vk >> 3 === 6) && (vk & 7) === 0) s = String(v.varint());
          else v.skip(vk & 7);
        }
        values.push(s);
      } else if (field === 5) extent = layer.varint();
      else layer.skip(k & 7);
    }
    const n = 2 ** z;
    /** 圖磚裡的座標 → [緯度, 經度] */
    const toLatLng = (cx: number, cy: number): [number, number] => {
      const wx = (x + cx / extent) / n;
      const wy = (y + cy / extent) / n;
      return [(Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180) / Math.PI, wx * 360 - 180];
    };
    if (name === 'water' && coast) {
      // 讀完海岸線回到開頭，下面再讀一次河、湖（v1.734）
      const starts = features.map((f) => f.pos);
      coastOut.push(...oceanEdges(features, keys, values, extent, toLatLng));
      features.forEach((f, i) => (f.pos = starts[i]));
      if (!names.green) continue;
    }
    /** 一個 feature 的字串標籤 */
    const tagsOf = (tags: number[]): Record<string, string> => {
      const o: Record<string, string> = {};
      for (let i = 0; i + 1 < tags.length; i += 2) {
        const v = values[tags[i + 1]];
        if (v !== null && v !== undefined) o[keys[tags[i]]] = v;
      }
      return o;
    };
    if (name === 'transportation_name' && nameClasses.size > 0) {
      for (const f of features) {
        const { tags, type, geom } = readFeature(f);
        if (type !== 2) continue;
        const t = tagsOf(tags);
        // 交流道、出口的名稱（subclass=junction）不寫
        if (!t.name || !nameClasses.has(t.class) || t.subclass === 'junction') continue;
        for (const part of geomParts(geom, toLatLng)) if (part.length >= 4) roadsOut.push({ name: t.name, cls: t.class, pts: Float64Array.from(part) });
      }
      continue;
    }
    // 河、湖、水庫、池塘（v1.734 使用者說河也上色；跟綠地一起，全螢幕才畫）：游泳池不算；
    // 海只有拿海岸線的那幾級（16 km 內）塗（v1.757 使用者說把海的顏色畫出來；再遠的海岸是虛線，海照 main.ts 的陸地挖出來）
    if (name === 'water' && names.green) {
      for (const f of features) {
        const { tags, type, geom } = readFeature(f);
        if (type !== 3) continue;
        const cls = tagsOf(tags).class;
        if (!WATER_CLASSES.has(cls) && !(coast && cls === 'ocean')) continue;
        const from = waterOut.length;
        polygonsOf(geomParts(geom, toLatLng), waterOut);
        if (cls === 'ocean') for (let i = from; i < waterOut.length; i++) waterOut[i].sea = true;
      }
      continue;
    }
    // 比較窄、沒有河面的河、溪（線）：河、運河都畫，溪流要 z13（拉近）才畫；地下的（tunnel）、排水溝不畫
    if (name === 'waterway' && names.green) {
      for (const f of features) {
        const { tags, type, geom } = readFeature(f);
        if (type !== 2) continue;
        const t = tagsOf(tags);
        if (t.brunnel === 'tunnel') continue;
        const cls = t.class === 'river' || t.class === 'canal' ? 'river' : t.class === 'stream' && z >= 13 ? 'stream' : null;
        if (!cls) continue;
        for (const part of geomParts(geom, toLatLng)) if (part.length >= 4) waterwaysOut.push({ ...withBox(part), cls });
      }
      continue;
    }
    if (name === 'landcover' && names.green) {
      for (const f of features) {
        const { tags, type, geom } = readFeature(f);
        if (type !== 3) continue;
        if (!GREEN_CLASSES.has(tagsOf(tags).class)) continue;
        polygonsOf(geomParts(geom, toLatLng), greenOut);
      }
      continue;
    }
    if (name === 'poi' && names.stations) {
      for (const f of features) {
        const { tags, type, geom } = readFeature(f);
        if (type !== 1) continue;
        const t = tagsOf(tags);
        if (!t.name || t.class !== 'railway' || !STATION_KINDS.has(t.subclass)) continue;
        for (const part of geomParts(geom, toLatLng)) stationsOut.push({ name: t.name, lat: part[0], lng: part[1] });
      }
      continue;
    }
    if (name !== 'transportation') continue;
    const out: StreetLine[] = [];
    for (const f of features) {
      let tags: number[] = [];
      let type = 0;
      let geom: number[] = [];
      while (f.more()) {
        const k = f.varint();
        const field = k >> 3;
        if (field === 2) tags = f.packed();
        else if (field === 3) type = f.varint();
        else if (field === 4) geom = f.packed();
        else f.skip(k & 7);
      }
      if (type !== 2) continue;
      let cls: StreetClass | undefined;
      let tunnel = false;
      let bridge = false;
      let service: string | undefined;
      let sub: string | undefined;
      let indoor = false;
      for (let i = 0; i + 1 < tags.length; i += 2) {
        const tk = keys[tags[i]];
        const tv = values[tags[i + 1]];
        if (tk === 'class' && tv) cls = classes[tv];
        else if (tk === 'brunnel' && tv === 'tunnel') tunnel = true;
        else if (tk === 'brunnel' && tv === 'bridge') bridge = true;
        else if (tk === 'service') service = tv ?? undefined;
        else if (tk === 'subclass') sub = tv ?? undefined;
        else if (tk === 'indoor' && tv === '1') indoor = true;
      }
      // 地下道、隧道在地面上看不到，不畫
      if (!cls || tunnel) continue;
      // 巷弄只畫標成巷弄的（停車場、社區、私人車道不畫，畫了很亂）；步道不畫室內、月台
      if (cls === 'lane' && service !== 'alley') continue;
      if (cls === 'path' && (indoor || sub === 'platform' || sub === 'corridor')) continue;
      // 幾何指令：MoveTo(1)、LineTo(2) 後面跟 zigzag 編碼的位移；一個 feature 可以有好幾段線
      let cx = 0;
      let cy = 0;
      let line: number[] = [];
      const flush = (): void => {
        if (line.length >= 4) out.push({ cls: cls!, ...withBox(line), ...(bridge ? { bridge: true } : {}) });
        line = [];
      };
      for (let i = 0; i < geom.length; ) {
        const cmd = geom[i] & 7;
        const count = geom[i] >> 3;
        i++;
        if (cmd === 7) continue;
        if (cmd === 1) flush();
        for (let j = 0; j < count && i + 1 < geom.length; j++, i += 2) {
          cx += (geom[i] >> 1) ^ -(geom[i] & 1);
          cy += (geom[i + 1] >> 1) ^ -(geom[i + 1] & 1);
          line.push(...toLatLng(cx, cy));
        }
      }
      flush();
    }
    linesOut = out;
    if (!whole) break;
  }
  return { lines: linesOut, coast: coastOut, roads: roadsOut, stations: stationsOut, green: greenOut, water: waterOut, waterways: waterwaysOut };
}

/**
 * water 圖層裡 class=ocean 的多邊形 → 海岸線：每一圈的每一段，兩端都在圖磚同一邊的外面（含邊上）的，
 * 是圖磚邊上切開的（或整段在旁邊那張的緩衝區裡），斷開；其他的畫（跨過圖磚邊的那一段兩張都畫，接得起來）
 */
function oceanEdges(features: Pbf[], keys: string[], values: Array<string | null>, extent: number, toLatLng: (cx: number, cy: number) => [number, number]): CoastLine[] {
  const out: CoastLine[] = [];
  const outSameSide = (a: [number, number], b: [number, number]): boolean =>
    (a[0] <= 0 && b[0] <= 0) || (a[0] >= extent && b[0] >= extent) || (a[1] <= 0 && b[1] <= 0) || (a[1] >= extent && b[1] >= extent);
  for (const f of features) {
    let tags: number[] = [];
    let type = 0;
    let geom: number[] = [];
    while (f.more()) {
      const k = f.varint();
      const field = k >> 3;
      if (field === 2) tags = f.packed();
      else if (field === 3) type = f.varint();
      else if (field === 4) geom = f.packed();
      else f.skip(k & 7);
    }
    if (type !== 3) continue;
    let ocean = false;
    for (let i = 0; i + 1 < tags.length; i += 2) if (keys[tags[i]] === 'class' && values[tags[i + 1]] === 'ocean') ocean = true;
    if (!ocean) continue;
    // 先拆成一圈一圈（圖磚座標），ClosePath 補回第一點
    const rings: Array<Array<[number, number]>> = [];
    let ring: Array<[number, number]> = [];
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < geom.length; ) {
      const cmd = geom[i] & 7;
      const count = geom[i] >> 3;
      i++;
      if (cmd === 7) {
        if (ring.length > 1) ring.push(ring[0]);
        continue;
      }
      if (cmd === 1) {
        if (ring.length > 1) rings.push(ring);
        ring = [];
      }
      for (let j = 0; j < count && i + 1 < geom.length; j++, i += 2) {
        cx += (geom[i] >> 1) ^ -(geom[i] & 1);
        cy += (geom[i + 1] >> 1) ^ -(geom[i + 1] & 1);
        ring.push([cx, cy]);
      }
    }
    if (ring.length > 1) rings.push(ring);
    for (const r of rings) {
      let line: number[] = [];
      const flush = (): void => {
        if (line.length >= 4) out.push(withBox(line));
        line = [];
      };
      for (let i = 0; i + 1 < r.length; i++) {
        const [a, b] = [r[i], r[i + 1]];
        if (outSameSide(a, b)) {
          flush();
          continue;
        }
        if (line.length === 0) line.push(...toLatLng(a[0], a[1]));
        line.push(...toLatLng(b[0], b[1]));
      }
      flush();
    }
  }
  return out;
}

/** 經緯度 → 第幾張圖磚 */
export function tileOf(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  };
}

let template: Promise<string | null> | null = null;
/** 圖磚網址每週換版本，先讀 TileJSON；讀不到下次再試 */
function tileTemplate(): Promise<string | null> {
  template ??= fetch(TILEJSON)
    .then((r) => (r.ok ? (r.json() as Promise<{ tiles?: string[] }>) : null))
    .then((j) => j?.tiles?.[0] ?? null)
    .catch(() => null)
    .then((t) => {
      if (!t) template = null;
      return t;
    });
  return template;
}

type TileData = { lines: StreetLine[]; coast: CoastLine[]; roads: RoadName[]; stations: StationName[]; green: GreenArea[]; water: GreenArea[]; waterways: WaterLine[] };
const tiles = new Map<string, TileData | 'loading'>();

/**
 * 涵蓋 (lat, lng) 方圓 km 的道路（範圍 rangeKm 決定用哪一級圖磚）：已經抓到的圖磚先畫，還沒抓的去抓，抓到了呼叫 onLoad 重畫。
 * 抓失敗的不記住（下次重畫再試）
 */
export function streetsAround(lat: number, lng: number, km: number, rangeKm: number, onLoad: () => void): StreetLine[] {
  return streetTiles(lat, lng, km, rangeKm, onLoad).lines;
}

/**
 * 跟 streetsAround 一樣，多回傳還有幾張圖磚沒抓到（汪星等全部抓到才換掉原本的道路），
 * 和海岸線（16 km 內那兩級才有；再大用 taiwan.ts、world.ts 的海岸線）
 */
/** 抓到的一張圖磚（v1.720 雷達一張一張畫好留著）：key 是「z/x/y」，box 是範圍 [南, 西, 北, 東] */
export interface LoadedTile extends TileData {
  key: string;
  box: [number, number, number, number];
}

/** 圖磚的經緯度範圍 [南, 西, 北, 東] */
export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const lat = (yy: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI;
  return [lat(y + 1), (x / n) * 360 - 180, lat(y), ((x + 1) / n) * 360 - 180];
}

export function streetTiles(
  lat: number,
  lng: number,
  km: number,
  rangeKm: number,
  onLoad: () => void,
): { lines: StreetLine[]; coast: CoastLine[]; roads: RoadName[]; stations: StationName[]; green: GreenArea[]; pending: number; tiles: LoadedTile[] } {
  // 河、湖跟綠地一起讀（green 那幾級）
  const tier = tierOf(rangeKm);
  const { classes, regional, coast, names, stations, green } = tier;
  const dLat = km / 110.574;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  let [s, w, n, e] = [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
  // 拉遠：畫面碰到的那個地方（台灣、荷蘭…），只抓它範圍裡的圖磚；碰到好幾個的用雷達中心所在的那個（都不在就用前面的）；都沒碰到就不畫
  const hits = regional ? REGIONS.filter((r) => !(n < r.box.s || s > r.box.n || e < r.box.w || w > r.box.e)) : [];
  const region = hits.find((r) => r.has(lat, lng)) ?? hits[0];
  if (regional && !region) return { lines: [], coast: [], roads: [], stations: [], green: [], pending: 0, tiles: [] };
  if (region) [s, w, n, e] = [Math.max(s, region.box.s), Math.max(w, region.box.w), Math.min(n, region.box.n), Math.min(e, region.box.e)];
  const zoom = region?.far?.filter((f) => rangeKm > f.km).pop()?.zoom ?? tier.zoom;
  if (s > n || w > e) return { lines: [], coast: [], roads: [], stations: [], green: [], pending: 0, tiles: [] };
  const a = tileOf(n, w, zoom);
  const b = tileOf(s, e, zoom);
  const out: StreetLine[] = [];
  const coastOut: CoastLine[] = [];
  const roadsOut: RoadName[] = [];
  const stationsOut: StationName[] = [];
  const greenOut: GreenArea[] = [];
  const tileList: LoadedTile[] = [];
  let pending = 0;
  for (let x = a.x; x <= b.x; x++) {
    for (let y = a.y; y <= b.y; y++) {
      // 全是海的不抓（日本的圖磚一大半是海）
      if (region?.land) {
        const [ts, tw, tn, te] = tileBounds(zoom, x, y);
        if (!region.land.some((b) => !(tn < b.s || ts > b.n || te < b.w || tw > b.e))) continue;
      }
      const key = `${zoom}/${x}/${y}${region ? `@${region.id}` : ''}`;
      const got = tiles.get(key);
      if (got === 'loading') {
        pending++;
        continue;
      }
      if (got) {
        // 最近用到的放到最後，太多時從最前面刪
        tiles.delete(key);
        tiles.set(key, got);
        out.push(...got.lines);
        coastOut.push(...got.coast);
        roadsOut.push(...got.roads);
        stationsOut.push(...got.stations);
        greenOut.push(...got.green);
        tileList.push({ ...got, key, box: tileBounds(zoom, x, y) });
        continue;
      }
      tiles.set(key, 'loading');
      pending++;
      void tileTemplate()
        .then((t) => (t ? fetch(t.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y))) : null))
        .then((r) => (r?.ok ? r.arrayBuffer() : null))
        .then((ab) => {
          if (!ab) throw new Error('no tile');
          const got = decodeTile(new Uint8Array(ab), x, y, zoom, classes, !!coast, { roads: names, stations, green });
          const data: TileData = { lines: got.lines, coast: got.coast, roads: got.roads, stations: got.stations, green: got.green, water: got.water, waterways: got.waterways };
          tiles.set(key, region ? region.keep(data) : data);
          while (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value as string);
          onLoad();
        })
        .catch(() => tiles.delete(key));
    }
  }
  return { lines: out, coast: coastOut, roads: roadsOut, stations: stationsOut, green: greenOut, pending, tiles: tileList };
}
