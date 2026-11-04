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

/**
 * 河流（洋流總部的特效）在整條線上走到 f（0～1）那裡的半寬（螢幕像素）：整條差不多一樣寬，
 * 中間自然地忽寬忽窄（照 f 算，放大縮小都一樣）
 */
// 整條一樣寬（以前往下游越來越寬，到終點是起點的三倍多；v1.485 使用者說「洋流號的海流後面變粗了」），只留一點自然的寬窄起伏
export const riverHalfWidth = (f: number): number => 3.4 * (1 + 0.16 * Math.sin(2 * Math.PI * 17 * f) + 0.08 * Math.sin(2 * Math.PI * 41 * f + 1.3));

/**
 * 洋流總部的特效（點了洋流總部）：洋流號只開一趟，HQ_SAIL_MS 沿著真的路像一條河流繞過台北 12 個區、流到台北市政府（起步、到站慢慢加速減速，中間等速），
 * 到了先停 HQ_ARRIVE_MS（雷達拉近市政府、畫面停好），再放 FIREWORKS_MS 的煙火，放完船、水一起淡掉；雷達、地圖照同一個時鐘（Date.now()）
 */
export const HQ_SAIL_MS = 75_000;
export const HQ_ARRIVE_MS = 3000;
export const FIREWORKS_MS = 4400;
/** 點下去星星轉走要幾毫秒（轉完洋流號才出來） */
export const HQ_STAR_MS = 1100;
/** 開到、畫面停好為止（之後不會自己消失，要按「關閉洋流號」：使用者說改成手動關閉，好讓滑鼠移過去看介紹；煙火先不放，fireworksSvg 留著） */
export const HQ_VOYAGE_MS = HQ_SAIL_MS + HQ_ARRIVE_MS;
/** 起步、到站各花幾毫秒加速、減速 */
const RAMP_MS = 2500;
/** 開到哪（0～1）：速度是梯形（起步加速、中間等速、到站減速） */
function sailAt(ago: number): number {
  const t = Math.min(HQ_SAIL_MS, Math.max(0, ago));
  const v = 1 / (HQ_SAIL_MS - RAMP_MS);
  if (t < RAMP_MS) return (v * t * t) / (2 * RAMP_MS);
  if (t > HQ_SAIL_MS - RAMP_MS) return 1 - (v * (HQ_SAIL_MS - t) ** 2) / (2 * RAMP_MS);
  return v * (t - RAMP_MS / 2);
}
/** 出發後 ago 毫秒：開到哪（0～1）、多不透明（出發時淡入，煙火放完淡掉；還沒出發是 0） */
export function voyagePhase(ago: number): { at: number; alpha: number } {
  // 一開始淡入，之後一直留著（手動關閉）
  const alpha = ago < 0 ? 0 : Math.min(1, ago / 400);
  return { at: sailAt(ago), alpha };
}
/** 開到 at（0～1）是出發後幾毫秒（經過每一區時寫區名用） */
export function voyageTimeOf(at: number): number {
  let [lo, hi] = [0, HQ_SAIL_MS];
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (sailAt(mid) < at) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 一發煙火：在終點上方哪裡炸開（螢幕像素，終點是 0,0）、什麼時候（開始放之後幾毫秒）、什麼顏色（淺色、深色主題都看得到）、多大 */
const FIREWORKS: Array<{ x: number; y: number; at: number; color: string; r: number }> = [
  { x: 0, y: -110, at: 0, color: '#ffb800', r: 46 },
  { x: -62, y: -80, at: 500, color: '#ff5a1f', r: 36 },
  { x: 60, y: -88, at: 950, color: '#14a8d6', r: 40 },
  { x: -26, y: -148, at: 1450, color: '#ff3d8b', r: 42 },
  { x: 40, y: -136, at: 1950, color: '#8b5cf6', r: 36 },
  { x: 0, y: -100, at: 2500, color: '#ffb800', r: 54 },
];
/** 從終點升上去幾毫秒才炸開 */
const RISE_MS = 380;
/** 一發有幾道火花（外圈），裡面再一圈短一點的 */
const SPARKS = 18;

/**
 * 煙火（螢幕像素，終點在 0,0）：每一發先從終點升上去一道光，在上面炸開兩圈一道道的火花往外飛、往下掉一點再淡掉，中間亮一下；
 * ago 是開始放了多久（雷達每次重畫都重建，照 ago 接著放；還沒開始是負的，等一下才放）
 */
export function fireworksSvg(ago: number): string {
  const d = (ms: number): string => `animation-delay:${Math.round(ms - ago)}ms`;
  return FIREWORKS.map((f) => {
    const len = Math.hypot(f.x, f.y).toFixed(1);
    const rise = `<path class="fw-rise" d="M0 0L${f.x} ${f.y}" stroke="${f.color}" style="stroke-dasharray:${len};--len:${len};${d(f.at)}"/>`;
    const flash = `<circle class="fw-flash" cx="${f.x}" cy="${f.y}" r="${(f.r * 0.45).toFixed(1)}" fill="${f.color}" style="${d(f.at + RISE_MS)}"/>`;
    const ring = (n: number, r: number, len: number, turn: number): string =>
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * 2 * Math.PI + turn;
        const [ux, uy] = [Math.cos(a), Math.sin(a)];
        // 一道火花：朝外的短線，飛到 r 那麼遠、往下掉一點
        return `<path class="fw-spark" d="M${f.x} ${f.y}l${(ux * len).toFixed(1)} ${(uy * len).toFixed(1)}" stroke="${f.color}" style="--dx:${(ux * r).toFixed(1)}px;--dy:${(uy * r + r * 0.3).toFixed(1)}px;${d(f.at + RISE_MS)}"/>`;
      }).join('');
    const sparks = ring(SPARKS, f.r, 7, f.at) + ring(Math.round(SPARKS * 0.6), f.r * 0.55, 5, f.at + 0.3);
    return rise + flash + sparks;
  }).join('');
}

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

/** 樹樁長回大樹（把樹種回來；中心在 0,0 是樹根，螢幕像素）：一開始是砍掉的樹樁，growMs 後長出樹冠（從下往上彈出來） */
export function regrowSvg(growMs: number): string {
  return (
    '<path class="rg-trunk" d="M-2.6 -2L-3.2 6H3.2L2.6 -2Z"/><ellipse class="rg-cut" cy="-2" rx="2.6" ry="1.1"/>' +
    `<g class="rg-crown" style="animation-delay:${Math.round(growMs)}ms"><circle cx="-5.5" cy="-8" r="6"/><circle cx="5.5" cy="-8" r="6"/><circle cx="0" cy="-13" r="7"/><circle class="rg-lit" cx="-2.5" cy="-15" r="2.4"/></g>`
  );
}

/** 文化徑的點：主題顏色的圓、裡面寫主題的字 */
export function cultureSvg(char: string, color: string): string {
  return `<circle class="cu-dot" r="7" style="fill:${color}"/><text class="cu-char" y="3.1" text-anchor="middle">${char}</text>`;
}

/** 其他政見對到的地方（學校、圖書館、運動中心、親子館、健康服務中心）：圓角方塊、裡面寫一個字（文化徑是圓的，分得開） */
export function serviceSvg(char: string, color: string): string {
  return `<rect class="sv-dot" x="-7" y="-7" width="14" height="14" rx="3.5" style="fill:${color}"/><text class="cu-char" y="3.1" text-anchor="middle">${char}</text>`;
}

/** 其他政見的地方，不是代表的那些：小圓點、不能點（同一種地方的介紹都一樣，使用者說留幾個能點的就好） */
export function serviceDotSvg(color: string): string {
  return `<circle class="sv-mini" r="3.2" style="fill:${color}"/>`;
}

