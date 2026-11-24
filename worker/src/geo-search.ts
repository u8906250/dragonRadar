/**
 * 全螢幕雷達的「搜尋地址」（v1.785 使用者說想在全螢幕雷達直接搜尋地址）：只查台灣，最多 MAX_HITS 筆。
 * 1. 門牌（parseTwAddress 認得的）：用回報系統的門牌定位（只問 Photon，不等很慢的 Overpass）
 * 2. Photon（komoot 架的 OpenStreetMap 地址搜尋）查地名、路名、地標；照畫面的大概位置排，近的先
 * 3. 都沒有再問 Nominatim（使用規範不能邊打邊查，所以網頁按 Enter 才查）
 * 結果（含查不到）快取在 geo_search，不記是誰查的；沒快取、真的去查的才算次數（geo_search_counts，只記次數，2 小時內刪掉）
 */
import { geocodeAddress, parseTwAddress } from './address';
import type { Env } from './env';
import { PHOTON_SKIP, politeDelay } from './geocode';
import { ReportError } from './reports';

export interface PlaceHit {
  /** 「臺北大巨蛋」「信義路四段399號」「永康街」 */
  name: string;
  /** 「臺北市信義區」，不知道是空字串 */
  area: string;
  /** 「體育場」「路」「門牌」，分不出來是空字串 */
  kind: string;
  lat: number;
  lng: number;
  /** 飛過去時雷達的範圍（外圈幾公里）：看得到整個地方 */
  km: number;
}

const PHOTON_URL = 'https://photon.komoot.io/api/';
/** 台灣（含金門、馬祖、澎湖、蘭嶼）：minLon,minLat,maxLon,maxLat */
const TW_BBOX = '118.1,21.8,122.1,26.4';
export const MAX_HITS = 6;
export const QUERY_MAX = 60;
/** 查到的快取 7 天，查不到的 1 天 */
const HIT_TTL_SEC = 7 * 86400;
const MISS_TTL_SEC = 86400;
/** 沒快取的查詢：每個 IP 每小時、全部每分鐘（Photon、Nominatim 是免費的公用服務） */
export const SEARCH_PER_IP_HOUR = 60;
export const SEARCH_PER_MIN = 40;
/** 同名的地點這麼近就當成同一個（公車站、月台、出口） */
const SAME_KM = 0.5;
/** 同名的路段離這條路已經有的路段這麼近才合成一條（同一個縣市可能有好幾條同名的路） */
const ROAD_JOIN_KM = 2;
/** 門牌、小地點飛過去的範圍；路、大地方照外框 */
const SPOT_KM = 0.3;
const STREET_MIN_KM = 0.5;
const AREA_MAX_KM = 40;

/** OSM 的種類 → 寫在結果旁邊的中文；key 是「osm_key:osm_value」，也可以只寫 osm_key */
const KIND_ZH: Record<string, string> = {
  'railway:station': '車站',
  'public_transport:station': '車站',
  'railway:halt': '車站',
  'aeroway:aerodrome': '機場',
  'leisure:park': '公園',
  'leisure:garden': '公園',
  'leisure:stadium': '體育場',
  'building:stadium': '體育場',
  'leisure:sports_centre': '運動中心',
  'amenity:marketplace': '市場',
  'amenity:school': '學校',
  'amenity:university': '大學',
  'amenity:college': '學校',
  'amenity:hospital': '醫院',
  'amenity:clinic': '診所',
  'amenity:library': '圖書館',
  'amenity:townhall': '公所',
  'amenity:police': '警察局',
  'amenity:place_of_worship': '宗教',
  'amenity:restaurant': '餐廳',
  'amenity:cafe': '咖啡店',
  'amenity:fast_food': '餐廳',
  'amenity:bar': '酒吧',
  'amenity:theatre': '展演',
  'amenity:arts_centre': '展演',
  'tourism:museum': '博物館',
  'tourism:gallery': '美術館',
  'tourism:attraction': '景點',
  'tourism:viewpoint': '景點',
  'tourism:hotel': '旅館',
  'tourism:hostel': '旅館',
  'tourism:zoo': '動物園',
  'tourism:theme_park': '遊樂園',
  'natural:peak': '山',
  'natural:beach': '海灘',
  'natural:water': '湖',
  'waterway:river': '河',
  historic: '古蹟',
  shop: '店家',
  office: '公司',
  place: '地名',
  boundary: '行政區',
};

/** 不列：公車站、月台、出口、停車場這種同名很多、不是要找的（跟回報定位的 Photon 備援一樣） */
const SKIP = PHOTON_SKIP;

const kindOf = (key: string, value: string): string => KIND_ZH[`${key}:${value}`] ?? KIND_ZH[key] ?? '';

const distKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number =>
  Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180));

/** 外框（[西, 北, 東, 南]）的半邊長（公里）：飛過去時雷達的外圈 */
function spanKm(e: [number, number, number, number]): number {
  const [w, n, east, s] = e;
  const mid = (n + s) / 2;
  return Math.max(Math.abs(n - s) * 111, Math.abs(east - w) * 111 * Math.cos((mid * Math.PI) / 180)) / 2;
}

const clampKm = (km: number, min: number): number => Math.round(Math.min(AREA_MAX_KM, Math.max(min, km * 1.2)) * 100) / 100;

/** 寫成「臺北市信義區」「新竹縣竹北市」：縣、市，再加區鄉鎮（Photon 的 district 常常是里，不寫） */
export function areaOf(parts: Array<string | undefined>): string {
  const out: string[] = [];
  for (const p of parts) {
    const t = (p ?? '').trim();
    if (/^.{1,6}[縣市區鄉鎮]$/.test(t) && !out.includes(t)) out.push(t);
  }
  return out.join('');
}

export interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    type?: string;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    district?: string;
    county?: string;
    extent?: [number, number, number, number];
  };
}

/**
 * Photon 的結果整理成清單：拿掉公車站、月台這種；同一條路的好幾段（同名、同縣市、ROAD_JOIN_KM 內）合成一筆（用最靠近整條路中間的那段）；
 * 同名、SAME_KM 內的只留第一筆（Photon 已經照相關、遠近排好）
 */
export function photonHits(features: PhotonFeature[]): PlaceHit[] {
  type Road = { hit: PlaceHit; ext: [number, number, number, number]; parts: Array<{ lat: number; lng: number }> };
  const out: Array<PlaceHit | Road> = [];
  const roads = new Map<string, Road[]>();
  for (const f of features) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    const key = p.osm_key ?? '';
    const value = p.osm_value ?? '';
    if (SKIP.test(`${key}:${value}`)) continue;
    const at = { lat: c[1], lng: c[0] };
    const area = areaOf([p.county, p.city, p.district]);
    if (p.type === 'street' && p.name) {
      const k = `${p.name}|${p.county ?? ''}${p.city ?? ''}`;
      const ext = p.extent ?? [at.lng, at.lat, at.lng, at.lat];
      const same = roads.get(k) ?? [];
      const r = same.find((x) => x.parts.some((q) => distKm(q, at) < ROAD_JOIN_KM));
      if (r) {
        r.ext = [Math.min(r.ext[0], ext[0]), Math.max(r.ext[1], ext[1]), Math.max(r.ext[2], ext[2]), Math.min(r.ext[3], ext[3])];
        r.parts.push(at);
        continue;
      }
      const road: Road = { hit: { name: p.name, area, kind: '路', ...at, km: 0 }, ext, parts: [at] };
      roads.set(k, [...same, road]);
      out.push(road);
      continue;
    }
    const name = p.name ?? (p.street && p.housenumber ? `${p.street}${p.housenumber.replace(/號$/, '')}號` : '');
    if (!name) continue;
    const kind = p.type === 'house' && !p.name ? '門牌' : kindOf(key, value);
    const km = p.extent ? clampKm(spanKm(p.extent), SPOT_KM) : p.type === 'city' || p.type === 'county' || p.type === 'district' ? 3 : SPOT_KM;
    out.push({ name, area, kind, ...at, km });
  }
  const hits: PlaceHit[] = out.map((h) => {
    if (!('ext' in h)) return h;
    // 整條路外框的中間，挑最靠近它的那一段
    const mid = { lat: (h.ext[1] + h.ext[3]) / 2, lng: (h.ext[0] + h.ext[2]) / 2 };
    const best = h.parts.reduce((a, b) => (distKm(b, mid) < distKm(a, mid) ? b : a));
    return { ...h.hit, ...best, km: clampKm(spanKm(h.ext), STREET_MIN_KM) };
  });
  return dedupe(hits);
}

/** 同名、SAME_KM 內的只留第一筆 */
export function dedupe(hits: PlaceHit[]): PlaceHit[] {
  const kept: PlaceHit[] = [];
  for (const h of hits) if (!kept.some((k) => k.name === h.name && distKm(k, h) < SAME_KM)) kept.push(h);
  return kept;
}

interface NominatimRow {
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  addresstype?: string;
  /** [南, 北, 西, 東] */
  boundingbox?: [string, string, string, string];
  address?: Record<string, string>;
}

export function nominatimHits(rows: NominatimRow[]): PlaceHit[] {
  const out: PlaceHit[] = [];
  for (const r of rows) {
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = r.category ?? '';
    const value = r.type ?? '';
    if (SKIP.test(`${key}:${value}`)) continue;
    const name = r.name || (r.display_name ?? '').split(',')[0].trim();
    if (!name) continue;
    const a = r.address ?? {};
    const area = areaOf([a.county, a.city, a.town, a.city_district, a.suburb]);
    const bb = r.boundingbox?.map(Number);
    const km = bb && bb.every(Number.isFinite) ? clampKm(spanKm([bb[2], bb[1], bb[3], bb[0]]), key === 'highway' ? STREET_MIN_KM : SPOT_KM) : SPOT_KM;
    out.push({ name, area: area === name ? '' : area, kind: key === 'highway' ? '路' : kindOf(key, value), lat, lng, km });
  }
  return dedupe(out);
}

/** 查詢字串：去頭尾空白、空白縮成一格、全形空白也算；太長截掉 */
export const cleanQuery = (q: string): string => q.replace(/[\s　]+/g, ' ').trim().slice(0, QUERY_MAX);

/** 畫面的大概位置（0.5 度，約 50 公里的格子）：只用來讓近的排前面，也當快取的一部分 */
export function nearCell(lat: number | undefined, lng: number | undefined): { lat: number; lng: number } | null {
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 2) / 2, lng: Math.round(lng * 2) / 2 };
}

async function photon(env: Env, q: string, near: { lat: number; lng: number } | null): Promise<PlaceHit[]> {
  const u = new URL(PHOTON_URL);
  u.searchParams.set('q', q);
  u.searchParams.set('bbox', TW_BBOX);
  u.searchParams.set('limit', '15');
  if (near) {
    u.searchParams.set('lat', String(near.lat));
    u.searchParams.set('lon', String(near.lng));
  }
  const res = await fetch(u.toString(), { signal: AbortSignal.timeout(6000), headers: { 'user-agent': env.NOMINATIM_USER_AGENT, accept: 'application/json' } });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  return photonHits(((await res.json()) as { features?: PhotonFeature[] }).features ?? []);
}

async function nominatim(env: Env, q: string): Promise<PlaceHit[]> {
  await politeDelay();
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('limit', String(MAX_HITS));
  u.searchParams.set('countrycodes', 'tw');
  u.searchParams.set('accept-language', 'zh-TW');
  u.searchParams.set('addressdetails', '1');
  u.searchParams.set('q', q);
  const res = await fetch(u.toString(), { signal: AbortSignal.timeout(6000), headers: { 'user-agent': env.NOMINATIM_USER_AGENT, accept: 'application/json' } });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  return nominatimHits((await res.json()) as NominatimRow[]);
}

/** 真的去查（沒快取）：算次數，超過就擋 */
async function countSearch(env: Env, ip: string, now: number): Promise<void> {
  const hour = Math.floor(now / 3600);
  const minute = Math.floor(now / 60);
  const bump = (k: string, until: number) =>
    env.DB.prepare('INSERT INTO geo_search_counts (k, n, until) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n').bind(k, until);
  const [mine, all] = await env.DB.batch<{ n: number }>([bump(`i:${ip}:${hour}`, (hour + 2) * 3600), bump(`all:${minute}`, (minute + 2) * 60)]);
  if ((mine.results[0]?.n ?? 0) > SEARCH_PER_IP_HOUR) throw new ReportError(429, '這一個小時查太多次了，等一下再查');
  if ((all.results[0]?.n ?? 0) > SEARCH_PER_MIN) throw new ReportError(429, '現在查的人太多了，過一分鐘再查');
}

/** 搜尋地址、地名、路名（只查台灣）；ip 是 IP 的加鹽雜湊，只用來算次數 */
export async function searchPlaces(env: Env, rawQuery: string, lat: number | undefined, lng: number | undefined, ip: string, now: number): Promise<PlaceHit[]> {
  const q = cleanQuery(rawQuery);
  if (!q) throw new ReportError(400, '請輸入地址或地名');
  const near = nearCell(lat, lng);
  const key = `${q}|${near ? `${near.lat},${near.lng}` : ''}`;
  const cached = await env.DB.prepare('SELECT results, resolved_at FROM geo_search WHERE query = ?').bind(key).first<{ results: string; resolved_at: number }>();
  if (cached) {
    const hits = JSON.parse(cached.results) as PlaceHit[];
    if (now - cached.resolved_at < (hits.length > 0 ? HIT_TTL_SEC : MISS_TTL_SEC)) return hits;
  }
  await countSearch(env, ip, now);
  const hits: PlaceHit[] = [];
  let failed = false;
  // 門牌：照回報系統的定位（同一個門牌也會快取在 geocode_cache）；也查那條路，門牌找不到時至少到得了路
  const addr = parseTwAddress(q);
  if (addr) {
    const p = await geocodeAddress(env, q, undefined, { overpass: false }).catch(() => null);
    if (p) hits.push({ name: `${addr.street}${addr.raw}號`, area: areaOf([addr.city ?? undefined, addr.district ?? undefined]), kind: p.how === 'exact' ? '門牌' : '門牌（推算）', lat: p.lat, lng: p.lng, km: SPOT_KM });
  }
  const text = addr ? `${addr.street} ${addr.city ?? addr.district ?? ''}`.trim() : q;
  try {
    hits.push(...(await photon(env, text, near)));
  } catch (e) {
    console.warn('geo-search', e instanceof Error ? e.message : String(e));
    failed = true;
  }
  if (hits.length === 0) {
    try {
      hits.push(...(await nominatim(env, text)));
      failed = false;
    } catch (e) {
      console.warn('geo-search', e instanceof Error ? e.message : String(e));
      failed = true;
    }
  }
  const out = dedupe(hits).slice(0, MAX_HITS);
  // 兩個都連不上：不快取（之後還會再查），告訴使用者暫時查不到
  if (out.length === 0 && failed) throw new ReportError(503, '地址搜尋暫時連不上，請稍後再試');
  await env.DB.prepare('INSERT INTO geo_search (query, results, resolved_at) VALUES (?, ?, ?) ON CONFLICT(query) DO UPDATE SET results = excluded.results, resolved_at = excluded.resolved_at')
    .bind(key, JSON.stringify(out), now)
    .run();
  return out;
}

/** 排程：過期的快取、過了的次數紀錄刪掉 */
export async function purgeGeoSearch(env: Env, now: number): Promise<number> {
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM geo_search WHERE resolved_at < ?').bind(now - HIT_TTL_SEC),
    env.DB.prepare('DELETE FROM geo_search_counts WHERE until < ?').bind(now),
  ]);
  return r.reduce((n, x) => n + (x.meta.changes ?? 0), 0);
}
