import type { Env } from './env';
import { FEEDBACK_KINDS } from './feedback';
// 照位置算縣市、鄉鎮市區：跟網站共用同一份資料（web/src/places-tw.ts）
import { whereOf } from '../../web/src/where';

/**
 * 統計頁（stats.html，只有管理者看得到；v1.693 使用者說統計分享的 Threads 帳號、關鍵字、主題，其他我想）：
 * 最近幾天（資料只留 30 天）大家回報的貼文、放上雷達的活動，全部只回數字（不回裝置代碼、IP、貼文內容）。
 * 時間都照台灣時間算（國外的活動照當地時間）
 */
export interface StatsOut {
  days: number;
  from: number;
  now: number;
  totals: {
    /** 按送出的次數（含補充資料再判讀） */
    submits: number;
    /** 補充資料再判讀的次數 */
    supplements: number;
    /** 回報的貼文（不重複） */
    posts: number;
    /** 確認放上雷達的貼文 */
    confirmed: number;
    /** 放上雷達的活動（一場一筆，連續好幾天的每天一筆） */
    events: number;
    /** 回報的人（照裝置算，沒有裝置代碼的照網路算） */
    reporters: number;
    /** 回報的 Threads 帳號（不重複） */
    accounts: number;
    /** 回報問題 */
    feedback: number;
  };
  /** 每天（台灣時間）：送出幾次、回報幾則貼文、幾則放上雷達 */
  daily: Array<{ day: string; submits: number; posts: number; confirmed: number }>;
  /** 回報的貼文後來怎麼了 */
  outcomes: { confirmed: number; rejected: number; withdrawn: number; open: number };
  /** Threads 帳號：回報幾則、放上雷達幾則、幾場活動 */
  accounts: Array<{ username: string; posts: number; confirmed: number; events: number }>;
  /** 主題（AI 判讀的原文，一則貼文同一個主題算一次） */
  topics: Array<{ name: string; count: number }>;
  /** 關鍵字（一則貼文同一個關鍵字算一次） */
  tags: Array<{ name: string; count: number }>;
  /** 各雷達、來源（貼文數） */
  modules: Array<{ name: string; count: number }>;
  sources: Array<{ name: string; count: number }>;
  /** 活動在星期幾、幾點開始（0 = 週日；一場算一次） */
  weekdays: number[];
  hours: number[];
  /** 活動的位置（一則貼文同一個地點算一次，緯度、經度到小數 3 位；網頁照最近的鄉鎮市區算在哪個縣市、區） */
  places: Array<[number, number]>;
  /** 回報的人放上雷達幾則：1 則、2–4、5–9、10 則以上各幾人 */
  reporterBuckets: { one: number; few: number; some: number; many: number };
  /** 回報問題：每一種幾筆 */
  feedbackKinds: Array<{ name: string; count: number }>;
  bottles: { thrown: number; picks: number };
  /** 開了手機通知的（全部，不限天數） */
  pushSubscribers: number;
}

/** 回報來的貼文（官方航線、新聞、主辦單位公告不算） */
const REPORT_SOURCES = "('link', 'note', 'accupass', 'opentix')";
const SOURCE_NAMES: Record<string, string> = { link: 'Threads', note: '沒有連結（已停用）', accupass: 'ACCUPASS 活動通', opentix: 'OPENTIX' };
const MODULE_NAMES: Record<string, string> = { current: '洋流雷達', dog: '狗狗陪伴', badminton: '羽球臨打', food: '美食品味', work: '找工作' };

/** 台灣時間的日期「2026-11-13」 */
const taipeiDay = (t: number): string => new Date((t + 8 * 3600) * 1000).toISOString().slice(0, 10);

/** 一場活動開始的星期幾、幾點（照活動的時區，沒有就台灣） */
function localParts(t: number, tz: string | null): { wd: number; h: number } {
  if (!tz || tz === 'Asia/Taipei') {
    const d = new Date((t + 8 * 3600) * 1000);
    return { wd: d.getUTCDay(), h: d.getUTCHours() };
  }
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
    return { wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), h: Number(p.hour) % 24 };
  } catch {
    const d = new Date((t + 8 * 3600) * 1000);
    return { wd: d.getUTCDay(), h: d.getUTCHours() };
  }
}

const top = (m: Map<string, number>, n: number): Array<{ name: string; count: number }> =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
const bump = (m: Map<string, number>, k: string, by = 1): void => {
  m.set(k, (m.get(k) ?? 0) + by);
};

export async function adminStats(env: Env, now: number, days: number): Promise<StatsOut> {
  const from = now - days * 86400;
  const [subs, posts, events, credits, feedback, bottles, push] = await env.DB.batch([
    env.DB.prepare('SELECT post_id, device, ip_hash, result, created_at FROM submissions WHERE created_at >= ?').bind(from),
    env.DB.prepare(`SELECT id, username, source, module, confirm_state, fetched_at FROM posts WHERE fetched_at >= ? AND source IN ${REPORT_SOURCES}`).bind(from),
    env.DB.prepare(
      `SELECT e.post_id, e.extra, e.start_at, e.tz, e.lat, e.lng, e.place_text FROM events e JOIN posts p ON p.id = e.post_id
        WHERE p.fetched_at >= ? AND p.source IN ${REPORT_SOURCES} AND p.confirm_state = 'confirmed' AND e.merged_into IS NULL`,
    ).bind(from),
    env.DB.prepare('SELECT COUNT(*) AS n FROM report_credits WHERE created_at >= ? GROUP BY device_id').bind(from),
    env.DB.prepare('SELECT kind, COUNT(*) AS n FROM event_feedback WHERE created_at >= ? GROUP BY kind').bind(from),
    env.DB.prepare('SELECT COUNT(*) AS thrown, COALESCE(SUM(picks), 0) AS picks FROM bottles WHERE created_at >= ?').bind(from),
    env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions'),
  ]);
  type Sub = { post_id: string; device: string | null; ip_hash: string; result: string | null; created_at: number };
  type Post = { id: string; username: string | null; source: string; module: string | null; confirm_state: string | null; fetched_at: number };
  type Ev = { post_id: string; extra: string | null; start_at: number; tz: string | null; lat: number | null; lng: number | null; place_text: string };
  const subRows = subs.results as Sub[];
  const postRows = posts.results as Post[];
  const evRows = events.results as Ev[];

  // 每天
  const dayList = Array.from({ length: days }, (_, i) => taipeiDay(now - (days - 1 - i) * 86400));
  const daily = new Map(dayList.map((d) => [d, { day: d, submits: 0, posts: 0, confirmed: 0 }]));
  for (const s of subRows) {
    const d = daily.get(taipeiDay(s.created_at));
    if (d) d.submits++;
  }
  for (const p of postRows) {
    const d = daily.get(taipeiDay(p.fetched_at));
    if (!d) continue;
    d.posts++;
    if (p.confirm_state === 'confirmed') d.confirmed++;
  }

  // 帳號、雷達、來源、結果
  const acc = new Map<string, { username: string; posts: number; confirmed: number; events: number }>();
  const modules = new Map<string, number>();
  const sources = new Map<string, number>();
  const outcomes = { confirmed: 0, rejected: 0, withdrawn: 0, open: 0 };
  const userOf = new Map<string, string>();
  for (const p of postRows) {
    bump(modules, MODULE_NAMES[p.module ?? 'current'] ?? p.module ?? '洋流雷達');
    bump(sources, SOURCE_NAMES[p.source] ?? p.source);
    if (p.confirm_state === 'confirmed') outcomes.confirmed++;
    else if (p.confirm_state === 'rejected') outcomes.rejected++;
    else if (p.confirm_state === 'withdrawn') outcomes.withdrawn++;
    else outcomes.open++;
    if (p.source !== 'link' || !p.username) continue;
    userOf.set(p.id, p.username);
    const a = acc.get(p.username) ?? { username: p.username, posts: 0, confirmed: 0, events: 0 };
    a.posts++;
    if (p.confirm_state === 'confirmed') a.confirmed++;
    acc.set(p.username, a);
  }

  // 活動：主題、關鍵字、星期、時段、地點
  const topics = new Map<string, number>();
  const tags = new Map<string, number>();
  const seenTopic = new Set<string>();
  const seenTag = new Set<string>();
  const seenPlace = new Set<string>();
  const weekdays = Array<number>(7).fill(0);
  const hours = Array<number>(24).fill(0);
  const places: Array<[number, number]> = [];
  for (const e of evRows) {
    let extra: { topic?: unknown; tags?: unknown } = {};
    try {
      extra = e.extra ? (JSON.parse(e.extra) as typeof extra) : {};
    } catch {
      /* 壞掉的不算 */
    }
    if (typeof extra.topic === 'string' && extra.topic && !seenTopic.has(`${e.post_id}|${extra.topic}`)) {
      seenTopic.add(`${e.post_id}|${extra.topic}`);
      bump(topics, extra.topic);
    }
    for (const t of Array.isArray(extra.tags) ? extra.tags : []) {
      if (typeof t !== 'string' || !t || seenTag.has(`${e.post_id}|${t}`)) continue;
      seenTag.add(`${e.post_id}|${t}`);
      bump(tags, t);
    }
    const { wd, h } = localParts(e.start_at, e.tz);
    if (wd >= 0) weekdays[wd]++;
    hours[h]++;
    const user = userOf.get(e.post_id);
    if (user) acc.get(user)!.events++;
    if (e.lat !== null && e.lng !== null && !seenPlace.has(`${e.post_id}|${e.place_text}`)) {
      seenPlace.add(`${e.post_id}|${e.place_text}`);
      places.push([Math.round(e.lat * 1000) / 1000, Math.round(e.lng * 1000) / 1000]);
    }
  }

  // 回報的人
  const people = new Set(subRows.map((s) => s.device ?? `ip:${s.ip_hash}`));
  const reporterBuckets = { one: 0, few: 0, some: 0, many: 0 };
  for (const r of credits.results as Array<{ n: number }>) {
    if (r.n >= 10) reporterBuckets.many++;
    else if (r.n >= 5) reporterBuckets.some++;
    else if (r.n >= 2) reporterBuckets.few++;
    else reporterBuckets.one++;
  }
  const fbRows = feedback.results as Array<{ kind: string; n: number }>;
  const b = bottles.results[0] as { thrown: number; picks: number } | undefined;

  return {
    days,
    from,
    now,
    totals: {
      submits: subRows.length,
      supplements: subRows.filter((s) => s.result === '"supplement"').length,
      posts: postRows.length,
      confirmed: outcomes.confirmed,
      events: evRows.length,
      reporters: people.size,
      accounts: acc.size,
      feedback: fbRows.reduce((n, r) => n + r.n, 0),
    },
    daily: [...daily.values()],
    outcomes,
    accounts: [...acc.values()].sort((x, y) => y.posts - x.posts || y.events - x.events || x.username.localeCompare(y.username)).slice(0, 30),
    topics: top(topics, 20),
    tags: top(tags, 30),
    modules: top(modules, 10),
    sources: top(sources, 10),
    weekdays,
    hours,
    places: places.slice(0, 3000),
    reporterBuckets,
    feedbackKinds: fbRows.map((r) => ({ name: FEEDBACK_KINDS[r.kind as keyof typeof FEEDBACK_KINDS] ?? r.kind, count: r.n })).sort((x, y) => y.count - x.count),
    bottles: { thrown: b?.thrown ?? 0, picks: b?.picks ?? 0 },
    pushSubscribers: (push.results[0] as { n: number } | undefined)?.n ?? 0,
  };
}

/**
 * 雷達統計（numbers.html，大家都看得到；v1.694 使用者問有沒有可以公開的統計）：最近 30 天大家回報、放上雷達的活動，
 * 只有加總的數字：每天幾場、主題、縣市和鄉鎮市區、星期幾、幾點、各雷達、漂流瓶。不回帳號、關鍵字、座標、是誰回報的。
 * 一小時算一次存在 settings（大家看同一份，不會每打開一次就讀一次資料庫）
 */
export interface PublicStatsOut {
  days: number;
  updatedAt: number;
  totals: { events: number; posts: number; reporters: number };
  /** 照活動那天（台灣時間），最近 30 天到今天 */
  daily: Array<{ day: string; events: number }>;
  /** AI 判讀的主題（一則貼文同一個主題算一次；網頁照地圖小圖示分類） */
  topics: Array<{ name: string; count: number }>;
  counties: Array<{ name: string; count: number }>;
  towns: Array<{ name: string; count: number }>;
  abroad: number;
  weekdays: number[];
  hours: number[];
  modules: Array<{ name: string; count: number }>;
  bottles: { thrown: number; picks: number };
}

const PUBLIC_KEY = 'stats:public';
const PUBLIC_EVERY_SEC = 3600;

export async function publicStats(env: Env, now: number): Promise<PublicStatsOut> {
  const cached = await env.DB.prepare('SELECT value, updated_at FROM settings WHERE key = ?').bind(PUBLIC_KEY).first<{ value: string; updated_at: number }>();
  if (cached && now - cached.updated_at < PUBLIC_EVERY_SEC) {
    try {
      return JSON.parse(cached.value) as PublicStatsOut;
    } catch {
      /* 壞掉的重算 */
    }
  }
  const days = 30;
  const from = now - days * 86400;
  const [events, posts, credits, bottles] = await env.DB.batch([
    env.DB.prepare(
      `SELECT e.post_id, e.extra, e.start_at, e.tz, e.lat, e.lng, e.place_text, p.module FROM events e JOIN posts p ON p.id = e.post_id
        WHERE e.start_at >= ? AND e.start_at <= ? AND p.source IN ${REPORT_SOURCES} AND p.confirm_state = 'confirmed' AND e.merged_into IS NULL AND e.lat IS NOT NULL`,
    ).bind(from, now),
    env.DB.prepare(`SELECT module FROM posts WHERE fetched_at >= ? AND source IN ${REPORT_SOURCES} AND confirm_state = 'confirmed'`).bind(from),
    env.DB.prepare('SELECT COUNT(DISTINCT device_id) AS n FROM report_credits WHERE created_at >= ?').bind(from),
    env.DB.prepare('SELECT COUNT(*) AS thrown, COALESCE(SUM(picks), 0) AS picks FROM bottles WHERE created_at >= ?').bind(from),
  ]);
  type Ev = { post_id: string; extra: string | null; start_at: number; tz: string | null; lat: number; lng: number; place_text: string; module: string | null };
  const evRows = events.results as Ev[];
  const dayList = Array.from({ length: days }, (_, i) => taipeiDay(now - (days - 1 - i) * 86400));
  const daily = new Map(dayList.map((d) => [d, { day: d, events: 0 }]));
  const topics = new Map<string, number>();
  const counties = new Map<string, number>();
  const towns = new Map<string, number>();
  const seenTopic = new Set<string>();
  const seenPlace = new Set<string>();
  const weekdays = Array<number>(7).fill(0);
  const hours = Array<number>(24).fill(0);
  let abroad = 0;
  for (const e of evRows) {
    const d = daily.get(taipeiDay(e.start_at));
    if (d) d.events++;
    let extra: { topic?: unknown } = {};
    try {
      extra = e.extra ? (JSON.parse(e.extra) as typeof extra) : {};
    } catch {
      /* 壞掉的不算 */
    }
    if (typeof extra.topic === 'string' && extra.topic && !seenTopic.has(`${e.post_id}|${extra.topic}`)) {
      seenTopic.add(`${e.post_id}|${extra.topic}`);
      bump(topics, extra.topic);
    }
    const { wd, h } = localParts(e.start_at, e.tz);
    if (wd >= 0) weekdays[wd]++;
    hours[h]++;
    if (seenPlace.has(`${e.post_id}|${e.place_text}`)) continue;
    seenPlace.add(`${e.post_id}|${e.place_text}`);
    const w = whereOf(e.lat, e.lng);
    if (!w) {
      abroad++;
      continue;
    }
    bump(counties, w.county);
    bump(towns, `${w.county}${w.town}`);
  }
  const modules = new Map<string, number>();
  for (const p of posts.results as Array<{ module: string | null }>) bump(modules, MODULE_NAMES[p.module ?? 'current'] ?? '洋流雷達');
  const b = bottles.results[0] as { thrown: number; picks: number } | undefined;
  const out: PublicStatsOut = {
    days,
    updatedAt: now,
    totals: { events: evRows.length, posts: posts.results.length, reporters: (credits.results[0] as { n: number } | undefined)?.n ?? 0 },
    daily: [...daily.values()],
    topics: top(topics, 30),
    counties: top(counties, 22),
    towns: top(towns, 10),
    abroad,
    weekdays,
    hours,
    modules: top(modules, 10),
    bottles: { thrown: b?.thrown ?? 0, picks: b?.picks ?? 0 },
  };
  await env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(PUBLIC_KEY, JSON.stringify(out), now)
    .run();
  return out;
}
