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
 * 洋流號：官方車掃的路線上一直重複開的船（雷達、地圖照同一個時鐘，位置一樣）。動畫，不是車隊的實際位置。
 * 一趟 BOAT_LAP_MS：前 9 成從起點等速開到終點，停在終點慢慢淡掉，再從起點淡入重來
 */
export const BOAT_LAP_MS = 24_000;
export function boatPhase(ms: number): { at: number; alpha: number } {
  const p = (ms % BOAT_LAP_MS) / BOAT_LAP_MS;
  return { at: Math.min(1, p / 0.9), alpha: p < 0.03 ? p / 0.03 : p > 0.94 ? (1 - p) / 0.06 : 1 };
}
/**
 * 洋流號的樣子（螢幕像素，照台北大洋流海報上的船：橘色船身、黑邊、黑色船底、白色的繩子和舷窗、白色船艙、
 * 掛著白圈的三角帆、豎著「洋流」的旗子）：船頭朝右，水面在 y = 0，船底下一道浪；boat-flip 那一組左右翻（往左開），
 * boat-rock 那一組在浪上搖；名字寫在上面
 */
export const BOAT_SVG =
  '<g class="boat-flip">' +
  '<path class="boat-wave-under" d="M-19 0.4q2.4 -2.2 4.8 0t4.8 0t4.8 0t4.8 0t4.8 0t4.8 0t4.8 0t4.8 0"/>' +
  '<g class="boat-rock">' +
  '<path class="boat-line" d="M-1.5 -13.6V-27.5M9 -9.6V-28.4"/>' +
  '<path class="boat-sail" d="M-2.2 -26.6V-15H-12.8Z"/>' +
  '<circle class="boat-mark" cx="-5.6" cy="-18.7" r="2.1"/>' +
  '<path class="boat-flag" d="M9.4 -27.8H14.6V-14.6H9.4Z"/>' +
  '<path class="boat-panel" d="M10.6 -26.3H13.4V-16.1H10.6Z"/>' +
  '<path class="boat-text" d="M11.3 -24.6h1.4M11.3 -23h1.4M11.3 -19.8h1.4M11.3 -18.2h1.4"/>' +
  '<path class="boat-cabin" d="M-6.5 -8.9V-13.6H3.4L6.6 -9.6Z"/>' +
  '<path class="boat-window" d="M-5.3 -12.5H2.8L4.8 -10.1H-5.3Z"/>' +
  '<path class="boat-hull" d="M-15 -8.5L14.5 -10Q12.5 -3.2 8.5 -0.5H-12Q-14.6 -3.5 -15 -8.5Z"/>' +
  '<path class="boat-keel" d="M-13.6 -3.2L11.6 -3.6Q10.4 -1.6 8.5 -0.5H-12Q-13.1 -1.7 -13.6 -3.2Z"/>' +
  '<path class="boat-rope" d="M-14 -7.6Q-10.5 -5.2 -7 -7.9Q-3.5 -5.5 0 -8.2Q3.5 -5.8 7 -8.6Q10.2 -6.3 13 -9.2"/>' +
  '<circle class="boat-port" cx="-8.6" cy="-4.9" r="0.95"/><circle class="boat-port" cx="-3" cy="-5.1" r="0.95"/><circle class="boat-port" cx="2.6" cy="-5.4" r="0.95"/>' +
  '</g>' +
  '<path class="boat-wave" d="M-19 0.4q2.4 -2.2 4.8 0t4.8 0t4.8 0t4.8 0t4.8 0t4.8 0t4.8 0t4.8 0"/>' +
  '</g>' +
  '<text class="boat-label" x="0" y="-33" text-anchor="middle">洋流號</text>';
export const BOAT_TITLE = '洋流號：沿著路線重複播放的動畫，不是車隊的實際位置';

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
