/**
 * 市民之夜的直播派對地點（2026-11-27 只限今晚，使用者說的）：選前之夜直播派對地圖（storemap.puma.taipei）公開的 venues.json，
 * 店家觀看點（shop）和議員服務處（office）。伺服器到晚上 10 點前每 30 分鐘讀一次（排程每 10 分鐘跑，過 30 分鐘才再讀）存在 settings，
 * 網頁點洋流總部時跟 /api/night-venues 拿，星星從總部飛散到各個地點；10 點後不再讀、也不回傳
 */
import type { Env } from './env';

export const NIGHT_SRC = 'https://storemap.puma.taipei/storage/night/venues.json';
/** 直播派對地圖自己到點全部關閉（選罷法 22:00） */
export const NIGHT_END = Date.parse('2026-11-27T22:00:00+08:00') / 1000;
const NIGHT_EVERY_SEC = 30 * 60;
const NIGHT_KEY = 'night:venues';
const MAX_VENUES = 1000;

export interface NightVenue {
  id: string;
  type: 'shop' | 'office';
  name: string;
  area: string;
  address: string;
  capacity: string;
  note: string;
  lat: number;
  lng: number;
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? [...v.replace(/\s+/g, ' ').trim()].slice(0, max).join('') : typeof v === 'number' && Number.isFinite(v) ? String(v).slice(0, max) : '');

/** venues.json 的每個地點：要有名稱、在台灣附近的座標；型別不認得的當觀看點 */
export function cleanVenues(raw: unknown): NightVenue[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { venues?: unknown }).venues) ? ((raw as { venues: unknown[] }).venues) : [];
  const out: NightVenue[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = text(o.id, 40);
    const name = text(o.name, 60);
    const lat = Number(o.lat);
    const lng = Number(o.lng);
    if (!id || !name || seen.has(id) || !(lat > 21 && lat < 27 && lng > 118 && lng < 123)) continue;
    seen.add(id);
    out.push({ id, type: o.type === 'office' ? 'office' : 'shop', name, area: text(o.area, 10), address: text(o.address, 120), capacity: text(o.capacity, 20), note: text(o.note, 120), lat, lng });
    if (out.length >= MAX_VENUES) break;
  }
  return out;
}

/** 排程：10 點前、上次讀超過 30 分鐘（或還沒讀過）才讀；回傳讀到幾個（沒讀是 null） */
export async function syncNightVenues(env: Env, now: number): Promise<number | null> {
  if (now >= NIGHT_END) return null;
  const row = await env.DB.prepare('SELECT updated_at FROM settings WHERE key = ?').bind(NIGHT_KEY).first<{ updated_at: number }>();
  if (row && now - row.updated_at < NIGHT_EVERY_SEC - 60) return null;
  const res = await fetch(`${NIGHT_SRC}?b=${Math.floor(now / NIGHT_EVERY_SEC)}`, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; CurrentRadar/1.0; +https://current-radar.pages.dev)', accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`night venues HTTP ${res.status}`);
  const venues = cleanVenues(await res.json());
  // 讀到空的（對方暫時出錯）不蓋掉上一次的
  if (venues.length === 0) return 0;
  await env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(NIGHT_KEY, JSON.stringify(venues), now)
    .run();
  return venues.length;
}

/** 管理者從本機讀好送上來（伺服器讀不到時的備用）：POST /api/admin/night-venues { venues } */
export async function storeNightVenues(env: Env, raw: unknown, now: number): Promise<number> {
  if (now >= NIGHT_END) return 0;
  const venues = cleanVenues(raw);
  if (venues.length === 0) return 0;
  await env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(NIGHT_KEY, JSON.stringify(venues), now)
    .run();
  return venues.length;
}

/** GET /api/night-venues：還沒讀過就先讀一次；10 點後回傳空的 */
export async function nightVenues(env: Env, now: number): Promise<{ venues: NightVenue[]; fetchedAt: number | null; endAt: number; source: string; error?: string }> {
  const empty = { venues: [], fetchedAt: null, endAt: NIGHT_END, source: 'https://storemap.puma.taipei/' };
  if (now >= NIGHT_END) return empty;
  let row = await env.DB.prepare('SELECT value, updated_at FROM settings WHERE key = ?').bind(NIGHT_KEY).first<{ value: string; updated_at: number }>();
  if (!row) {
    // 還沒讀過：先讀一次（讀不到把原因帶回去，例如對方擋了）
    const error = await syncNightVenues(env, now).then(
      () => null,
      (e) => String(e).slice(0, 200),
    );
    row = await env.DB.prepare('SELECT value, updated_at FROM settings WHERE key = ?').bind(NIGHT_KEY).first<{ value: string; updated_at: number }>();
    if (!row) return error ? { ...empty, error } : empty;
  }
  let venues: NightVenue[] = [];
  try {
    venues = cleanVenues({ venues: JSON.parse(row.value) });
  } catch {
    venues = [];
  }
  return { ...empty, venues, fetchedAt: row.updated_at };
}
