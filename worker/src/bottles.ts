/**
 * 漂流瓶：在自己附近丟一句話（60 字內），別人走到 60 m 內才撿得起來、看得到內容。
 *
 * - 不用登入：前端第一次用時產生隨機的裝置代碼，放在 x-device 標頭；伺服器只存加鹽雜湊。
 * - 隱私：丟的位置先打散到約 100 m 內再存，不存真正的位置（不會因為在家丟瓶子就洩漏住址）。
 * - 內容：先用規則擋掉連結、電話、帳號，再交給 AI 擋攻擊性內容、廣告、個資（不要求一定正向）；AI 失敗就不收。
 * - 一個瓶子只能被一個人撿走，撿走就從雷達上消失；撿到的人可以檢舉，檢舉就藏起來等管理者確認。沒人撿的 7 天後漂走。
 * - 洋流漂移：沒人撿的瓶子每 3 小時往附近熱鬧的地方（發放、活動、固定據點、洋流總部）漂一段，附近沒有就隨機晃一點。
 * - 瓶中信收藏：撿到的人可以收藏信、回收瓶子（多一個額度），兩件事分開；收藏的信不會被 30 天清掉。
 * - BOTTLES_ENABLED = "false" 可以整個關掉。
 */
import type { Env } from './env';
import { responseContent } from './extract';
import { ReportError } from './reports';
import { sha1Hex } from './sources/text';

export const BOTTLE_MAX_CHARS = 60;
export const BOTTLE_TTL_SEC = 7 * 86400;
/** 走到這個距離內才撿得起來 */
export const PICK_RADIUS_M = 60;
/** 丟的位置打散的範圍 */
const SCATTER_M = 100;
/**
 * 每天基本可以丟幾個；每回收一個撿到的瓶子多一個。
 * 互丟互撿是一換一（丟一個用掉一個、回收一個拿回一個），剩下的額度不會越刷越多，所以不另設上限；
 * 總量由同 IP 每天、全站每小時的上限擋。
 */
export const PER_DEVICE_PER_DAY = 3;
const PER_IP_PER_DAY = 20;
const GLOBAL_PER_HOUR = 120;
const LIST_LIMIT = 200;
/** 一個裝置最多收藏幾封信 */
const MAX_LETTERS = 500;

/** 洋流漂移：多久漂一次、一次最多漂多遠、多遠內的熱鬧地方會把瓶子吸過去、附近沒有時隨機晃多遠 */
export const DRIFT_EVERY_SEC = 3 * 3600;
const DRIFT_STEP_M = 300;
const DRIFT_REACH_M = 3000;
const DRIFT_WANDER_M = 80;
/** 洋流總部（跟 web/src/landmarks.ts 同一個點），永遠是一個漂流的目的地 */
const HQ = { lat: 25.0456, lng: 121.5263 };

/** active 漂流中、picked 被撿走了、hidden 被檢舉藏起來、deleted 丟的人收回或漂走、removed 管理者移除 */
export type BottleStatus = 'active' | 'picked' | 'hidden' | 'deleted' | 'removed';

interface BottleRow {
  id: number;
  device_id: string;
  text: string;
  lat: number;
  lng: number;
  status: BottleStatus;
  picks: number;
  reports: number;
  ip_hash: string | null;
  created_at: number;
  expires_at: number;
  origin_lat: number | null;
  origin_lng: number | null;
  drifted_at: number | null;
}

/** 雷達上的瓶子：沒撿起來前看不到內容 */
export interface BottleOut {
  id: number;
  lat: number;
  lng: number;
  createdAt: number;
  expiresAt: number;
  /** 自己丟的 */
  mine: boolean;
  /** 自己撿過了 */
  picked: boolean;
  /** 被撿起來的次數 */
  picks: number;
}

export const bottlesEnabled = (env: Env): boolean => env.BOTTLES_ENABLED !== 'false';

/** 裝置代碼（前端產生的隨機字串）換成雜湊；沒有或格式不對就是 null */
export async function deviceId(env: Env, req: Request): Promise<string | null> {
  const raw = req.headers.get('x-device') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(raw)) return null;
  return sha1Hex(`device|${raw}|${env.ADMIN_TOKEN ?? 'current-radar'}`, 24);
}

function needDevice(id: string | null): string {
  if (!id) throw new ReportError(400, '缺少裝置代碼，請重新整理頁面');
  return id;
}

function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 往東 dx、往北 dy 公尺，四捨五入到 1e-5 度（約 1 m） */
function offset(p: { lat: number; lng: number }, dx: number, dy: number): { lat: number; lng: number } {
  const dLat = dy / 111320;
  const dLng = dx / (111320 * Math.cos((p.lat * Math.PI) / 180));
  return { lat: Math.round((p.lat + dLat) * 1e5) / 1e5, lng: Math.round((p.lng + dLng) * 1e5) / 1e5 };
}

/** 從丟下的地方漂了幾公尺（舊資料沒有起點就是 0） */
const driftOf = (b: { lat: number; lng: number; origin_lat: number | null; origin_lng: number | null }): number =>
  b.origin_lat === null || b.origin_lng === null ? 0 : Math.round(distM({ lat: b.origin_lat, lng: b.origin_lng }, b));

/**
 * 漂一步：DRIFT_REACH_M 內最近的熱鬧地方把瓶子往那邊帶，一次最多 DRIFT_STEP_M，帶一點左右偏移；
 * 到了就停在旁邊 80–200 m（每個瓶子停的距離不同，不會疊成一團）。附近沒有熱鬧的地方就隨機晃 DRIFT_WANDER_M 內。
 * 回傳 null 代表不動。
 */
export function driftStep(
  p: { id: number; lat: number; lng: number },
  targets: Array<{ lat: number; lng: number }>,
  rand: () => number = Math.random,
): { lat: number; lng: number } | null {
  let best: { lat: number; lng: number } | null = null;
  let bestD = DRIFT_REACH_M;
  for (const t of targets) {
    const d = distM(p, t);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  if (!best) {
    const r = DRIFT_WANDER_M * Math.sqrt(rand());
    const a = 2 * Math.PI * rand();
    return offset(p, r * Math.sin(a), r * Math.cos(a));
  }
  const stop = 80 + ((p.id * 37) % 120);
  if (bestD <= stop + 20) return null;
  const step = Math.min(DRIFT_STEP_M, bestD - stop);
  // 方向：用平面近似，往目標走 step，再往側邊偏一點
  const ux = (best.lng - p.lng) * 111320 * Math.cos((p.lat * Math.PI) / 180);
  const uy = (best.lat - p.lat) * 111320;
  const len = Math.hypot(ux, uy) || 1;
  const side = (rand() - 0.5) * 0.3 * step;
  return offset(p, (ux / len) * step - (uy / len) * side, (uy / len) * step + (ux / len) * side);
}

/** 漂流的目的地：接下來 12 小時內有的發放、活動、固定據點，加上洋流總部 */
async function driftTargets(env: Env, now: number): Promise<Array<{ lat: number; lng: number }>> {
  const { results } = await env.DB.prepare(
    "SELECT lat, lng FROM events WHERE lat IS NOT NULL AND lng IS NOT NULL AND merged_into IS NULL AND status IN ('upcoming', 'active') AND start_at < ? AND end_at > ? LIMIT 2000",
  )
    .bind(now + 12 * 3600, now)
    .all<{ lat: number; lng: number }>();
  return [HQ, ...results];
}

/** 排程每次跑：該漂的瓶子漂一步。回傳漂了幾個 */
export async function driftBottles(env: Env, now: number, rand: () => number = Math.random): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id, lat, lng FROM bottles WHERE status = 'active' AND expires_at > ? AND COALESCE(drifted_at, created_at) < ? LIMIT 300",
  )
    .bind(now, now - DRIFT_EVERY_SEC)
    .all<{ id: number; lat: number; lng: number }>();
  if (results.length === 0) return 0;
  const targets = await driftTargets(env, now);
  let moved = 0;
  const stmts = results.map((b) => {
    const to = driftStep(b, targets, rand) ?? b;
    if (to !== b) moved++;
    // 不動的也記下時間，3 小時後再看一次；被撿走的不動
    return env.DB.prepare("UPDATE bottles SET lat = ?, lng = ?, drifted_at = ? WHERE id = ? AND status = 'active'").bind(to.lat, to.lng, now, b.id);
  });
  await env.DB.batch(stmts);
  return moved;
}

/** 把位置隨機移到 SCATTER_M 內（均勻分布在圓內） */
export function scatter(p: { lat: number; lng: number }, rand: () => number = Math.random): { lat: number; lng: number } {
  const r = SCATTER_M * Math.sqrt(rand());
  const t = 2 * Math.PI * rand();
  return offset(p, r * Math.sin(t), r * Math.cos(t));
}

/** 規則先擋：連結、電話、Email、LINE／IG 帳號、太長的數字、全是符號 */
export function ruleCheck(text: string): string | null {
  const t = text.trim();
  if (!t) return '寫點什麼再丟吧';
  if ([...t].length > BOTTLE_MAX_CHARS) return `最多 ${BOTTLE_MAX_CHARS} 個字`;
  if (/[\w.+-]+@[\w-]+\.\w+/.test(t)) return '不能放 Email';
  if (/https?:\/\/|www\.|\.(com|net|tw|org|io|cc|me)\b/i.test(t)) return '不能放連結';
  if (/(?:\d[\s-]?){7,}/.test(t)) return '不能放電話或一長串數字';
  if (/(line|ig|instagram|tg|telegram|wechat|微信)\s*(id)?\s*[:：@]/i.test(t) || /@[A-Za-z0-9_.]{3,}/.test(t)) return '不能放帳號';
  if (!/[\p{L}\p{N}]/u.test(t)) return '寫點文字再丟吧';
  return null;
}

const MODERATION_PROMPT = `你是「洋流雷達」漂流瓶的內容審核員。漂流瓶是使用者在街頭留給路過陌生人的一句話（台北大洋流競選活動的網站上）。
內容不一定要正向：打氣、感謝、心情、抱怨、日常小事、在地觀察、對城市的期待都可以。

只擋下這幾類：
- 攻擊性內容：辱罵、嘲諷、貶低、人身攻擊任何人或團體（包括候選人、政黨、政府、媒體、網友），抹黑、未經證實的指控或謠言
- 仇恨、歧視、威脅、暴力、色情
- 廣告、推銷、拉客、抽獎、要別人做事換東西
- 聯絡方式或個人資料：電話、帳號、住址、某個具體個人的私事或行蹤

只輸出 JSON：{"allowed": true 或 false, "reason": "不允許時用一句話說明是哪一類，給使用者看；允許時空字串"}`;

/** AI 判斷有沒有攻擊性、廣告、個資；AI 失敗就當成不通過（寧可不收） */
async function moderate(env: Env, text: string): Promise<{ allowed: boolean; reason: string }> {
  const ai = env.AI as unknown as { run(model: string, inputs: unknown): Promise<unknown> };
  const messages = [
    { role: 'system', content: MODERATION_PROMPT },
    { role: 'user', content: `漂流瓶內容：「${text}」${/qwen3/i.test(env.AI_MODEL) ? '\n/no_think' : ''}` },
  ];
  const schema = {
    type: 'object',
    properties: { allowed: { type: 'boolean' }, reason: { type: 'string' } },
    required: ['allowed', 'reason'],
  };
  for (const model of [env.AI_MODEL, env.AI_MODEL_FALLBACK].filter((m): m is string => !!m)) {
    try {
      const res = await ai.run(model, { messages, response_format: { type: 'json_schema', json_schema: schema }, max_tokens: 200, temperature: 0 });
      const c = responseContent(res);
      const o = (typeof c === 'string' ? JSON.parse(c.replace(/^[^{]*/, '').replace(/[^}]*$/, '')) : c) as { allowed?: unknown; reason?: unknown };
      if (typeof o?.allowed === 'boolean') return { allowed: o.allowed, reason: typeof o.reason === 'string' ? o.reason.slice(0, 80) : '' };
    } catch (e) {
      console.warn(`bottle moderation with ${model} failed: ${String(e)}`);
    }
  }
  throw new ReportError(503, '暫時沒辦法審核內容，請稍後再丟');
}

async function countSince(env: Env, sql: string, binds: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;
}

export interface BottleQuota {
  /** 過去 24 小時丟了幾個 */
  used: number;
  /** 過去 24 小時回收了幾個撿到的瓶子（每個多一個額度） */
  bonus: number;
  /** 今天總共可以丟幾個 */
  limit: number;
  /** 還能丟幾個 */
  left: number;
}

/** 今天的額度：基本 3 個，回收幾個撿到的瓶子就多幾個（都算過去 24 小時） */
export async function bottleQuota(env: Env, dev: string, now: number): Promise<BottleQuota> {
  const used = await countSince(env, 'SELECT COUNT(*) AS n FROM bottles WHERE device_id = ? AND created_at > ?', [dev, now - 86400]);
  const bonus = await countSince(env, 'SELECT COUNT(*) AS n FROM bottle_picks WHERE device_id = ? AND recycled_at > ?', [dev, now - 86400]);
  const limit = PER_DEVICE_PER_DAY + bonus;
  return { used, bonus, limit, left: Math.max(0, limit - used) };
}

const validPoint = (lat: unknown, lng: unknown): { lat: number; lng: number } | null =>
  typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;

/** 丟一個瓶子：在你現在的位置附近 */
export async function dropBottle(env: Env, device: string | null, ip: string, body: { text?: unknown; lat?: unknown; lng?: unknown }, now: number): Promise<{ bottle: BottleOut; text: string }> {
  const dev = needDevice(device);
  const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
  const bad = ruleCheck(text);
  if (bad) throw new ReportError(400, bad);
  const at = validPoint(body.lat, body.lng);
  if (!at) throw new ReportError(400, '要先定位才能丟瓶子');

  const quota = await bottleQuota(env, dev, now);
  if (quota.left <= 0)
    throw new ReportError(429, '今天的瓶子丟完了。回收一個撿到的瓶子，就能多丟一個');
  if ((await countSince(env, 'SELECT COUNT(*) AS n FROM bottles WHERE ip_hash = ? AND created_at > ?', [ip, now - 86400])) >= PER_IP_PER_DAY)
    throw new ReportError(429, '這個網路今天丟太多瓶子了，明天再來');
  if ((await countSince(env, 'SELECT COUNT(*) AS n FROM bottles WHERE created_at > ?', [now - 3600])) >= GLOBAL_PER_HOUR)
    throw new ReportError(429, '現在丟瓶子的人太多，請稍後再試');

  const verdict = await moderate(env, text);
  if (!verdict.allowed) throw new ReportError(422, `這句話不能丟${verdict.reason ? `：${verdict.reason}` : ''}`);

  const p = scatter(at);
  const row = await env.DB.prepare(
    'INSERT INTO bottles (device_id, text, lat, lng, origin_lat, origin_lng, status, ip_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, \'active\', ?, ?, ?) RETURNING *',
  )
    .bind(dev, text, p.lat, p.lng, p.lat, p.lng, ip, now, now + BOTTLE_TTL_SEC)
    .first<BottleRow>();
  if (!row) throw new ReportError(500, '存檔失敗，請稍後再試');
  return { bottle: toOut(row, dev, false), text: row.text };
}

function toOut(r: BottleRow, dev: string | null, picked: boolean): BottleOut {
  return { id: r.id, lat: r.lat, lng: r.lng, createdAt: r.created_at, expiresAt: r.expires_at, mine: r.device_id === dev, picked, picks: r.picks };
}

/** 附近漂流中的瓶子（沒有內容） */
export async function listBottles(env: Env, device: string | null, q: { lat?: number; lng?: number; radiusKm: number }, now: number): Promise<BottleOut[]> {
  const conds = ["status = 'active'", 'expires_at > ?'];
  const binds: unknown[] = [now];
  // 有位置就從近到遠排，瓶子很多時也一定拿得到最近的那幾個（雷達外圈的方向提示要用）
  let order = 'created_at DESC';
  if (q.lat !== undefined && q.lng !== undefined) {
    const k = Math.max(0.2, Math.cos((q.lat * Math.PI) / 180));
    const dLat = q.radiusKm / 111;
    const dLng = q.radiusKm / (111 * k);
    conds.push('lat BETWEEN ? AND ?', 'lng BETWEEN ? AND ?');
    binds.push(q.lat - dLat, q.lat + dLat, q.lng - dLng, q.lng + dLng);
    order = '(lat - ?) * (lat - ?) + (lng - ?) * (lng - ?) * ?';
    binds.push(q.lat, q.lat, q.lng, q.lng, k * k);
  }
  const { results } = await env.DB.prepare(`SELECT * FROM bottles WHERE ${conds.join(' AND ')} ORDER BY ${order} LIMIT ${LIST_LIMIT}`)
    .bind(...binds)
    .all<BottleRow>();
  const picked = new Set<number>();
  if (device && results.length > 0) {
    const r = await env.DB.prepare(`SELECT bottle_id FROM bottle_picks WHERE device_id = ? AND bottle_id IN (${results.map(() => '?').join(',')})`)
      .bind(device, ...results.map((b) => b.id))
      .all<{ bottle_id: number }>();
    for (const x of r.results) picked.add(x.bottle_id);
  }
  return results.map((b) => toOut(b, device, picked.has(b.id)));
}

/**
 * 撿起來：要在 PICK_RADIUS_M 內。一個瓶子只能被一個人撿走，撿走後就從所有人的雷達上消失，
 * 只有撿到的人（在「我撿到的」）和丟的人看得到內容。自己丟的可以看，但不能撿。
 */
export async function pickBottle(env: Env, device: string | null, id: number, body: { lat?: unknown; lng?: unknown }, now: number): Promise<{ bottle: BottleOut; text: string }> {
  const dev = needDevice(device);
  const b = await env.DB.prepare("SELECT * FROM bottles WHERE id = ? AND status IN ('active', 'picked')").bind(id).first<BottleRow>();
  if (!b) throw new ReportError(404, '這個瓶子已經漂走了');
  if (b.device_id === dev) return { bottle: toOut(b, dev, false), text: b.text };
  const mine = await env.DB.prepare('SELECT 1 AS x FROM bottle_picks WHERE bottle_id = ? AND device_id = ?').bind(id, dev).first();
  if (mine) return { bottle: toOut(b, dev, true), text: b.text };
  if (b.status !== 'active' || b.expires_at <= now) throw new ReportError(410, '晚了一步，這個瓶子已經被撿走或漂走了');
  const at = validPoint(body.lat, body.lng);
  if (!at) throw new ReportError(400, '要先定位才能撿瓶子');
  const d = distM(at, b);
  if (d > PICK_RADIUS_M) throw new ReportError(403, `還差 ${Math.round(d - PICK_RADIUS_M)} m，再走近一點才撿得到`);
  // 兩個人同時撿：只有先改到狀態的那個人算數
  const won = await env.DB.prepare("UPDATE bottles SET status = 'picked', picks = 1 WHERE id = ? AND status = 'active' RETURNING *").bind(id).first<BottleRow>();
  if (!won) throw new ReportError(410, '晚了一步，這個瓶子剛被別人撿走了');
  await env.DB.prepare('INSERT OR IGNORE INTO bottle_picks (bottle_id, device_id, created_at) VALUES (?, ?, ?)').bind(id, dev, now).run();
  return { bottle: toOut(won, dev, true), text: won.text };
}

export interface MyBottles {
  quota: BottleQuota;
  dropped: Array<{ id: number; text: string; createdAt: number; expiresAt: number; picks: number; pickedAt: number | null; status: BottleStatus; driftM: number }>;
  /** 撿到、還沒回收的瓶子 */
  picked: Array<{ id: number; text: string; createdAt: number; pickedAt: number; driftM: number; collected: boolean }>;
  /** 收藏的信（瓶子回收了也還在） */
  letters: Array<{ id: number; text: string; createdAt: number; pickedAt: number; collectedAt: number; driftM: number }>;
}

/** 我丟的、我撿到的、我收藏的信 */
export async function myBottles(env: Env, device: string | null, now: number): Promise<MyBottles> {
  const dev = needDevice(device);
  const dropped = await env.DB.prepare(
    `SELECT b.*, (SELECT MIN(created_at) FROM bottle_picks p WHERE p.bottle_id = b.id) AS picked_at FROM bottles b
      WHERE b.device_id = ? AND b.status != 'deleted' AND b.created_at > ? ORDER BY b.id DESC LIMIT 30`,
  )
    .bind(dev, now - 30 * 86400)
    .all<BottleRow & { picked_at: number | null }>();
  // 撿到的（還沒回收）和收藏的信一起查；被檢舉藏起來、被管理者移除的不顯示
  const mine = await env.DB.prepare(
    `SELECT b.id, b.text, b.lat, b.lng, b.origin_lat, b.origin_lng, b.created_at, p.created_at AS picked_at, p.recycled_at, p.collected_at
       FROM bottle_picks p JOIN bottles b ON b.id = p.bottle_id
      WHERE p.device_id = ? AND (p.recycled_at IS NULL OR p.collected_at IS NOT NULL) AND b.status IN ('active', 'picked')
      ORDER BY p.created_at DESC LIMIT ${MAX_LETTERS + 100}`,
  )
    .bind(dev)
    .all<Pick<BottleRow, 'id' | 'text' | 'lat' | 'lng' | 'origin_lat' | 'origin_lng' | 'created_at'> & { picked_at: number; recycled_at: number | null; collected_at: number | null }>();
  return {
    quota: await bottleQuota(env, dev, now),
    dropped: dropped.results.map((b) => ({
      id: b.id,
      text: b.text,
      createdAt: b.created_at,
      expiresAt: b.expires_at,
      picks: b.picks,
      pickedAt: b.picked_at,
      status: b.expires_at <= now && b.status === 'active' ? ('deleted' as const) : b.status,
      driftM: driftOf(b),
    })),
    picked: mine.results
      .filter((p) => p.recycled_at === null)
      .map((p) => ({ id: p.id, text: p.text, createdAt: p.created_at, pickedAt: p.picked_at, driftM: driftOf(p), collected: p.collected_at !== null })),
    letters: mine.results
      .filter((p): p is typeof p & { collected_at: number } => p.collected_at !== null)
      .sort((a, c) => c.collected_at - a.collected_at)
      .map((p) => ({ id: p.id, text: p.text, createdAt: p.created_at, pickedAt: p.picked_at, collectedAt: p.collected_at, driftM: driftOf(p) })),
  };
}

/** 回收撿到的瓶子：今天多一個額度；瓶子不見了，收藏的信還留著 */
export async function recycleBottle(env: Env, device: string | null, id: number, now: number): Promise<{ quota: BottleQuota }> {
  const dev = needDevice(device);
  const r = await env.DB.prepare('UPDATE bottle_picks SET recycled_at = ? WHERE bottle_id = ? AND device_id = ? AND recycled_at IS NULL').bind(now, id, dev).run();
  if ((r.meta.changes ?? 0) === 0) throw new ReportError(404, '找不到你撿到的這個瓶子，可能已經回收了');
  return { quota: await bottleQuota(env, dev, now) };
}

/** 收藏撿到的信，或移出收藏（瓶子已經回收的話，移出後就看不到了） */
export async function collectLetter(env: Env, device: string | null, id: number, on: boolean, now: number): Promise<{ collected: boolean }> {
  const dev = needDevice(device);
  if (on) {
    const n = await countSince(env, 'SELECT COUNT(*) AS n FROM bottle_picks WHERE device_id = ? AND collected_at > ?', [dev, 0]);
    if (n >= MAX_LETTERS) throw new ReportError(429, `最多收藏 ${MAX_LETTERS} 封信，先移出一些吧`);
  }
  const r = await env.DB.prepare(
    "UPDATE bottle_picks SET collected_at = ? WHERE bottle_id = ? AND device_id = ? AND EXISTS (SELECT 1 FROM bottles b WHERE b.id = bottle_id AND b.status IN ('active', 'picked'))",
  )
    .bind(on ? now : null, id, dev)
    .run();
  if ((r.meta.changes ?? 0) === 0) throw new ReportError(404, '找不到你撿到的這封信');
  return { collected: on };
}

/** 收回自己丟的瓶子（還沒被撿走的） */
export async function deleteBottle(env: Env, device: string | null, id: number): Promise<{ ok: true }> {
  const dev = needDevice(device);
  const r = await env.DB.prepare("UPDATE bottles SET status = 'deleted' WHERE id = ? AND device_id = ? AND status IN ('active', 'hidden')").bind(id, dev).run();
  if ((r.meta.changes ?? 0) === 0) throw new ReportError(404, '這個瓶子已經被撿走或不見了，收不回來');
  return { ok: true };
}

/** 檢舉：撿到的人才能檢舉（瓶子已經只有他看得到），檢舉後藏起來交給管理者確認 */
export async function reportBottle(env: Env, device: string | null, ip: string, id: number, reason: unknown, now: number): Promise<{ hidden: boolean }> {
  const dev = needDevice(device);
  const picked = await env.DB.prepare('SELECT 1 AS x FROM bottle_picks WHERE bottle_id = ? AND device_id = ?').bind(id, dev).first();
  if (!picked) throw new ReportError(403, '撿起來看過才能檢舉');
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO bottle_reports (bottle_id, device_id, ip_hash, reason, created_at) VALUES (?, ?, ?, ?, ?)').bind(
      id,
      dev,
      ip,
      typeof reason === 'string' ? reason.slice(0, 100) : null,
      now,
    ),
    env.DB.prepare("UPDATE bottles SET reports = reports + 1, status = CASE WHEN status IN ('active', 'picked') THEN 'hidden' ELSE status END WHERE id = ?").bind(id),
  ]);
  return { hidden: true };
}

// ---- 管理者 ----

export async function adminListBottles(env: Env, status: string | null): Promise<Array<Omit<BottleRow, 'ip_hash' | 'device_id'>>> {
  const r = status
    ? await env.DB.prepare('SELECT * FROM bottles WHERE status = ? ORDER BY id DESC LIMIT 200').bind(status).all<BottleRow>()
    : await env.DB.prepare('SELECT * FROM bottles ORDER BY id DESC LIMIT 200').all<BottleRow>();
  return r.results.map(({ ip_hash: _i, device_id: _d, ...rest }) => rest);
}

/** 移除，或恢復（被撿走的恢復成已撿走，還沒撿的恢復到雷達上） */
export async function adminSetBottle(env: Env, id: number, status: 'active' | 'removed'): Promise<{ ok: boolean }> {
  const r =
    status === 'removed'
      ? await env.DB.prepare("UPDATE bottles SET status = 'removed' WHERE id = ?").bind(id).run()
      : await env.DB.prepare("UPDATE bottles SET status = CASE WHEN EXISTS (SELECT 1 FROM bottle_picks WHERE bottle_id = ?) THEN 'picked' ELSE 'active' END WHERE id = ?")
          .bind(id, id)
          .run();
  return { ok: (r.meta.changes ?? 0) > 0 };
}

/**
 * 過期 30 天的瓶子整個刪掉（含撿起、檢舉紀錄）；有人收藏的信留著，只清掉 IP 雜湊和丟的人的裝置代碼。
 * 收藏的人移出收藏後，下一次就一起刪掉。
 */
export async function purgeBottles(env: Env, cutoff: number): Promise<number> {
  const old = 'SELECT id FROM bottles WHERE expires_at < ?';
  const kept = 'SELECT bottle_id FROM bottle_picks WHERE collected_at IS NOT NULL';
  const r = await env.DB.batch([
    env.DB.prepare(`DELETE FROM bottle_picks WHERE collected_at IS NULL AND bottle_id IN (${old})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM bottle_reports WHERE bottle_id IN (${old})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM bottles WHERE expires_at < ? AND id NOT IN (${kept})`).bind(cutoff),
    env.DB.prepare("UPDATE bottles SET ip_hash = NULL, device_id = '' WHERE expires_at < ? AND device_id != ''").bind(cutoff),
  ]);
  return r.reduce((n, x) => n + (x.meta.changes ?? 0), 0);
}
