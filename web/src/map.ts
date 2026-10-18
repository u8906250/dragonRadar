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
  approx?: boolean;
  title: string;
  subtitle: string;
  selected: boolean;
}

/** 底圖：nlsc 台灣通用電子地圖（國土測繪中心）、osm OpenStreetMap */
export type BaseMap = 'nlsc' | 'osm';

/** 地圖上的車掃路線：每段依認領人數上色 */
export interface MapRoute {
  id: string;
  title: string;
  state: 'planned' | 'live' | 'done';
  claimUrl: string | null;
  segments: Array<{ seq: number; from: string; to: string; path: Array<[number, number]>; people: number; target: number }>;
}

/** 跟大洋流車掃地圖一樣的顏色：沒人灰、缺人綠、快滿（6 成以上）橘、已滿紅 */
const CROWD = {
  empty: { color: '#9ca3af', label: '還沒有人' },
  low: { color: '#16a34a', label: '缺人' },
  mid: { color: '#f59e0b', label: '快滿' },
  full: { color: '#dc2626', label: '已滿' },
} as const;

export function crowdOf(people: number, target: number): keyof typeof CROWD {
  if (people === 0) return 'empty';
  const r = target > 0 ? people / target : 1;
  return r >= 1 ? 'full' : r >= 0.6 ? 'mid' : 'low';
}

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
  /** 雷達目前的範圍（外圈），切到地圖時用同樣的比例 */
  private rangeCircle: Leaflet.Circle | null = null;
  private readonly markers = new Map<number, Leaflet.CircleMarker>();
  private routeLayer: Leaflet.LayerGroup | null = null;
  /** 「雙北」範圍時的縣市界 */
  private outline: Leaflet.Polygon | null = null;
  private outlineRings: Array<Array<[number, number]>> = [];
  private routes: MapRoute[] = [];
  /** 座標一樣合成一個點時，每個項目對應到畫出來的那個標記 */
  private readonly leaderOf = new Map<number, number>();
  /** 畫出來的標記代表哪些項目 */
  private readonly groupIds = new Map<number, number[]>();
  private items: MapItem[] = [];
  private origin: LatLng;
  private accuracy: number | null = null;
  private pickMode = false;
  private base: BaseMap;

  constructor(
    private readonly el: HTMLElement,
    origin: LatLng,
    private readonly handlers: { onSelect: (id: number, group: number[]) => void; onPickOrigin: (p: LatLng) => void },
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
      const map = L.map(this.el, { zoomControl: true, attributionControl: true, zoomSnap: 0 }).setView([this.origin.lat, this.origin.lng], 15);
      map.attributionControl.setPrefix(false);
      this.map = map;
      this.routeLayer = L.layerGroup().addTo(map);
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
      this.rangeCircle = L.circle([this.origin.lat, this.origin.lng], {
        radius: 0,
        color: '#888888',
        weight: 1.5,
        opacity: 0.6,
        dashArray: '6 6',
        fill: false,
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
      this.pushOutline();
      this.pushRoutes();
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
    this.rangeCircle?.setLatLng([this.origin.lat, this.origin.lng]);
  }

  private pushItems(): void {
    const L = this.L;
    const layer = this.layer;
    if (!L || !layer) return;
    const stroke = cssVar('--blip-stroke', '#15171c');
    const selectedStroke = cssVar('--blip-selected', '#ffffff');
    // 座標一樣（到小數點 5 位，約 1 公尺）的合成一個點，旁邊標「+N」，點下去再選；放大地圖也分不開
    const groups = new Map<string, MapItem[]>();
    for (const it of this.items) {
      const k = `${it.lat.toFixed(5)},${it.lng.toFixed(5)}`;
      const g = groups.get(k);
      if (g) g.push(it);
      else groups.set(k, [it]);
    }
    const keep = new Set<number>();
    this.leaderOf.clear();
    this.groupIds.clear();
    for (const g of groups.values()) {
      const it = g.find((x) => x.selected) ?? g.find((x) => x.phase === 'active') ?? g[0];
      const ids = g.map((x) => x.id);
      keep.add(it.id);
      let m = this.markers.get(it.id);
      if (!m) {
        const id = it.id;
        m = L.circleMarker([it.lat, it.lng]);
        m.on('click', () => this.handlers.onSelect(id, this.groupIds.get(id) ?? [id]));
        m.bindPopup('', { closeButton: false });
        layer.addLayer(m);
        this.markers.set(it.id, m);
      }
      this.groupIds.set(it.id, ids);
      m.setLatLng([it.lat, it.lng]);
      m.setRadius(it.approx ? 14 : it.phase === 'active' ? 10 : 8);
      m.setStyle({
        color: it.selected ? selectedStroke : stroke,
        weight: it.selected ? 3 : 2,
        fillColor: markerColor(it.kind, it.phase, it.spot),
        fillOpacity: it.approx ? 0.15 : it.phase === 'later' || it.phase === 'closed' ? 0.5 : 0.95,
        // 固定據點、約略位置用虛線外框，跟精確的單次發放、活動分開
        dashArray: it.spot || it.approx ? '3 3' : '',
      });
      m.setPopupContent(
        g.length > 1
          ? `<strong>這裡有 ${g.length} 個</strong><br>${g.map((x) => escapeHtml(x.title)).join('<br>')}`
          : `<strong>${escapeHtml(it.title)}</strong><br>${escapeHtml(it.subtitle)}`,
      );
      if (g.length > 1) {
        if (m.getTooltip()) m.setTooltipContent(`+${g.length - 1}`);
        else m.bindTooltip(`+${g.length - 1}`, { permanent: true, direction: 'right', className: 'map-count', offset: [8, 0] });
      } else if (m.getTooltip()) m.unbindTooltip();
      for (const x of g) this.leaderOf.set(x.id, it.id);
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

  /**
   * 切到地圖時呼叫：以目前位置為中心，每公里的像素和雷達一樣（px = 雷達外圈的半徑像素），
   * 虛線圈就是雷達的外圈。不知道雷達多大時，讓畫面短邊剛好裝下範圍。
   */
  showRange(km: number, px: number): void {
    void this.ensure().then(() => {
      const L = this.L;
      const map = this.map;
      if (!L || !map) return;
      map.invalidateSize();
      const center = L.latLng(this.origin.lat, this.origin.lng);
      this.rangeCircle?.setLatLng(center).setRadius(km * 1000);
      const size = map.getSize();
      const fit = Math.min(size.x, size.y) / 2;
      const radiusPx = px > 0 ? Math.min(px, fit) : fit;
      if (radiusPx <= 0) return;
      // Web Mercator：縮放 z 時每像素 = 40075016.686 × cos(緯度) ÷ 2^(z+8) 公尺
      const z = Math.log2((40075016.686 * Math.cos((center.lat * Math.PI) / 180) * radiusPx) / (km * 1000)) - 8;
      map.setView(center, Math.min(Math.max(z, map.getMinZoom()), map.getMaxZoom()), { animate: false });
    });
  }

  /** 地圖目前在你的位置附近每像素幾公里；地圖還沒載入時回傳 null */
  kmPerPx(): number | null {
    if (!this.map) return null;
    return (40075.016686 * Math.cos((this.origin.lat * Math.PI) / 180)) / 2 ** (this.map.getZoom() + 8);
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
      const m = this.markers.get(this.leaderOf.get(id) ?? id);
      if (!it || !m || !this.map) return;
      this.map.setView([it.lat, it.lng], Math.max(this.map.getZoom(), 15), { animate: true });
      m.openPopup();
    });
  }

  render(items: MapItem[]): void {
    this.items = items;
    this.pushItems();
  }

  /** 範圍的實際形狀（雙北的縣市界）；空陣列就不畫 */
  setOutline(rings: Array<Array<[number, number]>>): void {
    if (rings === this.outlineRings) return;
    this.outlineRings = rings;
    this.pushOutline();
  }

  private pushOutline(): void {
    const L = this.L;
    const map = this.map;
    if (!L || !map) return;
    this.outline?.remove();
    this.outline = null;
    if (this.outlineRings.length === 0) return;
    this.outline = L.polygon(this.outlineRings, { color: '#03615a', weight: 3.5, opacity: 0.9, dashArray: '8 6', fillColor: '#03615a', fillOpacity: 0.08, interactive: false }).addTo(map);
    this.outline.bringToBack();
  }

  setRoutes(routes: MapRoute[]): void {
    const sig = (rs: MapRoute[]): string => JSON.stringify(rs.map((r) => [r.id, r.state, r.segments.map((x) => [x.people, x.target, x.path.length])]));
    if (sig(routes) === sig(this.routes)) return;
    this.routes = routes;
    this.pushRoutes();
  }

  /** 地圖移到整條路線 */
  focusRoute(id: string): void {
    void this.ensure().then(() => {
      const L = this.L;
      const r = this.routes.find((x) => x.id === id);
      if (!L || !this.map || !r) return;
      const pts = r.segments.flatMap((x) => x.path);
      if (pts.length > 0) this.map.fitBounds(L.latLngBounds(pts), { padding: [24, 24] });
    });
  }

  private pushRoutes(): void {
    const L = this.L;
    const layer = this.routeLayer;
    if (!L || !layer) return;
    layer.clearLayers();
    for (const r of this.routes) {
      if (r.state === 'done') continue;
      for (const seg of r.segments) {
        const c = CROWD[crowdOf(seg.people, seg.target)];
        const line = L.polyline(seg.path, { color: c.color, weight: 6, opacity: 0.85, lineCap: 'round', lineJoin: 'round' });
        line.bindPopup(
          `<strong>${escapeHtml(r.title)}・第 ${seg.seq} 段</strong><br>${escapeHtml(seg.from)} → ${escapeHtml(seg.to)}<br>` +
            `認領 ${seg.people} / 目標 ${seg.target} 人（${c.label}）` +
            (r.claimUrl ? `<br><a href="${escapeHtml(r.claimUrl)}" target="_blank" rel="noopener">到車掃地圖認領路段</a>` : ''),
          { closeButton: false },
        );
        layer.addLayer(line);
        line.bringToBack();
      }
    }
  }
}
