/**
 * 彩虹流出（同志遊行出發時，雷達、地圖上的路線從出發的地方一路流到終點）：每一條線從頭慢慢畫到尾。
 * 六個顏色一個比一個晚一點（紅色帶頭），整條流完約 4.6 秒
 */
export const RAINBOW_FLOW_MS = 4000;
export const RAINBOW_STAGGER_MS = 120;
/** 六條都流完要多久 */
export const RAINBOW_FLOW_TOTAL = RAINBOW_FLOW_MS + 5 * RAINBOW_STAGGER_MS;
/** 遊行、洋流車掃進行中每隔多久再流一次（main.ts 每 5 秒重算一次，實際約 30～35 秒） */
export const RAINBOW_EVERY_MS = 30_000;

/**
 * 一條線（SVG path，要已經放進畫面）從頭畫到尾：ago 是這一條已經流了多久（毫秒，負的是還沒輪到它），
 * 重畫時照 ago 接著流、不會重來；流完拿掉動畫，線照原本的樣子（地圖縮放後線變長也不會被切掉）
 */
export function flowOut(path: SVGPathElement, ago: number): void {
  if (ago >= RAINBOW_FLOW_MS || typeof path.animate !== 'function') return;
  let len = 0;
  try {
    len = path.getTotalLength();
  } catch {
    return;
  }
  if (!(len > 0)) return;
  const dash = `${len} ${len}`;
  path.animate(
    [
      { strokeDasharray: dash, strokeDashoffset: len },
      { strokeDasharray: dash, strokeDashoffset: 0 },
    ],
    { duration: RAINBOW_FLOW_MS, delay: -ago, easing: 'ease-in-out', fill: 'backwards' },
  );
}

/** 洋流湧過去：從出發的地方湧到終點（跟彩虹一樣快），到底後慢慢淡掉 */
export const SURGE_FADE_MS = 1500;
/** 兩層（深藍、淺藍）都湧完、淡掉要多久 */
export const SURGE_TOTAL = RAINBOW_FLOW_MS + SURGE_FADE_MS + RAINBOW_STAGGER_MS;

/**
 * 洋流車掃進行中的浪（一條線，要已經放進畫面；平常看不到，CSS 的 opacity 是 0）：從頭畫到尾、到底後淡掉。
 * ago 是已經湧了多久（毫秒），重畫時接著湧
 */
export function surge(path: SVGPathElement, ago: number): void {
  const total = RAINBOW_FLOW_MS + SURGE_FADE_MS;
  if (ago >= total || typeof path.animate !== 'function') return;
  let len = 0;
  try {
    len = path.getTotalLength();
  } catch {
    return;
  }
  if (!(len > 0)) return;
  const dash = `${len} ${len}`;
  const k = RAINBOW_FLOW_MS / total;
  path.animate(
    [
      { strokeDasharray: dash, strokeDashoffset: len, opacity: 1, offset: 0, easing: 'ease-in-out' },
      { strokeDasharray: dash, strokeDashoffset: 0, opacity: 1, offset: k, easing: 'ease-in' },
      { strokeDasharray: dash, strokeDashoffset: 0, opacity: 0, offset: 1 },
    ],
    { duration: total, delay: -ago, fill: 'both' },
  );
}

/**
 * 洋流號：官方車掃的路線上一直重複開的車（雷達、地圖照同一個時鐘，位置一樣）。動畫，不是車隊的實際位置。
 * 一趟 CAR_LAP_MS：前 9 成從起點等速開到終點，停在終點慢慢淡掉，再從起點淡入重來
 */
export const CAR_LAP_MS = 24_000;
export function carPhase(ms: number): { at: number; alpha: number } {
  const p = (ms % CAR_LAP_MS) / CAR_LAP_MS;
  return { at: Math.min(1, p / 0.9), alpha: p < 0.03 ? p / 0.03 : p > 0.94 ? (1 - p) / 0.06 : 1 };
}
/** 洋流號的樣子（螢幕像素）：深藍的小巴、淺藍的窗、一道浪花，車頭朝右，輪子底在 (0, 0)；car-flip 那一組左右翻（往左開）；名字寫在上面 */
export const CAR_SVG =
  '<g class="car-flip"><g class="car-bob">' +
  '<path class="car-body" d="M-14 -3.5V-12.5Q-14 -15 -11.5 -15H5Q7.5 -15 9 -12.8L12.6 -8Q14 -7.2 14 -5.6V-3.5Z"/>' +
  '<path class="car-glass" d="M-11.5 -12.6H-4.2V-8.6H-11.5ZM-2.4 -12.6H4.6Q6 -12.6 7 -11.2L9.2 -8.6H-2.4Z"/>' +
  '<path class="car-wave" d="M-12.6 -5.8q1.6 -1.5 3.2 0t3.2 0t3.2 0t3.2 0t3.2 0t3.2 0t3.2 0"/>' +
  '</g><circle class="car-wheel" cx="-8" cy="-3.4" r="3.2"/><circle class="car-wheel" cx="8" cy="-3.4" r="3.2"/></g>' +
  '<text class="car-label" x="0" y="-19" text-anchor="middle">洋流號</text>';
export const CAR_TITLE = '洋流號：沿著路線重複播放的動畫，不是車隊的實際位置';

/** 沿著折線（xs、ys，cum 是每一點走了多遠）走到 at（0～1）的位置，和那一段往左還是往右（差不多直上直下是 null） */
export function alongLine(xs: ArrayLike<number>, ys: ArrayLike<number>, cum: ArrayLike<number>, at: number): { x: number; y: number; left: boolean | null } {
  const n = cum.length;
  const want = at * cum[n - 1];
  let i = 1;
  while (i < n - 1 && cum[i] < want) i++;
  const seg = cum[i] - cum[i - 1];
  const k = seg > 0 ? Math.min(1, Math.max(0, (want - cum[i - 1]) / seg)) : 0;
  const dx = xs[i] - xs[i - 1];
  const dy = ys[i] - ys[i - 1];
  return { x: xs[i - 1] + dx * k, y: ys[i - 1] + dy * k, left: Math.abs(dx) < Math.abs(dy) * 0.15 ? null : dx < 0 };
}
