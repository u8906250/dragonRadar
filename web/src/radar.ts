import type { BlipStyle, EventKind, Phase, SweepStyle } from './types';

export interface RadarItem {
  id: number;
  kind: EventKind;
  distanceKm: number;
  bearing: number;
  phase: Phase;
  /** 固定據點，畫成菱形 */
  spot?: boolean;
  /** 約略位置，畫成空心 */
  approx?: boolean;
  label: string;
  showLabel: boolean;
  selected: boolean;
}

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

/** 光點距離小於這個像素就合成一群 */
const GROUP_PX = 12;
/** 一群光點的標籤最多幾行、每行高度 */
const MAX_LABEL_LINES = 3;
const LINE_PX = 14;
const NICE_KM = [1, 2, 5, 10, 20, 50, 100, 200, 300];

/**
 * 近密遠疏的程度：範圍 20 km 以內照比例；45 km 以上（雙北、全台）距離取對數，
 * 範圍的 1/80 以內接近等比例，再往外越壓越密。中間逐漸過渡，雙指縮放時畫面不會跳。
 */
function logKnee(scaleKm: number): number {
  if (scaleKm <= 20) return 0;
  return 80 * Math.min(1, (scaleKm - 20) / 25) ** 2;
}

/** 距離換成半徑比例（0 = 圓心，1 = 外圈，超出範圍會大於 1） */
function radiusRatio(km: number, scaleKm: number): number {
  const n = logKnee(scaleKm);
  if (n === 0) return km / scaleKm;
  return Math.log1p((km * n) / scaleKm) / Math.log1p(n);
}

function fmtKm(km: number): string {
  if (km >= 10) return `${Math.round(km)} km`;
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

/** 近密遠疏刻度的參考圈：挑幾個整數公里，圈和圈之間至少隔開外圈的 18%，全部標公里數 */
function compressedRings(scaleKm: number): Array<{ km: number; label: boolean }> {
  const at = (km: number): number => radiusRatio(km, scaleKm);
  const out: Array<{ km: number; label: boolean }> = [];
  let last = 0;
  for (const km of NICE_KM) {
    const r = at(km);
    if (r < 0.15 || r > 0.9 || r - last < 0.18) continue;
    out.push({ km, label: true });
    last = r;
  }
  return out;
}

/** 靠近左右邊緣的標籤往內對齊，避免被雷達外框切掉 */
function anchorAt(x: number): 'start' | 'middle' | 'end' {
  return x > C + R * 0.45 ? 'end' : x < C - R * 0.45 ? 'start' : 'middle';
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
  private scaleKm = 5;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private heading = 0;
  private items: RadarItem[] = [];
  private style: RadarStyle = { sweep: 'wedge', blip: 'dot', rose: false };

  /**
   * onZoom(factor, done)：雙指捏合或滑鼠滾輪，factor > 1 代表拉遠（範圍變大）；
   * done = true 表示手勢結束
   */
  constructor(container: HTMLElement, onSelect: (id: number, group: number[]) => void, onZoom?: (factor: number, done: boolean) => void) {
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
      <circle class="me" cx="${C}" cy="${C}" r="5" />
      <g class="blips"></g>
      <g class="rose"></g>
    `;
    this.blipLayer = this.svg.querySelector('.blips') as SVGGElement;
    this.scaleLabels = this.svg.querySelector('.scale-labels') as SVGGElement;
    this.rings = this.svg.querySelector('.rings') as SVGGElement;
    this.roseLayer = this.svg.querySelector('.rose') as SVGGElement;
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
  }

  setStyle(s: RadarStyle): void {
    this.style = s;
    this.svg.setAttribute('class', `radar sweep-${s.sweep} blip-${s.blip}${s.rose ? ' has-rose' : ''}`);
    this.draw();
  }

  private wireZoom(onZoom: (factor: number, done: boolean) => void): void {
    const svg = this.svg;
    const dist = (): number => {
      const [a, b] = [...this.pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    svg.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) this.pinchDist = dist();
    });
    svg.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size !== 2) return;
      const d = dist();
      if (this.pinchDist > 0 && d > 0) onZoom(this.pinchDist / d, false);
      this.pinchDist = d;
    });
    const end = (e: PointerEvent): void => {
      if (!this.pointers.delete(e.pointerId)) return;
      if (this.pointers.size === 1 && this.pinchDist > 0) onZoom(1, true);
      if (this.pointers.size < 2) this.pinchDist = 0;
    };
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

  /** 範圍 20 km 以內照比例，更大時近密遠疏，不然附近幾公里的光點全擠在圓心 */
  setScale(km: number): void {
    this.scaleKm = km;
    this.rings.replaceChildren();
    this.scaleLabels.replaceChildren();
    const marks = logKnee(km) > 0 ? compressedRings(km) : [0.25, 0.5, 0.75].map((f) => ({ km: f * km, label: f === 0.5 }));
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

  render(items: RadarItem[]): void {
    this.items = items;
    this.draw();
  }

  private placeRose(): void {
    for (const t of Array.from(this.roseLayer.children) as SVGTextElement[]) {
      const deg = Number(t.dataset.deg ?? 0);
      const p = polar(deg - this.heading, R + 4);
      t.setAttribute('x', p.x.toFixed(1));
      t.setAttribute('y', p.y.toFixed(1));
    }
  }

  private appendMark(g: SVGGElement, out: boolean, spot = false): void {
    const r = out ? 4 : 6;
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

  private draw(): void {
    this.blipLayer.replaceChildren();
    const pos = new Map<number, { x: number; y: number; out: boolean }>();
    for (const it of this.items) {
      const ratio = this.ratio(it.distanceKm);
      const p = polar(it.bearing - this.heading, Math.min(1, ratio) * (R - 8));
      pos.set(it.id, { ...p, out: ratio > 1 });
    }
    // 疊在一起（12 px 內）的光點合成一群：選取的、要顯示標籤的優先當代表，標籤加「+N」，
    // 點下去詳細資料會列出同一群的其他項目，不然被蓋住的點不到
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
    // 同一群的名稱一行一個疊起來（從你這裡看方向、距離都一樣的點，縮放也分不開），超過 3 個只列前 2 個
    const placed: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    const labelLines = new Map<number, { lines: string[]; below: boolean }>();
    for (const g of [...groups].sort((a, b) => Number(b.some((it) => it.selected)) - Number(a.some((it) => it.selected)))) {
      const lead = leaderOf(g);
      const named = [lead, ...g.filter((it) => it !== lead && it.showLabel)];
      if (!g.some((it) => it.showLabel)) continue;
      const rest = g.length - named.length;
      let full = named.map((it) => it.label);
      if (full.length > MAX_LABEL_LINES) full = [...full.slice(0, MAX_LABEL_LINES - 1), `還有 ${g.length - MAX_LABEL_LINES + 1} 個`];
      else if (rest > 0) full[full.length - 1] += ` +${rest}`;
      const p = pos.get(lead.id)!;
      const anchor = anchorAt(p.x);
      // 先試整串放上方、再試下方；都擠不下才縮成一行「名稱 +N」
      const tries: Array<{ lines: string[]; below: boolean }> = [
        { lines: full, below: false },
        { lines: full, below: true },
      ];
      if (full.length > 1) {
        const one = [`${lead.label} +${g.length - 1}`];
        tries.push({ lines: one, below: false }, { lines: one, below: true });
      }
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
        this.appendMark(node, p.out, it.spot);
        const lbl = it === lead ? labelLines.get(it.id) : undefined;
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
