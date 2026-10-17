import type { Env } from './env';
import { nowSec } from './util';

export interface GeoPoint {
  lat: number;
  lng: number;
  displayName: string;
}

const NEGATIVE_TTL_SEC = 24 * 3600;
/** Nominatim 使用規範：每秒最多一次 */
const MIN_INTERVAL_MS = 1100;
let lastCallAt = 0;

const CITY_RE = /(台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|嘉義|苗栗|彰化|南投|雲林|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|連江)[市縣]?/;

/** 只拿掉「台北市」「新北市 」這種縣市前綴，不能動到「台北車站」裡的台北 */
const CITY_PREFIX_RE = new RegExp(`${CITY_RE.source.replace('[市縣]?', '[市縣]')}\\s*`, 'g');

/**
 * 從 LLM 給的地點產生由精確到寬鬆的查詢候選。
 * Nominatim 常找不到「4號出口」「東三門」這種細節，所以逐步拿掉，最後退到車站或地標名稱。
 */
export function placeCandidates(query: string, placeText?: string | null): string[] {
  const out: string[] = [];
  const push = (s: string | null | undefined): void => {
    const t = (s ?? '').replace(/\s+/g, ' ').trim();
    if (t.length >= 2 && !out.includes(t)) out.push(t);
  };
  const strip = (s: string): string =>
    s
      .replace(/[（(][^）)]*[）)]/g, ' ')
      .replace(/\d+\s*號?\s*出口|出口\s*\d+|[A-Za-z]\d*\s*出口/g, ' ')
      .replace(/[東西南北][一二三四五六七八九十\d]+\s*門/g, ' ')
      .replace(/\d+\s*[樓Ff](?![a-z])/g, ' ')
      .replace(/(門口|旁邊|附近|對面|前面|廣場前)/g, ' ');

  const sources = [query, placeText ?? ''];
  const city = sources.map((s) => CITY_RE.exec(s)?.[0]).find(Boolean) ?? '';
  for (const s of sources) push(s);
  for (const s of sources) push(strip(s));
  for (const s of sources) {
    // 括號裡常是「近忠孝復興站」這種線索，所以這裡不拿掉括號內容；行政區和「近」也拿掉，只留站名
    const bare = s
      .replace(/[（()）]/g, ' ')
      .replace(CITY_PREFIX_RE, ' ')
      .replace(/[\u4e00-\u9fff]{1,2}[區鄉鎮](?=[\u4e00-\u9fff]{2,}站)/g, ' ')
      .replace(/近|靠近|鄰近/g, ' ');
    const st = /(?:捷運|台鐵|臺鐵|高鐵)?\s*([\u4e00-\u9fff]{2,8}站)/.exec(strip(bare));
    if (st) {
      push(`${city} ${st[1]}`);
      push(st[1]);
    }
  }
  return out.slice(0, 7);
}

async function politeDelay(): Promise<void> {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

interface CacheRow {
  lat: number | null;
  lng: number | null;
  display_name: string | null;
  resolved_at: number;
}

async function nominatim(env: Env, q: string): Promise<GeoPoint | null> {
  await politeDelay();
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
  const arr = (await res.json()) as Array<{ lat: string; lon: string; display_name?: string; category?: string }>;
  const hit = arr[0];
  if (!hit) return null;
  // 只對到行政區（例如把「中正區忠孝復興站」對到整個中正區的中心）不算找到，除非本來就只查行政區
  if (hit.category === 'boundary' && !/[市縣區鄉鎮]$/.test(q.trim())) return null;
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

/** 依序嘗試候選地點，回傳第一個查得到的 */
export async function geocodeFirst(env: Env, candidates: string[]): Promise<GeoPoint | null> {
  for (const c of candidates) {
    const p = await geocode(env, c);
    if (p) return p;
  }
  return null;
}
