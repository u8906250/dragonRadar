import type { Env } from './env';
import { extractFromPost } from './extract';
import { geocode } from './geocode';
import { parseThreadsTimestamp, type ThreadsClient } from './threads';
import { nowSec, parseIsoToUnix } from './util';

export type EventStatus = 'upcoming' | 'active' | 'ended' | 'unlocated';

export interface KeywordRow {
  id: number;
  term: string;
  enabled: number;
  last_since: number | null;
  created_at: number;
}

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
  last_checked_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface EventOut {
  id: number;
  title: string;
  item: string | null;
  startAt: number;
  endAt: number;
  placeText: string;
  lat: number;
  lng: number;
  status: 'upcoming' | 'active';
  confidence: number | null;
  post: {
    id: string;
    username: string | null;
    permalink: string | null;
    postedAt: number;
    text: string;
  };
}

const DEFAULT_DURATION_SEC = 2 * 3600;
const MAX_FUTURE_SEC = 14 * 86400;
const LOOKBACK_SEC = 24 * 3600;
const MIN_CONFIDENCE = 0.5;
const RECHECK_INTERVAL_SEC = 600;
const RECHECK_BATCH = 20;

const ENDED_RE = /發完|送完|領完|完售|售完|收攤|撤收|沒了|沒有了|已結束|結束了|結束囉|活動結束|提前結束/;

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
  source: 'threads' | 'manual';
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
  event: EventRow | null;
  reason: string;
}

/** 對單一貼文跑 LLM 抽取與地點查詢，成功就建立事件 */
export async function processPost(env: Env, post: PostRow, now = nowSec()): Promise<ProcessResult> {
  const { extraction, raw } = await extractFromPost(env, post.text, post.posted_at, now);
  await env.DB.prepare('UPDATE posts SET processed_at = ?, extraction = ? WHERE id = ?').bind(now, raw, post.id).run();

  if (!extraction) return { event: null, reason: 'extraction_failed' };
  if (!extraction.is_giveaway) return { event: null, reason: 'not_giveaway' };
  if (extraction.confidence < MIN_CONFIDENCE) return { event: null, reason: 'low_confidence' };

  const start = parseIsoToUnix(extraction.start_at);
  if (start === null) return { event: null, reason: 'no_start_time' };
  let end = parseIsoToUnix(extraction.end_at) ?? start + DEFAULT_DURATION_SEC;
  if (end <= start) end = start + DEFAULT_DURATION_SEC;
  if (end <= now) return { event: null, reason: 'already_over' };
  if (start > now + MAX_FUTURE_SEC) return { event: null, reason: 'too_far_in_future' };

  const placeQuery = extraction.place_query ?? extraction.place_text;
  const placeText = extraction.place_text ?? extraction.place_query;
  if (!placeQuery || !placeText) return { event: null, reason: 'no_place' };

  let point = await geocode(env, placeQuery);
  if (!point && extraction.place_text && extraction.place_text !== placeQuery) {
    point = await geocode(env, extraction.place_text);
  }

  const status: EventStatus = !point ? 'unlocated' : start <= now ? 'active' : 'upcoming';
  const event = await env.DB.prepare(
    `INSERT INTO events (post_id, title, item, start_at, end_at, place_text, place_query, lat, lng, status, confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(
      post.id,
      extraction.title,
      extraction.item,
      start,
      end,
      placeText,
      placeQuery,
      point?.lat ?? null,
      point?.lng ?? null,
      status,
      extraction.confidence,
      now,
      now,
    )
    .first<EventRow>();
  return { event, reason: status };
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
      if (r.event && r.event.status !== 'unlocated') result.created++;
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

/** 重新處理之前沒成功抽取的貼文（例如 Workers AI 暫時出錯），只看最近 24 小時 */
export async function processBacklog(env: Env, now = nowSec(), limit = 20): Promise<BacklogResult> {
  const rows = await env.DB.prepare('SELECT * FROM posts WHERE processed_at IS NULL AND posted_at > ? ORDER BY posted_at ASC LIMIT ?')
    .bind(now - LOOKBACK_SEC, limit)
    .all<PostRow>();
  const out: BacklogResult = { processed: 0, created: 0, errors: [] };
  for (const post of rows.results) {
    try {
      const r = await processPost(env, post, now);
      out.processed++;
      if (r.event && r.event.status !== 'unlocated') out.created++;
    } catch (e) {
      out.errors.push(`${post.id}: ${String(e)}`);
    }
  }
  return out;
}

export async function listKeywords(env: Env, onlyEnabled = false): Promise<KeywordRow[]> {
  const sql = onlyEnabled ? 'SELECT * FROM keywords WHERE enabled = 1 ORDER BY id' : 'SELECT * FROM keywords ORDER BY id';
  const r = await env.DB.prepare(sql).all<KeywordRow>();
  return r.results;
}

export async function ingestAll(env: Env, client: ThreadsClient, now = nowSec()): Promise<IngestResult[]> {
  const out: IngestResult[] = [];
  for (const kw of await listKeywords(env, true)) {
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
}

type JoinedRow = EventRow & { username: string | null; permalink: string | null; text: string; posted_at: number };

export function toEventOut(r: JoinedRow, now: number): EventOut {
  return {
    id: r.id,
    title: r.title,
    item: r.item,
    startAt: r.start_at,
    endAt: r.end_at,
    placeText: r.place_text,
    lat: r.lat as number,
    lng: r.lng as number,
    status: r.start_at <= now ? 'active' : 'upcoming',
    confidence: r.confidence,
    post: { id: r.post_id, username: r.username, permalink: r.permalink, postedAt: r.posted_at, text: r.text },
  };
}

/** 前端用：附近、還沒結束、horizon 內會開始的事件 */
export async function listEvents(env: Env, q: ListQuery): Promise<EventOut[]> {
  const conds = ["e.status IN ('upcoming', 'active')", 'e.end_at > ?', 'e.start_at <= ?', 'e.lat IS NOT NULL', 'e.lng IS NOT NULL'];
  const binds: unknown[] = [q.now, q.now + q.horizonSec];
  if (q.lat !== undefined && q.lng !== undefined) {
    const dLat = q.radiusKm / 111;
    const dLng = q.radiusKm / (111 * Math.max(0.2, Math.cos((q.lat * Math.PI) / 180)));
    conds.push('e.lat BETWEEN ? AND ?', 'e.lng BETWEEN ? AND ?');
    binds.push(q.lat - dLat, q.lat + dLat, q.lng - dLng, q.lng + dLng);
  }
  const sql = `SELECT e.*, p.username, p.permalink, p.text, p.posted_at
    FROM events e JOIN posts p ON p.id = e.post_id
    WHERE ${conds.join(' AND ')}
    ORDER BY e.start_at ASC LIMIT 200`;
  const r = await env.DB.prepare(sql)
    .bind(...binds)
    .all<JoinedRow>();
  return r.results.map((row) => toEventOut(row, q.now));
}

export async function getEvent(env: Env, id: number, now: number): Promise<EventOut | null> {
  const row = await env.DB.prepare(
    'SELECT e.*, p.username, p.permalink, p.text, p.posted_at FROM events e JOIN posts p ON p.id = e.post_id WHERE e.id = ? AND e.lat IS NOT NULL',
  )
    .bind(id)
    .first<JoinedRow>();
  return row ? toEventOut(row, now) : null;
}
