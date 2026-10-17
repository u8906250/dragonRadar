import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng } from './geo';
import type { Phase } from './types';

export interface MapItem {
  id: number;
  lat: number;
  lng: number;
  phase: Phase;
  title: string;
  subtitle: string;
  selected: boolean;
}

const PHASE_COLOR: Record<Phase, string> = { active: '#ffd43b', soon: '#8fd3a8', later: '#5c7a68' };

export class MapView {
  private readonly map: L.Map;
  private readonly originMarker: L.CircleMarker;
  private readonly layer = L.layerGroup();
  private readonly markers = new Map<number, L.CircleMarker>();
  private pickMode = false;

  constructor(el: HTMLElement, origin: LatLng, handlers: { onSelect: (id: number) => void; onPickOrigin: (p: LatLng) => void }) {
    this.map = L.map(el, { zoomControl: true, attributionControl: true }).setView([origin.lat, origin.lng], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);
    this.layer.addTo(this.map);
    this.originMarker = L.circleMarker([origin.lat, origin.lng], { radius: 8, color: '#3cff8a', fillColor: '#3cff8a', fillOpacity: 0.9, weight: 2 })
      .bindTooltip('我的位置')
      .addTo(this.map);
    this.map.on('click', (e: L.LeafletMouseEvent) => {
      if (!this.pickMode) return;
      handlers.onPickOrigin({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    this.onSelect = handlers.onSelect;
  }

  private readonly onSelect: (id: number) => void;

  setOrigin(p: LatLng, pan = false): void {
    this.originMarker.setLatLng([p.lat, p.lng]);
    if (pan) this.map.panTo([p.lat, p.lng]);
  }

  setPickMode(on: boolean): void {
    this.pickMode = on;
    this.map.getContainer().style.cursor = on ? 'crosshair' : '';
  }

  invalidate(): void {
    this.map.invalidateSize();
  }

  focus(id: number): void {
    const m = this.markers.get(id);
    if (m) {
      this.map.panTo(m.getLatLng());
      m.openPopup();
    }
  }

  render(items: MapItem[]): void {
    const keep = new Set<number>();
    for (const it of items) {
      keep.add(it.id);
      const color = PHASE_COLOR[it.phase];
      let m = this.markers.get(it.id);
      if (!m) {
        m = L.circleMarker([it.lat, it.lng], { radius: 9, weight: 2 });
        m.on('click', () => this.onSelect(it.id));
        m.bindPopup('');
        this.layer.addLayer(m);
        this.markers.set(it.id, m);
      }
      m.setLatLng([it.lat, it.lng]);
      m.setStyle({ color: it.selected ? '#ffffff' : color, fillColor: color, fillOpacity: it.phase === 'active' ? 0.95 : 0.55 });
      m.setPopupContent(`<strong>${escapeHtml(it.title)}</strong><br>${escapeHtml(it.subtitle)}`);
    }
    for (const [id, m] of this.markers) {
      if (!keep.has(id)) {
        this.layer.removeLayer(m);
        this.markers.delete(id);
      }
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
