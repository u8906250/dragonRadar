import type { BlipStyle, EventKind, Phase, SweepStyle } from './types';

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
  label: string;
  showLabel: boolean;
  selected: boolean;
}

/** 雷達上的車掃路線：每個點的方位與距離 */
export interface RadarRoute {
  id: string;
  /** planned 還沒出發（虛線）；live 車掃中；done 已抵達（不畫） */
  state: 'planned' | 'live' | 'done';
  points: Array<{ bearing: number; distanceKm: number }>;
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

export interface RadarStyle {
  sweep: SweepStyle;
  blip: BlipStyle;
  rose: boolean;
}

const SIZE = 400;
const C = SIZE / 2;
const R = 172;
const SVG_NS = 'http://www.w3.org/2000/svg';
const ROSE: Array<[string, number]> = [
  ['N', 0],
  ['E', 90],
  ['S', 180],
  ['W', 270],
];

/** 掃描一圈幾秒，要跟下面 SVG 動畫的 dur 一致；波紋兩圈相隔 1.6 秒，每 1.6 秒掃過一次 */
const SWEEP_SEC: Record<SweepStyle, number> = { wedge: 4, needle: 6, ripple: 1.6 };
/** 扇形的前緣在旋轉角度 +45 度的地方 */
const WEDGE_LEAD_DEG = 45;
/**
 * 掃過時的閃光（毫秒）：光點本身稍微變亮（不放大）、後面一團淡淡的光暈、往外擴散一圈細環。
 * 每一段都是「掃到的瞬間最亮，接著淡掉」，一圈裡其餘時間維持原狀。
 */
const FLASH_PARTS: Array<{ sel: string; ms: number; from: Keyframe; to: Keyframe }> = [
  {
    sel: '.body',
    ms: 450,
    from: { filter: 'brightness(1.5) drop-shadow(0 0 4px rgba(255, 255, 255, 0.8))' },
    to: { filter: 'brightness(1) drop-shadow(0 0 0px rgba(255, 255, 255, 0))' },
  },
  { sel: '.flash', ms: 500, from: { opacity: 0.6, transform: 'scale(1.3)' }, to: { opacity: 0, transform: 'scale(2.2)' } },
  { sel: '.flash-ring', ms: 700, from: { opacity: 0.6, transform: 'scale(1)' }, to: { opacity: 0, transform: 'scale(3.2)' } },
];
/** 系統設定「減少動態效果」時（Windows 關掉動畫效果的電腦常見）：不放大、不擴散，只亮一下 */
const FLASH_PARTS_CALM: typeof FLASH_PARTS = [
  {
    sel: '.body',
    ms: 600,
    from: { filter: 'brightness(1.5) drop-shadow(0 0 4px rgba(255, 255, 255, 0.8))' },
    to: { filter: 'brightness(1) drop-shadow(0 0 0px rgba(255, 255, 255, 0))' },
  },
  { sel: '.flash', ms: 600, from: { opacity: 0.6, transform: 'scale(1.6)' }, to: { opacity: 0, transform: 'scale(1.6)' } },
];

/** 光點距離小於這個像素就合成一群 */
const GROUP_PX = 12;
/** 標籤每行高度 */
const LINE_PX = 14;

/** 距離換成半徑比例（0 = 圓心，1 = 外圈，超出範圍會大於 1），全部照比例 */
function radiusRatio(km: number, scaleKm: number): number {
  return km / scaleKm;
}

function fmtKm(km: number): string {
  if (km >= 10) return `${Math.round(km)} km`;
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
  private readonly svg: SVGSVGElement;
  private readonly blipLayer: SVGGElement;
  private readonly scaleLabels: SVGGElement;
  private readonly rings: SVGGElement;
  private readonly roseLayer: SVGGElement;
  private readonly routeLayer: SVGGElement;
  private routes: RadarRoute[] = [];
  private outline: Array<Array<{ bearing: number; distanceKm: number }>> = [];
  private readonly outlineLayer: SVGGElement;
  private landmarks: RadarLandmark[] = [];
  private bottles: RadarBottle[] = [];
  private readonly bottleLayer: SVGGElement;
  private readonly landmarkLayer: SVGGElement;
  private scaleKm = 5;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  /** 單指拖曳移動位置：按下的位置、上一次的位置、是不是已經開始拖（移動超過幾像素才算，免得點光點時不小心移動） */
  private panStart: { x: number; y: number } | null = null;
  private panLast: { x: number; y: number } | null = null;
  private panning = false;
  /** 剛拖完：放開時瀏覽器還會送一個 click，不要當成點光點 */
  private justPanned = false;
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
    this.svg = el('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'radar', role: 'img', 'aria-label': '雷達畫面' });
    const wedgeEnd = polar(45, R);
    this.svg.innerHTML = `
      <defs>
        <radialGradient id="rg-face" cx="50%" cy="50%" r="50%">
          <stop offset="0" class="face-stop-1" />
          <stop offset="1" class="face-stop-2" />
        </radialGradient>
        <linearGradient id="rg-sweep" gradientUnits="userSpaceOnUse" x1="${C}" y1="${C}" x2="${C + R}" y2="${C - R}">
          <stop offset="0" class="sweep-stop-1" />
          <stop offset="1" class="sweep-stop-2" />
        </linearGradient>
        <clipPath id="rg-clip"><circle cx="${C}" cy="${C}" r="${R}" /></clipPath>
        <filter id="rg-fog" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
      <circle class="bezel" cx="${C}" cy="${C}" r="${R + 16}" />
      <circle class="face" cx="${C}" cy="${C}" r="${R}" fill="url(#rg-face)" />
      <g class="grid">
        <g class="rings"></g>
        <circle cx="${C}" cy="${C}" r="${R}" class="outer" />
        <line x1="${C}" y1="${C - R}" x2="${C}" y2="${C + R}" />
        <line x1="${C - R}" y1="${C}" x2="${C + R}" y2="${C}" />
      </g>
      <g clip-path="url(#rg-clip)" class="sweeps">
        <path class="sweep-wedge" fill="url(#rg-sweep)" d="M ${C} ${C} L ${C} ${C - R} A ${R} ${R} 0 0 1 ${wedgeEnd.x.toFixed(2)} ${wedgeEnd.y.toFixed(2)} Z">
          <animateTransform attributeName="transform" type="rotate" from="0 ${C} ${C}" to="360 ${C} ${C}" dur="4s" repeatCount="indefinite" />
        </path>
        <g class="sweep-ripple">
          <circle cx="${C}" cy="${C}" r="0">
            <animate attributeName="r" from="0" to="${R}" dur="3.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" from="0.7" to="0" dur="3.2s" repeatCount="indefinite" />
          </circle>
          <circle cx="${C}" cy="${C}" r="0">
            <animate attributeName="r" from="0" to="${R}" dur="3.2s" begin="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" from="0.7" to="0" dur="3.2s" begin="1.6s" repeatCount="indefinite" />
          </circle>
        </g>
        <g class="sweep-needle">
          <line x1="${C}" y1="${C}" x2="${C}" y2="${C - R + 6}" />
          <circle cx="${C}" cy="${C - R + 14}" r="4" />
          <animateTransform attributeName="transform" type="rotate" from="0 ${C} ${C}" to="360 ${C} ${C}" dur="6s" repeatCount="indefinite" />
        </g>
      </g>
      <g class="scale-labels"></g>
      <g class="outline" clip-path="url(#rg-clip)"></g>
      <g class="routes" clip-path="url(#rg-clip)"></g>
      <g class="bottles"></g>
      <circle class="me" cx="${C}" cy="${C}" r="5" />
      <g class="blips"></g>
      <!-- 地標（星星）放在光點上面，疊在一起時也點得到 -->
      <g class="landmarks"></g>
      <g class="rose"></g>
    `;
    this.blipLayer = this.svg.querySelector('.blips') as SVGGElement;
    this.scaleLabels = this.svg.querySelector('.scale-labels') as SVGGElement;
    this.rings = this.svg.querySelector('.rings') as SVGGElement;
    this.roseLayer = this.svg.querySelector('.rose') as SVGGElement;
    this.routeLayer = this.svg.querySelector('.routes') as SVGGElement;
    this.outlineLayer = this.svg.querySelector('.outline') as SVGGElement;
    this.landmarkLayer = this.svg.querySelector('.landmarks') as SVGGElement;
    this.bottleLayer = this.svg.querySelector('.bottles') as SVGGElement;
    this.bottleLayer.addEventListener('click', (e) => {
      const g = (e.target as Element).closest('.bottle') as SVGGElement | null;
      if (g?.dataset.id) onBottle?.(Number(g.dataset.id));
    });
    this.landmarkLayer.addEventListener('click', (e) => {
      const g = (e.target as Element).closest('.landmark') as SVGGElement | null;
      if (g?.dataset.id) onLandmark?.(g.dataset.id);
    });
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
    container.appendChild(this.svg);
    this.setStyle(this.style);
    this.setScale(this.scaleKm);
    this.placeRose();
    requestAnimationFrame(this.tickFlash);
  }

  setStyle(s: RadarStyle): void {
    this.style = s;
    this.svg.setAttribute('class', `radar sweep-${s.sweep} blip-${s.blip}${s.rose ? ' has-rose' : ''}`);
    this.lastSweepMs = -1;
    this.draw();
  }

  private wireZoom(onZoom: (factor: number, done: boolean) => void): void {
    const svg = this.svg;
    const dist = (): number => {
      const [a, b] = [...this.pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    // 網頁版用滑鼠拖曳時不要選到雷達上的字（公里數），選到之後瀏覽器會改成拖那段字，雷達就拖不動
    svg.addEventListener('dragstart', (e) => e.preventDefault());
    svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.pointerType === 'mouse') e.preventDefault();
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.panStart = { x: e.clientX, y: e.clientY };
        this.panLast = this.panStart;
      }
      if (this.pointers.size === 2) {
        // 拖到一半放第二根手指：改成縮放
        this.endPan();
        this.pinchDist = dist();
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
      if (this.pinchDist > 0 && d > 0) onZoom(this.pinchDist / d, false);
      this.pinchDist = d;
    });
    const end = (e: PointerEvent): void => {
      if (!this.pointers.delete(e.pointerId)) return;
      if (this.pointers.size === 0) this.endPan();
      if (this.pointers.size === 1 && this.pinchDist > 0) onZoom(1, true);
      if (this.pointers.size < 2) this.pinchDist = 0;
      // 縮放完剩一根手指：不接著拖
      this.panStart = null;
      this.panLast = null;
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
    let wheelTimer = 0;
    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        onZoom(Math.exp(Math.max(-100, Math.min(100, e.deltaY)) * 0.003), false);
        window.clearTimeout(wheelTimer);
        wheelTimer = window.setTimeout(() => onZoom(1, true), 250);
      },
      { passive: false },
    );
  }

  /** 單指拖曳：移動超過 8 像素才開始；畫面上往哪拖，內容就往哪移，中心（你的位置）往反方向 */
  private panMove(e: PointerEvent): void {
    if (!this.onPan || !this.panStart || !this.panLast) return;
    if (!this.panning) {
      if (Math.hypot(e.clientX - this.panStart.x, e.clientY - this.panStart.y) < 8) return;
      this.panning = true;
      this.svg.classList.add('panning');
      try {
        this.svg.setPointerCapture(e.pointerId);
      } catch {
        /* 有些瀏覽器拿不到 capture，照樣拖 */
      }
    }
    const rect = this.svg.getBoundingClientRect();
    // 螢幕像素換成 SVG 座標（viewBox 是正方形，照短邊縮放）
    const unit = SIZE / Math.max(1, Math.min(rect.width, rect.height));
    const dx = (e.clientX - this.panLast.x) * unit;
    const dy = (e.clientY - this.panLast.y) * unit;
    this.panLast = { x: e.clientX, y: e.clientY };
    const r = Math.hypot(dx, dy);
    if (r === 0) return;
    const km = (r / (R - 8)) * this.scaleKm;
    // 內容往畫面上的 screen 方向移動；指北針模式要加回手機朝向；中心往反方向
    const screen = (Math.atan2(dx, -dy) * 180) / Math.PI;
    this.onPan(((screen + this.heading + 180) % 360 + 360) % 360, km, false);
  }

  private endPan(): void {
    if (!this.panning) return;
    this.panning = false;
    this.svg.classList.remove('panning');
    this.justPanned = true;
    window.setTimeout(() => {
      this.justPanned = false;
    }, 80);
    this.onPan?.(0, 0, true);
  }

  /** 照比例畫：外圈是範圍，裡面三圈是 1/4、1/2、3/4 */
  setScale(km: number): void {
    this.scaleKm = km;
    this.rings.replaceChildren();
    this.scaleLabels.replaceChildren();
    const marks = [0.25, 0.5, 0.75].map((f) => ({ km: f * km, label: f === 0.5 }));
    for (const m of marks) {
      this.rings.appendChild(el('circle', { cx: C, cy: C, r: (this.ratio(m.km) * R).toFixed(1) }));
      if (m.label) this.addScaleLabel(m.km);
    }
    this.addScaleLabel(km);
    this.draw();
  }

  private addScaleLabel(km: number): void {
    const t = el('text', { x: C + 5, y: C - this.ratio(km) * R + 13, class: 'scale-label' });
    t.textContent = fmtKm(km);
    this.scaleLabels.appendChild(t);
  }

  /** 外圈（範圍）在螢幕上的半徑像素；雷達沒顯示時回傳 0 */
  rangePx(): number {
    const w = this.svg.getBoundingClientRect().width;
    return w > 0 ? (R * Math.min(w, this.svg.getBoundingClientRect().height)) / SIZE : 0;
  }

  private ratio(km: number): number {
    return radiusRatio(km, this.scaleKm);
  }

  /** 手機朝向（0 = 北，順時針）。null 代表關閉指北針，恢復北在上 */
  setHeading(deg: number | null): void {
    this.heading = deg === null ? 0 : ((deg % 360) + 360) % 360;
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
  setOutline(rings: Array<Array<{ bearing: number; distanceKm: number }>>): void {
    this.outline = rings;
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
      // 範圍外的瓶子不畫，免得外圈擠滿；只有方向提示的那一個貼在外圈
      if (ratio > 1 && !b.hint) continue;
      const angle = b.bearing - this.heading;
      const r = Math.min(1, ratio) * (R - 8);
      const p = polar(angle, r);
      if (ratio > 1) {
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
        g.appendChild(el('circle', { class: 'fog', r: fog.toFixed(1), filter: 'url(#rg-fog)' }));
      } else {
        if (b.state === 'pick') g.appendChild(el('circle', { class: 'reach', r: 9 }));
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
      const out = ratio > 1;
      const p = polar(lm.bearing - this.heading, Math.min(1, ratio) * (R - 8));
      const g = el('g', { class: `landmark${out ? ' out' : ''}${lm.selected ? ' selected' : ''}`, transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`, tabindex: 0, role: 'button' });
      g.dataset.id = lm.id;
      // 點擊範圍比光點小一點，旁邊的光點還點得到
      g.appendChild(el('circle', { class: 'hit', r: 13 }));
      const body = el('g', { class: 'body' });
      body.appendChild(el('path', { class: 'star', d: starPath(out ? 7 : 10) }));
      g.appendChild(body);
      this.addFlash(g, lm.bearing - this.heading, Math.min(1, ratio) * (R - 8), out ? 6 : 9);
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

  private pathOf(points: Array<{ bearing: number; distanceKm: number }>, close = false): string {
    const d = points
      .map((pt, i) => {
        const p = polar(pt.bearing - this.heading, this.ratio(pt.distanceKm) * (R - 8));
        return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      })
      .join(' ');
    return close ? `${d} Z` : d;
  }

  private drawOutline(): void {
    this.outlineLayer.replaceChildren();
    for (const ring of this.outline) {
      if (ring.length < 3) continue;
      const p = this.outlinePath(ring);
      // 斷開的只畫線、不填色（填色會把斷開的兩端直接連起來）
      if (p) this.outlineLayer.appendChild(el('path', { class: `region-outline${p.closed ? '' : ' open'}`, d: p.d }));
    }
  }

  /**
   * 輪廓：超出外圈的點不畫（縮放到比全台小時，台灣、對岸的海岸線大多在外面），
   * 相鄰兩點在畫面上離太遠也斷開（「全球」時地球另一面的海岸線會被拉得很長）；整圈都畫到的才封閉。
   */
  private outlinePath(ring: Array<{ bearing: number; distanceKm: number }>): { d: string; closed: boolean } | null {
    const maxJump = (R - 8) * 0.3;
    let prev: { x: number; y: number } | null = null;
    let broken = false;
    const parts: string[] = [];
    for (const pt of ring) {
      const ratio = this.ratio(pt.distanceKm);
      if (ratio > 1) {
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
    return broken ? { d: parts.join(' '), closed: false } : { d: `${parts.join(' ')} Z`, closed: true };
  }

  /** 路線畫在光點下面；超出範圍的部分被外圈裁掉 */
  private drawRoutes(): void {
    this.routeLayer.replaceChildren();
    for (const r of this.routes) {
      if (r.state === 'done' || r.points.length < 2) continue;
      const path = el('path', { class: `route route-${r.state}`, d: this.pathOf(r.points) });
      this.routeLayer.appendChild(path);
    }
  }

  private placeRose(): void {
    for (const t of Array.from(this.roseLayer.children) as SVGTextElement[]) {
      const deg = Number(t.dataset.deg ?? 0);
      const p = polar(deg - this.heading, R + 4);
      t.setAttribute('x', p.x.toFixed(1));
      t.setAttribute('y', p.y.toFixed(1));
    }
  }

  /**
   * 掃描線掃到這個位置的時間點（相對於 SVG 動畫時間，秒），用來讓光點在掃過時閃一下。
   * 扇形、指針看方位角；波紋看離圓心多遠。
   */
  private sweepHitSec(angleDeg: number, radiusPx: number): number {
    const period = SWEEP_SEC[this.style.sweep];
    const a = (((angleDeg % 360) + 360) % 360) / 360;
    if (this.style.sweep === 'ripple') return (radiusPx / R) * 3.2;
    if (this.style.sweep === 'wedge') return ((((angleDeg - WEDGE_LEAD_DEG) % 360) + 360) % 360 / 360) * period;
    return a * period;
  }

  /** 掃到時閃一下：g 裡要有 .body（光點本身），這裡補上光暈和亮環，記下一圈裡第幾毫秒會被掃到 */
  private addFlash(g: SVGGElement, angleDeg: number, radiusPx: number, r: number): void {
    g.insertBefore(el('circle', { class: 'flash-ring', r }), g.firstChild);
    g.insertBefore(el('circle', { class: 'flash', r }), g.firstChild);
    const periodMs = SWEEP_SEC[this.style.sweep] * 1000;
    g.dataset.hit = String((((this.sweepHitSec(angleDeg, radiusPx) * 1000) % periodMs) + periodMs) % periodMs);
  }

  /**
   * 每一格畫面看掃描線走到哪，上一格到這一格之間掃過的才閃一下（只跑一次的短動畫）。
   * 以前每個光點掛三個一直重複的動畫，點一多每一格畫面都要算幾百個動畫，手機會卡。
   */
  private readonly tickFlash = (): void => {
    requestAnimationFrame(this.tickFlash);
    // 切到地圖、背景分頁時不用閃
    if (document.hidden || typeof this.svg.animate !== 'function' || this.svg.getBoundingClientRect().width === 0) {
      this.lastSweepMs = -1;
      return;
    }
    if (this.flashDirty) {
      this.flashDirty = false;
      this.flashTargets = Array.from(this.svg.querySelectorAll<SVGGElement>('[data-hit]'), (g) => ({ g, at: Number(g.dataset.hit) }));
    }
    const periodMs = SWEEP_SEC[this.style.sweep] * 1000;
    const t = (this.svg.getCurrentTime() * 1000) % periodMs;
    const prev = this.lastSweepMs;
    this.lastSweepMs = t;
    if (prev < 0) return;
    for (const f of this.flashTargets) {
      // 跨過一圈的起點時分成兩段看
      if (prev <= t ? f.at > prev && f.at <= t : f.at > prev || f.at <= t) this.flash(f.g);
    }
  };

  private flash(g: SVGGElement): void {
    for (const part of this.calm?.matches ? FLASH_PARTS_CALM : FLASH_PARTS) {
      const target = g.querySelector<SVGElement>(part.sel);
      if (!target) continue;
      // 變淡、模糊的光點閃的時候保留原本的模糊，閃完回到原樣
      const blur = target.dataset.blur;
      const keep = (k: Keyframe): Keyframe => (blur && typeof k.filter === 'string' ? { ...k, filter: `${k.filter} blur(${blur}px)` } : k);
      target.animate([keep(part.from), keep(part.to)], { duration: part.ms, easing: 'linear' });
    }
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
    this.drawOutline();
    this.drawRoutes();
    this.drawBottles();
    this.drawLandmarks();
    this.blipLayer.replaceChildren();
    const pos = new Map<number, { x: number; y: number; out: boolean; angle: number; r: number }>();
    for (const it of this.items) {
      const ratio = this.ratio(it.distanceKm);
      const angle = it.bearing - this.heading;
      const r = Math.min(1, ratio) * (R - 8);
      pos.set(it.id, { ...polar(angle, r), out: ratio > 1 || !!it.outside, angle, r });
    }
    // 疊在一起（12 px 內）的光點合成一群：選取的、要顯示標籤的優先當代表，標籤加「+N」，
    // 點下去先列出同一群讓人選，不然被蓋住的點不到
    const groups: RadarItem[][] = [];
    for (const it of this.items) {
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
        if (box.top < 0 || box.bottom > SIZE) continue;
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
        node.appendChild(el('circle', { class: 'ping', r: 6 }));
        const body = el('g', { class: 'body' });
        this.appendMark(body, p.out, it.spot, it.office);
        // 離開始越久越淡、越模糊；選取時看清楚
        if (it.fade !== undefined && !it.selected) {
          const blur = ((1 - it.fade) * 1.5).toFixed(2);
          body.setAttribute('style', `opacity:${(0.35 + 0.65 * it.fade).toFixed(2)};filter:blur(${blur}px)`);
          body.dataset.blur = blur;
        }
        node.appendChild(body);
        this.addFlash(node, p.angle, p.r, p.out ? 5 : 7);
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
