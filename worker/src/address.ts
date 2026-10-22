/**
 * 台灣門牌地址定位：Nominatim 幾乎查不到門牌號碼（「信義路四段399號」只查得到整條路），
 * 但 OpenStreetMap 在台灣有大量門牌資料（addr:street + addr:housenumber）。
 * 先問 Photon（用 OSM 資料建的地址搜尋，約 1 秒，寫成「信義路四段 399 臺北市」就查得到門牌），
 * 沒有的話再用 Overpass 找同一條路附近的門牌（常常很慢，有逾時）。
 * 有完全一樣的號碼就用它，沒有就用同一側（單雙號）前後最近的兩個門牌推算位置。
 */
import type { Env } from './env';
import { geocode, geocodeStreet } from './geocode';
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

const PHOTON_URL = 'https://photon.komoot.io/api/';
/** Overpass 常常很慢（能用的鏡像站有時要 15 秒）：幾個鏡像站同時查，誰先回應用誰，最多等這麼久 */
const OVERPASS_TIMEOUT_MS = 18_000;
/** 主站常對 Cloudflare 的共用 IP 限流，依序換鏡像站 */
const OVERPASS_URLS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const SECTION_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
/** 推算時前後門牌最多差幾號，太遠就不準 */
const MAX_GAP = 60;
const NEGATIVE_TTL_SEC = 24 * 3600;
/** 別的鄉鎮區的門牌離寫的那一區的這條路幾公里內才算（跟 Overpass 查路附近的範圍差不多） */
const NEIGHBOR_KM = 2;

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
  // 縣市、鄉鎮區要從固定的名稱認，不然「蘭鄉排骨飯台北市」會被當成「飯臺北市」；路名不能含區縣鄉鎮里
  const city = '((?:臺北|新北|桃園|臺中|臺南|高雄|基隆|新竹|嘉義)市|(?:新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|臺東|澎湖|金門|連江)縣)';
  const re = new RegExp(
    `(?:\\d{3,6})?(?:${city}([\\u4e00-\\u9fff]{1,3}?[區鄉鎮市])?|(?<![\\u4e00-\\u9fff])([\\u4e00-\\u9fff]{1,2}[區鄉鎮]))?` +
      `(?:[\\u4e00-\\u9fff]{1,3}[里村])?(?:\\d+鄰)?` +
      // 路名不含括號、標點（「景華公園（景華街55號）」不能認成「公園（景華街」）
      `([^\\s\\d區縣鄉鎮里村鄰巷弄號（）()「」『』【】《》〈〉<>\\[\\],，、。.:：;；/／|｜·・!！?？~～#＃@＠\\-－—]{1,5}?(?:路|街|大道)(?:[一二三四五六七八九十]段)?)(\\d+巷)?(\\d+弄)?(\\d+(?:[之-]\\d+)?)號`,
  );
  const m = re.exec(s);
  if (!m) return null;
  const raw = m[7];
  const number = Number(raw.split(/[之-]/)[0]);
  if (!Number.isFinite(number) || number <= 0) return null;
  return { city: m[1] ?? null, district: m[2] ?? m[3] ?? null, street: `${m[4]}${m[5] ?? ''}${m[6] ?? ''}`, number, raw };
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
  /** OSM 算在別的鄉鎮區（區界上的路），離寫的那一區的這條路夠近才用 */
  elsewhere?: boolean;
}

/** 從同一條路的門牌找位置：完全一樣（不含之幾）優先，否則同側前後兩個門牌線性推算 */
export function locateOnStreet(rows: HouseRow[], number: number, raw?: string): AddressPoint | null {
  const parsed = rows.map((r) => ({ ...r, h: houseNumber(r.number) })).filter((r) => r.h) as Array<HouseRow & { h: { n: number; sub: boolean } }>;
  const same = parsed.filter((r) => r.h.n === number);
  if (same.length > 0) {
    // 「25-2」先找「25之2號」，沒有才用 25 號
    const key = (x: string): string => normalize(x).replace(/-/g, '之').replace(/號$/, '');
    const main = (raw ? same.find((r) => key(r.number) === key(raw)) : undefined) ?? same.find((r) => !r.h.sub) ?? same[0];
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

/** 路附近找門牌的範圍（度），約 2 公里：一段路通常不超過這麼長 */
const NEAR_DEG = 0.02;

async function overpassHouses(env: Env, a: TwAddress): Promise<HouseRow[]> {
  // 先用 Nominatim 找到這條路（查得到路名，只是查不到門牌），只查路附近的門牌；
  // 用整個縣市範圍查很慢，常常逾時
  const road = a.street.replace(/\d+巷.*$/, '');
  const center = await geocode(env, `${a.city ?? ''}${a.district ?? ''}${road}`);
  let scope: string;
  if (center) {
    const dLng = NEAR_DEG / Math.cos((center.lat * Math.PI) / 180);
    scope = `(${(center.lat - NEAR_DEG).toFixed(4)},${(center.lng - dLng).toFixed(4)},${(center.lat + NEAR_DEG).toFixed(4)},${(center.lng + dLng).toFixed(4)})`;
  } else if (a.city) {
    scope = '(area.a)';
  } else {
    return [];
  }
  const area = scope === '(area.a)' ? `area["name"="${a.city}"]["admin_level"="4"]->.a;` : '';
  const q = `[out:json][timeout:15];${area}nwr${scope}["addr:street"="${a.street}"]["addr:housenumber"];out center tags;`;
  // 鏡像站常常有的掛掉、有的很慢：同時查，第一個回 JSON 的就用，其他的取消
  const controllers = OVERPASS_URLS.map(() => new AbortController());
  const timer = setTimeout(() => controllers.forEach((c) => c.abort()), OVERPASS_TIMEOUT_MS);
  type OverpassData = { elements?: Array<{ lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> };
  let data: OverpassData;
  try {
    data = await Promise.any(
      OVERPASS_URLS.map(async (url, i) => {
        const host = new URL(url).host;
        try {
          const r = await fetch(url, {
            signal: controllers[i].signal,
            method: 'POST',
            headers: { 'user-agent': env.NOMINATIM_USER_AGENT, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
            body: `data=${encodeURIComponent(q)}`,
          });
          if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error(`${r.status}`);
          const json = (await r.json()) as OverpassData;
          controllers.forEach((c, j) => j !== i && c.abort());
          return json;
        } catch (e) {
          throw new Error(`${host} ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    );
  } catch (e) {
    const errs = e instanceof AggregateError ? e.errors.map((x) => (x instanceof Error ? x.message : String(x))) : [String(e)];
    throw new Error(`overpass: ${errs.join('; ')}`);
  } finally {
    clearTimeout(timer);
  }
  const out: HouseRow[] = [];
  for (const e of data.elements ?? []) {
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    const number = e.tags?.['addr:housenumber'];
    if (lat !== undefined && lng !== undefined && number) out.push({ number, lat, lng });
  }
  return out;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { type?: string; street?: string; housenumber?: string; city?: string; district?: string };
}

/** Photon：同一條路（含巷弄）、同一個縣市的門牌；鄉鎮區不一樣的標成 elsewhere */
async function photonHouses(env: Env, a: TwAddress, raw: string = a.raw): Promise<HouseRow[]> {
  const u = new URL(PHOTON_URL);
  u.searchParams.set('q', `${a.street} ${raw} ${a.city ?? a.district ?? ''}`.trim());
  u.searchParams.set('limit', '10');
  const res = await fetch(u.toString(), { signal: AbortSignal.timeout(6000), headers: { 'user-agent': env.NOMINATIM_USER_AGENT, accept: 'application/json' } });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const data = (await res.json()) as { features?: PhotonFeature[] };
  const out: HouseRow[] = [];
  for (const f of data.features ?? []) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    if (p.type !== 'house' || !p.housenumber || !c || normalize(p.street ?? '') !== a.street) continue;
    if (a.city && p.city && normalize(p.city) !== a.city) continue;
    // 沒寫縣市時至少要對到鄉鎮區，全台同名的路很多
    if (!a.city && (!a.district || p.district !== a.district)) continue;
    out.push({ number: p.housenumber, lat: c[1], lng: c[0], elsewhere: !!(a.district && p.district && p.district !== a.district) });
  }
  return out;
}

const distKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number =>
  Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180));

/**
 * 先只用同一個鄉鎮區的門牌；找不到再加上別的鄉鎮區、但離寫的那一區的這條路 NEIGHBOR_KM 內的門牌。
 * 區界上的路兩邊分屬不同區（「臺南市中西區北門路一段55號」OSM 算在東區），
 * 同一個縣市裡別區的同名路（板橋、永和都有中山路一段）通常離得比較遠。
 */
async function locateNearDistrict(env: Env, a: TwAddress, houses: HouseRow[]): Promise<AddressPoint | null> {
  const same = houses.filter((h) => !h.elsewhere);
  const point = locateOnStreet(same, a.number, a.raw);
  const other = houses.filter((h) => h.elsewhere);
  if (point || other.length === 0 || !a.city) return point;
  const road = await geocodeStreet(env, a.city, a.district, a.street);
  if (!road) return null;
  return locateOnStreet([...same, ...other.filter((h) => distKm(h, road.point) <= NEIGHBOR_KM)], a.number, a.raw);
}

/** geocode_cache 裡門牌查詢的 key */
export const addressCacheKey = (a: TwAddress): string => `門牌:${a.city ?? ''}${a.district ?? ''}${a.street}${a.raw}號`;

/** 門牌地址轉座標；不是門牌地址或找不到就回傳 null。結果快取在 geocode_cache（key 前面加「門牌:」） */
export async function geocodeAddress(
  env: Env,
  text: string,
  debug?: { error?: string },
  /** overpass: false 只查 Photon（很快），Overpass 很慢時用；查不到時不快取，之後還會再查 */
  opts: { overpass?: boolean } = {},
): Promise<(AddressPoint & { address: TwAddress }) | null> {
  const a = parseTwAddress(text);
  if (!a) return null;
  const key = addressCacheKey(a);
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
    // Photon 偶爾一時連不上，再試一次
    const houses = await photonHouses(env, a).catch(() => photonHouses(env, a).catch(() => []));
    point = await locateNearDistrict(env, a, houses);
    // Photon 搜「自立街 22」只回傳一樣是 22 號的（常常是別區的），前後的門牌要另外查：同一側先 ±2，沒有再 ±4
    for (const step of [2, 4]) {
      if (point) break;
      const near = (await Promise.all([a.number - step, a.number + step].filter((n) => n > 0).map((n) => photonHouses(env, a, String(n)).catch(() => [])))).flat();
      if (near.length > 0) point = await locateNearDistrict(env, a, [...houses, ...near]);
    }
    if (!point && opts.overpass === false) return null;
    if (!point) point = locateOnStreet(await overpassHouses(env, a), a.number, a.raw);
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
