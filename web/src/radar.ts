import type { BlipStyle, EventKind, Phase, SweepStyle } from './types';
import { alongLine, BOAT_SVG, BOAT_TITLE, boatPhase, flowOut, RAINBOW_FLOW_TOTAL, RAINBOW_STAGGER_MS, surge, SURGE_TOTAL } from './flow';

export interface RadarItem {
  id: number;
  kind: EventKind;
  distanceKm: number;
  bearing: number;
  phase: Phase;
  /** 固定據點，畫成菱形 */
  spot?: boolean;
  /** 服務處、競選總部的固定據點，畫成房子形狀（店家、餐廳等是菱形） */
  office?: boolean;
  /** 約略位置，畫成空心 */
  approx?: boolean;
  /** 在圓圈裡但不在範圍內（選「雙北」時的基隆、桃園）：跟超出範圍的一樣畫小、畫淡 */
  outside?: boolean;
  /** 還沒開始的清楚程度：1 快開始了（清楚）… 0 一週以上（淡、模糊）；沒給就照原樣 */
  fade?: number;
  /** 光點下方的小字，例如還沒開始的「5小時」「2天」 */
  badge?: string;
  /** 車掃的起點、終點：畫成 🚩、🏁（不畫圓點） */
  flag?: string;
  label: string;
  showLabel: boolean;
  selected: boolean;
}

/** 雷達上的車掃路線：每個點的方位與距離 */
export interface RadarRoute {
  id: string;
  /** planned 還沒出發（虛線）；live 車掃中；done 已抵達（不畫） */
  state: 'planned' | 'live' | 'done';
  /** 畫成彩虹（同志遊行） */
  rainbow?: boolean;
  points: Array<{ bearing: number; distanceKm: number }>;
  /** 分開畫的幾段（遊行的北、南兩條路線同時走，各自從出發流到終點）；沒有就整條 points 一段 */
  parts?: Array<Array<{ bearing: number; distanceKm: number }>>;
  /** 洋流車掃（台北大洋流官方的）：路線畫成一道往前流的水（水紋、浪花），進行中再加每隔一段時間湧一次的浪 */
  ocean?: boolean;
  /** 彩虹從出發的地方流出、洋流湧過去：開始的時間（Date.now() 的毫秒）；沒有是不流 */
  flowAt?: number;
  /** 中間點（官方車掃轉彎的地方）：路線上的小圓點，title 是預計經過的時間和名稱；點了打開時間表 */
  marks?: Array<{ bearing: number; distanceKm: number; title: string }>;
  /** 洋流號：沿著路線一直重複開的船（動畫，不是車隊的實際位置） */
  boat?: boolean;
}

/** 放大時畫的街道：每條線是 [往東 km, 往北 km, 往東 km, …]（相對於圓心）；major 大路、minor 其他街道 */
export interface RadarStreets {
  major: Float64Array[];
  minor: Float64Array[];
}

/** 固定的地標（例如洋流總部），畫成星星 */
export interface RadarLandmark {
  id: string;
  label: string;
  bearing: number;
  distanceKm: number;
  selected: boolean;
}

/** 漂流瓶：far 遠的只是一團模糊訊號；near 200 m 內看得到瓶子；pick 走到撿得起來的距離 */
export interface RadarBottle {
  id: number;
  bearing: number;
  distanceKm: number;
  state: 'far' | 'near' | 'pick';
  mine: boolean;
  picked: boolean;
  selected: boolean;
  /** 範圍內沒有瓶子時，最近那一個貼在外圈指方向，旁邊寫這段文字（例如「1.2 km」） */
  hint?: string;
}

/** 瓶子的形狀（中心在原點，高約 16） */
const BOTTLE_PATH = 'M-1.8 -8 h3.6 v3 l2.4 3 v8.2 a1.6 1.6 0 0 1 -1.6 1.6 h-5.2 a1.6 1.6 0 0 1 -1.6 -1.6 v-8.2 l2.4 -3 z';
/** 遠的瓶子模糊成這麼大一團（公里），讓人只知道大概的方向和距離 */
const BOTTLE_FOG_KM = 0.15;

/** 全螢幕鋪滿時你的 GPS 位置（像 Google 地圖的藍點）：手動移動了位置時不在正中間；accuracyKm 是 GPS 誤差 */
export interface RadarYou {
  bearing: number;
  distanceKm: number;
  accuracyKm: number | null;
}

/** 點兩下放大：兩下的間隔、相距多少內才算，放大的動畫多久 */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
const TAP_ZOOM_MS = 500;
/**
 * 雙指縮放放開時手指還在快速捏合、張開：照當時的速度繼續縮放、慢慢停下（像 Google 地圖，捏越快滑越遠）。
 * 速度是 ln(倍數)／毫秒：量放開前多久的、快過多少才滑、放開前停多久就不滑、減速快慢（總共多滑 速度 × FLING_TAU_MS）、
 * 慢到多少就停、最多多滑幾倍
 */
const FLING_SAMPLE_MS = 100;
const FLING_MIN_SPEED = 0.0015;
const FLING_IDLE_MS = 60;
const FLING_TAU_MS = 150;
const FLING_STOP_SPEED = 0.0001;
const FLING_MAX = Math.log(3);
/**
 * 單指拖曳放開時手指還在快速移動：照當時的方向、速度繼續滑、慢慢停下（像 Google 地圖，甩越快滑越遠）。
 * 速度是螢幕像素／毫秒：量放開前多久的、快過多少才滑、最快算多少（總共最多滑 速度 × PAN_TAU_MS 像素）、減速快慢、慢到多少就停
 */
const PAN_FLING_MIN = 0.3;
const PAN_FLING_MAX = 3.5;
const PAN_TAU_MS = 250;
const PAN_STOP_SPEED = 0.02;
/** 滑鼠滾輪：一格約 0.2 秒滑過去（減速快慢），連續滾會疊上去（最多先疊幾格的量）；停了多久算縮放結束 */
const WHEEL_TAU_MS = 60;
const WHEEL_MAX = 1.5;
const WHEEL_DONE_MS = 200;
/** 點在這些東西上是點它（選光點、飛到星球…），不算點兩下放大 */
const TAP_TARGETS = '.blip, .landmark, .bottle, .dog-hit, .rocket-hit, .park-statue, .space-hit, .route-mark-hit, [role="button"]';

export interface RadarStyle {
  sweep: SweepStyle;
  blip: BlipStyle;
  rose: boolean;
}

const SIZE = 400;
const C = SIZE / 2;
const R = 172;
/** 定位點多大（螢幕像素，跟 Google 地圖一樣不管螢幕多大都一樣大）：白邊、藍點、方向光束多長；光束張多開（度） */
const YOU_RING_PX = 9;
const YOU_DOT_PX = 6;
const YOU_BEAM_PX = 42;
const YOU_BEAM_DEG = 32;
/** 雷達的大小（space.ts 畫太空用）：inner 是光點最遠擺到哪 */
export const RADAR_GEOM = { size: SIZE, c: C, r: R, inner: R - 8 };
/**
 * 雷達看得到的範圍（SVG 單位，以圓心為中心的半寬 hx、半高 hy）：平常只看圓裡面（fill = false）；
 * 全螢幕時雷達的地圖鋪滿整個長方形（fill = true，短邊的一半是 C，比例跟平常一樣），
 * space.ts、park.ts 照這個決定畫到多遠（viewReach、viewRect）；heading 是太空、中山公園那幾層跟著指北針轉了幾度（畫的時候北在上，整層再轉）
 */
export const RADAR_VIEW = { fill: false, hx: C, hy: C, heading: 0 };
/** 看得到的最遠（離圓心，SVG 單位）：平常是光點範圍（inner），鋪滿時是長方形的角 */
export const viewReach = (): number => (RADAR_VIEW.fill ? Math.hypot(RADAR_VIEW.hx, RADAR_VIEW.hy) : R - 8);
/** 看得到的方框（SVG 座標 [左, 上, 右, 下]，四周多留 m）：平常是整個正方形 */
export const viewRect = (m = 0): [number, number, number, number] =>
  RADAR_VIEW.fill ? [C - RADAR_VIEW.hx - m, C - RADAR_VIEW.hy - m, C + RADAR_VIEW.hx + m, C + RADAR_VIEW.hy + m] : [-m, -m, SIZE + m, SIZE + m];
/** 鋪滿時光點、地標離畫面邊緣至少多遠（SVG 單位），超出的貼在邊上 */
const FILL_INSET = 12;
/** 「全球」的範圍（半個地球）：再拉遠就是太空 */
export const SPACE_FROM_KM = 20040;
export const EARTH_KM = 6371;
/** 地球表面離圓心超過這個（四分之一圈）就在另一面，看不到 */
const HORIZON_KM = (Math.PI / 2) * EARTH_KM;
/** 太空裡地球小於這個（SVG 單位）就只剩一個點（space.ts 也是這個大小以上才畫海岸線）：光點、路線、地標都不畫，也不能拖 */
export const TINY_EARTH = 10;

/**
 * 太空裡地球的半徑是光點範圍（inner）的幾成：剛超過全球時塞滿雷達（接得上全球），
 * 拉遠到 4 倍以後照真實比例（跟外圈的公里數、月球、行星的距離一致），中間照對數慢慢接過去
 */
export function globeFrac(scaleKm: number): number {
  if (scaleKm <= SPACE_FROM_KM) return 1;
  const t = Math.min(1, Math.log(scaleKm / SPACE_FROM_KM) / Math.log(4));
  return (SPACE_FROM_KM / scaleKm) ** (1 - t) * (EARTH_KM / scaleKm) ** t;
}

/** 太陽系那幾層的看法：中心是哪一顆（null 是地球、你），繞中心左右轉、往下傾斜（弧度）；toward、u：中心往那一顆移了多少（火箭飛行，space.ts） */
export interface SpaceView {
  focus: string | null;
  yaw: number;
  pitch: number;
  toward?: string;
  u?: number;
}
/** 小火箭擺在哪、多大：底在 (x, y)、每公尺 k 像素（雷達的 SVG 座標，park.ts） */
export interface TripAt {
  x: number;
  y: number;
  k: number;
}
/** 太空的畫法（space.ts）：照範圍、地球半徑、3D 的看法畫成 SVG */
export type SpaceDraw = (scaleKm: number, earthR: number, view: SpaceView) => string;
/** 傾斜最多幾度（快要從側面看） */
const MAX_PITCH = (80 * Math.PI) / 180;
const SVG_NS = 'http://www.w3.org/2000/svg';
const ROSE: Array<[string, number]> = [
  ['N', 0],
  ['E', 90],
  ['S', 180],
  ['W', 270],
];

/** 掃描一圈幾秒（buildSweep 的動畫照這個）；波紋一個圈 5 秒擴散到外圈、兩個圈相隔 2.5 秒，所以每 2.5 秒掃過一次 */
const SWEEP_SEC: Record<SweepStyle, number> = { wedge: 4, needle: 6, ripple: 2.5 };
/** 扇形的前緣在旋轉角度 +45 度的地方 */
const WEDGE_LEAD_DEG = 45;
/** 多久看一次掃描線走到哪（毫秒） */
const FLASH_TICK_MS = 40;
/** 亮環最後放大到光點的幾倍 */
const RING_GROW = 3.2;
/**
 * 掃過時的閃光（毫秒，畫在閃光層）：光點後面一團淡淡的光暈、往外擴散一圈細環；光點本身稍微變亮見 BODY_FLASH。
 * 每一段都是「掃到的瞬間最亮，接著淡掉」，一圈裡其餘時間維持原狀。
 */
const FLASH_PARTS: Array<{ sel: string; ms: number; from: Keyframe; to: Keyframe }> = [
  { sel: '.fx-glow', ms: 500, from: { opacity: 0.6, transform: 'scale(1.3)' }, to: { opacity: 0, transform: 'scale(2.2)' } },
  // 亮環畫成最後的大小（3.2 倍），從 1/3.2 放大，線才不會跟著變粗
  { sel: '.fx-ring', ms: 700, from: { opacity: 0.6, transform: `scale(${1 / RING_GROW})` }, to: { opacity: 0, transform: 'scale(1)' } },
];
/** 光點本體亮一下：分兩段（最亮、一半亮），多久回原樣 */
const BODY_FLASH = ['', 'brightness(1.25) drop-shadow(0 0 2px rgba(255, 255, 255, 0.4))', 'brightness(1.5) drop-shadow(0 0 4px rgba(255, 255, 255, 0.8))'];
const BODY_FLASH_MS = 450;
const BODY_FLASH_MS_CALM = 600;
/** 系統設定「減少動態效果」時（Windows 關掉動畫效果的電腦常見）：不放大、不擴散，只亮一下 */
const FLASH_PARTS_CALM: typeof FLASH_PARTS = [
  { sel: '.fx-glow', ms: 600, from: { opacity: 0.6, transform: 'scale(1.6)' }, to: { opacity: 0, transform: 'scale(1.6)' } },
];
/** 會動的點（汪星的狗遠遠的白點）掃到時亮一下：淡淡的光暈，比光點的閃光淡、慢一點淡掉（減少動態效果時不放大） */
const GLINT: Keyframe[] = [{ opacity: 0.5, transform: 'scale(1.2)' }, { opacity: 0, transform: 'scale(1.7)' }];
const GLINT_CALM: Keyframe[] = [{ opacity: 0.5, transform: 'scale(1.4)' }, { opacity: 0, transform: 'scale(1.4)' }];
const GLINT_MS = 900;
/** 汪星的狗在樹冠底下、拉遠到還沒畫出狗（data-glint="strong"）：掃到時亮得明顯一點、多一圈亮環，看得出牠在哪 */
const GLINT_STRONG: Keyframe[] = [{ opacity: 0.95, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(2.4)' }];
const GLINT_STRONG_CALM: Keyframe[] = [{ opacity: 0.9, transform: 'scale(1.6)' }, { opacity: 0, transform: 'scale(1.6)' }];
const GLINT_STRONG_MS = 1300;
/** 明顯的光暈多大（SVG 單位，最小、最大：拉近時整隻狗很大，光暈不跟著那麼大） */
const GLINT_STRONG_R = [2.2, 6] as const;
/** 光暈至少多大（螢幕像素；手機上白點只有 2 像素左右，光暈跟著那麼小會看不出來） */
const GLINT_MIN_PX = 2.5;

/** 光點距離小於這個像素就合成一群 */
const GROUP_PX = 12;
/** 標籤每行高度 */
const LINE_PX = 14;

/** 距離換成半徑比例（0 = 圓心，1 = 外圈，超出範圍會大於 1），全部照比例 */
function radiusRatio(km: number, scaleKm: number): number {
  return km / scaleKm;
}

export function fmtKm(km: number): string {
  // 太空：幾萬、幾億公里
  if (km >= 1e8) return `${(km / 1e8).toFixed(km >= 1e9 ? 0 : 1)} 億 km`;
  if (km >= 1e5) return `${Math.round(km / 1e4)} 萬 km`;
  if (km >= 10) return `${Math.round(km)} km`;
  // 汪星的中山公園可以放大到 1 公尺以內：100 公尺內寫公尺、公分
  if (km < 0.1) {
    const m = km * 1000;
    if (m < 1) return `${Math.round(m * 100)} cm`;
    return `${m >= 10 ? Math.round(m) : Number.isInteger(m) ? m : m.toFixed(1)} m`;
  }
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

/** 靠近左右邊緣的標籤往內對齊，避免被雷達外框切掉 */
function anchorAt(x: number): 'start' | 'middle' | 'end' {
  return x > C + R * 0.45 ? 'end' : x < C - R * 0.45 ? 'start' : 'middle';
}

/** 五角星的路徑，r 是外接圓半徑 */
function starPath(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(rr * Math.sin(a)).toFixed(2)} ${(-rr * Math.cos(a)).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/** 以圓心為原點、0 度朝上順時針的極座標轉成 SVG 座標 */
function polar(deg: number, r: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: C + r * Math.sin(rad), y: C - r * Math.cos(rad) };
}

/**
 * SVG 雷達：使用者在圓心，光點依方位與距離擺放。
 * 顏色全部走 CSS 變數，掃描樣式與光點形狀由主題決定。
 * heading 不為 0 時以手機朝向為上，羅盤字會跟著移動，文字維持正立。
 */
export class Radar {
  /**
   * 雷達分好幾層，疊在一起：base 外框和底色、sweepBox 掃描（只放目前主題那一種，整層用 CSS 旋轉）、
   * fx 漂流瓶的霧和可撿範圍（小 SVG）、flashBox 擴散圈和掃到時的閃光（div，只動 transform、opacity）、
   * svg 主圖層（格線、道路、光點、文字，接觸控）。
   * 主圖層有一千多個元素，裡面只要有東西每一格在動，整層每一格都要重算樣式、排版、重畫（待機 CPU 兩成以上），
   * 所以會動的都搬出去；主圖層只在資料、範圍變了，或光點亮一下、閃爍換一段時才改
   */
  private readonly svg: SVGSVGElement;
  private readonly base: SVGSVGElement;
  private readonly sweepSvg: SVGSVGElement;
  /** 掃描層外面包的 div：扇形、指針轉的是它（SVG 元素的動畫 Chrome 不交給顯示晶片，div 的才會） */
  private readonly sweepBox: HTMLDivElement;
  /** 波紋的兩個圈（div）放在這個跟雷達同比例、置中的正方形裡 */
  private readonly sweepSquare: HTMLDivElement;
  private readonly fx: SVGSVGElement;
  private readonly fxLayer: SVGGElement;
  /**
   * 閃光層：掃到時的光暈、亮環用一般的 div 畫，只動 transform、opacity，整個交給顯示晶片
   * （SVG 裡的動畫每一格都要重畫整層）；square 是跟雷達同比例、置中的正方形，--u 是一個 SVG 單位幾像素
   */
  private readonly flashBox: HTMLDivElement;
  private readonly flashSquare: HTMLDivElement;
  /** 會動的點（汪星的狗遠遠的白點）掃到時的光暈：疊在主圖層上面（閃光層在主圖層下面，會被汪星的陸地、公園蓋住） */
  private readonly glintBox: HTMLDivElement;
  private readonly glintSquare: HTMLDivElement;
  /** 汪星的地形圖（雷達底色上面、掃描下面的 canvas，正方形對齊 SVG）、雷達的正方形幾像素、畫地形圖的（main.ts 給） */
  private readonly reliefCanvas: HTMLCanvasElement;
  private squarePx = 0;
  /** 雷達這一塊的大小（像素）：鋪滿時換算長方形 */
  private boxPx = { w: 0, h: 0 };
  /** 全螢幕：地圖鋪滿整個長方形（不裁成圓、沒有外框） */
  private fill = false;
  /** 鋪滿時看得到的範圍變了（換方向、改視窗大小）：main.ts 重抓道路 */
  onView?: () => void;
  private reliefPaint: ((out: Uint8ClampedArray, n: number, view: SpaceView, scaleKm: number, heading: number, j0?: number, j1?: number, span?: number) => number) | null = null;
  private reliefImage: ImageData | null = null;
  private flashOf = new WeakMap<SVGGElement, HTMLDivElement>();
  /** 主圖層的瓶子 → 特效層裡同位置、同 class（顏色照舊）的那一組 */
  private fxOf = new WeakMap<SVGGElement, SVGGElement>();
  /** 掃描動畫：掃到光點的時間照它的進度算；沒有（瀏覽器不支援）就不閃 */
  private sweepClock: Animation | null = null;
  private sweepAnims: Animation[] = [];
  /** 雷達有沒有顯示（切到地圖時沒有）：ResizeObserver 更新，不用每一格量大小（量大小會逼瀏覽器每一格重新排版） */
  private shown = true;
  /** 亮一下的光點本體：分兩段變暗，每一段才改一次樣式，不是每一格都改 */
  private lit: Array<{ el: SVGElement; at: number; ms: number; base: string; blur: string; level: number }> = [];
  /** 進行中的光點閃爍目前在第幾段（-1 是還沒開始） */
  private blinkStep = -1;
  private readonly blipLayer: SVGGElement;
  private readonly scaleLabels: SVGGElement;
  /** 全螢幕鋪滿時的比例尺（main.ts 給的，放在左下的按鈕上面）；沒有是 null */
  private scaleBarEl: HTMLElement | null = null;
  /** 全螢幕鋪滿、指北針轉的時候右上角的小指北針（main.ts 給的）；沒有是 null */
  private compassEl: HTMLElement | null = null;
  private readonly rings: SVGGElement;
  private readonly roseLayer: SVGGElement;
  private readonly routeLayer: SVGGElement;
  private routes: RadarRoute[] = [];
  private outline: Array<Array<{ bearing: number; distanceKm: number }>> = [];
  /** 不封閉的線（縣市交界），只畫虛線、不填色 */
  private outlineLines: Array<Array<{ bearing: number; distanceKm: number }>> = [];
  private readonly outlineLayer: SVGGElement;
  private streets: RadarStreets | null = null;
  private readonly streetLayer: SVGGElement;
  /** 地球上的中山公園（park.ts，跟汪星共用）：照雷達外圈的公里數畫成 SVG（北在上）；不在附近是 null */
  private parkDraw: ((scaleKm: number) => string) | null = null;
  private readonly parkLayer: SVGGElement;
  private landmarks: RadarLandmark[] = [];
  /** 你在哪一顆（搭火箭到汪星就在汪星）：在汪星時點地球只是看過去（跟別的星球一樣），不會回到你在地球的位置 */
  youOn: 'earth' | 'woof' = 'earth';
  /** 點了中山公園的銅像、停著的火箭（地球或汪星，拉近到畫出來時才點得到）：哪個世界的 */
  onStatue: ((world: 'earth' | 'woof') => void) | null = null;
  onRocket: ((world: 'earth' | 'woof') => void) | null = null;
  /** 點了汪星的狗（拉近到畫出整隻時才點得到）：哪一隻（data-dog） */
  onDog: ((id: string) => void) | null = null;
  /** 火箭飛行中畫在正中間的那一層（不跟著指北針轉） */
  private readonly tripLayer: SVGGElement;
  private bottles: RadarBottle[] = [];
  private readonly bottleLayer: SVGGElement;
  private readonly landmarkLayer: SVGGElement;
  private scaleKm = 5;
  /** 太空（比全球再遠）的畫法；還沒載入是 null */
  private spaceDraw: SpaceDraw | null = null;
  private spaceBodyKm: ((key: string) => number) | null = null;
  private readonly spaceLayer: SVGGElement;
  /** 太陽系那幾層的 3D 看法：拖曳繞中心轉、點星球換中心 */
  private spaceView: SpaceView = { focus: null, yaw: 0, pitch: 0 };
  /** 看法變了、拉回地球時通知外面（「回到我的位置」要不要顯示） */
  onSpaceMove: (() => void) | null = null;
  /** 點了車掃的中間點：打開那條車掃的時間表 */
  onRoute: ((id: string) => void) | null = null;
  /** 洋流號：路線在畫面上的折線（SVG 座標，cum 是每一點走了多遠）和船，每一格畫面照現在的時間擺；往哪邊開記在 boatLeft（重畫時接著用） */
  private boatTracks: Array<{ id: string; g: SVGGElement; flip: SVGGElement; xs: Float64Array; ys: Float64Array; cum: Float64Array }> = [];
  private readonly boatLeft = new Map<string, boolean>();
  private boatFrame = 0;
  private readonly stack: HTMLDivElement;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  /** 單指拖曳移動位置：按下的位置、上一次的位置、是不是已經開始拖（移動超過幾像素才算，免得點光點時不小心移動） */
  private panStart: { x: number; y: number } | null = null;
  private panLast: { x: number; y: number } | null = null;
  private panning = false;
  /** 剛拖完：放開時瀏覽器還會送一個 click，不要當成點光點 */
  private justPanned = false;
  /** 最近 FLING_SAMPLE_MS 拖到哪（螢幕像素），放開時算速度；放開後繼續滑（requestAnimationFrame 的編號） */
  private panTrail: Array<{ t: number; x: number; y: number }> = [];
  private panFling = 0;
  /** 點兩下放大的動畫（requestAnimationFrame 的編號） */
  private tapZoom = 0;
  private you: RadarYou | null = null;
  private youKey = '';
  private readonly youLayer: SVGGElement;
  private heading = 0;
  private items: RadarItem[] = [];
  private style: RadarStyle = { sweep: 'wedge', blip: 'dot', rose: false };
  private drawFrame = 0;
  /** 上次畫的內容，沒變就不重畫 */
  private itemsKey = '';
  private bottlesKey = '';
  private landmarksKey = '';
  /** 要在掃到時閃一下的節點，at 是一圈裡第幾毫秒被掃到；重畫後重新收集 */
  private flashTargets: Array<{ g: SVGGElement; at: number }> = [];
  private flashDirty = true;
  /** 上一格畫面時掃描線在一圈裡的第幾毫秒；-1 代表重新開始算 */
  private lastSweepMs = -1;
  private readonly calm = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  /**
   * onZoom(factor, done)：雙指捏合或滑鼠滾輪，factor > 1 代表拉遠（範圍變大）；
   * done = true 表示手勢結束。
   * onPan(bearing, km, done)：單指（或滑鼠）拖曳，中心要往 bearing 方向（0 = 北）移動 km 公里；done = true 表示放開
   */
  constructor(
    container: HTMLElement,
    onSelect: (id: number, group: number[]) => void,
    onZoom?: (factor: number, done: boolean) => void,
    onLandmark?: (id: string) => void,
    onBottle?: (id: number) => void,
    private readonly onPan?: (bearing: number, km: number, done: boolean) => void,
  ) {
    const layer = (cls: string): SVGSVGElement => el('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: cls, 'aria-hidden': 'true' }) as SVGSVGElement;
    this.base = layer('radar radar-layer radar-base');
    this.base.innerHTML = `
      <defs>
        <radialGradient id="rg-face" cx="50%" cy="50%" r="50%">
          <stop offset="0" class="face-stop-1" />
          <stop offset="1" class="face-stop-2" />
        </radialGradient>
        <radialGradient id="rg-face-fill" gradientUnits="userSpaceOnUse" cx="${C}" cy="${C}" r="${R}">
          <stop offset="0" class="face-stop-1" />
          <stop offset="1" class="face-stop-2" />
        </radialGradient>
      </defs>
      <rect class="face-fill" fill="url(#rg-face-fill)" />
      <circle class="bezel" cx="${C}" cy="${C}" r="${R + 16}" />
      <circle class="face" cx="${C}" cy="${C}" r="${R}" fill="url(#rg-face)" />`;
    this.reliefCanvas = document.createElement('canvas');
    this.reliefCanvas.className = 'radar-relief';
    this.reliefCanvas.setAttribute('aria-hidden', 'true');
    this.sweepSvg = layer('radar radar-sweep');
    this.sweepBox = document.createElement('div');
    this.sweepBox.className = 'radar-layer radar-sweep-box';
    this.sweepSquare = document.createElement('div');
    this.sweepSquare.className = 'radar-square';
    this.sweepBox.append(this.sweepSvg, this.sweepSquare);
    this.fx = layer('radar radar-layer radar-fx');
    this.flashBox = document.createElement('div');
    this.flashBox.className = 'radar radar-layer radar-flashes';
    this.flashSquare = document.createElement('div');
    this.flashSquare.className = 'radar-square radar-flash-square';
    this.flashBox.appendChild(this.flashSquare);
    this.glintBox = document.createElement('div');
    this.glintBox.className = 'radar radar-layer radar-flashes';
    this.glintSquare = document.createElement('div');
    this.glintSquare.className = 'radar-square radar-flash-square';
    this.glintBox.appendChild(this.glintSquare);
    this.fxLayer = el('g', { class: 'fx' }) as SVGGElement;
    this.fx.appendChild(this.fxLayer);
    this.svg = el('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'radar radar-main', role: 'img', 'aria-label': '雷達畫面' });
    this.svg.innerHTML = `
      <defs>
        <clipPath id="rg-clip"><circle cx="${C}" cy="${C}" r="${R}" /></clipPath>
        <filter id="rg-fog" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="5" /></filter>
        <radialGradient id="rg-you-beam" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${YOU_BEAM_PX}">
          <stop offset="0" class="you-beam-stop-1" />
          <stop offset="1" class="you-beam-stop-2" />
        </radialGradient>
      </defs>
      <g class="grid">
        <g class="rings"></g>
        <circle cx="${C}" cy="${C}" r="${R}" class="outer" />
        <line x1="${C}" y1="${C - R}" x2="${C}" y2="${C + R}" />
        <line x1="${C - R}" y1="${C}" x2="${C + R}" y2="${C}" />
      </g>
      <g class="streets" clip-path="url(#rg-clip)"></g>
      <g class="park" clip-path="url(#rg-clip)"></g>
      <g class="scale-labels"></g>
      <g class="outline" clip-path="url(#rg-clip)"></g>
      <g class="space" clip-path="url(#rg-clip)"></g>
      <g class="routes" clip-path="url(#rg-clip)"></g>
      <g class="bottles"></g>
      <circle class="me" cx="${C}" cy="${C}" r="5" />
      <g class="you"></g>
      <g class="blips"></g>
      <!-- 地標（星星）放在光點上面，疊在一起時也點得到 -->
      <g class="landmarks"></g>
      <g class="trip"></g>
      <g class="rose"></g>
    `;
    this.blipLayer = this.svg.querySelector('.blips') as SVGGElement;
    this.scaleLabels = this.svg.querySelector('.scale-labels') as SVGGElement;
    this.rings = this.svg.querySelector('.rings') as SVGGElement;
    this.roseLayer = this.svg.querySelector('.rose') as SVGGElement;
    this.routeLayer = this.svg.querySelector('.routes') as SVGGElement;
    this.routeLayer.addEventListener('click', (e) => {
      const id = (e.target as Element).closest<SVGElement>('.route-marks')?.dataset.route;
      if (id) this.onRoute?.(id);
    });
    this.outlineLayer = this.svg.querySelector('.outline') as SVGGElement;
    this.spaceLayer = this.svg.querySelector('.space') as SVGGElement;
    this.streetLayer = this.svg.querySelector('.streets') as SVGGElement;
    this.parkLayer = this.svg.querySelector('.park') as SVGGElement;
    this.tripLayer = this.svg.querySelector('.trip') as SVGGElement;
    this.landmarkLayer = this.svg.querySelector('.landmarks') as SVGGElement;
    this.youLayer = this.svg.querySelector('.you') as SVGGElement;
    this.bottleLayer = this.svg.querySelector('.bottles') as SVGGElement;
    this.bottleLayer.addEventListener('click', (e) => {
      const g = (e.target as Element).closest('.bottle') as SVGGElement | null;
      if (g?.dataset.id) onBottle?.(Number(g.dataset.id));
    });
    this.landmarkLayer.addEventListener('click', (e) => {
      const g = (e.target as Element).closest('.landmark') as SVGGElement | null;
      if (g?.dataset.id) onLandmark?.(g.dataset.id);
    });
    /** 點到中山公園的銅像、停著的火箭、汪星的小狗了沒（點到就交給 main.ts） */
    const parkTap = (e: Event, world: 'earth' | 'woof'): boolean => {
      const t = e.target as Element;
      const dog = t.closest('.dog-hit') ? (t.closest('.woof-dog') as SVGGElement | null)?.dataset.dog : undefined;
      if (dog) this.onDog?.(dog);
      else if (t.closest('.rocket-hit')) this.onRocket?.(world);
      else if (t.closest('.park-statue')) this.onStatue?.(world);
      else return false;
      return true;
    };
    // 太空：點星球飛過去（剛拖完放開的那一下不算）；汪星上的中山公園銅像、火箭
    this.spaceLayer.addEventListener('click', (e) => {
      if (parkTap(e, 'woof')) return;
      const g = (e.target as Element).closest('.space-hit') as SVGGElement | null;
      if (g?.dataset.body && !this.justPanned) this.focusOn(g.dataset.body);
    });
    this.parkLayer.addEventListener('click', (e) => parkTap(e, 'earth'));
    for (const [letter, deg] of ROSE) {
      const t = el('text', { class: `rose-letter rose-${letter.toLowerCase()}`, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'data-deg': deg });
      t.textContent = letter;
      this.roseLayer.appendChild(t);
    }
    this.blipLayer.addEventListener('click', (e) => {
      const g = (e.target as Element).closest('.blip') as SVGGElement | null;
      if (g?.dataset.id) onSelect(Number(g.dataset.id), (g.dataset.group ?? '').split(',').map(Number).filter(Boolean));
    });
    if (onZoom) this.wireZoom(onZoom);
    const stack = document.createElement('div');
    stack.className = 'radar-stack';
    this.stack = stack;
    stack.append(this.base, this.reliefCanvas, this.sweepBox, this.fx, this.flashBox, this.svg, this.glintBox);
    container.appendChild(stack);
    new ResizeObserver(([e]) => {
      const { width: w, height: h } = e.contentRect;
      this.shown = w > 0;
      // SVG 照比例縮放、置中（viewBox 是正方形；鋪滿時 viewBox 往長邊延伸，中間的正方形還是在一樣的地方）：閃光層的正方形跟著對齊
      const size = Math.min(w, h);
      for (const sq of [this.flashSquare, this.glintSquare, this.sweepSquare]) {
        Object.assign(sq.style, { width: `${size}px`, height: `${size}px`, left: `${(w - size) / 2}px`, top: `${(h - size) / 2}px` });
        sq.style.setProperty('--u', `${size / SIZE}px`);
      }
      this.boxPx = { w, h };
      // 地形圖照新的大小重畫
      const was = this.squarePx;
      this.squarePx = size;
      const [hx, hy] = [RADAR_VIEW.hx, RADAR_VIEW.hy];
      this.measureView();
      const moved = Math.abs(hx - RADAR_VIEW.hx) > 1 || Math.abs(hy - RADAR_VIEW.hy) > 1;
      this.placeRelief();
      if (Math.abs(was - size) > 1 || (this.fill && moved)) {
        this.reliefKey = '';
        this.paintRelief();
      }
      // 鋪滿時長方形變了：viewBox、掃描、光點擺到哪都要重算
      if (this.fill && moved) {
        this.applyView();
        this.onView?.();
      }
    }).observe(stack);
    this.setStyle(this.style);
    this.setScale(this.scaleKm);
    this.placeRose();
    // 每 40 毫秒看一次掃到哪（閃光最多晚 0.04 秒，看不出來）：用 requestAnimationFrame 的話，
    // 就算畫面沒變也逼瀏覽器每一格準備一次畫面；背景分頁時瀏覽器會自己放慢
    window.setInterval(this.tickFlash, FLASH_TICK_MS);
  }

  setStyle(s: RadarStyle): void {
    this.style = s;
    const cls = `radar sweep-${s.sweep} blip-${s.blip}${s.rose ? ' has-rose' : ''}`;
    const live = this.svg.classList.contains('heading-live');
    this.svg.setAttribute('class', `${cls} radar-main${live ? ' heading-live' : ''}`);
    this.base.setAttribute('class', `${cls} radar-layer radar-base`);
    this.sweepSvg.setAttribute('class', `${cls} radar-sweep`);
    this.fx.setAttribute('class', `${cls} radar-layer radar-fx`);
    this.flashBox.setAttribute('class', `${cls} radar-layer radar-flashes`);
    this.glintBox.setAttribute('class', `${cls} radar-layer radar-flashes`);
    this.buildSweep();
    this.lastSweepMs = -1;
    this.blinkStep = -1;
    this.draw();
  }

  /**
   * 全螢幕：雷達的地圖鋪滿整個長方形（不裁成圓、沒有外框），只留地圖和光點（距離圈、掃描線不畫，styles.css；看比例尺）；
   * 範圍外、還在畫面裡的光點畫在真的位置，畫面外的不畫
   */
  setFill(on: boolean): void {
    if (on === this.fill) return;
    this.fill = on;
    RADAR_VIEW.fill = on;
    this.stack.classList.toggle('fill', on);
    this.placeCompass();
    this.measureView();
    this.placeRelief();
    this.reliefKey = '';
    this.applyView();
    this.paintRelief();
  }

  /** 鋪滿了沒（main.ts：範圍外的光點照真的位置畫） */
  get filling(): boolean {
    return this.fill;
  }

  /** 看得到的最遠是範圍的幾倍（main.ts 抓道路用）：平常是 1 */
  get reach(): number {
    return viewReach() / (R - 8);
  }

  /** 照雷達這一塊的長寬比算看得到的範圍：短邊的一半是 C（跟平常的正方形一樣大） */
  private measureView(): void {
    const { w, h } = this.boxPx;
    if (w <= 0 || h <= 0) return;
    [RADAR_VIEW.hx, RADAR_VIEW.hy] = w >= h ? [(C * w) / h, C] : [C, (C * h) / w];
  }

  /** 換 viewBox（每一層一樣）、圓形裁切、底色、掃描，重畫 */
  private applyView(): void {
    const [x0, y0, x1, y1] = viewRect();
    const vb = `${x0.toFixed(1)} ${y0.toFixed(1)} ${(x1 - x0).toFixed(1)} ${(y1 - y0).toFixed(1)}`;
    for (const s of [this.base, this.sweepSvg, this.fx, this.svg]) s.setAttribute('viewBox', vb);
    this.svg.querySelector('#rg-clip circle')?.setAttribute('r', String(this.fill ? 100000 : R));
    const face = this.base.querySelector('.face-fill');
    if (face) for (const [k, v] of Object.entries({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 })) face.setAttribute(k, v.toFixed(1));
    this.base.querySelector('#rg-face-fill')?.setAttribute('r', viewReach().toFixed(1));
    this.buildSweep();
    this.lastSweepMs = -1;
    this.draw();
  }

  /**
   * 這個方向的光點最遠擺到哪（SVG 單位，離圓心）：平常是光點範圍（圓），鋪滿時是長方形的邊往內 inset
   * （inset 是負的就是畫到邊外面一點，給線條用）
   */
  private edgeR(angleDeg: number, inset = FILL_INSET): number {
    // 太空裡光點都在地球上（另一面的 ratio 是 2）：照圓
    if (!this.fill || this.inSpace) return R - 8;
    const a = (angleDeg * Math.PI) / 180;
    const [sx, sy] = [Math.abs(Math.sin(a)), Math.abs(Math.cos(a))];
    const [hx, hy] = [RADAR_VIEW.hx - inset, RADAR_VIEW.hy - inset];
    return Math.min(sx > 1e-9 ? hx / sx : Infinity, sy > 1e-9 ? hy / sy : Infinity);
  }

  /** 右上角的小指北針（main.ts 的 #mini-compass，裡面的 .mini-needle 跟著轉） */
  setCompass(el: HTMLElement): void {
    this.compassEl = el;
    this.placeCompass();
  }

  /** 小指北針：全螢幕鋪滿、指北針轉的時候才出現，針轉到北邊（手機朝東時北在左邊） */
  private placeCompass(): void {
    const el = this.compassEl;
    if (!el) return;
    el.hidden = !this.fill || !this.svg.classList.contains('heading-live');
    if (!el.hidden) el.querySelector<SVGGElement>('.mini-needle')?.setAttribute('transform', `rotate(${(-this.heading).toFixed(1)})`);
  }

  /** 全螢幕鋪滿時的比例尺放在哪（main.ts 的 #scale-bar，裡面的 span 寫距離） */
  setScaleBar(el: HTMLElement): void {
    this.scaleBarEl = el;
    this.drawScaleBar();
  }

  /**
   * 全螢幕鋪滿時的比例尺（距離圈、掃描線拿掉了，看這個知道多遠）：最長約 70 像素，取 1、2、5 開頭的整數距離。
   * 看整顆地球、太陽系時不畫（球面上各處比例不一樣）；中心換到汪星照比例畫
   */
  private drawScaleBar(): void {
    const bar = this.scaleBarEl;
    if (!bar) return;
    bar.hidden = !this.fill || !this.squarePx || (this.inSpace && this.spaceView.focus === null);
    if (bar.hidden) return;
    const pxPerKm = ((R - 8) / this.scaleKm) * (this.squarePx / SIZE);
    const want = 70 / pxPerKm;
    const p = 10 ** Math.floor(Math.log10(want));
    const km = [5, 2, 1].map((m) => m * p).find((v) => v <= want) ?? p;
    bar.style.width = `${(km * pxPerKm).toFixed(1)}px`;
    const label = bar.firstElementChild ?? bar.appendChild(document.createElement('span'));
    label.textContent = fmtKm(km);
  }

  /** 掃描線、波紋畫多長：平常到外圈，鋪滿時到畫面的角 */
  private get sweepR(): number {
    return this.fill ? viewReach() + 4 : R;
  }

  /**
   * 只建目前主題的那一種掃描。扇形、指針整層一起轉（CSS transform 交給顯示晶片，不用重畫）；
   * 波紋是兩個圈（div）放大、變淡，一個晚半圈：線跟著圈放大變粗（同時越來越淡），像水波擴散
   */
  private buildSweep(): void {
    for (const a of this.sweepAnims) a.cancel();
    this.sweepAnims = [];
    this.sweepClock = null;
    const svg = this.sweepSvg;
    const sweep = this.style.sweep;
    const period = SWEEP_SEC[sweep] * 1000;
    this.sweepSquare.replaceChildren();
    // 鋪滿時畫到畫面的角（比外圈長）
    const sr = this.sweepR;
    if (sweep === 'ripple') {
      svg.replaceChildren();
      for (let i = 0; i < 2; i++) {
        const ring = document.createElement('span');
        ring.className = 'ripple';
        Object.assign(ring.style, { left: `calc(${C - sr} * var(--u))`, top: `calc(${C - sr} * var(--u))`, width: `calc(${2 * sr} * var(--u))`, height: `calc(${2 * sr} * var(--u))` });
        this.sweepSquare.appendChild(ring);
      }
    } else if (sweep === 'needle') {
      svg.innerHTML = `<g class="sweep-needle"><line x1="${C}" y1="${C}" x2="${C}" y2="${(C - sr + 6).toFixed(1)}" /><circle cx="${C}" cy="${(C - R + 14).toFixed(1)}" r="4" /></g>`;
    } else {
      const end = polar(45, sr);
      svg.innerHTML = `
        <defs>
          <linearGradient id="rg-sweep" gradientUnits="userSpaceOnUse" x1="${C}" y1="${C}" x2="${(C + sr).toFixed(1)}" y2="${(C - sr).toFixed(1)}">
            <stop offset="0" class="sweep-stop-1" />
            <stop offset="1" class="sweep-stop-2" />
          </linearGradient>
        </defs>
        <path class="sweep-wedge" fill="url(#rg-sweep)" d="M ${C} ${C} L ${C} ${(C - sr).toFixed(2)} A ${sr.toFixed(2)} ${sr.toFixed(2)} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z" />`;
    }
    if (typeof this.sweepBox.animate !== 'function') return;
    if (sweep === 'ripple') {
      // 波紋一個圈擴散到外圈要兩倍的 SWEEP_SEC，兩個圈差半圈，所以每 SWEEP_SEC 秒掃過一次
      const grow = [
        { transform: 'scale(0)', opacity: 0.7 },
        { transform: 'scale(1)', opacity: 0 },
      ];
      this.sweepAnims = [...this.sweepSquare.children].map((c, i) => c.animate(grow, { duration: period * 2, iterations: Infinity, iterationStart: i * 0.5 }));
    } else {
      this.sweepAnims = [this.sweepBox.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: period, iterations: Infinity })];
    }
    this.sweepClock = this.sweepAnims[0] ?? null;
  }

  private wireZoom(onZoom: (factor: number, done: boolean) => void): void {
    const svg = this.svg;
    const dist = (): number => {
      const [a, b] = [...this.pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    // 網頁版用滑鼠拖曳時不要選到雷達上的字（公里數），選到之後瀏覽器會改成拖那段字，雷達就拖不動
    svg.addEventListener('dragstart', (e) => e.preventDefault());
    // 點兩下放大（像 Google 地圖；手機、滑鼠都可以）：這次按下的時間、有沒有用到兩根手指，上一次短短點一下在哪
    let downAt = 0;
    let multi = false;
    let lastTap: { t: number; x: number; y: number } | null = null;
    // 雙指縮放到現在縮了多少（ln），最近 FLING_SAMPLE_MS 的紀錄拿來算放開時的速度
    let pinchLog = 0;
    let pinchSamples: Array<{ t: number; z: number }> = [];
    const pinchSpeed = (t: number): number => {
      const first = pinchSamples[0];
      const last = pinchSamples[pinchSamples.length - 1];
      if (!first || last === first || t - last.t > FLING_IDLE_MS) return 0;
      return t - first.t >= 16 ? (last.z - first.z) / (t - first.t) : 0;
    };
    // 放開後繼續滑（requestAnimationFrame 的編號）：手指一碰到畫面（任何地方）或滾滾輪就停在那裡
    let fling = 0;
    const stopFling = (): void => {
      if (!fling) return;
      cancelAnimationFrame(fling);
      fling = 0;
      onZoom(1, true);
    };
    const startFling = (speed: number): void => {
      // 太空裡外面會把倍數平方：上限減半，一甩最多也是多滑 3 倍
      const max = (this.scaleKm >= SPACE_FROM_KM ? FLING_MAX / 2 : FLING_MAX) / FLING_TAU_MS;
      let v = Math.max(-max, Math.min(max, speed));
      let last = performance.now();
      const step = (now: number): void => {
        const dt = Math.min(50, Math.max(0, now - last));
        last = now;
        const decay = Math.exp(-dt / FLING_TAU_MS);
        const before = this.scaleKm;
        onZoom(Math.exp(v * FLING_TAU_MS * (1 - decay)), false);
        v *= decay;
        // 慢到看不出來，或已經到最近、最遠的限制
        if (Math.abs(v) < FLING_STOP_SPEED || (dt > 0 && this.scaleKm === before)) {
          fling = 0;
          onZoom(1, true);
          return;
        }
        fling = requestAnimationFrame(step);
      };
      fling = requestAnimationFrame(step);
    };
    const tap = (e: PointerEvent): void => {
      const hit = (e.target as Element).closest(TAP_TARGETS) as SVGElement | null;
      // 點在正中間那顆星球上（例如在汪星上）：點了也不會飛到哪，算點在空白的地方
      if (hit && !(hit.matches('.space-hit') && this.isFocus(hit.dataset.body ?? ''))) {
        lastTap = null;
        return;
      }
      const prev = lastTap;
      lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (prev && e.timeStamp - prev.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_PX) {
        lastTap = null;
        this.zoomInStep(onZoom);
      }
    };
    svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.pointerType === 'mouse') e.preventDefault();
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.panStart = { x: e.clientX, y: e.clientY };
        this.panLast = this.panStart;
        downAt = e.timeStamp;
        multi = false;
      }
      if (this.pointers.size === 2) {
        // 拖到一半放第二根手指：改成縮放
        this.endPan();
        this.pinchDist = dist();
        multi = true;
        pinchLog = 0;
        pinchSamples = [{ t: e.timeStamp, z: 0 }];
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.panMove(e);
        return;
      }
      if (this.pointers.size !== 2) return;
      const d = dist();
      if (this.pinchDist > 0 && d > 0) {
        onZoom(this.pinchDist / d, false);
        pinchLog += Math.log(this.pinchDist / d);
        pinchSamples.push({ t: e.timeStamp, z: pinchLog });
        // 留一筆比 FLING_SAMPLE_MS 早的，速度才算得到整段
        while (pinchSamples.length > 2 && e.timeStamp - pinchSamples[1].t >= FLING_SAMPLE_MS) pinchSamples.shift();
      }
      this.pinchDist = d;
    });
    const end = (e: PointerEvent): void => {
      if (!this.pointers.delete(e.pointerId)) return;
      // 短短點一下（沒拖、沒捏合）
      const tapped = e.type === 'pointerup' && this.pointers.size === 0 && !this.panning && !multi && e.timeStamp - downAt < DOUBLE_TAP_MS;
      // 放開時手指還在快速移動：繼續滑（減少動態效果、用過兩根手指時不滑）
      if (this.pointers.size === 0) this.endPan(e.type === 'pointerup' && !multi && !this.calm?.matches ? this.panSpeed(e.timeStamp) : null);
      if (this.pointers.size === 1 && this.pinchDist > 0) {
        // 放開第一根手指時還在快速捏合、張開：繼續滑（減少動態效果時不滑）
        const v = e.type === 'pointerup' ? pinchSpeed(e.timeStamp) : 0;
        if (Math.abs(v) >= FLING_MIN_SPEED && !this.calm?.matches) startFling(v);
        else onZoom(1, true);
      }
      if (this.pointers.size < 2) this.pinchDist = 0;
      // 縮放完剩一根手指：不接著拖
      this.panStart = null;
      this.panLast = null;
      if (tapped) tap(e);
    };
    // 剛拖完放開時的 click 不要選到光點、瓶子
    svg.addEventListener(
      'click',
      (e) => {
        if (!this.justPanned) return;
        e.stopPropagation();
        e.preventDefault();
      },
      true,
    );
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('pointerleave', end);
    // iOS Safari 的整頁縮放
    svg.addEventListener('gesturestart', (e) => e.preventDefault());
    // 滾輪滑順：每次滾的量先疊到 wheelLeft（ln），每一格畫面走剩下的一部分；走完、停了 WHEEL_DONE_MS 算縮放結束
    let wheelTimer = 0;
    let wheelLeft = 0;
    let wheelFrame = 0;
    let wheelLast = 0;
    const wheelDone = (): void => {
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => onZoom(1, true), WHEEL_DONE_MS);
    };
    const wheelStep = (now: number): void => {
      const dt = Math.min(50, Math.max(0, now - wheelLast));
      wheelLast = now;
      let move = wheelLeft * (1 - Math.exp(-dt / WHEEL_TAU_MS));
      if (Math.abs(wheelLeft - move) < 0.002) move = wheelLeft;
      wheelLeft -= move;
      onZoom(Math.exp(move), false);
      if (wheelLeft) {
        wheelFrame = requestAnimationFrame(wheelStep);
        return;
      }
      wheelFrame = 0;
      wheelDone();
    };
    const stopWheel = (): void => {
      if (!wheelFrame) return;
      cancelAnimationFrame(wheelFrame);
      wheelFrame = 0;
      wheelLeft = 0;
      window.clearTimeout(wheelTimer);
      onZoom(1, true);
    };
    document.addEventListener(
      'pointerdown',
      () => {
        stopFling();
        stopWheel();
        this.stopPanFling();
      },
      true,
    );
    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        stopFling();
        this.stopPanFling();
        // 一格滾輪約 100 像素；有的瀏覽器用「行」「頁」當單位
        const px = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1);
        const step = Math.max(-100, Math.min(100, px)) * 0.003;
        window.clearTimeout(wheelTimer);
        // 減少動態效果的電腦也照樣慢慢縮放（使用者要看得到縮放）
        wheelLeft = Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, wheelLeft + step));
        if (!wheelFrame) {
          wheelLast = performance.now();
          wheelFrame = requestAnimationFrame(wheelStep);
        }
      },
      { passive: false },
    );
  }

  /** 點兩下放大：範圍縮成一半（以正中間為準，跟捏合、滾輪一樣），0.5 秒慢慢拉近（減少動態效果的也一樣） */
  private zoomInStep(onZoom: (factor: number, done: boolean) => void): void {
    if (this.tapZoom) return;
    const total = Math.log(0.5);
    const t0 = performance.now();
    let done = 0;
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / TAP_ZOOM_MS);
      const eased = 1 - (1 - k) ** 3;
      onZoom(Math.exp(total * (eased - done)), false);
      done = eased;
      if (k < 1) {
        this.tapZoom = requestAnimationFrame(step);
        return;
      }
      this.tapZoom = 0;
      onZoom(1, true);
    };
    this.tapZoom = requestAnimationFrame(step);
  }

  /** 單指拖曳：移動超過 8 像素才開始；畫面上往哪拖，內容就往哪移，中心（你的位置）往反方向 */
  private panMove(e: PointerEvent): void {
    if (!this.onPan || !this.panStart || !this.panLast) return;
    if (!this.panning) {
      if (Math.hypot(e.clientX - this.panStart.x, e.clientY - this.panStart.y) < 8) return;
      this.panning = true;
      this.panTrail = [];
      this.svg.classList.add('panning');
      try {
        this.svg.setPointerCapture(e.pointerId);
      } catch {
        /* 有些瀏覽器拿不到 capture，照樣拖 */
      }
    }
    const [px, py] = [e.clientX - this.panLast.x, e.clientY - this.panLast.y];
    this.panLast = { x: e.clientX, y: e.clientY };
    // 留一筆比 FLING_SAMPLE_MS 早的，速度才算得到整段
    this.panTrail.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    while (this.panTrail.length > 2 && e.timeStamp - this.panTrail[1].t >= FLING_SAMPLE_MS) this.panTrail.shift();
    this.panBy(px, py);
  }

  /** 拖了（或放開後滑了）螢幕上 (px, py) 像素：移動你的位置，太空裡轉地球、轉視角 */
  private panBy(px: number, py: number): void {
    if (!this.onPan) return;
    const rect = this.svg.getBoundingClientRect();
    // 螢幕像素換成 SVG 座標（viewBox 是正方形，照短邊縮放）
    const unit = SIZE / Math.max(1, Math.min(rect.width, rect.height));
    const dx = px * unit;
    const dy = py * unit;
    const r = Math.hypot(dx, dy);
    if (r === 0) return;
    // 地球只剩一個點（太陽系那幾層）或中心換到別的星球：3D 轉視角（左右拖繞中心轉、上下拖傾斜），不動你的位置。
    // 太空那一層跟著指北針轉了 -heading，拖的方向要轉回來；拖過整個雷達的寬度轉半圈
    if (this.earthHidden) {
      const h = (this.heading * Math.PI) / 180;
      const lx = dx * Math.cos(h) - dy * Math.sin(h);
      const ly = dx * Math.sin(h) + dy * Math.cos(h);
      const v = this.spaceView;
      // 中心的星球大到比雷達還大（汪星可以放大到 1 km）：手指拖過表面多遠就轉多少
      const bodyR = v.focus && this.spaceBodyKm ? (this.spaceBodyKm(v.focus) * (R - 8)) / this.scaleKm : 0;
      const perUnit = Math.min(Math.PI / (2 * R), bodyR > 0 ? 1 / bodyR : Infinity);
      this.spaceView = { ...v, yaw: v.yaw + lx * perUnit, pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, v.pitch + ly * perUnit)) };
      this.drawSpace();
      this.onSpaceMove?.();
      return;
    }
    // 太空：轉動地球，手指拖過地球表面多遠就轉多少（照地球在雷達上的半徑換算）
    const km = this.inSpace ? (r / (globeFrac(this.scaleKm) * (R - 8))) * EARTH_KM : (r / (R - 8)) * this.scaleKm;
    // 內容往畫面上的 screen 方向移動；指北針模式要加回手機朝向；中心往反方向
    const screen = (Math.atan2(dx, -dy) * 180) / Math.PI;
    this.onPan(((screen + this.heading + 180) % 360 + 360) % 360, km, false);
  }

  /** 放開時的速度（螢幕像素／毫秒，太快的照最快算）；慢慢拖、停住再放開是 null */
  private panSpeed(t: number): { vx: number; vy: number } | null {
    const first = this.panTrail[0];
    const last = this.panTrail[this.panTrail.length - 1];
    if (!first || last === first || t - last.t > FLING_IDLE_MS || t - first.t < 16) return null;
    const [vx, vy] = [(last.x - first.x) / (t - first.t), (last.y - first.y) / (t - first.t)];
    const speed = Math.hypot(vx, vy);
    if (speed < PAN_FLING_MIN) return null;
    const k = Math.min(1, PAN_FLING_MAX / speed);
    return { vx: vx * k, vy: vy * k };
  }

  /** 放開：fling 是放開時的速度，有就繼續滑、停了才算拖完（放開兩根手指之一、慢慢放開都是 null） */
  private endPan(fling: { vx: number; vy: number } | null = null): void {
    if (!this.panning) return;
    this.panning = false;
    this.svg.classList.remove('panning');
    this.justPanned = true;
    window.setTimeout(() => {
      this.justPanned = false;
    }, 80);
    if (!fling) {
      this.panDone();
      return;
    }
    let { vx, vy } = fling;
    let last = performance.now();
    const step = (now: number): void => {
      const dt = Math.min(50, Math.max(0, now - last));
      last = now;
      const decay = Math.exp(-dt / PAN_TAU_MS);
      const k = PAN_TAU_MS * (1 - decay);
      this.panBy(vx * k, vy * k);
      vx *= decay;
      vy *= decay;
      if (Math.hypot(vx, vy) < PAN_STOP_SPEED) {
        this.panFling = 0;
        this.panDone();
        return;
      }
      this.panFling = requestAnimationFrame(step);
    };
    this.panFling = requestAnimationFrame(step);
  }

  /** 放開後還在滑：停在這裡（手指碰到畫面、滾滾輪） */
  private stopPanFling(): void {
    if (!this.panFling) return;
    cancelAnimationFrame(this.panFling);
    this.panFling = 0;
    this.panDone();
  }

  /** 拖完（滑完）：外面重抓資料；拖曳時地形圖畫粗一點（快），停了再畫細 */
  private panDone(): void {
    this.onPan?.(0, 0, true);
    this.paintRelief();
  }

  /** 照比例畫：外圈是範圍，裡面三圈是 1/4、1/2、3/4 */
  setScale(km: number): void {
    this.scaleKm = km;
    // 中心是你、拉近到看得出地球的形狀（或回到全球以內）：從正上方看你，轉過的視角轉回來；中心換到別的星球就一直維持（可以飛到月球再放大）
    if (!this.spaceView.focus && (this.spaceView.yaw || this.spaceView.pitch) && !this.tinyEarth) {
      this.spaceView = { focus: null, yaw: 0, pitch: 0 };
      this.onSpaceMove?.();
    }
    this.rings.replaceChildren();
    this.scaleLabels.replaceChildren();
    const marks = [0.25, 0.5, 0.75].map((f) => ({ km: f * km, label: f === 0.5 }));
    for (const m of marks) {
      const ratio = this.ringRatio(m.km);
      // 太空裡超過地球另一面的（ratio 是 2）在雷達外面：電腦版雷達兩旁還有空間，會露出一圈
      if (ratio > 1) continue;
      this.rings.appendChild(el('circle', { cx: C, cy: C, r: (ratio * R).toFixed(1) }));
      if (m.label) this.addScaleLabel(m.km);
    }
    if (this.ringRatio(km) <= 1) this.addScaleLabel(km);
    this.draw();
  }

  /** 刻度圈的半徑比例：中心換到別的星球時照比例（跟星球的畫法一樣），其他跟光點一樣 */
  private ringRatio(km: number): number {
    return this.spaceView.focus !== null ? km / this.scaleKm : this.ratio(km);
  }

  private addScaleLabel(km: number): void {
    const t = el('text', { x: C + 5, y: C - this.ringRatio(km) * R + 13, class: 'scale-label' });
    t.textContent = fmtKm(km);
    this.scaleLabels.appendChild(t);
  }

  /** 外圈（範圍）在螢幕上的半徑像素；雷達沒顯示時回傳 0 */
  rangePx(): number {
    const w = this.svg.getBoundingClientRect().width;
    return w > 0 ? (R * Math.min(w, this.svg.getBoundingClientRect().height)) / SIZE : 0;
  }

  /** 太空：光點照地球的球面擺（正射投影，離圓心的角度取 sin），另一面的回傳 2（範圍外） */
  private ratio(km: number): number {
    if (this.inSpace) return km <= HORIZON_KM ? globeFrac(this.scaleKm) * Math.sin(km / EARTH_KM) : 2;
    return radiusRatio(km, this.scaleKm);
  }

  /** 比全球再遠：太空；中心換到別的星球時（例如月球）拉近到全球以內也還是太空 */
  private get inSpace(): boolean {
    return this.scaleKm > SPACE_FROM_KM || this.spaceView.focus !== null;
  }

  /** 太空裡地球小到看不出光點在哪 */
  private get tinyEarth(): boolean {
    return this.inSpace && globeFrac(this.scaleKm) * (R - 8) < TINY_EARTH;
  }

  /** 光點、路線、地標不畫：地球只剩一個點，或看法變了（中心不是你、轉過視角） */
  private get earthHidden(): boolean {
    return this.tinyEarth || (this.inSpace && this.spaceMoved);
  }

  /** 太陽系那幾層的看法變了：中心換到別的星球，或轉過視角 */
  get spaceMoved(): boolean {
    const v = this.spaceView;
    return v.focus !== null || v.yaw !== 0 || v.pitch !== 0;
  }

  /** 中心換到別的星球了（月球、行星）：外面照太空處理，拉近到全球以內也是 */
  get spaceFocused(): boolean {
    return this.spaceView.focus !== null;
  }

  /** 中心是哪一顆（null 是地球、你） */
  get spaceFocusKey(): string | null {
    return this.spaceView.focus;
  }

  /** 太陽系那幾層現在的看法（中心、轉的角度） */
  get spaceViewNow(): SpaceView {
    return { ...this.spaceView };
  }

  /** 回到地球、從正上方看 */
  resetSpace(): void {
    if (!this.spaceMoved) return;
    this.spaceView = { focus: null, yaw: 0, pitch: 0 };
    this.setScale(this.scaleKm);
    this.onSpaceMove?.();
  }

  /** 直接換到這個看法（火箭飛到汪星：鏡頭從地球移到汪星、中心換成汪星、轉到中山公園）；quiet 是動畫中間的每一格（不通知 main.ts） */
  /**
   * 鏡頭跟著東西走（汪星的狗鎖定時每一格），不算使用者移動：每一格只移動很少，先把太空那一層平移過去（便宜），
   * 跟上次整層重畫差超過 16 個 SVG 單位或過了 1 秒才整層重畫（慢手機每一格重畫整顆汪星會掉到 20 fps）。
   * 平移照中心那顆的半徑換算：往東轉 Δyaw 是 r·cos(緯度)·Δyaw，往北轉 Δpitch 是 r·Δpitch（正中間附近）
   */
  followSpace(view: SpaceView): void {
    this.spaceView = { ...view };
    this.followUntil = performance.now() + 1500;
    const d = this.drawnView;
    const km = view.focus && this.spaceBodyKm ? this.spaceBodyKm(view.focus) : 0;
    if (!d || d.focus !== view.focus || !km || performance.now() - this.drawnAt > 1000) {
      this.drawSpace();
      return;
    }
    const r = (km * (R - 8)) / this.scaleKm;
    const [dx, dy] = [r * Math.cos(view.pitch) * (view.yaw - d.yaw), r * (view.pitch - d.pitch)];
    if (Math.hypot(dx, dy) > 16) {
      this.drawSpace();
      return;
    }
    // 平移裡面那一層（外面那一層有圓形的裁切、跟著指北針轉，裁切不能跟著移）；地形圖那一層一起移（照指北針轉過的方向、換成像素）
    this.spaceLayer.querySelector('.space-shift')?.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
    if (this.reliefCanvas.style.display !== 'none') {
      const h = (-this.heading * Math.PI) / 180;
      const u = this.squarePx / SIZE;
      this.reliefCanvas.style.transform = `translate(${((dx * Math.cos(h) - dy * Math.sin(h)) * u).toFixed(1)}px, ${((dx * Math.sin(h) + dy * Math.cos(h)) * u).toFixed(1)}px)`;
    }
  }

  /** 汪星的地形圖怎麼畫（main.ts：地形圖載好了、看得到汪星的地圖才畫；回傳要多不透明，0 是不畫）；null 是不畫 */
  setRelief(paint: ((out: Uint8ClampedArray, n: number, view: SpaceView, scaleKm: number, heading: number, j0?: number, j1?: number, span?: number) => number) | null): void {
    this.reliefPaint = paint;
    this.reliefKey = '';
    this.paintRelief();
  }

  /** 地形圖現在畫的是哪個看法（沒變就不重畫）、畫好細的了沒；停下來之後畫細的計時器、正在畫的是第幾次；鎖定跟著狗走到什麼時候 */
  private reliefKey = '';
  private reliefFine = false;
  private reliefTimer = 0;
  private reliefJob = 0;
  private followUntil = 0;

  /**
   * 畫汪星的地形圖：太空、有畫法才畫；看法沒變就不重畫（例如狗走完一段重畫整層）。canvas 照雷達的像素（CSS 放大到雷達的大小）：
   * 每次先馬上畫粗的（最多 220 見方，拖曳、縮放、火箭飛行時每一格都這樣），停下來 0.2 秒再畫細的（最多 800 見方）：
   * 細的分好幾格畫（每一格最多算 10 毫秒，算好再整張換上去，慢手機也不會卡），鎖定跟著狗走時先不畫細的
   */
  /** 地形圖畫多大一塊（SVG 單位，以圓心為中心的正方形）：平常是整個正方形，鋪滿時蓋住整個長方形 */
  private get reliefSpan(): number {
    return this.fill ? 2 * Math.max(RADAR_VIEW.hx, RADAR_VIEW.hy) : SIZE;
  }

  /** 地形圖那一層的位置：圓心對齊，大小是 reliefSpan */
  private placeRelief(): void {
    const { w, h } = this.boxPx;
    const px = (this.reliefSpan * this.squarePx) / SIZE;
    Object.assign(this.reliefCanvas.style, { width: `${px}px`, height: `${px}px`, left: `${(w - px) / 2}px`, top: `${(h - px) / 2}px` });
  }

  private paintRelief(fine = false): void {
    const c = this.reliefCanvas;
    const hide = (): void => {
      c.style.display = 'none';
      this.reliefKey = '';
    };
    window.clearTimeout(this.reliefTimer);
    if (!this.inSpace || !this.reliefPaint || !this.squarePx) return hide();
    const v = this.spaceView;
    const span = this.reliefSpan;
    const key = `${v.focus},${v.yaw},${v.pitch},${v.toward},${v.u},${this.scaleKm},${this.heading},${this.squarePx},${span.toFixed(0)}`;
    const job = ++this.reliefJob;
    const paint = this.reliefPaint;
    const [view, km, heading] = [{ ...v }, this.scaleKm, this.heading];
    const show = (img: ImageData, alpha: number): void => {
      if (c.width !== img.width) {
        c.width = img.width;
        c.height = img.width;
      }
      c.getContext('2d')?.putImageData(img, 0, 0);
      c.style.opacity = alpha.toFixed(2);
      c.style.transform = '';
      c.style.display = '';
    };
    const later = (): void => {
      this.reliefTimer = window.setTimeout(() => this.paintRelief(true), Math.max(200, this.followUntil - performance.now()));
    };
    const px = ((this.squarePx * span) / SIZE) * (window.devicePixelRatio || 1);
    if (!fine) {
      if (key === this.reliefKey && c.style.display !== 'none') {
        c.style.transform = '';
        if (!this.reliefFine) later();
        return;
      }
      const n = Math.max(64, Math.round(Math.min(px, 220)));
      if (!this.reliefImage || this.reliefImage.width !== n) this.reliefImage = new ImageData(n, n);
      const alpha = paint(this.reliefImage.data, n, view, km, heading, 0, n, span);
      if (alpha <= 0) return hide();
      show(this.reliefImage, alpha);
      this.reliefKey = key;
      this.reliefFine = n >= px;
      if (!this.reliefFine) later();
      return;
    }
    // 細的：鎖定跟著狗走時晚一點再畫；看法變了（又重畫了）就不畫這一張
    if (performance.now() < this.followUntil) return later();
    const n = Math.max(64, Math.round(Math.min(px, 800)));
    const img = new ImageData(n, n);
    let [j, alpha] = [0, 0];
    const run = (): void => {
      if (job !== this.reliefJob || key !== this.reliefKey) return;
      const t0 = performance.now();
      while (j < n && performance.now() - t0 < 10) {
        const j1 = Math.min(n, j + 16);
        alpha = paint(img.data, n, view, km, heading, j, j1, span);
        j = j1;
      }
      if (j < n) {
        requestAnimationFrame(run);
        return;
      }
      if (alpha > 0) show(img, alpha);
      this.reliefFine = true;
    };
    run();
  }

  setSpaceView(view: SpaceView, quiet = false): void {
    this.spaceView = { ...view };
    this.setScale(this.scaleKm);
    if (!quiet) this.onSpaceMove?.();
  }

  /**
   * 火箭飛行中：畫一支小火箭（空字串是收掉）；on 是整趟（點火到降落）不接受拖曳、縮放、點擊。
   * from、to：從地圖上火箭的位置和大小接手，1 秒內移到 to（雷達正中間）
   */
  setTrip(svg: string, on = svg !== '', from?: TripAt | null, to?: TripAt): void {
    this.tripLayer.innerHTML = svg;
    this.stack.classList.toggle('trip', on);
    if (!from || !to) return;
    this.moveTrip(from, 0);
    requestAnimationFrame(() => requestAnimationFrame(() => this.moveTrip(to, 1000)));
  }

  /** 小火箭慢慢移到這裡（底在 x, y、每公尺 k 像素），ms 是花多久 */
  moveTrip(to: TripAt, ms: number): void {
    const g = this.tripLayer.firstElementChild as SVGGElement | null;
    if (!g) return;
    g.style.transition = ms ? `transform ${ms}ms cubic-bezier(0.4, 0, 0.2, 1)` : 'none';
    g.style.transform = `translate(${to.x.toFixed(1)}px, ${to.y.toFixed(1)}px) scale(${to.k.toPrecision(4)})`;
  }

  /** 小火箭的頭轉向太空那一層的這個方向（順時針、0 是上，度；太空那一層跟著指北針轉了 -heading）；null 是轉回直立 */
  tiltTrip(deg: number | null, ms: number): void {
    const t = this.tripLayer.querySelector('.rocket-tilt') as SVGGElement | null;
    if (!t) return;
    const a = deg === null ? 0 : ((((deg - this.heading) % 360) + 540) % 360) - 180;
    t.style.transition = `transform ${ms}ms ease-in-out`;
    t.style.transform = `rotate(${a.toFixed(1)}deg)`;
  }

  /** 上次整層重畫太空時的看法、什麼時候（跟著狗走時中間只平移，followSpace） */
  private drawnView: SpaceView | null = null;
  private drawnAt = 0;

  /** 指北針轉了幾度（汪星的狗每一格自己轉回來、算面向哪） */
  get headingDeg(): number {
    return this.heading;
  }

  /** 起飛中的火箭在雷達上的位置和大小（底、每公尺幾像素，SVG 座標）：小火箭從這裡接手；沒畫出來是 null */
  rocketAt(): TripAt | null {
    const el = this.svg.querySelector('.park-launch .rocket-fly') as SVGGraphicsElement | null;
    const a = el?.getScreenCTM();
    const b = this.svg.getScreenCTM();
    if (!a || !b) return null;
    const m = b.inverse().multiply(a);
    return { x: m.e, y: m.f, k: Math.hypot(m.a, m.b) };
  }

  /** 這顆星球就是中心（點了 focusOn 不會變） */
  private isFocus(key: string): boolean {
    return (key === 'earth' && this.youOn === 'earth' ? null : key) === this.spaceView.focus;
  }

  /** 點了星球：飛過去當中心（你在地球時點地球就回到你），視角維持 */
  private focusOn(key: string): void {
    if (this.isFocus(key)) return;
    const focus = key === 'earth' && this.youOn === 'earth' ? null : key;
    this.spaceView = { ...this.spaceView, focus };
    this.setScale(this.scaleKm);
    this.onSpaceMove?.();
  }

  /** 太空（比全球再遠）的畫法：地球、月球、太陽、行星（space.ts，第一次用到才載入）；null 是還沒載入。bodyKm：星球的半徑（公里） */
  setSpace(draw: SpaceDraw | null, bodyKm?: (key: string) => number): void {
    this.spaceDraw = draw;
    this.spaceBodyKm = bodyKm ?? null;
    this.draw();
  }

  /** 中山公園要重畫（火箭的每一段開始、結束）：地球上重畫公園那一層，在太空裡重畫太空那一層（汪星） */
  redrawPark(): void {
    if (this.inSpace) this.drawSpace();
    else this.drawPark();
  }

  /** 太空裡的東西載入了（例如汪星的街道圖磚）：只重畫太空那一層 */
  redrawSpace(): void {
    if (this.inSpace) this.drawSpace();
  }

  /** 太空：畫在海岸線那一層，跟著指北針轉；平常清空 */
  private drawSpace(): void {
    this.stack.classList.toggle('space', this.inSpace);
    this.stack.classList.toggle('space-moved', this.inSpace && this.spaceView.focus !== null);
    if (!this.inSpace || !this.spaceDraw) {
      if (this.spaceLayer.firstChild) this.spaceLayer.replaceChildren();
      this.paintRelief();
      return;
    }
    this.spaceLayer.innerHTML = `<g class="space-shift">${this.spaceDraw(this.scaleKm, globeFrac(this.scaleKm) * (R - 8), this.spaceView)}</g>`;
    if (this.heading) this.spaceLayer.setAttribute('transform', `rotate(${(-this.heading).toFixed(1)} ${C} ${C})`);
    else this.spaceLayer.removeAttribute('transform');
    this.drawnView = { ...this.spaceView };
    this.drawnAt = performance.now();
    this.paintRelief();
    this.standUp(this.spaceLayer);
  }

  /**
   * 畫成立體、站著的東西（中山公園的銅像，data-at 是它站的地方，面向東邊）：整層跟著指北針轉了 -heading，它自己轉回來，在畫面上一直站著；
   * 東邊轉到畫面左邊時左右翻過來，還是面向東邊（data-flip="no" 的只轉不翻：小狗頭上的「汪！」）
   */
  private standUp(layer: SVGGElement): void {
    if (!this.heading) return;
    const flip = Math.cos((this.heading * Math.PI) / 180) < 0;
    for (const el of layer.querySelectorAll<SVGGElement>('[data-at]')) {
      const at = el.dataset.at ?? '0 0';
      const back = at.split(' ').map((v) => -Number(v)).join(' ');
      el.setAttribute('transform', `rotate(${this.heading.toFixed(1)} ${at})${flip && el.dataset.flip !== 'no' ? ` translate(${at}) scale(-1 1) translate(${back})` : ''}`);
    }
  }

  /** 手機朝向（0 = 北，順時針）。null 代表關閉指北針，恢復北在上 */
  setHeading(deg: number | null): void {
    this.heading = deg === null ? 0 : ((deg % 360) + 360) % 360;
    RADAR_VIEW.heading = this.heading;
    this.svg.classList.toggle('heading-live', deg !== null);
    this.placeRose();
    this.draw();
  }

  render(items: RadarItem[], routes: RadarRoute[] = []): void {
    // 每 5 秒重算一次，內容沒變就不重畫；淡的程度差不到 0.05 看不出來，當作沒變
    const key = JSON.stringify([items, routes], (k, v: unknown) => (k === 'fade' && typeof v === 'number' ? Math.round(v * 20) : v));
    if (key === this.itemsKey) return;
    this.itemsKey = key;
    this.items = items;
    this.routes = routes;
    this.draw();
  }

  /** 範圍的實際形狀（例如雙北的縣市界），畫成淡淡的輪廓；空陣列就不畫 */
  setOutline(rings: Array<Array<{ bearing: number; distanceKm: number }>>, lines: Array<Array<{ bearing: number; distanceKm: number }>> = []): void {
    this.outline = rings;
    this.outlineLines = lines;
    this.draw();
  }

  /** 放大時的街道；null 不畫 */
  setStreets(s: RadarStreets | null): void {
    this.streets = s;
    this.draw();
  }

  /** 地球上的中山公園（畫在街道上面）；null 不畫 */
  setPark(draw: ((scaleKm: number) => string) | null): void {
    if (draw === this.parkDraw) return;
    this.parkDraw = draw;
    this.draw();
  }

  /** 漂流瓶，畫在光點下面 */
  setBottles(list: RadarBottle[]): void {
    const key = JSON.stringify(list);
    if (key === this.bottlesKey) return;
    this.bottlesKey = key;
    this.bottles = list;
    this.draw();
  }

  private drawBottles(): void {
    this.bottleLayer.replaceChildren();
    for (const b of this.bottles) {
      const ratio = this.ratio(b.distanceKm);
      const angle = b.bearing - this.heading;
      // 範圍外（鋪滿時是畫面外）的瓶子不畫，免得外圈擠滿；只有方向提示的那一個貼在外圈（太空不畫）
      const lim = this.edgeR(angle);
      const beyond = ratio * (R - 8) > lim;
      if (this.earthHidden || (beyond && (!b.hint || this.inSpace || this.fill))) continue;
      const r = Math.min(ratio * (R - 8), lim);
      const p = polar(angle, r);
      if (beyond) {
        this.bottleLayer.appendChild(this.bottleHint(b, p));
        continue;
      }
      const g = el('g', {
        class: `bottle bottle-${b.state}${b.mine ? ' mine' : ''}${b.picked ? ' picked' : ''}${b.selected ? ' selected' : ''}`,
        transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`,
        tabindex: 0,
        role: 'button',
      });
      g.dataset.id = String(b.id);
      g.appendChild(el('circle', { class: 'hit', r: 14 }));
      if (b.state === 'far') {
        // 一團模糊的訊號：大小跟著比例，只看得出大概在哪
        const fog = Math.max(7, Math.min(22, (BOTTLE_FOG_KM / this.scaleKm) * (R - 8)));
        this.fxTwin(g).appendChild(el('circle', { class: 'fog', r: fog.toFixed(1), filter: 'url(#rg-fog)' }));
      } else {
        if (b.state === 'pick') this.fxTwin(g).appendChild(el('circle', { class: 'reach', r: 9 }));
        const body = el('g', { class: 'body' });
        body.appendChild(el('path', { class: 'glass', d: BOTTLE_PATH, transform: 'rotate(-20)' }));
        g.appendChild(body);
        this.addFlash(g, angle, r, 7);
      }
      const title = el('title');
      title.textContent = b.mine ? '你丟的漂流瓶' : b.state === 'pick' ? '漂流瓶（撿得到了）' : '漂流瓶';
      g.appendChild(title);
      this.bottleLayer.appendChild(g);
    }
  }

  /** 外圈的方向提示：小瓶子加距離，點了一樣打開瓶子 */
  private bottleHint(b: RadarBottle, p: { x: number; y: number }): SVGGElement {
    const g = el('g', { class: `bottle bottle-hint${b.selected ? ' selected' : ''}`, transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`, tabindex: 0, role: 'button' });
    g.dataset.id = String(b.id);
    g.appendChild(el('circle', { class: 'hit', r: 14 }));
    const body = el('g', { class: 'body' });
    body.appendChild(el('path', { class: 'glass', d: BOTTLE_PATH, transform: 'rotate(-20) scale(0.8)' }));
    g.appendChild(body);
    // 字寫在瓶子往圓心那一側，才不會跑出雷達
    const anchor = anchorAt(p.x);
    const inward = p.y > C ? -14 : 22;
    const t = el('text', { class: 'hint-label', 'text-anchor': anchor, x: anchor === 'end' ? -10 : anchor === 'start' ? 10 : 0, y: anchor === 'middle' ? inward : 4 });
    t.textContent = b.hint ?? '';
    g.appendChild(t);
    const title = el('title');
    title.textContent = `最近的漂流瓶在這個方向，${b.hint ?? ''}`;
    g.appendChild(title);
    return g;
  }

  /** 固定地標（星星），畫在光點上面，超出範圍時貼在外圈 */
  setLandmarks(list: RadarLandmark[]): void {
    const key = JSON.stringify(list);
    if (key === this.landmarksKey) return;
    this.landmarksKey = key;
    this.landmarks = list;
    this.draw();
  }

  private drawLandmarks(): void {
    this.landmarkLayer.replaceChildren();
    for (const lm of this.landmarks) {
      const ratio = this.ratio(lm.distanceKm);
      const lim = this.edgeR(lm.bearing - this.heading);
      const out = ratio * (R - 8) > lim;
      // 太空裡範圍外的不畫；全螢幕鋪滿時畫面外的也不畫
      if ((this.inSpace || this.fill) && (out || this.earthHidden)) continue;
      const lr = Math.min(ratio * (R - 8), lim);
      const p = polar(lm.bearing - this.heading, lr);
      const g = el('g', { class: `landmark${out ? ' out' : ''}${lm.selected ? ' selected' : ''}`, transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`, tabindex: 0, role: 'button' });
      g.dataset.id = lm.id;
      // 點擊範圍比光點小一點，旁邊的光點還點得到
      g.appendChild(el('circle', { class: 'hit', r: 13 }));
      const body = el('g', { class: 'body' });
      body.appendChild(el('path', { class: 'star', d: starPath(out ? 7 : 10) }));
      g.appendChild(body);
      this.addFlash(g, lm.bearing - this.heading, lr, out ? 6 : 9);
      // 平常不寫名稱，點了（選取中）才在星星下面顯示
      if (lm.selected) {
        const anchor = anchorAt(p.x);
        const t = el('text', { class: 'label', 'text-anchor': anchor, x: anchor === 'end' ? 8 : anchor === 'start' ? -8 : 0, y: 24 });
        t.textContent = lm.label;
        g.appendChild(t);
      }
      const title = el('title');
      title.textContent = lm.label;
      g.appendChild(title);
      this.landmarkLayer.appendChild(g);
    }
  }

  /** 你的 GPS 位置（全螢幕鋪滿時才畫）；null 是不知道（還沒定位、定位被拒） */
  setYou(you: RadarYou | null): void {
    const key = JSON.stringify(you);
    if (key === this.youKey) return;
    this.youKey = key;
    this.you = you;
    this.drawYou();
  }

  /**
   * 全螢幕鋪滿時（正中間的點拿掉了）像 Google 地圖一樣畫你的位置：白邊的藍點、淡藍的誤差圈，
   * 開了指北針再加一道朝手機方向的光（雷達跟著轉，所以一直朝上）。拖曳、設定位置移開了就跟著地圖走，畫面外不畫；太空裡不畫
   */
  private drawYou(): void {
    this.youLayer.replaceChildren();
    const you = this.you;
    if (!you || !this.fill || this.inSpace) return;
    const angle = you.bearing - this.heading;
    const r = this.ratio(you.distanceKm) * (R - 8);
    if (r > this.edgeR(angle, -10)) return;
    const p = r > 0 ? polar(angle, r) : { x: C, y: C };
    // 點、光束照螢幕像素畫（一個 SVG 單位是幾像素：短邊 = SIZE），裡面的形狀用 scale 縮回來
    const px = this.squarePx > 0 ? this.squarePx / SIZE : 1;
    const g = el('g', { transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) scale(${(1 / px).toFixed(4)})` });
    // 誤差圈（像素）比白邊還小就不畫
    const acc = you.accuracyKm ? (you.accuracyKm / this.scaleKm) * (R - 8) * px : 0;
    if (acc > YOU_RING_PX + 1) g.appendChild(el('circle', { class: 'you-accuracy', r: acc.toFixed(1) }));
    if (this.svg.classList.contains('heading-live')) {
      const a = polar(-YOU_BEAM_DEG, YOU_BEAM_PX);
      const b = polar(YOU_BEAM_DEG, YOU_BEAM_PX);
      const [ax, ay, bx, by] = [a.x - C, a.y - C, b.x - C, b.y - C].map((v) => v.toFixed(1));
      // 光束從點往外越來越淡（漸層的圓心在點上，照這一層的像素座標）
      g.appendChild(el('path', { class: 'you-beam', fill: 'url(#rg-you-beam)', d: `M 0 0 L ${ax} ${ay} A ${YOU_BEAM_PX} ${YOU_BEAM_PX} 0 0 1 ${bx} ${by} Z` }));
    }
    g.appendChild(el('circle', { class: 'you-ring', r: YOU_RING_PX }));
    g.appendChild(el('circle', { class: 'you-dot', r: YOU_DOT_PX }));
    const title = el('title');
    title.textContent = '你的位置';
    g.appendChild(title);
    this.youLayer.appendChild(g);
  }

  private pathOf(points: Array<{ bearing: number; distanceKm: number }>, close = false): string {
    const d = points
      .map((pt, i) => {
        const p = polar(pt.bearing - this.heading, this.ratio(pt.distanceKm) * (R - 8));
        return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      })
      .join(' ');
    return close ? `${d} Z` : d;
  }

  /** 街道：大路、其他街道各合成一條 path（線很多，一條一個元素太慢） */
  private drawStreets(): void {
    this.streetLayer.replaceChildren();
    const s = this.streets;
    if (!s || this.inSpace) return;
    const k = (R - 8) / this.scaleKm;
    const h = (this.heading * Math.PI) / 180;
    const cos = Math.cos(h);
    const sin = Math.sin(h);
    const lim2 = (this.scaleKm * this.reach * 1.05) ** 2;
    for (const [cls, lines] of [
      ['street-minor', s.minor],
      ['street-major', s.major],
    ] as const) {
      let d = '';
      for (const l of lines) d += this.streetPath(l, k, cos, sin, lim2);
      if (d) this.streetLayer.appendChild(el('path', { class: cls, d }));
    }
  }

  /**
   * 一條街：外圈外面的點，前後一點在圈內的才留（線畫到外圈再被裁掉），都在外面的斷開；
   * 畫面上離上一點不到 1.5 像素的省略。手機朝向轉了就跟著轉
   */
  private streetPath(l: Float64Array, k: number, cos: number, sin: number, lim2: number): string {
    const n = l.length / 2;
    const near = (i: number): boolean => i >= 0 && i < n && l[2 * i] ** 2 + l[2 * i + 1] ** 2 <= lim2;
    let d = '';
    let pen = false;
    let px = 0;
    let py = 0;
    for (let i = 0; i < n; i++) {
      if (!near(i) && !near(i - 1) && !near(i + 1)) {
        pen = false;
        continue;
      }
      const dx = l[2 * i];
      const dy = l[2 * i + 1];
      const x = C + k * (dx * cos - dy * sin);
      const y = C - k * (dy * cos + dx * sin);
      if (pen && i < n - 1 && Math.abs(x - px) + Math.abs(y - py) < 1.5) continue;
      d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
      pen = true;
      px = x;
      py = y;
    }
    return d;
  }

  /** 中山公園：北在上畫好，整層跟著指北針轉（跟太空一樣）；太空裡不畫 */
  private drawPark(): void {
    const svg = this.parkDraw && !this.inSpace ? this.parkDraw(this.scaleKm) : '';
    if (!svg) {
      if (this.parkLayer.firstChild) this.parkLayer.replaceChildren();
      return;
    }
    this.parkLayer.innerHTML = svg;
    if (this.heading) this.parkLayer.setAttribute('transform', `rotate(${(-this.heading).toFixed(1)} ${C} ${C})`);
    else this.parkLayer.removeAttribute('transform');
    this.standUp(this.parkLayer);
  }

  private drawOutline(): void {
    this.outlineLayer.replaceChildren();
    // 太空：陸地畫在地球上（space.ts）
    if (this.inSpace) return;
    for (const ring of this.outline) {
      if (ring.length < 3) continue;
      const p = this.outlinePath(ring);
      // 斷開的只畫線、不填色（填色會把斷開的兩端直接連起來）
      if (p) this.outlineLayer.appendChild(el('path', { class: `region-outline${p.closed ? '' : ' open'}`, d: p.d }));
    }
    // 縣市交界合成一條 path
    const d = this.outlineLines.map((l) => this.outlinePath(l, true)?.d ?? '').join(' ');
    if (d.trim()) this.outlineLayer.appendChild(el('path', { class: 'region-outline open county-line', d }));
  }

  /**
   * 輪廓：超出外圈的點不畫（縮放到比全台小時，台灣、對岸的海岸線大多在外面），
   * 相鄰兩點在畫面上離太遠也斷開（「全球」時地球另一面的海岸線會被拉得很長）；整圈都畫到的才封閉。
   */
  private outlinePath(ring: Array<{ bearing: number; distanceKm: number }>, open = false): { d: string; closed: boolean } | null {
    const maxJump = (R - 8) * 0.3;
    let prev: { x: number; y: number } | null = null;
    let broken = false;
    const parts: string[] = [];
    for (const pt of ring) {
      const ratio = this.ratio(pt.distanceKm);
      // 鋪滿時畫到畫面外面一點（線才會接到邊上）
      if (ratio * (R - 8) > (this.fill ? this.edgeR(pt.bearing - this.heading, -40) : R - 8)) {
        prev = null;
        broken = true;
        continue;
      }
      const p = polar(pt.bearing - this.heading, ratio * (R - 8));
      const jump = prev !== null && Math.hypot(p.x - prev.x, p.y - prev.y) > maxJump;
      if (jump) broken = true;
      parts.push(`${prev === null || jump ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
      prev = p;
    }
    if (parts.length < 2) return null;
    return broken || open ? { d: parts.join(' '), closed: false } : { d: `${parts.join(' ')} Z`, closed: true };
  }

  /** 路線畫在光點下面；超出範圍的部分被外圈裁掉 */
  private drawRoutes(): void {
    this.routeLayer.replaceChildren();
    this.boatTracks = [];
    for (const r of this.routes) {
      if (r.state === 'done' || r.points.length < 2 || this.earthHidden) continue;
      // 太空：有一段在地球另一面就不畫（直線會穿過地球）
      if (this.inSpace && r.points.some((pt) => pt.distanceKm > HORIZON_KM)) continue;
      const d = this.pathOf(r.points);
      // 彩虹：六條由粗到細疊起來（紅在最外、紫在中間）；遊行剛出發時從出發的地方流到終點（每一段同時流，重畫時接著流）
      if (r.rainbow) {
        const ago = r.flowAt !== undefined ? Date.now() - r.flowAt : Infinity;
        for (const part of r.parts ?? [r.points]) {
          const g = el('g', { class: `route-rainbow route-${r.state}` });
          const pd = r.parts ? this.pathOf(part) : d;
          for (let i = 0; i < 6; i++) g.appendChild(el('path', { class: `rainbow-${i}`, d: pd }));
          this.routeLayer.appendChild(g);
          if (ago < RAINBOW_FLOW_TOTAL) [...g.children].forEach((p, i) => flowOut(p as SVGPathElement, ago - i * RAINBOW_STAGGER_MS));
        }
        continue;
      }
      // 洋流車掃：整條路線是一道水流（路線下面淡藍的水，上面深藍的水紋、白色的浪花用不同的速度往前流）；
      // 進行中剛出發、之後每隔一段時間，深藍、淺藍的浪從出發的地方湧到終點再淡掉
      if (r.ocean) this.routeLayer.appendChild(el('path', { class: 'route-water', d }));
      this.routeLayer.appendChild(el('path', { class: `route route-${r.state}${r.ocean ? ' route-ocean-line' : ''}`, d }));
      if (r.ocean) {
        const g = el('g', { class: 'route-ocean' });
        const waves = r.state === 'live' ? [el('path', { class: 'ocean-surge ocean-deep', d }), el('path', { class: 'ocean-surge ocean-light', d })] : [];
        g.append(...waves, el('path', { class: 'water-flow', d }), el('path', { class: 'water-glint', d }));
        this.routeLayer.appendChild(g);
        const ago = r.flowAt !== undefined ? Date.now() - r.flowAt : Infinity;
        if (ago < SURGE_TOTAL) waves.forEach((w, i) => surge(w as SVGPathElement, ago - i * RAINBOW_STAGGER_MS));
      }
      // 中間點：路線上的小圓點（點的範圍大一點，手指點得到）
      if (r.marks?.length) {
        const g = el('g', { class: 'route-marks', 'data-route': r.id });
        for (const m of r.marks) {
          const p = polar(m.bearing - this.heading, this.ratio(m.distanceKm) * (R - 8));
          const [cx, cy] = [p.x.toFixed(1), p.y.toFixed(1)];
          const hit = el('circle', { class: 'route-mark-hit', cx, cy, r: 9 });
          const t = el('title');
          t.textContent = m.title;
          hit.appendChild(t);
          g.append(el('circle', { class: 'route-mark', cx, cy, r: 2.6 }), hit);
        }
        this.routeLayer.appendChild(g);
      }
      if (r.boat) this.addBoat(r);
    }
    this.moveBoats();
  }

  /** 洋流號：照畫面上的路線（跟 pathOf 一樣的座標）記下折線，船畫成螢幕像素的大小（moveBoats 擺位置） */
  private addBoat(r: RadarRoute): void {
    const n = r.points.length;
    const [xs, ys, cum] = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
    r.points.forEach((pt, i) => {
      const p = polar(pt.bearing - this.heading, this.ratio(pt.distanceKm) * (R - 8));
      [xs[i], ys[i]] = [p.x, p.y];
      cum[i] = i > 0 ? cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]) : 0;
    });
    if (!(cum[n - 1] > 0)) return;
    const g = el('g', { class: 'route-boat' }) as SVGGElement;
    g.innerHTML = `<title>${BOAT_TITLE}</title>${BOAT_SVG}`;
    this.routeLayer.appendChild(g);
    this.boatTracks.push({ id: r.id, g, flip: g.querySelector('.boat-flip') as SVGGElement, xs, ys, cum });
  }

  /** 每一格畫面把洋流號擺到現在的位置（雷達藏起來時不擺，回來接著開）；沒有船就停 */
  private moveBoats = (): void => {
    cancelAnimationFrame(this.boatFrame);
    this.boatFrame = 0;
    if (this.boatTracks.length === 0) return;
    if (this.squarePx > 0 && this.stack.offsetWidth > 0) {
      const { at, alpha } = boatPhase(Date.now());
      const k = (SIZE / this.squarePx).toFixed(4);
      for (const t of this.boatTracks) {
        const p = alongLine(t.xs, t.ys, t.cum, at);
        if (p.left !== null) this.boatLeft.set(t.id, p.left);
        t.g.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) scale(${k})`);
        t.g.style.opacity = alpha.toFixed(2);
        if (this.boatLeft.get(t.id)) t.flip.setAttribute('transform', 'scale(-1 1)');
        else t.flip.removeAttribute('transform');
      }
    }
    this.boatFrame = requestAnimationFrame(this.moveBoats);
  };

  private placeRose(): void {
    this.placeCompass();
    for (const t of Array.from(this.roseLayer.children) as SVGTextElement[]) {
      const deg = Number(t.dataset.deg ?? 0);
      const p = polar(deg - this.heading, R + 4);
      t.setAttribute('x', p.x.toFixed(1));
      t.setAttribute('y', p.y.toFixed(1));
    }
  }

  /**
   * 掃描線掃到這個位置的時間點（相對於掃描動畫開始，秒），用來讓光點在掃過時閃一下。
   * 扇形、指針看方位角；波紋看離圓心多遠。
   */
  private sweepHitSec(angleDeg: number, radiusPx: number): number {
    const period = SWEEP_SEC[this.style.sweep];
    const a = (((angleDeg % 360) + 360) % 360) / 360;
    if (this.style.sweep === 'ripple') return (radiusPx / this.sweepR) * period * 2;
    if (this.style.sweep === 'wedge') return ((((angleDeg - WEDGE_LEAD_DEG) % 360) + 360) % 360 / 360) * period;
    return a * period;
  }

  /** 主圖層的 g 在特效層的那一組（同位置、同 class），第一次用到才建 */
  private fxTwin(g: SVGGElement): SVGGElement {
    let fx = this.fxOf.get(g);
    if (!fx) {
      fx = el('g', { class: g.getAttribute('class') ?? '', transform: g.getAttribute('transform') ?? '' }) as SVGGElement;
      this.fxOf.set(g, fx);
      this.fxLayer.appendChild(fx);
    }
    return fx;
  }

  /** 閃光層的一個圓：半徑 r 個 SVG 單位，圓心在那一組的位置 */
  private fxSpan(cls: string, r: number): HTMLSpanElement {
    const sp = document.createElement('span');
    sp.className = cls;
    Object.assign(sp.style, { width: `calc(${2 * r} * var(--u))`, height: `calc(${2 * r} * var(--u))`, left: `calc(${-r} * var(--u))`, top: `calc(${-r} * var(--u))` });
    return sp;
  }

  /** 掃到時閃一下：g 裡要有 .body（光點本身），光暈和亮環畫在閃光層（同位置、同 class，顏色照舊），記下一圈裡第幾毫秒會被掃到 */
  private addFlash(g: SVGGElement, angleDeg: number, radiusPx: number, r: number): void {
    const p = polar(angleDeg, radiusPx);
    const twin = document.createElement('div');
    twin.className = g.getAttribute('class') ?? '';
    Object.assign(twin.style, { left: `calc(${p.x.toFixed(1)} * var(--u))`, top: `calc(${p.y.toFixed(1)} * var(--u))` });
    twin.append(this.fxSpan('fx-glow', r), this.fxSpan('fx-ring', r * RING_GROW));
    this.flashSquare.appendChild(twin);
    this.flashOf.set(g, twin);
    const periodMs = SWEEP_SEC[this.style.sweep] * 1000;
    g.dataset.hit = String((((this.sweepHitSec(angleDeg, radiusPx) * 1000) % periodMs) + periodMs) % periodMs);
  }

  /**
   * 每 40 毫秒看掃描線走到哪，上一次到這一次之間掃過的才閃一下（只跑一次的短動畫）。
   * 以前每個光點掛三個一直重複的動畫，點一多每一格畫面都要算幾百個動畫，手機會卡。
   */
  private readonly tickFlash = (): void => {
    // 切到地圖、背景分頁時不用閃
    if (document.hidden || !this.shown || !this.sweepClock) {
      this.lastSweepMs = -1;
      return;
    }
    const now = performance.now();
    this.stepLit(now);
    // 進行中的光點閃爍：每 0.6 秒換一段（主圖層一秒改不到兩次）
    if (!this.calm?.matches) {
      const step = Math.floor(now / 600) % 2;
      if (step !== this.blinkStep) {
        this.blinkStep = step;
        this.svg.classList.toggle('blink-dim', step === 1);
        this.svg.classList.toggle('blink-on', step === 0);
      }
    } else if (this.blinkStep !== -1) {
      this.blinkStep = -1;
      this.svg.classList.remove('blink-dim', 'blink-on');
    }
    if (this.flashDirty) {
      this.flashDirty = false;
      this.flashTargets = Array.from(this.svg.querySelectorAll<SVGGElement>('[data-hit]'), (g) => ({ g, at: Number(g.dataset.hit) }));
    }
    // 全螢幕鋪滿時沒有掃描線：掃到時亮一下也不用（汪星的狗在樹下也不亮）
    if (this.fill) {
      this.lastSweepMs = -1;
      return;
    }
    const periodMs = SWEEP_SEC[this.style.sweep] * 1000;
    const t = Number(this.sweepClock.currentTime ?? 0) % periodMs;
    const prev = this.lastSweepMs;
    this.lastSweepMs = t;
    if (prev < 0) return;
    for (const f of this.flashTargets) {
      // 跨過一圈的起點時分成兩段看
      if (prev <= t ? f.at > prev && f.at <= t : f.at > prev || f.at <= t) this.flash(f.g);
    }
    this.sweepMovers(prev, t, periodMs);
  };

  /**
   * 會動的點（`.sweep-lit`，汪星的狗遠遠的白點）：每次看它現在在畫面哪裡（照著走的動畫、指北針、鎖定跟著走），
   * 掃描線從上一次到這一次之間掃過它就淡淡地亮一下（data-glint="strong"：樹下、拉遠看不到的狗，亮得明顯一點）
   */
  private sweepMovers(prev: number, t: number, periodMs: number): void {
    const dots = this.svg.querySelectorAll<SVGGraphicsElement>('.sweep-lit');
    if (!dots.length) return;
    const rect = this.svg.getBoundingClientRect();
    const unit = SIZE / Math.max(1, Math.min(rect.width, rect.height));
    for (const dot of dots) {
      const b = dot.getBoundingClientRect();
      const x = C + (b.x + b.width / 2 - rect.x - rect.width / 2) * unit;
      const y = C + (b.y + b.height / 2 - rect.y - rect.height / 2) * unit;
      const at = (((this.sweepHitSec((Math.atan2(x - C, C - y) * 180) / Math.PI, Math.hypot(x - C, y - C)) * 1000) % periodMs) + periodMs) % periodMs;
      if (!(prev <= t ? at > prev && at <= t : at > prev || at <= t)) continue;
      if (dot.dataset.glint === 'strong') this.glint(x, y, Math.max(GLINT_STRONG_R[0], Math.min(GLINT_STRONG_R[1], (b.width / 2) * unit)), true);
      else this.glint(x, y, Math.max(b.width / 2, GLINT_MIN_PX) * unit);
    }
  }

  /** 會動的點亮一下：主圖層上面那一層在它現在的位置放一團淡淡的光暈，慢慢放大變淡（比光點的閃光淡、不擴散亮環），閃完拿掉 */
  private glint(x: number, y: number, r: number, strong = false): void {
    const at = document.createElement('div');
    at.className = strong ? 'sweep-glint strong' : 'sweep-glint';
    Object.assign(at.style, { left: `calc(${x.toFixed(1)} * var(--u))`, top: `calc(${y.toFixed(1)} * var(--u))` });
    const glow = this.fxSpan('fx-glow', Math.max(1, r));
    const ring = strong ? this.fxSpan('fx-ring', Math.max(1, r)) : null;
    at.append(glow, ...(ring ? [ring] : []));
    this.glintSquare.appendChild(at);
    if (typeof glow.animate !== 'function') return void at.remove();
    const calm = this.calm?.matches;
    const frames = strong ? (calm ? GLINT_STRONG_CALM : GLINT_STRONG) : calm ? GLINT_CALM : GLINT;
    const duration = strong ? GLINT_STRONG_MS : GLINT_MS;
    ring?.animate(frames, { duration, easing: 'ease-out' });
    glow.animate(frames, { duration, easing: 'ease-out' }).onfinish = () => at.remove();
  }

  /**
   * 掃到時閃一下：光暈、亮環在閃光層用動畫放大變淡；光點本體在主圖層，只分兩段變亮再回原樣
   * （本體每一格變一次的話，整個主圖層每一格都要重畫）
   */
  private flash(g: SVGGElement): void {
    const calm = !!this.calm?.matches;
    const fx = this.flashOf.get(g);
    for (const part of calm ? FLASH_PARTS_CALM : FLASH_PARTS) {
      const target = fx?.querySelector<SVGElement>(part.sel);
      if (target) target.animate([part.from, part.to], { duration: part.ms, easing: 'linear' });
    }
    const body = g.querySelector<SVGElement>('.body');
    if (!body || this.lit.some((l) => l.el === body)) return;
    // 變淡、模糊的光點閃的時候保留原本的模糊，閃完回到原樣
    this.lit.push({ el: body, at: performance.now(), ms: calm ? BODY_FLASH_MS_CALM : BODY_FLASH_MS, base: body.style.filter, blur: body.dataset.blur ? ` blur(${body.dataset.blur}px)` : '', level: -1 });
  }

  /** 亮一下的光點本體：前三分之一最亮，中間三分之一一半亮，之後回原樣 */
  private stepLit(now: number): void {
    if (this.lit.length === 0) return;
    this.lit = this.lit.filter((l) => {
      const k = (now - l.at) / l.ms;
      const level = k < 1 / 3 ? 2 : k < 2 / 3 ? 1 : 0;
      if (level !== l.level) {
        l.level = level;
        l.el.style.filter = level === 0 ? l.base : `${BODY_FLASH[level]}${l.blur}`;
      }
      return level > 0 && l.el.isConnected;
    });
  }

  private appendMark(g: SVGGElement, out: boolean, spot = false, office = false): void {
    const r = out ? 4 : 6;
    if (spot && office) {
      // 房子形狀：服務處、競選總部
      const s = out ? 7 : 10;
      const w = s * 0.55;
      g.appendChild(el('path', { class: 'dot', d: `M0 ${-s * 0.62} L${w} ${-s * 0.1} V${s * 0.55} H${-w} V${-s * 0.1} Z`, 'stroke-linejoin': 'round' }));
      return;
    }
    if (spot) {
      const s = out ? 7 : 10;
      g.appendChild(el('rect', { class: 'dot', x: -s / 2, y: -s / 2, width: s, height: s, transform: 'rotate(45)' }));
      return;
    }
    switch (this.style.blip) {
      case 'buoy':
        g.appendChild(el('circle', { class: 'dot', r: r + 1 }));
        g.appendChild(el('circle', { class: 'core', r: Math.max(1.5, r - 3.5) }));
        break;
      case 'x': {
        const s = out ? 4 : 6;
        g.appendChild(el('line', { class: 'mark', x1: -s, y1: -s, x2: s, y2: s }));
        g.appendChild(el('line', { class: 'mark', x1: -s, y1: s, x2: s, y2: -s }));
        break;
      }
      default:
        g.appendChild(el('circle', { class: 'dot', r }));
    }
  }

  /** 同一格畫面裡的多次更新（範圍、光點、瓶子、地標）合成一次重畫 */
  private draw(): void {
    if (this.drawFrame) return;
    this.drawFrame = requestAnimationFrame(() => {
      this.drawFrame = 0;
      this.drawNow();
    });
  }

  private drawNow(): void {
    this.flashDirty = true;
    // 特效層、閃光層跟著主圖層整個重建（光點、瓶子、地標各自建它們的那一組）
    this.fxLayer.replaceChildren();
    this.fxOf = new WeakMap();
    this.flashSquare.replaceChildren();
    this.flashOf = new WeakMap();
    this.lit = [];
    this.drawStreets();
    this.drawPark();
    this.drawOutline();
    this.drawSpace();
    this.drawRoutes();
    this.drawScaleBar();
    this.drawBottles();
    this.drawLandmarks();
    this.drawYou();
    this.blipLayer.replaceChildren();
    const pos = new Map<number, { x: number; y: number; out: boolean; angle: number; r: number }>();
    // 太空：地球另一面的不畫；地球太小時都擠在一起，不畫
    const all = this.earthHidden ? [] : this.inSpace ? this.items.filter((it) => it.distanceKm <= HORIZON_KM) : this.items;
    for (const it of all) {
      const ratio = this.ratio(it.distanceKm);
      const angle = it.bearing - this.heading;
      // 範圍外的貼在外圈；全螢幕鋪滿時畫面外的不畫（選取的也不畫：詳細資料寫了多遠、哪個方向）
      const lim = this.edgeR(angle);
      const beyond = ratio * (R - 8) > lim;
      if (this.fill && beyond) continue;
      const r = Math.min(ratio * (R - 8), lim);
      pos.set(it.id, { ...polar(angle, r), out: beyond || !!it.outside, angle, r });
    }
    const items = all.filter((it) => pos.has(it.id));
    // 疊在一起（12 px 內）的光點合成一群：選取的、要顯示標籤的優先當代表，標籤加「+N」，
    // 點下去先列出同一群讓人選，不然被蓋住的點不到
    const groups: RadarItem[][] = [];
    for (const it of items) {
      const p = pos.get(it.id)!;
      const g = groups.find((gr) => {
        const q = pos.get(gr[0].id)!;
        return Math.hypot(q.x - p.x, q.y - p.y) < GROUP_PX;
      });
      if (g) g.push(it);
      else groups.push([it]);
    }
    const leaderOf = (g: RadarItem[]): RadarItem => g.find((it) => it.selected) ?? g.find((it) => it.showLabel) ?? g[0];
    // 標籤避讓：選取的優先，其次依清單順序（進行中、近的在前），和已放的標籤重疊就不畫。
    // 同一群只標代表的名稱加「+N」，點下去再選
    const placed: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    // 標籤不超出畫面（鋪滿時是長方形）
    const [, labelTop, , labelBottom] = viewRect();
    const labelLines = new Map<number, { lines: string[]; below: boolean }>();
    for (const g of [...groups].sort((a, b) => Number(b.some((it) => it.selected)) - Number(a.some((it) => it.selected)))) {
      const lead = leaderOf(g);
      if (!g.some((it) => it.showLabel)) continue;
      const one = [g.length > 1 ? `${lead.label} +${g.length - 1}` : lead.label];
      const p = pos.get(lead.id)!;
      const anchor = anchorAt(p.x);
      // 先放上方，擠不下改放下方
      const tries = [
        { lines: one, below: false },
        { lines: one, below: true },
      ];
      for (const t of tries) {
        const w = Math.max(...t.lines.map((x) => [...x].length * 12));
        const h = t.lines.length * LINE_PX;
        const left = anchor === 'end' ? p.x + 6 - w : anchor === 'start' ? p.x - 6 : p.x - w / 2;
        const box = { left, right: left + w, top: t.below ? p.y + 8 : p.y - 13 - h + 4, bottom: t.below ? p.y + 8 + h : p.y - 9 };
        if (box.top < labelTop || box.bottom > labelBottom) continue;
        if (placed.some((q) => q.left < box.right && box.left < q.right && q.top < box.bottom && box.top < q.bottom)) continue;
        placed.push(box);
        labelLines.set(lead.id, t);
        break;
      }
    }
    for (const g of groups) {
      const lead = leaderOf(g);
      const ids = g.map((it) => it.id).join(',');
      // 代表最後畫，疊在最上面
      for (const it of [...g.filter((x) => x !== lead), lead]) {
        const p = pos.get(it.id)!;
        const node = el('g', {
          class: `blip phase-${it.phase} kind-${it.kind}${it.spot ? ' spot' : ''}${it.approx ? ' approx' : ''}${p.out ? ' out' : ''}${it.selected ? ' selected' : ''}`,
          transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`,
          tabindex: 0,
          role: 'button',
        });
        node.dataset.id = String(lead.id);
        node.dataset.group = ids;
        node.appendChild(el('circle', { class: 'hit', r: 22 }));
        const body = el('g', { class: 'body' });
        if (it.flag) {
          const f = el('text', { class: 'flag' });
          f.textContent = it.flag;
          body.appendChild(f);
        } else this.appendMark(body, p.out, it.spot, it.office);
        // 離開始越久越淡、越模糊；選取時看清楚
        if (it.fade !== undefined && !it.selected) {
          const blur = ((1 - it.fade) * 1.5).toFixed(2);
          body.setAttribute('style', `opacity:${(0.35 + 0.65 * it.fade).toFixed(2)};filter:blur(${blur}px)`);
          body.dataset.blur = blur;
        }
        node.appendChild(body);
        this.addFlash(node, p.angle, p.r, p.out ? 5 : 7);
        // 進行中的擴散圈（從 6 放大到 22）：跟光暈同一組
        this.flashOf.get(node)?.appendChild(this.fxSpan('ping', 22));
        const lbl = it === lead ? labelLines.get(it.id) : undefined;
        // 還有多久開始：寫在光點正下方，不跟著變淡；有名稱標籤時不寫，免得疊在一起
        if (it === lead && it.badge && !lbl) {
          const badge = el('text', { class: 'badge', 'text-anchor': 'middle', y: 19 });
          badge.textContent = it.badge;
          node.appendChild(badge);
        }
        if (lbl) {
          const anchor = anchorAt(p.x);
          const x = anchor === 'end' ? 6 : anchor === 'start' ? -6 : 0;
          const n = lbl.lines.length;
          const label = el('text', { class: 'label', 'text-anchor': anchor });
          lbl.lines.forEach((line, i) => {
            const y = lbl.below ? 22 + i * LINE_PX : -13 - (n - 1 - i) * LINE_PX;
            const span = el('tspan', { x, y });
            span.textContent = line;
            label.appendChild(span);
          });
          node.appendChild(label);
        }
        const title = el('title');
        title.textContent = g.length > 1 ? g.map((x) => x.label).join('、') : it.label;
        node.appendChild(title);
        this.blipLayer.appendChild(node);
      }
    }
  }
}
