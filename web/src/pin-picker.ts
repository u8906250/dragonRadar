/**
 * 管理頁標位置用的小地圖（Leaflet，用到才載入）。v1.834 雷達的地圖模式拿掉了（使用者說地圖不用了，回報地點錯誤也改成在雷達上標），
 * 只剩管理頁（admin.html）改車掃一站、回報的位置時用，從原本的 map.ts 搬出來
 */
import type * as Leaflet from 'leaflet';
import type { LatLng } from './geo';

/** 底圖：國土測繪中心的台灣通用電子地圖、OpenStreetMap */
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

/** 標位置用的小地圖：點地圖或拖標記改位置，每次改都呼叫 onPick */
export interface PinPicker {
  /** 把標記移到這裡（不呼叫 onPick），null 是拿掉標記 */
  set(p: LatLng | null, zoom?: number): void;
  /** 只移動地圖，不動標記 */
  view(p: LatLng, zoom?: number): void;
  remove(): void;
}

/**
 * 在 el 放一張小地圖：有 pin 就標在那裡，沒有就以 center 為中心、等使用者點。
 * mark 是要對照的原本位置（灰色圓點，不能拖），例如管理頁改車掃一站的地點時，那一站現在在哪
 */
export async function pinPicker(
  el: HTMLElement,
  pin: LatLng | null,
  center: LatLng,
  base: BaseMap,
  onPick: (p: LatLng) => void,
  mark?: { at: LatLng; title: string },
): Promise<PinPicker> {
  // Leaflet 的 ESM 版本：打包工具不用加 CommonJS 轉換的小函式（v1.834：用 CommonJS 版時那些小函式被放進管理頁的檔案，主畫面載入汪星 3D、地名時會連帶執行管理頁的程式）
  const [mod] = await Promise.all([import('leaflet/dist/leaflet-src.esm.js'), import('leaflet/dist/leaflet.css')]);
  const L = mod as unknown as typeof Leaflet;
  const start = pin ?? center;
  const map = L.map(el, { zoomControl: true, attributionControl: true, zoomSnap: 0 }).setView([start.lat, start.lng], pin || mark ? 17 : 15);
  map.attributionControl.setPrefix(false);
  // 國土測繪中心的底圖只有台灣：標國外的位置時換成 OpenStreetMap
  let shown: BaseMap | null = null;
  let tiles: Leaflet.TileLayer | null = null;
  const useBase = (): void => {
    const c = map.getCenter();
    const want: BaseMap = base === 'nlsc' && !(c.lat > 21 && c.lat < 26.5 && c.lng > 118 && c.lng < 123) ? 'osm' : base;
    if (want === shown) return;
    tiles?.remove();
    const b = BASES[want];
    tiles = L.tileLayer(b.url, { maxZoom: 20, maxNativeZoom: b.maxNativeZoom, attribution: b.attribution }).addTo(map);
    shown = want;
  };
  useBase();
  map.on('moveend', useBase);
  const icon = L.divIcon({ className: 'pin-marker', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 26] });
  let marker: Leaflet.Marker | null = null;
  const place = (p: LatLng): Leaflet.Marker => {
    if (marker) return marker.setLatLng([p.lat, p.lng]);
    marker = L.marker([p.lat, p.lng], { icon, draggable: true, autoPan: true, keyboard: false }).addTo(map);
    marker.on('dragend', () => {
      const ll = marker?.getLatLng();
      if (ll) onPick({ lat: ll.lat, lng: ll.lng });
    });
    return marker;
  };
  if (mark) {
    L.circleMarker([mark.at.lat, mark.at.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#6b7280', fillOpacity: 0.9, interactive: false })
      .bindTooltip(mark.title, { permanent: true, direction: 'top', offset: [0, -8], className: 'pin-mark-label' })
      .addTo(map);
  }
  if (pin) place(pin);
  map.on('click', (e: Leaflet.LeafletMouseEvent) => {
    place({ lat: e.latlng.lat, lng: e.latlng.lng });
    onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
  });
  // 剛從 hidden 變成顯示，尺寸要再算一次
  requestAnimationFrame(() => map.invalidateSize());
  return {
    set(p, zoom) {
      if (!p) {
        marker?.remove();
        marker = null;
        return;
      }
      place(p);
      map.setView([p.lat, p.lng], zoom ?? map.getZoom());
    },
    view(p, zoom) {
      map.setView([p.lat, p.lng], zoom ?? map.getZoom());
    },
    remove: () => map.remove(),
  };
}
