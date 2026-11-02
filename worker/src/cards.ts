/**
 * 收集卡（尋找小法）：在汪星的雷達或 3D 國館點到小法就拿到一張卡。
 * 不用登入，用瀏覽器的裝置代碼（加鹽雜湊）認人；伺服器記哪張卡、什麼時候、在公園哪裡找到，第幾位找到照拿到的順序算（id 由小到大）
 */
import type { Env } from './env';
import { hashSalt, ReportError } from './reports';
import { sha1Hex } from './sources/text';

/** 有哪些卡，每張卡可以寫的地點（前端照小法當時的位置判斷，伺服器只收這幾個，其他的寫最後一個） */
export const CARDS = { xiaofa: ['碑林', '翠湖', '映池', '國父紀念館', '櫻花步道', '中山公園'] } as const;
export type CardId = keyof typeof CARDS;
/** 同一個 IP 一小時最多拿幾張（一直清掉瀏覽器資料重拿，「第幾位」會被灌） */
export const CLAIMS_PER_IP_HOUR = 20;

export interface CardClaim {
  card: CardId;
  place: string;
  /** 拿到的時間（秒） */
  at: number;
  /** 第幾位拿到這張卡 */
  serial: number;
}

/** 檢查要拿哪張卡、在哪裡找到；不對回傳錯誤訊息 */
export function parseClaim(body: unknown): { card: CardId; place: string } | string {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.card !== 'string' || !Object.prototype.hasOwnProperty.call(CARDS, b.card)) return '沒有這張卡';
  const card = b.card as CardId;
  const places: readonly string[] = CARDS[card];
  return { card, place: typeof b.place === 'string' && places.includes(b.place) ? b.place : places[places.length - 1] };
}

const SELECT = 'SELECT c.card, c.place, c.created_at AS at, (SELECT COUNT(*) FROM card_claims c2 WHERE c2.card = c.card AND c2.id <= c.id) AS serial FROM card_claims c';

/** 這個瀏覽器拿到的卡 */
export async function myCards(env: Env, device: string | null): Promise<{ cards: CardClaim[] }> {
  if (!device) return { cards: [] };
  const r = await env.DB.prepare(`${SELECT} WHERE c.device_id = ? ORDER BY c.id`).bind(device).all<CardClaim>();
  return { cards: r.results ?? [] };
}

/** 拿一張卡：拿過的回傳原本那張（fresh = false） */
export async function claimCard(env: Env, device: string | null, ip: string, body: unknown, now: number): Promise<{ claim: CardClaim; fresh: boolean }> {
  if (!device) throw new ReportError(400, '缺少裝置代碼，請重新整理頁面');
  const p = parseClaim(body);
  if (typeof p === 'string') throw new ReportError(400, p);
  const mine = (): Promise<CardClaim | null> => env.DB.prepare(`${SELECT} WHERE c.device_id = ? AND c.card = ?`).bind(device, p.card).first<CardClaim>();
  const had = await mine();
  if (had) return { claim: had, fresh: false };
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM card_claims WHERE ip_hash = ? AND created_at > ?').bind(ip, now - 3600).first<{ n: number }>();
  if ((n?.n ?? 0) >= CLAIMS_PER_IP_HOUR) throw new ReportError(429, '這個網路拿太多卡了，請過一陣子再試');
  await env.DB.prepare('INSERT OR IGNORE INTO card_claims (card, device_id, ip_hash, place, created_at) VALUES (?, ?, ?, ?, ?)').bind(p.card, device, ip, p.place, now).run();
  const got = await mine();
  if (!got) throw new ReportError(503, '暫時拿不到卡，請再試一次');
  return { claim: got, fresh: true };
}

/** IP 的雜湊只用來限制頻率、引繼碼過期了：超過保存期限的清掉（卡留著） */
export async function purgeCards(env: Env, cutoff: number): Promise<number> {
  const r = await env.DB.batch([
    env.DB.prepare('UPDATE card_claims SET ip_hash = NULL WHERE created_at < ? AND ip_hash IS NOT NULL').bind(cutoff),
    env.DB.prepare('DELETE FROM card_transfers WHERE expires_at < ?').bind(cutoff),
    env.DB.prepare('DELETE FROM card_transfer_tries WHERE created_at < ?').bind(cutoff),
  ]);
  return r.reduce((n, x) => n + (x.meta.changes ?? 0), 0);
}

// ---- 引繼碼（換手機）：舊手機產生、新手機輸入，卡片從舊的裝置搬到新的裝置（只搬卡片，回報、漂流瓶不動） ----

/** 引繼碼用的字：大寫英文和數字，拿掉容易看錯的 0、O、1、I（32 個字，8 個字約一兆多種） */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;
/** 引繼碼多久內有效（秒） */
export const TRANSFER_TTL_SEC = 24 * 3600;
/** 同一個 IP 一小時最多產生、兌換幾次（防亂猜） */
export const TRANSFER_TRIES_PER_HOUR = 10;

/** 產生一組引繼碼：「KX7P-4M2Q」 */
export function makeCode(randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const b = randomBytes(CODE_LEN);
  const c = [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** 輸入的引繼碼：拿掉空白、連字號，轉大寫；不是 8 個引繼碼用的字就是 null */
export function cleanCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const c = v.toUpperCase().replace(/[\s\-－‐_]/g, '');
  return c.length === CODE_LEN && [...c].every((ch) => CODE_CHARS.includes(ch)) ? c : null;
}

const codeHash = async (env: Env, code: string): Promise<string> => sha1Hex(`transfer|${code.replace('-', '')}|${await hashSalt(env)}`, 24);

/** 這個 IP 這一小時產生、兌換太多次就擋下來；沒有就記一次 */
async function countTry(env: Env, ip: string, kind: 'make' | 'redeem', now: number): Promise<void> {
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM card_transfer_tries WHERE ip_hash = ? AND kind = ? AND created_at > ?').bind(ip, kind, now - 3600).first<{ n: number }>();
  if ((n?.n ?? 0) >= TRANSFER_TRIES_PER_HOUR) throw new ReportError(429, kind === 'make' ? '產生太多次了，請過一陣子再試' : '輸入太多次了，請過一陣子再試');
  await env.DB.prepare('INSERT INTO card_transfer_tries (ip_hash, kind, created_at) VALUES (?, ?, ?)').bind(ip, kind, now).run();
}

/** 舊手機：產生引繼碼（同一台之前產生、還沒用的作廢） */
export async function makeTransfer(env: Env, device: string | null, ip: string, now: number): Promise<{ code: string; expiresAt: number }> {
  if (!device) throw new ReportError(400, '缺少裝置代碼，請重新整理頁面');
  const has = await env.DB.prepare('SELECT COUNT(*) AS n FROM card_claims WHERE device_id = ?').bind(device).first<{ n: number }>();
  if (!has?.n) throw new ReportError(400, '這台還沒有收集到卡，沒有可以搬的');
  await countTry(env, ip, 'make', now);
  const code = makeCode();
  const expiresAt = now + TRANSFER_TTL_SEC;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM card_transfers WHERE device_id = ? AND used_at IS NULL').bind(device),
    env.DB.prepare('INSERT INTO card_transfers (code_hash, device_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await codeHash(env, code), device, now, expiresAt),
  ]);
  return { code, expiresAt };
}

/**
 * 新手機：輸入引繼碼，舊手機的卡搬過來（舊手機就沒有了）。兩台都有同一張卡的，留比較早拿到的那張（第幾位比較前面）
 */
export async function redeemTransfer(env: Env, device: string | null, ip: string, body: unknown, now: number): Promise<{ cards: CardClaim[]; moved: number }> {
  if (!device) throw new ReportError(400, '缺少裝置代碼，請重新整理頁面');
  await countTry(env, ip, 'redeem', now);
  const code = cleanCode((body as { code?: unknown } | null)?.code);
  if (!code) throw new ReportError(400, '引繼碼是 8 個英文字母和數字，例如 KX7P-4M2Q');
  const hash = await codeHash(env, code);
  const row = await env.DB.prepare('SELECT device_id FROM card_transfers WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?').bind(hash, now).first<{ device_id: string }>();
  if (!row) throw new ReportError(400, '引繼碼不對、已經用過或過期了，請在舊手機重新產生');
  if (row.device_id === device) throw new ReportError(400, '這是這台自己產生的引繼碼，請在新手機輸入');
  // 先標成用過（兩台同時輸入同一組，只有一台搬得到）
  const used = await env.DB.prepare('UPDATE card_transfers SET used_at = ? WHERE code_hash = ? AND used_at IS NULL').bind(now, hash).run();
  if (!used.meta.changes) throw new ReportError(400, '引繼碼已經用過了，請在舊手機重新產生');
  const old = row.device_id;
  // 不要的那張不刪掉、改成不屬於任何裝置（merged:id）：還是算在「第幾位」裡，其他人的第幾位不會變
  const r = await env.DB.batch([
    // 新手機已經有、但舊手機的比較早拿到：新手機的那張不要
    env.DB.prepare("UPDATE card_claims SET device_id = 'merged:' || id WHERE device_id = ? AND EXISTS (SELECT 1 FROM card_claims o WHERE o.device_id = ? AND o.card = card_claims.card AND o.id < card_claims.id)").bind(device, old),
    // 新手機已經有（比較早拿到）的：舊手機的那張不要
    env.DB.prepare("UPDATE card_claims SET device_id = 'merged:' || id WHERE device_id = ? AND card IN (SELECT card FROM card_claims WHERE device_id = ?)").bind(old, device),
    env.DB.prepare('UPDATE card_claims SET device_id = ? WHERE device_id = ?').bind(device, old),
  ]);
  return { cards: (await myCards(env, device)).cards, moved: r[2].meta.changes ?? 0 };
}
