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

const CITY_ANY_RE = new RegExp(CITY_RE.source, 'g');

/** 有寫「市」「縣」的才算指定縣市（「新北投站」裡的「新北」不算） */
const CITY_STRICT_RE = new RegExp(CITY_RE.source.replace('[市縣]?', '[市縣]'));

/** 雷達服務台北大洋流：沒寫縣市時，同名的地點優先用雙北的 */
const HOME_RE = /臺北市|新北市/;

/**
 * 查到的結果在不在查詢寫的縣市。Nominatim 有時忽略縣市，例如「台北市 捷運市府站」對到台中的「捷運市府站(出口1)」。
 * 沒寫縣市就不檢查。
 */
export function cityMatches(query: string, displayName: string | null | undefined): boolean {
  const m = CITY_STRICT_RE.exec(query);
  if (!m || !displayName) return true;
  const norm = (s: string): string => s.replace(/台/g, '臺');
  return norm(displayName).includes(norm(m[1]));
}

/** 從幾個結果裡挑：寫了縣市的只要那個縣市的；沒寫的雙北優先，沒有才用第一個 */
export function pickHit<T extends { display_name?: string }>(query: string, hits: T[]): T | undefined {
  const ok = hits.filter((h) => cityMatches(query, h.display_name));
  if (CITY_STRICT_RE.test(query)) return ok[0];
  return ok.find((h) => HOME_RE.test(h.display_name ?? '')) ?? ok[0];
}

/** 口語的站名換成正式站名再查 */
const STATION_ALIAS: Record<string, string> = { 市府站: '市政府站' };

/** 只有縣市或鄉鎮區名稱（例如「台北市」「台北市 大安區」），拿去查只會得到行政區中心點 */
export function isAdminOnly(s: string): boolean {
  return (
    s
      .replace(CITY_ANY_RE, '')
      .replace(/[\u4e00-\u9fff]{1,2}[區鄉鎮]/g, '')
      .replace(/[\s,，、]/g, '') === ''
  );
}

/**
 * 只寫了一個或幾個行政區（「中正萬華區」「台北市 大安區」）、沒有店名或地址：不能當成精確地點，
 * 不然 Nominatim 會把它對到某個區的中心。「南港軟體園區」「信義計畫區」這種地名不算。
 */
export function isAreaOnly(s: string): boolean {
  if (isAdminOnly(s)) return true;
  const t = s.replace(CITY_ANY_RE, '').replace(/[市縣]/, '').replace(/[\s,，、#＃]/g, '');
  return /^(?:[\u4e00-\u9fff]{2}){2,3}區$/.test(t) && !/(園|社|特|營|校|景|護|商|業|計畫)區$/.test(t);
}

/**
 * 精確地點都查不到時的退路：縣市加鄉鎮區，例如「雲林縣虎尾鎮」「台東縣 台東市」。
 * 只有縣市（例如「台北市」）範圍太大，不算。
 */
export function adminArea(...sources: Array<string | null | undefined>): string | null {
  const re = new RegExp(`(${CITY_RE.source})\\s*([\\u4e00-\\u9fff]{1,2}[區鄉鎮市])`);
  for (const s of sources) {
    const m = re.exec(s ?? '');
    if (m) return `${m[1]}${m[3]}`;
  }
  return null;
}

/**
 * 從 LLM 給的地點產生由精確到寬鬆的查詢候選。
 * Nominatim 常找不到「4號出口」「東三門」這種細節，所以逐步拿掉，最後退到車站或地標名稱。
 */
export function placeCandidates(query: string, placeText?: string | null): string[] {
  const out: string[] = [];
  const push = (s: string | null | undefined): void => {
    const t = (s ?? '').replace(/\s+/g, ' ').trim();
    if (t.length >= 2 && !out.includes(t) && !isAdminOnly(t)) out.push(t);
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
  // 「近國父紀念館站/大巨蛋」這種只是車站線索，整串拿去查會對到別的地方，只用下面抽出來的站名
  const nearOnly = (s: string): boolean => /^(?:近|靠近|鄰近)/.test(s.trim());
  // 原文地點沒寫縣市時補上，避免查到別縣市同名的公園或車站
  for (const s of sources) {
    if (nearOnly(s)) continue;
    if (city && s && !CITY_RE.test(s)) push(`${city} ${s}`);
    push(s);
  }
  const stations: string[] = [];
  for (const s of sources) {
    // 括號裡常是「近忠孝復興站」這種線索，所以這裡不拿掉括號內容；行政區和「近」也拿掉，只留站名
    const bare = s
      .replace(/[（()）]/g, ' ')
      .replace(CITY_PREFIX_RE, ' ')
      .replace(/[\u4e00-\u9fff]{1,2}[區鄉鎮](?=[\u4e00-\u9fff]{2,}站)/g, ' ')
      .replace(/近|靠近|鄰近/g, ' ');
    const st = /(捷運|台鐵|臺鐵|高鐵)?\s*([\u4e00-\u9fff]{2,8}站)/.exec(strip(bare).trim());
    if (!st) continue;
    const name = STATION_ALIAS[st[2]] ?? st[2];
    // 沒寫哪種車站、也不是「XX車站」的，先當捷運站查（「國父紀念館站」單獨查會對到別的地方）；
    // 口語站名（「市府站」）換成正式的，捷運站一樣先加「捷運」
    if ((!st[1] || name !== st[2]) && !name.endsWith('車站')) stations.push(`${city} ${st[1] ?? '捷運'}${name}`.trim());
    stations.push(`${city} ${name}`, name);
  }
  // 站名比去掉出口、門號的版本可靠，先試
  for (const s of stations) push(s);
  for (const s of sources) {
    if (nearOnly(s)) continue;
    const st = strip(s);
    if (city && st.trim() && !CITY_RE.test(st)) push(`${city} ${st}`);
    push(st);
  }
  return out.slice(0, 8);
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
  url.searchParams.set('limit', '5');
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
  const hit = pickHit(q, arr);
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
  // 以前沒檢查縣市時查錯、存進快取的，重查一次
  if (cached && !(cached.lat !== null && !cityMatches(key, cached.display_name))) {
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
