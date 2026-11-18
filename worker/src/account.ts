/**
 * 帳號（選用）：用 passkey 登入（手機的指紋、臉、螢幕鎖），不用 email、密碼；伺服器只存 passkey 的公鑰。不登入照樣能用。
 * - 建立帳號、登入時，這台裝置的收集卡、道具、回報、許願、漂流瓶併進帳號（moveAll）。
 * - 之後這台的請求照舊帶 x-device，另外帶 x-account（登入的 token）：deviceId() 回傳帳號的 id，收集卡、許願…都掛在帳號下面，
 *   登入同一個帳號的每一台看到同一份。登出後這台回到自己的裝置代碼（帳號裡的東西留在帳號）。
 * - 網站（pages.dev）和 API（workers.dev）不同網域，瀏覽器會擋跨網域的 cookie，所以登入狀態是瀏覽器存 token、伺服器只存雜湊。
 * - passkey 綁網域：只有 current-radar.pages.dev（和它的預覽網址）能用；本機測試用 localhost。
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { moveOwned } from './cards';
import type { Env } from './env';
import { b64urlDecode, b64urlEncode } from './push';
import { hashSalt, ipHash, ReportError } from './reports';
import { sha1Hex } from './sources/text';
import { nowSec } from './util';

/** passkey 綁的網域 */
export const RP_ID = 'current-radar.pages.dev';
const RP_NAME = '活動雷達';
/** 一次性題目幾秒內有效 */
export const CHALLENGE_TTL_SEC = 300;
/** 多久沒用就登出（秒） */
export const SESSION_IDLE_SEC = 365 * 86400;
/** 同一個網路一天最多建幾個帳號、一小時最多要幾次題目 */
export const ACCOUNTS_PER_IP_DAY = 5;
export const CHALLENGES_PER_IP_HOUR = 60;
/** 一個帳號最多幾把 passkey */
export const MAX_PASSKEYS = 10;
/** passkey 跳出來等多久（毫秒） */
const CEREMONY_MS = 120_000;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const FLOW_RE = /^[A-Za-z0-9_-]{22}$/;

const toHex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
async function sha256Hex(s: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}

/** 這個網址用哪個 passkey 網域；不能用的是 null（本機測試只認 ALLOWED_ORIGINS 有列的 localhost） */
export function rpFor(origin: string | null, allowedOrigins: string): { rpID: string; origin: string } | null {
  if (!origin) return null;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return null;
  }
  if (u.origin !== origin) return null;
  if (u.protocol === 'https:' && (u.hostname === RP_ID || u.hostname.endsWith(`.${RP_ID}`))) return { rpID: RP_ID, origin };
  const allowed = allowedOrigins.split(',').map((s) => s.trim());
  if (u.protocol === 'http:' && u.hostname === 'localhost' && allowed.includes(origin)) return { rpID: 'localhost', origin };
  return null;
}

function needRp(env: Env, req: Request): { rpID: string; origin: string } {
  const rp = rpFor(req.headers.get('origin'), env.ALLOWED_ORIGINS);
  if (!rp) throw new ReportError(400, `這個網址不能用 passkey，請到 https://${RP_ID} 登入`);
  return rp;
}

/** 建立 passkey、登入的裝置寫成「iPhone · Safari」（帳號頁列出來給自己認） */
export function deviceLabel(ua: string): string {
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /CrOS/.test(ua)
          ? 'Chromebook'
          : /Macintosh|Mac OS X/.test(ua)
            ? 'Mac'
            : /Windows/.test(ua)
              ? 'Windows'
              : /Linux/.test(ua)
                ? 'Linux'
                : '';
  const browser = /Edg(A|iOS)?\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung'
      : /Firefox|FxiOS/.test(ua)
        ? 'Firefox'
        : /CriOS|Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
  return [os, browser].filter(Boolean).join(' · ') || '瀏覽器';
}

/** 帳號的名字（密碼管理員裡看到的）：「活動雷達 #A1B2C3」，照 user handle 的前 3 個位元組 */
export function accountName(userHandle: string): string {
  return `${RP_NAME} #${toHex(b64urlDecode(userHandle).slice(0, 3)).toUpperCase()}`;
}

// ---- 登入狀態 ----

export interface Session {
  accountId: string;
  tokenHash: string;
}

const sessions = new WeakMap<Request, Promise<Session | null>>();

/** 這個請求登入的帳號（x-account 標頭的 token）；沒登入、登出了、帳號刪了是 null。同一個請求只查一次 */
export function sessionOf(env: Env, req: Request): Promise<Session | null> {
  let p = sessions.get(req);
  if (!p) {
    p = findSession(env, req.headers.get('x-account'));
    sessions.set(req, p);
  }
  return p;
}

async function findSession(env: Env, token: string | null): Promise<Session | null> {
  if (!token || !TOKEN_RE.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare('SELECT account_id, last_used_at FROM account_sessions WHERE token_hash = ?').bind(tokenHash).first<{ account_id: string; last_used_at: number }>();
  if (!row) return null;
  const now = nowSec();
  if (now - row.last_used_at > SESSION_IDLE_SEC) return null;
  // 最後使用時間一天記一次就好
  if (now - row.last_used_at > 86400) await env.DB.prepare('UPDATE account_sessions SET last_used_at = ? WHERE token_hash = ?').bind(now, tokenHash).run();
  return { accountId: row.account_id, tokenHash };
}

/** 這台裝置自己的代碼（前端產生的隨機字串）換成雜湊；沒有或格式不對就是 null */
export async function physicalDevice(env: Env, req: Request): Promise<string | null> {
  const raw = req.headers.get('x-device') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(raw)) return null;
  return sha1Hex(`device|${raw}|${await hashSalt(env)}`, 24);
}

/** 收集卡、道具、許願、回報、漂流瓶認的人：登入帳號的是帳號的 id，沒登入是這台裝置代碼的雜湊 */
export async function deviceId(env: Env, req: Request): Promise<string | null> {
  return (await sessionOf(env, req))?.accountId ?? physicalDevice(env, req);
}

async function needSession(env: Env, req: Request): Promise<Session> {
  const s = await sessionOf(env, req);
  if (!s) throw new ReportError(401, '已經登出了，請重新整理頁面');
  return s;
}

/**
 * from 的東西全部搬到 to（登入時裝置→帳號，刪除帳號時帳號→這台）：引繼碼搬的那些（卡、道具、回報的累計、許願、漂流瓶收藏），
 * 加上自己丟的漂流瓶（「我丟的」、收回）、檢舉過的瓶子、沒通過審核的紀錄、我的回報、回報問題
 */
export function moveAll(env: Env, from: string, to: string): D1PreparedStatement[] {
  return [
    ...moveOwned(env, from, to),
    env.DB.prepare('UPDATE bottles SET device_id = ? WHERE device_id = ?').bind(to, from),
    env.DB.prepare('UPDATE OR IGNORE bottle_reports SET device_id = ? WHERE device_id = ?').bind(to, from),
    env.DB.prepare('DELETE FROM bottle_reports WHERE device_id = ?').bind(from),
    env.DB.prepare('UPDATE bottle_rejects SET device_id = ? WHERE device_id = ?').bind(to, from),
    env.DB.prepare('UPDATE submissions SET device = ? WHERE device = ?').bind(to, from),
    env.DB.prepare('UPDATE event_feedback SET device = ? WHERE device = ?').bind(to, from),
    // 還沒用的引繼碼作廢（東西已經搬走了）
    env.DB.prepare('DELETE FROM card_transfers WHERE device_id = ? AND used_at IS NULL').bind(from),
  ];
}

// ---- 一次性題目 ----

interface Challenge {
  challenge: string;
  account_id: string | null;
  user_handle: string | null;
  created_at: number;
}

async function newChallenge(env: Env, req: Request, kind: 'register' | 'login', challenge: string, accountId: string | null, userHandle: string | null, now: number): Promise<string> {
  const ip = await ipHash(env, req);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM passkey_challenges WHERE ip_hash = ? AND created_at > ?').bind(ip, now - 3600).first<{ n: number }>();
  if ((n?.n ?? 0) >= CHALLENGES_PER_IP_HOUR) throw new ReportError(429, '試太多次了，請過一陣子再試');
  const id = b64urlEncode(randomBytes(16));
  await env.DB.prepare('INSERT INTO passkey_challenges (id, challenge, kind, account_id, user_handle, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, challenge, kind, accountId, userHandle, ip, now)
    .run();
  return id;
}

/** 拿出題目（用一次就刪，兩邊同時送只有一邊拿得到） */
async function takeChallenge(env: Env, flow: unknown, kind: 'register' | 'login', now: number): Promise<Challenge> {
  if (typeof flow !== 'string' || !FLOW_RE.test(flow)) throw new ReportError(400, '逾時了，請再試一次');
  const row = await env.DB.prepare('DELETE FROM passkey_challenges WHERE id = ? AND kind = ? RETURNING challenge, account_id, user_handle, created_at').bind(flow, kind).first<Challenge>();
  if (!row || now - row.created_at > CHALLENGE_TTL_SEC) throw new ReportError(400, '逾時了，請再試一次');
  return row;
}

// ---- 帳號資料 ----

export interface AccountOut {
  name: string;
  createdAt: number;
  passkeys: Array<{ id: string; label: string; createdAt: number; lastUsedAt: number | null; synced: boolean }>;
  /** 登入中的裝置（current：這台） */
  devices: Array<{ label: string; createdAt: number; lastUsedAt: number; current: boolean }>;
}

async function accountOut(env: Env, s: Session): Promise<AccountOut | null> {
  const [acc, keys, devs] = await env.DB.batch([
    env.DB.prepare('SELECT user_handle, created_at FROM accounts WHERE id = ?').bind(s.accountId),
    env.DB.prepare('SELECT id, label, created_at, last_used_at, backed_up FROM passkeys WHERE account_id = ? ORDER BY created_at').bind(s.accountId),
    env.DB.prepare('SELECT token_hash, label, created_at, last_used_at FROM account_sessions WHERE account_id = ? ORDER BY last_used_at DESC').bind(s.accountId),
  ]);
  const a = (acc.results as Array<{ user_handle: string; created_at: number }>)[0];
  if (!a) return null;
  return {
    name: accountName(a.user_handle),
    createdAt: a.created_at,
    passkeys: (keys.results as Array<{ id: string; label: string | null; created_at: number; last_used_at: number | null; backed_up: number }>).map((k) => ({
      id: k.id,
      label: k.label ?? '瀏覽器',
      createdAt: k.created_at,
      lastUsedAt: k.last_used_at,
      synced: k.backed_up === 1,
    })),
    devices: (devs.results as Array<{ token_hash: string; label: string | null; created_at: number; last_used_at: number }>).map((d) => ({
      label: d.label ?? '瀏覽器',
      createdAt: d.created_at,
      lastUsedAt: d.last_used_at,
      current: d.token_hash === s.tokenHash,
    })),
  };
}

/** 這台登入的帳號；沒登入（或已經被登出）是 null */
export async function accountInfo(env: Env, req: Request): Promise<{ account: AccountOut | null }> {
  const s = await sessionOf(env, req);
  return { account: s ? await accountOut(env, s) : null };
}

async function newSession(env: Env, accountId: string, label: string, now: number): Promise<{ token: string; session: Session; stmt: D1PreparedStatement }> {
  const token = b64urlEncode(randomBytes(32));
  const tokenHash = await sha256Hex(token);
  return {
    token,
    session: { accountId, tokenHash },
    stmt: env.DB.prepare('INSERT INTO account_sessions (token_hash, account_id, label, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)').bind(tokenHash, accountId, label, now, now),
  };
}

// ---- 建立帳號、加一把 passkey ----

/** 建立帳號（沒登入）或幫登入的帳號再加一把 passkey（例如另一個牌子的手機、電腦）：回傳給瀏覽器的 passkey 設定 */
export async function registerOptions(env: Env, req: Request, now: number): Promise<{ flow: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const rp = needRp(env, req);
  const s = await sessionOf(env, req);
  let userHandle: string;
  let exclude: Array<{ id: string; transports?: string[] }> = [];
  if (s) {
    const acc = await env.DB.prepare('SELECT user_handle FROM accounts WHERE id = ?').bind(s.accountId).first<{ user_handle: string }>();
    if (!acc) throw new ReportError(401, '帳號已經刪除了，請重新整理頁面');
    const keys = await env.DB.prepare('SELECT id, transports FROM passkeys WHERE account_id = ?').bind(s.accountId).all<{ id: string; transports: string | null }>();
    if (keys.results.length >= MAX_PASSKEYS) throw new ReportError(400, `一個帳號最多 ${MAX_PASSKEYS} 把 passkey，請先刪掉用不到的`);
    userHandle = acc.user_handle;
    // 已經有的不要再建一次（同一個密碼管理員裡只會有一把）
    exclude = keys.results.map((k) => ({ id: k.id, transports: k.transports ? (JSON.parse(k.transports) as string[]) : undefined }));
  } else {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM accounts WHERE ip_hash = ? AND created_at > ?').bind(await ipHash(env, req), now - 86400).first<{ n: number }>();
    if ((n?.n ?? 0) >= ACCOUNTS_PER_IP_DAY) throw new ReportError(429, '這個網路今天建立太多帳號了，請明天再試');
    userHandle = b64urlEncode(randomBytes(16));
  }
  const name = accountName(userHandle);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: name,
    userDisplayName: name,
    userID: b64urlDecode(userHandle) as Uint8Array<ArrayBuffer>,
    attestationType: 'none',
    excludeCredentials: exclude,
    // 要能直接選帳號登入（不用先打帳號名稱）：passkey 要存在密碼管理員裡
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    timeout: CEREMONY_MS,
  });
  const flow = await newChallenge(env, req, 'register', options.challenge, s?.accountId ?? null, userHandle, now);
  return { flow, options };
}

/** 瀏覽器建好 passkey 送回來：驗證後建立帳號（併入這台的東西、登入）或加到登入的帳號 */
export async function registerVerify(env: Env, req: Request, body: unknown, now: number): Promise<{ token?: string; account: AccountOut | null }> {
  const rp = needRp(env, req);
  const b = (body ?? {}) as { flow?: unknown; response?: unknown };
  const ch = await takeChallenge(env, b.flow, 'register', now);
  const s = await sessionOf(env, req);
  if ((ch.account_id ?? null) !== (s?.accountId ?? null) || !ch.user_handle) throw new ReportError(400, '登入狀態變了，請重新整理頁面再試');
  let info;
  try {
    const v = await verifyRegistrationResponse({
      response: b.response as RegistrationResponseJSON,
      expectedChallenge: ch.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false,
    });
    if (!v.verified) throw new Error('not verified');
    info = v.registrationInfo;
  } catch (e) {
    console.warn('passkey register failed', e);
    throw new ReportError(400, 'passkey 驗證失敗，請再試一次');
  }
  const { credential } = info;
  const label = deviceLabel(req.headers.get('user-agent') ?? '');
  const insertKey = (accountId: string): D1PreparedStatement =>
    env.DB.prepare('INSERT INTO passkeys (id, account_id, public_key, counter, transports, backed_up, label, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(
      credential.id,
      accountId,
      b64urlEncode(credential.publicKey),
      credential.counter,
      credential.transports?.length ? JSON.stringify(credential.transports) : null,
      info.credentialBackedUp ? 1 : 0,
      label,
      now,
      now,
    );
  if (await env.DB.prepare('SELECT 1 AS x FROM passkeys WHERE id = ?').bind(credential.id).first()) throw new ReportError(400, '這把 passkey 已經加過了');
  if (s) {
    await insertKey(s.accountId).run();
    return { account: await accountOut(env, s) };
  }
  const accountId = toHex(randomBytes(12));
  const { token, session, stmt } = await newSession(env, accountId, label, now);
  const device = await physicalDevice(env, req);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO accounts (id, user_handle, ip_hash, created_at) VALUES (?, ?, ?, ?)').bind(accountId, ch.user_handle, await ipHash(env, req), now),
    insertKey(accountId),
    stmt,
    ...(device ? moveAll(env, device, accountId) : []),
  ]);
  return { token, account: await accountOut(env, session) };
}

// ---- 登入 ----

/** 登入（刪除帳號前確認也用這個）：不指定哪一把，讓瀏覽器列出這個網站的 passkey 給使用者選 */
export async function loginOptions(env: Env, req: Request, now: number): Promise<{ flow: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const rp = needRp(env, req);
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'preferred', timeout: CEREMONY_MS });
  return { flow: await newChallenge(env, req, 'login', options.challenge, null, null, now), options };
}

/** 驗證 passkey 的簽名：回傳是哪個帳號。找不到這把 passkey 回 404（瀏覽器可以通知密碼管理員刪掉） */
async function assertPasskey(env: Env, req: Request, body: unknown, now: number): Promise<{ accountId: string; keyId: string }> {
  const rp = needRp(env, req);
  const b = (body ?? {}) as { flow?: unknown; response?: unknown };
  const ch = await takeChallenge(env, b.flow, 'login', now);
  const response = b.response as AuthenticationResponseJSON | undefined;
  const id = typeof response?.id === 'string' ? response.id : '';
  const key = await env.DB.prepare('SELECT id, account_id, public_key, transports FROM passkeys WHERE id = ?')
    .bind(id)
    .first<{ id: string; account_id: string; public_key: string; transports: string | null }>();
  if (!key) throw new ReportError(404, '找不到這把 passkey 的帳號（可能已經刪除了），可以建立新的帳號');
  let info;
  try {
    const v = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge: ch.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      // 計數（防複製）不檢查：同步到雲端的 passkey 每台各自計數，檢查的話會把人擋在外面；記下最新的就好
      credential: { id: key.id, publicKey: b64urlDecode(key.public_key) as Uint8Array<ArrayBuffer>, counter: 0, transports: key.transports ? (JSON.parse(key.transports) as string[]) : undefined },
      requireUserVerification: false,
    });
    if (!v.verified) throw new Error('not verified');
    info = v.authenticationInfo;
  } catch (e) {
    console.warn('passkey login failed', e);
    throw new ReportError(400, 'passkey 驗證失敗，請再試一次');
  }
  await env.DB.prepare('UPDATE passkeys SET counter = ?, backed_up = ?, last_used_at = ? WHERE id = ?').bind(info.newCounter, info.credentialBackedUp ? 1 : 0, now, key.id).run();
  return { accountId: key.account_id, keyId: key.id };
}

/** 登入：這台的東西併進帳號（這台原本登入別的帳號的話先登出那個） */
export async function loginVerify(env: Env, req: Request, body: unknown, now: number): Promise<{ token: string; account: AccountOut | null }> {
  const { accountId } = await assertPasskey(env, req, body, now);
  const old = await sessionOf(env, req);
  const { token, session, stmt } = await newSession(env, accountId, deviceLabel(req.headers.get('user-agent') ?? ''), now);
  const device = await physicalDevice(env, req);
  await env.DB.batch([
    ...(old ? [env.DB.prepare('DELETE FROM account_sessions WHERE token_hash = ?').bind(old.tokenHash)] : []),
    stmt,
    ...(device ? moveAll(env, device, accountId) : []),
  ]);
  return { token, account: await accountOut(env, session) };
}

// ---- 登出、刪除 ----

/** 登出這台；others：登出其他所有裝置（這台留著） */
export async function logout(env: Env, req: Request, body: unknown): Promise<{ account: AccountOut | null }> {
  const s = await needSession(env, req);
  if ((body as { others?: unknown } | null)?.others === true) {
    await env.DB.prepare('DELETE FROM account_sessions WHERE account_id = ? AND token_hash != ?').bind(s.accountId, s.tokenHash).run();
    return { account: await accountOut(env, s) };
  }
  await env.DB.prepare('DELETE FROM account_sessions WHERE token_hash = ?').bind(s.tokenHash).run();
  return { account: null };
}

/** 刪掉一把 passkey（最後一把不能刪，不然登不進來） */
export async function deletePasskey(env: Env, req: Request, id: string): Promise<{ account: AccountOut | null }> {
  const s = await needSession(env, req);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE account_id = ?').bind(s.accountId).first<{ n: number }>();
  if ((n?.n ?? 0) <= 1) throw new ReportError(400, '這是最後一把 passkey，刪掉就登不進來了；不要帳號的話請用「刪除帳號」');
  const r = await env.DB.prepare('DELETE FROM passkeys WHERE id = ? AND account_id = ?').bind(id, s.accountId).run();
  if (!r.meta.changes) throw new ReportError(404, '找不到這把 passkey');
  return { account: await accountOut(env, s) };
}

/**
 * 刪除帳號（要先用這個帳號的 passkey 確認）：帳號、passkey 的公鑰、登入狀態從伺服器刪掉；帳號裡的東西搬回這台（跟沒有帳號時一樣），
 * 其他登入的裝置就看不到了。回傳 passkey 的 id，瀏覽器通知密碼管理員把它們刪掉
 */
export async function deleteAccount(env: Env, req: Request, body: unknown, now: number): Promise<{ passkeys: string[]; rpID: string }> {
  const s = await needSession(env, req);
  const device = await physicalDevice(env, req);
  if (!device) throw new ReportError(400, '缺少裝置代碼，請重新整理頁面');
  const { accountId } = await assertPasskey(env, req, body, now);
  if (accountId !== s.accountId) throw new ReportError(400, '請用這個帳號的 passkey 確認（選錯帳號了）');
  const keys = await env.DB.prepare('SELECT id FROM passkeys WHERE account_id = ?').bind(accountId).all<{ id: string }>();
  await env.DB.batch([
    ...moveAll(env, accountId, device),
    env.DB.prepare('DELETE FROM passkeys WHERE account_id = ?').bind(accountId),
    env.DB.prepare('DELETE FROM account_sessions WHERE account_id = ?').bind(accountId),
    env.DB.prepare('DELETE FROM passkey_challenges WHERE account_id = ?').bind(accountId),
    env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(accountId),
  ]);
  return { passkeys: keys.results.map((k) => k.id), rpID: needRp(env, req).rpID };
}

/** 排程清理：太久沒用的登入狀態、過期的題目；IP 的雜湊過了保存期限清掉 */
export async function purgeAccounts(env: Env, now: number, cutoff: number): Promise<number> {
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM account_sessions WHERE last_used_at < ?').bind(now - SESSION_IDLE_SEC),
    env.DB.prepare('DELETE FROM passkey_challenges WHERE created_at < ?').bind(now - 3600),
    env.DB.prepare('UPDATE accounts SET ip_hash = NULL WHERE created_at < ? AND ip_hash IS NOT NULL').bind(cutoff),
  ]);
  return r.reduce((n, x) => n + (x.meta.changes ?? 0), 0);
}
