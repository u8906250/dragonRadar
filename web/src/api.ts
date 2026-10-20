import type { LatLng } from './geo';
import type { BottleOut, EndedReportResult, EventOut, KeywordInfo, KeywordRules, MyBottles, PickedBottle, RouteOut, SubmitResult } from './types';

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

async function deviceJson<T>(path: string, method = 'GET', body?: unknown, retried = false): Promise<Result<T>> {
  // 讀取的請求碰到暫時失敗（503、連線中斷）自動再試一次；寫入的不重送，伺服器那邊已經重試過
  const again = async (): Promise<Result<T> | null> => {
    if (method !== 'GET' || retried) return null;
    await new Promise((r) => setTimeout(r, 800));
    return deviceJson<T>(path, method, body, true);
  };
  try {
    const headers: Record<string, string> = { 'x-device': deviceCode() };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 503) {
      const a = await again();
      if (a) return a;
    }
    const j = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) return { ok: false, message: j.error ?? `暫時失敗，請再試一次（${r.status}）` };
    return { ok: true, data: j };
  } catch {
    return (await again()) ?? { ok: false, message: '連線失敗，請稍後再試' };
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
/** 回收撿到的瓶子：今天多一個額度；沒收藏的信回收後就看不到了 */
export const recycleBottle = (id: number): Promise<Result<{ quota: MyBottles['quota'] }>> => deviceJson<{ quota: MyBottles['quota'] }>(`/api/bottles/${id}/recycle`, 'POST', {});
/** 收藏撿到的信，或移出收藏 */
export const collectLetter = (id: number, on: boolean): Promise<Result<{ collected: boolean }>> =>
  deviceJson<{ collected: boolean }>(`/api/bottles/${id}/${on ? 'collect' : 'uncollect'}`, 'POST', {});
export const reportBottle = (id: number): Promise<Result<{ hidden: boolean }>> => deviceJson<{ hidden: boolean }>(`/api/bottles/${id}/report`, 'POST', {});

/** 貼上 Threads 貼文連結，後端讀取並判讀，可能要十幾秒 */
export const submitLink = (url: string): Promise<Result<SubmitResult>> => postJson<SubmitResult>('/api/reports', { url });

export const reportEnded = (eventId: number): Promise<Result<EndedReportResult>> => postJson<EndedReportResult>(`/api/events/${eventId}/ended`, {});
