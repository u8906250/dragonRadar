/**
 * 雷達上的道路（範圍到全台）：OpenFreeMap 的向量圖磚（OpenMapTiles 格式，資料來自 OpenStreetMap），
 * 只取 transportation 圖層的道路（不含隧道、步道、服務道路、鐵路），第一次用到才載入。
 * 範圍越大用越粗一級的圖磚（OpenMapTiles 已經簡化過，越粗的只留越大的路），畫的路也越少。
 * 圖磚是 Mapbox Vector Tile（protobuf），這裡只解讀用得到的欄位，不另外加函式庫。
 */

import { TAIWAN_RINGS } from './taiwan';

/** 粗線、細線 */
export type StreetClass = 'major' | 'minor';

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
 * 再大（到全台）都用 z7（z6 只剩國道、快速道路，東部的台 9 線沒有）：taiwan 只畫台灣（本島、離島）的路、
 * 只抓台灣那六張圖磚（共約 460 KB；全台的範圍對岸也在圈內）
 */
export const STREET_TIERS: Array<{ maxKm: number; zoom: number; classes: Classes; taiwan?: boolean; coast?: boolean }> = [
  { maxKm: 2, zoom: 13, classes: { motorway: 'major', trunk: 'major', primary: 'major', secondary: 'major', tertiary: 'minor', minor: 'minor' }, coast: true },
  // 市區的幹道台北多半標 secondary，其他縣市很多標 tertiary（新竹 8 km 內 secondary 約 90 km、tertiary 約 400 km）：都畫，各地一樣細；
  // 16 km 內也是（z10 沒有 tertiary，所以用 z11，一張約 18 km 寬，最多九張）
  { maxKm: 16, zoom: 11, classes: { ...HIGHWAYS, primary: 'minor', secondary: 'minor', tertiary: 'minor' }, coast: true },
  { maxKm: 33, zoom: 9, classes: { ...HIGHWAYS, primary: 'minor' } },
  { maxKm: 65, zoom: 8, classes: { ...HIGHWAYS, primary: 'minor' } },
  { maxKm: Infinity, zoom: 7, classes: { ...HIGHWAYS, primary: 'minor' }, taiwan: true },
];
/** 台灣（含金門、馬祖、澎湖）的範圍：taiwan 那一級只抓這裡面的圖磚 */
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
const tierOf = (km: number): (typeof STREET_TIERS)[number] => STREET_TIERS.find((t) => km <= t.maxKm) ?? STREET_TIERS[STREET_TIERS.length - 1];
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
export function decodeTile(buf: Uint8Array, x: number, y: number, z: number, classes: Classes, coast: boolean): { lines: StreetLine[]; coast: CoastLine[] } {
  const tile = new Pbf(buf);
  const coastOut: CoastLine[] = [];
  // 圖層照字母排（transportation 在 water 前面）：要海岸線就讀完整張
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
        // Value：只要字串（field 1），數字的用不到
        const v = layer.sub();
        let s: string | null = null;
        while (v.more()) {
          const vk = v.varint();
          if (vk >> 3 === 1) s = v.string();
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
      coastOut.push(...oceanEdges(features, keys, values, extent, toLatLng));
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
      for (let i = 0; i + 1 < tags.length; i += 2) {
        const tk = keys[tags[i]];
        const tv = values[tags[i + 1]];
        if (tk === 'class' && tv) cls = classes[tv];
        else if (tk === 'brunnel' && tv === 'tunnel') tunnel = true;
        else if (tk === 'brunnel' && tv === 'bridge') bridge = true;
      }
      // 地下道、隧道在地面上看不到，不畫
      if (!cls || tunnel) continue;
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
    if (!coast) break;
  }
  return { lines: linesOut, coast: coastOut };
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

const tiles = new Map<string, { lines: StreetLine[]; coast: CoastLine[] } | 'loading'>();

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
export function streetTiles(lat: number, lng: number, km: number, rangeKm: number, onLoad: () => void): { lines: StreetLine[]; coast: CoastLine[]; pending: number } {
  const { zoom, classes, taiwan, coast } = tierOf(rangeKm);
  const dLat = km / 110.574;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  let [s, w, n, e] = [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
  if (taiwan) [s, w, n, e] = [Math.max(s, TAIWAN_BOX.s), Math.max(w, TAIWAN_BOX.w), Math.min(n, TAIWAN_BOX.n), Math.min(e, TAIWAN_BOX.e)];
  if (s > n || w > e) return { lines: [], coast: [], pending: 0 };
  const a = tileOf(n, w, zoom);
  const b = tileOf(s, e, zoom);
  const out: StreetLine[] = [];
  const coastOut: CoastLine[] = [];
  let pending = 0;
  for (let x = a.x; x <= b.x; x++) {
    for (let y = a.y; y <= b.y; y++) {
      const key = `${zoom}/${x}/${y}`;
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
        continue;
      }
      tiles.set(key, 'loading');
      pending++;
      void tileTemplate()
        .then((t) => (t ? fetch(t.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y))) : null))
        .then((r) => (r?.ok ? r.arrayBuffer() : null))
        .then((ab) => {
          if (!ab) throw new Error('no tile');
          const got = decodeTile(new Uint8Array(ab), x, y, zoom, classes, !!coast);
          tiles.set(key, { lines: taiwan ? got.lines.filter(onTaiwan) : got.lines, coast: got.coast });
          while (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value as string);
          onLoad();
        })
        .catch(() => tiles.delete(key));
    }
  }
  return { lines: out, coast: coastOut, pending };
}
