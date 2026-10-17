import type * as Leaflet from 'leaflet';
import type { LatLng } from './geo';
import type { EventKind, Phase } from './types';

export interface MapItem {
  id: number;
  kind: EventKind;
  lat: number;
  lng: number;
  phase: Phase;
  spot?: boolean;
  title: string;
  subtitle: string;
  selected: boolean;
}

/** 底圖：nlsc 台灣通用電子地圖（國土測繪中心）、osm OpenStreetMap */
export type BaseMap = 'nlsc' | 'osm';

const BASES: Record<BaseMap, { url: string; attribution: string; maxNativeZoom: number }> = {
  nlsc: {
    url: 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}',
    attribution: '<a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noopener">內政部國土測繪中心</a>',
    maxNativeZoom: 19,
  },
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    maxNativeZoom: 19,
  },
};

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function markerColor(kind: EventKind, phase: Phase, spot = false): string {
  if (phase === 'later') return cssVar('--muted', '#888888');
  if (spot) return cssVar('--blip-spot', '#1d4e89');
  if (kind === 'activity') return cssVar('--blip-activity', '#03615a');
  return phase === 'soon' ? cssVar('--blip-soon', '#ffe08a') : cssVar('--blip', '#ea611d');
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Leaflet 地圖，第一次切到地圖時才載入 */
export class MapView {
  private L: typeof Leaflet | null = null;
  private map: Leaflet.Map | null = null;
  private loading: Promise<void> | null = null;
  private tiles: Leaflet.TileLayer | null = null;
  private layer: Leaflet.LayerGroup | null = null;
  private originMarker: Leaflet.CircleMarker | null = null;
  private accuracyCircle: Leaflet.Circle | null = null;
  private readonly markers = new Map<number, Leaflet.CircleMarker>();
  private items: MapItem[] = [];
  private origin: LatLng;
  private accuracy: number | null = null;
  private pickMode = false;
  private base: BaseMap;

  constructor(
    private readonly el: HTMLElement,
    origin: LatLng,
    private readonly handlers: { onSelect: (id: number) => void; onPickOrigin: (p: LatLng) => void },
    base: BaseMap = 'nlsc',
  ) {
    this.origin = origin;
    this.base = base;
  }

  /** 地圖畫面顯示時呼叫：第一次載入 Leaflet，之後重算尺寸 */
  invalidate(): void {
    if (this.map) {
      this.map.invalidateSize();
      return;
    }
    void this.ensure();
  }

  private ensure(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const [mod] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
      const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
      this.L = L;
      const map = L.map(this.el, { zoomControl: true, attributionControl: true }).setView([this.origin.lat, this.origin.lng], 15);
      map.attributionControl.setPrefix(false);
      this.map = map;
      this.layer = L.layerGroup().addTo(map);
      this.accuracyCircle = L.circle([this.origin.lat, this.origin.lng], {
        radius: 0,
        color: '#3b82f6',
        weight: 1,
        opacity: 0.5,
        fillColor: '#3b82f6',
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(map);
      this.originMarker = L.circleMarker([this.origin.lat, this.origin.lng], {
        radius: 8,
        color: '#ffffff',
        weight: 3,
        fillColor: '#3b82f6',
        fillOpacity: 1,
      })
        .bindTooltip('我的位置')
        .addTo(map);
      map.on('click', (e: Leaflet.LeafletMouseEvent) => {
        if (this.pickMode) this.handlers.onPickOrigin({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
      this.applyBase();
      this.pushOrigin();
      this.pushItems();
      // 地圖容器剛從 hidden 變成顯示，尺寸要再算一次
      requestAnimationFrame(() => map.invalidateSize());
    })();
    return this.loading;
  }

  private applyBase(): void {
    const L = this.L;
    const map = this.map;
    if (!L || !map) return;
    this.tiles?.remove();
    const b = BASES[this.base];
    this.tiles = L.tileLayer(b.url, { maxZoom: 20, maxNativeZoom: b.maxNativeZoom, attribution: b.attribution }).addTo(map);
  }

  private pushOrigin(): void {
    if (!this.originMarker || !this.accuracyCircle) return;
    this.originMarker.setLatLng([this.origin.lat, this.origin.lng]);
    this.accuracyCircle.setLatLng([this.origin.lat, this.origin.lng]);
    this.accuracyCircle.setRadius(this.accuracy ?? 0);
  }

  private pushItems(): void {
    const L = this.L;
    const layer = this.layer;
    if (!L || !layer) return;
    const stroke = cssVar('--blip-stroke', '#15171c');
    const selectedStroke = cssVar('--blip-selected', '#ffffff');
    const keep = new Set<number>();
    for (const it of this.items) {
      keep.add(it.id);
      let m = this.markers.get(it.id);
      if (!m) {
        m = L.circleMarker([it.lat, it.lng]);
        m.on('click', () => this.handlers.onSelect(it.id));
        m.bindPopup('', { closeButton: false });
        layer.addLayer(m);
        this.markers.set(it.id, m);
      }
      m.setLatLng([it.lat, it.lng]);
      m.setRadius(it.phase === 'active' ? 10 : 8);
      m.setStyle({
        color: it.selected ? selectedStroke : stroke,
        weight: it.selected ? 3 : 2,
        fillColor: markerColor(it.kind, it.phase, it.spot),
        fillOpacity: it.phase === 'later' || it.phase === 'closed' ? 0.5 : 0.95,
        // 固定據點用虛線外框，跟單次的發放、活動分開
        dashArray: it.spot ? '3 3' : '',
      });
      m.setPopupContent(`<strong>${escapeHtml(it.title)}</strong><br>${escapeHtml(it.subtitle)}`);
    }
    for (const [id, m] of this.markers) {
      if (!keep.has(id)) {
        layer.removeLayer(m);
        this.markers.delete(id);
      }
    }
  }

  setOrigin(p: LatLng, pan = false, accuracyM: number | null = null): void {
    this.origin = p;
    this.accuracy = accuracyM;
    this.pushOrigin();
    if (pan && this.map) this.map.setView([p.lat, p.lng], Math.max(this.map.getZoom(), 15), { animate: true });
  }

  setPickMode(on: boolean): void {
    this.pickMode = on;
    if (this.map) this.map.getContainer().style.cursor = on ? 'crosshair' : '';
  }

  setBase(base: BaseMap): void {
    if (base === this.base) return;
    this.base = base;
    this.applyBase();
  }

  /** 深色主題：用 CSS 把底圖轉成深色調（見 styles.css 的 .map-dark） */
  setDark(dark: boolean): void {
    this.el.classList.toggle('map-dark', dark);
    this.pushItems();
  }

  focus(id: number): void {
    void this.ensure().then(() => {
      const it = this.items.find((x) => x.id === id);
      const m = this.markers.get(id);
      if (!it || !m || !this.map) return;
      this.map.setView([it.lat, it.lng], Math.max(this.map.getZoom(), 15), { animate: true });
      m.openPopup();
    });
  }

  render(items: MapItem[]): void {
    this.items = items;
    this.pushItems();
  }
}
