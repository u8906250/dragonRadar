import type { LatLng } from './geo';
import type { BottleOut, BottleProof, EditInput, EventOut, KeywordInfo, KeywordRules, LocateResult, MyBottles, MyReport, PickedBottle, RouteOut, SubmitResult } from './types';

/** 正式環境的 Worker 網址；本機開發打 localhost，VITE_API_BASE 可覆寫（空字串視為未設定，CI 沒設變數時會傳空字串） */
const PROD_API_BASE = 'https://dragon-radar.happybadminton.workers.dev';
const isLocal = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) || (isLocal ? 'http://localhost:8787' : PROD_API_BASE)).replace(/\/$/, '');

export async function fetchEvents(origin: LatLng, radiusKm: number, keywords: string[], module = 'current'): Promise<EventOut[]> {
  const u = new URL(`${API_BASE}/api/events`);
  if (module !== 'current') u.searchParams.set('module', module);
  u.searchParams.set('lat', origin.lat.toFixed(5));
  u.searchParams.set('lng', origin.lng.toFixed(5));
  u.searchParams.set('radius_km', String(radiusKm));
  if (keywords.length > 0) u.searchParams.set('keywords', keywords.join(','));
  // 官方行程常是幾天後的，清單列出 21 天內的（伺服器收 21 天內開始的），雷達只畫快開始的
  u.searchParams.set('horizon_h', '504');
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

export async function fetchHealth(): Promise<{ ok: boolean; mode: 'live' | 'mock' | 'unconfigured'; version?: string; reports?: boolean; reportModules?: string[] }> {
  const r = await fetch(`${API_BASE}/api/health`);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return (await r.json()) as { ok: boolean; mode: 'live' | 'mock' | 'unconfigured'; version?: string; reports?: boolean; reportModules?: string[] };
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

// ---- 手機推播 ----

/** 推播用的伺服器公鑰；拿不到就是 null（推播先不開） */
export async function fetchPushKey(): Promise<string | null> {
  try {
    const r = await fetch(`${API_BASE}/api/push/key`);
    if (!r.ok) return null;
    return ((await r.json()) as { key?: string }).key ?? null;
  } catch {
    return null;
  }
}

/** 送出推播訂閱和約略位置（伺服器只存到小數點後 3 位）；換位置時再送一次 */
export function savePushSubscription(sub: PushSubscription, at: LatLng): Promise<Result<{ ok: true; created: boolean }>> {
  // 時區：深夜不推照這支手機的當地時間（國外的人）
  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  })();
  return postJson('/api/push/subscribe', { subscription: sub.toJSON(), lat: Number(at.lat.toFixed(3)), lng: Number(at.lng.toFixed(3)), tz });
}

export function deletePushSubscription(endpoint: string): Promise<Result<{ ok: true }>> {
  return postJson('/api/push/unsubscribe', { endpoint });
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
/** 漂到汪星海上的瓶子（全部）；失敗回傳空陣列 */
export async function fetchWoofBottles(): Promise<BottleOut[]> {
  const r = await deviceJson<{ bottles?: BottleOut[] }>('/api/bottles?world=woof');
  return r.ok ? (r.data.bottles ?? []).filter((b) => b.world === 'woof') : [];
}
export const dropBottle = (text: string, at: LatLng): Promise<Result<PickedBottle>> => deviceJson<PickedBottle>('/api/bottles', 'POST', { text, lat: at.lat, lng: at.lng });
/** 撿起來：at 是你的位置（地球的 GPS，或你在汪星的位置），world 是你在哪一顆；自己丟的、撿過的不用位置 */
export const pickBottle = (id: number, at: LatLng | null, world: 'earth' | 'woof' = 'earth'): Promise<Result<PickedBottle>> =>
  deviceJson<PickedBottle>(`/api/bottles/${id}/pick`, 'POST', at ? { lat: at.lat, lng: at.lng, world } : {});
/** 分享出去的瓶子（沒有內容）：還在漂、被撿走了、不見了 */
export const fetchBottleInfo = (id: number): Promise<Result<{ id: number; state: 'active' | 'picked' | 'gone'; bottle: BottleOut | null }>> => deviceJson(`/api/bottles/${id}`);
/** 瓶子證明（丟的人、撿到的人才拿得到） */
export const fetchBottleProof = (id: number): Promise<Result<BottleProof>> => deviceJson<BottleProof>(`/api/bottles/${id}/proof`);
export const verifyBottleProof = (p: BottleProof): Promise<Result<{ valid: boolean }>> => deviceJson<{ valid: boolean }>('/api/bottles/verify', 'POST', p);
export const fetchMyBottles = (): Promise<Result<MyBottles>> => deviceJson<MyBottles>('/api/bottles/mine');
export const deleteBottle = (id: number): Promise<Result<{ ok: true }>> => deviceJson<{ ok: true }>(`/api/bottles/${id}`, 'DELETE');
/** 移出瓶中信收藏（之後就看不到這封信了） */
export const uncollectLetter = (id: number): Promise<Result<{ collected: boolean }>> => deviceJson<{ collected: boolean }>(`/api/bottles/${id}/uncollect`, 'POST', {});
/** 回報問題（地點錯誤、時間錯誤…），只有管理者看得到；車掃可以指定哪一站（那一站的標題、預計經過時間） */
export type FeedbackKind = 'location' | 'time' | 'content' | 'not_event' | 'duplicate' | 'remove_stop' | 'other';
/** pin：地點錯誤時在小地圖上標的正確位置 */
export const sendFeedback = (
  eventId: number,
  kind: FeedbackKind,
  note: string,
  stop?: { title: string; at: number | null },
  pin?: { lat: number; lng: number } | null,
): Promise<Result<{ ok: true; duplicate: boolean }>> =>
  deviceJson<{ ok: true; duplicate: boolean }>(`/api/events/${eventId}/feedback`, 'POST', { kind, note, ...(stop ? { stop: stop.title, stopAt: stop.at } : {}), ...(pin ? { lat: pin.lat, lng: pin.lng } : {}) });
/** 回報地點錯誤的「查地點」：查到的標在表單的小地圖上 */
export const locateFeedbackPlace = (eventId: number, place: string): Promise<Result<{ found: boolean; lat: number | null; lng: number | null; name: string | null; approxArea: string | null }>> =>
  deviceJson(`/api/events/${eventId}/locate`, 'POST', { place });
export const reportBottle = (id: number): Promise<Result<{ hidden: boolean }>> => deviceJson<{ hidden: boolean }>(`/api/bottles/${id}/report`, 'POST', {});

// 回報也帶裝置代碼：伺服器記下是哪個瀏覽器回報的，之後可以自己刪除
/** 貼上 Threads 貼文，或活動通、OPENTIX 活動頁的連結，後端讀取並判讀，可能要十幾秒 */
export const submitLink = (url: string, module = 'current'): Promise<Result<SubmitResult>> => deviceJson<SubmitResult>('/api/reports', 'POST', { url, module });
/** 判讀結果對：放上雷達 */
export const confirmReport = (c: { postId: string; token: string }): Promise<Result<SubmitResult>> => deviceJson<SubmitResult>('/api/reports/confirm', 'POST', c);
/** 貼文沒寫地點或時間：補充後再判讀一次 */
export const supplementReport = (c: { postId: string; token: string }, note: string): Promise<Result<SubmitResult>> =>
  deviceJson<SubmitResult>('/api/reports/supplement', 'POST', { ...c, note });
/** 洋流的活動：直接改每一場的標題、時間、地點、地圖位置，回傳新的預覽。時間是活動當地的（localTimes），伺服器看地點換算 */
export const editReport = (c: { postId: string; token: string }, items: EditInput[]): Promise<Result<SubmitResult>> =>
  deviceJson<SubmitResult>('/api/reports/edit', 'POST', { ...c, items, localTimes: true });
/** 修改表單先查填的地點，在小地圖上標出來 */
export const locatePlace = (c: { postId: string; token: string }, place: string): Promise<Result<LocateResult>> =>
  deviceJson<LocateResult>('/api/reports/locate', 'POST', { ...c, place });
/** 判讀錯了：不放，note 寫哪裡錯 */
export const rejectReport = (c: { postId: string; token: string }, note: string): Promise<Result<{ ok: true }>> => deviceJson<{ ok: true }>('/api/reports/reject', 'POST', { ...c, note });
/** 我的回報：30 天內用這個瀏覽器回報的 */
export const fetchMyReports = (): Promise<Result<{ reports: MyReport[] }>> => deviceJson<{ reports: MyReport[] }>('/api/reports/mine');
/** 刪除自己的回報：雷達上這則的發放、活動一起拿掉 */
export const withdrawReport = (postId: string): Promise<Result<{ ok: true; removed: number }>> =>
  deviceJson<{ ok: true; removed: number }>(`/api/reports/${encodeURIComponent(postId)}`, 'DELETE');

/** 中山公園的標記（管理者在 3D 公園裡標的路燈、長椅等）：種類、經緯度、面向（度，0 是北、順時針，長椅坐的人面向哪）、備註 */
export type ParkMarkKind = 'lamp' | 'bench' | 'bin' | 'stele' | 'other';
export interface ParkMarkIn {
  kind: ParkMarkKind;
  lat: number;
  lng: number;
  heading: number;
  note: string | null;
}
export interface ParkMark extends ParkMarkIn {
  id: number;
  created_at: number;
  updated_at: number;
}
async function adminJson<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${token}` } });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(r.status === 401 ? '管理 token 不對或已經換了' : (j.error ?? `API ${r.status}`));
  return j;
}
/** 大家都看得到的公園標記（3D 國館畫出來；沒有備註），讀不到就當沒有 */
export async function fetchPublicParkMarks(): Promise<ParkMark[]> {
  try {
    const r = await fetch(`${API_BASE}/api/park-marks`);
    if (!r.ok) return [];
    const j = (await r.json()) as { marks?: Array<Pick<ParkMark, 'id' | 'kind' | 'lat' | 'lng' | 'heading'>> };
    return (j.marks ?? []).map((m) => ({ ...m, note: null, created_at: 0, updated_at: 0 }));
  } catch {
    return [];
  }
}
/** 列出公園的標記（要管理 token） */
export async function fetchParkMarks(token: string): Promise<ParkMark[]> {
  return (await adminJson<{ marks: ParkMark[] }>(token, '/api/admin/park-marks')).marks;
}
/** 新增（沒有 id）或改一個標記（整個換掉） */
export async function saveParkMark(token: string, m: ParkMarkIn, id?: number): Promise<ParkMark> {
  return (await adminJson<{ mark: ParkMark }>(token, `/api/admin/park-marks${id ? `/${id}` : ''}`, { method: 'POST', body: JSON.stringify(m) })).mark;
}
export async function deleteParkMark(token: string, id: number): Promise<void> {
  await adminJson<{ ok: true }>(token, `/api/admin/park-marks/${id}`, { method: 'DELETE' });
}

// ---- 收集卡（尋找小法）：一樣用裝置代碼認人，不用登入 ----
export interface CardClaim {
  card: string;
  /** 在公園哪裡找到的（碑林、翠湖…）；肉乾卡是「回報」 */
  place: string;
  /** 拿到的時間（秒） */
  at: number;
  /** 第幾位拿到這張卡 */
  serial: number;
}

/** 拿一張卡（拿過的回傳原本那張，fresh = false） */
export function claimCard(card: string, place: string): Promise<Result<{ claim: CardClaim; fresh: boolean }>> {
  return deviceJson('/api/cards/claim', 'POST', { card, place });
}

/** 這個瀏覽器拿到的卡 */
/** 道具有幾個（還沒用掉的） */
export interface ItemCount {
  item: string;
  count: number;
}

/** picks：回報滿 5 則還沒選的獎勵有幾份（肉乾或順幣） */
export function fetchMyCards(): Promise<Result<{ cards: CardClaim[]; items?: ItemCount[]; picks?: number }>> {
  return deviceJson('/api/cards/mine');
}

/** 選一份獎勵（最早的那份）：jerky 一包肉乾、coin 一枚順幣；回傳這台現在的道具、還有幾份沒選 */
export function pickReward(item: string): Promise<Result<{ item: string; items: ItemCount[]; picks: number }>> {
  return deviceJson('/api/cards/pick', 'POST', { item });
}

/** 引繼碼（換裝置）：舊裝置產生，24 小時內在新裝置輸入（卡、道具一起搬） */
export function makeTransferCode(): Promise<Result<{ code: string; expiresAt: number }>> {
  return deviceJson('/api/cards/transfer', 'POST', {});
}

/** 新裝置輸入引繼碼：舊裝置的卡、道具搬過來，回傳這台現在的卡、道具 */
export function redeemTransferCode(code: string): Promise<Result<{ cards: CardClaim[]; items?: ItemCount[]; picks?: number; moved: number }>> {
  return deviceJson('/api/cards/redeem', 'POST', { code });
}

// ---- 許願（投順幣送想法，管理者審核，通過才做；一樣用裝置代碼認人）----
export type WishStatus = 'pending' | 'approved' | 'building' | 'live' | 'rejected' | 'dropped' | 'withdrawn';
export interface WishTweak {
  id: number;
  body: string;
  status: WishStatus;
  /** 投了幾枚順幣（免費的調整是 0） */
  cost: number;
  /** 管理者的回覆（不通過的原因、上線在哪裡看） */
  reply: string | null;
  /** 最新的進度看過了沒 */
  seen: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface Wish extends WishTweak {
  nickname: string | null;
  links: string[];
  /** 免費調整還剩幾次、下一次調整要幾枚順幣、有沒有調整還在處理 */
  freeLeft: number;
  tweakCost: number;
  tweaking: boolean;
  tweaks: WishTweak[];
}
export interface MyWishes {
  wishes: Wish[];
  /** 有新進度還沒看的幾筆（道具按鈕的小紅點） */
  unseen?: number;
  /** 現在有幾枚順幣（暫扣的不算） */
  coins: number;
}

export const fetchMyWishes = (): Promise<Result<MyWishes>> => deviceJson<MyWishes>('/api/wishes/mine');
export const sendWish = (w: { body: string; nickname: string; links: string; agree: boolean }): Promise<Result<MyWishes & { id: number }>> => deviceJson('/api/wishes', 'POST', w);
export const sendTweak = (id: number, body: string): Promise<Result<MyWishes & { id: number }>> => deviceJson(`/api/wishes/${id}/tweak`, 'POST', { body });
export const withdrawWish = (id: number): Promise<Result<MyWishes>> => deviceJson(`/api/wishes/${id}/withdraw`, 'POST', {});
export const markWishesSeen = (): Promise<Result<{ unseen: 0 }>> => deviceJson('/api/wishes/seen', 'POST', {});
