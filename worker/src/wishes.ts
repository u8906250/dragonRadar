/**
 * 許願（v1.569，順幣的用途）：投 5 枚順幣送一個想法（一段 prompt、一份企劃、想認領一塊地…不分類型），管理者審核，
 * 通過才由維護者用 AI 做出來、上線；上線後有 3 次免費調整，之後每次 1 枚順幣。取代原本到 GitHub 提案。
 * 許願的內容是任何人都能寫的：只存起來給管理者看，不會自動變成程式，也不公開（上線的東西有填暱稱才寫「點子來自 ○○」，維護者做的時候加）。
 * 送出時順幣先暫扣（item_grants.used_at、used_for = 'wish:<id>'），不通過、做不出來、自己撤回就全部退回。
 * 一樣用裝置代碼（加鹽雜湊）認人、不用登入，換裝置的引繼碼一起搬
 */
import type { Env } from './env';
import { pushAdmins } from './push';
import { ReportError } from './reports';

/** 許願要幾枚順幣 */
export const WISH_COST = 5;
/** 上線後免費調整幾次 */
export const TWEAK_FREE = 3;
/** 免費的用完後，每次調整幾枚順幣 */
export const TWEAK_COST = 1;
/** 一台裝置同時最多幾個願望在審核中 */
export const MAX_PENDING_WISHES = 3;
/** 同一個網路一小時最多送幾次（許願、調整一起算） */
export const WISHES_PER_IP_HOUR = 10;
/** 字數上限：願望、調整、暱稱、管理者的回覆 */
export const WISH_MAX = 5000;
export const TWEAK_MAX = 2000;
export const NICK_MAX = 20;
export const REPLY_MAX = 1000;
/** 至少要寫幾個字 */
export const BODY_MIN = 5;
/** 參考連結最多幾個、每個多長 */
export const LINKS_MAX = 3;
const LINK_LEN_MAX = 500;

export const WISH_STATUS = ['pending', 'approved', 'building', 'live', 'rejected', 'dropped', 'withdrawn'] as const;
export type WishStatus = (typeof WISH_STATUS)[number];
/** 結案、順幣退回的（之後不能再改） */
export const REFUNDED: readonly WishStatus[] = ['rejected', 'dropped', 'withdrawn'];
/** 還在處理中的（管理頁「待處理」、同一個願望一次只能有一個調整在處理） */
export const OPEN: readonly WishStatus[] = ['pending', 'approved', 'building'];
/** 管理者可以改成的進度（撤回只有許願的人自己能按） */
const ADMIN_STATUS: readonly WishStatus[] = ['pending', 'approved', 'building', 'live', 'rejected', 'dropped'];

const sqlList = (xs: readonly string[]): string => xs.map((x) => `'${x}'`).join(', ');

/** 使用者寫的字：統一換行、拿掉控制字元（換行留著）、前後空白，連續空行最多留一行 */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/** 參考連結：一行一個（或陣列），只收 http、https，重複的拿掉；太多、不是網址回傳錯誤訊息 */
export function parseLinks(v: unknown): string[] | string {
  const raw = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? v.split(/\s+/) : [];
  const out: string[] = [];
  for (const s of raw.map((x) => x.trim()).filter(Boolean)) {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return `「${s.slice(0, 40)}」不是網址，參考連結要用 https:// 開頭`;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '參考連結要用 https:// 開頭';
    if (s.length > LINK_LEN_MAX) return `參考連結太長了（最多 ${LINK_LEN_MAX} 字）`;
    if (!out.includes(u.href)) out.push(u.href);
  }
  return out.length > LINKS_MAX ? `參考連結最多 ${LINKS_MAX} 個` : out;
}

export interface WishInput {
  body: string;
  nickname: string | null;
  links: string[];
}

/** 送出的願望：想法（必填）、暱稱、參考連結、同意規範；不對回傳錯誤訊息 */
export function parseWish(input: unknown): WishInput | string {
  const o = (input ?? {}) as { body?: unknown; nickname?: unknown; links?: unknown; agree?: unknown };
  if (typeof o.body === 'string' && o.body.trim().length > WISH_MAX) return `想法最多 ${WISH_MAX} 字`;
  const body = cleanText(o.body, WISH_MAX);
  if (body.length < BODY_MIN) return `想法至少寫 ${BODY_MIN} 個字`;
  if (o.agree !== true) return '請先看過並勾選許願規範';
  const nickname = cleanText(o.nickname, 200).replace(/\s+/g, ' ');
  if (nickname.length > NICK_MAX) return `暱稱最多 ${NICK_MAX} 字`;
  const links = parseLinks(o.links);
  if (typeof links === 'string') return links;
  return { body, nickname: nickname || null, links };
}

/** 送出的調整：想改哪裡（必填）；不對回傳錯誤訊息 */
export function parseTweak(input: unknown): string | { body: string } {
  const raw = (input as { body?: unknown } | null)?.body;
  if (typeof raw === 'string' && raw.trim().length > TWEAK_MAX) return `調整最多 ${TWEAK_MAX} 字`;
  const body = cleanText(raw, TWEAK_MAX);
  return body.length < BODY_MIN ? `想改哪裡至少寫 ${BODY_MIN} 個字` : { body };
}

/** 下一次調整要幾枚順幣（免費的還有就是 0） */
export const tweakCost = (freeUsed: number): number => (freeUsed < TWEAK_FREE ? 0 : TWEAK_COST);

interface WishRow {
  id: number;
  kind: 'wish' | 'tweak';
  parent_id: number | null;
  body: string;
  nickname: string | null;
  links: string | null;
  status: WishStatus;
  cost: number;
  free: number;
  reply: string | null;
  seen: number;
  created_at: number;
  updated_at: number;
}

export interface TweakOut {
  id: number;
  body: string;
  status: WishStatus;
  /** 投了幾枚順幣（免費的是 0） */
  cost: number;
  reply: string | null;
  seen: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WishOut extends TweakOut {
  nickname: string | null;
  links: string[];
  /** 免費調整還剩幾次 */
  freeLeft: number;
  /** 下一次調整要幾枚順幣 */
  tweakCost: number;
  /** 有一個調整還在處理（做好前不能再送） */
  tweaking: boolean;
  tweaks: TweakOut[];
}

const linksOf = (s: string | null): string[] => {
  try {
    const v: unknown = JSON.parse(s ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/** 調整用掉的免費次數（不通過、撤回的不算） */
const freeUsed = (tweaks: WishRow[]): number => tweaks.filter((t) => t.free && !REFUNDED.includes(t.status)).length;

/** 照 id 排好的一台的願望、調整，整理成願望底下掛著調整 */
export function groupWishes(rows: WishRow[]): WishOut[] {
  const base = (r: WishRow): TweakOut => ({ id: r.id, body: r.body, status: r.status, cost: r.cost, reply: r.reply, seen: !!r.seen, createdAt: r.created_at, updatedAt: r.updated_at });
  return rows
    .filter((r) => r.kind === 'wish')
    .map((w) => {
      const tweaks = rows.filter((r) => r.kind === 'tweak' && r.parent_id === w.id);
      const used = freeUsed(tweaks);
      return {
        ...base(w),
        nickname: w.nickname,
        links: linksOf(w.links),
        freeLeft: Math.max(0, TWEAK_FREE - used),
        tweakCost: tweakCost(used),
        tweaking: tweaks.some((t) => OPEN.includes(t.status)),
        tweaks: tweaks.map(base),
      };
    });
}

const needDevice = (device: string | null): string => {
  if (!device) throw new ReportError(400, '缺少裝置代碼，請重新整理頁面');
  return device;
};

const coinCount = async (env: Env, device: string): Promise<number> =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM item_grants WHERE device_id = ? AND item = 'coin' AND used_at IS NULL").bind(device).first<{ n: number }>())?.n ?? 0;

/** 這台的願望（新的在前）、幾個有新進度還沒看、現在有幾枚順幣 */
export async function myWishes(env: Env, device: string | null): Promise<{ wishes: WishOut[]; unseen: number; coins: number }> {
  if (!device) return { wishes: [], unseen: 0, coins: 0 };
  const [w, c] = await env.DB.batch([
    env.DB.prepare('SELECT id, kind, parent_id, body, nickname, links, status, cost, free, reply, seen, created_at, updated_at FROM wishes WHERE device_id = ? ORDER BY id').bind(device),
    env.DB.prepare("SELECT COUNT(*) AS n FROM item_grants WHERE device_id = ? AND item = 'coin' AND used_at IS NULL").bind(device),
  ]);
  const rows = (w.results ?? []) as WishRow[];
  return { wishes: groupWishes(rows).reverse(), unseen: rows.filter((r) => !r.seen).length, coins: ((c.results ?? [])[0] as { n: number } | undefined)?.n ?? 0 };
}

/** 這個網路這一小時送太多次就擋下來 */
async function checkRate(env: Env, ip: string, now: number): Promise<void> {
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM wishes WHERE ip_hash = ? AND created_at > ?').bind(ip, now - 3600).first<{ n: number }>();
  if ((n?.n ?? 0) >= WISHES_PER_IP_HOUR) throw new ReportError(429, '這個網路送太多次了，請過一陣子再試');
}

const randomToken = (): string => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * 寫進一筆願望或調整、同時暫扣順幣（同一個 batch，D1 一次只跑一個 batch，兩台同時送不會扣到同一枚）；
 * cond 是要寫進去的條件（順幣夠、沒有太多在審核中…），不成立就什麼都不做，回傳 null
 */
async function insertHolding(env: Env, device: string, ip: string, now: number, row: { kind: 'wish' | 'tweak'; parentId: number | null; body: string; nickname: string | null; links: string[]; cost: number; free: boolean }, cond: { sql: string; binds: unknown[] }): Promise<number | null> {
  const token = randomToken();
  const stmts = [
    env.DB.prepare(
      `INSERT INTO wishes (device_id, kind, parent_id, body, nickname, links, status, cost, free, seen, token, ip_hash, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 1, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM item_grants WHERE device_id = ? AND item = 'coin' AND used_at IS NULL) >= ? AND ${cond.sql}`,
    ).bind(device, row.kind, row.parentId, row.body, row.nickname, row.links.length ? JSON.stringify(row.links) : null, row.cost, row.free ? 1 : 0, token, ip, now, now, device, row.cost, ...cond.binds),
  ];
  if (row.cost > 0) {
    stmts.push(
      env.DB.prepare(
        `UPDATE item_grants SET used_at = ?, used_for = 'wish:' || (SELECT id FROM wishes WHERE token = ?)
          WHERE id IN (SELECT id FROM item_grants WHERE device_id = ? AND item = 'coin' AND used_at IS NULL ORDER BY id LIMIT ?)
            AND EXISTS (SELECT 1 FROM wishes WHERE token = ?)`,
      ).bind(now, token, device, row.cost, token),
    );
  }
  const r = await env.DB.batch(stmts);
  if (!r[0].meta.changes) return null;
  return (await env.DB.prepare('SELECT id FROM wishes WHERE token = ?').bind(token).first<{ id: number }>())?.id ?? null;
}

/** 許願：投 5 枚順幣（先暫扣），回傳這台現在的願望、順幣 */
export async function submitWish(env: Env, device: string | null, ip: string, input: unknown, now: number): Promise<{ id: number; wishes: WishOut[]; coins: number }> {
  const dev = needDevice(device);
  const p = parseWish(input);
  if (typeof p === 'string') throw new ReportError(400, p);
  await checkRate(env, ip, now);
  const id = await insertHolding(env, dev, ip, now, { kind: 'wish', parentId: null, ...p, cost: WISH_COST, free: false }, {
    sql: "(SELECT COUNT(*) FROM wishes WHERE device_id = ? AND kind = 'wish' AND status = 'pending') < ?",
    binds: [dev, MAX_PENDING_WISHES],
  });
  if (id === null) {
    const coins = await coinCount(env, dev);
    if (coins < WISH_COST) throw new ReportError(400, `順幣不夠：許願要 ${WISH_COST} 枚，你現在有 ${coins} 枚`);
    throw new ReportError(400, `同時最多 ${MAX_PENDING_WISHES} 個願望在審核中，等審核完再許`);
  }
  const mine = await myWishes(env, dev);
  return { id, wishes: mine.wishes, coins: mine.coins };
}

/** 上線的願望想調整：免費的 3 次用完後每次 1 枚順幣（先暫扣）；同一個願望一次只能有一個調整在處理 */
export async function submitTweak(env: Env, device: string | null, ip: string, wishId: number, input: unknown, now: number): Promise<{ id: number; wishes: WishOut[]; coins: number }> {
  const dev = needDevice(device);
  const p = parseTweak(input);
  if (typeof p === 'string') throw new ReportError(400, p);
  const { results } = await env.DB.prepare('SELECT id, kind, parent_id, body, nickname, links, status, cost, free, reply, seen, created_at, updated_at FROM wishes WHERE device_id = ? AND (id = ? OR parent_id = ?) ORDER BY id').bind(dev, wishId, wishId).all<WishRow>();
  const wish = results.find((r) => r.id === wishId && r.kind === 'wish');
  if (!wish) throw new ReportError(404, '找不到這個願望');
  if (wish.status !== 'live') throw new ReportError(400, '願望上線後才能調整');
  const tweaks = results.filter((r) => r.kind === 'tweak');
  if (tweaks.some((t) => OPEN.includes(t.status))) throw new ReportError(400, '上一次的調整還沒做好，做好後再送下一次');
  await checkRate(env, ip, now);
  const cost = tweakCost(freeUsed(tweaks));
  const id = await insertHolding(env, dev, ip, now, { kind: 'tweak', parentId: wishId, body: p.body, nickname: null, links: [], cost, free: cost === 0 }, {
    sql: `EXISTS (SELECT 1 FROM wishes WHERE id = ? AND device_id = ? AND kind = 'wish' AND status = 'live')
          AND NOT EXISTS (SELECT 1 FROM wishes WHERE parent_id = ? AND kind = 'tweak' AND status IN (${sqlList(OPEN)}))`,
    binds: [wishId, dev, wishId],
  });
  if (id === null) {
    const coins = await coinCount(env, dev);
    if (coins < cost) throw new ReportError(400, `免費調整用完了，再調整一次要 ${cost} 枚順幣，你現在有 ${coins} 枚`);
    throw new ReportError(409, '願望的進度剛好有變，請重新整理再試');
  }
  const mine = await myWishes(env, dev);
  return { id, wishes: mine.wishes, coins: mine.coins };
}

/** 退回暫扣的順幣 */
const refund = (env: Env, id: number): D1PreparedStatement => env.DB.prepare('UPDATE item_grants SET used_at = NULL, used_for = NULL WHERE used_for = ?').bind(`wish:${id}`);

/** 自己撤回還在審核中的願望、調整：順幣退回 */
export async function withdrawWish(env: Env, device: string | null, id: number, now: number): Promise<{ wishes: WishOut[]; coins: number }> {
  const dev = needDevice(device);
  const r = await env.DB.prepare("UPDATE wishes SET status = 'withdrawn', seen = 1, updated_at = ? WHERE id = ? AND device_id = ? AND status = 'pending'").bind(now, id, dev).run();
  if (!r.meta.changes) throw new ReportError(400, '只有審核中的才能撤回');
  await refund(env, id).run();
  const mine = await myWishes(env, dev);
  return { wishes: mine.wishes, coins: mine.coins };
}

/** 打開「我的願望」：新進度都看過了（道具按鈕的小紅點拿掉） */
export async function markWishesSeen(env: Env, device: string | null): Promise<{ unseen: 0 }> {
  await env.DB.prepare('UPDATE wishes SET seen = 1 WHERE device_id = ? AND seen = 0').bind(needDevice(device)).run();
  return { unseen: 0 };
}

// ---- 管理頁 ----

export interface AdminWish {
  id: number;
  kind: 'wish' | 'tweak';
  parentId: number | null;
  body: string;
  nickname: string | null;
  links: string[];
  status: WishStatus;
  cost: number;
  free: boolean;
  reply: string | null;
  createdAt: number;
  updatedAt: number;
  /** 調整的是哪個願望（原本的內容、暱稱） */
  parentBody: string | null;
  parentNickname: string | null;
  /** 同一台裝置的代號（裝置代碼雜湊的前 6 碼，只用來看是不是同一個人）、這台許過幾個願望 */
  who: string;
  whoWishes: number;
}

/** 管理頁的列表：open 待處理（審核中、已通過、製作中，舊的在前）、done 結案的（新的在前） */
export async function adminListWishes(env: Env, scope: string | null): Promise<AdminWish[]> {
  const done = scope === 'done';
  const statuses = done ? ['live', ...REFUNDED] : [...OPEN];
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.kind, w.parent_id, w.body, w.nickname, w.links, w.status, w.cost, w.free, w.reply, w.created_at, w.updated_at,
            p.body AS parent_body, p.nickname AS parent_nickname, substr(w.device_id, 1, 6) AS who,
            (SELECT COUNT(*) FROM wishes x WHERE x.device_id = w.device_id AND x.kind = 'wish') AS who_wishes
       FROM wishes w LEFT JOIN wishes p ON p.id = w.parent_id
      WHERE w.status IN (${sqlList(statuses)})
      ORDER BY ${done ? 'w.updated_at DESC' : 'w.created_at ASC'} LIMIT 200`,
  ).all<WishRow & { parent_body: string | null; parent_nickname: string | null; who: string; who_wishes: number }>();
  return results.map((r) => ({
    id: r.id,
    kind: r.kind,
    parentId: r.parent_id,
    body: r.body,
    nickname: r.nickname,
    links: linksOf(r.links),
    status: r.status,
    cost: r.cost,
    free: !!r.free,
    reply: r.reply,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    parentBody: r.parent_body,
    parentNickname: r.parent_nickname,
    who: r.who,
    whoWishes: r.who_wishes,
  }));
}

/**
 * 管理者改進度、回覆：{ status?, reply? }。改了許願的人那邊就亮小紅點。
 * 改成不通過、做不出來：順幣退回（不通過要寫原因）；已經退幣結案的不能再改進度（回覆還是可以改）
 */
export async function adminSetWish(env: Env, id: number, input: unknown, now: number): Promise<AdminWish> {
  const o = (input ?? {}) as { status?: unknown; reply?: unknown };
  const status = o.status === undefined ? null : (ADMIN_STATUS as readonly unknown[]).includes(o.status) ? (o.status as WishStatus) : undefined;
  if (status === undefined) throw new ReportError(400, `status 要是 ${ADMIN_STATUS.join(', ')} 其中一個`);
  const row = await env.DB.prepare('SELECT id, kind, status, reply FROM wishes WHERE id = ?').bind(id).first<{ id: number; kind: string; status: WishStatus; reply: string | null }>();
  if (!row) throw new ReportError(404, '找不到這個願望');
  const reply = o.reply === undefined ? row.reply : cleanText(o.reply, REPLY_MAX) || null;
  const next = status ?? row.status;
  if (REFUNDED.includes(row.status) && next !== row.status) throw new ReportError(400, '已經退幣結案的不能再改進度');
  if (next === 'rejected' && !reply) throw new ReportError(400, '不通過要寫原因（會給許願的人看）');
  const stmts = [env.DB.prepare('UPDATE wishes SET status = ?, reply = ?, seen = 0, updated_at = ? WHERE id = ?').bind(next, reply, now, id)];
  if (REFUNDED.includes(next) && !REFUNDED.includes(row.status)) stmts.push(refund(env, id));
  await env.DB.batch(stmts);
  const all = await adminListWishes(env, OPEN.includes(next) ? 'open' : 'done');
  const out = all.find((w) => w.id === id);
  if (!out) throw new ReportError(500, '改好了，但讀不回來，請重新整理');
  return out;
}

/** 有新的許願、調整：推到管理者訂閱的手機（跟回報問題同一組訂閱） */
export async function notifyWish(env: Env, id: number, now: number): Promise<number> {
  const row = await env.DB.prepare('SELECT kind, parent_id, body FROM wishes WHERE id = ?').bind(id).first<{ kind: string; parent_id: number | null; body: string }>();
  if (!row) return 0;
  return pushAdmins(env, {
    title: row.kind === 'tweak' ? `新的調整（第 ${row.parent_id} 號願望）` : `新的許願（第 ${id} 號）`,
    body: row.body.replace(/\s+/g, ' ').slice(0, 80),
    tag: 'wish',
    url: './admin.html#wishes',
    renotify: true,
  }, now);
}

/** IP 的雜湊 30 天後清掉；不通過、做不出來、撤回的 30 天後刪除（暫扣的順幣早就退了） */
export async function purgeWishes(env: Env, cutoff: number): Promise<number> {
  const r = await env.DB.batch([
    env.DB.prepare('UPDATE wishes SET ip_hash = NULL WHERE created_at < ? AND ip_hash IS NOT NULL').bind(cutoff),
    env.DB.prepare(`DELETE FROM wishes WHERE status IN (${sqlList(REFUNDED)}) AND updated_at < ?`).bind(cutoff),
  ]);
  return r.reduce((n, x) => n + (x.meta.changes ?? 0), 0);
}
