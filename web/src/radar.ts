import type { Phase } from './types';

export interface RadarItem {
  id: number;
  distanceKm: number;
  bearing: number;
  phase: Phase;
  label: string;
  showLabel: boolean;
  selected: boolean;
}

const SIZE = 400;
const C = SIZE / 2;
const R = 172;
const SVG_NS = 'http://www.w3.org/2000/svg';

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
 * 龍珠雷達風格的 SVG 雷達：使用者在圓心，光點依方位與距離擺放。
 * heading 不為 0 時整個畫面以手機朝向為上，N 標記會跟著移動，文字維持正立。
 */
export class Radar {
  private readonly svg: SVGSVGElement;
  private readonly blipLayer: SVGGElement;
  private readonly scaleLabels: SVGGElement;
  private readonly north: SVGTextElement;
  private scaleKm = 5;
  private heading = 0;
  private items: RadarItem[] = [];

  constructor(container: HTMLElement, onSelect: (id: number) => void) {
    this.svg = el('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'radar', role: 'img', 'aria-label': '雷達畫面' });
    const wedgeEnd = polar(45, R);
    this.svg.innerHTML = `
      <defs>
        <radialGradient id="rg-screen" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#0f4a2d" />
          <stop offset="1" stop-color="#052016" />
        </radialGradient>
        <linearGradient id="rg-sweep" gradientUnits="userSpaceOnUse" x1="${C}" y1="${C}" x2="${C + R}" y2="${C - R}">
          <stop offset="0" stop-color="#3cff8a" stop-opacity="0.55" />
          <stop offset="1" stop-color="#3cff8a" stop-opacity="0" />
        </linearGradient>
        <clipPath id="rg-clip"><circle cx="${C}" cy="${C}" r="${R}" /></clipPath>
      </defs>
      <circle class="bezel" cx="${C}" cy="${C}" r="${R + 16}" />
      <circle class="screen" cx="${C}" cy="${C}" r="${R}" fill="url(#rg-screen)" />
      <g class="grid">
        <circle cx="${C}" cy="${C}" r="${R * 0.25}" />
        <circle cx="${C}" cy="${C}" r="${R * 0.5}" />
        <circle cx="${C}" cy="${C}" r="${R * 0.75}" />
        <circle cx="${C}" cy="${C}" r="${R}" class="outer" />
        <line x1="${C}" y1="${C - R}" x2="${C}" y2="${C + R}" />
        <line x1="${C - R}" y1="${C}" x2="${C + R}" y2="${C}" />
      </g>
      <g clip-path="url(#rg-clip)">
        <path class="sweep" fill="url(#rg-sweep)" d="M ${C} ${C} L ${C} ${C - R} A ${R} ${R} 0 0 1 ${wedgeEnd.x.toFixed(2)} ${wedgeEnd.y.toFixed(2)} Z">
          <animateTransform attributeName="transform" type="rotate" from="0 ${C} ${C}" to="360 ${C} ${C}" dur="4s" repeatCount="indefinite" />
        </path>
      </g>
      <g class="scale-labels"></g>
      <g class="blips"></g>
      <circle class="me" cx="${C}" cy="${C}" r="5" />
      <text class="north" text-anchor="middle" dominant-baseline="middle">N</text>
    `;
    this.blipLayer = this.svg.querySelector('.blips') as SVGGElement;
    this.scaleLabels = this.svg.querySelector('.scale-labels') as SVGGElement;
    this.north = this.svg.querySelector('.north') as SVGTextElement;
    this.blipLayer.addEventListener('click', (e) => {
      const g = (e.target as Element).closest('.blip') as SVGGElement | null;
      if (g?.dataset.id) onSelect(Number(g.dataset.id));
    });
    container.appendChild(this.svg);
    this.setScale(this.scaleKm);
    this.placeNorth();
  }

  setScale(km: number): void {
    this.scaleKm = km;
    this.scaleLabels.replaceChildren();
    for (const f of [0.5, 1]) {
      const t = el('text', { x: C + 5, y: C - R * f + 13, class: 'scale-label' });
      t.textContent = `${f * km} km`;
      this.scaleLabels.appendChild(t);
    }
    this.draw();
  }

  /** 手機朝向（0 = 北，順時針）。null 代表關閉指北針，恢復北在上 */
  setHeading(deg: number | null): void {
    this.heading = deg === null ? 0 : ((deg % 360) + 360) % 360;
    this.north.classList.toggle('live', deg !== null);
    this.placeNorth();
    this.draw();
  }

  render(items: RadarItem[]): void {
    this.items = items;
    this.draw();
  }

  private placeNorth(): void {
    const p = polar(-this.heading, R + 4);
    this.north.setAttribute('x', p.x.toFixed(1));
    this.north.setAttribute('y', p.y.toFixed(1));
  }

  private draw(): void {
    this.blipLayer.replaceChildren();
    for (const it of this.items) {
      const ratio = it.distanceKm / this.scaleKm;
      const out = ratio > 1;
      const p = polar(it.bearing - this.heading, Math.min(1, ratio) * (R - 8));
      const g = el('g', {
        class: `blip phase-${it.phase}${out ? ' out' : ''}${it.selected ? ' selected' : ''}`,
        transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`,
        tabindex: 0,
        role: 'button',
      });
      g.dataset.id = String(it.id);
      g.appendChild(el('circle', { class: 'hit', r: 22 }));
      g.appendChild(el('circle', { class: 'ping', r: 6 }));
      g.appendChild(el('circle', { class: 'dot', r: out ? 4 : 6 }));
      if (it.showLabel) {
        const label = el('text', { class: 'label', y: -12, 'text-anchor': 'middle' });
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
