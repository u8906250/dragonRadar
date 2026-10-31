import type { Env } from '../env';
import { geocodeFirst } from '../geocode';
import { nowSec } from '../util';
import { CURRENT_MAP_URL, fetchCurrentMap, projectOnRoute, routeLine, type CurrentMapRoute, type LatLngPair } from './currentmap';

/** 台北大洋流官網「未來航線」的公開資料 */
const VOYAGE_URL = 'https://current.puma.taipei/api/voyage';
const CONFIG_URL = 'https://current.puma.taipei/api/config';
export const VOYAGE_PAGE = 'https://current.puma.taipei/route/';
const UA = 'Mozilla/5.0 (compatible; CurrentRadar/1.0; +https://current-radar.pages.dev)';
const DAY = 86400;
const LOOKAHEAD_DAYS = 14;
/** 出發點在出發後保留多久 */
export const DEPART_KEEP_SEC = 15 * 60;
/** 車隊預計經過加油點後，加油點再保留多久 */
export const PASS_KEEP_SEC = 15 * 60;
/** 抵達終點後沒有其他活動時，終點保留多久 */
export const ARRIVE_KEEP_SEC = 3600;
/** 只有出發時間、沒有抵達時間時，假設車掃走多久 */
export const PARADE_GUESS_SEC = 3600;

type RouteStep = string | { cheer: string; addr: string };

interface Stop {
  id: string;
  date: string;
  place: string;
  area?: string;
  latlng?: [number, number];
  ended?: boolean;
  changed?: string;
  route?: RouteStep[];
}

interface VoyageConfig {
  ticketPlace?: string;
  ticketTime?: string;
}

/** 台北時間某天 00:00 的 unix 秒 */
export function taipeiMidnight(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00+08:00`) / 1000);
}

/** 解析官網的「10/18（日）17:30」，年份取自航線日期 */
export function parseTicketTime(s: string | undefined, year: string): number | null {
  const m = /(\d{1,2})\/(\d{1,2})[^\d]*?(\d{1,2}):(\d{2})/.exec(s ?? '');
  if (!m) return null;
  const pad = (n: string): string => n.padStart(2, '0');
  const ms = Date.parse(`${year}-${pad(m[1])}-${pad(m[2])}T${pad(m[3])}:${m[4]}:00+08:00`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

const hm = (unix: number): string => new Date(unix * 1000).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });

interface Plan {
  depart: number | null;
  arrive: number | null;
  after: CurrentMapRoute['after'];
  map: CurrentMapRoute | null;
}

function summary(stop: Stop, plan: Plan): string {
  const route = (stop.route ?? []).map((r) => (typeof r === 'string' ? r : `${r.cheer}（${r.addr}）`)).join(' → ');
  const { depart, arrive, after, map } = plan;
  const lines = [`台北大洋流 ${stop.area ?? ''} 車掃`.trim(), `日期：${stop.date}`];
  if (depart) lines.push(`時間：${hm(depart)} 出發${arrive ? `，${map?.arrive ? '' : '約 '}${hm(arrive)} 抵達${stop.place}` : ''}`);
  lines.push(`終點：${stop.place}`);
  if (after) lines.push(`抵達後：${after.name} ${hm(after.start)}–${hm(after.end)}（${after.place}）`);
  if (route) lines.push(`路線：${route}`);
  if (map) lines.push(`車掃地圖：${map.slug}，${map.segments.length} 段，${(map.segments.reduce((n, s) => n + s.lengthM, 0) / 1000).toFixed(1)} km`);
  if (stop.changed) lines.push(`航線變更：${stop.changed}`);
  return lines.join('\n');
}

/** 路線上的一站，給前端畫路線與時間表；title 跟事件標題一樣，前端靠它對應 */
export interface RouteStop {
  kind: 'start' | 'cheer' | 'end';
  title: string;
  name: string;
  /** 回報的車掃：這一站的地點（地址），跟站名不一樣時才有 */
  place?: string;
  lat: number | null;
  lng: number | null;
  /** 出發／預計經過／抵達時間 */
  at: number | null;
}

export interface VoyageResult {
  stops: number;
  updated: number;
  events: number;
  routes: number;
  errors: string[];
}

/**
 * only.date：只同步這一天（YYYY-MM-DD）的航線（改版中自動抓資料停了，管理者手動放當天的車掃）；
 * only.map：管理者自己抓好的車掃地圖資料（車掃地圖擋 Cloudflare 的機器，Worker 抓會 403），有就不抓
 */
export async function syncVoyage(env: Env, now = nowSec(), only?: { date: string; map?: CurrentMapRoute | null }): Promise<VoyageResult> {
  const out: VoyageResult = { stops: 0, updated: 0, events: 0, routes: 0, errors: [] };
  let stops: Stop[] = [];
  let config: VoyageConfig = {};
  let cmap: CurrentMapRoute | null = null;
  try {
    const [v, c, m] = await Promise.all([
      fetch(VOYAGE_URL, { headers: { 'user-agent': UA, accept: 'application/json' } }),
      fetch(CONFIG_URL, { headers: { 'user-agent': UA, accept: 'application/json' } }),
      only?.map
        ? Promise.resolve(only.map)
        : fetchCurrentMap().catch((e) => {
            out.errors.push(String(e));
            return null;
          }),
    ]);
    if (!v.ok) throw new Error(`voyage HTTP ${v.status}`);
    stops = ((await v.json()) as { stops?: Stop[] }).stops ?? [];
    if (c.ok) config = (await c.json()) as VoyageConfig;
    cmap = m;
  } catch (e) {
    out.errors.push(String(e));
    return out;
  }

  for (const stop of stops) {
    if (only && stop.date !== only.date) continue;
    const day = taipeiMidnight(stop.date);
    if (!stop.id || Number.isNaN(day) || stop.ended || day + DAY <= now || day > now + LOOKAHEAD_DAYS * DAY) continue;
    out.stops++;
    const fleet = (stop.area ?? '').replace(/艦隊$/, '');
    const map = cmap && cmap.date === stop.date && (!fleet || cmap.name.includes(fleet)) ? cmap : null;
    // 官網的船票時間是車掃出發時間（車掃地圖寫「車掃 17:30–18:30」）。以車掃地圖為準，沒有才用船票時間
    const ticket = config.ticketPlace === stop.place ? parseTicketTime(config.ticketTime, stop.date.slice(0, 4)) : null;
    const depart = map?.depart ?? ticket;
    const arrive = map?.arrive ?? (depart ? depart + PARADE_GUESS_SEC : null);
    const plan: Plan = { depart, arrive, after: map?.after ?? null, map };
    const text = summary(stop, plan);
    const postId = `voyage-${stop.id}`;
    const existing = await env.DB.prepare('SELECT text FROM posts WHERE id = ?').bind(postId).first<{ text: string }>();
    const route = map ? await env.DB.prepare('SELECT id FROM routes WHERE id = ?').bind(map.slug).first<{ id: string }>() : null;
    if (existing?.text === text && (!map || route)) {
      // 時間和路線都沒變：只更新各路段的認領人數
      if (map) {
        await env.DB.prepare('UPDATE routes SET segments = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(map.segments), now, map.slug).run();
        out.routes++;
      }
      continue;
    }

    // 航線有變更：整批重建這一站的事件
    await env.DB.batch([
      env.DB.prepare('DELETE FROM events WHERE post_id = ?').bind(postId),
      env.DB.prepare('DELETE FROM routes WHERE post_id = ?').bind(postId),
      env.DB.prepare(
        `INSERT INTO posts (id, username, text, permalink, posted_at, keyword, source, fetched_at, processed_at)
         VALUES (?, '台北大洋流', ?, ?, ?, '洋流', 'official', ?, ?)
         ON CONFLICT(id) DO UPDATE SET text = excluded.text, fetched_at = excluded.fetched_at, processed_at = excluded.processed_at`,
      ).bind(postId, text, map ? CURRENT_MAP_URL : VOYAGE_PAGE, now, now, now),
    ]);
    out.updated++;

    const insert = (title: string, placeText: string, placeQuery: string, lat: number | null, lng: number | null, start: number, end: number, allDay: boolean) =>
      env.DB.prepare(
        `INSERT INTO events (post_id, kind, title, item, start_at, end_at, place_text, place_query, lat, lng, status, confidence, all_day, created_at, updated_at)
         VALUES (?, 'activity', ?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).bind(postId, title, start, end, placeText, placeQuery, lat, lng, lat === null ? 'unlocated' : start <= now ? 'active' : 'upcoming', allDay ? 1 : 0, now, now);

    const dayEnd = day + DAY - 1;
    const stmts = [];
    const routeStops: RouteStop[] = [];
    const line = map ? routeLine(map.segments) : null;
    const total = line ? line.cum[line.cum.length - 1] : 0;
    // 沒有即時位置，假設車隊等速前進，用累計距離推算經過各點的時間
    const timeAt = (m: number): number | null => (depart && arrive && total > 0 ? Math.round(depart + ((arrive - depart) * m) / total) : null);

    // 起點：車掃地圖第一段的起點，沒有就用官網路線的第一站
    const firstStep = (stop.route ?? []).find((r): r is string => typeof r === 'string');
    // 車掃地圖寫「起點：南福宮」「起點 南福宮」
  const startName = map?.segments[0].from.replace(/^起點\s*[:：]?\s*/, '').trim() || firstStep || '';
    if (startName) {
      let p: { lat: number; lng: number } | null = map ? { lat: map.segments[0].path[0][0], lng: map.segments[0].path[0][1] } : null;
      if (!p) p = await geocodeFirst(env, [`台北市 ${startName}`]);
      const title = `${fleet}出發・${startName}`;
      routeStops.push({ kind: 'start', title, name: startName, lat: p?.lat ?? null, lng: p?.lng ?? null, at: depart });
      stmts.push(depart ? insert(title, startName, `台北市 ${startName}`, p?.lat ?? null, p?.lng ?? null, depart, depart + DEPART_KEEP_SEC, false) : insert(title, startName, `台北市 ${startName}`, p?.lat ?? null, p?.lng ?? null, day, dayEnd, true));
    }

    // 加油點：一整天都在（大家會先去等），到車隊預計經過後 15 分鐘
    let fromM = 0;
    for (const r of stop.route ?? []) {
      if (typeof r === 'string' || !r.addr) continue;
      const key = r.cheer.replace(/(加油點|加油站|服務處)$/, '');
      // 車掃地圖的路段名稱有寫到的（例如「捷運永春站 許淑華加油站」）直接用它的座標，比地址查詢準
      const named = map?.segments.find((s) => key && s.to.includes(key));
      let p: LatLngPair | null = named ? named.path[named.path.length - 1] : null;
      if (!p) {
        // OpenStreetMap 常沒有台灣門牌，查不到就退到路段（位置是大概的）
        const street = r.addr.replace(/\d+(-\d+)?號.*$/, '').replace(/\d+巷.*$/, '').trim();
        const g = await geocodeFirst(env, [`台北市 ${r.addr}`, `台北市 ${r.cheer}`, street ? `台北市 ${street}` : ''].filter(Boolean));
        if (g) p = [g.lat, g.lng];
      }
      const proj = line && p ? projectOnRoute(line, p, fromM) : null;
      // 加油點一定在路線上：地址查到的位置離路線太遠，就移到路線上最近的地方
      if (proj && !named && proj.offM > 60) p = proj.at;
      if (proj) fromM = proj.m;
      const pass = proj ? timeAt(proj.m) : null;
      const title = `加油點・${r.cheer}`;
      routeStops.push({ kind: 'cheer', title, name: r.cheer, lat: p?.[0] ?? null, lng: p?.[1] ?? null, at: pass });
      stmts.push(insert(title, `${r.cheer}（${r.addr}）`, `台北市 ${r.addr}`, p?.[0] ?? null, p?.[1] ?? null, day, pass ? pass + PASS_KEEP_SEC : (arrive ?? dayEnd), true));
    }

    // 終點：抵達後有活動（例如市政開講）就用那個活動，否則保留 1 小時
    const lastPath = map?.segments[map.segments.length - 1].path;
    const endLL: LatLngPair | null = lastPath ? lastPath[lastPath.length - 1] : stop.latlng ?? null;
    const after = plan.after;
    const endTitle = after ? `${after.name}・${stop.place}` : `${fleet}抵達・${stop.place}`;
    routeStops.push({ kind: 'end', title: endTitle, name: stop.place, lat: endLL?.[0] ?? null, lng: endLL?.[1] ?? null, at: arrive });
    if (after) stmts.push(insert(endTitle, stop.place, `台北市 ${stop.place}`, endLL?.[0] ?? null, endLL?.[1] ?? null, Math.min(after.start, arrive ?? after.start), after.end, false));
    else if (arrive) stmts.push(insert(endTitle, stop.place, `台北市 ${stop.place}`, endLL?.[0] ?? null, endLL?.[1] ?? null, arrive, arrive + ARRIVE_KEEP_SEC, false));
    else stmts.push(insert(`${fleet}車掃・${stop.place}`, stop.place, `台北市 ${stop.place}`, endLL?.[0] ?? null, endLL?.[1] ?? null, day, dayEnd, true));

    if (map) {
      const showUntil = Math.max(after?.end ?? 0, (arrive ?? 0) + ARRIVE_KEEP_SEC, depart ? 0 : dayEnd);
      stmts.push(
        env.DB.prepare(
          `INSERT INTO routes (id, post_id, title, day_start, depart_at, arrive_at, show_until, claim_url, stops, segments, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET post_id = excluded.post_id, title = excluded.title, day_start = excluded.day_start, depart_at = excluded.depart_at,
             arrive_at = excluded.arrive_at, show_until = excluded.show_until, claim_url = excluded.claim_url, stops = excluded.stops,
             segments = excluded.segments, updated_at = excluded.updated_at`,
        ).bind(map.slug, postId, map.name, day, depart, arrive, showUntil, CURRENT_MAP_URL, JSON.stringify(routeStops), JSON.stringify(map.segments), now),
      );
      out.routes++;
    }
    await env.DB.batch(stmts);
    out.events += stmts.length - (map ? 1 : 0);
  }
  return out;
}

export interface RouteOut {
  id: string;
  /** official 官方航線（車掃地圖，有實際路徑和認領人數）；report 回報的車掃貼文（各站直線連起來） */
  source: 'official' | 'report';
  /** 畫法：rainbow 是彩虹（同志遊行，管理者用 migration 放的，有實際路徑、沒有認領）；沒有是車掃 */
  style?: 'rainbow';
  postId: string;
  title: string;
  departAt: number | null;
  arriveAt: number | null;
  showUntil: number;
  claimUrl: string | null;
  stops: RouteStop[];
  segments: CurrentMapRoute['segments'];
  updatedAt: number;
}

/**
 * 車掃路線：官方的只給今天的（已經到當天、還沒過顯示期限）；回報的（id 是 link-…）、有指定畫法的（同志遊行）還沒到那天也給，
 * 清單才合成一張卡片
 */
export async function listRoutes(env: Env, now = nowSec()): Promise<RouteOut[]> {
  const { results } = await env.DB.prepare("SELECT * FROM routes WHERE (day_start <= ? OR id LIKE 'link-%' OR style IS NOT NULL) AND show_until > ? ORDER BY depart_at")
    .bind(now, now)
    .all<{ id: string; post_id: string; title: string; depart_at: number | null; arrive_at: number | null; show_until: number; claim_url: string | null; stops: string; segments: string; updated_at: number; style: string | null }>();
  return results.map((r) => ({
    id: r.id,
    source: r.id.startsWith('link-') ? 'report' : 'official',
    ...(r.style === 'rainbow' ? { style: 'rainbow' as const } : {}),
    postId: r.post_id,
    title: r.title,
    departAt: r.depart_at,
    arriveAt: r.arrive_at,
    showUntil: r.show_until,
    claimUrl: r.claim_url,
    stops: JSON.parse(r.stops) as RouteStop[],
    segments: JSON.parse(r.segments) as CurrentMapRoute['segments'],
    updatedAt: r.updated_at,
  }));
}
