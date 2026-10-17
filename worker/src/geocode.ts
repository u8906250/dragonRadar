import type { Env } from './env';
import { nowSec } from './util';

export interface GeoPoint {
  lat: number;
  lng: number;
  displayName: string;
}

const NEGATIVE_TTL_SEC = 24 * 3600;

interface CacheRow {
  lat: number | null;
  lng: number | null;
  display_name: string | null;
  resolved_at: number;
}

async function nominatim(env: Env, q: string): Promise<GeoPoint | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'tw');
  url.searchParams.set('accept-language', 'zh-TW');
  url.searchParams.set('q', q);
  const res = await fetch(url.toString(), {
    headers: { 'user-agent': env.NOMINATIM_USER_AGENT, accept: 'application/json' },
  });
  if (!res.ok) {
    console.warn(`nominatim ${res.status} for ${q}`);
    return null;
  }
  const arr = (await res.json()) as Array<{ lat: string; lon: string; display_name?: string }>;
  const hit = arr[0];
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, displayName: hit.display_name ?? q };
}

/** 地點文字轉座標，結果（含查不到）都快取在 D1 */
export async function geocode(env: Env, query: string): Promise<GeoPoint | null> {
  const key = query.trim().replace(/\s+/g, ' ');
  if (!key) return null;
  const now = nowSec();
  const cached = await env.DB.prepare('SELECT lat, lng, display_name, resolved_at FROM geocode_cache WHERE query = ?')
    .bind(key)
    .first<CacheRow>();
  if (cached) {
    if (cached.lat !== null && cached.lng !== null) {
      return { lat: cached.lat, lng: cached.lng, displayName: cached.display_name ?? key };
    }
    if (cached.resolved_at > now - NEGATIVE_TTL_SEC) return null;
  }
  const point = await nominatim(env, key);
  await env.DB.prepare(
    'INSERT INTO geocode_cache (query, lat, lng, display_name, resolved_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(query) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, display_name = excluded.display_name, resolved_at = excluded.resolved_at',
  )
    .bind(key, point?.lat ?? null, point?.lng ?? null, point?.displayName ?? null, now)
    .run();
  return point;
}
