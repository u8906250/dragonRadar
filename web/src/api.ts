import type { LatLng } from './geo';
import type { EventOut } from './types';

/** 正式環境的 Worker 網址；本機開發打 localhost，VITE_API_BASE 可覆寫 */
const PROD_API_BASE = 'https://dragon-radar.happybadminton.workers.dev';
const isLocal = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? (isLocal ? 'http://localhost:8787' : PROD_API_BASE)).replace(/\/$/, '');

export async function fetchEvents(origin: LatLng, radiusKm: number): Promise<EventOut[]> {
  const u = new URL(`${API_BASE}/api/events`);
  u.searchParams.set('lat', origin.lat.toFixed(5));
  u.searchParams.set('lng', origin.lng.toFixed(5));
  u.searchParams.set('radius_km', String(radiusKm));
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`API ${r.status}`);
  const j = (await r.json()) as { events: EventOut[] };
  return j.events;
}

export async function fetchHealth(): Promise<{ ok: boolean; mode: 'live' | 'mock' }> {
  const r = await fetch(`${API_BASE}/api/health`);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return (await r.json()) as { ok: boolean; mode: 'live' | 'mock' };
}
