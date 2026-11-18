/**
 * 火箭的圖（中山公園的發射口、飛行中的小火箭、九棚的國家發射場共用）：只有 SVG 字串，不用載入 park.ts 也拿得到。
 * 樣式在 styles.css（.rocket-*）；外面包 class="parked" 的不畫火焰和煙
 */
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
