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

const COUNTIES = /^(苗栗|彰化|南投|雲林|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|連江)$/;

/**
 * 只寫到縣市（「台中市區」「台北市一帶」「新竹」）：回傳正式的縣市名（「臺中市」），不是的回傳 null。
 * 新竹、嘉義沒寫市或縣的當成市
 */
export function cityLevel(s: string | null | undefined): string | null {
  const t = (s ?? '').replace(/[\s,，、📍]/g, '');
  const m = new RegExp(`^(${CITY_RE.source.slice(1, CITY_RE.source.indexOf(')'))})([市縣])?(?:區|市區|中心|市中心|一帶|附近|地區|周邊|內)?$`).exec(t);
  if (!m) return null;
  const name = m[1].replace(/^台(北|中|南|東)/, '臺$1');
  return `${name}${m[2] ?? (COUNTIES.test(m[1]) ? '縣' : '市')}`;
}

/** 只有縣市或鄉鎮區名稱（例如「台北市」「台北市 大安區」「台中市區」），拿去查只會得到行政區中心點 */
export function isAdminOnly(s: string): boolean {
  if (cityLevel(s)) return true;
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

/**
 * 用地名查到的結果，名字要跟查的地名有兩個以上連續的字一樣（「丞風羽球館」不能對到「玉勅鳳邑琉球城隍廟」）。
 * 查的只有縣市、行政區（拿掉後不到兩個字）就不檢查
 */
export function sharesName(query: string, displayName: string | null | undefined): boolean {
  const fold = (s: string): string => s.replace(/臺/g, '台').replace(/\s+/g, '');
  const core = fold(query.replace(CITY_PREFIX_RE, '').replace(/[\u4e00-\u9fff]{1,2}[區鄉鎮](?=[\u4e00-\u9fff]{2,})/g, '')).replace(/[^\u4e00-\u9fff]/g, '');
  if (core.length < 2) return true;
  const name = fold((displayName ?? '').split(',')[0] ?? '');
  for (let i = 0; i + 2 <= core.length; i++) if (name.includes(core.slice(i, i + 2))) return true;
  return false;
}

/** 查的路名：「新北市關新路」→「關新路」、「臺北市大安區忠孝東路四段」→「忠孝東路四段」 */
function roadOf(query: string): string | null {
  return /([^\s市縣區鄉鎮]+?(?:路|街|大道)(?:[一二三四五六七八九十]段)?(?:\d+巷)?)$/.exec(query.trim())?.[1] ?? null;
}

const foldName = (s: string): string => s.replace(/臺/g, '台').replace(/\s+/g, '');

/**
 * 退到那條路時，查到的名字要真的是那條路：OSM 的公車站也算 highway，
 * 「新北市關新路」（新北市沒有關新路）會對到叫「八里行政中心」的公車站
 */
export function isRoadHit(query: string, displayName: string | null | undefined): boolean {
  const road = roadOf(query);
  if (!road) return true;
  return foldName((displayName ?? '').split(',')[0] ?? '').includes(foldName(road));
}

/** 查什麼：any 什麼都可以；road 只要道路（門牌查不到時退到那條路） */
type GeoKind = 'any' | 'road';

async function nominatim(env: Env, q: string, kind: GeoKind = 'any'): Promise<GeoPoint | null> {
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
  // 地名查的：名字要對得上（道路照類型挑）
  const hit = pickHit(q, kind === 'road' ? arr.filter((h) => h.category === 'highway' && isRoadHit(q, h.display_name)) : arr.filter((h) => sharesName(q, h.display_name)));
  if (!hit) return null;
  // 只對到行政區（例如把「中正區忠孝復興站」對到整個中正區的中心）不算找到，除非本來就只查行政區
  if (hit.category === 'boundary' && !/[市縣區鄉鎮]$/.test(q.trim())) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, displayName: hit.display_name ?? q };
}

/** 地點文字轉座標，結果（含查不到）都快取在 D1；只要道路的快取另外存（前面加「road:」） */
export async function geocode(env: Env, query: string, kind: GeoKind = 'any'): Promise<GeoPoint | null> {
  const q = query.trim().replace(/\s+/g, ' ');
  if (!q) return null;
  const key = kind === 'road' ? `road:${q}` : q;
  const now = nowSec();
  const cached = await env.DB.prepare('SELECT lat, lng, display_name, resolved_at FROM geocode_cache WHERE query = ?')
    .bind(key)
    .first<CacheRow>();
  // 以前沒檢查縣市、名字時查錯、存進快取的，重查一次
  if (cached && !(cached.lat !== null && (!cityMatches(q, cached.display_name) || (kind === 'any' ? !sharesName(q, cached.display_name) : !isRoadHit(q, cached.display_name))))) {
    if (cached.lat !== null && cached.lng !== null) {
      return { lat: cached.lat, lng: cached.lng, displayName: cached.display_name ?? key };
    }
    if (cached.resolved_at > now - NEGATIVE_TTL_SEC) return null;
  }
  const point = await nominatim(env, q, kind);
  await env.DB.prepare(
    'INSERT INTO geocode_cache (query, lat, lng, display_name, resolved_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(query) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, display_name = excluded.display_name, resolved_at = excluded.resolved_at',
  )
    .bind(key, point?.lat ?? null, point?.lng ?? null, point?.displayName ?? null, now)
    .run();
  return point;
}

const FULL_CITY_RE = /(臺北市|新北市|桃園市|臺中市|臺南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|臺東縣|澎湖縣|金門縣|連江縣)/;

/** 從 Nominatim 的行政區結果裡，找出名字剛好是這個區的那幾筆各在哪個縣市 */
export function citiesOfDistrict(district: string, hits: Array<{ category?: string; display_name?: string }>): string[] {
  const cities = hits
    .filter((h) => h.category === 'boundary' && (h.display_name ?? '').split(', ')[0] === district)
    .map((h) => FULL_CITY_RE.exec(h.display_name ?? '')?.[1])
    .filter((c): c is string => !!c);
  return [...new Set(cities)];
}

/**
 * 只寫了區（「淡水區中山北路二段200號」）：查這個區在哪個縣市。全台只有一個的（淡水區只在新北市）才回傳，
 * 東區、中正區這種好幾個縣市都有的回傳 null。快取鍵「city-of:區名」，display_name 存縣市
 */
export async function cityOfDistrict(env: Env, district: string): Promise<string | null> {
  const key = `city-of:${district}`;
  const now = nowSec();
  const cached = await env.DB.prepare('SELECT lat, lng, display_name, resolved_at FROM geocode_cache WHERE query = ?').bind(key).first<CacheRow>();
  if (cached && (cached.display_name || cached.resolved_at > now - NEGATIVE_TTL_SEC)) return cached.display_name;
  await politeDelay();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '10');
  url.searchParams.set('countrycodes', 'tw');
  url.searchParams.set('accept-language', 'zh-TW');
  url.searchParams.set('q', district);
  const res = await fetch(url.toString(), { headers: { 'user-agent': env.NOMINATIM_USER_AGENT, accept: 'application/json' } });
  if (!res.ok) return null;
  const cities = citiesOfDistrict(district, (await res.json()) as Array<{ category?: string; display_name?: string }>);
  const city = cities.length === 1 ? cities[0] : null;
  await env.DB.prepare(
    'INSERT INTO geocode_cache (query, lat, lng, display_name, resolved_at) VALUES (?, NULL, NULL, ?, ?) ON CONFLICT(query) DO UPDATE SET display_name = excluded.display_name, resolved_at = excluded.resolved_at',
  )
    .bind(key, city, now)
    .run();
  return city;
}

/** 從 Nominatim 的結果裡，找出名字剛好是這條路的那幾段各在哪個縣市 */
export function citiesOfRoad(road: string, hits: Array<{ category?: string; display_name?: string }>): string[] {
  const cities = hits
    .filter((h) => h.category === 'highway' && foldName((h.display_name ?? '').split(',')[0] ?? '') === foldName(road))
    .map((h) => FULL_CITY_RE.exec(h.display_name ?? '')?.[1])
    .filter((c): c is string => !!c);
  return [...new Set(cities)];
}

/**
 * 門牌的縣市不是貼文寫的（模型自己補的「新北市關新路186號」）、那個縣市又沒有這條路時：查這條路在哪個縣市。
 * 全台只有一個縣市有的（關新路只在新竹市）才回傳，中山路這種到處都有的回傳 null。快取鍵「city-of-road:路名」
 */
export async function cityOfRoad(env: Env, road: string): Promise<string | null> {
  const key = `city-of-road:${road}`;
  const now = nowSec();
  const cached = await env.DB.prepare('SELECT lat, lng, display_name, resolved_at FROM geocode_cache WHERE query = ?').bind(key).first<CacheRow>();
  if (cached && (cached.display_name || cached.resolved_at > now - NEGATIVE_TTL_SEC)) return cached.display_name;
  await politeDelay();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '40');
  url.searchParams.set('countrycodes', 'tw');
  url.searchParams.set('accept-language', 'zh-TW');
  url.searchParams.set('q', road);
  const res = await fetch(url.toString(), { headers: { 'user-agent': env.NOMINATIM_USER_AGENT, accept: 'application/json' } });
  if (!res.ok) return null;
  const cities = citiesOfRoad(road, (await res.json()) as Array<{ category?: string; display_name?: string }>);
  const city = cities.length === 1 ? cities[0] : null;
  await env.DB.prepare(
    'INSERT INTO geocode_cache (query, lat, lng, display_name, resolved_at) VALUES (?, NULL, NULL, ?, ?) ON CONFLICT(query) DO UPDATE SET display_name = excluded.display_name, resolved_at = excluded.resolved_at',
  )
    .bind(key, city, now)
    .run();
  return city;
}

/** 地址最後寫的國名（Google 地圖中文版「…CA 94583美國」、英文「…, USA」）對應的國家代碼 */
const COUNTRY_NAMES: Array<[string, string[]]> = [
  ['US', ['美國', '美国', 'USA', 'U.S.A.', 'United States', 'United States of America']],
  ['CA', ['加拿大', 'Canada']],
  ['AU', ['澳洲', '澳大利亞', 'Australia']],
  ['NZ', ['紐西蘭', 'New Zealand']],
  ['GB', ['英國', '英国', 'United Kingdom', 'UK']],
  ['JP', ['日本', 'Japan']],
  ['SG', ['新加坡', 'Singapore']],
  ['DE', ['德國', 'Germany']],
  ['FR', ['法國', 'France']],
  ['NL', ['荷蘭', 'Netherlands']],
  ['MY', ['馬來西亞', 'Malaysia']],
  ['TH', ['泰國', 'Thailand']],
];
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 國名前面要是開頭、數字、英文、空白、逗號（「台北日本料理」的日本不算） */
const COUNTRY_END_RE = new RegExp(`(?:^|(?<=[\\s,，\\dA-Za-z.]))(${COUNTRY_NAMES.flatMap(([, n]) => n).map(escapeRe).join('|')})\\s*$`);
const US_STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
const CA_PROVINCES = new Set('AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' '));

/** 地址寫的州、省（ISO 3166-2，例如 US-CA）：美國「, CA 94583」、加拿大「, ON M5V 3L9」、澳洲「NSW 2000」 */
export function regionOfPlace(text: string): string | null {
  const us = /,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?(?!\d)/.exec(text);
  if (us && US_STATES.has(us[1])) return `US-${us[1]}`;
  const ca = /,\s*([A-Z]{2})\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/.exec(text);
  if (ca && CA_PROVINCES.has(ca[1])) return `CA-${ca[1]}`;
  const au = /\b(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\s+\d{4}(?!\d)/.exec(text);
  return au ? `AU-${au[1]}` : null;
}

/** 回報的人填的地點是不是國外：最後寫了國名，或有美國、加拿大、澳洲的州加郵遞區號。台灣、看不出來是 null */
export function countryOfPlace(text: string): string | null {
  const t = text.trim();
  const name = COUNTRY_END_RE.exec(t)?.[1];
  if (name) return COUNTRY_NAMES.find(([, n]) => n.includes(name))?.[0] ?? null;
  if (/^日本\s*〒/.test(t)) return 'JP';
  return regionOfPlace(t)?.slice(0, 2) ?? null;
}

const STREET_TYPE = 'St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Way|Ln|Lane|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Ter|Terrace|Cir|Circle|Sq|Square|Plz|Plaza';
const UNIT_WORD = '(?:#|Suite|Ste|Unit|Apt|Apartment|Rm|Room|Fl|Floor|Bldg|Building)\\.?\\s*#?\\s*[\\w-]+';
const UNIT_SEGMENT_RE = new RegExp(`^${UNIT_WORD}$`, 'i');
const UNIT_TAIL_RE = new RegExp(`\\s+${UNIT_WORD}$`, 'i');
/** 「12901 Alcosta Blvd D」：門牌、路名、路的種類後面的單位號（一個字母或短的數字）；N、S、E、W 是方位（King St W），不拿 */
const STREET_UNIT_RE = new RegExp(`^(\\d+[A-Za-z]?\\s+.+?\\s(?:${STREET_TYPE})\\.?)\\s+(?:(?![NSEW]$)[A-Z]|\\d{1,5}|[A-Z]\\d{1,4}|\\d{1,4}[A-Z])$`);

/**
 * 國外地址拿掉 Nominatim 看不懂的：黏在最後的國名（「CA 94583美國」整段查不到），
 * 單位號（「Blvd D」「Suite 100」「#5」，Nominatim 只到門牌）
 */
export function cleanWorldAddress(s: string): string {
  const noCountry = s.trim().replace(COUNTRY_END_RE, (m, name: string) => (/[^\x00-\x7f]/.test(name) ? '' : m)).replace(/[\s,，]+$/, '');
  return noCountry
    .split(/\s*[,，]\s*/)
    .filter((p) => p && !UNIT_SEGMENT_RE.test(p))
    .map((p) => p.replace(UNIT_TAIL_RE, '').replace(STREET_UNIT_RE, '$1'))
    .join(', ');
}

/** 國外地點的查詢字串：整理過的、原樣、地點原文，再把「, CA, USA」這種後面的州、國家一段一段拿掉（Nominatim 寫太完整反而查不到），至少留地名加城市 */
export function worldCandidates(query: string, placeText: string | null): string[] {
  const out: string[] = [];
  for (const s of [query, placeText ?? '']) {
    for (const v of new Set([cleanWorldAddress(s), s])) {
      const parts = v.split(/\s*[,，]\s*/).filter(Boolean);
      // 至少留兩段（地名加城市），只剩「Memorial Park」會對到別州的同名公園
      for (let n = parts.length; n >= Math.min(2, parts.length); n--) out.push(parts.slice(0, n).join(', '));
    }
  }
  return [...new Set(out.map((x) => x.trim()).filter(Boolean))].slice(0, 6);
}

/**
 * 國外的地點：Nominatim 只查那個國家；對到的是整個城市、行政區時標成約略位置（approxArea 寫地名）。
 * region 是在哪個州、省（「US-CA」，用來決定時區；舊的快取沒有）。快取鍵前面加「world:國家:」，跟台灣的分開。
 */
export async function geocodeWorld(
  env: Env,
  query: string,
  placeText: string | null,
  country: string,
): Promise<{ point: GeoPoint; approxArea: string | null; region: string | null } | null> {
  const cc = country.toLowerCase();
  const now = nowSec();
  for (const q of worldCandidates(query, placeText)) {
    const key = `world:${cc}:${q}`;
    const cached = await env.DB.prepare('SELECT lat, lng, display_name, resolved_at FROM geocode_cache WHERE query = ?').bind(key).first<CacheRow>();
    let hit: { lat: number; lng: number; displayName: string; area: boolean; region: string | null } | null = null;
    if (cached && (cached.lat !== null || cached.resolved_at > now - NEGATIVE_TTL_SEC)) {
      if (cached.lat !== null && cached.lng !== null) {
        // display_name 存成「area|地名」「place:US-CA|地名」（冒號後面是州、省）
        const m = /^(area|place)(?::([A-Z]{2}-[A-Z0-9]{1,3}))?\|(.*)$/s.exec(cached.display_name ?? '');
        hit = { lat: cached.lat, lng: cached.lng, displayName: m?.[3] || q, area: m?.[1] === 'area', region: m?.[2] ?? null };
      }
    } else {
      await politeDelay();
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '1');
      url.searchParams.set('countrycodes', cc);
      url.searchParams.set('accept-language', 'en');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('q', q);
      const res = await fetch(url.toString(), { headers: { 'user-agent': env.NOMINATIM_USER_AGENT, accept: 'application/json' } });
      if (!res.ok) {
        console.warn(`nominatim ${res.status} for ${q}`);
        continue;
      }
      const h = ((await res.json()) as Array<{ lat: string; lon: string; display_name?: string; category?: string; addresstype?: string; address?: Record<string, string> }>)[0];
      const lat = Number(h?.lat);
      const lng = Number(h?.lon);
      const area = !!h && (h.category === 'boundary' || (h.category === 'place' && /^(city|town|village|county|state|region|country|municipality)$/.test(h.addresstype ?? '')));
      const iso = h?.address?.['ISO3166-2-lvl4'];
      const region = iso && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(iso) ? iso : null;
      hit = h && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, displayName: h.display_name ?? q, area, region } : null;
      await env.DB.prepare(
        'INSERT INTO geocode_cache (query, lat, lng, display_name, resolved_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(query) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, display_name = excluded.display_name, resolved_at = excluded.resolved_at',
      )
        .bind(key, hit?.lat ?? null, hit?.lng ?? null, hit ? `${hit.area ? 'area' : 'place'}${hit.region ? `:${hit.region}` : ''}|${hit.displayName}` : null, now)
        .run();
    }
    if (!hit) continue;
    // 只對到城市：約略位置，寫「Cupertino, California」這種前兩段
    const approxArea = hit.area ? hit.displayName.split(', ').slice(0, 2).join(', ') : null;
    return { point: { lat: hit.lat, lng: hit.lng, displayName: hit.displayName }, approxArea, region: hit.region ?? regionOfPlace(query) };
  }
  return null;
}

/** 門牌查不到時要退到的路：先含巷（「北新路184巷」），再大路（「北新路」）；弄太小，不單獨查 */
export function streetFallbacks(street: string): string[] {
  const lane = street.replace(/\d+弄$/, '');
  const road = street.replace(/\d+巷.*$/, '');
  return [...new Set([lane, road])].filter((x) => /(?:路|街|大道)(?:[一二三四五六七八九十]段)?(?:\d+巷)?$/.test(x));
}

/**
 * 門牌查不到時退到那條路：只接受道路，而且要在同一個縣市、鄉鎮區（免得對到別區的同名路）。
 * 回傳點和路名（畫面寫「只知道在○○路」，標成約略位置）。
 */
export async function geocodeStreet(env: Env, city: string, district: string | null, street: string): Promise<{ point: GeoPoint; area: string } | null> {
  const norm = (x: string): string => x.replace(/台/g, '臺');
  for (const name of streetFallbacks(street)) {
    const area = `${city}${district ?? ''}${name}`;
    const p = await geocode(env, area, 'road');
    if (p && (!district || norm(p.displayName).includes(norm(district)))) return { point: p, area };
  }
  return null;
}

/** 依序嘗試候選地點，回傳第一個查得到的 */
export async function geocodeFirst(env: Env, candidates: string[]): Promise<GeoPoint | null> {
  for (const c of candidates) {
    const p = await geocode(env, c);
    if (p) return p;
  }
  return null;
}
