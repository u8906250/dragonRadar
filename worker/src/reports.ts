/**
 * 使用者回報：貼上 Threads 貼文連結、回報已發完。
 * 不需要登入，用加鹽的 IP 雜湊限制頻率。
 * 貼連結的流程：判讀、定位完先回傳預覽（outcome = 'preview'），回報的人按「對」（confirmLink）才寫進雷達，
 * 按「不對」（rejectLink）就不放，留給管理者看。
 */
import type { Env } from './env';
import { DEFAULT_MODULE, isModule, MODULE_IDS, moduleOf, type ModuleId } from './modules';
import { ADDRESS_BUDGET_MS, atLocalTimes, commitPlan, detectEnded, getEvent, getPost, locateTypedPlace, MAX_FUTURE_SEC, planManual, planPost, processPost, savedTagsOf, storePost, tagsOf, topicOf, type EventOut, type FailedItem, type ManualActivity, type PlanItem, type PostRow } from './events';
import { ACTIVITY_SPEC, cleanTags, cleanTopic, extractFromPost, MODULE_TAGS, postTags, type ActivityPart, type EventKind } from './extract';
import { adoptedTags } from './learnedTags';
import { accupassPermalink, fetchAccupass, parseAccupassUrl, type AccupassLink } from './sources/accupass';
import { eventPageText, pageTime, type EventPage, type PageFetch, type PageSession } from './sources/eventpage';
import { fetchOpentix, opentixPermalink, parseOpentixUrl, type OpentixLink } from './sources/opentix';
import { distKm } from './push';
import { fetchThreadsPost, resolveThreadsLink, shortcodeToUnix, withLocationTag } from './sources/link';
import { sha1Hex } from './sources/text';
import { creditReport, uncreditReport, type ReportReward } from './cards';
import { learnTags, manualTags } from './learnedTags';

/** 只收這麼新的貼文，太舊的公告通常已經過期（v1.696 使用者說 7 天改成 30 天：大型活動常常一個月前就公告；資料也是留 30 天） */
export const MAX_LINK_AGE_SEC = 30 * 86400;
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

/**
 * 哪些模組收回報（wrangler.toml 的 REPORTS_ENABLED）：沒設或 "true" 全部收、"false" 全部不收，
 * 也可以列出模組，例如 "current" 只收洋流、"current,food"。
 */
export function reportModules(v: string | undefined): ModuleId[] {
  const s = (v ?? 'true').trim().toLowerCase();
  if (s === 'true') return [...MODULE_IDS];
  return s.split(',').map((x) => x.trim()).filter(isModule);
}

export const REPORTS_LOCKED = '回報功能改版中，暫時關閉';

/** 這個模組的回報鎖住了：貼連結、確認、補充、說判讀錯、回報已發完、意見回饋都不收 */
export function assertReportsOpen(env: Env, module: unknown): void {
  if (!reportModules(env.REPORTS_ENABLED).includes(moduleOf(module))) throw new ReportError(503, REPORTS_LOCKED);
}

/** 回報已發完、意見回饋：看那一場是哪個模組的 */
export async function assertEventReportsOpen(env: Env, eventId: number): Promise<void> {
  const r = await env.DB.prepare('SELECT p.module FROM events e JOIN posts p ON p.id = e.post_id WHERE e.id = ?').bind(eventId).first<{ module: string | null }>();
  assertReportsOpen(env, r?.module);
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
  /** 地點是從這些帳號的名稱、簡介推的（「@luguocafe」） */
  profileHint?: string;
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
  /** 模組自己的欄位，例如職缺的工作期間、薪資、防詐提醒 */
  extra?: Record<string, unknown> | null;
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
  /** outcome = 'not_listed' 而且原因確定時：直接講是哪個原因（已經結束、太久以後才開始、判讀不出時間） */
  why?: NotListedWhy;
  /** 洋流的活動：沒放上雷達的每一場和原因 */
  failures?: FailedItem[];
  /** 判讀成不是活動時，AI 說的理由 */
  note?: string;
  /** 洋流的活動：補充資料表單預先填好的每一場（判讀出來的、沒放上雷達的），回報的人直接改 */
  edit?: EditItem[];
  /** 車掃、掃街、車隊：合成路線的（每一站的時間、會不會放上雷達），這些站不在 preview、failures 裡 */
  routes?: RoutePreview[];
  /** 確認後放上雷達了：回報的累計（滿 5 則拿到肉乾卡、每 5 則一包肉乾；今天算滿了 capped） */
  reward?: ReportReward;
}

/** 預覽上的一條車掃路線 */
export interface RoutePreview {
  title: string;
  stops: Array<{
    kind: 'start' | 'cheer' | 'end';
    name: string;
    /** 地點（地址），跟站名不一樣時才有 */
    place?: string;
    at: number;
    lat: number | null;
    lng: number | null;
    /** listed 會放上雷達；approximate 只定位到鄉鎮區、路；unlocated 查不到；passed 車隊已經經過 */
    status: 'listed' | 'approximate' | 'unlocated' | 'passed';
    area?: string;
    /** 跟這一站定位在同一點（可能查錯了） */
    sameAs?: string;
  }>;
}

/** 判讀結果裡的車掃路線，一條一條列出每一站 */
export function routePreviews(items: PlanItem[]): RoutePreview[] {
  const byKey = new Map<string, PlanItem[]>();
  for (const it of items) if (it.route) byKey.set(it.route.key, [...(byKey.get(it.route.key) ?? []), it]);
  return [...byKey.values()].map((list) => {
    const sorted = [...list].sort((a, b) => (a.route?.seq ?? 0) - (b.route?.seq ?? 0));
    return {
      title: sorted[0].route?.title ?? '',
      stops: sorted.map((it) => {
        const r = it.route as NonNullable<PlanItem['route']>;
        const status = it.plan ? 'listed' : it.reason === 'approximate' ? 'approximate' : it.reason === 'unlocated' ? 'unlocated' : 'passed';
        return { kind: r.kind, name: r.name, ...(r.place ? { place: r.place } : {}), at: r.at, lat: it.plan?.lat ?? r.lat, lng: it.plan?.lng ?? r.lng, status, ...(it.fail?.area ? { area: it.fail.area } : {}), ...(it.fail?.sameAs ? { sameAs: it.fail.sameAs } : {}) };
      }),
    };
  });
}

/** 補充資料表單的一場：時間是 unix 秒；endAt null 是沒寫結束；dateOnly 只知道哪天、不知道幾點 */
export interface EditItem {
  title: string;
  /** 主題（「遊行」「講座」）；判讀不出來是 null */
  topic?: string | null;
  /** 關鍵字（#洋流 #飄帶，不含 #）；沒有就不帶 */
  tags?: string[];
  startAt: number | null;
  dateOnly?: boolean;
  endAt: number | null;
  place: string;
  lat: number | null;
  lng: number | null;
  /** 只定位到鄉鎮區、路（約略位置） */
  approxArea?: string | null;
  /** 國外活動的當地時區：表單的時間照當地時間顯示 */
  tz?: string | null;
}

/** 判讀結果換成表單的每一場；重複的（雷達上已經有）不列 */
export function editItemsOf(items: PlanItem[]): EditItem[] {
  // 每一場自己記的關鍵字；沒記的（車掃的站、舊的判讀結果）用這則貼文的
  const own = (it: PlanItem): string[] | null => (it.plan ? savedTagsOf(it.plan.extra) : (it.fail?.tags ?? null));
  const common = items.map(own).find((t) => t && t.length > 0) ?? [];
  return items.flatMap((it): EditItem[] => {
    const t = own(it) ?? common;
    const tags = t.length > 0 ? { tags: t } : {};
    const p = it.plan;
    // 車掃的站：時間是預計經過的時間，沒有結束
    const r = it.route;
    if (p) return [{ title: p.title, topic: topicOf(p.extra), ...tags, startAt: r?.at ?? p.start_at, endAt: r || p.end_open ? null : p.end_at, place: p.place_text, lat: p.lat, lng: p.lng, approxArea: p.approx_area, ...(p.tz ? { tz: p.tz } : {}) }];
    const f = it.fail;
    // 車隊已經經過的站
    if (!f) return r ? [{ title: r.stopTitle, ...tags, startAt: r.at, endAt: null, place: r.name, lat: r.lat, lng: r.lng }] : [];
    return [
      {
        title: f.title ?? '',
        topic: f.topic ?? null,
        ...tags,
        startAt: r?.at ?? f.startAt ?? f.dateOnly ?? null,
        ...(f.dateOnly && f.startAt === undefined ? { dateOnly: true } : {}),
        endAt: !r && f.endOpen === false ? (f.endAt ?? null) : null,
        // 只寫「本店」的留空，讓回報的人填店名
        place: f.selfPlace ? '' : (f.place ?? ''),
        lat: f.lat ?? null,
        lng: f.lng ?? null,
        ...(f.area ? { approxArea: f.area } : {}),
        ...(f.tz ? { tz: f.tz } : {}),
      },
    ];
  });
}

export interface NotListedWhy {
  reason: 'already_over' | 'too_far_in_future' | 'no_start_time' | 'incomplete' | 'long_term';
  /** reason = 'incomplete'（洋流的活動）：缺了哪些，照 內容、地點、開始 的順序 */
  missing?: ActivityPart[];
  /** 那一場的時間（已經結束的取最晚的一場，太久以後的取最早的一場） */
  startAt?: number;
  endAt?: number;
  /** 國外活動的當地時區 */
  tz?: string | null;
  /** 太久以後才開始的：這天之後再貼就收得到 */
  reportFrom?: number;
}

const INCOMPLETE = 'incomplete:';
const ACTIVITY_PARTS: ActivityPart[] = ['content', 'place', 'start'];

/** 沒放上雷達的原因只有一種、而且是這幾種之一才講；好幾種原因混在一起就照舊用籠統的說法 */
export function notListedWhy(items: PlanItem[]): NotListedWhy | undefined {
  const failed = items.filter((it) => !it.plan);
  // 洋流的活動缺內容、地點或開始時間：好幾場缺的不一樣也合起來講
  if (failed.length > 0 && failed.every((it) => it.reason.startsWith(INCOMPLETE))) {
    const missing = new Set(failed.flatMap((it) => it.reason.slice(INCOMPLETE.length).split(',')));
    const parts = ACTIVITY_PARTS.filter((p) => missing.has(p));
    // 舊規則的原因（例如以前要寫結束時間）現在已經不算缺：講不出來就不講
    return parts.length > 0 ? { reason: 'incomplete', missing: parts } : undefined;
  }
  const reasons = new Set(failed.map((it) => it.reason));
  if (failed.length === 0 || reasons.size !== 1) return undefined;
  const reason = failed[0].reason;
  if (reason === 'no_start_time' || reason === 'long_term') return { reason };
  if (reason !== 'already_over' && reason !== 'too_far_in_future') return undefined;
  const timed = failed.filter((it): it is PlanItem & { start: number; end: number } => typeof it.start === 'number' && typeof it.end === 'number');
  // 固定據點的時段都過了：沒有單一時間，只說已經結束
  if (timed.length === 0) return reason === 'already_over' ? { reason } : undefined;
  const pick = timed.reduce((a, b) => (reason === 'already_over' ? (b.start > a.start ? b : a) : b.start < a.start ? b : a));
  return {
    reason,
    startAt: pick.start,
    endAt: pick.end,
    tz: pick.tz ?? null,
    ...(reason === 'too_far_in_future' ? { reportFrom: pick.start - MAX_FUTURE_SEC } : {}),
  };
}

/**
 * 判讀規則的版本：規則改了（例如結束時間改成不用寫）就加一。
 * 還沒確認的回報再貼一次時，存的是舊版的判讀結果就重新判讀，不沿用（舊的原因可能已經不成立，畫面也講不出原因）
 */
// 11：其他雷達（找工作…）也抽關鍵字（2026-11-03，之前回報、還沒確認的再貼一次要重新判讀才有）
// 12：騎車（順騎、單車）、健走也算路線，各站沒寫時間的填出發時間、程式照距離推算（2026-11-05）
// 13：連續幾天、每天幾點到幾點的活動（市集、祭典）拆成每天一場，不再一整段連到半夜（2026-11-06）
// 14：其他雷達也只收單次的：每週固定場、固定攤位、沒約時間的刊登、沒寫哪天或超過 7 天的職缺不放上雷達（2026-11-10）
export const PLAN_VERSION = 14;

/** 判讀好、還沒寫進雷達的資料，存在 posts.confirm_plan */
interface StoredPlan {
  items: PlanItem[];
  early: string | null;
  /** 不是活動時 AI 說的理由 */
  note?: string | null;
  /** 用哪一版規則判讀的（PLAN_VERSION），舊資料沒有 */
  v?: number;
  /** 判讀出來的關鍵字（回報的人直接修改過才記）：放上雷達時跟最後的比，多出來的是手動加的（learnedTags.ts 記成候選） */
  judgedTags?: string[];
}

/** 存進 posts.confirm_plan：記下判讀規則的版本 */
const storePlan = (plan: StoredPlan): string => JSON.stringify({ ...plan, v: PLAN_VERSION });

/** 確認用的代碼：拿得到預覽的人才能確認（貼文 id 加鹽雜湊，不用另外存） */
const confirmToken = async (env: Env, postId: string): Promise<string> => sha1Hex(`confirm|${postId}|${await hashSalt(env)}`, 20);

/** 同一個地點、時段（固定據點的每一天）合成一筆預覽 */
export function previewOf(items: PlanItem[], now: number): PreviewItem[] {
  const groups = new Map<number, NonNullable<PlanItem['plan']>[]>();
  const merges = new Map<number, PlanItem['merge']>();
  const hints = new Map<number, string>();
  for (const it of items) {
    if (!it.plan || it.plan.end_at <= now) continue;
    groups.set(it.group, [...(groups.get(it.group) ?? []), it.plan]);
    if (it.merge) merges.set(it.group, it.merge);
    if (it.profileHint) hints.set(it.group, it.profileHint);
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
      extra: p.extra ? (JSON.parse(p.extra) as Record<string, unknown>) : null,
      ...(m ? { update: { mode: m.mode, title: m.title } } : {}),
      ...(hints.has(group) ? { profileHint: hints.get(group) } : {}),
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
  // 洋流的活動：補充資料是一場一場的欄位（標題、時間、地點、地圖位置），先填好判讀出來的
  const edit = moduleOf(post.module) === 'current' ? { edit: editItemsOf(plan.items) } : {};
  const base = {
    existed,
    permalink: post.permalink ?? '',
    confirm: { postId: post.id, token: await confirmToken(env, post.id) },
    supplement: post.supplement ?? null,
    ...edit,
  };
  if (plan.early) return { ...base, outcome: summarize([plan.early]), reasons: [plan.early], events: [], ...(plan.note ? { note: plan.note } : {}) };
  const reasons = plan.items.filter((it) => !it.plan).map((it) => it.reason);
  const events = await eventsForResult(env, post.id, reasons, now);
  // 車掃路線的站另外列（一條路線一塊），不在一般的預覽、沒放上雷達的清單裡
  const single = plan.items.filter((it) => !it.route);
  const preview = previewOf(single, now);
  const routes = routePreviews(plan.items);
  const failures = single.flatMap((it) => (!it.plan && it.fail ? [it.fail] : []));
  const fails = { ...(failures.length > 0 ? { failures } : {}), ...(routes.length > 0 ? { routes } : {}) };
  if (preview.length === 0 && !routes.some((r) => r.stops.some((st) => st.status === 'listed'))) {
    const outcome = summarize(reasons);
    const why = outcome === 'not_listed' ? notListedWhy(plan.items) : undefined;
    return { ...base, outcome, reasons, events, ...(why ? { why } : {}), ...fails };
  }
  return { ...base, outcome: 'preview', reasons, events, preview, ...fails };
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

/** 回報次數：主要看同一個瀏覽器；IP 放寬（很多人共用一個 IP），只擋清掉瀏覽器資料一直灌的；全站也有上限 */
async function checkSubmitLimits(env: Env, ip: string, now: number, device: string | null): Promise<void> {
  if (device) await checkHourlyLimit(env, 'device', device, SUBMIT_PER_DEVICE_PER_HOUR, now, '同一個瀏覽器');
  await checkHourlyLimit(env, 'ip_hash', ip, device ? SUBMIT_PER_IP_PER_HOUR : SUBMIT_PER_IP_NO_DEVICE, now, '同一個網路');
  const all = await countSince(env, `SELECT COUNT(*) AS n FROM submissions WHERE created_at > ? AND ${NOT_SUPPLEMENT}`, [now - 3600]);
  if (all >= SUBMIT_GLOBAL_PER_HOUR) throw new ReportError(429, '目前回報的人太多，請稍後再試');
}

export const UNREADABLE_POST =
  'Threads 不讓外部讀取這則貼文，雷達讀不到內容。可能是貼文已刪除、帳號是私人帳號，或貼文限制只有登入的人才能看（例如酒類貼文限成年人觀看）。';

/**
 * 之前有人貼過這一則：還沒確認（或說判讀錯了）的再給這個人看一次預覽、放上雷達的講現在雷達上有沒有（result）；
 * 回報的人刪掉的、判讀規則改過、當時判讀失敗的要重新判讀（result 是 null）
 */
async function earlierReport(env: Env, postId: string, module: ModuleId, now: number): Promise<{ existing: PostRow | null; result: SubmitResult | null }> {
  const existing = await getPost(env, postId);
  // 之前有人貼過但還沒確認（或說判讀錯了）：再給這個人看一次預覽，讓他確認；回報的人刪掉的，重新判讀
  const waiting = existing && (existing.confirm_state === 'pending' || existing.confirm_state === 'rejected' || existing.confirm_state === 'withdrawn');
  // 還沒放上雷達、這次從別的模組貼（例如先在洋流貼了狗狗陪伴的徵人文）：改成這個模組重新判讀
  const moved = !!existing && !!waiting && moduleOf(existing.module) !== module;
  if (moved) await env.DB.prepare('UPDATE posts SET module = ? WHERE id = ?').bind(module, postId).run();
  const stored = waiting && !moved ? readPlan(existing) : null;
  // 存的判讀結果是舊版規則的、或當時判讀失敗：重新判讀
  if (existing && waiting && stored && stored.early !== 'extraction_failed' && stored.v === PLAN_VERSION) return { existing, result: await previewResult(env, existing, stored, true, now) };
  if (existing && !waiting) {
    const last = await env.DB.prepare("SELECT result FROM submissions WHERE post_id = ? AND result IS NOT NULL AND result != '\"supplement\"' ORDER BY id DESC LIMIT 1")
      .bind(postId)
      .first<{ result: string }>();
    // 補充資料的紀錄存的是 "supplement"，不是判讀結果
    const parsed = last ? (JSON.parse(last.result) as unknown) : [];
    const reasons = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    const events = await eventsForResult(env, postId, reasons, now);
    return { existing, result: { existed: true, outcome: existedOutcome(reasons, events.length), reasons, events, permalink: existing.permalink ?? '' } };
  }
  return { existing, result: null };
}

/** 處理使用者貼上的連結：讀貼文、AI 判讀、定位，回傳結果 */
export async function submitLink(env: Env, input: string, ip: string, now: number, device: string | null = null, module: ModuleId = DEFAULT_MODULE): Promise<SubmitResult> {
  assertReportsOpen(env, module);
  // 活動頁：ACCUPASS 活動通（v1.590）、OPENTIX（v1.591）
  const acc = parseAccupassUrl(input);
  if (acc) return submitEventPage(env, { site: 'accupass', link: acc }, ip, now, device, module);
  const otx = parseOpentixUrl(input);
  if (otx) return submitEventPage(env, { site: 'opentix', link: otx }, ip, now, device, module);
  const link = await resolveThreadsLink(input);
  if (!link) throw new ReportError(400, '找不到 Threads 貼文或活動頁的連結，請貼上 Threads 貼文（https://www.threads.com/@帳號/post/...）、活動通（https://www.accupass.com/event/...）或 OPENTIX（https://www.opentix.life/event/...）的網址');
  const postId = `link-${link.code}`;

  const earlier = await earlierReport(env, postId, module, now);
  if (earlier.result) return earlier.result;
  const existing = earlier.existing;

  const postedAt = shortcodeToUnix(link.code, now);
  if (postedAt === null) throw new ReportError(400, '這個連結看起來不是 Threads 貼文');
  if (now - postedAt > MAX_LINK_AGE_SEC) throw new ReportError(400, `這則貼文發布超過 ${MAX_LINK_AGE_SEC / 86400} 天，雷達只收最近的發放和活動`);

  await checkSubmitLimits(env, ip, now, device);

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
  await storePost(env, { id: postId, username, text, permalink, posted_at: postedAt, keyword: null, source: 'link', module }, now);
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
  await env.DB.prepare('UPDATE posts SET confirm_plan = ? WHERE id = ?').bind(storePlan(plan), postId).run();
  return previewResult(env, { ...post, permalink }, plan, !!existing, now);
}

/**
 * 活動頁的網站（ACCUPASS 活動通、OPENTIX）：貼文 id 的開頭、source、顯示的名字、活動頁網址、怎麼讀
 */
type PageLink = { site: 'accupass'; link: AccupassLink } | { site: 'opentix'; link: OpentixLink };
const PAGE_SITES = {
  accupass: { prefix: 'acc', name: '活動通', permalink: accupassPermalink, fetch: (l: PageLink['link']) => fetchAccupass(l as AccupassLink) },
  opentix: { prefix: 'otx', name: 'OPENTIX', permalink: opentixPermalink, fetch: (l: PageLink['link']) => fetchOpentix(l as OpentixLink) },
} as const;
type PageSite = keyof typeof PAGE_SITES;
/** 貼文 id（acc-編號、otx-編號）→ 哪個網站、活動編號 */
const pageOfPostId = (postId: string): { site: PageSite; id: string } | null => {
  const m = /^(acc|otx)-(\d+)$/.exec(postId);
  return m ? { site: m[1] === 'acc' ? 'accupass' : 'opentix', id: m[2] } : null;
};

/** 活動頁讀不到時講原因 */
function pageError(site: PageSite, f: Exclude<PageFetch, { status: 'ok' }>): ReportError {
  const name = PAGE_SITES[site].name;
  if (f.status === 'gone') return new ReportError(404, `${name}上找不到這場活動，可能已經刪除或下架了`);
  console.warn(`${site} fetch failed: ${f.message}`);
  return new ReportError(502, `暫時讀不到${name}的活動頁，請稍後再試`);
}

/**
 * 一場的時間地點 → 一場一場（跟回報的人直接修改的格式一樣）：3 天以內是一場；更長的（展覽、好幾天的市集）每天照開始、結束的時刻各一場，
 * 從還沒結束的那天起最多 6 天；沒寫開始時間、地點的回傳原因
 */
/** 從活動頁排出來的一場：多記場地名稱（地址門牌查不到時用場地名稱查） */
export type PageActivity = ManualActivity & { venue: string | null };

export function sessionActivities(ev: PageSession, now: number): PageActivity[] | string {
  const start = pageTime(ev.startDate);
  if (!Number.isFinite(start)) return '活動頁沒有寫開始時間';
  const place = [...(ev.address ?? ev.venue ?? '').replace(/\s+/g, ' ').trim()].slice(0, 80).join('');
  if (!place) return '活動頁沒有寫地點';
  const end = pageTime(ev.endDate);
  const title = [...ev.name].slice(0, 60).join('');
  const one = (startAt: number, endAt: number | null): PageActivity => ({ title, startAt, endAt, place, lat: null, lng: null, venue: ev.venue });
  const endAt = Number.isFinite(end) && end > start ? end : null;
  if (endAt === null || endAt - start <= MAX_EDIT_SPAN_SEC) return [one(start, endAt)];
  const tod = (t: number): number => (((t + 8 * 3600) % 86400) + 86400) % 86400;
  const [s0, e0] = [tod(start), tod(endAt)];
  const out: PageActivity[] = [];
  let last: PageActivity | null = null;
  for (let day = start - s0; day <= endAt - e0 && out.length < 6; day += 86400) {
    last = one(day + s0, e0 > s0 ? day + e0 : null);
    if ((last.endAt ?? last.startAt + 7200) > now) out.push(last);
  }
  // 每一天都過了：照最後一天（會判成已經結束）
  return out.length > 0 ? out : [last ?? one(start, endAt)];
}

/**
 * 整頁 → 一場一場：取消的、只有線上的場次不收（OPENTIX 的巡演每個地點各一場），最多 MAX_EDIT_ITEMS 場；一場都不能收時回傳原因
 */
export function pageActivities(page: EventPage, now: number): PageActivity[] | string {
  const live = page.sessions.filter((s) => !s.cancelled);
  if (live.length === 0) return '這場活動已經取消了';
  const offline = live.filter((s) => !s.online);
  if (offline.length === 0) return '這是線上活動，沒有實體地點；雷達只收可以到場參加的活動';
  const acts: PageActivity[] = [];
  let why = '';
  for (const s of offline) {
    const a = sessionActivities(s, now);
    if (typeof a === 'string') why = a;
    else acts.push(...a);
  }
  if (acts.length === 0) return `${why}，雷達放不上去`;
  // 還沒結束的先，照時間排
  const ended = (a: PageActivity): boolean => (a.endAt ?? a.startAt + 7200) <= now;
  return acts.sort((a, b) => Number(ended(a)) - Number(ended(b)) || a.startAt - b.startAt).slice(0, MAX_EDIT_ITEMS);
}

/** 活動頁 → 預覽用的判讀結果：時間地點照活動頁、只有分類（主題）和關鍵字問 AI（問不到就照內文寫到的常見詞） */
async function planEventPage(env: Env, page: EventPage, text: string, now: number): Promise<StoredPlan> {
  const acts = pageActivities(page, now);
  if (typeof acts === 'string') throw new ReportError(422, acts);
  const common = [...MODULE_TAGS[DEFAULT_MODULE], ...(await adoptedTags(env, DEFAULT_MODULE))];
  let topic: string | null = null;
  let tags = postTags(null, text, common);
  try {
    const { extraction } = await extractFromPost(env, text, now, now, { spec: ACTIVITY_SPEC });
    topic = cleanTopic((extraction?.events[0]?.extra as { topic?: unknown } | null | undefined)?.topic);
    tags = postTags(extraction?.tags ?? null, text, common);
  } catch (e) {
    console.warn(`event page topic failed: ${String(e)}`);
  }
  await pinByVenue(env, acts);
  const items = await planManual(env, acts.map(({ venue: _venue, ...a }) => ({ ...a, topic, tags })), now, text, null, tags);
  return { items, early: null, judgedTags: tags };
}

/** 場地名稱最後的廳名（「桃園展演中心展演廳」→「桃園展演中心」）：地圖上通常只有整棟建築的名字 */
export const venueBuilding = (venue: string): string => {
  const b = venue.replace(/\s*(?:展演廳|演藝廳|音樂廳|演奏廳|大劇院|戲劇院|實驗劇場|小劇場|劇場|大廳|會議廳|演講廳|中正堂)$/, '').trim();
  // 剩太短的（「國家音樂廳」→「國家」）就是整個名字
  return [...b].length >= 4 ? b : venue;
};

/**
 * 地址的門牌查不到、只定位到鄉鎮區（OPENTIX 的「桃園市桃園區中正路1188號」只查到桃園區）：改用場地名稱查（先整個名稱、再去掉最後的廳名），
 * 查到確切位置、而且離地址查到的鄉鎮區不到 15 km（免得對到別縣市同名的地方），就當成這一場的位置（地點欄照樣寫地址）。
 * 同一個地址和場地只查一次；查過的有快取
 */
async function pinByVenue(env: Env, acts: PageActivity[]): Promise<void> {
  const deadline = Date.now() + ADDRESS_BUDGET_MS;
  const done = new Map<string, { lat: number; lng: number } | null>();
  for (const a of acts) {
    if (!a.venue || a.venue === a.place || a.lat !== null) continue;
    const key = `${a.place}|${a.venue}`;
    if (!done.has(key)) {
      let pin: { lat: number; lng: number } | null = null;
      const byAddress = await locateTypedPlace(env, a.place, deadline);
      if (!byAddress.point || byAddress.approxArea) {
        for (const name of [...new Set([a.venue, venueBuilding(a.venue)])]) {
          const byVenue = await locateTypedPlace(env, name, deadline);
          const near = !byAddress.point || (byVenue.point && distKm(byVenue.point, byAddress.point) <= 15);
          if (byVenue.point && !byVenue.approxArea && near) {
            pin = { lat: byVenue.point.lat, lng: byVenue.point.lng };
            break;
          }
        }
      }
      done.set(key, pin);
    }
    const pin = done.get(key);
    if (pin) Object.assign(a, pin);
  }
}

/**
 * 回報活動頁（洋流的活動）：讀活動頁、照活動頁的時間地點排、定位，回傳預覽，回報的人確認才放上雷達（跟 Threads 一樣）；
 * 線上活動、已經取消的不收。貼文 id 是 acc-、otx- 加活動編號，source 是網站（accupass、opentix），原文連結是活動頁
 */
async function submitEventPage(env: Env, p: PageLink, ip: string, now: number, device: string | null, module: ModuleId): Promise<SubmitResult> {
  const site = PAGE_SITES[p.site];
  if (module !== DEFAULT_MODULE) throw new ReportError(400, `${site.name}的活動請切到「洋流雷達」再回報`);
  // 活動通分享的短網址先讀一次才知道是哪一場
  let fetched: PageFetch | null = null;
  if ('go' in p.link) {
    fetched = await site.fetch(p.link);
    if (fetched.status !== 'ok') throw pageError(p.site, fetched);
  }
  const id = fetched?.status === 'ok' ? fetched.page.id : (p.link as { id: string }).id;
  const postId = `${site.prefix}-${id}`;
  const earlier = await earlierReport(env, postId, module, now);
  if (earlier.result) return earlier.result;
  await checkSubmitLimits(env, ip, now, device);
  fetched ??= await site.fetch({ id });
  if (fetched.status !== 'ok') throw pageError(p.site, fetched);
  const page = fetched.page;
  const text = eventPageText(page);
  // 先排得出場次才存（線上、取消、沒寫時間地點的直接講原因）
  const plan = await planEventPage(env, page, text, now);
  await storePost(env, { id: postId, username: null, text, permalink: site.permalink(id), posted_at: now, keyword: null, source: p.site, module }, now);
  await env.DB.batch([
    env.DB.prepare("UPDATE posts SET checked_at = ?, text = ?, confirm_state = 'pending', confirm_plan = ? WHERE id = ?").bind(now, text, storePlan(plan), postId),
    env.DB.prepare('INSERT INTO submissions (post_id, ip_hash, device, created_at) VALUES (?, ?, ?, ?)').bind(postId, ip, device, now),
  ]);
  const post = await getPost(env, postId);
  if (!post) throw new ReportError(500, 'post not stored');
  return previewResult(env, post, plan, !!earlier.existing, now);
}

async function checkConfirm(env: Env, body: { postId?: unknown; token?: unknown }): Promise<PostRow> {
  const postId = typeof body.postId === 'string' ? body.postId : '';
  if (!/^(?:link|note|acc|otx)-[\w-]+$/.test(postId) || body.token !== (await confirmToken(env, postId))) throw new ReportError(400, '確認代碼不對，請重新貼一次連結');
  const post = await getPost(env, postId);
  if (!post) throw new ReportError(404, '找不到這則回報，請重新貼一次連結');
  assertReportsOpen(env, post.module);
  return post;
}

/** 還能補充、修改嗎：已經放上雷達的不行；沒有連結的回報（貼文字、截圖、自己填）已經停止收件 */
function assertEditable(post: PostRow, what: string): void {
  if (post.confirm_state === 'confirmed') throw new ReportError(409, `這則已經放上雷達了，不能再${what}`);
  if (post.source === 'note') throw new ReportError(410, NOTES_CLOSED);
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
  if (post.source === 'note') throw new ReportError(410, NOTES_CLOSED);
  const result = await commitPlan(env, post.id, plan.items, now);
  await env.DB.batch([
    env.DB.prepare("UPDATE posts SET confirm_state = 'confirmed', confirm_plan = NULL WHERE id = ?").bind(post.id),
    // 舊版網頁送出時沒帶裝置代碼：確認的人補上，之後才能自己刪除
    // 寫在這則最後一筆回報上；補充資料的紀錄不動（不然補充會被當成回報、補充次數也少算）
    env.DB.prepare(`UPDATE submissions SET result = ?, device = COALESCE(device, ?) WHERE id = (SELECT MAX(id) FROM submissions WHERE post_id = ? AND ${NOT_SUPPLEMENT})`).bind(JSON.stringify(result.reasons), device, post.id),
  ]);
  const outcome = summarize(result.reasons);
  const reward = await afterListed(env, post, plan, outcome, device, now);
  return { existed: false, outcome, reasons: result.reasons, events: await eventsForResult(env, post.id, result.reasons, now), permalink, ...(reward ? { reward } : {}) };
}

/**
 * 放上雷達了：算一則回報（收集卡、道具；算失敗不影響回報）；
 * 回報的人直接修改時手動加的關鍵字記成候選，管理者採用了之後的判讀才用（記失敗不影響回報）
 */
async function afterListed(env: Env, post: PostRow, plan: StoredPlan, outcome: LinkOutcome, device: string | null, now: number): Promise<ReportReward | null> {
  if (outcome !== 'added') return null;
  const reward = await creditReport(env, device, post.id, now).catch((e) => (console.warn('credit failed', e), null));
  if (plan.judgedTags) {
    const module = moduleOf(post.module);
    const final = plan.items.flatMap((it) => (it.plan ? tagsOf(it.plan.extra) : []));
    const added = manualTags(module, final, plan.judgedTags);
    if (added.length > 0) await learnTags(env, module, added, post.id, now).catch((e) => console.warn('learn tags failed', e));
  }
  return reward;
}

/** 一則貼文最多補充幾次（每次都要再跑一次 AI） */
const SUPPLEMENTS_PER_POST = 5;

/**
 * 回報的人補充地點或時間（貼文沒寫、判讀不出來時）：接在貼文後面再判讀一次，回傳新的預覽。
 * 補充的內容會顯示在雷達的詳細資料上（「回報的人補充」），看的人知道哪些不是原貼文寫的。
 */
export async function supplementLink(env: Env, body: { postId?: unknown; token?: unknown; note?: unknown }, ip: string, now: number, device: string | null = null): Promise<SubmitResult> {
  const post = await checkConfirm(env, body);
  assertEditable(post, '補充');
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
  await env.DB.prepare("UPDATE posts SET supplement = ?, confirm_plan = ?, confirm_state = 'pending' WHERE id = ?").bind(note, storePlan(plan), post.id).run();
  return previewResult(env, updated, plan, false, now);
}

/** 直接修改資料不用問 AI（只查地點），一則可以多改幾次；跟補充資料算在一起 */
const EDITS_PER_POST = 10;
// 車掃的站最多 20 個（跟判讀一樣）
const MAX_EDIT_ITEMS = 20;
/** 一場活動最長多久（開始到結束）：v1.567 使用者說「活動持續三天以內」都要收（原本 24 小時，兩天的市集填不進去） */
export const MAX_EDIT_SPAN_SEC = 3 * 86400;

/** 表單送來的每一場：標題、地點、開始時間一定要有；結束可以不填；有標地圖位置才帶座標 */
export function parseEditItems(raw: unknown): ManualActivity[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new ReportError(400, '至少要填一場活動');
  if (raw.length > MAX_EDIT_ITEMS) throw new ReportError(400, `一則最多 ${MAX_EDIT_ITEMS} 場`);
  const text = (v: unknown, max: number): string => (typeof v === 'string' ? [...v.replace(/\s+/g, ' ').trim()].slice(0, max).join('') : '');
  const coord = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? v : null);
  return raw.map((r, i): ManualActivity => {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const at = raw.length > 1 ? `第 ${i + 1} 場：` : '';
    const title = text(o.title, 60);
    const place = text(o.place, 80);
    if (!title) throw new ReportError(400, `${at}請填活動內容`);
    if (!place) throw new ReportError(400, `${at}請填地點`);
    if (!Number.isSafeInteger(o.startAt)) throw new ReportError(400, `${at}請填哪天幾點開始`);
    const startAt = o.startAt as number;
    const endAt = o.endAt === null || o.endAt === undefined ? null : Number.isSafeInteger(o.endAt) ? (o.endAt as number) : NaN;
    if (endAt !== null && !(endAt > startAt && endAt - startAt <= MAX_EDIT_SPAN_SEC)) throw new ReportError(400, `${at}結束時間要在開始之後的 3 天內`);
    const lat = coord(o.lat, 90);
    const lng = coord(o.lng, 180);
    // 關鍵字：新版網頁一定送（全部拿掉是空的），舊版沒送就沿用判讀出來的
    const tags = Array.isArray(o.tags) ? { tags: cleanTags(o.tags.slice(0, 20)) } : {};
    return { title, topic: cleanTopic(text(o.topic, 12)), ...tags, startAt, endAt, place, lat: lat !== null && lng !== null ? lat : null, lng: lat !== null && lng !== null ? lng : null };
  });
}

/** 「10/26 18:00」：台北時間，國外的活動用當地時間 */
function whenText(t: number, tz: string | null = null): string {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz ?? 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(fmt.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

/**
 * 回報的人改了哪些（跟判讀結果比），寫在雷達詳細資料的「回報的人補充」，看的人知道哪些不是原貼文寫的。
 * listed 是每一場有沒有排上雷達：沒排上的不寫；unit 是「場」，車掃的是「站」
 */
export function editSummary(before: EditItem[], after: ManualActivity[], listed: boolean[] = after.map(() => true), unit = '場', tzs: Array<string | null> = []): string | null {
  const shown = after.filter((_, i) => listed[i]).length;
  let no = 0;
  const parts = after.flatMap((a, i) => {
    if (!listed[i]) return [];
    no++;
    const b = before[i];
    const changes: string[] = [];
    if (b && (b.topic ?? null) !== (a.topic ?? null) && a.topic) changes.push(`主題「${a.topic}」`);
    if (!b || b.title !== a.title) changes.push(`內容「${a.title}」`);
    if (!b || b.dateOnly || b.startAt !== a.startAt || b.endAt !== a.endAt) {
      const tz = tzs[i] ?? null;
      changes.push(`時間 ${whenText(a.startAt, tz)}${a.endAt === null ? ' 開始' : `–${whenText(a.endAt, tz).split(' ')[1]}`}${tz ? '（當地時間）' : ''}`);
    }
    if (!b || b.place !== a.place) changes.push(`地點「${a.place}」`);
    if (a.lat !== null) changes.push('在地圖上標了位置');
    if (a.tags && a.tags.join(' ') !== (b?.tags ?? []).join(' ')) changes.push(a.tags.length > 0 ? `關鍵字 ${a.tags.map((t) => `#${t}`).join(' ')}` : '關鍵字（全部拿掉）');
    return changes.length > 0 ? [`${shown > 1 ? `第 ${no} ${unit}` : ''}${changes.join('、')}`] : [];
  });
  return parts.length > 0 ? [...`改了${parts.join('；')}`].slice(0, 200).join('') : null;
}

/**
 * 回報的人直接修改每一場的標題、時間、地點、地圖位置（洋流的活動）：不再問 AI，照填的資料排、定位，回傳新的預覽。
 * 改了哪些記在補充（雷達詳細資料寫「回報的人補充」），看的人知道哪些不是原貼文寫的。
 */
export async function editLink(env: Env, body: { postId?: unknown; token?: unknown; items?: unknown; localTimes?: unknown }, ip: string, now: number, device: string | null = null): Promise<SubmitResult> {
  const post = await checkConfirm(env, body);
  assertEditable(post, '修改');
  if (moduleOf(post.module) !== 'current') throw new ReportError(400, '這個類別還不能直接修改，請用補充資料');
  const parsed = parseEditItems(body.items);
  // 新版網頁填的是活動當地的時間：國外的換成當地時間的時間點（舊版網頁一律是台北時間）
  const acts = body.localTimes === true ? await atLocalTimes(env, parsed) : parsed;
  const times = await countSince(env, "SELECT COUNT(*) AS n FROM submissions WHERE post_id = ? AND result = '\"supplement\"'", [post.id]);
  if (times >= EDITS_PER_POST) throw new ReportError(429, '這則已經修改太多次了，請聯絡管理者');
  await env.DB.prepare("INSERT INTO submissions (post_id, ip_hash, device, result, created_at) VALUES (?, ?, ?, '\"supplement\"', ?)").bind(post.id, ip, device, now).run();

  const stored = readPlan(post);
  // 車掃：路線名稱沿用判讀出來的
  const routeTitle = stored?.items.find((it) => it.route)?.route?.title ?? null;
  // 舊版網頁沒送關鍵字：沿用判讀出來的
  const tags = stored?.items.map((it) => (it.plan ? tagsOf(it.plan.extra) : (it.fail?.tags ?? []))).find((t) => t.length > 0) ?? [];
  const items = await planManual(env, keepLocated(acts, stored?.items ?? []), now, post.text, routeTitle, tags);
  const tzs = items.map((it) => it.plan?.tz ?? it.fail?.tz ?? null);
  const note = editSummary(stored ? editItemsOf(stored.items) : [], acts, items.map((it) => !!it.plan), items.some((it) => it.route) ? '站' : '場', tzs) ?? post.supplement ?? null;
  // 判讀出來的關鍵字：改過好幾次的，照第一次改之前的
  const plan: StoredPlan = { items, early: null, judgedTags: stored?.judgedTags ?? tags };
  await env.DB.prepare("UPDATE posts SET supplement = ?, confirm_plan = ?, confirm_state = 'pending' WHERE id = ?").bind(note, storePlan(plan), post.id).run();
  return previewResult(env, { ...post, supplement: note }, plan, false, now);
}

/** 表單的地點欄：瀏覽器拿掉換行、送出時空白縮成一個、最多 80 字（跟 parseEditItems 一樣），用來比對地點有沒有改 */
const placeKey = (s: string): string => [...s.replace(/[\r\n]/g, '').replace(/\s+/g, ' ').trim()].slice(0, 80).join('');

/**
 * 地點沒改、也沒在地圖上標的場次：沿用之前查到的位置（v1.587 使用者說「原本判讀有定位到地址，但補充資料更新預覽後卻定位不到」：
 * 判讀時用 AI 整理的查詢字串、貼文寫的縣市一起查，表單只送地點的文字，再查一次可能查不到）。
 * 只定位到鄉鎮區的約略位置不沿用（照填的再查一次）；沿用的位置不算回報的人標的（補充不寫「在地圖上標了位置」）
 */
export function keepLocated(acts: ManualActivity[], before: PlanItem[]): ManualActivity[] {
  const known = new Map<string, { lat: number; lng: number }>();
  for (const it of before) {
    const p = it.plan;
    if (p && p.lat !== null && p.lng !== null && !p.approx_area) known.set(placeKey(p.place_text), { lat: p.lat, lng: p.lng });
  }
  return acts.map((a) => {
    const k = a.lat === null ? known.get(placeKey(a.place)) : undefined;
    return k ? { ...a, ...k } : a;
  });
}

/** 修改表單按「查地點」：一則最多查幾次（每次可能打好幾次 Nominatim） */
const LOCATES_PER_POST = 30;

export interface LocateResult {
  found: boolean;
  lat: number | null;
  lng: number | null;
  /** 查到的地名（國外的是 Nominatim 的完整地址） */
  name: string | null;
  /** 只定位到鄉鎮區、路、城市（約略位置） */
  approxArea: string | null;
  /** 國外的當地時區 */
  tz: string | null;
}

/**
 * 修改表單裡先查填的地點，在小地圖上標出來給回報的人看（查法跟送出後一樣，結果有快取）。
 * 要有這則回報的確認代碼；次數記在 settings（locate:貼文 id），清舊回報時一起清
 */
export async function locateForEdit(env: Env, body: { postId?: unknown; token?: unknown; place?: unknown }, now: number): Promise<LocateResult> {
  const post = await checkConfirm(env, body);
  assertEditable(post, '修改');
  if (moduleOf(post.module) !== 'current') throw new ReportError(400, '這個類別還不能直接修改，請用補充資料');
  const place = typeof body.place === 'string' ? [...body.place.replace(/\s+/g, ' ').trim()].slice(0, 80).join('') : '';
  if (place.length < 2) throw new ReportError(400, '請先填地點');
  const key = `locate:${post.id}`;
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  const times = Number(row?.value ?? 0) || 0;
  if (times >= LOCATES_PER_POST) throw new ReportError(429, '這則查太多次了，請直接在地圖上標位置');
  await env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, String(times + 1), now)
    .run();
  const r = await locateTypedPlace(env, place, Date.now() + ADDRESS_BUDGET_MS);
  return { found: !!r.point, lat: r.point?.lat ?? null, lng: r.point?.lng ?? null, name: r.point?.displayName ?? null, approxArea: r.approxArea, tz: r.tz };
}

/** 回報的人說判讀錯了：不放上雷達，記下哪裡錯給管理者看 */
export async function rejectLink(env: Env, body: { postId?: unknown; token?: unknown; note?: unknown }): Promise<{ ok: true }> {
  const post = await checkConfirm(env, body);
  if (post.confirm_state === 'confirmed') throw new ReportError(409, '這則已經有人確認放上雷達了；有錯可以在詳細資料回報');
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
  await env.DB.prepare("UPDATE posts SET confirm_state = 'rejected', confirm_note = COALESCE(NULLIF(?, ''), confirm_note) WHERE id = ?").bind(note, post.id).run();
  return { ok: true };
}

/** 我的回報（用同一個瀏覽器回報、確認放上雷達的，包括沒有連結的）：on_radar 在雷達上、attached 附在別的據點、not_listed 已結束或沒放上 */
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
  /** 回報在哪個模組 */
  module: string;
}

/**
 * 這個裝置 30 天內回報、有放上雷達的貼文（附在別的據點的也算）。還沒確認、說判讀錯了、跟雷達上重複而沒放上的不列。
 * 回報紀錄 30 天後刪除，更早的就認不出來了。
 */
export async function myReports(env: Env, device: string): Promise<MyReport[]> {
  // 先把這個裝置的回報照貼文合起來（同一則補充、修改會有好幾筆；idx_submissions_device_post 不用回表），每一則貼文只查一次 posts、events。
  // CROSS JOIN、+p.source：一定從這個裝置的回報找貼文（照 source 的索引會把所有回報的貼文讀一遍）
  const { results: posts } = await env.DB.prepare(
    `SELECT p.id, p.permalink, p.username, p.text, p.confirm_state, p.link_role, p.module, m.reported_at
       FROM (SELECT post_id, MAX(created_at) AS reported_at FROM submissions WHERE device = ? GROUP BY post_id) m
       CROSS JOIN posts p ON p.id = m.post_id
      WHERE +p.source IN ('link', 'note', 'accupass', 'opentix') AND p.confirm_state = 'confirmed'
        AND (p.link_role = 'related' OR EXISTS (SELECT 1 FROM events e WHERE e.post_id = p.id))
      ORDER BY m.reported_at DESC LIMIT 30`,
  )
    .bind(device)
    .all<{ id: string; permalink: string | null; username: string | null; text: string; confirm_state: string | null; link_role: string | null; module: string; reported_at: number }>();
  if (posts.length === 0) return [];
  const { results: evs } = await env.DB.prepare(
    // +status：照 post_id 的索引找這幾則（用 status 的索引會把雷達上所有進行中、即將開始的都讀一遍）
    `SELECT id, post_id, title FROM events WHERE +status IN ('upcoming', 'active') AND post_id IN (${posts.map(() => '?').join(',')}) ORDER BY start_at`,
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
      module: moduleOf(p.module),
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
  if (!post || !['link', 'note', 'accupass', 'opentix'].includes(post.source)) throw new ReportError(404, '找不到這則回報');
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
    // 車掃路線跟著事件一起拿掉
    env.DB.prepare('DELETE FROM routes WHERE post_id = ?').bind(postId),
    ...restore,
    prev.length > 0
      ? env.DB.prepare("UPDATE posts SET linked_to = ? WHERE linked_to = ? AND link_role = 'related'").bind(prev[0].id, postId)
      : env.DB.prepare("UPDATE posts SET linked_to = NULL, link_role = NULL WHERE linked_to = ? AND link_role = 'related'").bind(postId),
    env.DB.prepare("UPDATE posts SET linked_to = NULL, link_role = NULL WHERE linked_to = ? AND link_role = 'previous'").bind(postId),
    env.DB.prepare("UPDATE posts SET confirm_state = 'withdrawn', confirm_plan = NULL, linked_to = NULL, link_role = NULL WHERE id = ?").bind(postId),
  ]);
  // 自己刪掉的回報不算進累計（已經給的卡、道具不收回）
  await uncreditReport(env, postId);
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
  if (ev.source === 'site') throw new ReportError(400, '主辦單位公告的活動不開放回報，以主辦單位公布為準');
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
     WHERE p.source IN ('link', 'spot', 'accupass', 'opentix') AND e.status IN ('upcoming', 'active') AND (p.checked_at IS NULL OR p.checked_at <= ?)
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
    const pg = pageOfPostId(row.id);
    if (pg) {
      await recheckEventPage(env, pg, row, now, out, endAll);
      continue;
    }
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

/**
 * 重讀活動頁（活動通、OPENTIX）：不見了就下架、全部標成取消就結束；時間、地點、名稱、場次改了，照新的活動頁重排
 * （活動頁就是主辦單位的公告，不用再問回報的人）
 */
async function recheckEventPage(env: Env, pg: { site: PageSite; id: string }, row: { id: string; text: string }, now: number, out: RecheckLinksResult, endAll: (postId: string, reason: string) => Promise<unknown>): Promise<void> {
  const r = await PAGE_SITES[pg.site].fetch({ id: pg.id });
  await env.DB.prepare('UPDATE posts SET checked_at = ? WHERE id = ?').bind(now, row.id).run();
  if (r.status === 'gone') {
    await endAll(row.id, 'deleted');
    out.deleted++;
    return;
  }
  if (r.status !== 'ok') return;
  if (r.page.sessions.every((s) => s.cancelled)) {
    await endAll(row.id, 'author');
    out.ended++;
    return;
  }
  const text = eventPageText(r.page);
  if (text === row.text) return;
  out.edited++;
  let plan: StoredPlan;
  try {
    plan = await planEventPage(env, r.page, text, now);
  } catch (e) {
    // 新的活動頁排不上（例如改成線上、拿掉時間）：舊的先下架
    console.warn(`event page replan failed for ${row.id}: ${String(e)}`);
    await endAll(row.id, 'author');
    return;
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM ended_reports WHERE event_id IN (SELECT id FROM events WHERE post_id = ? AND status IN ('upcoming', 'active', 'unlocated'))").bind(row.id),
    env.DB.prepare("DELETE FROM events WHERE post_id = ? AND status IN ('upcoming', 'active', 'unlocated')").bind(row.id),
    env.DB.prepare('UPDATE posts SET text = ? WHERE id = ?').bind(text, row.id),
  ]);
  await commitPlan(env, row.id, plan.items, now);
}

/** 隱私權政策承諾：回報紀錄（IP 雜湊）最多留 30 天 */
export async function purgeReports(env: Env, cutoff: number): Promise<number> {
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM submissions WHERE created_at < ?').bind(cutoff),
    env.DB.prepare('DELETE FROM ended_reports WHERE created_at < ?').bind(cutoff),
    env.DB.prepare('UPDATE spot_requests SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at < ?').bind(cutoff),
    env.DB.prepare("DELETE FROM settings WHERE key LIKE 'locate:%' AND updated_at < ?").bind(cutoff),
  ]);
  return r.reduce((n, x) => n + (x.meta.changes ?? 0), 0);
}

/**
 * 沒有連結的回報（v1.578–v1.587：貼文字、上傳截圖、自己填，posts.source = 'note'）已經拿掉了（v1.588 使用者說「文字貼圖跟自己填先拿掉」）：
 * 不收新的、還沒確認的不能再確認或修改；已經放上雷達的照樣顯示（未查證），回報的人在「我的回報」還能刪除
 */
export const NOTES_CLOSED = '沒有連結的回報（貼文字、截圖、自己填）已經拿掉了，請貼 Threads 貼文的連結';
