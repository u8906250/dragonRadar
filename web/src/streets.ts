/**
 * 雷達放大（2 km 內）時畫的街道：OpenFreeMap 的向量圖磚（OpenMapTiles 格式，資料來自 OpenStreetMap），
 * 只取 transportation 圖層的道路（不含隧道、步道、服務道路、鐵路），第一次用到才載入。
 * 圖磚是 Mapbox Vector Tile（protobuf），這裡只解讀用得到的欄位，不另外加函式庫。
 */

/** 大路（快速道路、主要幹道）畫粗一點，其他街道、巷弄畫細 */
export type StreetClass = 'major' | 'minor';

/** 一條街：pts 是 [緯度, 經度, 緯度, 經度, …]；box 是 [最小緯度, 最小經度, 最大緯度, 最大經度] */
export interface StreetLine {
  cls: StreetClass;
  pts: Float64Array;
  box: [number, number, number, number];
}

/** OpenMapTiles 的道路種類 → 畫法；沒列的（service、track、path、rail、ferry…）不畫 */
const CLASS_OF: Record<string, StreetClass> = {
  motorway: 'major',
  trunk: 'major',
  primary: 'major',
  secondary: 'major',
  tertiary: 'minor',
  minor: 'minor',
};

/**
 * 用 z13 的圖磚（一張約 4.4 km 寬，1 km 範圍通常一兩張）：大街小巷都有，座標精度約 1 m；
 * z14 多了建築、門牌、店家，市區一張壓縮後就六百多 KB，用不到
 */
export const STREET_ZOOM = 13;
const TILEJSON = 'https://tiles.openfreemap.org/planet';
/** 最多記住幾張圖磚（拖來拖去不要一直重抓） */
const MAX_TILES = 64;

/** protobuf 讀取：只需要 varint 和長度前綴 */
class Pbf {
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

/** 圖磚裡的 transportation 圖層 → 要畫的街道（座標換成經緯度） */
export function decodeStreets(buf: Uint8Array, x: number, y: number, z: number): StreetLine[] {
  const tile = new Pbf(buf);
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
    if (name !== 'transportation') continue;
    const out: StreetLine[] = [];
    const n = 2 ** z;
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
      for (let i = 0; i + 1 < tags.length; i += 2) {
        const tk = keys[tags[i]];
        const tv = values[tags[i + 1]];
        if (tk === 'class' && tv) cls = CLASS_OF[tv];
        else if (tk === 'brunnel' && tv === 'tunnel') tunnel = true;
      }
      // 地下道、隧道在地面上看不到，不畫
      if (!cls || tunnel) continue;
      // 幾何指令：MoveTo(1)、LineTo(2) 後面跟 zigzag 編碼的位移；一個 feature 可以有好幾段線
      let cx = 0;
      let cy = 0;
      let line: number[] = [];
      const flush = (): void => {
        if (line.length >= 4) {
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
          out.push({ cls: cls!, pts, box: [minLat, minLng, maxLat, maxLng] });
        }
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
          const wx = (x + cx / extent) / n;
          const wy = (y + cy / extent) / n;
          line.push((Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180) / Math.PI, wx * 360 - 180);
        }
      }
      flush();
    }
    return out;
  }
  return [];
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

const tiles = new Map<string, StreetLine[] | 'loading'>();

/**
 * 涵蓋 (lat, lng) 方圓 km 的街道：已經抓到的圖磚先畫，還沒抓的去抓，抓到了呼叫 onLoad 重畫。
 * 抓失敗的不記住（下次重畫再試）
 */
export function streetsAround(lat: number, lng: number, km: number, onLoad: () => void): StreetLine[] {
  const dLat = km / 110.574;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const a = tileOf(lat + dLat, lng - dLng, STREET_ZOOM);
  const b = tileOf(lat - dLat, lng + dLng, STREET_ZOOM);
  const out: StreetLine[] = [];
  for (let x = a.x; x <= b.x; x++) {
    for (let y = a.y; y <= b.y; y++) {
      const key = `${x}/${y}`;
      const got = tiles.get(key);
      if (got === 'loading') continue;
      if (got) {
        // 最近用到的放到最後，太多時從最前面刪
        tiles.delete(key);
        tiles.set(key, got);
        out.push(...got);
        continue;
      }
      tiles.set(key, 'loading');
      void tileTemplate()
        .then((t) => (t ? fetch(t.replace('{z}', String(STREET_ZOOM)).replace('{x}', String(x)).replace('{y}', String(y))) : null))
        .then((r) => (r?.ok ? r.arrayBuffer() : null))
        .then((ab) => {
          if (!ab) throw new Error('no tile');
          tiles.set(key, decodeStreets(new Uint8Array(ab), x, y, STREET_ZOOM));
          while (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value as string);
          onLoad();
        })
        .catch(() => tiles.delete(key));
    }
  }
  return out;
}
