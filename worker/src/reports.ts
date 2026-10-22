/**
 * 使用者回報：貼上 Threads 貼文連結、回報已發完。
 * 不需要登入，用加鹽的 IP 雜湊限制頻率。
 * 貼連結的流程：判讀、定位完先回傳預覽（outcome = 'preview'），回報的人按「對」（confirmLink）才寫進雷達，
 * 按「不對」（rejectLink）就不放，留給管理者看。
 */
import type { Env } from './env';
import { commitPlan, detectEnded, getEvent, getPost, planPost, processPost, storePost, type EventOut, type PlanItem, type PostRow } from './events';
import type { EventKind } from './extract';
import { fetchThreadsPost, resolveThreadsLink, shortcodeToUnix, withLocationTag } from './sources/link';
import { sha1Hex } from './sources/text';

/** 只收這麼新的貼文，太舊的公告通常已經過期 */
export const MAX_LINK_AGE_SEC = 7 * 86400;
/** 同一個瀏覽器（裝置代碼）每小時最多回報幾則；補充資料不算 */
const SUBMIT_PER_DEVICE_PER_HOUR = 20;
/** 同一個 IP 每小時：手機網路、同一個 Wi-Fi 常很多人共用一個 IP，放寬，只用來擋清掉瀏覽器資料一直灌的 */
const SUBMIT_PER_IP_PER_HOUR = 60;
/** 沒帶裝置代碼（舊版網頁）時照以前：同一個 IP 每小時 10 則 */
const SUBMIT_PER_IP_NO_DEVICE = 10;
/** 全站每小時上限，避免被灌爆 Workers AI 用量 */
const SUBMIT_GLOBAL_PER_HOUR = 200;
/** 補充資料的紀錄 result 是 "supplement"，不算回報次數 */
const NOT_SUPPLEMENT = `(result IS NULL OR result != '"supplement"')`;
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

let saltCache: string | null = null;

/**
 * 裝置代碼、IP、確認代碼雜湊用的鹽。以前直接用 ADMIN_TOKEN，第一次用到時把當時的 ADMIN_TOKEN 存進 settings，
 * 之後都讀 settings：換 ADMIN_TOKEN 不會讓大家的「我的回報」、漂流瓶、還沒確認的預覽對不上。
 */
export async function hashSalt(env: Env): Promise<string> {
  if (saltCache) return saltCache;
  const read = async (): Promise<string | null> =>
    (await env.DB.prepare("SELECT value FROM settings WHERE key = 'hash_salt'").first<{ value: string }>())?.value ?? null;
  let salt = await read();
  if (!salt) {
    await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('hash_salt', ?, ?)")
      .bind(env.ADMIN_TOKEN ?? 'current-radar', Math.floor(Date.now() / 1000))
      .run();
    salt = (await read()) ?? env.ADMIN_TOKEN ?? 'current-radar';
  }
  saltCache = salt;
  return salt;
}

export async function ipHash(env: Env, req: Request): Promise<string> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  return sha1Hex(`${ip}|${await hashSalt(env)}`);
}

export type LinkOutcome =
  /** 判讀好了，等回報的人確認 */
  | 'preview'
  /** 已在雷達上 */
  | 'added'
  /** 跟已經在雷達上的事件重複 */
  | 'duplicate'
  /** 雷達上已經有這個固定據點（別人發的），這則附在它的詳細資料 */
  | 'attached'
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
  /** 國外活動的當地時區（IANA），預覽用當地時間顯示；台灣是 null */
  tz?: string | null;
  /** 雷達上已經有這個據點：replace 同一個帳號，確認後以這則為準；attach 別人發的，確認後只附上去 */
  update?: { mode: 'replace' | 'attach'; title: string };
  /** 同一個地點一天有好幾個時段（例如中午、晚上）：每個時段第一次的開始、結束時間，照時間排 */
  slots?: Array<{ startAt: number; endAt: number; endOpen?: boolean }>;
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
const confirmToken = async (env: Env, postId: string): Promise<string> => sha1Hex(`confirm|${postId}|${await hashSalt(env)}`, 20);

/** 同一個地點、時段（固定據點的每一天）合成一筆預覽 */
export function previewOf(items: PlanItem[], now: number): PreviewItem[] {
  const groups = new Map<number, NonNullable<PlanItem['plan']>[]>();
  const merges = new Map<number, PlanItem['merge']>();
  for (const it of items) {
    if (!it.plan || it.plan.end_at <= now) continue;
    groups.set(it.group, [...(groups.get(it.group) ?? []), it.plan]);
    if (it.merge) merges.set(it.group, it.merge);
  }
  const out = [...groups.entries()].map(([group, plans]): PreviewItem => {
    const p = plans[0];
    const m = merges.get(group);
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
      tz: p.tz ?? null,
      ...(m ? { update: { mode: m.mode, title: m.title } } : {}),
    };
  });
  return mergeSlots(out);
}

/** 同一個地點、同一種（固定據點或單次）的好幾個時段合成一筆，回報的人看到的是一個地點 */
function mergeSlots(items: PreviewItem[]): PreviewItem[] {
  const merged: PreviewItem[] = [];
  for (const p of items) {
    const same = merged.find((q) => q.placeText === p.placeText && q.spot === p.spot && q.kind === p.kind && (p.spot || sameDay(q.startAt, p.startAt)));
    if (!same) {
      merged.push(p);
      continue;
    }
    const slots = [...(same.slots ?? [{ startAt: same.startAt, endAt: same.endAt, endOpen: same.endOpen }]), { startAt: p.startAt, endAt: p.endAt, endOpen: p.endOpen }].sort((a, b) => a.startAt - b.startAt);
    Object.assign(same, {
      slots,
      endOpen: same.endOpen && p.endOpen,
      startAt: Math.min(same.startAt, p.startAt),
      endAt: Math.max(same.endAt, p.endAt),
      lastStartAt: Math.max(same.lastStartAt, p.lastStartAt),
      days: Math.max(same.days, p.days),
    });
  }
  return merged;
}

const sameDay = (a: number, b: number): boolean => Math.floor((a + 8 * 3600) / 86400) === Math.floor((b + 8 * 3600) / 86400);

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
  if (reasons.some((r) => r.startsWith('attached_to_'))) return 'attached';
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
  if (eventsOnRadar > 0) return outcome === 'duplicate' || outcome === 'attached' ? outcome : 'added';
  return outcome === 'added' || outcome === 'duplicate' || outcome === 'attached' ? 'not_listed' : outcome;
}

async function eventsForResult(env: Env, postId: string, reasons: string[], now: number): Promise<EventOut[]> {
  const ids = new Set<number>();
  const own = await env.DB.prepare("SELECT id FROM events WHERE post_id = ? AND status IN ('upcoming', 'active')").bind(postId).all<{ id: number }>();
  for (const r of own.results) ids.add(r.id);
  for (const r of reasons) {
    const m = /^(?:duplicate_of|attached_to)_(\d+)$/.exec(r);
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

/** 過去一小時的回報次數到上限了：告訴回報的人大約幾分鐘後可以再回報 */
async function checkHourlyLimit(env: Env, column: 'device' | 'ip_hash', value: string, max: number, now: number, who: string): Promise<void> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n, MIN(created_at) AS first FROM submissions WHERE ${column} = ? AND created_at > ? AND ${NOT_SUPPLEMENT}`)
    .bind(value, now - 3600)
    .first<{ n: number; first: number | null }>();
  if ((r?.n ?? 0) < max) return;
  const wait = Math.max(1, Math.ceil(((r?.first ?? now) + 3600 - now) / 60));
  throw new ReportError(429, `回報太頻繁了：${who}一小時最多回報 ${max} 則，約 ${wait} 分鐘後可以再回報`);
}

export const UNREADABLE_POST =
  'Threads 不讓外部讀取這則貼文，雷達讀不到內容。可能是貼文已刪除、帳號是私人帳號，或貼文限制只有登入的人才能看（例如酒類貼文限成年人觀看）。';

/** 處理使用者貼上的連結：讀貼文、AI 判讀、定位，回傳結果 */
export async function submitLink(env: Env, input: string, ip: string, now: number, device: string | null = null): Promise<SubmitResult> {
  const link = await resolveThreadsLink(input);
  if (!link) throw new ReportError(400, '找不到 Threads 貼文連結，請貼上像 https://www.threads.com/@帳號/post/... 的網址');
  const postId = `link-${link.code}`;

  const existing = await getPost(env, postId);
  // 之前有人貼過但還沒確認（或說判讀錯了）：再給這個人看一次預覽，讓他確認；回報的人刪掉的，重新判讀
  const waiting = existing && (existing.confirm_state === 'pending' || existing.confirm_state === 'rejected' || existing.confirm_state === 'withdrawn');
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

  // 主要看同一個瀏覽器；IP 放寬（很多人共用一個 IP），只擋清掉瀏覽器資料一直灌的
  if (device) await checkHourlyLimit(env, 'device', device, SUBMIT_PER_DEVICE_PER_HOUR, now, '同一個瀏覽器');
  await checkHourlyLimit(env, 'ip_hash', ip, device ? SUBMIT_PER_IP_PER_HOUR : SUBMIT_PER_IP_NO_DEVICE, now, '同一個網路');
  const all = await countSince(env, `SELECT COUNT(*) AS n FROM submissions WHERE created_at > ? AND ${NOT_SUPPLEMENT}`, [now - 3600]);
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
  const text = withLocationTag(fetched.text, fetched.location);
  await storePost(env, { id: postId, username, text, permalink, posted_at: postedAt, keyword: null, source: 'link' }, now);
  // 等回報的人確認才放上雷達；排程也不會自己判讀
  await env.DB.prepare("UPDATE posts SET checked_at = ?, text = ?, confirm_state = 'pending' WHERE id = ?").bind(now, text, postId).run();
  await env.DB.prepare('INSERT INTO submissions (post_id, ip_hash, device, created_at) VALUES (?, ?, ?, ?)').bind(postId, ip, device, now).run();

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
export async function confirmLink(env: Env, body: { postId?: unknown; token?: unknown }, now: number, device: string | null = null): Promise<SubmitResult> {
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
    // 舊版網頁送出時沒帶裝置代碼：確認的人補上，之後才能自己刪除
    // 寫在這則最後一筆回報上；補充資料的紀錄不動（不然補充會被當成回報、補充次數也少算）
    env.DB.prepare(`UPDATE submissions SET result = ?, device = COALESCE(device, ?) WHERE id = (SELECT MAX(id) FROM submissions WHERE post_id = ? AND ${NOT_SUPPLEMENT})`).bind(JSON.stringify(result.reasons), device, post.id),
  ]);
  return { existed: false, outcome: summarize(result.reasons), reasons: result.reasons, events: await eventsForResult(env, post.id, result.reasons, now), permalink };
}

/** 一則貼文最多補充幾次（每次都要再跑一次 AI） */
const SUPPLEMENTS_PER_POST = 5;

/**
 * 回報的人補充地點或時間（貼文沒寫、判讀不出來時）：接在貼文後面再判讀一次，回傳新的預覽。
 * 補充的內容會顯示在雷達的詳細資料上（「回報的人補充」），看的人知道哪些不是原貼文寫的。
 */
export async function supplementLink(env: Env, body: { postId?: unknown; token?: unknown; note?: unknown }, ip: string, now: number, device: string | null = null): Promise<SubmitResult> {
  const post = await checkConfirm(env, body);
  if (post.confirm_state === 'confirmed') throw new ReportError(409, '這則已經放上雷達了，不能再補充');
  const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (note.length < 2) throw new ReportError(400, '請寫要補充的地點或時間');
  // 補充資料不算回報次數；一則最多補充 SUPPLEMENTS_PER_POST 次
  const times = await countSince(env, "SELECT COUNT(*) AS n FROM submissions WHERE post_id = ? AND result = '\"supplement\"'", [post.id]);
  if (times >= SUPPLEMENTS_PER_POST) throw new ReportError(429, '這則已經補充太多次了，請聯絡管理者');
  await env.DB.prepare("INSERT INTO submissions (post_id, ip_hash, device, result, created_at) VALUES (?, ?, ?, '\"supplement\"', ?)").bind(post.id, ip, device, now).run();

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

/** 我的回報（用同一個瀏覽器回報、確認放上雷達的）：on_radar 在雷達上、attached 附在別的據點、not_listed 已結束或沒放上 */
export interface MyReport {
  postId: string;
  permalink: string;
  username: string | null;
  title: string;
  state: 'on_radar' | 'attached' | 'not_listed';
  /** 雷達上還沒結束的場次 */
  events: number;
  /** 點了跳到雷達上的哪一場 */
  eventId: number | null;
  reportedAt: number;
}

/**
 * 這個裝置 30 天內回報、有放上雷達的貼文（附在別的據點的也算）。還沒確認、說判讀錯了、跟雷達上重複而沒放上的不列。
 * 回報紀錄 30 天後刪除，更早的就認不出來了。
 */
export async function myReports(env: Env, device: string): Promise<MyReport[]> {
  const { results: posts } = await env.DB.prepare(
    `SELECT p.id, p.permalink, p.username, p.text, p.confirm_state, p.link_role, MAX(s.created_at) AS reported_at
       FROM submissions s JOIN posts p ON p.id = s.post_id
      WHERE s.device = ? AND p.source = 'link' AND p.confirm_state = 'confirmed'
        AND (p.link_role = 'related' OR EXISTS (SELECT 1 FROM events e WHERE e.post_id = p.id))
      GROUP BY p.id ORDER BY reported_at DESC LIMIT 30`,
  )
    .bind(device)
    .all<{ id: string; permalink: string | null; username: string | null; text: string; confirm_state: string | null; link_role: string | null; reported_at: number }>();
  if (posts.length === 0) return [];
  const { results: evs } = await env.DB.prepare(
    `SELECT id, post_id, title FROM events WHERE status IN ('upcoming', 'active') AND post_id IN (${posts.map(() => '?').join(',')}) ORDER BY start_at`,
  )
    .bind(...posts.map((p) => p.id))
    .all<{ id: number; post_id: string; title: string }>();
  return posts.map((p) => {
    const mine = evs.filter((e) => e.post_id === p.id);
    const state: MyReport['state'] = mine.length > 0 ? 'on_radar' : p.link_role === 'related' ? 'attached' : 'not_listed';
    const firstLine = p.text.split('\n').map((x) => x.trim()).find(Boolean) ?? '';
    return {
      postId: p.id,
      permalink: p.permalink ?? '',
      username: p.username,
      title: mine[0]?.title ?? firstLine.slice(0, 40),
      state,
      events: mine.length,
      eventId: mine[0]?.id ?? null,
      reportedAt: p.reported_at,
    };
  });
}

/**
 * 回報的人刪除自己的回報：雷達上這則的事件都拿掉。
 * 這則取代過同一個帳號的舊據點的話，舊據點還沒過的時段放回雷達；附在這則上的別人的貼文改附回舊據點（沒有舊的就解除）。
 */
export async function withdrawReport(env: Env, postId: string, device: string, now: number): Promise<{ ok: true; removed: number }> {
  const owned = await env.DB.prepare('SELECT 1 AS ok FROM submissions WHERE post_id = ? AND device = ? LIMIT 1').bind(postId, device).first<{ ok: number }>();
  if (!owned) throw new ReportError(403, '只能刪除自己回報的貼文，而且要用回報時的同一個瀏覽器（30 天內）');
  const post = await getPost(env, postId);
  if (!post || post.source !== 'link') throw new ReportError(404, '找不到這則回報');
  if (post.confirm_state === 'withdrawn') return { ok: true, removed: 0 };
  const removed = (await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE post_id = ? AND status IN ('upcoming', 'active')").bind(postId).first<{ n: number }>())?.n ?? 0;
  const { results: prev } = await env.DB.prepare("SELECT id FROM posts WHERE linked_to = ? AND link_role = 'previous' ORDER BY posted_at DESC").bind(postId).all<{ id: string }>();
  const restore = prev.map((p) =>
    env.DB.prepare(
      "UPDATE events SET status = CASE WHEN start_at <= ? THEN 'active' ELSE 'upcoming' END, ended_reason = NULL, updated_at = ? WHERE post_id = ? AND status = 'ended' AND ended_reason = 'replaced' AND end_at > ?",
    ).bind(now, now, p.id, now),
  );
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ended_reports WHERE event_id IN (SELECT id FROM events WHERE post_id = ?)').bind(postId),
    env.DB.prepare('DELETE FROM events WHERE post_id = ?').bind(postId),
    ...restore,
    prev.length > 0
      ? env.DB.prepare("UPDATE posts SET linked_to = ? WHERE linked_to = ? AND link_role = 'related'").bind(prev[0].id, postId)
      : env.DB.prepare("UPDATE posts SET linked_to = NULL, link_role = NULL WHERE linked_to = ? AND link_role = 'related'").bind(postId),
    env.DB.prepare("UPDATE posts SET linked_to = NULL, link_role = NULL WHERE linked_to = ? AND link_role = 'previous'").bind(postId),
    env.DB.prepare("UPDATE posts SET confirm_state = 'withdrawn', confirm_plan = NULL, linked_to = NULL, link_role = NULL WHERE id = ?").bind(postId),
  ]);
  return { ok: true, removed };
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
    // 存的內文可能接了地點標記（以前存的沒有），兩種都算沒改
    const changed = r.status === 'ok' && r.text !== row.text && withLocationTag(r.text, r.location) !== row.text;
    if (r.status === 'gone') {
      await endAll(row.id, 'deleted');
      out.deleted++;
    } else if (r.status === 'ok' && changed && row.id.startsWith('spot-')) {
      await env.DB.prepare('UPDATE posts SET text = ? WHERE id = ?').bind(r.text, row.id).run();
    } else if (r.status === 'ok' && changed) {
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
        env.DB.prepare('UPDATE posts SET text = ? WHERE id = ?').bind(withLocationTag(r.text, r.location), row.id),
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
