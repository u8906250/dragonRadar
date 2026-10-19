import type { Env } from './env';
import { extractFromPost, type EventKind, type ExtractedEvent } from './extract';
import { adminArea, geocode, geocodeFirst, placeCandidates } from './geocode';
import { listActiveKeywords, type KeywordRow } from './keywords';
import { parseThreadsTimestamp, type ThreadsClient } from './threads';
import { nowSec, parseIsoToUnix } from './util';

export type EventStatus = 'upcoming' | 'active' | 'ended' | 'unlocated';

export interface PostRow {
  id: string;
  username: string | null;
  text: string;
  permalink: string | null;
  posted_at: number;
  keyword: string | null;
  source: string;
  fetched_at: number;
  processed_at: number | null;
  extraction: string | null;
}

export interface EventRow {
  id: number;
  post_id: string;
  kind: EventKind;
  title: string;
  item: string | null;
  start_at: number;
  end_at: number;
  place_text: string;
  place_query: string | null;
  lat: number | null;
  lng: number | null;
  status: EventStatus;
  confidence: number | null;
  ended_reason: string | null;
  all_day?: number;
  spot?: number;
  approx_area?: string | null;
  last_checked_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface EventOut {
  id: number;
  kind: EventKind;
  title: string;
  item: string | null;
  startAt: number;
  endAt: number;
  placeText: string;
  lat: number;
  lng: number;
  status: 'upcoming' | 'active';
  confidence: number | null;
  keyword: string | null;
  /** 只有日期、沒有公布時間 */
  allDay: boolean;
  /** 有幾個人回報已發完／已結束 */
  endedReports: number;
  /** 固定據點的其中一天（同一則貼文、同一地點的每天各一筆） */
  spot: boolean;
  /** 找不到精確地點、只定位到鄉鎮區中心時的區域名稱，例如「雲林縣虎尾鎮」 */
  approxArea: string | null;
  /** 官方行程才有：併進來的新聞、Threads 貼文（相關報導） */
  related?: RelatedPost[];
  post: {
    id: string;
    source: string;
    username: string | null;
    permalink: string | null;
    postedAt: number;
    text: string;
  };
}

export interface RelatedPost {
  id: string;
  source: string;
  title: string;
  url: string | null;
  postedAt: number;
}

export const DEFAULT_DURATION_SEC = 2 * 3600;
export const MAX_FUTURE_SEC = 14 * 86400;
const LOOKBACK_SEC = 24 * 3600;
export const MIN_CONFIDENCE = 0.5;
/** 固定據點沒寫最後一天時，從第一天起保留幾天 */
export const SPOT_DEFAULT_DAYS = 7;
const DAY_SEC = 86400;
const TAIPEI_OFFSET_SEC = 8 * 3600;
const DUP_WINDOW_SEC = 30 * 60;
const DUP_DEG = 0.0014; // 約 150 m
const RECHECK_INTERVAL_SEC = 600;
const RECHECK_BATCH = 20;

export const ENDED_WORDS = ['發完', '送完', '領完', '完售', '售完', '收攤', '撤收', '沒了', '沒有了', '已結束', '結束了', '結束囉', '活動結束', '提前結束'];
const ENDED_RE = new RegExp(ENDED_WORDS.join('|'));

/** 作者後續貼文或回覆是否宣告發完 */
export function detectEnded(text: string): boolean {
  return ENDED_RE.test(text);
}

export interface NewPost {
  id: string;
  username: string | null;
  text: string;
  permalink: string | null;
  posted_at: number;
  keyword: string | null;
  source: 'threads' | 'manual' | 'news' | 'official' | 'link' | 'spot';
}

/** 寫入貼文，回傳是否為新貼文 */
export async function storePost(env: Env, p: NewPost, now = nowSec()): Promise<boolean> {
  const r = await env.DB.prepare(
    'INSERT OR IGNORE INTO posts (id, username, text, permalink, posted_at, keyword, source, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(p.id, p.username, p.text, p.permalink, p.posted_at, p.keyword, p.source, now)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function getPost(env: Env, id: string): Promise<PostRow | null> {
  return env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<PostRow>();
}

export interface ProcessResult {
  /** 這則貼文建立的事件（一則貼文可以有多個地點或時段） */
  events: EventRow[];
  /** 每一筆的處理結果，例如 active、upcoming、no_place、duplicate_of_3 */
  reasons: string[];
}

/** 建立的事件裡有幾個找得到位置 */
export const locatedCount = (r: ProcessResult): number => r.events.filter((e) => e.status !== 'unlocated').length;

/** 台灣時間當天 00:00 的 unix 秒 */
export function taipeiDayStart(unix: number): number {
  return Math.floor((unix + TAIPEI_OFFSET_SEC) / DAY_SEC) * DAY_SEC - TAIPEI_OFFSET_SEC;
}

export interface Session {
  start: number;
  end: number;
  allDay: boolean;
}

/**
 * 固定據點展開成每天一個時段：從 start_at 那天到 until（沒寫就保留 SPOT_DEFAULT_DAYS 天），
 * 每天用第一天的開放時段；沒寫幾點（00:00 開始、沒有結束）就是整天。
 */
export function spotSessions(ex: Pick<ExtractedEvent, 'start_at' | 'end_at' | 'until'>, postedAt: number, now: number): Session[] {
  const start = parseIsoToUnix(ex.start_at) ?? taipeiDayStart(postedAt);
  const end = parseIsoToUnix(ex.end_at);
  const firstDay = taipeiDayStart(start);
  const open = start - firstDay;
  const allDay = open === 0 && end === null;
  let close = allDay ? DAY_SEC : end !== null ? end - taipeiDayStart(end) : open + DEFAULT_DURATION_SEC;
  if (close <= open) close = Math.min(DAY_SEC, open + DEFAULT_DURATION_SEC);

  // 最後一天：until，其次是模型把多天合成一段時 end_at 的那天，都沒有就預設天數
  // 固定據點是連續多天：最後一天不晚於第一天（模型把「10/16 起」寫成 until 10/16）就當作沒寫
  const untilRaw = ex.until ? parseIsoToUnix(`${ex.until}T00:00:00+08:00`) : null;
  const untilAt = untilRaw !== null && untilRaw > firstDay ? untilRaw : null;
  let lastDay = untilAt ?? (end !== null && taipeiDayStart(end) > firstDay ? taipeiDayStart(end) : firstDay + (SPOT_DEFAULT_DAYS - 1) * DAY_SEC);
  lastDay = Math.min(lastDay, firstDay + 13 * DAY_SEC, taipeiDayStart(now + MAX_FUTURE_SEC));

  const out: Session[] = [];
  for (let day = firstDay; day <= lastDay; day += DAY_SEC) {
    const s = { start: day + open, end: day + close, allDay };
    if (s.end > now) out.push(s);
  }
  return out;
}

async function createEvent(
  env: Env,
  post: PostRow,
  ex: ExtractedEvent,
  now: number,
  session?: Session,
): Promise<{ event: EventRow | null; reason: string }> {
  if (ex.confidence < MIN_CONFIDENCE) return { event: null, reason: 'low_confidence' };
  const start = session ? session.start : parseIsoToUnix(ex.start_at);
  if (start === null) return { event: null, reason: 'no_start_time' };
  let end = session ? session.end : (parseIsoToUnix(ex.end_at) ?? start + DEFAULT_DURATION_SEC);
  if (end <= start) end = start + DEFAULT_DURATION_SEC;
  if (end <= now) return { event: null, reason: 'already_over' };
  if (start > now + MAX_FUTURE_SEC) return { event: null, reason: 'too_far_in_future' };

  const placeQuery = ex.place_query ?? ex.place_text;
  const placeText = ex.place_text ?? ex.place_query;
  if (!placeQuery || !placeText) return { event: null, reason: 'no_place' };

  let point = await geocodeFirst(env, placeCandidates(placeQuery, ex.place_text));
  // 精確地點查不到時退到鄉鎮區中心，標成約略位置
  const area = point ? null : adminArea(placeQuery, ex.place_text);
  if (area) point = await geocode(env, area);
  const approxArea = area && point ? area : null;

  // 同一場可能被多篇貼文找到：同類型、同地點（約 150 m 內）、開始時間差 30 分鐘內就視為重複
  if (point && !approxArea) {
    const dup = await env.DB.prepare(
      `SELECT id FROM events WHERE status IN ('upcoming', 'active') AND kind = ?
         AND ABS(start_at - ?) <= ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? LIMIT 1`,
    )
      .bind(ex.kind, start, DUP_WINDOW_SEC, point.lat - DUP_DEG, point.lat + DUP_DEG, point.lng - DUP_DEG, point.lng + DUP_DEG)
      .first<{ id: number }>();
    if (dup) return { event: null, reason: `duplicate_of_${dup.id}` };
  }

  const status: EventStatus = !point ? 'unlocated' : start <= now ? 'active' : 'upcoming';
  const event = await env.DB.prepare(
    `INSERT INTO events (post_id, kind, title, item, start_at, end_at, place_text, place_query, lat, lng, status, confidence, all_day, spot, approx_area, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(
      post.id,
      ex.kind,
      ex.title,
      ex.item,
      start,
      end,
      placeText,
      placeQuery,
      point?.lat ?? null,
      point?.lng ?? null,
      status,
      ex.confidence,
      session?.allDay ? 1 : 0,
      session ? 1 : 0,
      approxArea,
      now,
      now,
    )
    .first<EventRow>();
  return { event, reason: status };
}

/** 對單一貼文跑 LLM 抽取，每個地點或時段各建一個事件 */
export async function processPost(env: Env, post: PostRow, now = nowSec()): Promise<ProcessResult> {
  const { extraction, raw, garbled } = await extractFromPost(env, post.text, post.posted_at, now);
  await env.DB.prepare('UPDATE posts SET processed_at = ?, extraction = ? WHERE id = ?').bind(now, raw, post.id).run();

  if (garbled) return { events: [], reasons: ['garbled'] };
  if (!extraction) return { events: [], reasons: ['extraction_failed'] };
  if (!extraction.is_event) return { events: [], reasons: ['not_event'] };
  if (extraction.events.length === 0) return { events: [], reasons: ['no_events'] };

  const out: ProcessResult = { events: [], reasons: [] };
  for (const ex of extraction.events) {
    if (!ex.spot) {
      const r = await createEvent(env, post, ex, now);
      if (r.event) out.events.push(r.event);
      out.reasons.push(r.reason);
      continue;
    }
    const sessions = spotSessions(ex, post.posted_at, now);
    if (sessions.length === 0) out.reasons.push('already_over');
    for (const session of sessions) {
      const r = await createEvent(env, post, ex, now, session);
      if (r.event) out.events.push(r.event);
      out.reasons.push(r.reason);
    }
  }
  return out;
}

export interface IngestResult {
  keyword: string;
  fetched: number;
  created: number;
  errors: string[];
}

export async function ingestKeyword(env: Env, client: ThreadsClient, kw: KeywordRow, now = nowSec()): Promise<IngestResult> {
  const since = kw.last_since ?? now - LOOKBACK_SEC;
  const posts = await client.keywordSearch({ q: kw.term, since, searchType: 'RECENT', limit: 100 });
  const result: IngestResult = { keyword: kw.term, fetched: posts.length, created: 0, errors: [] };
  let maxTs = since;

  for (const p of posts) {
    let postedAt = now;
    try {
      postedAt = parseThreadsTimestamp(p.timestamp);
    } catch {
      /* 時間壞掉就當作現在 */
    }
    maxTs = Math.max(maxTs, postedAt);
    const inserted = await storePost(
      env,
      { id: p.id, username: p.username ?? null, text: p.text, permalink: p.permalink ?? null, posted_at: postedAt, keyword: kw.term, source: 'threads' },
      now,
    );
    if (!inserted) continue;
    const row = await getPost(env, p.id);
    if (!row) continue;
    try {
      const r = await processPost(env, row, now);
      result.created += locatedCount(r);
    } catch (e) {
      result.errors.push(`${p.id}: ${String(e)}`);
    }
  }

  // 留 5 分鐘重疊避免漏掉邊界貼文，重複的貼文靠 INSERT OR IGNORE 擋掉
  await env.DB.prepare('UPDATE keywords SET last_since = ? WHERE id = ?').bind(Math.max(since, maxTs - 300), kw.id).run();
  return result;
}

export interface BacklogResult {
  processed: number;
  created: number;
  errors: string[];
}

/** 重新處理之前沒成功抽取的貼文（例如 Workers AI 暫時出錯），只看最近 24 小時發的或收到的 */
export async function processBacklog(env: Env, now = nowSec(), limit = 20): Promise<BacklogResult> {
  const rows = await env.DB.prepare('SELECT * FROM posts WHERE processed_at IS NULL AND (posted_at > ? OR fetched_at > ?) ORDER BY posted_at ASC LIMIT ?')
    .bind(now - LOOKBACK_SEC, now - LOOKBACK_SEC, limit)
    .all<PostRow>();
  const out: BacklogResult = { processed: 0, created: 0, errors: [] };
  for (const post of rows.results) {
    try {
      const r = await processPost(env, post, now);
      out.processed++;
      out.created += locatedCount(r);
    } catch (e) {
      out.errors.push(`${post.id}: ${String(e)}`);
    }
  }
  return out;
}

export async function ingestAll(env: Env, client: ThreadsClient, now = nowSec()): Promise<IngestResult[]> {
  const out: IngestResult[] = [];
  for (const kw of await listActiveKeywords(env, now)) {
    try {
      out.push(await ingestKeyword(env, client, kw, now));
    } catch (e) {
      out.push({ keyword: kw.term, fetched: 0, created: 0, errors: [String(e)] });
    }
  }
  return out;
}

export interface LifecycleResult {
  promoted: number;
  expired: number;
  checked: number;
  endedByAuthor: number;
}

interface RecheckRow {
  id: number;
  post_id: string;
  username: string | null;
  keyword: string | null;
  posted_at: number;
  source: string;
}

/** 推進事件狀態：到時間就 active、過期就 ended、作者說發完也 ended */
export async function updateLifecycle(env: Env, client: ThreadsClient, now = nowSec()): Promise<LifecycleResult> {
  const promoted = await env.DB.prepare("UPDATE events SET status = 'active', updated_at = ? WHERE status = 'upcoming' AND start_at <= ?")
    .bind(now, now)
    .run();
  const expired = await env.DB.prepare(
    "UPDATE events SET status = 'ended', ended_reason = 'expired', updated_at = ? WHERE status IN ('upcoming', 'active', 'unlocated') AND end_at <= ?",
  )
    .bind(now, now)
    .run();

  const rows = await env.DB.prepare(
    `SELECT e.id, e.post_id, p.username, p.keyword, p.posted_at, p.source
     FROM events e JOIN posts p ON p.id = e.post_id
     WHERE e.status = 'active' AND (e.last_checked_at IS NULL OR e.last_checked_at <= ?)
     ORDER BY e.last_checked_at ASC LIMIT ?`,
  )
    .bind(now - RECHECK_INTERVAL_SEC, RECHECK_BATCH)
    .all<RecheckRow>();

  let endedByAuthor = 0;
  for (const r of rows.results) {
    const texts: string[] = [];
    if (r.source === 'threads') {
      try {
        const reps = await client.replies(r.post_id);
        texts.push(...reps.filter((x) => !r.username || x.username === r.username).map((x) => x.text));
      } catch (e) {
        console.warn(`replies failed for ${r.post_id}: ${String(e)}`);
      }
      if (r.username && r.keyword) {
        try {
          const follow = await client.keywordSearch({ q: r.keyword, authorUsername: r.username, since: r.posted_at + 1, searchType: 'RECENT', limit: 10 });
          texts.push(...follow.map((x) => x.text));
        } catch (e) {
          console.warn(`follow-up search failed for ${r.post_id}: ${String(e)}`);
        }
      }
    }
    if (texts.some(detectEnded)) {
      await env.DB.prepare("UPDATE events SET status = 'ended', ended_reason = 'author', last_checked_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, r.id)
        .run();
      endedByAuthor++;
    } else {
      await env.DB.prepare('UPDATE events SET last_checked_at = ?, updated_at = ? WHERE id = ?').bind(now, now, r.id).run();
    }
  }

  return { promoted: promoted.meta.changes ?? 0, expired: expired.meta.changes ?? 0, checked: rows.results.length, endedByAuthor };
}

export interface ListQuery {
  lat?: number;
  lng?: number;
  radiusKm: number;
  now: number;
  horizonSec: number;
  /** 只回傳這些關鍵字的事件；貼文是用該關鍵字搜到的，或內文含有該關鍵字 */
  keywords?: string[];
}

type JoinedRow = EventRow & { username: string | null; permalink: string | null; text: string; posted_at: number; keyword: string | null; source: string; ended_reports: number | null };

const JOINED_SELECT = `SELECT e.*, p.username, p.permalink, p.text, p.posted_at, p.keyword, p.source,
    (SELECT COUNT(*) FROM ended_reports r WHERE r.event_id = e.id) AS ended_reports
  FROM events e JOIN posts p ON p.id = e.post_id`;

export function toEventOut(r: JoinedRow, now: number): EventOut {
  return {
    id: r.id,
    kind: r.kind ?? 'giveaway',
    title: r.title,
    item: r.item,
    startAt: r.start_at,
    endAt: r.end_at,
    placeText: r.place_text,
    lat: r.lat as number,
    lng: r.lng as number,
    status: r.start_at <= now ? 'active' : 'upcoming',
    confidence: r.confidence,
    keyword: r.keyword,
    allDay: r.all_day === 1,
    endedReports: r.ended_reports ?? 0,
    spot: r.spot === 1,
    approxArea: r.approx_area ?? null,
    post: { id: r.post_id, source: r.source, username: r.username, permalink: r.permalink, postedAt: r.posted_at, text: r.text },
  };
}

/** 前端用：附近、還沒結束、horizon 內會開始的事件 */
export async function listEvents(env: Env, q: ListQuery): Promise<EventOut[]> {
  // 併進官方車掃的不單獨列，改放在官方那一場的相關報導
  const conds = ["e.status IN ('upcoming', 'active')", 'e.end_at > ?', 'e.start_at <= ?', 'e.lat IS NOT NULL', 'e.lng IS NOT NULL', 'e.merged_into IS NULL'];
  const binds: unknown[] = [q.now, q.now + q.horizonSec];
  if (q.lat !== undefined && q.lng !== undefined) {
    const dLat = q.radiusKm / 111;
    const dLng = q.radiusKm / (111 * Math.max(0.2, Math.cos((q.lat * Math.PI) / 180)));
    conds.push('e.lat BETWEEN ? AND ?', 'e.lng BETWEEN ? AND ?');
    binds.push(q.lat - dLat, q.lat + dLat, q.lng - dLng, q.lng + dLng);
  }
  if (q.keywords && q.keywords.length > 0) {
    // 使用者主動回報的貼文、審核通過的固定據點不一定有寫關鍵字，一律顯示
    const ors: string[] = ["p.source IN ('link', 'spot')"];
    for (const k of q.keywords) {
      ors.push('p.keyword = ?', "p.text LIKE ? ESCAPE '\\'");
      binds.push(k, `%${k.replace(/[\\%_]/g, '\\$&')}%`);
    }
    conds.push(`(${ors.join(' OR ')})`);
  }
  const sql = `${JOINED_SELECT}
    WHERE ${conds.join(' AND ')}
    ORDER BY e.start_at ASC LIMIT 200`;
  const r = await env.DB.prepare(sql)
    .bind(...binds)
    .all<JoinedRow>();
  const out = r.results.map((row) => toEventOut(row, q.now));
  const official = [...new Set(out.filter((e) => e.post.source === 'official').map((e) => e.post.id))];
  if (official.length > 0) {
    const related = await relatedPosts(env, official);
    for (const e of out) if (related.has(e.post.id)) e.related = related.get(e.post.id);
  }
  return out;
}

/** 併進各官方貼文的新聞、Threads 貼文，同一則貼文只列一次 */
async function relatedPosts(env: Env, officialIds: string[]): Promise<Map<string, RelatedPost[]>> {
  const r = await env.DB.prepare(
    `SELECT DISTINCT e.merged_into, p.id, p.source, p.username, p.permalink, p.text, p.posted_at
       FROM events e JOIN posts p ON p.id = e.post_id
      WHERE e.merged_into IN (${officialIds.map(() => '?').join(',')})
      ORDER BY p.posted_at DESC`,
  )
    .bind(...officialIds)
    .all<{ merged_into: string; id: string; source: string; username: string | null; permalink: string | null; text: string; posted_at: number }>();
  const map = new Map<string, RelatedPost[]>();
  for (const row of r.results) {
    const list = map.get(row.merged_into) ?? [];
    if (list.some((x) => x.id === row.id)) continue;
    // 新聞用標題（第一行），貼文用作者加開頭幾個字
    const first = row.text.split('\n')[0].trim();
    const title = row.source === 'news' ? first : `@${row.username ?? ''}：${first.slice(0, 40)}`;
    list.push({ id: row.id, source: row.source, title, url: row.permalink, postedAt: row.posted_at });
    map.set(row.merged_into, list);
  }
  return map;
}

export async function getEvent(env: Env, id: number, now: number): Promise<EventOut | null> {
  const row = await env.DB.prepare(`${JOINED_SELECT} WHERE e.id = ? AND e.lat IS NOT NULL`)
    .bind(id)
    .first<JoinedRow>();
  return row ? toEventOut(row, now) : null;
}
