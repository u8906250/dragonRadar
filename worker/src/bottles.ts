/**
 * 漂流瓶：在自己附近丟一句話（60 字內），別人走到 60 m 內才撿得起來、看得到內容。
 *
 * - 不用登入：前端第一次用時產生隨機的裝置代碼，放在 x-device 標頭；伺服器只存加鹽雜湊。
 * - 隱私：丟的位置先打散到約 100 m 內再存，不存真正的位置（不會因為在家丟瓶子就洩漏住址）。
 * - 內容：先用規則擋掉連結、電話、帳號，再交給 AI 擋攻擊性內容、廣告、個資（不要求一定正向）；AI 失敗就不收。
 * - 2 個不同的人檢舉就先藏起來，等管理者確認。瓶子 7 天後漂走。
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
const PER_DEVICE_PER_DAY = 3;
const PER_IP_PER_DAY = 10;
const GLOBAL_PER_HOUR = 120;
const REPORTS_TO_HIDE = 2;
const LIST_LIMIT = 200;

export type BottleStatus = 'active' | 'hidden' | 'deleted' | 'removed';

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

/** 把位置隨機移到 SCATTER_M 內（均勻分布在圓內） */
export function scatter(p: { lat: number; lng: number }, rand: () => number = Math.random): { lat: number; lng: number } {
  const r = SCATTER_M * Math.sqrt(rand());
  const t = 2 * Math.PI * rand();
  const dLat = (r * Math.cos(t)) / 111320;
  const dLng = (r * Math.sin(t)) / (111320 * Math.cos((p.lat * Math.PI) / 180));
  return { lat: Math.round((p.lat + dLat) * 1e5) / 1e5, lng: Math.round((p.lng + dLng) * 1e5) / 1e5 };
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

  if ((await countSince(env, 'SELECT COUNT(*) AS n FROM bottles WHERE device_id = ? AND created_at > ?', [dev, now - 86400])) >= PER_DEVICE_PER_DAY)
    throw new ReportError(429, `每天最多丟 ${PER_DEVICE_PER_DAY} 個瓶子，明天再來`);
  if ((await countSince(env, 'SELECT COUNT(*) AS n FROM bottles WHERE ip_hash = ? AND created_at > ?', [ip, now - 86400])) >= PER_IP_PER_DAY)
    throw new ReportError(429, '這個網路今天丟太多瓶子了，明天再來');
  if ((await countSince(env, 'SELECT COUNT(*) AS n FROM bottles WHERE created_at > ?', [now - 3600])) >= GLOBAL_PER_HOUR)
    throw new ReportError(429, '現在丟瓶子的人太多，請稍後再試');

  const verdict = await moderate(env, text);
  if (!verdict.allowed) throw new ReportError(422, `這句話不能丟${verdict.reason ? `：${verdict.reason}` : ''}`);

  const p = scatter(at);
  const row = await env.DB.prepare(
    'INSERT INTO bottles (device_id, text, lat, lng, status, ip_hash, created_at, expires_at) VALUES (?, ?, ?, ?, \'active\', ?, ?, ?) RETURNING *',
  )
    .bind(dev, text, p.lat, p.lng, ip, now, now + BOTTLE_TTL_SEC)
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
  if (q.lat !== undefined && q.lng !== undefined) {
    const dLat = q.radiusKm / 111;
    const dLng = q.radiusKm / (111 * Math.max(0.2, Math.cos((q.lat * Math.PI) / 180)));
    conds.push('lat BETWEEN ? AND ?', 'lng BETWEEN ? AND ?');
    binds.push(q.lat - dLat, q.lat + dLat, q.lng - dLng, q.lng + dLng);
  }
  const { results } = await env.DB.prepare(`SELECT * FROM bottles WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`)
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

/** 撿起來：要在 PICK_RADIUS_M 內；自己丟的也可以看，但不算被撿 */
export async function pickBottle(env: Env, device: string | null, id: number, body: { lat?: unknown; lng?: unknown }, now: number): Promise<{ bottle: BottleOut; text: string }> {
  const dev = needDevice(device);
  const b = await env.DB.prepare("SELECT * FROM bottles WHERE id = ? AND status = 'active' AND expires_at > ?").bind(id, now).first<BottleRow>();
  if (!b) throw new ReportError(404, '這個瓶子已經漂走了');
  if (b.device_id === dev) return { bottle: toOut(b, dev, false), text: b.text };
  const already = await env.DB.prepare('SELECT 1 AS x FROM bottle_picks WHERE bottle_id = ? AND device_id = ?').bind(id, dev).first();
  if (!already) {
    const at = validPoint(body.lat, body.lng);
    if (!at) throw new ReportError(400, '要先定位才能撿瓶子');
    const d = distM(at, b);
    if (d > PICK_RADIUS_M) throw new ReportError(403, `還差 ${Math.round(d - PICK_RADIUS_M)} m，再走近一點才撿得到`);
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO bottle_picks (bottle_id, device_id, created_at) VALUES (?, ?, ?)').bind(id, dev, now),
      env.DB.prepare('UPDATE bottles SET picks = picks + 1 WHERE id = ?').bind(id),
    ]);
    b.picks += 1;
  }
  return { bottle: toOut(b, dev, true), text: b.text };
}

export interface MyBottles {
  dropped: Array<{ id: number; text: string; createdAt: number; expiresAt: number; picks: number; status: BottleStatus }>;
  picked: Array<{ id: number; text: string; pickedAt: number }>;
}

/** 我丟的、我撿到的 */
export async function myBottles(env: Env, device: string | null, now: number): Promise<MyBottles> {
  const dev = needDevice(device);
  const dropped = await env.DB.prepare("SELECT * FROM bottles WHERE device_id = ? AND status != 'deleted' AND created_at > ? ORDER BY id DESC LIMIT 30")
    .bind(dev, now - 30 * 86400)
    .all<BottleRow>();
  const picked = await env.DB.prepare(
    "SELECT b.id, b.text, p.created_at AS picked_at FROM bottle_picks p JOIN bottles b ON b.id = p.bottle_id WHERE p.device_id = ? AND b.status = 'active' ORDER BY p.created_at DESC LIMIT 100",
  )
    .bind(dev)
    .all<{ id: number; text: string; picked_at: number }>();
  return {
    dropped: dropped.results.map((b) => ({ id: b.id, text: b.text, createdAt: b.created_at, expiresAt: b.expires_at, picks: b.picks, status: b.expires_at <= now && b.status === 'active' ? ('deleted' as const) : b.status })),
    picked: picked.results.map((p) => ({ id: p.id, text: p.text, pickedAt: p.picked_at })),
  };
}

/** 收回自己丟的瓶子 */
export async function deleteBottle(env: Env, device: string | null, id: number): Promise<{ ok: true }> {
  const dev = needDevice(device);
  const r = await env.DB.prepare("UPDATE bottles SET status = 'deleted' WHERE id = ? AND device_id = ? AND status IN ('active', 'hidden')").bind(id, dev).run();
  if ((r.meta.changes ?? 0) === 0) throw new ReportError(404, '找不到你丟的這個瓶子');
  return { ok: true };
}

/** 檢舉：要撿過才能檢舉；不同的人檢舉到門檻就藏起來 */
export async function reportBottle(env: Env, device: string | null, ip: string, id: number, reason: unknown, now: number): Promise<{ hidden: boolean }> {
  const dev = needDevice(device);
  const picked = await env.DB.prepare('SELECT 1 AS x FROM bottle_picks WHERE bottle_id = ? AND device_id = ?').bind(id, dev).first();
  if (!picked) throw new ReportError(403, '撿起來看過才能檢舉');
  await env.DB.prepare('INSERT OR IGNORE INTO bottle_reports (bottle_id, device_id, ip_hash, reason, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, dev, ip, typeof reason === 'string' ? reason.slice(0, 100) : null, now)
    .run();
  const n = await countSince(env, 'SELECT COUNT(DISTINCT COALESCE(ip_hash, device_id)) AS n FROM bottle_reports WHERE bottle_id = ? AND created_at > ?', [id, 0]);
  const hide = n >= REPORTS_TO_HIDE;
  await env.DB.prepare(`UPDATE bottles SET reports = ?${hide ? ", status = CASE WHEN status = 'active' THEN 'hidden' ELSE status END" : ''} WHERE id = ?`).bind(n, id).run();
  return { hidden: hide };
}

// ---- 管理者 ----

export async function adminListBottles(env: Env, status: string | null): Promise<Array<Omit<BottleRow, 'ip_hash' | 'device_id'>>> {
  const r = status
    ? await env.DB.prepare('SELECT * FROM bottles WHERE status = ? ORDER BY id DESC LIMIT 200').bind(status).all<BottleRow>()
    : await env.DB.prepare('SELECT * FROM bottles ORDER BY id DESC LIMIT 200').all<BottleRow>();
  return r.results.map(({ ip_hash: _i, device_id: _d, ...rest }) => rest);
}

export async function adminSetBottle(env: Env, id: number, status: 'active' | 'removed'): Promise<{ ok: boolean }> {
  const r = await env.DB.prepare('UPDATE bottles SET status = ? WHERE id = ?').bind(status, id).run();
  return { ok: (r.meta.changes ?? 0) > 0 };
}

/** 30 天前的瓶子整個刪掉（含撿起、檢舉紀錄） */
export async function purgeBottles(env: Env, cutoff: number): Promise<number> {
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM bottle_picks WHERE bottle_id IN (SELECT id FROM bottles WHERE expires_at < ?)').bind(cutoff),
    env.DB.prepare('DELETE FROM bottle_reports WHERE bottle_id IN (SELECT id FROM bottles WHERE expires_at < ?)').bind(cutoff),
    env.DB.prepare('DELETE FROM bottles WHERE expires_at < ?').bind(cutoff),
  ]);
  return r.reduce((n, x) => n + (x.meta.changes ?? 0), 0);
}
