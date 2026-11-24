/**
 * 產生 web/src/woof-city-data.ts：汪星 3D（國館外面荒廢的街道，v1.812 使用者說汪星除了國館整個做成 3D）用的建築、馬路、河湖、公園。
 * 來源：雷達同一套 OpenFreeMap 圖磚（OpenMapTiles 格式，OpenStreetMap 資料）z14，國館附近 RADIUS_M 公尺內的 9 張。
 * - building：外框和 render_height（OSM 寫的高度、樓層數換算，沒寫的是 OpenMapTiles 給的預設值）；hide_3d（有分 building:part 的外框）
 *   和 render_min_height > 0（懸空的部分）不收
 * - transportation：馬路（class）；隧道、橋（高架）不收
 * - water：水面；landcover 的草地、樹林（公園、綠地，樹長得比較密）
 * 圖磚裡跨過圖磚邊的形狀切在圖磚的邊上（相鄰兩張接起來剛好不重疊）。
 * 座標：跟 park3d.ts 一樣的原點 O，往東、往北的公尺 ×Q（整數，半公尺；z14 圖磚本來就只到約 0.6 公尺），每個形狀第一點寫實際值、之後寫跟前一點的差。
 * 用法：node web/scripts/gen-woof-city.mjs（圖磚抓過的放在 web/scripts/.tiles，每秒最多抓一張）
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const here = path.dirname(new URL(import.meta.url).pathname);
const CACHE = path.join(here, '.tiles');
const OUT = path.join(here, '../src/woof-city-data.ts');
const Z = 14;
const O = [25.0394, 121.5596];
const MY = 110_574;
const MX = 111_320 * Math.cos((O[0] * Math.PI) / 180);
/** 收多遠以內（公尺）；走得到 2 公里，外面多收一圈看得到的 */
const RADIUS_M = 2300;
/** 座標的單位：每公尺幾格 */
const Q = 2;

const en = (lat, lng) => [(lng - O[1]) * MX, (lat - O[0]) * MY];
const tileX = (lng) => Math.floor(((lng + 180) / 360) * 2 ** Z);
const tileY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z);
};
const lngOf = (x) => (x / 2 ** Z) * 360 - 180;
const latOf = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** Z))) * 180) / Math.PI;

async function tiles() {
  fs.mkdirSync(CACHE, { recursive: true });
  const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
  const url = tj.tiles[0];
  const dLat = RADIUS_M / MY;
  const dLng = RADIUS_M / MX;
  const out = [];
  for (let x = tileX(O[1] - dLng); x <= tileX(O[1] + dLng); x++)
    for (let y = tileY(O[0] + dLat); y <= tileY(O[0] - dLat); y++) {
      const f = path.join(CACHE, `${Z}-${x}-${y}.pbf`);
      if (!fs.existsSync(f)) {
        const res = await fetch(url.replace('{z}', Z).replace('{x}', x).replace('{y}', y));
        if (!res.ok) throw new Error(`tile ${x},${y}: HTTP ${res.status}`);
        fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
        await new Promise((r) => setTimeout(r, 1100));
      }
      let buf = fs.readFileSync(f);
      if (buf[0] === 0x1f) buf = zlib.gunzipSync(buf);
      out.push({ x, y, buf });
    }
  return out;
}

// ---- 向量圖磚（protobuf）
class Pbf {
  constructor(b, s = 0, e = b.length) {
    Object.assign(this, { b, p: s, e });
  }
  more() {
    return this.p < this.e;
  }
  v() {
    let v = 0;
    let m = 1;
    let x;
    do {
      x = this.b[this.p++];
      v += (x & 127) * m;
      m *= 128;
    } while (x & 128);
    return v;
  }
  sub() {
    const l = this.v();
    const r = new Pbf(this.b, this.p, this.p + l);
    this.p += l;
    return r;
  }
  str() {
    const r = this.sub();
    return this.b.subarray(r.p, r.e).toString();
  }
  skip(t) {
    if (t === 0) this.v();
    else if (t === 2) this.p += this.v();
    else if (t === 5) this.p += 4;
    else if (t === 1) this.p += 8;
  }
}
const zz = (n) => (n >>> 1) ^ -(n & 1);

/** 一張圖磚裡要的圖層：每個 feature 的屬性、幾何（圖磚座標的一段段） */
function decode(buf, want) {
  const t = new Pbf(buf);
  const layers = {};
  while (t.more()) {
    const k = t.v();
    if (k >> 3 !== 3 || (k & 7) !== 2) {
      t.skip(k & 7);
      continue;
    }
    const L = t.sub();
    let name;
    let extent = 4096;
    const feats = [];
    const keys = [];
    const vals = [];
    while (L.more()) {
      const q = L.v();
      const f = q >> 3;
      if (f === 1) name = L.str();
      else if (f === 2) feats.push(L.sub());
      else if (f === 3) keys.push(L.str());
      else if (f === 4) {
        const V = L.sub();
        let val = null;
        while (V.more()) {
          const w = V.v();
          const ff = w >> 3;
          if (ff === 1) val = V.str();
          else if (ff === 2) {
            val = V.b.readFloatLE(V.p);
            V.p += 4;
          } else if (ff === 3) {
            val = V.b.readDoubleLE(V.p);
            V.p += 8;
          } else if (ff === 4 || ff === 5) val = V.v();
          else if (ff === 6) val = zz(V.v());
          else if (ff === 7) val = !!V.v();
          else V.skip(w & 7);
        }
        vals.push(val);
      } else if (f === 5) extent = L.v();
      else L.skip(q & 7);
    }
    if (!want.includes(name)) continue;
    layers[name] = feats.map((F) => {
      const props = {};
      let type = 0;
      const parts = [];
      while (F.more()) {
        const q = F.v();
        const f = q >> 3;
        if (f === 2) {
          const r = F.sub();
          const tags = [];
          while (r.more()) tags.push(r.v());
          for (let i = 0; i < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]];
        } else if (f === 3) type = F.v();
        else if (f === 4) {
          const g = F.sub();
          let [x, y] = [0, 0];
          let cur = null;
          while (g.more()) {
            const c = g.v();
            const id = c & 7;
            const n = c >> 3;
            if (id === 7) {
              if (cur) cur.closed = true;
              continue;
            }
            for (let i = 0; i < n; i++) {
              x += zz(g.v());
              y += zz(g.v());
              if (id === 1) {
                cur = [];
                parts.push(cur);
              }
              cur.push([(x * 4096) / extent, (y * 4096) / extent]);
            }
          }
        } else F.skip(q & 7);
      }
      return { props, type, parts };
    });
  }
  return layers;
}

// ---- 切在圖磚的邊上（0～4096）
function clipRing(ring) {
  const edges = [
    (p) => p[0] >= 0,
    (p) => p[0] <= 4096,
    (p) => p[1] >= 0,
    (p) => p[1] <= 4096,
  ];
  const cut = [
    (a, b) => [0, a[1] + ((b[1] - a[1]) * (0 - a[0])) / (b[0] - a[0])],
    (a, b) => [4096, a[1] + ((b[1] - a[1]) * (4096 - a[0])) / (b[0] - a[0])],
    (a, b) => [a[0] + ((b[0] - a[0]) * (0 - a[1])) / (b[1] - a[1]), 0],
    (a, b) => [a[0] + ((b[0] - a[0]) * (4096 - a[1])) / (b[1] - a[1]), 4096],
  ];
  let pts = ring;
  for (let k = 0; k < 4 && pts.length; k++) {
    const res = [];
    for (let i = 0; i < pts.length; i++) {
      const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
      const [ia, ib] = [edges[k](a), edges[k](b)];
      if (ia) res.push(a);
      if (ia !== ib) res.push(cut[k](a, b));
    }
    pts = res;
  }
  return pts;
}
function clipLine(line) {
  const inB = (p) => p[0] >= 0 && p[0] <= 4096 && p[1] >= 0 && p[1] <= 4096;
  // 每一段照參數 t 切進方框（Liang–Barsky）
  const out = [];
  let cur = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i], line[i + 1]];
    let [t0, t1] = [0, 1];
    const d = [b[0] - a[0], b[1] - a[1]];
    let ok = true;
    for (const [p, q] of [
      [-d[0], a[0]],
      [d[0], 4096 - a[0]],
      [-d[1], a[1]],
      [d[1], 4096 - a[1]],
    ]) {
      if (p === 0) {
        if (q < 0) ok = false;
        continue;
      }
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
    if (!ok || t0 > t1) {
      if (cur.length > 1) out.push(cur);
      cur = [];
      continue;
    }
    const pa = [a[0] + d[0] * t0, a[1] + d[1] * t0];
    const pb = [a[0] + d[0] * t1, a[1] + d[1] * t1];
    if (!cur.length || t0 > 0) {
      if (cur.length > 1) out.push(cur);
      cur = [pa];
    }
    cur.push(pb);
    if (t1 < 1) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out.filter((l) => l.some(inB));
}
/** 圖磚座標的面積（MVT：外圈是正的、洞是負的） */
const area = (r) => {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [a, b] = [r[i], r[(i + 1) % r.length]];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};
/** 外圈、洞照順序分成一個個多邊形 */
function polygons(parts) {
  const out = [];
  for (const r of parts) {
    const ring = r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r;
    if (ring.length < 3) continue;
    const a = area(ring);
    if (a > 0) out.push([ring]);
    else if (a < 0 && out.length) out[out.length - 1].push(ring);
  }
  return out;
}

// ---- 換成公尺（×10 的整數）、拿掉幾乎在同一直線上的點、編碼
const toEN = (tx, ty) => (p) => {
  const [e, n] = en(latOf(ty + p[1] / 4096), lngOf(tx + p[0] / 4096));
  return [Math.round(e * Q), Math.round(n * Q)];
};
function tidy(pts, closed) {
  const out = [];
  for (const p of pts) if (!out.length || p[0] !== out[out.length - 1][0] || p[1] !== out[out.length - 1][1]) out.push(p);
  if (closed && out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  // 中間那點離前後連線不到 0.15 公尺就拿掉（Q 格）
  let changed = true;
  while (changed && out.length > (closed ? 3 : 2)) {
    changed = false;
    for (let i = closed ? 0 : 1; i < out.length - (closed ? 0 : 1) && out.length > (closed ? 3 : 2); i++) {
      const [a, b, c] = [out[(i - 1 + out.length) % out.length], out[i], out[(i + 1) % out.length]];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const d = len ? Math.abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / len : Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d < 0.15 * Q) {
        out.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return out;
}
const enc = (pts) => pts.map((p, i) => (i ? [p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]] : p)).flat().join(',');
const near = (pts) => pts.some(([x, y]) => Math.hypot(x, y) / Q < RADIUS_M);

const buildings = [];
const roads = [];
const waters = [];
const greens = [];
/** 馬路收哪幾種（OpenMapTiles 的 class） */
const ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'pedestrian']);
let skipped = { part: 0, hidden: 0, tunnel: 0, bridge: 0 };
for (const { x, y, buf } of await tiles()) {
  const L = decode(buf, ['building', 'transportation', 'water', 'landcover']);
  const conv = toEN(x, y);
  for (const f of L.building ?? []) {
    if (f.props.hide_3d) {
      skipped.hidden++;
      continue;
    }
    if ((f.props.render_min_height ?? 0) > 0) {
      skipped.part++;
      continue;
    }
    // OSM 沒寫高度、樓層的，OpenMapTiles 一律給 5 公尺：記成 0（不知道），3D 那邊照大小估
    const rh = Number(f.props.render_height ?? 5);
    const h = rh === 5 ? 0 : Math.max(2, Math.round(rh));
    for (const poly of polygons(f.parts)) {
      const rings = poly.map((r) => tidy(clipRing(r).map(conv), true)).filter((r) => r.length >= 3);
      if (!rings.length || !near(rings[0])) continue;
      buildings.push(`${h}:${rings.map(enc).join('/')}`);
    }
  }
  for (const f of L.transportation ?? []) {
    const cls = f.props.class;
    if (!ROAD_CLASSES.has(cls) || f.type !== 2) continue;
    if (f.props.brunnel === 'tunnel') {
      skipped.tunnel++;
      continue;
    }
    if (f.props.brunnel === 'bridge') {
      skipped.bridge++;
      continue;
    }
    for (const part of f.parts)
      for (const l of clipLine(part)) {
        const pts = tidy(l.map(conv), false);
        if (pts.length >= 2 && near(pts)) roads.push(`${cls}:${enc(pts)}`);
      }
  }
  for (const [layer, list] of [
    ['water', waters],
    ['landcover', greens],
  ])
    for (const f of L[layer] ?? []) {
      if (layer === 'water' && f.props.brunnel === 'tunnel') continue;
      if (layer === 'landcover' && !['grass', 'wood'].includes(f.props.class)) continue;
      for (const poly of polygons(f.parts)) {
        const rings = poly.map((r) => tidy(clipRing(r).map(conv), true)).filter((r) => r.length >= 3);
        if (rings.length && near(rings[0])) list.push(rings.map(enc).join('/'));
      }
    }
}

const head = `/**
 * 汪星 3D（國館外面荒廢的街道）用的資料，web/scripts/gen-woof-city.mjs 產生，不要手改。
 * 來源：OpenFreeMap 圖磚（© OpenMapTiles © OpenStreetMap contributors，ODbL），z14，國館附近 ${RADIUS_M} 公尺內。
 * 座標：跟 park3d.ts 一樣的原點（${O.join(', ')}），往東、往北的公尺 ×${Q}（WOOF_Q）；每個形狀第一點是實際值、之後是跟前一點的差。
 * - WOOF_BUILDINGS：「;」隔開每一棟：「高度（公尺）:外圈/洞/洞…」，高度是 OpenMapTiles 的 render_height（OSM 的高度、樓層數換算）；
 *   0 是 OSM 沒寫（OpenMapTiles 給預設的 5 公尺），3D 那邊照大小估
 * - WOOF_ROADS：「;」隔開每一段：「種類:線」（OpenMapTiles 的 class；隧道、高架、步道不收）
 * - WOOF_WATER、WOOF_GREEN（草地、樹林）：「;」隔開每一塊：「外圈/洞…」
 */
`;
const body =
  head +
  `export const WOOF_Q = ${Q};\n` +
  `export const WOOF_BUILDINGS = '${buildings.join(';')}';\n` +
  `export const WOOF_ROADS = '${roads.join(';')}';\n` +
  `export const WOOF_WATER = '${waters.join(';')}';\n` +
  `export const WOOF_GREEN = '${greens.join(';')}';\n`;
fs.writeFileSync(OUT, body);
console.log({ buildings: buildings.length, roads: roads.length, waters: waters.length, greens: greens.length, skipped, bytes: body.length, gzip: zlib.gzipSync(body).length });
