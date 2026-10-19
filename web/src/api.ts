import type { LatLng } from './geo';
import type { BottleOut, EndedReportResult, EventOut, KeywordInfo, KeywordRules, MyBottles, PickedBottle, RouteOut, SpotRequestStatus, SubmitResult } from './types';

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
  // 官方行程常是幾天後的，清單列出 14 天內的，雷達只畫快開始的
  u.searchParams.set('horizon_h', '336');
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`API ${r.status}`);
  const j = (await r.json()) as { events: EventOut[] };
  return j.events;
}

/** 今天的車掃路線；讀不到就當沒有，不影響其他資料 */
export async function fetchRoutes(): Promise<RouteOut[]> {
  try {
    const r = await fetch(`${API_BASE}/api/routes`);
    if (!r.ok) return [];
    return ((await r.json()) as { routes?: RouteOut[] }).routes ?? [];
  } catch {
    return [];
  }
}

export async function fetchHealth(): Promise<{ ok: boolean; mode: 'live' | 'mock' | 'unconfigured'; version?: string }> {
  const r = await fetch(`${API_BASE}/api/health`);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return (await r.json()) as { ok: boolean; mode: 'live' | 'mock' | 'unconfigured'; version?: string };
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

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

async function postJson<T>(path: string, body: unknown): Promise<Result<T>> {
  try {
    const r = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) return { ok: false, message: j.error ?? `送出失敗（${r.status}）` };
    return { ok: true, data: j };
  } catch {
    return { ok: false, message: '連線失敗，請稍後再試' };
  }
}

// ---- 漂流瓶：不用登入，用瀏覽器裡的隨機裝置代碼（x-device 標頭）認自己丟的、撿的 ----
const LS_DEVICE = 'dr.device';
let deviceMem = '';

/** 這個瀏覽器的裝置代碼；第一次用時產生。瀏覽器不能存資料時，這次開著的期間有效 */
export function deviceCode(): string {
  try {
    let v = localStorage.getItem(LS_DEVICE);
    if (!v || !/^[0-9a-f-]{36}$/i.test(v)) {
      v = crypto.randomUUID();
      localStorage.setItem(LS_DEVICE, v);
    }
    return v;
  } catch {
    if (!deviceMem) deviceMem = crypto.randomUUID();
    return deviceMem;
  }
}

async function deviceJson<T>(path: string, method = 'GET', body?: unknown): Promise<Result<T>> {
  try {
    const headers: Record<string, string> = { 'x-device': deviceCode() };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) return { ok: false, message: j.error ?? `失敗（${r.status}）` };
    return { ok: true, data: j };
  } catch {
    return { ok: false, message: '連線失敗，請稍後再試' };
  }
}

/** 附近漂流中的瓶子；失敗回傳空陣列 */
export async function fetchBottles(origin: LatLng, radiusKm: number): Promise<BottleOut[]> {
  const r = await deviceJson<{ bottles?: BottleOut[] }>(`/api/bottles?lat=${origin.lat.toFixed(5)}&lng=${origin.lng.toFixed(5)}&radius_km=${radiusKm}`);
  return r.ok ? (r.data.bottles ?? []) : [];
}
export const dropBottle = (text: string, at: LatLng): Promise<Result<PickedBottle>> => deviceJson<PickedBottle>('/api/bottles', 'POST', { text, lat: at.lat, lng: at.lng });
export const pickBottle = (id: number, at: LatLng | null): Promise<Result<PickedBottle>> =>
  deviceJson<PickedBottle>(`/api/bottles/${id}/pick`, 'POST', at ? { lat: at.lat, lng: at.lng } : {});
export const fetchMyBottles = (): Promise<Result<MyBottles>> => deviceJson<MyBottles>('/api/bottles/mine');
export const deleteBottle = (id: number): Promise<Result<{ ok: true }>> => deviceJson<{ ok: true }>(`/api/bottles/${id}`, 'DELETE');
/** 回收撿到的瓶子：今天多一個額度，回收後就看不到了 */
export const recycleBottle = (id: number): Promise<Result<{ quota: MyBottles['quota'] }>> => deviceJson<{ quota: MyBottles['quota'] }>(`/api/bottles/${id}/recycle`, 'POST', {});
export const reportBottle = (id: number): Promise<Result<{ hidden: boolean }>> => deviceJson<{ hidden: boolean }>(`/api/bottles/${id}/report`, 'POST', {});

/** 回報固定據點，進審核佇列 */
export const submitSpot = (body: { url: string; place: string; hours: string; note: string }): Promise<Result<SpotRequestStatus>> =>
  postJson<SpotRequestStatus>('/api/spot-requests', body);

/** 取消自己送出的固定據點（已上雷達的會一起撤下） */
export const cancelSpot = (key: string, cancelKey: string): Promise<Result<SpotRequestStatus>> =>
  postJson<SpotRequestStatus>('/api/spot-requests/cancel', { key, cancelKey });

/** 查自己送出的固定據點審核進度 */
export async function fetchSpotStatus(keys: string[]): Promise<SpotRequestStatus[]> {
  if (keys.length === 0) return [];
  try {
    const r = await fetch(`${API_BASE}/api/spot-requests?keys=${encodeURIComponent(keys.join(','))}`);
    if (!r.ok) return [];
    return ((await r.json()) as { requests?: SpotRequestStatus[] }).requests ?? [];
  } catch {
    return [];
  }
}

/** 貼上 Threads 貼文連結，後端讀取並判讀，可能要十幾秒 */
export const submitLink = (url: string): Promise<Result<SubmitResult>> => postJson<SubmitResult>('/api/reports', { url });

export const reportEnded = (eventId: number): Promise<Result<EndedReportResult>> => postJson<EndedReportResult>(`/api/events/${eventId}/ended`, {});
