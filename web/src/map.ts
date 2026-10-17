import type { GeoJSONSource, Map as MlMap, MapGeoJSONFeature, Popup, StyleSpecification } from 'maplibre-gl';
import type { LatLng } from './geo';
import type { EventKind, Phase } from './types';

export interface MapItem {
  id: number;
  kind: EventKind;
  lat: number;
  lng: number;
  phase: Phase;
  title: string;
  subtitle: string;
  selected: boolean;
}

/** 底圖：clear 向量地圖（依主題亮暗）、nlsc 台灣通用電子地圖、osm */
export type BaseMap = 'clear' | 'nlsc' | 'osm';

const NLSC_ATTR = '<a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noopener">內政部國土測繪中心</a>';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

function rasterStyle(tiles: string, attribution: string, maxzoom: number): StyleSpecification {
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom, attribution } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  };
}

function styleFor(base: BaseMap, dark: boolean): string | StyleSpecification {
  if (base === 'nlsc') return rasterStyle('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', NLSC_ATTR, 19);
  if (base === 'osm') return rasterStyle('https://tile.openstreetmap.org/{z}/{x}/{y}.png', OSM_ATTR, 19);
  return dark ? 'https://tiles.openfreemap.org/styles/dark' : 'https://tiles.openfreemap.org/styles/liberty';
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function markerColor(kind: EventKind, phase: Phase): string {
  if (phase === 'later') return cssVar('--muted', '#888888');
  if (kind === 'activity') return cssVar('--blip-activity', '#03615a');
  return phase === 'soon' ? cssVar('--blip-soon', '#ffe08a') : cssVar('--blip', '#ea611d');
}

/** 以公尺為半徑的圓（給定位誤差範圍用） */
function circlePolygon(c: LatLng, meters: number, steps = 48): { type: 'Feature'; properties: Record<string, never>; geometry: { type: 'Polygon'; coordinates: [number, number][][] } } {
  const coords: [number, number][] = [];
  const dLat = meters / 111_320;
  const dLng = meters / (111_320 * Math.cos((c.lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    coords.push([c.lng + dLng * Math.cos(a), c.lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** 中文地名優先：繁中 > 中文 > 原名 */
const ZH_NAME = ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name:nonlatin'], ['get', 'name']];

/**
 * MapLibre 向量地圖。第一次切到地圖時才載入（約 250 KB gzip），雷達畫面不受影響。
 */
export class MapView {
  private map: MlMap | null = null;
  private loading: Promise<void> | null = null;
  private popup: Popup | null = null;
  private items: MapItem[] = [];
  private origin: LatLng;
  private accuracy: number | null = null;
  private pickMode = false;
  private base: BaseMap;
  private dark = false;
  private lib: typeof import('maplibre-gl') | null = null;

  constructor(
    private readonly el: HTMLElement,
    origin: LatLng,
    private readonly handlers: { onSelect: (id: number) => void; onPickOrigin: (p: LatLng) => void },
    base: BaseMap = 'clear',
  ) {
    this.origin = origin;
    this.base = base;
  }

  /** 地圖畫面顯示時呼叫：第一次會載入 MapLibre，之後只重算尺寸 */
  invalidate(): void {
    if (this.map) {
      this.map.resize();
      return;
    }
    void this.ensure();
  }

  private ensure(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const [lib] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]);
      this.lib = lib;
      const map = new lib.Map({
        container: this.el,
        style: styleFor(this.base, this.dark),
        center: [this.origin.lng, this.origin.lat],
        zoom: 14,
        attributionControl: { compact: true },
        // 中文字用手機內建字型繪製，清楚又不用下載字型檔
        localIdeographFontFamily: "'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif",
        pitchWithRotate: false,
        dragRotate: false,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-left');
      map.on('style.load', () => this.installLayers());
      // 版權標示預設收合成「i」，不要蓋住下方的底圖按鈕
      map.once('idle', () => {
        this.el.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      });
      map.on('click', (e) => {
        const hit = map.queryRenderedFeatures(e.point, { layers: ['events-dot'] })[0] as MapGeoJSONFeature | undefined;
        if (hit) {
          this.handlers.onSelect(Number(hit.properties?.id));
          return;
        }
        if (this.pickMode) this.handlers.onPickOrigin({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
      map.on('mouseenter', 'events-dot', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'events-dot', () => (map.getCanvas().style.cursor = this.pickMode ? 'crosshair' : ''));
      this.map = map;
    })();
    return this.loading;
  }

  /** 換底圖或換主題後，重新加上我們自己的圖層，並把地名改成中文 */
  private installLayers(): void {
    const map = this.map;
    if (!map) return;
    if (this.base === 'clear') {
      for (const layer of map.getStyle().layers ?? []) {
        if (layer.type === 'symbol' && map.getLayoutProperty(layer.id, 'text-field') !== undefined) {
          map.setLayoutProperty(layer.id, 'text-field', ZH_NAME as never);
        }
      }
    }
    map.addSource('accuracy', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('origin', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('events', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'accuracy-fill', type: 'fill', source: 'accuracy', paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.12 } });
    map.addLayer({ id: 'accuracy-line', type: 'line', source: 'accuracy', paint: { 'line-color': '#3b82f6', 'line-width': 1, 'line-opacity': 0.5 } });
    map.addLayer({
      id: 'events-dot',
      type: 'circle',
      source: 'events',
      paint: {
        'circle-radius': ['get', 'radius'],
        'circle-color': ['get', 'color'],
        'circle-opacity': ['get', 'opacity'],
        'circle-stroke-color': ['get', 'stroke'],
        'circle-stroke-width': ['get', 'strokeWidth'],
      },
    });
    map.addLayer({
      id: 'origin-dot',
      type: 'circle',
      source: 'origin',
      paint: { 'circle-radius': 8, 'circle-color': '#3b82f6', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
    });
    this.pushOrigin();
    this.pushItems();
  }

  private pushOrigin(): void {
    const map = this.map;
    if (!map?.getSource('origin')) return;
    (map.getSource('origin') as GeoJSONSource).setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [this.origin.lng, this.origin.lat] },
    });
    (map.getSource('accuracy') as GeoJSONSource).setData(
      this.accuracy ? circlePolygon(this.origin, this.accuracy) : { type: 'FeatureCollection', features: [] },
    );
  }

  private pushItems(): void {
    const map = this.map;
    if (!map?.getSource('events')) return;
    const selectedStroke = cssVar('--blip-selected', '#ffffff');
    const stroke = cssVar('--blip-stroke', '#15171c');
    (map.getSource('events') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: this.items.map((it) => ({
        type: 'Feature',
        properties: {
          id: it.id,
          color: markerColor(it.kind, it.phase),
          stroke: it.selected ? selectedStroke : stroke,
          strokeWidth: it.selected ? 3 : 2,
          radius: it.phase === 'active' ? 10 : 8,
          opacity: it.phase === 'later' ? 0.6 : 0.95,
        },
        geometry: { type: 'Point', coordinates: [it.lng, it.lat] },
      })),
    });
  }

  setOrigin(p: LatLng, pan = false, accuracyM: number | null = null): void {
    this.origin = p;
    this.accuracy = accuracyM;
    this.pushOrigin();
    if (pan) this.map?.easeTo({ center: [p.lng, p.lat], zoom: Math.max(this.map.getZoom(), 15), duration: 600 });
  }

  setPickMode(on: boolean): void {
    this.pickMode = on;
    if (this.map) this.map.getCanvas().style.cursor = on ? 'crosshair' : '';
  }

  setBase(base: BaseMap): void {
    if (base === this.base) return;
    this.base = base;
    this.map?.setStyle(styleFor(base, this.dark));
  }

  /** 主題亮暗改變時，清晰地圖跟著換亮色或深色 */
  setDark(dark: boolean): void {
    if (dark === this.dark) return;
    this.dark = dark;
    if (this.base === 'clear') this.map?.setStyle(styleFor('clear', dark));
    else this.pushItems();
  }

  focus(id: number): void {
    const it = this.items.find((x) => x.id === id);
    if (!it) return;
    void this.ensure().then(() => {
      const map = this.map;
      const lib = this.lib;
      if (!map || !lib) return;
      map.easeTo({ center: [it.lng, it.lat], zoom: Math.max(map.getZoom(), 15), duration: 600 });
      this.popup?.remove();
      this.popup = new lib.Popup({ closeButton: false, offset: 14 })
        .setLngLat([it.lng, it.lat])
        .setHTML(`<strong>${escapeHtml(it.title)}</strong><br>${escapeHtml(it.subtitle)}`)
        .addTo(map);
    });
  }

  render(items: MapItem[]): void {
    this.items = items;
    this.pushItems();
  }
}
