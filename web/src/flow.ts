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
/**
 * 縫線（縫合市民大道）：沿著路（x 軸）三個交叉的針腳，一筆一筆縫上去（白邊、橘線；delayMs 是開始縫的時間）。
 * 用 path 不用 line（pathLength 在 line 上不是每個瀏覽器都有）
 */
export function stitchSvg(delayMs: number): string {
  // 縫好後上面冒一顆小愛心、慢慢淡掉（可愛風，v1.524）
  let out = `<path class="st-heart" d="M0 -9.6C-1.7 -11.1 -3.8 -12.3 -3.8 -14.2C-3.8 -15.5 -2.8 -16.4 -1.6 -16.4C-0.8 -16.4 -0.2 -16 0 -15.4C0.2 -16 0.8 -16.4 1.6 -16.4C2.8 -16.4 3.8 -15.5 3.8 -14.2C3.8 -12.3 1.7 -11.1 0 -9.6Z" style="animation-delay:${Math.round(delayMs + 900)}ms"/>`;
  [-11, 0, 11].forEach((x, j) => {
    [[x - 3.5, -7.5, x + 3.5, 7.5], [x - 3.5, 7.5, x + 3.5, -7.5]].forEach(([x1, y1, x2, y2], m) => {
      const d = `M${x1} ${y1}L${x2} ${y2}`;
      const style = `animation-delay:${Math.round(delayMs + (j * 2 + m) * 150)}ms`;
      out += `<path class="st-u" d="${d}" pathLength="1" style="${style}"/><path class="st-t" d="${d}" pathLength="1" style="${style}"/>`;
    });
  });
  return out;
}

/**
 * 健身小巴（洋流總部的特效）：每一站停 FITBUS_STOP_MS，站和站之間照距離開（一圈開 FITBUS_DRIVE_MS），一直繞。
 * 一圈 FITBUS_DRIVE_MS + 站數 × FITBUS_STOP_MS（三站 24.6 秒）；styles.css 的 fit-show、fit-pt 照「停的時間 ÷ 一圈」= 13% 排，改時間要一起改
 */
/**
 * 一直動的東西（健身小巴開、人流、登山客、腳踏車、圖示的待機小動作…）拉近到雷達外圈 HQ_MOTION_KM 以內、地圖縮放 HQ_MOTION_ZOOM 以上才動，
 * 拉遠就停下來或收起來，畫面不要太亂（v1.528 使用者說「所有會動的都建議拉近到一定程度才開始動」「不希望整體畫面太亂」）；洋流號、河、冒出來的動畫照舊
 */
export const HQ_MOTION_KM = 3;
/** 拉遠到雷達外圈 5 km、地圖縮放 14 以下，寶箱、橋下空間、大巨蛋、毛孩安心養的字不寫（v1.529 使用者說「以 5 公里為基礎，拉遠到 5 公里後…文字可以拿掉，其他留著」） */
export const HQ_LABEL_KM = 5;
export const HQ_LABEL_ZOOM = 14;
/** 騎自行車的人：一趟 lapMs 從頭騎到尾，頭尾淡入淡出（另一台反方向騎） */
export function bikePhase(ms: number, lapMs: number): { at: number; alpha: number } {
  if (ms < 0) return { at: 0, alpha: 0 };
  const p = (ms % lapMs) / lapMs;
  return { at: p, alpha: p < 0.06 ? p / 0.06 : p > 0.94 ? (1 - p) / 0.06 : 1 };
}
/** 騎自行車的人（螢幕像素，路面在 y = 0、往右騎）：黃色車架、橘色安全帽、綠色上衣，往左騎時翻過來（boat-flip） */
export const BIKE_SVG =
  '<g class="boat-flip"><ellipse class="bk-shadow" cx="0" cy="0.4" rx="8" ry="1.1"/>' +
  '<circle class="bk-wheel" cx="-5" cy="-3" r="3"/><circle class="bk-wheel" cx="5.2" cy="-3" r="3"/>' +
  '<path class="bk-frame" d="M-5 -3L-1.2 -3L2.8 -7.2H-2.4ZM-1.2 -3L-2.4 -7.2M2.8 -7.2L5.2 -3M-2.4 -7.2L-3 -8.6M2.8 -7.2L2.4 -9.2"/>' +
  '<path class="bk-bar" d="M-4.2 -8.8H-1.8M1.4 -9.4H3.6"/><path class="bk-leg" d="M-2.6 -9L0.2 -6L-1.2 -3"/>' +
  '<path class="bk-body" d="M-2.6 -9.2L0.4 -13.8L2.8 -9.6"/>' +
  '<circle class="bk-head" cx="1.4" cy="-15.8" r="2"/><path class="bk-helmet" d="M-0.7 -15.9A2.1 2.1 0 0 1 3.5 -15.9Z"/></g>';
export const HQ_MOTION_ZOOM = 15;
export const FITBUS_DRIVE_MS = 15_000;
export const FITBUS_STOP_MS = 3_200;
export const fitbusLapMs = (stops: number): number => FITBUS_DRIVE_MS + stops * FITBUS_STOP_MS;
/** 各站開始停的時間（從出發算）：先在第一站停，再開到下一站… */
export function fitbusStopOffsets(stopAt: number[]): number[] {
  const out: number[] = [];
  let t = 0;
  stopAt.forEach((f, i) => {
    out.push(t);
    t += FITBUS_STOP_MS + FITBUS_DRIVE_MS * ((i + 1 < stopAt.length ? stopAt[i + 1] : 1) - f);
  });
  return out;
}
/** 健身小巴在路線上的哪裡（0～1，1 回到起點）；出發前看不到，出發後 0.6 秒淡入 */
export function fitbusPhase(ms: number, stopAt: number[]): { at: number; alpha: number } {
  if (ms < 0 || stopAt.length === 0) return { at: 0, alpha: 0 };
  const alpha = Math.min(1, ms / 600);
  let t = ms % fitbusLapMs(stopAt.length);
  for (let i = 0; i < stopAt.length; i++) {
    if (t < FITBUS_STOP_MS) return { at: stopAt[i], alpha };
    t -= FITBUS_STOP_MS;
    const next = i + 1 < stopAt.length ? stopAt[i + 1] : 1;
    const drive = FITBUS_DRIVE_MS * (next - stopAt[i]);
    if (t < drive) return { at: stopAt[i] + (next - stopAt[i]) * (t / drive), alpha };
    t -= drive;
  }
  return { at: 0, alpha };
}
/** 健身小巴的樣子（螢幕像素，路面在 y = 0、車頭朝右）：白色電動小巴、綠色腰線上一個白色啞鈴、車頂電池（閃電）、深色車窗 */
export const FITBUS_BODY =
  '<ellipse class="fb-shadow" cx="0.4" cy="0.6" rx="14.5" ry="1.8"/>' +
  '<path class="fb-body" d="M-14.5 -2.4V-14.6Q-14.5 -16.6 -12.5 -16.6H8.6Q11.2 -16.6 12.6 -14L14.8 -9.4Q15.4 -8.3 15.4 -7.1V-2.4Q15.4 -1 14 -1H-13.1Q-14.5 -1 -14.5 -2.4Z"/>' +
  '<path class="fb-stripe" d="M-14.5 -8.2H15.3V-5.4H-14.5Z"/>' +
  '<path class="fb-win" d="M-12.2 -14.6H-6.6V-10.4H-12.2ZM-5 -14.6H0.6V-10.4H-5ZM2.2 -14.6H8.4L10.6 -10.4H2.2Z"/>' +
  '<path class="fb-db" d="M-9.4 -6.8H-3.2"/><rect class="fb-plate" x="-10.8" y="-8" width="1.6" height="2.4" rx="0.4"/><rect class="fb-plate" x="-3.6" y="-8" width="1.6" height="2.4" rx="0.4"/>' +
  '<path class="fb-roof" d="M-8 -16.6V-18.4Q-8 -18.8 -7.6 -18.8H1.6Q2 -18.8 2 -18.4V-16.6Z"/><path class="fb-bolt" d="M-2.2 -18.3L-3.8 -17.2H-2.4L-3.6 -16.9"/>' +
  '<circle class="fb-wheel" cx="-8.4" cy="-1.2" r="2.7"/><circle class="fb-wheel" cx="9" cy="-1.2" r="2.7"/><circle class="fb-hub" cx="-8.4" cy="-1.2" r="1"/><circle class="fb-hub" cx="9" cy="-1.2" r="1"/>' +
  '<circle class="fb-lamp" cx="14.6" cy="-4" r="0.8"/>';
/** 開來開去的健身小巴：名字寫在上面（不跟著左右翻），車身在 boat-flip 裡（往左開時翻過來，跟洋流號一樣） */
export const FITBUS_SVG = `<text class="boat-label fb-name" y="-22" text-anchor="middle">健身小巴</text><g class="boat-flip">${FITBUS_BODY}</g>`;
/**
 * 健身小巴停站時：車子下面冒出三個長輩，兩個舉啞鈴、一個拉彈力帶，右邊飄一個「敬老卡 +1」；跟小巴同一個時鐘，
 * 每一圈只在停這一站的時候出現（delayMs 是第一次停這一站的時間，lapMs 是一圈多久）
 */
export function fitbusStopSvg(delayMs: number, lapMs: number): string {
  const person = (x: number, kind: 'db' | 'band', d: number): string =>
    `<g transform="translate(${x} 0)"><circle class="fp-head" cy="-10.6" r="2.2"/><path class="fp-body" d="M0 -8.4V-3.6M0 -3.6L-1.9 0M0 -3.6L1.9 0"/>` +
    (kind === 'db'
      ? `<g class="fp-arms" style="animation-delay:${d}ms"><path class="fp-arm" d="M0 -7.4L-3 -10.4M0 -7.4L3 -10.4"/><path class="fp-db" d="M-4.3 -11.5L-1.8 -9.4M1.8 -9.4L4.3 -11.5"/></g>`
      : `<g class="fp-band" style="animation-delay:${d}ms"><path class="fp-arm" d="M0 -7.4L-3.8 -7.6M0 -7.4L3.8 -7.6"/><path class="fp-elastic" d="M-3.8 -7.6H3.8"/></g>`) +
    '</g>';
  const style = `animation-duration:${lapMs}ms;animation-delay:${Math.round(delayMs)}ms`;
  return `<g class="fit-pop" style="${style}"><g transform="translate(0 17)">${person(-9, 'db', 0)}${person(0, 'band', -300)}${person(9, 'db', -450)}</g><text class="fit-pt" x="16" y="12" style="${style}">敬老卡 +1</text></g>`;
}

/**
 * 還沒縫的地方（縫合市民大道）：可愛風，粉色的小虛線鋸齒（像布上「準備縫」的記號），旁邊一根小針帶著粉紅色的線；
 * 底下淡淡的粉色光忽明忽暗（v1.524 使用者說裂痕再淡一點、走可愛風格，不要有可怕的感覺）。showMs 出現、healMs 縫好後淡掉
 */
export function crackSvg(showMs: number, healMs: number): string {
  const main = 'M-15 0.4L-11.2 -1.9L-7.5 1.6L-3.7 -2.1L0 1.8L3.7 -1.8L7.5 2L11.2 -1.6L15 0.6';
  return `<g class="crack" style="animation-delay:${Math.round(showMs)}ms,${Math.round(healMs)}ms"><path class="cr-glow" d="${main}"/><path class="cr-line" d="${main}"/><g class="cr-needle" transform="translate(18.5 -3) rotate(-35)"><path class="cr-thread" d="M-5.6 0C-8 2.4 -6.2 5 -3.6 3.6"/><path class="cr-pin" d="M-5.8 0H5.2L6.6 0.0L5.2 0.6H-5.8Z"/><ellipse class="cr-eye" cx="-4.4" cy="0.3" rx="0.9" ry="0.35"/></g></g>`;
}

export function cultureSvg(char: string, color: string): string {
  return `<circle class="cu-dot" r="7" style="fill:${color}"/><text class="cu-char" y="3.1" text-anchor="middle">${char}</text>`;
}

/** 其他政見對到的地方（學校、圖書館、運動中心、親子館、健康服務中心）：圓角方塊、裡面寫一個字（文化徑是圓的，分得開） */
export function serviceSvg(char: string, color: string): string {
  return `<rect class="sv-dot" x="-7" y="-7" width="14" height="14" rx="3.5" style="fill:${color}"/><text class="cu-char" y="3.1" text-anchor="middle">${char}</text>`;
}

