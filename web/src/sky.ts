/**
 * 3D 國館的天空（v1.777 使用者說「國館支援白天晚上 支援抬頭看到太陽跟月亮」）：照現在的時間算中山公園看出去太陽、月亮在哪
 * （高度、方位；space.ts 同一套簡化公式，誤差 1、2 度；月亮扣掉人站在地表的視差），月相是真的（照太陽的方向亮一邊）。
 * 天色、光線照太陽的高度慢慢變：白天、日出日落（地平線橘色）、天剛黑（藍紫）、晚上（深藍，城市的天空不會全黑）。
 */
import { moonPosition, subsolar } from './space';

const RAD = Math.PI / 180;
const EARTH_KM = 6371;
/** 方向（長度 1）：往東、往北、往上 */
export type Enu = [number, number, number];

const daysJ2000 = (at: Date): number => at.getTime() / 86_400_000 + 2440587.5 - 2451545.0;
const norm180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

/** 天上的東西（赤緯 dec、在哪個經度的頭頂 subLng，度；離地心 km 公里，太遠的不用算視差）從 lat、lng 的地面看過去的方向 */
function enuOf(dec: number, subLng: number, lat: number, lng: number, km = Infinity): Enu {
  const [d, s] = [dec * RAD, subLng * RAD];
  let [x, y, z] = [Math.cos(d) * Math.cos(s), Math.sin(s) * Math.cos(d), Math.sin(d)];
  const [p, l] = [lat * RAD, lng * RAD];
  if (Number.isFinite(km)) {
    // 人站在地表，不在地心（月亮差約 1 度）
    [x, y, z] = [x * km - EARTH_KM * Math.cos(p) * Math.cos(l), y * km - EARTH_KM * Math.cos(p) * Math.sin(l), z * km - EARTH_KM * Math.sin(p)];
  }
  const e = -Math.sin(l) * x + Math.cos(l) * y;
  const n = -Math.sin(p) * Math.cos(l) * x - Math.sin(p) * Math.sin(l) * y + Math.cos(p) * z;
  const u = Math.cos(p) * Math.cos(l) * x + Math.cos(p) * Math.sin(l) * y + Math.sin(p) * z;
  const len = Math.hypot(e, n, u) || 1;
  return [e / len, n / len, u / len];
}

/** 從 lat、lng 看太陽的方向 */
export function sunEnu(at: Date, lat: number, lng: number): Enu {
  const s = subsolar(at);
  return enuOf(s.lat, s.lng, lat, lng);
}

/** 從 lat、lng 看月亮的方向（黃道座標換成赤道座標，再看現在轉到哪） */
export function moonEnu(at: Date, lat: number, lng: number): Enu {
  const m = moonPosition(at);
  const n = daysJ2000(at);
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const [lo, la] = [m.lon * RAD, m.lat * RAD];
  const [x, y, z] = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const [yq, zq] = [y * Math.cos(eps) - z * Math.sin(eps), y * Math.sin(eps) + z * Math.cos(eps)];
  const ra = Math.atan2(yq, x) / RAD;
  const gmst = 280.46061837 + 360.98564736629 * n;
  return enuOf(Math.asin(zq) / RAD, norm180(ra - gmst), lat, lng, m.dist);
}

/** 高度（度，地平線 0、頭頂 90） */
export const altOf = (d: Enu): number => Math.asin(Math.max(-1, Math.min(1, d[2]))) / RAD;
/** 方位（度，北 0、東 90） */
export const azOf = (d: Enu): number => ((Math.atan2(d[0], d[1]) / RAD) % 360 + 360) % 360;
/** 月亮亮的部分（0 新月～1 滿月）：太陽、月亮離得越遠越圓 */
export const moonLit = (sun: Enu, moon: Enu): number => (1 - (sun[0] * moon[0] + sun[1] * moon[1] + sun[2] * moon[2])) / 2;

/** 這個太陽高度的天色和光線（顏色是 0xRRGGBB） */
export interface SkyLook {
  /** 頭頂、地平線（霧也是這個顏色，遠的地面才接得起來）、太陽旁邊的光暈 */
  zenith: number;
  horizon: number;
  glow: number;
  /** 天空光、地面反光、強度 */
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  /** 太陽光的強度、顏色 */
  sunI: number;
  sunColor: number;
  /** 多暗（0 白天～1 晚上）：路燈亮、不照光的東西（簷下、小法）跟著變暗 */
  night: number;
}

type Key = [alt: number, zenith: number, horizon: number, glow: number, hemiSky: number, hemiGround: number, hemiI: number, sunI: number, sunColor: number];
/** 照太陽高度（度）排：晚上、天剛黑、日落、白天；中間照比例混 */
const KEYS: Key[] = [
  [-18, 0x0d1a3a, 0x283a62, 0x283a62, 0x6f84c4, 0x2c3a3a, 0.75, 0, 0xffffff],
  [-8, 0x16295a, 0x3f4f80, 0x5a5a8a, 0x7a8ac4, 0x34443a, 0.8, 0, 0xffffff],
  [-3, 0x2d4c88, 0x9a7a96, 0xd08a78, 0x9aa2cc, 0x465840, 0.85, 0, 0xffc89a],
  [0, 0x4a74b0, 0xeaa57e, 0xffb070, 0xe0d0d0, 0x5a7048, 1.15, 0.6, 0xffb27a],
  [4, 0x6593cc, 0xf0c8a4, 0xffd0a0, 0xf2eaea, 0x6f8a52, 1.45, 1.35, 0xffd6a8],
  [12, 0x76a8dc, 0xcfe0ea, 0xfff2d8, 0xeef6ff, 0x7f9a58, 1.7, 1.9, 0xfff6e6],
  [90, 0x6aa2dc, 0xcfe0ea, 0xfff6e6, 0xeef6ff, 0x7f9a58, 1.7, 1.9, 0xfff6e6],
];
const mix = (a: number, b: number, t: number): number => {
  let out = 0;
  for (const sh of [16, 8, 0]) out |= Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * t) << sh;
  return out;
};

/** 太陽在 alt 度的天色、光線 */
export function skyLook(alt: number): SkyLook {
  let i = 0;
  while (i < KEYS.length - 2 && alt > KEYS[i + 1][0]) i++;
  const [a, b] = [KEYS[i], KEYS[i + 1]];
  const t = Math.max(0, Math.min(1, (alt - a[0]) / (b[0] - a[0])));
  const lerp = (k: number): number => a[k] + (b[k] - a[k]) * t;
  return {
    zenith: mix(a[1], b[1], t),
    horizon: mix(a[2], b[2], t),
    glow: mix(a[3], b[3], t),
    hemiSky: mix(a[4], b[4], t),
    hemiGround: mix(a[5], b[5], t),
    hemiI: lerp(6),
    sunI: lerp(7),
    sunColor: mix(a[8], b[8], t),
    // 太陽下山前一點路燈就亮了，天黑透（-6 度，民用曙光結束）全亮
    night: Math.max(0, Math.min(1, (2 - alt) / 8)),
  };
}
