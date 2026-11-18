/**
 * 火箭的圖和飛行（中山公園的發射口、九棚的國家發射場共用）：不用載入 park.ts 也拿得到。
 * 樣式在 styles.css（.rocket-*）；外面包 class="parked" 的不畫火焰和煙，depart 是點火離地、land 是降落（不降進井裡）
 */
import { RADAR_GEOM, type TripAt } from './radar';

const { c: C, inner: INNER } = RADAR_GEOM;
/** 點火離地多久、從上面降下來多久（毫秒） */
export const DEPART_MS = 1600;
export const ARRIVE_MS = 5500;
/** 火箭（側面、站著）：底在 (0, 0)，約 8.5 公尺高、3.5 公尺寬（含尾翼），白色機身、紅色鼻錐和尾翼、一個圓窗；底下的火焰會閃，旁邊的白煙 */
export const rocketSvg = (clip: string): string =>
  `<g class="rocket-fly">` +
  `<g class="rocket-flame"><g class="rocket-flicker"><path class="flame-out" d="M-0.62 0.15Q-0.75 1.7 0 3.6Q0.75 1.7 0.62 0.15Z" /><path class="flame-in" d="M-0.32 0.15Q-0.38 1.1 0 2.2Q0.38 1.1 0.32 0.15Z" /></g></g>` +
  `<g${clip ? ` clip-path="url(#${clip})"` : ''}><g class="rocket-rise">` +
  `<path class="rocket-red" d="M-0.9 -2.4L-1.75 -0.1L-1.75 0.15L-0.9 -0.35Z" /><path class="rocket-red rocket-red-dark" d="M0.9 -2.4L1.75 -0.1L1.75 0.15L0.9 -0.35Z" />` +
  `<path class="rocket-nozzle" d="M-0.55 -0.3L0.55 -0.3L0.72 0.18L-0.72 0.18Z" />` +
  `<path class="rocket-body" d="M-0.9 -0.3L-0.9 -5.4L0.9 -5.4L0.9 -0.3Z" /><path class="rocket-shade" d="M0.35 -5.4L0.9 -5.4L0.9 -0.3L0.35 -0.3Z" />` +
  `<path class="rocket-red" d="M-0.9 -1.35L0.9 -1.35L0.9 -1L-0.9 -1Z" />` +
  `<path class="rocket-red" d="M-0.9 -5.4Q-0.85 -7.3 0 -8.5Q0.85 -7.3 0.9 -5.4Z" /><path class="rocket-shade" d="M0.25 -5.4Q0.45 -7 0 -8.5Q0.85 -7.3 0.9 -5.4Z" />` +
  `<circle class="rocket-window" cx="0" cy="-3.9" r="0.4" /><circle class="rocket-glint" cx="-0.12" cy="-4.02" r="0.12" />` +
  `<path class="rocket-red" d="M-0.13 -1.9L0.13 -1.9L0.13 0.15L-0.13 0.15Z" />` +
  `</g></g></g>` +
  `<g class="rocket-smoke">${[
    [-2.4, 0.25, 1.1, 0],
    [-1.3, -0.3, 1.2, 80],
    [0, 0.4, 1.3, 40],
    [1.3, -0.2, 1.2, 120],
    [2.5, 0.3, 1, 60],
  ]
    .map(([x, y, r, d]) => `<circle style="--d:${d}ms" cx="${x}" cy="${y}" r="${r}" />`)
    .join('')}</g>`;
/** 火箭高幾公尺（點的範圍照這個大小） */
export const ROCKET_H = 8.5;

/** 飛行中小火箭在雷達正中間（固定大小） */
export const TRIP_AT: TripAt = { x: C, y: C + 12, k: 3.4 };
/** 降落開始時地圖上的火箭在哪（雷達外圈 scaleKm、正中間是發射口）：小火箭最後移到這裡交回來 */
export function arriveAt(scaleKm: number): TripAt {
  const ppm = INNER / (scaleKm * 1000);
  return { x: C, y: C - Math.min(45 * ppm, 0.35 * INNER), k: ppm };
}

/** 飛行中畫在雷達正中間的小火箭（火焰一直噴、左右晃，旁邊一道道往後的氣流）；rocket-tilt 繞火箭中間轉（頭朝要去的方向） */
export function tripSvg(): string {
  return (
    `<g class="rocket-trip" transform="translate(${TRIP_AT.x} ${TRIP_AT.y}) scale(${TRIP_AT.k})">` +
    `<g transform="translate(0 -4)"><g class="rocket-tilt"><g transform="translate(0 4)">` +
    `<path class="trip-streak" d="M-3 -16L-3 8M3.2 -12L3.2 12M-5.5 -6L-5.5 14M5.8 -18L5.8 4" />` +
    `<g class="rocket-wobble">${rocketSvg('')}</g></g></g></g></g>`
  );
}

/**
 * 九棚的火箭（國家發射場，第 4 號願望：可以搭到 Kepler-22b）停在哪、這一段在做什麼：
 * parked 停著（點得到）、depart 點火離地（DEPART_MS，之後 away：小火箭接手飛）、land 從上面降下來（ARRIVE_MS，之後停著）。
 * 火箭在哪你就在哪（跟國館的火箭、汪星一樣，v1.762 使用者說搭過去之後定位就要在那邊、要再搭回來才看得到地球）：
 * 存在 dr.launch（出發就記成要去的那邊，飛到一半重新整理就在那邊）
 */
export type LaunchWhere = 'jiupeng' | 'kepler22b';
export type LaunchPhase = 'parked' | 'depart' | 'away' | 'land';
const LS_LAUNCH = 'dr.launch';
function loadLaunch(): LaunchWhere {
  try {
    return (JSON.parse(localStorage.getItem(LS_LAUNCH) ?? 'null') as { where?: string } | null)?.where === 'kepler22b' ? 'kepler22b' : 'jiupeng';
  } catch {
    return 'jiupeng';
  }
}
function saveLaunch(where: LaunchWhere): void {
  try {
    if (where === 'kepler22b') localStorage.setItem(LS_LAUNCH, JSON.stringify({ where }));
    else localStorage.removeItem(LS_LAUNCH);
  } catch {
    /* 存不了就算了（無痕視窗）：重新整理回到九棚 */
  }
}
let launch: { where: LaunchWhere; phase: LaunchPhase; at: number } | null = null;
export function launchNow(now = performance.now()): { where: LaunchWhere; phase: LaunchPhase; e: number } {
  launch ??= { where: loadLaunch(), phase: 'parked', at: 0 };
  const e = now - launch.at;
  if (launch.phase === 'depart' && e >= DEPART_MS) return { where: launch.where, phase: 'away', e };
  if (launch.phase === 'land' && e >= ARRIVE_MS) return { where: launch.where, phase: 'parked', e };
  return { ...launch, e };
}
/** 要飛了：停著才能飛，回傳要飛去哪裡（null 是不能飛） */
export function departLaunch(now = performance.now()): LaunchWhere | null {
  const r = launchNow(now);
  if (r.phase !== 'parked') return null;
  launch = { where: r.where, phase: 'depart', at: now };
  const to: LaunchWhere = r.where === 'jiupeng' ? 'kepler22b' : 'jiupeng';
  saveLaunch(to);
  return to;
}
/** 飛到了：從上面降下來，停在那裡 */
export function landLaunch(where: LaunchWhere, now = performance.now()): void {
  launch = { where, phase: 'land', at: now };
  saveLaunch(where);
}
/** 回到九棚停著（測試用） */
export function resetLaunch(): void {
  launch = { where: 'jiupeng', phase: 'parked', at: 0 };
  saveLaunch('jiupeng');
}
/**
 * 站在地上的火箭（九棚、Kepler-22b）：底在 (x, y)、每公尺 ppm 個單位，照這一段畫（點火、降落的動畫用 CSS，--t 是已經過了多久）；
 * 停著的加一個點的範圍（launch-hit，至少 hitMin 半徑）。h 是畫成幾公尺高
 */
export function standingRocket(x: number, y: number, ppm: number, h: number, phase: LaunchPhase, e: number, hitMin = 20): string {
  if (phase === 'away') return '';
  const f1 = (v: number): string => v.toFixed(1);
  const at = `${f1(x)} ${f1(y)}`;
  const s = (h / ROCKET_H) * ppm;
  // 降落從畫面上半部（正中間上面外圈的 0.35 倍、最多 45 公尺）開始，跟國館一樣
  const land = phase === 'land' ? `;--land:-${f1(Math.min(45, (0.35 * INNER) / ppm) / (h / ROCKET_H))}px` : '';
  const style = phase === 'parked' ? '' : ` style="--t:${-Math.round(e)}ms${land}"`;
  let out = `<g class="launch-rocket ${phase}" data-at="${at}"${style}><g transform="translate(${at}) scale(${+s.toPrecision(4)})">${rocketSvg('')}</g></g>`;
  if (phase === 'parked') out += `<circle class="launch-hit" cx="${f1(x)}" cy="${f1(y - h * 0.45 * ppm)}" r="${f1(Math.max(hitMin, h * 0.55 * ppm))}" />`;
  return out;
}
