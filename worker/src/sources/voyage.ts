import type { Env } from '../env';
import { geocodeFirst } from '../geocode';
import { nowSec } from '../util';

/** 台北大洋流官網「未來航線」的公開資料 */
const VOYAGE_URL = 'https://current.puma.taipei/api/voyage';
const CONFIG_URL = 'https://current.puma.taipei/api/config';
export const VOYAGE_PAGE = 'https://current.puma.taipei/route/';
const UA = 'Mozilla/5.0 (compatible; CurrentRadar/1.0; +https://current-radar.pages.dev)';
const DAY = 86400;
const LOOKAHEAD_DAYS = 14;

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

function summary(stop: Stop, ticket: number | null): string {
  const route = (stop.route ?? []).map((r) => (typeof r === 'string' ? r : `${r.cheer}（${r.addr}）`)).join(' → ');
  const lines = [
    `台北大洋流 ${stop.area ?? ''} 車掃`.trim(),
    `日期：${stop.date}`,
    `終點：${stop.place}${ticket ? `（${new Date(ticket * 1000).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })}）` : '，時間未公布'}`,
  ];
  if (route) lines.push(`路線：${route}`);
  if (stop.changed) lines.push(`航線變更：${stop.changed}`);
  return lines.join('\n');
}

export interface VoyageResult {
  stops: number;
  updated: number;
  events: number;
  errors: string[];
}

export async function syncVoyage(env: Env, now = nowSec()): Promise<VoyageResult> {
  const out: VoyageResult = { stops: 0, updated: 0, events: 0, errors: [] };
  let stops: Stop[] = [];
  let config: VoyageConfig = {};
  try {
    const [v, c] = await Promise.all([
      fetch(VOYAGE_URL, { headers: { 'user-agent': UA, accept: 'application/json' } }),
      fetch(CONFIG_URL, { headers: { 'user-agent': UA, accept: 'application/json' } }),
    ]);
    if (!v.ok) throw new Error(`voyage HTTP ${v.status}`);
    stops = ((await v.json()) as { stops?: Stop[] }).stops ?? [];
    if (c.ok) config = (await c.json()) as VoyageConfig;
  } catch (e) {
    out.errors.push(String(e));
    return out;
  }

  for (const stop of stops) {
    const day = taipeiMidnight(stop.date);
    if (!stop.id || Number.isNaN(day) || stop.ended || day + DAY <= now || day > now + LOOKAHEAD_DAYS * DAY) continue;
    out.stops++;
    const ticket = config.ticketPlace === stop.place ? parseTicketTime(config.ticketTime, stop.date.slice(0, 4)) : null;
    const text = summary(stop, ticket);
    const postId = `voyage-${stop.id}`;
    const existing = await env.DB.prepare('SELECT text FROM posts WHERE id = ?').bind(postId).first<{ text: string }>();
    if (existing?.text === text) continue;

    // 航線有變更：整批重建這一站的事件
    await env.DB.batch([
      env.DB.prepare('DELETE FROM events WHERE post_id = ?').bind(postId),
      env.DB.prepare(
        `INSERT INTO posts (id, username, text, permalink, posted_at, keyword, source, fetched_at, processed_at)
         VALUES (?, '台北大洋流', ?, ?, ?, '洋流', 'official', ?, ?)
         ON CONFLICT(id) DO UPDATE SET text = excluded.text, fetched_at = excluded.fetched_at, processed_at = excluded.processed_at`,
      ).bind(postId, text, VOYAGE_PAGE, now, now, now),
    ]);
    out.updated++;

    const insert = (title: string, placeText: string, placeQuery: string, lat: number | null, lng: number | null, start: number, end: number, allDay: boolean) =>
      env.DB.prepare(
        `INSERT INTO events (post_id, kind, title, item, start_at, end_at, place_text, place_query, lat, lng, status, confidence, all_day, created_at, updated_at)
         VALUES (?, 'activity', ?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).bind(postId, title, start, end, placeText, placeQuery, lat, lng, lat === null ? 'unlocated' : start <= now ? 'active' : 'upcoming', allDay ? 1 : 0, now, now);

    const fleet = (stop.area ?? '').replace(/艦隊$/, '');
    const dayEnd = day + DAY - 1;
    const stmts = [
      ticket
        ? insert(`${fleet}車掃・${stop.place}`, stop.place, `台北市 ${stop.place}`, stop.latlng?.[0] ?? null, stop.latlng?.[1] ?? null, ticket, ticket + 2 * 3600, false)
        : insert(`${fleet}車掃・${stop.place}`, stop.place, `台北市 ${stop.place}`, stop.latlng?.[0] ?? null, stop.latlng?.[1] ?? null, day, dayEnd, true),
    ];
    for (const r of stop.route ?? []) {
      if (typeof r === 'string' || !r.addr) continue;
      // OpenStreetMap 常沒有台灣門牌，查不到就退到路段（位置是大概的）
      const street = r.addr.replace(/\d+(-\d+)?號.*$/, '').replace(/\d+巷.*$/, '').trim();
      const p = await geocodeFirst(env, [`台北市 ${r.addr}`, `台北市 ${r.cheer}`, street ? `台北市 ${street}` : ''].filter(Boolean));
      stmts.push(insert(`加油點・${r.cheer}`, `${r.cheer}（${r.addr}）`, `台北市 ${r.addr}`, p?.lat ?? null, p?.lng ?? null, day, dayEnd, true));
    }
    await env.DB.batch(stmts);
    out.events += stmts.length;
  }
  return out;
}
