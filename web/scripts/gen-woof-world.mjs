/**
 * 產生整顆汪星的 3D 資料（v1.825 使用者說把整個汪星補完 3D、山要有真的地形）：汪星的陸地就是台北市，
 * 切成 CELL 公尺一塊放在 web/public/woof3d/c/（3D 走到哪載到哪），web/public/woof3d/index.json 放整顆的總覽。
 * 來源：
 * - 房子、馬路、河湖、草地樹林：雷達同一套 OpenFreeMap 圖磚（OpenMapTiles 格式，© OpenStreetMap contributors），z14，市界裡面的
 *   （房子照中心、馬路一段段照中點、水面綠地切在每一塊的邊上）；收哪些、怎麼編碼跟以前的 gen-woof-city.mjs 一樣
 * - 地形：AWS Terrain Tiles（Terrarium PNG，z13，約 17 公尺一格，公開資料），每一塊 T_STEP 公尺一點；市界外面是汪星的海（SEA）。
 *   這份高度在市區會把高樓也算一點進去（衛星量的），平地照 SMOOTH_BELOW 公尺以下另外抹平
 * 座標：跟 park3d.ts 一樣的原點 O，往東、往北的公尺；形狀 ×Q（整數），第一點寫實際值、之後寫跟前一點的差。
 * 用法：node web/scripts/gen-woof-world.mjs（圖磚抓過的放在 web/scripts/.tiles，每秒最多抓一張）
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const here = path.dirname(new URL(import.meta.url).pathname);
const CACHE = path.join(here, '.tiles');
const OUT = path.join(here, '../public/woof3d');
const Z = 14;
const TZ = 13;
const O = [25.0394, 121.5596];
const MY = 110_574;
const MX = 111_320 * Math.cos((O[0] * Math.PI) / 180);
/** 座標的單位：每公尺幾格 */
const Q = 2;
/** 一塊多大（公尺）、地形幾公尺一點、總覽的地形幾公尺一點 */
const CELL = 1000;
const T_STEP = 20;
const T_N = CELL / T_STEP + 1;
const COARSE = 100;
/** 地形：海（市界外面）記成這個 */
const SEA = -32768;
/** 平地（這個高度以下）抹平：衛星量的高度在市區會被高樓墊高 */
const SMOOTH_BELOW = 30;

const en = (lat, lng) => [(lng - O[1]) * MX, (lat - O[0]) * MY];
const ll = (x, y) => [O[0] + y / MY, O[1] + x / MX];
const tileX = (lng, z = Z) => Math.floor(((lng + 180) / 360) * 2 ** z);
const tileY = (lat, z = Z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const lngOf = (x, z = Z) => (x / 2 ** z) * 360 - 180;
const latOf = (y, z = Z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 市界（web/src/taipei.ts 的 TAIPEI_OUTLINE）
const taipeiSrc = fs.readFileSync(path.join(here, '../src/taipei.ts'), 'utf8');
const OUTLINE_LL = JSON.parse(/export const TAIPEI_OUTLINE: Array<\[number, number\]> = (\[\[.*?\]\]);/.exec(taipeiSrc)[1]);
const OUTLINE = OUTLINE_LL.map(([la, ln]) => en(la, ln));
const OB = OUTLINE.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
function inOutline(x, y) {
  if (x < OB[0] || x > OB[2] || y < OB[1] || y > OB[3]) return false;
  let c = false;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [xi, yi] = OUTLINE[i];
    const [xj, yj] = OUTLINE[j];
    if (yi > y !== yj > y && x < xi + ((y - yi) * (xj - xi)) / (yj - yi)) c = !c;
  }
  return c;
}

async function cached(file, url) {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, file);
  if (!fs.existsSync(f)) {
    const res = await fetch(url, { headers: { 'user-agent': 'CurrentRadar woof3d generator (https://current-radar.pages.dev)' } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
    await sleep(1100);
  }
  return fs.readFileSync(f);
}

// ---- PNG（Terrarium：8 位元 RGB 或 RGBA，不交錯）
function decodePng(buf) {
  let p = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ct = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (ct !== 2 && ct !== 6)) throw new Error('unsupported png');
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const [pa, pb, pc] = [Math.abs(pp - a), Math.abs(pp - b), Math.abs(pp - c)];
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}

// ---- 向量圖磚（跟 gen-woof-city.mjs 一樣）
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

/** 圈切在方框裡（Q 格；Sutherland–Hodgman） */
function clipBox(ring, [x0, y0, x1, y1]) {
  const ins = [(p) => p[0] >= x0, (p) => p[0] <= x1, (p) => p[1] >= y0, (p) => p[1] <= y1];
  const cut = [
    (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])],
    (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])],
    (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0],
    (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1],
  ];
  let pts = ring;
  for (let k = 0; k < 4 && pts.length; k++) {
    const res = [];
    for (let i = 0; i < pts.length; i++) {
      const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
      const [ia, ib] = [ins[k](a), ins[k](b)];
      if (ia) res.push(a);
      if (ia !== ib) res.push(cut[k](a, b));
    }
    pts = res;
  }
  return pts.map(([x, y]) => [Math.round(x), Math.round(y)]);
}
/** 線、圈簡化（Douglas–Peucker，tol 是同樣的單位） */
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [a, b] = [pts[s], pts[e]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let [best, bi] = [0, -1];
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / len;
      if (d > best) [best, bi] = [d, i];
    }
    if (best > tol && bi > 0) {
      keep[bi] = 1;
      stack.push([s, bi], [bi, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
const ringArea = (r) => {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [a, b] = [r[i], r[(i + 1) % r.length]];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s / 2);
};

// ---- 地形：Terrarium z13，整個市界的範圍（每塊的邊上的點兩塊共用，接得起來）
const LB = OUTLINE_LL.reduce((b, [la, ln]) => [Math.min(b[0], la), Math.min(b[1], ln), Math.max(b[2], la), Math.max(b[3], ln)], [Infinity, Infinity, -Infinity, -Infinity]);
const TT = new Map();
for (let x = tileX(LB[1] - 0.01, TZ); x <= tileX(LB[3] + 0.01, TZ); x++)
  for (let y = tileY(LB[2] + 0.01, TZ); y <= tileY(LB[0] - 0.01, TZ); y++)
    TT.set(`${x},${y}`, decodePng(await cached(`t${TZ}-${x}-${y}.png`, `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TZ}/${x}/${y}.png`)));
const pixel = (gx, gy) => {
  const [tx, ty] = [Math.floor(gx / 256), Math.floor(gy / 256)];
  const t = TT.get(`${tx},${ty}`);
  if (!t) return 0;
  const i = ((gy - ty * 256) * t.w + (gx - tx * 256)) * t.bpp;
  return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
};
function elevation(lat, lng) {
  const n = 2 ** TZ * 256;
  const r = (lat * Math.PI) / 180;
  const gx = ((lng + 180) / 360) * n - 0.5;
  const gy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n - 0.5;
  const [x0, y0] = [Math.floor(gx), Math.floor(gy)];
  const [fx, fy] = [gx - x0, gy - y0];
  return (pixel(x0, y0) * (1 - fx) + pixel(x0 + 1, y0) * fx) * (1 - fy) + (pixel(x0, y0 + 1) * (1 - fx) + pixel(x0 + 1, y0 + 1) * fx) * fy;
}
const GX0 = Math.floor(OB[0] / CELL) * CELL;
const GY0 = Math.floor(OB[1] / CELL) * CELL;
const NCX = Math.ceil(OB[2] / CELL) - GX0 / CELL;
const NCY = Math.ceil(OB[3] / CELL) - GY0 / CELL;
const GNX = NCX * (T_N - 1) + 1;
const GNY = NCY * (T_N - 1) + 1;
const raw = new Float32Array(GNX * GNY);
for (let r = 0; r < GNY; r++)
  for (let c = 0; c < GNX; c++) {
    const [la, ln] = ll(GX0 + c * T_STEP, GY0 + r * T_STEP);
    raw[r * GNX + c] = elevation(la, ln);
  }
// 平地抹平：三次方框模糊（約 120 公尺），SMOOTH_BELOW 以下用模糊的、往上 30 公尺內慢慢換回原本的
const blur = Float32Array.from(raw);
const tmp = new Float32Array(raw.length);
const RAD = 6;
for (let pass = 0; pass < 3; pass++) {
  for (let r = 0; r < GNY; r++) {
    let s = 0;
    for (let c = -RAD; c <= RAD; c++) s += blur[r * GNX + Math.min(GNX - 1, Math.max(0, c))];
    for (let c = 0; c < GNX; c++) {
      tmp[r * GNX + c] = s / (2 * RAD + 1);
      s += blur[r * GNX + Math.min(GNX - 1, c + RAD + 1)] - blur[r * GNX + Math.max(0, c - RAD)];
    }
  }
  for (let c = 0; c < GNX; c++) {
    let s = 0;
    for (let r = -RAD; r <= RAD; r++) s += tmp[Math.min(GNY - 1, Math.max(0, r)) * GNX + c];
    for (let r = 0; r < GNY; r++) {
      blur[r * GNX + c] = s / (2 * RAD + 1);
      s += tmp[Math.min(GNY - 1, r + RAD + 1) * GNX + c] - tmp[Math.max(0, r - RAD) * GNX + c];
    }
  }
}
const height = new Int16Array(GNX * GNY);
for (let r = 0; r < GNY; r++) {
  // 市界：這一列跟市界的交點，兩兩之間是陸地
  const y = GY0 + r * T_STEP;
  const xs = [];
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [xi, yi] = OUTLINE[i];
    const [xj, yj] = OUTLINE[j];
    if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
  }
  xs.sort((a, b) => a - b);
  for (let c = 0; c < GNX; c++) {
    const x = GX0 + c * T_STEP;
    let land = false;
    for (let k = 0; k + 1 < xs.length; k += 2) if (x >= xs[k] && x <= xs[k + 1]) land = true;
    const i = r * GNX + c;
    const w = Math.max(0, Math.min(1, (raw[i] - SMOOTH_BELOW) / 30));
    height[i] = land ? Math.round(Math.max(0, raw[i] * w + blur[i] * (1 - w)) * 10) : SEA;
  }
}
const hAt = (x, y) => {
  const [c, r] = [(x - GX0) / T_STEP, (y - GY0) / T_STEP];
  const [c0, r0] = [Math.max(0, Math.min(GNX - 2, Math.floor(c))), Math.max(0, Math.min(GNY - 2, Math.floor(r)))];
  const v = [height[r0 * GNX + c0], height[r0 * GNX + c0 + 1], height[(r0 + 1) * GNX + c0], height[(r0 + 1) * GNX + c0 + 1]];
  if (v.some((x) => x === SEA)) return null;
  const [fx, fy] = [c - c0, r - r0];
  return ((v[0] * (1 - fx) + v[1] * fx) * (1 - fy) + (v[2] * (1 - fx) + v[3] * fx) * fy) / 10;
};

// ---- 房子、馬路、水面、綠地：照一塊塊分好
const cells = new Map();
const cellOf = (x, y) => {
  const key = `${Math.floor(x / CELL)}_${Math.floor(y / CELL)}`;
  let c = cells.get(key);
  if (!c) cells.set(key, (c = { b: [], r: [], w: [], g: [] }));
  return c;
};
const overviewRoads = [];
const overviewWater = [];
const ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'pedestrian']);
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const tileUrl = tj.tiles[0];
const counts = { tiles: 0, buildings: 0, roads: 0 };
for (let x = tileX(LB[1]); x <= tileX(LB[3]); x++)
  for (let y = tileY(LB[2]); y <= tileY(LB[0]); y++) {
    let buf = await cached(`${Z}-${x}-${y}.pbf`, tileUrl.replace('{z}', Z).replace('{x}', x).replace('{y}', y));
    if (buf[0] === 0x1f) buf = zlib.gunzipSync(buf);
    counts.tiles++;
    const L = decode(buf, ['building', 'transportation', 'water', 'landcover']);
    const conv = toEN(x, y);
    for (const f of L.building ?? []) {
      if (f.props.hide_3d || (f.props.render_min_height ?? 0) > 0) continue;
      const rh = Number(f.props.render_height ?? 5);
      const h = rh === 5 ? 0 : Math.max(2, Math.round(rh));
      for (const poly of polygons(f.parts)) {
        const rings = poly.map((r) => tidy(clipRing(r).map(conv), true)).filter((r) => r.length >= 3);
        if (!rings.length) continue;
        const cx = rings[0].reduce((s, p) => s + p[0], 0) / rings[0].length / Q;
        const cy = rings[0].reduce((s, p) => s + p[1], 0) / rings[0].length / Q;
        if (!inOutline(cx, cy)) continue;
        cellOf(cx, cy).b.push(`${h}:${rings.map(enc).join('/')}`);
        counts.buildings++;
      }
    }
    for (const f of L.transportation ?? []) {
      const cls = f.props.class;
      if (!ROAD_CLASSES.has(cls) || f.type !== 2 || f.props.brunnel === 'tunnel' || f.props.brunnel === 'bridge') continue;
      for (const part of f.parts)
        for (const l of clipLine(part)) {
          const pts = tidy(l.map(conv), false);
          if (pts.length < 2) continue;
          // 一段段照中點分到一塊塊（市界外面的不要）
          let run = null;
          let runKey = '';
          const flush = () => {
            if (run && run.length > 1) {
              const [i, j] = runKey.split('_').map(Number);
              cellOf(i * CELL + 1, j * CELL + 1).r.push(`${cls}:${enc(run)}`);
              counts.roads++;
              if (MAJOR.has(cls)) overviewRoads.push(`${cls}:${enc(dp(run.map(([px, py]) => [Math.round(px / Q), Math.round(py / Q)]), 3))}`);
            }
            run = null;
          };
          for (let k = 1; k < pts.length; k++) {
            const [mx, my] = [(pts[k - 1][0] + pts[k][0]) / 2 / Q, (pts[k - 1][1] + pts[k][1]) / 2 / Q];
            if (!inOutline(mx, my)) {
              flush();
              continue;
            }
            const key = `${Math.floor(mx / CELL)}_${Math.floor(my / CELL)}`;
            if (!run || key !== runKey) {
              flush();
              run = [pts[k - 1]];
              runKey = key;
            }
            run.push(pts[k]);
          }
          flush();
        }
    }
    for (const [layer, kind] of [
      ['water', 'w'],
      ['landcover', 'g'],
    ])
      for (const f of L[layer] ?? []) {
        if (layer === 'water' && f.props.brunnel === 'tunnel') continue;
        if (layer === 'landcover' && !['grass', 'wood'].includes(f.props.class)) continue;
        for (const poly of polygons(f.parts)) {
          const rings = poly.map((r) => tidy(clipRing(r).map(conv), true)).filter((r) => r.length >= 3);
          if (!rings.length) continue;
          const xs = rings[0].map((p) => p[0] / Q);
          const ys = rings[0].map((p) => p[1] / Q);
          if (kind === 'w' && ringArea(rings[0]) / Q / Q > 5000) overviewWater.push(rings.map((r) => enc(dp(r.map(([px, py]) => [Math.round(px / Q), Math.round(py / Q)]), 4))).join('/'));
          for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++)
            for (let j = Math.floor(Math.min(...ys) / CELL); j <= Math.floor(Math.max(...ys) / CELL); j++) {
              const box = [i * CELL * Q, j * CELL * Q, (i + 1) * CELL * Q, (j + 1) * CELL * Q];
              // 外圈切完還在這一塊才收，洞跟著切
              const outer = tidy(clipBox(rings[0], box), true);
              if (outer.length < 3) continue;
              const holes = rings.slice(1).map((r) => tidy(clipBox(r, box), true)).filter((r) => r.length >= 3);
              cellOf(i * CELL + 1, j * CELL + 1)[kind].push([outer, ...holes].map(enc).join('/'));
            }
        }
      }
  }

// ---- 寫出來：每一塊（有陸地的才寫）一個檔、總覽 index.json
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'c'), { recursive: true });
const keys = [];
let bytes = 0;
for (let ci = 0; ci < NCX; ci++)
  for (let cj = 0; cj < NCY; cj++) {
    const t = new Int16Array(T_N * T_N);
    let land = false;
    for (let r = 0; r < T_N; r++)
      for (let c = 0; c < T_N; c++) {
        const v = height[(cj * (T_N - 1) + r) * GNX + ci * (T_N - 1) + c];
        t[r * T_N + c] = v;
        if (v !== SEA) land = true;
      }
    if (!land) continue;
    const key = `${GX0 / CELL + ci}_${GY0 / CELL + cj}`;
    const f = cells.get(key) ?? { b: [], r: [], w: [], g: [] };
    const body = JSON.stringify({ b: f.b.join(';'), r: f.r.join(';'), w: f.w.join(';'), g: f.g.join(';'), t: Buffer.from(t.buffer).toString('base64') });
    fs.writeFileSync(path.join(OUT, 'c', `${key}.json`), body);
    bytes += zlib.gzipSync(body).length;
    keys.push(key);
  }
const coarse = new Int16Array(Math.ceil(GNX / 5) * Math.ceil(GNY / 5));
const [cnx, cny] = [Math.ceil(GNX / 5), Math.ceil(GNY / 5)];
for (let r = 0; r < cny; r++) for (let c = 0; c < cnx; c++) coarse[r * cnx + c] = height[Math.min(GNY - 1, r * 5) * GNX + Math.min(GNX - 1, c * 5)];
const ref = hAt(0, 0);
const index = {
  v: 1,
  q: Q,
  cell: CELL,
  tStep: T_STEP,
  tN: T_N,
  sea: SEA,
  ref,
  cells: keys,
  outline: enc(dp(OUTLINE.map(([x, y]) => [Math.round(x), Math.round(y)]), 2)),
  coarse: { x0: GX0, y0: GY0, step: COARSE, nx: cnx, ny: cny, data: Buffer.from(coarse.buffer).toString('base64') },
  roads: overviewRoads.join(';'),
  water: overviewWater.join(';'),
};
const indexBody = JSON.stringify(index);
fs.writeFileSync(path.join(OUT, 'index.json'), indexBody);
console.log({ ...counts, cells: keys.length, cellsGzip: bytes, indexBytes: indexBody.length, indexGzip: zlib.gzipSync(indexBody).length, ref, peak: height.reduce((m, v) => Math.max(m, v), -Infinity) / 10 });
