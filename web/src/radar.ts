import type { BlipStyle, EventKind, Phase, SweepStyle } from './types';

export interface RadarItem {
  id: number;
  kind: EventKind;
  distanceKm: number;
  bearing: number;
  phase: Phase;
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
  private readonly roseLayer: SVGGElement;
  private scaleKm = 5;
  private heading = 0;
  private items: RadarItem[] = [];
  private style: RadarStyle = { sweep: 'wedge', blip: 'dot', rose: false };

  constructor(container: HTMLElement, onSelect: (id: number) => void) {
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
        <circle cx="${C}" cy="${C}" r="${R * 0.25}" />
        <circle cx="${C}" cy="${C}" r="${R * 0.5}" />
        <circle cx="${C}" cy="${C}" r="${R * 0.75}" />
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
      <g class="blips"></g>
      <circle class="me" cx="${C}" cy="${C}" r="5" />
      <g class="rose"></g>
    `;
    this.blipLayer = this.svg.querySelector('.blips') as SVGGElement;
    this.scaleLabels = this.svg.querySelector('.scale-labels') as SVGGElement;
    this.roseLayer = this.svg.querySelector('.rose') as SVGGElement;
    for (const [letter, deg] of ROSE) {
      const t = el('text', { class: `rose-letter rose-${letter.toLowerCase()}`, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'data-deg': deg });
      t.textContent = letter;
      this.roseLayer.appendChild(t);
    }
    this.blipLayer.addEventListener('click', (e) => {
      const g = (e.target as Element).closest('.blip') as SVGGElement | null;
      if (g?.dataset.id) onSelect(Number(g.dataset.id));
    });
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

  setScale(km: number): void {
    this.scaleKm = km;
    this.scaleLabels.replaceChildren();
    for (const f of [0.5, 1]) {
      const t = el('text', { x: C + 5, y: C - R * f + 13, class: 'scale-label' });
      const v = f * km;
      t.textContent = `${Number.isInteger(v) ? v : v.toFixed(1)} km`;
      this.scaleLabels.appendChild(t);
    }
    this.draw();
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

  private appendMark(g: SVGGElement, out: boolean): void {
    const r = out ? 4 : 6;
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
    // 標籤避讓：選取的優先，其次依清單順序（進行中、近的在前），和已放的標籤重疊就不畫
    const placed: Array<{ x: number; y: number; w: number }> = [];
    const order = [...this.items].sort((a, b) => Number(b.selected) - Number(a.selected));
    const labelOk = new Set<number>();
    for (const it of order) {
      if (!it.showLabel) continue;
      const ratio = Math.min(1, it.distanceKm / this.scaleKm);
      const p = polar(it.bearing - this.heading, ratio * (R - 8));
      const w = [...it.label].length * 12;
      if (placed.some((q) => Math.abs(q.y - p.y) < 15 && Math.abs(q.x - p.x) < (q.w + w) / 2)) continue;
      placed.push({ x: p.x, y: p.y, w });
      labelOk.add(it.id);
    }
    for (const it of this.items) {
      const ratio = it.distanceKm / this.scaleKm;
      const out = ratio > 1;
      const p = polar(it.bearing - this.heading, Math.min(1, ratio) * (R - 8));
      const g = el('g', {
        class: `blip phase-${it.phase} kind-${it.kind}${out ? ' out' : ''}${it.selected ? ' selected' : ''}`,
        transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`,
        tabindex: 0,
        role: 'button',
      });
      g.dataset.id = String(it.id);
      g.appendChild(el('circle', { class: 'hit', r: 22 }));
      g.appendChild(el('circle', { class: 'ping', r: 6 }));
      this.appendMark(g, out);
      if (it.showLabel && labelOk.has(it.id)) {
        // 靠近左右邊緣的標籤往內對齊，避免被雷達外框切掉
        const anchor = p.x > C + R * 0.45 ? 'end' : p.x < C - R * 0.45 ? 'start' : 'middle';
        const label = el('text', { class: 'label', y: -13, x: anchor === 'end' ? 6 : anchor === 'start' ? -6 : 0, 'text-anchor': anchor });
        label.textContent = it.label;
        g.appendChild(label);
      }
      const title = el('title');
      title.textContent = it.label;
      g.appendChild(title);
      this.blipLayer.appendChild(g);
    }
  }
}
