/**
 * 問題回報：大家在詳細資料按「回報問題」（地點錯誤、時間錯誤…），推到管理者的手機，管理頁列出來、標成已處理。
 * 回報的內容只有管理者看得到；存裝置代碼與 IP 的加鹽雜湊（限制次數、同一個人同一則同一種問題只算一次），30 天後刪除。
 */
import type { Env } from './env';
import { ADDRESS_BUDGET_MS, findRouteStop, getPost, locateTypedPlace, MAX_FUTURE_SEC, OPEN_END_SEC, removeRouteStop, reprocessPost, ROUTE_KEEP_SEC, setEventPlace, setEventTime, setManualTitle, setRouteStopPlace, setRouteStopTime, takeDown } from './events';
import { parseSubscription, PushError, sendPush, type PushMessage } from './push';

export const FEEDBACK_KINDS = {
  location: '地點錯誤',
  time: '時間錯誤',
  content: '標題或內容錯誤',
  not_event: '不是發放或活動',
  duplicate: '重複',
  /** 車掃的一站沒有了、取消了（回報時要選哪一站） */
  remove_stop: '刪除這一站',
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

/** 「25.0478, 121.5170」這種座標（Google 地圖按右鍵複製的格式）；不是座標回傳 null */
export function parseLatLng(s: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,，]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(s);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/**
 * 管理者給的新位置：有 lat、lng（在小地圖上標的）就用標的，place 當地點名稱；沒有就照 place 查
 * （地址、店名照修改表單「查地點」的方式，查到約略位置不算；或「緯度, 經度」）。placeText 是 null 時地點名稱不變
 */
async function newPlace(env: Env, rawPlace: unknown, lat: unknown, lng: unknown, what: string): Promise<{ point: { lat: number; lng: number }; placeText: string | null }> {
  const place = cleanNote(rawPlace);
  const coord = place ? parseLatLng(place) : null;
  const pinned = pinOf(lat, lng);
  let point = pinned ?? coord;
  if (!point && place) {
    const r = await locateTypedPlace(env, place, Date.now() + ADDRESS_BUDGET_MS);
    if (!r.point) throw new PushError(400, '查不到這個地點，請寫完整地址，或貼 Google 地圖的座標（例如 25.0478, 121.5170）');
    if (r.approxArea) throw new PushError(400, `只查到約略位置（${r.approxArea}），請寫完整地址，或貼 Google 地圖的座標`);
    point = { lat: r.point.lat, lng: r.point.lng };
  }
  if (!point) throw new PushError(400, `請寫${what}的地點，或在地圖上標位置`);
  return { point, placeText: coord ? null : place };
}

/** 地圖上標的位置：兩個都是範圍內的數字才算 */
export function pinOf(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

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

/**
 * 回報一則事件的問題：{ kind, note, stop?, stopAt? }；回傳要推給管理者的那一筆（重複的不推）。
 * 車掃可以指定哪一站（stop 是那一站的標題、stopAt 預計經過時間）：記在 stop、stop_at，
 * 標題、地點寫那一站的；那一站在雷達上有點就掛在那個點，沒有（只有約略位置、已經經過）就掛在回報的那一則
 */
export async function submitFeedback(
  env: Env,
  eventId: number,
  body: unknown,
  device: string | null,
  ip: string,
  now: number,
): Promise<{ result: FeedbackResult; created: FeedbackRow | null }> {
  const b = (body ?? {}) as { kind?: unknown; note?: unknown; stop?: unknown; stopAt?: unknown; lat?: unknown; lng?: unknown };
  if (!isKind(b.kind)) throw new PushError(400, '請選擇問題類型');
  const note = cleanNote(b.note);
  if (b.kind === 'other' && !note) throw new PushError(400, '選「其他」請寫一下是什麼問題');
  const ev = await env.DB.prepare('SELECT id, post_id, title, place_text FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ id: number; post_id: string; title: string; place_text: string }>();
  if (!ev) throw new PushError(404, '找不到這個發放或活動，可能已經下架了');
  const stopTitle = typeof b.stop === 'string' ? [...b.stop.trim()].slice(0, 120).join('') : '';
  const stopAt = Number.isSafeInteger(b.stopAt) ? (b.stopAt as number) : null;
  const stop = stopTitle ? await findRouteStop(env, ev.post_id, stopTitle, stopAt) : null;
  if (stopTitle && !stop) throw new PushError(404, '找不到這一站，路線可能更新過了，請重新整理再試');
  if (b.kind === 'remove_stop' && !stop) throw new PushError(400, '請選擇要刪除哪一站');
  // 地點錯誤：在小地圖上標的正確位置（選填，管理者確認後才改）
  const pin = b.kind === 'location' ? pinOf(b.lat, b.lng) : null;
  // 沒有確切位置的站回報地點：沒寫在哪裡、也沒標，就沒辦法放上雷達
  if (b.kind === 'location' && stop && stop.lat === null && !note && !pin) throw new PushError(400, `請寫「${stop.name}」在哪裡（地址或店名），或在地圖上標出來`);
  // 那一站在雷達上的點
  const stopEvent = stop
    ? await env.DB.prepare(
        `SELECT id FROM events WHERE post_id = ? AND title = ? AND status IN ('upcoming', 'active', 'unlocated')${stop.at !== null ? ' AND start_at <= ? AND end_at >= ?' : ''} LIMIT 1`,
      )
        .bind(ev.post_id, stop.title, ...(stop.at !== null ? [stop.at, stop.at] : []))
        .first<{ id: number }>()
    : null;
  const targetId = stopEvent?.id ?? ev.id;

  const hour = now - 3600;
  if (device && (await countSince(env, 'device', device, hour)) >= PER_DEVICE_PER_HOUR) throw new PushError(429, '回報太頻繁了，請過一陣子再試');
  if ((await countSince(env, 'ip', ip, hour)) >= (device ? PER_IP_PER_HOUR : PER_IP_NO_DEVICE_PER_HOUR)) throw new PushError(429, '回報太頻繁了，請過一陣子再試');

  // 同一個人（沒有裝置代碼就看 IP）同一則（車掃的同一站）同一種問題只算一次
  const dup = await env.DB.prepare(
    `SELECT 1 AS ok FROM event_feedback WHERE event_id = ? AND kind = ? AND COALESCE(stop, '') = ? AND ${device ? 'device = ?' : 'device IS NULL AND ip = ?'}`,
  )
    .bind(targetId, b.kind, stop?.title ?? '', device ?? ip)
    .first<{ ok: number }>();
  if (dup) return { result: { ok: true, duplicate: true }, created: null };

  const row = await env.DB.prepare(
    `INSERT INTO event_feedback (event_id, post_id, title, place_text, kind, note, device, ip, status, created_at, stop, stop_at, pin_lat, pin_lng)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?) RETURNING id, event_id, post_id, title, place_text, kind, note, status, created_at, resolved_at, stop, stop_at, pin_lat, pin_lng`,
  )
    .bind(targetId, ev.post_id, stop?.title ?? ev.title, stop ? (stop.place ?? stop.name) : ev.place_text, b.kind, note, device, ip, now, stop?.title ?? null, stop?.at ?? null, pin?.lat ?? null, pin?.lng ?? null)
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
  /** 車掃指定的那一站（標題）、預計經過時間 */
  stop?: string | null;
  stop_at?: number | null;
  /** 地點錯誤時在小地圖上標的位置 */
  pin_lat?: number | null;
  pin_lng?: number | null;
}

/** 推給管理者的通知：同一個 tag，新的取代舊的，但會再響一次 */
export function feedbackMessage(row: Pick<FeedbackRow, 'kind' | 'title' | 'note' | 'pin_lat'>, open: number): PushMessage {
  const pinned = row.pin_lat !== null && row.pin_lat !== undefined;
  return {
    title: `新回報：${FEEDBACK_KINDS[row.kind]}${open > 1 ? `（未處理 ${open} 則）` : ''}`,
    body: `${row.title}｜${[row.note ?? (pinned ? '' : '沒寫說明'), pinned ? '在地圖上標了位置' : ''].filter(Boolean).join('，')}`,
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
    `SELECT f.id, f.event_id, f.post_id, f.title, f.place_text, f.kind, f.note, f.status, f.created_at, f.resolved_at, f.stop, f.stop_at, f.pin_lat, f.pin_lng,
            e.status AS event_status, e.start_at, e.end_at, e.end_open, e.lat, e.lng, e.approx_area, e.title AS event_title, e.place_text AS event_place,
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
    .all<Record<string, unknown> & { kind: string; post_id: string | null; stop: string | null; stop_at: number | null }>();
  // 車掃指定了哪一站：附上那一站現在在路線上的位置（回報可能掛在別站的點上，事件的座標不一定是這一站），管理頁的小地圖從這裡開始
  const stops = new Map<string, { lat: number | null; lng: number | null } | null>();
  for (const r of results) {
    if (!r.stop || !r.post_id) continue;
    const key = `${r.post_id}|${r.stop}|${r.stop_at ?? ''}`;
    if (!stops.has(key)) stops.set(key, await findRouteStop(env, r.post_id, r.stop, r.stop_at));
  }
  return results.map((r) => {
    const st = r.stop && r.post_id ? stops.get(`${r.post_id}|${r.stop}|${r.stop_at ?? ''}`) : null;
    return { ...r, kind_label: FEEDBACK_KINDS[r.kind as FeedbackKind] ?? r.kind, ...(r.stop ? { stop_lat: st?.lat ?? null, stop_lng: st?.lng ?? null } : {}) };
  });
}

/** 回報問題的「查地點」：同一個裝置每小時幾次、同一個 IP 每小時幾次（共用外面的地圖查詢服務，不能讓人一直查） */
const LOCATES_PER_DEVICE_HOUR = 20;
const LOCATES_PER_IP_HOUR = 60;

/** settings 裡的計數加一，回傳加完的次數 */
async function bump(env: Env, key: string, now: number): Promise<number> {
  const row = await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, '1', ?) ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1, updated_at = excluded.updated_at RETURNING value",
  )
    .bind(key, now)
    .first<{ value: string }>();
  return Number(row?.value ?? 1);
}

/**
 * 回報地點錯誤時的「查地點」：{ place }，查法跟回報修改表單的一樣（「緯度, 經度」直接用）；
 * 次數記在 settings（flocate:裝置或 IP:第幾個小時），兩小時前的順手清掉
 */
export async function locateForFeedback(env: Env, eventId: number, body: unknown, device: string | null, ip: string, now: number): Promise<{ found: boolean; lat: number | null; lng: number | null; name: string | null; approxArea: string | null }> {
  const place = cleanNote((body as { place?: unknown } | null)?.place);
  if (!place || [...place].length < 2 || [...place].length > 80) throw new PushError(400, '請寫 2 到 80 個字的地址或店名');
  const ev = await env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(eventId).first<{ id: number }>();
  if (!ev) throw new PushError(404, '找不到這個發放或活動，可能已經下架了');
  const coord = parseLatLng(place);
  if (coord) return { found: true, ...coord, name: null, approxArea: null };
  const hour = Math.floor(now / 3600);
  await env.DB.prepare("DELETE FROM settings WHERE key LIKE 'flocate:%' AND updated_at < ?").bind(now - 7200).run();
  if (device && (await bump(env, `flocate:d:${device}:${hour}`, now)) > LOCATES_PER_DEVICE_HOUR) throw new PushError(429, '查太多次了，請直接在地圖上點出位置');
  if ((await bump(env, `flocate:i:${ip}:${hour}`, now)) > LOCATES_PER_IP_HOUR) throw new PushError(429, '查太多次了，請直接在地圖上點出位置');
  const r = await locateTypedPlace(env, place, Date.now() + ADDRESS_BUDGET_MS);
  return { found: !!r.point, lat: r.point?.lat ?? null, lng: r.point?.lng ?? null, name: r.point?.displayName ?? null, approxArea: r.approxArea };
}

/** 管理頁的小地圖查地點：{ place }，查法跟回報修改表單的「查地點」一樣 */
export async function adminLocate(env: Env, body: unknown): Promise<{ found: boolean; lat: number | null; lng: number | null; name: string | null; approxArea: string | null }> {
  const place = cleanNote((body as { place?: unknown } | null)?.place);
  if (!place || [...place].length < 2) throw new PushError(400, '請先寫地點');
  const coord = parseLatLng(place);
  if (coord) return { found: true, ...coord, name: null, approxArea: null };
  const r = await locateTypedPlace(env, place, Date.now() + ADDRESS_BUDGET_MS);
  return { found: !!r.point, lat: r.point?.lat ?? null, lng: r.point?.lng ?? null, name: r.point?.displayName ?? null, approxArea: r.approxArea };
}

/**
 * 管理者改的時間：start 是開始（車掃的站是預計經過時間），end 是結束（null 是沒寫結束）；都是 unix 秒。
 * keep 是沒寫結束時排多久（車掃的站是經過後 15 分），改完就已經結束的不行
 */
export function newTimes(start: unknown, end: unknown, now: number, keep: number): { start: number; end: number | null } {
  if (!Number.isSafeInteger(start)) throw new PushError(400, '請填開始時間');
  const s = start as number;
  const e = end === null || end === undefined || end === '' ? null : Number.isSafeInteger(end) ? (end as number) : NaN;
  if (Number.isNaN(e)) throw new PushError(400, '結束時間格式不對');
  if (e !== null && e <= s) throw new PushError(400, '結束時間要在開始之後');
  if ((e ?? s + keep) <= now) throw new PushError(400, '改的時間已經過了；要拿掉請用「從雷達下架」');
  if (s > now + MAX_FUTURE_SEC) throw new PushError(400, '開始時間最多排到 21 天後');
  return { start: s, end: e };
}

/** 套用後回給管理頁看的：現在雷達上這則貼文的事件（同一個地點的固定據點只列第一天） */
async function currentEvents(env: Env, postId: string): Promise<unknown[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, title, title_manual, kind, item, start_at, end_at, place_text, approx_area, lat, lng, status, spot, end_open FROM events
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
 * - { action: 'takedown', scope?: 'event' | 'post' }：從雷達下架（不是發放或活動、重複）；車掃的一站連時間表、路線一起拿掉
 * - { action: 'remove_stop' }：車掃指定的那一站從時間表、路線、雷達拿掉
 * - { action: 'stop_place', place, lat?, lng? }：車掃指定的那一站改位置：有 lat、lng（管理頁在小地圖上標的）就用標的位置，place 當成地點名稱（可以不寫）；
 *   沒有就照 place 查（地址、店名照查地點的方式查，或直接貼「緯度, 經度」）
 * - { action: 'event_place', place, lat?, lng? }：不是車掃的，改回報那一則的位置（同一則貼文同一個地點還沒結束的一起改），位置的給法同上
 * - { action: 'event_time', start, end? }：不是車掃的，改回報那一則的開始、結束時間（unix 秒，沒有 end 是沒寫結束）
 * - { action: 'stop_time', start }：車掃指定的那一站改預計經過時間，時間表照時間重新排
 * 手動改的地點、時間記在 manual_fixes，之後重新判讀照樣用。套用完標成已處理，回傳現在雷達上這則貼文的事件
 */
export async function applyFeedback(
  env: Env,
  id: number,
  body: unknown,
  now: number,
): Promise<{ ok: true; action: string; removed?: number; removedStops?: number; changed?: number; lostPlaces?: string[]; events: unknown[] }> {
  const fb = await env.DB.prepare('SELECT id, event_id, post_id, place_text, kind, note, stop, stop_at FROM event_feedback WHERE id = ?')
    .bind(id)
    .first<{ id: number; event_id: number; post_id: string | null; place_text: string | null; kind: FeedbackKind; note: string | null; stop: string | null; stop_at: number | null }>();
  if (!fb) throw new PushError(404, '找不到這筆回報');
  const b = (body ?? {}) as { action?: unknown; note?: unknown; scope?: unknown; title?: unknown; place?: unknown; lat?: unknown; lng?: unknown; start?: unknown; end?: unknown };
  const postId = fb.post_id;
  if (!postId) throw new PushError(400, '這筆回報沒有對應的貼文');
  let removed: number | undefined;
  let removedStops: number | undefined;
  let changed: number | undefined;
  let lostPlaces: string[] | undefined;
  // 回報的那一則現在的事件；被重新判讀換掉時，用同一則貼文同一個地點的（沒有才用第一則）
  const liveId = async (): Promise<number | null> =>
    (
      await env.DB.prepare(
        "SELECT id FROM events WHERE (id = ? OR post_id = ?) AND status IN ('upcoming', 'active', 'unlocated') ORDER BY (id = ?) DESC, (place_text = ?) DESC, start_at LIMIT 1",
      )
        .bind(fb.event_id, postId, fb.event_id, fb.place_text ?? '')
        .first<{ id: number }>()
    )?.id ?? null;
  if (b.action === 'title') {
    const title = cleanNote(b.title);
    if (!title || [...title].length > 30) throw new PushError(400, '標題要 1 到 30 個字');
    const target = await liveId();
    if (target === null) throw new PushError(400, '這則已經不在雷達上了');
    changed = await setManualTitle(env, target, title, now);
  } else if (b.action === 'supplement') {
    const placesBefore = await placesOf(env, postId);
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
    // AI 常因為補充只提到一個地點，就把貼文的其他地點漏掉：列出來提醒管理者
    const after = new Set(await placesOf(env, postId));
    lostPlaces = placesBefore.filter((p) => !after.has(p));
  } else if (b.action === 'takedown') {
    removed = await takeDown(env, fb.event_id, b.scope === 'post' ? 'post' : 'event', 'feedback', now);
  } else if (b.action === 'stop_place') {
    if (!fb.stop) throw new PushError(400, '這筆回報沒有指定哪一站');
    const { point, placeText } = await newPlace(env, b.place, b.lat, b.lng, '這一站');
    changed = await setRouteStopPlace(env, postId, fb.stop, fb.stop_at, point, placeText, now);
    if (changed === 0) throw new PushError(400, '路線上已經沒有這一站了');
  } else if (b.action === 'event_place') {
    if (fb.stop) throw new PushError(400, '車掃的站請用「修改這一站的地點」');
    const { point, placeText } = await newPlace(env, b.place, b.lat, b.lng, '這個活動');
    const target = await liveId();
    if (target === null) throw new PushError(400, '這則已經不在雷達上了');
    changed = await setEventPlace(env, target, point, placeText, now);
  } else if (b.action === 'event_time') {
    if (fb.stop) throw new PushError(400, '車掃的站請用「修改這一站的時間」');
    const t = newTimes(b.start, b.end, now, OPEN_END_SEC);
    const target = await liveId();
    if (target === null) throw new PushError(400, '這則已經不在雷達上了');
    changed = await setEventTime(env, target, t.start, t.end, now);
  } else if (b.action === 'stop_time') {
    if (!fb.stop) throw new PushError(400, '這筆回報沒有指定哪一站');
    const t = newTimes(b.start, null, now, ROUTE_KEEP_SEC);
    changed = await setRouteStopTime(env, postId, fb.stop, fb.stop_at, t.start, now);
    if (changed === 0) throw new PushError(400, '路線上已經沒有這一站了');
  } else if (b.action === 'remove_stop') {
    if (!fb.stop) throw new PushError(400, '這筆回報沒有指定哪一站');
    const r = await removeRouteStop(env, postId, fb.stop, fb.stop_at === null ? null : { from: fb.stop_at, to: fb.stop_at }, now);
    if (r.stops === 0 && r.events === 0) throw new PushError(400, '路線上已經沒有這一站了');
    removed = r.events;
    removedStops = r.stops;
  } else {
    throw new PushError(400, "action 要是 'title'、'supplement'、'takedown'、'remove_stop'、'stop_place'、'event_place'、'event_time' 或 'stop_time'");
  }
  await env.DB.prepare("UPDATE event_feedback SET status = 'resolved', resolved_at = ? WHERE id = ?").bind(now, id).run();
  return {
    ok: true,
    action: b.action,
    ...(removed !== undefined ? { removed } : {}),
    ...(removedStops !== undefined ? { removedStops } : {}),
    ...(changed !== undefined ? { changed } : {}),
    ...(lostPlaces?.length ? { lostPlaces } : {}),
    events: await currentEvents(env, postId),
  };
}

async function placesOf(env: Env, postId: string): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT DISTINCT place_text FROM events WHERE post_id = ? AND status IN ('upcoming', 'active', 'unlocated')")
    .bind(postId)
    .all<{ place_text: string }>();
  return results.map((r) => r.place_text);
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

/**
 * 清空已處理：{ upTo } 是管理頁看到的最後標成已處理的時間，那之後才標的（別的手機剛處理的）不清。
 * 不刪掉，改成 cleared（管理頁不再列出，也不能改回未處理）：同一個人重複回報同一件事、回報太頻繁照樣擋得住，30 天後照常刪掉
 */
export async function clearResolvedFeedback(env: Env, body: unknown): Promise<{ ok: true; cleared: number }> {
  const upTo = (body as { upTo?: unknown } | null)?.upTo;
  if (typeof upTo !== 'number' || !Number.isFinite(upTo)) throw new PushError(400, 'upTo is required');
  const r = await env.DB.prepare("UPDATE event_feedback SET status = 'cleared' WHERE status = 'resolved' AND COALESCE(resolved_at, 0) <= ?").bind(upTo).run();
  return { ok: true, cleared: r.meta.changes ?? 0 };
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
