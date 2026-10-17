/**
 * 使用者回報：貼上 Threads 貼文連結、回報已發完。
 * 不需要登入，用加鹽的 IP 雜湊限制頻率。
 */
import type { Env } from './env';
import { detectEnded, getEvent, getPost, processPost, storePost, type EventOut } from './events';
import { fetchThreadsPost, resolveThreadsLink, shortcodeToUnix } from './sources/link';
import { sha1Hex } from './sources/text';

/** 只收這麼新的貼文，太舊的公告通常已經過期 */
export const MAX_LINK_AGE_SEC = 7 * 86400;
const SUBMIT_PER_IP_PER_HOUR = 10;
/** 全站每小時上限，避免被灌爆 Workers AI 用量 */
const SUBMIT_GLOBAL_PER_HOUR = 200;
const ENDED_PER_IP_PER_HOUR = 20;
/** 幾個不同的人回報已發完，事件才提早下架 */
export const ENDED_REPORTS_NEEDED = 2;
const RECHECK_LINK_SEC = 30 * 60;
const RECHECK_LINK_BATCH = 10;

export class ReportError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function ipHash(env: Env, req: Request): Promise<string> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  return sha1Hex(`${ip}|${env.ADMIN_TOKEN ?? 'current-radar'}`);
}

export type LinkOutcome =
  /** 已在雷達上 */
  | 'added'
  /** 跟已經在雷達上的事件重複 */
  | 'duplicate'
  /** 判讀成發放或活動，但找不到地點 */
  | 'no_place'
  /** 判讀成發放或活動，但缺時間、已結束或太遠 */
  | 'not_listed'
  /** 不是發放或活動 */
  | 'not_event'
  | 'failed';

export interface SubmitResult {
  /** 這則貼文之前已經有人回報過 */
  existed: boolean;
  outcome: LinkOutcome;
  reasons: string[];
  events: EventOut[];
  permalink: string;
}

function summarize(reasons: string[]): LinkOutcome {
  if (reasons.some((r) => r === 'active' || r === 'upcoming')) return 'added';
  if (reasons.some((r) => r.startsWith('duplicate_of_'))) return 'duplicate';
  if (reasons.some((r) => r === 'unlocated' || r === 'no_place')) return 'no_place';
  if (reasons.some((r) => r === 'not_event' || r === 'no_events')) return 'not_event';
  if (reasons.some((r) => r === 'garbled' || r === 'extraction_failed')) return 'failed';
  return 'not_listed';
}

async function eventsForResult(env: Env, postId: string, reasons: string[], now: number): Promise<EventOut[]> {
  const ids = new Set<number>();
  const own = await env.DB.prepare("SELECT id FROM events WHERE post_id = ? AND status IN ('upcoming', 'active')").bind(postId).all<{ id: number }>();
  for (const r of own.results) ids.add(r.id);
  for (const r of reasons) {
    const m = /^duplicate_of_(\d+)$/.exec(r);
    if (m) ids.add(Number(m[1]));
  }
  const out: EventOut[] = [];
  for (const id of ids) {
    const ev = await getEvent(env, id, now);
    if (ev && ev.endAt > now) out.push(ev);
  }
  return out.sort((a, b) => a.startAt - b.startAt);
}

async function countSince(env: Env, sql: string, binds: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;
}

/** 處理使用者貼上的連結：讀貼文、AI 判讀、定位，回傳結果 */
export async function submitLink(env: Env, input: string, ip: string, now: number): Promise<SubmitResult> {
  const link = await resolveThreadsLink(input);
  if (!link) throw new ReportError(400, '找不到 Threads 貼文連結，請貼上像 https://www.threads.com/@帳號/post/... 的網址');
  const postId = `link-${link.code}`;

  const existing = await getPost(env, postId);
  if (existing) {
    const last = await env.DB.prepare('SELECT result FROM submissions WHERE post_id = ? AND result IS NOT NULL ORDER BY id DESC LIMIT 1')
      .bind(postId)
      .first<{ result: string }>();
    const reasons = last ? (JSON.parse(last.result) as string[]) : [];
    const events = await eventsForResult(env, postId, reasons, now);
    // 原本的事件已經下架或過期，就不要再說「已在雷達上」
    const outcome = summarize(reasons);
    return { existed: true, outcome: events.length === 0 && (outcome === 'added' || outcome === 'duplicate') ? 'not_listed' : outcome, reasons, events, permalink: existing.permalink ?? '' };
  }

  const postedAt = shortcodeToUnix(link.code, now);
  if (postedAt === null) throw new ReportError(400, '這個連結看起來不是 Threads 貼文');
  if (now - postedAt > MAX_LINK_AGE_SEC) throw new ReportError(400, `這則貼文發布超過 ${MAX_LINK_AGE_SEC / 86400} 天，雷達只收最近的發放和活動`);

  const mine = await countSince(env, 'SELECT COUNT(*) AS n FROM submissions WHERE ip_hash = ? AND created_at > ?', [ip, now - 3600]);
  if (mine >= SUBMIT_PER_IP_PER_HOUR) throw new ReportError(429, '回報太頻繁了，請過一陣子再試');
  const all = await countSince(env, 'SELECT COUNT(*) AS n FROM submissions WHERE created_at > ?', [now - 3600]);
  if (all >= SUBMIT_GLOBAL_PER_HOUR) throw new ReportError(429, '目前回報的人太多，請稍後再試');

  const fetched = await fetchThreadsPost(link.code);
  if (fetched.status === 'gone') throw new ReportError(404, '找不到這則貼文，可能已刪除或不是公開貼文');
  if (fetched.status === 'no_text') throw new ReportError(422, '這則貼文沒有文字，雷達只能判讀有寫時間地點的文字');
  if (fetched.status === 'error') {
    console.warn(`embed fetch failed for ${link.code}: ${fetched.message}`);
    throw new ReportError(502, '暫時讀不到這則貼文，請稍後再試');
  }

  const username = fetched.username ?? link.username;
  const permalink = username ? `https://www.threads.com/@${username}/post/${link.code}` : `https://www.threads.com/t/${link.code}`;
  await storePost(env, { id: postId, username, text: fetched.text, permalink, posted_at: postedAt, keyword: null, source: 'link' }, now);
  await env.DB.prepare('UPDATE posts SET checked_at = ? WHERE id = ?').bind(now, postId).run();
  const sub = await env.DB.prepare('INSERT INTO submissions (post_id, ip_hash, created_at) VALUES (?, ?, ?) RETURNING id')
    .bind(postId, ip, now)
    .first<{ id: number }>();

  const post = await getPost(env, postId);
  if (!post) throw new ReportError(500, 'post not stored');
  let result;
  try {
    result = await processPost(env, post, now);
  } catch (e) {
    // Workers AI 暫時出錯：貼文已存，排程會再判讀一次
    console.warn(`process failed for ${postId}: ${String(e)}`);
    return { existed: false, outcome: 'failed', reasons: ['extraction_failed'], events: [], permalink };
  }
  if (sub) await env.DB.prepare('UPDATE submissions SET result = ? WHERE id = ?').bind(JSON.stringify(result.reasons), sub.id).run();
  return { existed: false, outcome: summarize(result.reasons), reasons: result.reasons, events: await eventsForResult(env, postId, result.reasons, now), permalink };
}

export interface EndedReportResult {
  count: number;
  needed: number;
  ended: boolean;
}

/** 回報已發完／已結束，不同的人回報到門檻就下架 */
export async function reportEnded(env: Env, eventId: number, ip: string, now: number): Promise<EndedReportResult> {
  const ev = await env.DB.prepare(
    "SELECT e.id, e.status, e.start_at, p.source FROM events e JOIN posts p ON p.id = e.post_id WHERE e.id = ? AND e.status IN ('upcoming', 'active')",
  )
    .bind(eventId)
    .first<{ id: number; status: string; start_at: number; source: string }>();
  if (!ev) throw new ReportError(404, '這個發放或活動已經下架了');
  if (ev.source === 'official') throw new ReportError(400, '官方行程不開放回報，以官網公布為準');
  if (ev.start_at > now) throw new ReportError(400, '還沒開始，等開始後再回報');

  const mine = await countSince(env, 'SELECT COUNT(*) AS n FROM ended_reports WHERE ip_hash = ? AND created_at > ?', [ip, now - 3600]);
  if (mine >= ENDED_PER_IP_PER_HOUR) throw new ReportError(429, '回報太頻繁了，請過一陣子再試');

  await env.DB.prepare('INSERT OR IGNORE INTO ended_reports (event_id, ip_hash, created_at) VALUES (?, ?, ?)').bind(eventId, ip, now).run();
  const count = await countSince(env, 'SELECT COUNT(*) AS n FROM ended_reports WHERE event_id = ?', [eventId]);
  const ended = count >= ENDED_REPORTS_NEEDED;
  if (ended) {
    await env.DB.prepare("UPDATE events SET status = 'ended', ended_reason = 'reported', updated_at = ? WHERE id = ?").bind(now, eventId).run();
  }
  return { count, needed: ENDED_REPORTS_NEEDED, ended };
}

export interface RecheckLinksResult {
  checked: number;
  deleted: number;
  ended: number;
  edited: number;
}

/** 定時重讀使用者回報的貼文：刪文就下架、改成「發完了」就結束、內容改了就重新判讀 */
export async function recheckLinks(env: Env, now: number): Promise<RecheckLinksResult> {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT p.id, p.text FROM posts p JOIN events e ON e.post_id = p.id
     WHERE p.source = 'link' AND e.status IN ('upcoming', 'active') AND (p.checked_at IS NULL OR p.checked_at <= ?)
     ORDER BY p.checked_at ASC LIMIT ?`,
  )
    .bind(now - RECHECK_LINK_SEC, RECHECK_LINK_BATCH)
    .all<{ id: string; text: string }>();
  const out: RecheckLinksResult = { checked: 0, deleted: 0, ended: 0, edited: 0 };
  const endAll = (postId: string, reason: string) =>
    env.DB.prepare("UPDATE events SET status = 'ended', ended_reason = ?, updated_at = ? WHERE post_id = ? AND status IN ('upcoming', 'active', 'unlocated')")
      .bind(reason, now, postId)
      .run();

  for (const row of rows.results) {
    out.checked++;
    const r = await fetchThreadsPost(row.id.replace(/^link-/, ''));
    await env.DB.prepare('UPDATE posts SET checked_at = ? WHERE id = ?').bind(now, row.id).run();
    if (r.status === 'gone') {
      await endAll(row.id, 'deleted');
      out.deleted++;
    } else if (r.status === 'ok' && r.text !== row.text) {
      if (detectEnded(r.text)) {
        await endAll(row.id, 'author');
        out.ended++;
        continue;
      }
      // 作者改了時間或地點：舊的事件刪掉，用新內容重新判讀
      out.edited++;
      await env.DB.batch([
        env.DB.prepare("DELETE FROM ended_reports WHERE event_id IN (SELECT id FROM events WHERE post_id = ? AND status IN ('upcoming', 'active', 'unlocated'))").bind(row.id),
        env.DB.prepare("DELETE FROM events WHERE post_id = ? AND status IN ('upcoming', 'active', 'unlocated')").bind(row.id),
        env.DB.prepare('UPDATE posts SET text = ? WHERE id = ?').bind(r.text, row.id),
      ]);
      const post = await getPost(env, row.id);
      if (post) {
        try {
          await processPost(env, post, now);
        } catch (e) {
          console.warn(`reprocess failed for ${row.id}: ${String(e)}`);
        }
      }
    }
  }
  return out;
}

/** 隱私權政策承諾：回報紀錄（IP 雜湊）最多留 30 天 */
export async function purgeReports(env: Env, cutoff: number): Promise<number> {
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM submissions WHERE created_at < ?').bind(cutoff),
    env.DB.prepare('DELETE FROM ended_reports WHERE created_at < ?').bind(cutoff),
  ]);
  return r.reduce((n, x) => n + (x.meta.changes ?? 0), 0);
}
