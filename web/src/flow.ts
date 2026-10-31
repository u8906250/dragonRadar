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
