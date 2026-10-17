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

export function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

const COMPASS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
export function compassLabel(bearing: number): string {
  return COMPASS[Math.round(bearing / 45) % 8];
}

/** 台北市加新北市最外圍的幾個點，用來算「雙北」範圍要多大才裝得下 */
export const SHUANGBEI_EXTREMES: LatLng[] = [
  { lat: 25.299, lng: 121.537 }, // 石門 富貴角
  { lat: 25.262, lng: 121.462 }, // 三芝
  { lat: 25.135, lng: 121.808 }, // 瑞芳 鼻頭角
  { lat: 25.019, lng: 122.007 }, // 貢寮 三貂角
  { lat: 24.858, lng: 121.826 }, // 坪林 東界
  { lat: 24.672, lng: 121.501 }, // 烏來 福山南界
  { lat: 24.905, lng: 121.351 }, // 三峽 西南界
  { lat: 24.955, lng: 121.336 }, // 鶯歌
  { lat: 25.097, lng: 121.353 }, // 林口
  { lat: 25.17, lng: 121.41 }, // 八里
];

/** 從目前位置看，要多大的半徑才能涵蓋整個雙北，進位到 5 km，最少 20 km */
export function shuangbeiRadiusKm(from: LatLng): number {
  const far = Math.max(...SHUANGBEI_EXTREMES.map((p) => haversineKm(from, p)));
  return Math.max(20, Math.ceil(far / 5) * 5);
}
