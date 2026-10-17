import type { LatLng } from './geo';
import type { EventOut, KeywordInfo, KeywordRules } from './types';

/** 正式環境的 Worker 網址；本機開發打 localhost，VITE_API_BASE 可覆寫（空字串視為未設定，CI 沒設變數時會傳空字串） */
const PROD_API_BASE = 'https://dragon-radar.happybadminton.workers.dev';
const isLocal = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) || (isLocal ? 'http://localhost:8787' : PROD_API_BASE)).replace(/\/$/, '');

export async function fetchEvents(origin: LatLng, radiusKm: number, keywords: string[]): Promise<EventOut[]> {
  const u = new URL(`${API_BASE}/api/events`);
  u.searchParams.set('lat', origin.lat.toFixed(5));
  u.searchParams.set('lng', origin.lng.toFixed(5));
  u.searchParams.set('radius_km', String(radiusKm));
  if (keywords.length > 0) u.searchParams.set('keywords', keywords.join(','));
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

export async function fetchKeywords(): Promise<{ max: number; userAdd?: boolean; keywords: KeywordInfo[]; rules?: KeywordRules }> {
  const r = await fetch(`${API_BASE}/api/keywords`);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return (await r.json()) as { max: number; userAdd?: boolean; keywords: KeywordInfo[]; rules?: KeywordRules };
}

export type AddKeywordResult =
  | { ok: true; status: 'exists' | 'created' | 'reactivated'; keyword: KeywordInfo; keywords: KeywordInfo[] }
  | { ok: false; message: string };

export async function addKeyword(term: string): Promise<AddKeywordResult> {
  try {
    const r = await fetch(`${API_BASE}/api/keywords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ term }),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string; status?: 'exists' | 'created' | 'reactivated'; keyword?: KeywordInfo; keywords?: KeywordInfo[] };
    if (!r.ok || !j.keyword || !j.status) return { ok: false, message: j.error ?? `新增失敗（${r.status}）` };
    return { ok: true, status: j.status, keyword: j.keyword, keywords: j.keywords ?? [] };
  } catch {
    return { ok: false, message: '連線失敗，請稍後再試' };
  }
}
