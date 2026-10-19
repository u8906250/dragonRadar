/**
 * 台灣門牌地址定位：Nominatim 幾乎查不到門牌號碼（「信義路四段399號」只查得到整條路），
 * 但 OpenStreetMap 在台灣有大量門牌資料（addr:street + addr:housenumber），
 * 所以直接用 Overpass 找同一條路（含巷弄）的門牌：有完全一樣的號碼就用它，
 * 沒有就用同一側（單雙號）前後最近的兩個門牌推算位置。
 */
import type { Env } from './env';
import { nowSec } from './util';

export interface TwAddress {
  /** 「臺北市」，沒寫就是 null */
  city: string | null;
  /** 「信義區」 */
  district: string | null;
  /** OSM 的 addr:street，含巷弄，例如「信義路四段」「信義路四段395巷6弄」 */
  street: string;
  /** 門牌號碼（之幾不算），例如 399 */
  number: number;
  /** 原本寫的號碼，例如「399之1」 */
  raw: string;
}

export interface AddressPoint {
  lat: number;
  lng: number;
  /** exact 有一樣的門牌；interpolated 用前後門牌推算 */
  how: 'exact' | 'interpolated';
}

/** 主站常對 Cloudflare 的共用 IP 限流，依序換鏡像站 */
const OVERPASS_URLS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const SECTION_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
/** 推算時前後門牌最多差幾號，太遠就不準 */
const MAX_GAP = 60;
const NEGATIVE_TTL_SEC = 24 * 3600;

/** 全形數字轉半形、台轉臺（OSM 的縣市名稱用臺） */
function normalize(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/台(北|中|南|東)/g, '臺$1')
    .replace(/\s+/g, '');
}

/** 「4段」寫成「四段」，OSM 的路名用國字 */
function sectionCn(s: string): string {
  return s.replace(/(\d{1,2})段/g, (_, n: string) => `${SECTION_CN[Number(n)] ?? n}段`);
}

/** 從一段文字裡找出門牌地址，找不到回傳 null */
export function parseTwAddress(text: string): TwAddress | null {
  const s = sectionCn(normalize(text));
  const re =
    /(?:\d{3,6})?((?:臺北|新北|桃園|臺中|臺南|高雄)市|(?:基隆|新竹|嘉義)市|[一-鿿]{2}縣)?([一-鿿]{1,3}[區鄉鎮市])?(?:[一-鿿]{1,3}[里村])?(?:\d+鄰)?([一-鿿]{1,6}?(?:路|街|大道)(?:[一二三四五六七八九十]段)?)(\d+巷)?(\d+弄)?(\d+(?:[之-]\d+)?)號/;
  const m = re.exec(s);
  if (!m) return null;
  const raw = m[6];
  const number = Number(raw.split(/[之-]/)[0]);
  if (!Number.isFinite(number) || number <= 0) return null;
  return { city: m[1] ?? null, district: m[2] ?? null, street: `${m[3]}${m[4] ?? ''}${m[5] ?? ''}`, number, raw };
}

/** 把門牌字串（「399號」「107之1」「12-1」）換成號碼 */
function houseNumber(s: string): { n: number; sub: boolean } | null {
  const m = /^(\d+)(?:\s*(?:之|-)\s*\d+)?\s*號?$/.exec(normalize(s));
  return m ? { n: Number(m[1]), sub: /之|-/.test(s) } : null;
}

export interface HouseRow {
  number: string;
  lat: number;
  lng: number;
}

/** 從同一條路的門牌找位置：完全一樣（不含之幾）優先，否則同側前後兩個門牌線性推算 */
export function locateOnStreet(rows: HouseRow[], number: number): AddressPoint | null {
  const parsed = rows.map((r) => ({ ...r, h: houseNumber(r.number) })).filter((r) => r.h) as Array<HouseRow & { h: { n: number; sub: boolean } }>;
  const same = parsed.filter((r) => r.h.n === number);
  if (same.length > 0) {
    const main = same.find((r) => !r.h.sub) ?? same[0];
    return { lat: main.lat, lng: main.lng, how: 'exact' };
  }
  const side = parsed.filter((r) => r.h.n % 2 === number % 2 && !r.h.sub);
  let below: (typeof side)[number] | null = null;
  let above: (typeof side)[number] | null = null;
  for (const r of side) {
    if (r.h.n < number && (!below || r.h.n > below.h.n)) below = r;
    if (r.h.n > number && (!above || r.h.n < above.h.n)) above = r;
  }
  if (below && above && above.h.n - below.h.n <= MAX_GAP) {
    const t = (number - below.h.n) / (above.h.n - below.h.n);
    return { lat: below.lat + t * (above.lat - below.lat), lng: below.lng + t * (above.lng - below.lng), how: 'interpolated' };
  }
  // 只有一邊有門牌：很近才用
  const near = [below, above].filter((r): r is NonNullable<typeof r> => !!r && Math.abs(r.h.n - number) <= 6);
  if (near.length > 0) return { lat: near[0].lat, lng: near[0].lng, how: 'interpolated' };
  return null;
}

async function overpassHouses(env: Env, a: TwAddress): Promise<HouseRow[]> {
  // 有縣市就只找那個縣市，沒有的話用鄉鎮區（可能跨縣市同名，交給號碼比對）
  const area = a.city ? `area["name"="${a.city}"]["admin_level"="4"]->.a;` : a.district ? `area["name"="${a.district}"]["admin_level"~"^(5|7)$"]->.a;` : '';
  if (!area) return [];
  const q = `[out:json][timeout:20];${area}nwr(area.a)["addr:street"="${a.street}"]["addr:housenumber"];out center tags;`;
  const errors: string[] = [];
  let res: Response | null = null;
  for (const url of OVERPASS_URLS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'user-agent': env.NOMINATIM_USER_AGENT, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: `data=${encodeURIComponent(q)}`,
      });
      if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) {
        res = r;
        break;
      }
      errors.push(`${new URL(url).host} ${r.status}`);
    } catch (e) {
      errors.push(`${new URL(url).host} ${String(e)}`);
    }
  }
  if (!res) throw new Error(`overpass: ${errors.join('; ')}`);
  const data = (await res.json()) as { elements?: Array<{ lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> };
  const out: HouseRow[] = [];
  for (const e of data.elements ?? []) {
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    const number = e.tags?.['addr:housenumber'];
    if (lat !== undefined && lng !== undefined && number) out.push({ number, lat, lng });
  }
  return out;
}

/** 門牌地址轉座標；不是門牌地址或找不到就回傳 null。結果快取在 geocode_cache（key 前面加「門牌:」） */
export async function geocodeAddress(env: Env, text: string, debug?: { error?: string }): Promise<(AddressPoint & { address: TwAddress }) | null> {
  const a = parseTwAddress(text);
  if (!a) return null;
  const key = `門牌:${a.city ?? ''}${a.district ?? ''}${a.street}${a.raw}號`;
  const now = nowSec();
  const cached = await env.DB.prepare('SELECT lat, lng, display_name, resolved_at FROM geocode_cache WHERE query = ?')
    .bind(key)
    .first<{ lat: number | null; lng: number | null; display_name: string | null; resolved_at: number }>();
  if (cached) {
    if (cached.lat !== null && cached.lng !== null) return { lat: cached.lat, lng: cached.lng, how: cached.display_name === 'exact' ? 'exact' : 'interpolated', address: a };
    if (cached.resolved_at > now - NEGATIVE_TTL_SEC) return null;
  }
  let point: AddressPoint | null = null;
  try {
    point = locateOnStreet(await overpassHouses(env, a), a.number);
  } catch (e) {
    // Overpass 暫時不通就不快取，下次再試
    console.warn(`address lookup failed for ${key}: ${String(e)}`);
    if (debug) debug.error = String(e);
    return null;
  }
  await env.DB.prepare(
    'INSERT INTO geocode_cache (query, lat, lng, display_name, resolved_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(query) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, display_name = excluded.display_name, resolved_at = excluded.resolved_at',
  )
    .bind(key, point?.lat ?? null, point?.lng ?? null, point?.how ?? null, now)
    .run();
  return point ? { ...point, address: a } : null;
}
