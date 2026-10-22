/**
 * 問題回報：大家在詳細資料按「回報問題」（地點錯誤、時間錯誤…），推到管理者的手機，管理頁列出來、標成已處理。
 * 回報的內容只有管理者看得到；存裝置代碼與 IP 的加鹽雜湊（限制次數、同一個人同一則同一種問題只算一次），30 天後刪除。
 */
import type { Env } from './env';
import { getPost, reprocessPost, takeDown } from './events';
import { parseSubscription, PushError, sendPush, type PushMessage } from './push';

export const FEEDBACK_KINDS = {
  location: '地點錯誤',
  time: '時間錯誤',
  content: '標題或內容錯誤',
  not_event: '不是發放或活動',
  duplicate: '重複',
  other: '其他',
} as const;
export type FeedbackKind = keyof typeof FEEDBACK_KINDS;

const NOTE_MAX = 200;
/** 每小時最多回報幾次：有裝置代碼的照裝置算，IP 寬一點（同一個網路很多人） */
const PER_DEVICE_PER_HOUR = 10;
const PER_IP_PER_HOUR = 30;
const PER_IP_NO_DEVICE_PER_HOUR = 10;

export interface FeedbackResult {
  ok: true;
  /** 同一個人已經回報過這則的同一種問題 */
  duplicate: boolean;
}

const isKind = (v: unknown): v is FeedbackKind => typeof v === 'string' && Object.prototype.hasOwnProperty.call(FEEDBACK_KINDS, v);

/** 整理備註：去掉頭尾空白、連續空白，最多 NOTE_MAX 字；沒寫是 null */
export function cleanNote(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = [...v.replace(/\s+/g, ' ').trim()].slice(0, NOTE_MAX).join('');
  return t.length > 0 ? t : null;
}

async function countSince(env: Env, col: 'device' | 'ip', value: string, since: number): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM event_feedback WHERE ${col} = ? AND created_at > ?`).bind(value, since).first<{ n: number }>();
  return r?.n ?? 0;
}

/** 回報一則事件的問題：{ kind, note }；回傳要推給管理者的那一筆（重複的不推） */
export async function submitFeedback(
  env: Env,
  eventId: number,
  body: unknown,
  device: string | null,
  ip: string,
  now: number,
): Promise<{ result: FeedbackResult; created: FeedbackRow | null }> {
  const b = (body ?? {}) as { kind?: unknown; note?: unknown };
  if (!isKind(b.kind)) throw new PushError(400, '請選擇問題類型');
  const note = cleanNote(b.note);
  if (b.kind === 'other' && !note) throw new PushError(400, '選「其他」請寫一下是什麼問題');
  const ev = await env.DB.prepare('SELECT id, post_id, title, place_text FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ id: number; post_id: string; title: string; place_text: string }>();
  if (!ev) throw new PushError(404, '找不到這個發放或活動，可能已經下架了');

  const hour = now - 3600;
  if (device && (await countSince(env, 'device', device, hour)) >= PER_DEVICE_PER_HOUR) throw new PushError(429, '回報太頻繁了，請過一陣子再試');
  if ((await countSince(env, 'ip', ip, hour)) >= (device ? PER_IP_PER_HOUR : PER_IP_NO_DEVICE_PER_HOUR)) throw new PushError(429, '回報太頻繁了，請過一陣子再試');

  // 同一個人（沒有裝置代碼就看 IP）同一則同一種問題只算一次
  const dup = await env.DB.prepare(`SELECT 1 AS ok FROM event_feedback WHERE event_id = ? AND kind = ? AND ${device ? 'device = ?' : 'device IS NULL AND ip = ?'}`)
    .bind(eventId, b.kind, device ?? ip)
    .first<{ ok: number }>();
  if (dup) return { result: { ok: true, duplicate: true }, created: null };

  const row = await env.DB.prepare(
    `INSERT INTO event_feedback (event_id, post_id, title, place_text, kind, note, device, ip, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?) RETURNING id, event_id, post_id, title, place_text, kind, note, status, created_at, resolved_at`,
  )
    .bind(ev.id, ev.post_id, ev.title, ev.place_text, b.kind, note, device, ip, now)
    .first<FeedbackRow>();
  return { result: { ok: true, duplicate: false }, created: row };
}

export interface FeedbackRow {
  id: number;
  event_id: number;
  post_id: string | null;
  title: string;
  place_text: string | null;
  kind: FeedbackKind;
  note: string | null;
  status: 'open' | 'resolved';
  created_at: number;
  resolved_at: number | null;
}

/** 推給管理者的通知：同一個 tag，新的取代舊的，但會再響一次 */
export function feedbackMessage(row: Pick<FeedbackRow, 'kind' | 'title' | 'note'>, open: number): PushMessage {
  return {
    title: `新回報：${FEEDBACK_KINDS[row.kind]}${open > 1 ? `（未處理 ${open} 則）` : ''}`,
    body: `${row.title}｜${row.note ?? '沒寫說明'}`,
    tag: 'feedback',
    url: './admin.html',
    renotify: true,
  };
}

/** 有新回報：推到管理者訂閱的手機 */
export async function notifyAdmins(env: Env, row: FeedbackRow, now: number): Promise<number> {
  const { results: subs } = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM admin_push_subscriptions').all<{ endpoint: string; p256dh: string; auth: string }>();
  if (subs.length === 0) return 0;
  const open = (await env.DB.prepare("SELECT COUNT(*) AS n FROM event_feedback WHERE status = 'open'").first<{ n: number }>())?.n ?? 1;
  const msg = feedbackMessage(row, open);
  let sent = 0;
  for (const sub of subs) {
    const status = await sendPush(env, sub, msg, now, 'admin_push_subscriptions').catch((e) => {
      console.warn('admin push failed', e);
      return 0;
    });
    if (status >= 200 && status < 300) sent++;
  }
  return sent;
}

/** 管理頁的列表：回報當時的標題地點，加上事件現在的狀態、位置、原文連結（不回傳裝置代碼、IP 雜湊） */
export async function listFeedback(env: Env, status: string | null): Promise<unknown[]> {
  const st = status === 'resolved' ? 'resolved' : 'open';
  const { results } = await env.DB.prepare(
    `SELECT f.id, f.event_id, f.post_id, f.title, f.place_text, f.kind, f.note, f.status, f.created_at, f.resolved_at,
            e.status AS event_status, e.start_at, e.end_at, e.lat, e.lng, e.approx_area, e.title AS event_title, e.place_text AS event_place,
            p.permalink, p.username, p.supplement, p.source,
            -- 重新判讀後原本那一則會換成新的：同一則貼文現在雷達上的第一則
            (SELECT c.id FROM events c WHERE c.post_id = f.post_id AND c.status IN ('upcoming', 'active') ORDER BY c.start_at LIMIT 1) AS current_event_id
       FROM event_feedback f
       LEFT JOIN events e ON e.id = f.event_id
       LEFT JOIN posts p ON p.id = f.post_id
      WHERE f.status = ?
      ORDER BY f.created_at DESC LIMIT 200`,
  )
    .bind(st)
    .all();
  return results.map((r) => ({ ...r, kind_label: FEEDBACK_KINDS[r.kind as FeedbackKind] ?? r.kind }));
}

/** 套用後回給管理頁看的：現在雷達上這則貼文的事件（同一個地點的固定據點只列第一天） */
async function currentEvents(env: Env, postId: string): Promise<unknown[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, title, kind, item, start_at, end_at, place_text, approx_area, lat, lng, status, spot, end_open FROM events
      WHERE post_id = ? AND status IN ('upcoming', 'active', 'unlocated') ORDER BY start_at`,
  )
    .bind(postId)
    .all<{ id: number; spot: number; place_text: string }>();
  const seen = new Set<string>();
  return results.filter((e) => {
    if (!e.spot) return true;
    if (seen.has(e.place_text)) return false;
    seen.add(e.place_text);
    return true;
  });
}

/**
 * 套用回報：
 * - { action: 'supplement', note }：把說明（管理者可以改過）加到貼文的補充，重新判讀這則貼文
 * - { action: 'takedown', scope?: 'event' | 'post' }：從雷達下架（不是發放或活動、重複）
 * 套用完標成已處理，回傳現在雷達上這則貼文的事件
 */
export async function applyFeedback(env: Env, id: number, body: unknown, now: number): Promise<{ ok: true; action: string; removed?: number; events: unknown[] }> {
  const fb = await env.DB.prepare('SELECT id, event_id, post_id, kind, note FROM event_feedback WHERE id = ?')
    .bind(id)
    .first<{ id: number; event_id: number; post_id: string | null; kind: FeedbackKind; note: string | null }>();
  if (!fb) throw new PushError(404, '找不到這筆回報');
  const b = (body ?? {}) as { action?: unknown; note?: unknown; scope?: unknown };
  const postId = fb.post_id;
  if (!postId) throw new PushError(400, '這筆回報沒有對應的貼文');
  let removed: number | undefined;
  if (b.action === 'supplement') {
    const note = cleanNote(b.note ?? fb.note);
    if (!note) throw new PushError(400, '請寫要補充的內容');
    const post = await getPost(env, postId);
    if (!post) throw new PushError(404, '這則貼文已經不在了');
    // 原本有補充就接在後面（貼文補充最多 200 字）
    const merged = [...(post.supplement ? `${post.supplement}；${note}` : note)].slice(0, 200).join('');
    await env.DB.prepare('UPDATE posts SET supplement = ? WHERE id = ?').bind(merged, postId).run();
    await reprocessPost(env, postId, now).catch((e: Error) => {
      throw new PushError(400, e.message);
    });
  } else if (b.action === 'takedown') {
    removed = await takeDown(env, fb.event_id, b.scope === 'post' ? 'post' : 'event', 'feedback', now);
  } else {
    throw new PushError(400, "action 要是 'supplement' 或 'takedown'");
  }
  await env.DB.prepare("UPDATE event_feedback SET status = 'resolved', resolved_at = ? WHERE id = ?").bind(now, id).run();
  return { ok: true, action: b.action, ...(removed !== undefined ? { removed } : {}), events: await currentEvents(env, postId) };
}

/** 標成已處理，或改回未處理：{ status: 'resolved' | 'open' } */
export async function setFeedbackStatus(env: Env, id: number, body: unknown, now: number): Promise<{ ok: true; id: number; status: string }> {
  const status = (body as { status?: unknown } | null)?.status;
  if (status !== 'resolved' && status !== 'open') throw new PushError(400, "status 要是 'resolved' 或 'open'");
  const r = await env.DB.prepare('UPDATE event_feedback SET status = ?, resolved_at = ? WHERE id = ?')
    .bind(status, status === 'resolved' ? now : null, id)
    .run();
  if (!r.meta.changes) throw new PushError(404, '找不到這筆回報');
  return { ok: true, id, status };
}

/** 管理者在自己手機上開回報通知：{ subscription } */
export async function saveAdminSubscription(env: Env, body: unknown, now: number): Promise<{ ok: true; created: boolean; sub: { endpoint: string; p256dh: string; auth: string } }> {
  const sub = parseSubscription((body as { subscription?: unknown } | null)?.subscription);
  const existed = await env.DB.prepare('SELECT 1 AS ok FROM admin_push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).first<{ ok: number }>();
  await env.DB.prepare(
    `INSERT INTO admin_push_subscriptions (endpoint, p256dh, auth, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, updated_at = excluded.updated_at`,
  )
    .bind(sub.endpoint, sub.p256dh, sub.auth, now, now)
    .run();
  return { ok: true, created: !existed, sub };
}

export async function deleteAdminSubscription(env: Env, body: unknown): Promise<{ ok: true; deleted: number }> {
  const endpoint = (body as { endpoint?: unknown } | null)?.endpoint;
  if (typeof endpoint !== 'string') throw new PushError(400, 'endpoint is required');
  const r = await env.DB.prepare('DELETE FROM admin_push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
  return { ok: true, deleted: r.meta.changes ?? 0 };
}

/** 30 天前的回報刪掉 */
export async function purgeFeedback(env: Env, cutoff: number): Promise<number> {
  const r = await env.DB.prepare('DELETE FROM event_feedback WHERE created_at < ?').bind(cutoff).run();
  return r.meta.changes ?? 0;
}
