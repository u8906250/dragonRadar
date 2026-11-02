/**
 * 收集卡（尋找小法）：在汪星的雷達或 3D 國館點到小法就拿到一張卡。
 * 不用登入，用瀏覽器的裝置代碼（加鹽雜湊）認人；伺服器記哪張卡、什麼時候、在公園哪裡找到，第幾位找到照拿到的順序算（id 由小到大）
 */
import type { Env } from './env';
import { ReportError } from './reports';

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

/** IP 的雜湊只用來限制頻率：超過保存期限的清掉（卡留著） */
export async function purgeCardIps(env: Env, cutoff: number): Promise<number> {
  const r = await env.DB.prepare('UPDATE card_claims SET ip_hash = NULL WHERE created_at < ? AND ip_hash IS NOT NULL').bind(cutoff).run();
  return r.meta.changes ?? 0;
}
