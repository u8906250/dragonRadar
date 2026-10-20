/**
 * 使用者回報：貼上 Threads 貼文連結、回報已發完。
 * 不需要登入，用加鹽的 IP 雜湊限制頻率。
 * 貼連結的流程：判讀、定位完先回傳預覽（outcome = 'preview'），回報的人按「對」（confirmLink）才寫進雷達，
 * 按「不對」（rejectLink）就不放，留給管理者看。
 */
import type { Env } from './env';
import { commitPlan, detectEnded, getEvent, getPost, planPost, processPost, storePost, type EventOut, type PlanItem, type PostRow } from './events';
import type { EventKind } from './extract';
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
  /** 判讀好了，等回報的人確認 */
  | 'preview'
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

/** 預覽：一個地點或時段（固定據點的好幾天合成一筆） */
export interface PreviewItem {
  kind: EventKind;
  title: string;
  item: string | null;
  placeText: string;
  /** null：找不到地點，確認了也不會出現在雷達上 */
  lat: number | null;
  lng: number | null;
  /** 只定位到鄉鎮區（約略位置） */
  approxArea: string | null;
  spot: boolean;
  startAt: number;
  endAt: number;
  allDay: boolean;
  endOpen: boolean;
  untilOpen: boolean;
  /** 固定據點排了幾天、最後一天的開始時間 */
  days: number;
  lastStartAt: number;
  /** 固定據點每週幾開（1–7），每天則 null */
  weekdays: number[] | null;
}

export interface SubmitResult {
  /** 這則貼文之前已經有人回報過 */
  existed: boolean;
  outcome: LinkOutcome;
  reasons: string[];
  /** 已經在雷達上的（包括重複的那一場） */
  events: EventOut[];
  permalink: string;
  /** outcome = 'preview' 時：判讀結果 */
  preview?: PreviewItem[];
  /** 還沒放上雷達的回報：確認、說判讀錯了、補充資料都用這組代碼 */
  confirm?: { postId: string; token: string };
  /** 回報的人補充過的資料 */
  supplement?: string | null;
}

/** 判讀好、還沒寫進雷達的資料，存在 posts.confirm_plan */
interface StoredPlan {
  items: PlanItem[];
  early: string | null;
}

/** 確認用的代碼：拿得到預覽的人才能確認（貼文 id 加鹽雜湊，不用另外存） */
const confirmToken = (env: Env, postId: string): Promise<string> => sha1Hex(`confirm|${postId}|${env.ADMIN_TOKEN ?? 'current-radar'}`, 20);

/** 同一個地點、時段（固定據點的每一天）合成一筆預覽 */
export function previewOf(items: PlanItem[], now: number): PreviewItem[] {
  const groups = new Map<number, NonNullable<PlanItem['plan']>[]>();
  for (const it of items) if (it.plan && it.plan.end_at > now) groups.set(it.group, [...(groups.get(it.group) ?? []), it.plan]);
  return [...groups.values()].map((plans) => {
    const p = plans[0];
    const last = plans[plans.length - 1];
    return {
      kind: p.kind,
      title: p.title,
      item: p.item,
      placeText: p.place_text,
      lat: p.lat,
      lng: p.lng,
      approxArea: p.approx_area,
      spot: p.spot,
      startAt: p.start_at,
      endAt: p.end_at,
      allDay: p.all_day,
      endOpen: p.end_open,
      untilOpen: p.until_open,
      days: plans.length,
      lastStartAt: last.start_at,
      weekdays: p.weekdays ?? null,
    };
  });
}

/**
 * 有預覽就請回報的人確認；什麼都放不上去（找不到地點、不是發放、已結束）就直接回傳原因。
 * 兩種都附確認代碼：貼文沒寫地點或時間時，回報的人可以補充資料再判讀一次。
 */
async function previewResult(env: Env, post: PostRow, plan: StoredPlan, existed: boolean, now: number): Promise<SubmitResult> {
  const base = { existed, permalink: post.permalink ?? '', confirm: { postId: post.id, token: await confirmToken(env, post.id) }, supplement: post.supplement ?? null };
  if (plan.early) return { ...base, outcome: summarize([plan.early]), reasons: [plan.early], events: [] };
  const reasons = plan.items.filter((it) => !it.plan).map((it) => it.reason);
  const events = await eventsForResult(env, post.id, reasons, now);
  const preview = previewOf(plan.items, now);
  if (preview.length === 0) return { ...base, outcome: summarize(reasons), reasons, events };
  return { ...base, outcome: 'preview', reasons, events, preview };
}

const readPlan = (post: PostRow): StoredPlan | null => {
  try {
    const p = post.confirm_plan ? (JSON.parse(post.confirm_plan) as StoredPlan) : null;
    return p && Array.isArray(p.items) ? p : null;
  } catch {
    return null;
  }
};

function summarize(reasons: string[]): LinkOutcome {
  if (reasons.some((r) => r === 'active' || r === 'upcoming')) return 'added';
  if (reasons.some((r) => r.startsWith('duplicate_of_'))) return 'duplicate';
  if (reasons.some((r) => r === 'unlocated' || r === 'no_place')) return 'no_place';
  if (reasons.some((r) => r === 'not_event' || r === 'no_events')) return 'not_event';
  if (reasons.some((r) => r === 'garbled' || r === 'extraction_failed')) return 'failed';
  return 'not_listed';
}

/**
 * 之前回報過的貼文：以現在雷達上有沒有為準，不只看當時的判讀結果。
 * 當時的結果可能沒記到（管理者重跑、舊資料），或後來改過（補上位置、下架），
 * 所以雷達上有就是「已在雷達上」（重複的那一場算「雷達上已經有」），沒有就不說在雷達上。
 */
export function existedOutcome(reasons: string[], eventsOnRadar: number): LinkOutcome {
  const outcome = summarize(reasons);
  if (eventsOnRadar > 0) return outcome === 'duplicate' ? 'duplicate' : 'added';
  return outcome === 'added' || outcome === 'duplicate' ? 'not_listed' : outcome;
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

export const UNREADABLE_POST =
  'Threads 不讓外部讀取這則貼文，雷達讀不到內容。可能是貼文已刪除、帳號是私人帳號，或貼文限制只有登入的人才能看（例如酒類貼文限成年人觀看）。';

/** 處理使用者貼上的連結：讀貼文、AI 判讀、定位，回傳結果 */
export async function submitLink(env: Env, input: string, ip: string, now: number): Promise<SubmitResult> {
  const link = await resolveThreadsLink(input);
  if (!link) throw new ReportError(400, '找不到 Threads 貼文連結，請貼上像 https://www.threads.com/@帳號/post/... 的網址');
  const postId = `link-${link.code}`;

  const existing = await getPost(env, postId);
  // 之前有人貼過但還沒確認（或說判讀錯了）：再給這個人看一次預覽，讓他確認
  const waiting = existing && (existing.confirm_state === 'pending' || existing.confirm_state === 'rejected');
  const stored = waiting ? readPlan(existing) : null;
  if (existing && waiting && stored && stored.early !== 'extraction_failed') return previewResult(env, existing, stored, true, now);
  if (existing && !waiting) {
    const last = await env.DB.prepare("SELECT result FROM submissions WHERE post_id = ? AND result IS NOT NULL AND result != '\"supplement\"' ORDER BY id DESC LIMIT 1")
      .bind(postId)
      .first<{ result: string }>();
    // 補充資料的紀錄存的是 "supplement"，不是判讀結果
    const parsed = last ? (JSON.parse(last.result) as unknown) : [];
    const reasons = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    const events = await eventsForResult(env, postId, reasons, now);
    return { existed: true, outcome: existedOutcome(reasons, events.length), reasons, events, permalink: existing.permalink ?? '' };
  }

  const postedAt = shortcodeToUnix(link.code, now);
  if (postedAt === null) throw new ReportError(400, '這個連結看起來不是 Threads 貼文');
  if (now - postedAt > MAX_LINK_AGE_SEC) throw new ReportError(400, `這則貼文發布超過 ${MAX_LINK_AGE_SEC / 86400} 天，雷達只收最近的發放和活動`);

  const mine = await countSince(env, 'SELECT COUNT(*) AS n FROM submissions WHERE ip_hash = ? AND created_at > ?', [ip, now - 3600]);
  if (mine >= SUBMIT_PER_IP_PER_HOUR) throw new ReportError(429, '回報太頻繁了，請過一陣子再試');
  const all = await countSince(env, 'SELECT COUNT(*) AS n FROM submissions WHERE created_at > ?', [now - 3600]);
  if (all >= SUBMIT_GLOBAL_PER_HOUR) throw new ReportError(429, '目前回報的人太多，請稍後再試');

  const fetched = await fetchThreadsPost(link.code);
  // Threads 對刪除、私人帳號、限制觀看的貼文都回同一個「無法顯示串文」頁面，分不出是哪一種
  if (fetched.status === 'gone') throw new ReportError(404, UNREADABLE_POST);
  if (fetched.status === 'no_text') throw new ReportError(422, '這則貼文沒有文字，雷達只能判讀有寫時間地點的文字');
  if (fetched.status === 'error') {
    console.warn(`embed fetch failed for ${link.code}: ${fetched.message}`);
    throw new ReportError(502, '暫時讀不到這則貼文，請稍後再試');
  }

  const username = fetched.username ?? link.username;
  const permalink = username ? `https://www.threads.com/@${username}/post/${link.code}` : `https://www.threads.com/t/${link.code}`;
  await storePost(env, { id: postId, username, text: fetched.text, permalink, posted_at: postedAt, keyword: null, source: 'link' }, now);
  // 等回報的人確認才放上雷達；排程也不會自己判讀
  await env.DB.prepare("UPDATE posts SET checked_at = ?, text = ?, confirm_state = 'pending' WHERE id = ?").bind(now, fetched.text, postId).run();
  await env.DB.prepare('INSERT INTO submissions (post_id, ip_hash, created_at) VALUES (?, ?, ?)').bind(postId, ip, now).run();

  const post = await getPost(env, postId);
  if (!post) throw new ReportError(500, 'post not stored');
  let plan: StoredPlan;
  try {
    plan = await planPost(env, post, now);
  } catch (e) {
    // Workers AI 暫時出錯：貼文已存，回報的人再貼一次就會重新判讀
    console.warn(`plan failed for ${postId}: ${String(e)}`);
    return { existed: false, outcome: 'failed', reasons: ['extraction_failed'], events: [], permalink };
  }
  await env.DB.prepare('UPDATE posts SET confirm_plan = ? WHERE id = ?').bind(JSON.stringify(plan), postId).run();
  return previewResult(env, { ...post, permalink }, plan, !!existing, now);
}

async function checkConfirm(env: Env, body: { postId?: unknown; token?: unknown }): Promise<PostRow> {
  const postId = typeof body.postId === 'string' ? body.postId : '';
  if (!/^link-[\w-]+$/.test(postId) || body.token !== (await confirmToken(env, postId))) throw new ReportError(400, '確認代碼不對，請重新貼一次連結');
  const post = await getPost(env, postId);
  if (!post) throw new ReportError(404, '找不到這則回報，請重新貼一次連結');
  return post;
}

/** 回報的人確認判讀沒錯：寫進雷達 */
export async function confirmLink(env: Env, body: { postId?: unknown; token?: unknown }, now: number): Promise<SubmitResult> {
  const post = await checkConfirm(env, body);
  const permalink = post.permalink ?? '';
  if (post.confirm_state === 'confirmed') {
    const events = await eventsForResult(env, post.id, [], now);
    return { existed: true, outcome: events.length > 0 ? 'added' : 'not_listed', reasons: [], events, permalink };
  }
  const plan = readPlan(post);
  if (!plan) throw new ReportError(409, '判讀結果不見了，請重新貼一次連結');
  const result = await commitPlan(env, post.id, plan.items, now);
  await env.DB.batch([
    env.DB.prepare("UPDATE posts SET confirm_state = 'confirmed', confirm_plan = NULL WHERE id = ?").bind(post.id),
    env.DB.prepare('UPDATE submissions SET result = ? WHERE id = (SELECT MAX(id) FROM submissions WHERE post_id = ?)').bind(JSON.stringify(result.reasons), post.id),
  ]);
  return { existed: false, outcome: summarize(result.reasons), reasons: result.reasons, events: await eventsForResult(env, post.id, result.reasons, now), permalink };
}

/** 一則貼文最多補充幾次（每次都要再跑一次 AI） */
const SUPPLEMENTS_PER_POST = 5;

/**
 * 回報的人補充地點或時間（貼文沒寫、判讀不出來時）：接在貼文後面再判讀一次，回傳新的預覽。
 * 補充的內容會顯示在雷達的詳細資料上（「回報的人補充」），看的人知道哪些不是原貼文寫的。
 */
export async function supplementLink(env: Env, body: { postId?: unknown; token?: unknown; note?: unknown }, ip: string, now: number): Promise<SubmitResult> {
  const post = await checkConfirm(env, body);
  if (post.confirm_state === 'confirmed') throw new ReportError(409, '這則已經放上雷達了，不能再補充');
  const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (note.length < 2) throw new ReportError(400, '請寫要補充的地點或時間');
  const mine = await countSince(env, 'SELECT COUNT(*) AS n FROM submissions WHERE ip_hash = ? AND created_at > ?', [ip, now - 3600]);
  if (mine >= SUBMIT_PER_IP_PER_HOUR) throw new ReportError(429, '回報太頻繁了，請過一陣子再試');
  const times = await countSince(env, "SELECT COUNT(*) AS n FROM submissions WHERE post_id = ? AND result = '\"supplement\"'", [post.id]);
  if (times >= SUPPLEMENTS_PER_POST) throw new ReportError(429, '這則已經補充太多次了，請聯絡管理者');
  await env.DB.prepare("INSERT INTO submissions (post_id, ip_hash, result, created_at) VALUES (?, ?, '\"supplement\"', ?)").bind(post.id, ip, now).run();

  const updated: PostRow = { ...post, supplement: note };
  let plan: StoredPlan;
  try {
    plan = await planPost(env, updated, now);
  } catch (e) {
    console.warn(`supplement plan failed for ${post.id}: ${String(e)}`);
    throw new ReportError(503, '判讀暫時失敗，請稍後再試');
  }
  await env.DB.prepare("UPDATE posts SET supplement = ?, confirm_plan = ?, confirm_state = 'pending' WHERE id = ?").bind(note, JSON.stringify(plan), post.id).run();
  return previewResult(env, updated, plan, false, now);
}

/** 回報的人說判讀錯了：不放上雷達，記下哪裡錯給管理者看 */
export async function rejectLink(env: Env, body: { postId?: unknown; token?: unknown; note?: unknown }): Promise<{ ok: true }> {
  const post = await checkConfirm(env, body);
  if (post.confirm_state === 'confirmed') throw new ReportError(409, '這則已經有人確認放上雷達了；有錯可以在詳細資料回報');
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
  await env.DB.prepare("UPDATE posts SET confirm_state = 'rejected', confirm_note = COALESCE(NULLIF(?, ''), confirm_note) WHERE id = ?").bind(note, post.id).run();
  return { ok: true };
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

/**
 * 定時重讀使用者回報的貼文：刪文就下架、改成「發完了」就結束、內容改了就重新判讀。
 * 審核通過的固定據點（spot-）只看有沒有刪文：內容以審核時填的為準，貼文常寫「送完為止」不能當成發完。
 */
export async function recheckLinks(env: Env, now: number): Promise<RecheckLinksResult> {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT p.id, p.text FROM posts p JOIN events e ON e.post_id = p.id
     WHERE p.source IN ('link', 'spot') AND e.status IN ('upcoming', 'active') AND (p.checked_at IS NULL OR p.checked_at <= ?)
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
    const r = await fetchThreadsPost(row.id.replace(/^(link|spot)-/, ''));
    await env.DB.prepare('UPDATE posts SET checked_at = ? WHERE id = ?').bind(now, row.id).run();
    if (r.status === 'gone') {
      await endAll(row.id, 'deleted');
      out.deleted++;
    } else if (r.status === 'ok' && r.text !== row.text && row.id.startsWith('spot-')) {
      await env.DB.prepare('UPDATE posts SET text = ? WHERE id = ?').bind(r.text, row.id).run();
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
    env.DB.prepare('UPDATE spot_requests SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at < ?').bind(cutoff),
  ]);
  return r.reduce((n, x) => n + (x.meta.changes ?? 0), 0);
}
