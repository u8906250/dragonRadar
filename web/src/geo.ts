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

/** Google polyline 編碼（精度 1e-5 度）→ [緯度, 經度] */
export function decodePolyline(s: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let shift = 0;
    let v = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      v |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return v & 1 ? ~(v >> 1) : v >> 1;
  };
  while (i < s.length) {
    lat += next();
    lng += next();
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
