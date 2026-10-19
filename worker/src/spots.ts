/**
 * 回報固定據點：店家、服務處這種連續好幾天都能去的地方。
 * 貼文常常沒寫地址或時間（例如「10/16 起到店索取，送完為止」），所以請回報的人補上地點。
 * 送出時馬上自動審核（AI 判讀貼文加上回報者補充的地點、時間），有把握就直接上雷達；
 * 沒把握的留在佇列等管理者審核。SPOT_AUTO_REVIEW = "false" 可以關掉自動審核、全部改人工。
 */
import { geocodeAddress, parseTwAddress } from './address';
import type { Env } from './env';
import { getEvent, MAX_FUTURE_SEC, MIN_CONFIDENCE, spotSessions, storePost, type EventOut, type Session } from './events';
import { extractFromPost, type EventKind } from './extract';
import { geocode, geocodeFirst, isAdminOnly, placeCandidates } from './geocode';
import { listActiveKeywords } from './keywords';
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
  /** auto 自動審核、admin 人工 */
  reviewer: string | null;
  /** 自動審核沒通過的原因 */
  review_note: string | null;
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
  /** 自動審核通過 */
  auto: boolean;
  /** 等人工審核的原因（自動審核沒通過） */
  note: string | null;
  /** 剛通過時附上放上雷達的據點 */
  events?: EventOut[];
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
  auto: r.status === 'approved' && r.reviewer === 'auto',
  note: r.status === 'pending' ? r.review_note : null,
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
  if (env.SPOT_AUTO_REVIEW === 'false') return statusOf(row);
  return autoReview(env, row, now);
}

// ---- 自動審核 ----

/** 地點轉座標：門牌地址用 OSM 門牌；沒有門牌就查店名、地標。precise = 不是整條路或整個行政區 */
export async function locatePlace(env: Env, place: string): Promise<{ lat: number; lng: number; how: string } | null> {
  const addr = await geocodeAddress(env, place);
  if (addr) return { lat: addr.lat, lng: addr.lng, how: addr.how === 'exact' ? '門牌' : '門牌推算' };
  // 有寫門牌但找不到：不拿店名去猜，可能查到別家分店
  if (parseTwAddress(place)) return null;
  const candidates = placeCandidates(place, place).filter((c) => !isAdminOnly(c) && !/^[\u4e00-\u9fff]{1,6}(路|街|大道)([一二三四五六七八九十]段)?$/.test(c.replace(/^\S+[市縣]\s*/, '')));
  const p = await geocodeFirst(env, candidates);
  return p ? { lat: p.lat, lng: p.lng, how: '地名' } : null;
}

function distKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 貼文自己寫的地址跟回報的地點差超過這個距離，就交給人工 */
const PLACE_MISMATCH_KM = 1;

/** 自動審核：通過就上雷達，不通過就留在佇列並寫下原因 */
export async function autoReview(env: Env, req: SpotRequestRow, now: number): Promise<SpotRequestStatus> {
  const hold = async (note: string): Promise<SpotRequestStatus> => {
    const r = await env.DB.prepare('UPDATE spot_requests SET review_note = ? WHERE id = ? RETURNING *').bind(note, req.id).first<SpotRequestRow>();
    return statusOf(r ?? req);
  };
  try {
    const supplement = [`地點：${req.place}`, req.hours ? `開放時間：${req.hours}` : '', req.note ? `說明：${req.note}` : ''].filter(Boolean).join('\n');
    const { extraction } = await extractFromPost(env, `${req.text}\n\n（回報者補充，這是固定據點）\n${supplement}`, req.posted_at, now);
    if (!extraction) return await hold('自動判讀暫時失敗');
    if (!extraction.is_event || extraction.events.length === 0) return await hold('貼文看不出是發放或活動');
    const ex = extraction.events.find((e) => e.spot);
    if (!ex) return await hold('看起來是單次的發放或活動，不是連續多天的據點');
    if (ex.confidence < MIN_CONFIDENCE) return await hold('判讀把握不夠');

    const terms = (await listActiveKeywords(env, now)).map((k) => k.term);
    const hay = `${req.text}\n${ex.title}\n${ex.item ?? ''}`;
    if (terms.length > 0 && !terms.some((t) => hay.includes(t))) return await hold(`貼文沒有提到${terms.join('、')}`);

    const point = await locatePlace(env, req.place);
    if (!point) return await hold('查不到這個地點的精確位置');
    // 貼文自己寫了地址、跟回報的地點不一樣：可能是拿別人的貼文配別的地址
    const own = parseTwAddress(req.text);
    if (own && own.street !== parseTwAddress(req.place)?.street) {
      const p = await geocodeAddress(env, req.text);
      if (p && distKm(p, point) > PLACE_MISMATCH_KM) return await hold('貼文寫的地址跟回報的地點不一樣');
    }

    const sessions = spotSessions(ex, req.posted_at, now).filter((x) => x.start <= now + MAX_FUTURE_SEC);
    if (sessions.length === 0) return await hold('期間已經結束，或太久以後才開始');

    const events = await publishSpot(env, req, { kind: ex.kind, title: ex.title, item: ex.item, placeText: req.place, placeQuery: req.place, point, sessions }, now);
    const r = await env.DB.prepare("UPDATE spot_requests SET status = 'approved', reviewer = 'auto', review_note = ?, reviewed_at = ? WHERE id = ? RETURNING *")
      .bind(`定位：${point.how}`, now, req.id)
      .first<SpotRequestRow>();
    return { ...statusOf(r ?? req), events };
  } catch (e) {
    console.warn(`auto review failed for ${req.id}: ${String(e)}`);
    return hold('自動審核暫時失敗');
  }
}

/** 建一則 source = 'spot' 的貼文，每天一筆固定據點；已經有的未結束據點先刪掉（重新審核就是修改） */
async function publishSpot(
  env: Env,
  req: SpotRequestRow,
  d: { kind: EventKind; title: string; item: string | null; placeText: string; placeQuery: string; point: { lat: number; lng: number }; sessions: Session[] },
  now: number,
): Promise<EventOut[]> {
  const postId = `spot-${req.code}`;
  await storePost(env, { id: postId, username: req.username, text: req.text, permalink: req.permalink, posted_at: req.posted_at, keyword: null, source: 'spot' }, now);
  // 不交給排程的 AI 判讀，內容以審核結果為準
  await env.DB.batch([
    env.DB.prepare('UPDATE posts SET processed_at = ?, checked_at = ? WHERE id = ?').bind(now, now, postId),
    env.DB.prepare("DELETE FROM ended_reports WHERE event_id IN (SELECT id FROM events WHERE post_id = ? AND status IN ('upcoming', 'active', 'unlocated'))").bind(postId),
    env.DB.prepare("DELETE FROM events WHERE post_id = ? AND status IN ('upcoming', 'active', 'unlocated')").bind(postId),
  ]);
  const out: EventOut[] = [];
  for (const s of d.sessions) {
    const row = await env.DB.prepare(
      `INSERT INTO events (post_id, kind, title, item, start_at, end_at, place_text, place_query, lat, lng, status, confidence, all_day, spot, approx_area, end_open, until_open, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, NULL, ?, ?, ?, ?) RETURNING id`,
    )
      .bind(postId, d.kind, d.title, d.item, s.start, s.end, d.placeText, d.placeQuery, d.point.lat, d.point.lng, s.start <= now ? 'active' : 'upcoming', s.allDay ? 1 : 0, s.endOpen ? 1 : 0, s.untilOpen ? 1 : 0, now, now)
      .first<{ id: number }>();
    const ev = row ? await getEvent(env, row.id, now) : null;
    if (ev) out.push(ev);
  }
  return out;
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

/** 人工通過：展開成每天一筆固定據點；重複通過就是修改（舊的未結束事件先刪掉） */
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
  else {
    const q = clean(b.place_query, MAX_PLACE) ?? placeText;
    point = (await locatePlace(env, q)) ?? (await geocode(env, q));
  }
  if (!point) throw new ReportError(400, '查不到這個地點，請直接給 lat、lng');

  const from = b.from ?? new Date((req.posted_at + 8 * 3600) * 1000).toISOString().slice(0, 10);
  const sessions = spotSessions(
    { start_at: `${from}T${b.open ?? '00:00'}:00+08:00`, end_at: b.close ? `${from}T${b.close}:00+08:00` : null, until: b.until ?? null },
    req.posted_at,
    now,
  ).filter((s) => s.start <= now + MAX_FUTURE_SEC);
  if (sessions.length === 0) throw new ReportError(400, '這段期間已經結束了');

  const kind: EventKind = b.kind === 'activity' ? 'activity' : 'giveaway';
  const events = await publishSpot(
    env,
    req,
    { kind, title, item: clean(b.item, 60), placeText, placeQuery: clean(b.place_query, MAX_PLACE) ?? placeText, point, sessions },
    now,
  );
  const updated = await env.DB.prepare("UPDATE spot_requests SET status = 'approved', reason = NULL, reviewer = 'admin', reviewed_at = ? WHERE id = ? RETURNING *")
    .bind(now, id)
    .first<SpotRequestRow>();
  return { request: statusOf(updated ?? req), events };
}

/** 不通過；已經通過的再按不通過，就把雷達上的據點一起撤下 */
export async function rejectSpotRequest(env: Env, id: number, reason: string | null, now: number): Promise<{ request: SpotRequestStatus; removed: number }> {
  const req = await env.DB.prepare("UPDATE spot_requests SET status = 'rejected', reason = ?, reviewer = 'admin', reviewed_at = ? WHERE id = ? RETURNING *")
    .bind(clean(reason, 200), now, id)
    .first<SpotRequestRow>();
  if (!req) throw new ReportError(404, 'request not found');
  const r = await env.DB.prepare("UPDATE events SET status = 'ended', ended_reason = 'rejected', updated_at = ? WHERE post_id = ? AND status IN ('upcoming', 'active', 'unlocated')")
    .bind(now, `spot-${req.code}`)
    .run();
  return { request: statusOf(req), removed: r.meta.changes ?? 0 };
}
