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

/** 解開差值編碼的線（eastasia.ts、netherlands.ts）：「;」隔開每一段，每段 [緯度×1000, 經度×1000, 之後每一點跟前一點的差…] → 一串 [緯度, 經度] */
export function decodeRings(s: string): Array<Array<[number, number]>> {
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
