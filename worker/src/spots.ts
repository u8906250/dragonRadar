/**
 * 回報固定據點：店家、服務處這種連續好幾天都能去的地方。
 * 貼文常常沒寫地址或時間（例如「10/16 起到店索取，送完為止」），AI 判讀容易漏掉，
 * 所以請回報的人補上地點，先進審核佇列，管理者確認後才放上雷達。
 */
import type { Env } from './env';
import { getEvent, MAX_FUTURE_SEC, spotSessions, storePost, type EventOut } from './events';
import type { EventKind } from './extract';
import { geocode } from './geocode';
import { ReportError } from './reports';
import { fetchThreadsPost, resolveThreadsLink, shortcodeToUnix } from './sources/link';

/** 據點貼文常常是好幾天前發的，比一般回報放寬 */
export const SPOT_MAX_AGE_SEC = 30 * 86400;
const PER_IP_PER_HOUR = 5;
const GLOBAL_PER_HOUR = 60;
const MAX_PLACE = 100;
const MAX_HOURS = 100;
const MAX_NOTE = 300;

export type SpotStatus = 'pending' | 'approved' | 'rejected';

export interface SpotRequestRow {
  id: number;
  key: string;
  code: string;
  permalink: string | null;
  username: string | null;
  text: string;
  posted_at: number;
  place: string;
  hours: string | null;
  note: string | null;
  ip_hash: string | null;
  status: SpotStatus;
  reason: string | null;
  created_at: number;
  reviewed_at: number | null;
}

/** 給回報的人看的進度，不含別人填的內容 */
export interface SpotRequestStatus {
  key: string;
  status: SpotStatus;
  /** 不通過的原因 */
  reason: string | null;
  place: string;
  permalink: string | null;
  createdAt: number;
  reviewedAt: number | null;
  /** 這則貼文之前已經有人回報過 */
  existed: boolean;
}

const statusOf = (r: SpotRequestRow, existed = false): SpotRequestStatus => ({
  key: r.key,
  status: r.status,
  reason: r.status === 'rejected' ? r.reason : null,
  place: r.place,
  permalink: r.permalink,
  createdAt: r.created_at,
  reviewedAt: r.reviewed_at,
  existed,
});

const clean = (s: unknown, max: number): string | null => {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

async function countSince(env: Env, sql: string, binds: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;
}

export async function submitSpotRequest(env: Env, body: { url?: unknown; place?: unknown; hours?: unknown; note?: unknown }, ip: string, now: number): Promise<SpotRequestStatus> {
  const link = typeof body.url === 'string' && body.url.length <= 2000 ? await resolveThreadsLink(body.url) : null;
  if (!link) throw new ReportError(400, '找不到 Threads 貼文連結，請貼上像 https://www.threads.com/@帳號/post/... 的網址');
  const place = clean(body.place, MAX_PLACE);
  if (!place || place.length < 2) throw new ReportError(400, '請填地點：店名加地址，或路口、地標');

  // 同一則貼文已經在審核或已經通過，就不再收一次
  const same = await env.DB.prepare("SELECT * FROM spot_requests WHERE code = ? AND status IN ('pending', 'approved') ORDER BY id DESC LIMIT 1")
    .bind(link.code)
    .first<SpotRequestRow>();
  if (same) return statusOf(same, true);

  const postedAt = shortcodeToUnix(link.code, now);
  if (postedAt === null) throw new ReportError(400, '這個連結看起來不是 Threads 貼文');
  if (now - postedAt > SPOT_MAX_AGE_SEC) throw new ReportError(400, `這則貼文發布超過 ${SPOT_MAX_AGE_SEC / 86400} 天，請找最近的公告`);

  const mine = await countSince(env, 'SELECT COUNT(*) AS n FROM spot_requests WHERE ip_hash = ? AND created_at > ?', [ip, now - 3600]);
  if (mine >= PER_IP_PER_HOUR) throw new ReportError(429, '回報太頻繁了，請過一陣子再試');
  const all = await countSince(env, 'SELECT COUNT(*) AS n FROM spot_requests WHERE created_at > ?', [now - 3600]);
  if (all >= GLOBAL_PER_HOUR) throw new ReportError(429, '目前回報的人太多，請稍後再試');

  const fetched = await fetchThreadsPost(link.code);
  if (fetched.status === 'gone') throw new ReportError(404, '找不到這則貼文，可能已刪除或不是公開貼文');
  if (fetched.status === 'no_text') throw new ReportError(422, '這則貼文沒有文字，請找有寫發放內容的貼文');
  if (fetched.status === 'error') {
    console.warn(`embed fetch failed for ${link.code}: ${fetched.message}`);
    throw new ReportError(502, '暫時讀不到這則貼文，請稍後再試');
  }
  const username = fetched.username ?? link.username;
  const permalink = username ? `https://www.threads.com/@${username}/post/${link.code}` : `https://www.threads.com/t/${link.code}`;
  const row = await env.DB.prepare(
    `INSERT INTO spot_requests (key, code, permalink, username, text, posted_at, place, hours, note, ip_hash, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?) RETURNING *`,
  )
    .bind(crypto.randomUUID(), link.code, permalink, username, fetched.text, postedAt, place, clean(body.hours, MAX_HOURS), clean(body.note, MAX_NOTE), ip, now)
    .first<SpotRequestRow>();
  if (!row) throw new ReportError(500, '存檔失敗，請稍後再試');
  return statusOf(row);
}

export async function spotRequestStatus(env: Env, keys: string[]): Promise<SpotRequestStatus[]> {
  const ok = keys.filter((k) => /^[0-9a-f-]{36}$/.test(k)).slice(0, 20);
  if (ok.length === 0) return [];
  const r = await env.DB.prepare(`SELECT * FROM spot_requests WHERE key IN (${ok.map(() => '?').join(',')}) ORDER BY id DESC`)
    .bind(...ok)
    .all<SpotRequestRow>();
  return r.results.map((x) => statusOf(x));
}

// ---- 管理者審核 ----

export async function listSpotRequests(env: Env, status: string | null): Promise<Array<Omit<SpotRequestRow, 'ip_hash'>>> {
  const r = status
    ? await env.DB.prepare('SELECT * FROM spot_requests WHERE status = ? ORDER BY id DESC LIMIT 100').bind(status).all<SpotRequestRow>()
    : await env.DB.prepare('SELECT * FROM spot_requests ORDER BY id DESC LIMIT 100').all<SpotRequestRow>();
  return r.results.map(({ ip_hash: _ip, ...rest }) => rest);
}

export interface ApproveBody {
  kind?: EventKind;
  /** 卡片標題，例如「洋流飄帶發放・鳥咖啡」 */
  title?: string;
  /** 發什麼，例如「短版洋流飄帶」 */
  item?: string | null;
  /** 顯示的地點文字 */
  place_text?: string;
  /** 拿去查地圖的字串；有給 lat、lng 就不查 */
  place_query?: string;
  lat?: number;
  lng?: number;
  /** 第一天 YYYY-MM-DD，沒給就是發文那天 */
  from?: string;
  /** 最後一天 YYYY-MM-DD，沒給就保留預設天數 */
  until?: string | null;
  /** 每天開放時間 HH:MM，都沒給就是整天 */
  open?: string | null;
  close?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** 通過：建一則 source = 'spot' 的貼文，展開成每天一筆固定據點；重複通過就是修改（舊的未結束事件先刪掉） */
export async function approveSpotRequest(env: Env, id: number, b: ApproveBody, now: number): Promise<{ request: SpotRequestStatus; events: EventOut[] }> {
  const req = await env.DB.prepare('SELECT * FROM spot_requests WHERE id = ?').bind(id).first<SpotRequestRow>();
  if (!req) throw new ReportError(404, 'request not found');
  const title = clean(b.title, 60);
  if (!title) throw new ReportError(400, 'title is required');
  const placeText = clean(b.place_text, MAX_PLACE) ?? req.place;
  if (b.from && !DATE_RE.test(b.from)) throw new ReportError(400, 'from must be YYYY-MM-DD');
  if (b.until && !DATE_RE.test(b.until)) throw new ReportError(400, 'until must be YYYY-MM-DD');
  if ((b.open && !TIME_RE.test(b.open)) || (b.close && !TIME_RE.test(b.close))) throw new ReportError(400, 'open/close must be HH:MM');

  let point: { lat: number; lng: number } | null = null;
  if (Number.isFinite(b.lat) && Number.isFinite(b.lng)) point = { lat: Number(b.lat), lng: Number(b.lng) };
  else point = await geocode(env, clean(b.place_query, MAX_PLACE) ?? placeText);
  if (!point) throw new ReportError(400, '查不到這個地點，請直接給 lat、lng');

  const from = b.from ?? new Date((req.posted_at + 8 * 3600) * 1000).toISOString().slice(0, 10);
  const sessions = spotSessions(
    { start_at: `${from}T${b.open ?? '00:00'}:00+08:00`, end_at: b.close ? `${from}T${b.close}:00+08:00` : null, until: b.until ?? null },
    req.posted_at,
    now,
  ).filter((s) => s.start <= now + MAX_FUTURE_SEC);
  if (sessions.length === 0) throw new ReportError(400, '這段期間已經結束了');

  const postId = `spot-${req.code}`;
  await storePost(env, { id: postId, username: req.username, text: req.text, permalink: req.permalink, posted_at: req.posted_at, keyword: null, source: 'spot' }, now);
  // 不交給 AI 判讀，內容以審核時填的為準
  await env.DB.batch([
    env.DB.prepare('UPDATE posts SET processed_at = ?, checked_at = ? WHERE id = ?').bind(now, now, postId),
    env.DB.prepare("DELETE FROM ended_reports WHERE event_id IN (SELECT id FROM events WHERE post_id = ? AND status IN ('upcoming', 'active', 'unlocated'))").bind(postId),
    env.DB.prepare("DELETE FROM events WHERE post_id = ? AND status IN ('upcoming', 'active', 'unlocated')").bind(postId),
  ]);
  const kind: EventKind = b.kind === 'activity' ? 'activity' : 'giveaway';
  const ids: number[] = [];
  for (const s of sessions) {
    const row = await env.DB.prepare(
      `INSERT INTO events (post_id, kind, title, item, start_at, end_at, place_text, place_query, lat, lng, status, confidence, all_day, spot, approx_area, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, NULL, ?, ?) RETURNING id`,
    )
      .bind(postId, kind, title, clean(b.item, 60), s.start, s.end, placeText, clean(b.place_query, MAX_PLACE) ?? placeText, point.lat, point.lng, s.start <= now ? 'active' : 'upcoming', s.allDay ? 1 : 0, now, now)
      .first<{ id: number }>();
    if (row) ids.push(row.id);
  }
  const updated = await env.DB.prepare("UPDATE spot_requests SET status = 'approved', reason = NULL, reviewed_at = ? WHERE id = ? RETURNING *").bind(now, id).first<SpotRequestRow>();
  const events: EventOut[] = [];
  for (const eid of ids) {
    const ev = await getEvent(env, eid, now);
    if (ev) events.push(ev);
  }
  return { request: statusOf(updated ?? req), events };
}

/** 不通過；已經通過的再按不通過，就把雷達上的據點一起撤下 */
export async function rejectSpotRequest(env: Env, id: number, reason: string | null, now: number): Promise<{ request: SpotRequestStatus; removed: number }> {
  const req = await env.DB.prepare("UPDATE spot_requests SET status = 'rejected', reason = ?, reviewed_at = ? WHERE id = ? RETURNING *")
    .bind(clean(reason, 200), now, id)
    .first<SpotRequestRow>();
  if (!req) throw new ReportError(404, 'request not found');
  const r = await env.DB.prepare("UPDATE events SET status = 'ended', ended_reason = 'rejected', updated_at = ? WHERE post_id = ? AND status IN ('upcoming', 'active', 'unlocated')")
    .bind(now, `spot-${req.code}`)
    .run();
  return { request: statusOf(req), removed: r.meta.changes ?? 0 };
}
