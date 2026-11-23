export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_KM = 6371;
const toRad = (d: number): number => (d * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 0 = 北，順時針到 360 */
export function bearingDeg(from: LatLng, to: LatLng): number {
  const p1 = toRad(from.lat);
  const p2 = toRad(to.lat);
  const dl = toRad(to.lng - from.lng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * 經緯度的線照地球表面簡化（Douglas-Peucker）：離頭尾那段大圓不到 tolKm 的點拿掉（頭尾留著，留下的都是原本的點）。
 * 用三維的單位向量算、不經過投影，跨換日線、橫跨整個大陸的線也照實際距離
 */
export function simplifyLatLng(pts: Array<[number, number]>, tolKm: number): Array<[number, number]> {
  const n = pts.length;
  if (n < 3) return pts;
  const v = unitVectors(pts);
  const tol = tolKm / EARTH_KM;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const [ax, ay, az, bx, by, bz] = [v[a * 3], v[a * 3 + 1], v[a * 3 + 2], v[b * 3], v[b * 3 + 1], v[b * 3 + 2]];
    // 頭尾那段大圓的法向量（離大圓多遠＝跟法向量的內積）；頭尾同一點（整圈）照離那一點的距離
    let [nx, ny, nz] = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) [nx, ny, nz] = [nx / len, ny / len, nz / len];
    let far = -1;
    let best = tol;
    for (let i = a + 1; i < b; i++) {
      const [x, y, z] = [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
      const d = len > 1e-12 ? Math.abs(x * nx + y * ny + z * nz) : Math.hypot(x - ax, y - ay, z - az);
      if (d > best) {
        best = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/** 經緯度換成單位向量（x、y、z 一點三個數），同一條線算很多次方位、距離時先換好記住（lookFrom） */
export function unitVectors(pts: Array<[number, number]>): Float64Array {
  const v = new Float64Array(pts.length * 3);
  pts.forEach(([lat, lng], i) => {
    const [p, l] = [toRad(lat), toRad(lng)];
    v[i * 3] = Math.cos(p) * Math.cos(l);
    v[i * 3 + 1] = Math.cos(p) * Math.sin(l);
    v[i * 3 + 2] = Math.sin(p);
  });
  return v;
}

/**
 * 從 from 看 unitVectors 換好的點：方位（同 bearingDeg）、距離（同 haversineKm）。
 * 先換成以 from 為中心的東、北、上，一點只要兩個 atan2（拖曳中每一格把整條海岸線重算一次用）
 */
export function lookFrom(from: LatLng): (v: Float64Array, i: number) => { bearing: number; distanceKm: number } {
  const [p, l] = [toRad(from.lat), toRad(from.lng)];
  const [sp, cp, sl, cl] = [Math.sin(p), Math.cos(p), Math.sin(l), Math.cos(l)];
  return (v, i) => {
    const [x, y, z] = [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
    const east = -sl * x + cl * y;
    const north = -sp * cl * x - sp * sl * y + cp * z;
    const up = cp * cl * x + cp * sl * y + sp * z;
    return { bearing: ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360, distanceKm: EARTH_KM * Math.atan2(Math.hypot(east, north), up) };
  };
}

/**
 * 一個地方拉遠時的地圖（netherlands.ts、japan.ts）：雷達加畫的海岸線或湖岸（coast）、界線（lines，跟台灣的縣市界一樣畫），
 * 全螢幕拉遠（33 km 以上）寫的大地名（far：省、都道府縣）和近一點寫的城市（near）
 */
export interface RegionMap {
  /** 陸地或湖（封閉的形狀，切開的地方沿著那一塊的邊走）：海岸線畫邊上以外的那幾段，全螢幕塗海整圈用 */
  coast: Array<Array<[number, number]>>;
  lines: Array<Array<[number, number]>>;
  /** 拉遠（33 km 以上）寫的大地名（省、縣、州） */
  far: Array<[string, number, number]>;
  /** 近一點寫的城市名：1 km 到 nearKm（沒寫是 33 km；美國的州很大，拉到 200 km 也寫城市，不然畫面上一個名字都沒有） */
  near: Array<[string, number, number]>;
  nearKm?: number;
}

/**
 * 解開差值編碼的線（eastasia.ts、netherlands.ts、japan.ts、korea.ts、usa-*.ts 和陸地範圍）：「;」隔開每一段，
 * 每段 [緯度×1000, 經度×1000, 之後每一點跟前一點的差…] → 一串 [緯度, 經度]；空字串是沒有線（夏威夷沒有州界）
 */
export function decodeRings(s: string): Array<Array<[number, number]>> {
  if (!s) return [];
  return s.split(';').map((seg) => {
    const v = seg.split(',').map(Number);
    const out: Array<[number, number]> = [];
    let lat = 0;
    let lng = 0;
    for (let i = 0; i + 1 < v.length; i += 2) {
      lat += v[i];
      lng += v[i + 1];
      out.push([lat / 1000, lng / 1000]);
    }
    return out;
  });
}

/** 經緯度的方框（南、西、北、東） */
export interface GeoBox {
  s: number;
  w: number;
  n: number;
  e: number;
}

/**
 * 切在方框邊上的封閉形狀（eastasia.ts、netherlands.ts、usa-*.ts 的陸地）→ 海岸線：兩端在同一條邊上的那幾段是切開的地方，不畫；
 * 整圈沒碰到邊的（島、湖）照舊。座標是千分之一度，邊上的點跟方框的數字剛好一樣
 */
export function cutAtBox(rings: Array<Array<[number, number]>>, b: GeoBox): Array<Array<[number, number]>> {
  return cutLines(rings, (p, q) => (p[0] === b.s && q[0] === b.s) || (p[0] === b.n && q[0] === b.n) || (p[1] === b.w && q[1] === b.w) || (p[1] === b.e && q[1] === b.e));
}

/** 封閉的形狀 → 海岸線：cut 說是切開的地方的那幾段不畫（cutAtBox；世界的陸地扣掉好幾塊方框時用 main.ts 的） */
export function cutLines(rings: Array<Array<[number, number]>>, cut: (p: [number, number], q: [number, number]) => boolean): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  for (const ring of rings) {
    const closed = ring.length > 2 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
    // 封閉的：不重複的點 m 個、m 段（最後一段接回第一點）；從切開的那一段後面開始走，線才不會從中間斷成兩條
    const m = closed ? ring.length - 1 : ring.length;
    const segs = closed ? m : m - 1;
    let start = 0;
    if (closed) {
      start = -1;
      for (let i = 0; i < m && start < 0; i++) if (cut(ring[i], ring[(i + 1) % m])) start = (i + 1) % m;
      if (start < 0) {
        out.push(ring);
        continue;
      }
    }
    let run: Array<[number, number]> = [];
    for (let k = 0; k < segs; k++) {
      const i = (start + k) % m;
      const [p, q] = [ring[i], ring[(i + 1) % m]];
      if (cut(p, q)) {
        if (run.length >= 2) out.push(run);
        run = [];
        continue;
      }
      if (run.length === 0) run.push(p);
      run.push(q);
    }
    if (run.length >= 2) out.push(run);
  }
  return out;
}

/** 一圈的經緯度範圍 [南, 西, 北, 東] */
export function ringBox(ring: Array<[number, number]>): [number, number, number, number] {
  let [s, w, n, e] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lat, lng] of ring) {
    if (lat < s) s = lat;
    if (lat > n) n = lat;
    if (lng < w) w = lng;
    if (lng > e) e = lng;
  }
  return [s, w, n, e];
}

/** 點在不在這一圈裡（經緯度當平面算；陸地的資料在換日線切開，不會跨過去） */
export function ringHas(ring: Array<[number, number]>, lat: number, lng: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ay, ax] = ring[i];
    const [by, bx] = ring[j];
    if (ay > lat !== by > lat && lng < ((bx - ax) * (lat - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** 一圈切到半平面裡（Sutherland–Hodgman）：k 是 0 緯度、1 經度，留 ≤ v（below）或 ≥ v 的那一邊；切開的地方沿著 v 那條線走 */
function clipHalf(ring: Array<[number, number]>, k: 0 | 1, v: number, below: boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const keep = (p: [number, number]): boolean => (below ? p[k] <= v : p[k] >= v);
  for (let i = 0; i < ring.length; i++) {
    const [p, q] = [ring[i], ring[(i + 1) % ring.length]];
    const [pin, qin] = [keep(p), keep(q)];
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = (v - p[k]) / (q[k] - p[k]);
      out.push(k === 0 ? [v, p[1] + t * (q[1] - p[1])] : [p[0] + t * (q[0] - p[0]), v]);
    }
  }
  return out;
}

/**
 * 跨過換日線的一圈（世界資料的俄羅斯東端、斐濟：經度從 180 跳到 -180）切成兩圈，各自在 -180～180 裡面、沿著換日線接起來：
 * 經緯度當平面算（扣掉方框、點在不在裡面、補點）才不會變成繞地球一圈的長條。沒跨過的原樣回傳；繞極地一圈的（南極洲）不切
 */
export function splitAntimeridian(ring: Array<[number, number]>): Array<Array<[number, number]>> {
  let off = 0;
  const un = ring.map(([lat, lng], i): [number, number] => {
    const d = i > 0 ? lng - ring[i - 1][1] : 0;
    if (d > 180) off -= 360;
    else if (d < -180) off += 360;
    return [lat, lng + off];
  });
  if (off !== 0) return [ring];
  const [, w, , e] = ringBox(un);
  if (w >= -180 && e <= 180) return [ring];
  // 換到 -180～180 外面的那一部分切下來移回來
  const [edge, shift] = e > 180 ? [180, -360] : [-180, 360];
  const parts = [clipHalf(un, 1, edge, e > 180), clipHalf(un, 1, edge, e <= 180).map(([lat, lng]): [number, number] => [lat, lng + shift])];
  return parts.filter((r) => r.length >= 3).map((r) => (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]]));
}

/**
 * 一圈扣掉方框裡面的部分（世界的陸地扣掉東亞、荷蘭、美國那幾塊，那裡面用它們自己比較細的陸地）：
 * 方框外面分成左、右、下、上四塊各切一次，切出來的形狀沿著方框的邊走，跟方框裡面的接得起來。沒碰到方框的原樣回傳
 */
export function outsideBox(ring: Array<[number, number]>, b: GeoBox): Array<Array<[number, number]>> {
  const [s, w, n, e] = ringBox(ring);
  if (n <= b.s || s >= b.n || e <= b.w || w >= b.e) return [ring];
  if (s >= b.s && n <= b.n && w >= b.w && e <= b.e) return [];
  const mid = (r: Array<[number, number]>): Array<[number, number]> => clipHalf(clipHalf(r, 1, b.w, false), 1, b.e, true);
  // 頭尾接起來（跟原本的資料一樣）：最後一段常是沿著方框邊走的長邊，塗海時要補點。
  // 只剩沿著方框邊走的（面積是零，v1.791 澳洲分成好幾塊時，兩塊交界的經線上剩一條）不要：塗海時會變成伸到海上的細縫
  return [clipHalf(ring, 1, b.w, true), clipHalf(ring, 1, b.e, false), clipHalf(mid(ring), 0, b.s, true), clipHalf(mid(ring), 0, b.n, false)]
    .filter((r) => r.length >= 3)
    .map((r) => (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]]))
    .filter((r) => Math.abs(ringArea(r)) > 1e-9);
}

/** 一圈的面積（平方度，經緯度當平面；正負照方向） */
function ringArea(r: Array<[number, number]>): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][1] + r[i][1]) * (r[j][0] - r[i][0]);
  return a / 2;
}

/** 從 from 往 bearing 方向（0 = 北，順時針）走 km 公里到的點（大圓） */
export function destination(from: LatLng, bearing: number, km: number): LatLng {
  const d = km / EARTH_KM;
  const t = toRad(bearing);
  const p1 = toRad(from.lat);
  const l1 = toRad(from.lng);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: (p2 * 180) / Math.PI, lng: ((((l2 * 180) / Math.PI + 540) % 360) + 360) % 360 - 180 };
}

export function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

const COMPASS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
export function compassLabel(bearing: number): string {
  return COMPASS[Math.round(bearing / 45) % 8];
}

/** 台灣本島、澎湖、金門、馬祖最外圍的點 */
export const TAIWAN_EXTREMES: LatLng[] = [
  { lat: 25.299, lng: 121.537 }, // 富貴角
  { lat: 25.019, lng: 122.007 }, // 三貂角
  { lat: 21.897, lng: 120.858 }, // 鵝鑾鼻
  { lat: 22.04, lng: 121.55 }, // 蘭嶼
  { lat: 22.66, lng: 121.49 }, // 綠島
  { lat: 23.2, lng: 119.43 }, // 澎湖 七美
  { lat: 23.73, lng: 119.6 }, // 澎湖 北端
  { lat: 24.43, lng: 118.24 }, // 金門 西端
  { lat: 26.38, lng: 120.49 }, // 馬祖 東引
];

/** 從目前位置看，要多大的半徑才能涵蓋所有邊界點，進位到 step，最少 min */
export function regionRadiusKm(from: LatLng, points: LatLng[], step: number, min: number): number {
  const far = Math.max(...points.map((p) => haversineKm(from, p)));
  return Math.max(min, Math.ceil(far / step) * step);
}

/** 涵蓋全台灣（含離島）的半徑，進位到 50 km，最少 200 km */
export function taiwanRadiusKm(from: LatLng): number {
  return regionRadiusKm(from, TAIWAN_EXTREMES, 50, 200);
}

/**
 * 漂流瓶跟著縮放變大小（v1.602 使用者說地圖縮小後跟著縮小、超過 10 km 顯示淡藍色）：
 * 外圈（範圍）1 km 內原本大小，到 10 km 慢慢縮到一半；超過 10 km 只畫淡藍色的小點（回傳 0）
 */
export function bottleSize(rangeKm: number): number {
  if (rangeKm > 10) return 0;
  if (rangeKm <= 1) return 1;
  return 1 - 0.5 * Math.log10(rangeKm);
}
