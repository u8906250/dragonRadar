/**
 * 手機推播（Web Push）：網頁關掉也收得到「開始發放、活動開始」。
 * 訂閱時存推播服務給的網址與金鑰、約略位置（小數點後 3 位，約 100 公尺）；
 * 排程每 10 分鐘找剛開始的發放、活動（固定據點、整天的不推），推給 1 公里內的訂閱者。
 * 內容依 RFC 8291 加密（aes128gcm），用 RFC 8292 的 VAPID 金鑰簽名；金鑰第一次用到時產生，存在 settings。
 */
import type { Env } from './env';
import { tzOffsetSec, validTimeZone } from './extract';

/** 附近：訂閱的位置幾公里內 */
export const PUSH_RADIUS_KM = 1;
/** 開始後多久內（或剛放上雷達多久內）還算「剛開始」：排程每 10 分鐘，留一點餘裕 */
const FRESH_SEC = 30 * 60;
/** 深夜不推（訂閱者當地時間 23:00–08:00，沒有時區就是台灣時間）；那段時間開始的不補推 */
const QUIET_FROM_H = 23;
const QUIET_TO_H = 8;
/** 推播服務保留多久（手機離線太久就不送了） */
const PUSH_TTL_SEC = 30 * 60;
/** 一次排程最多推幾則，免得一次太多請求 */
const MAX_SENDS_PER_RUN = 200;
/** 只接受這些推播服務的網址，免得被拿去對任意網址發請求 */
const PUSH_HOSTS = /(?:^|\.)(?:fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
const VAPID_SUBJECT = 'https://github.com/u8906250/dragonRadar';

// ---- base64url ----

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const enc = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// ---- RFC 8291 加密 ----

/** P-256 公鑰（65 bytes，04 開頭）轉 JWK 的 x、y */
function publicJwk(raw: Uint8Array): JsonWebKey {
  return { kty: 'EC', crv: 'P-256', x: b64urlEncode(raw.slice(1, 33)), y: b64urlEncode(raw.slice(33, 65)), ext: true };
}

/**
 * 加密推播內容（aes128gcm，單一 record）。test 可以指定伺服器端的臨時金鑰和 salt，對 RFC 8291 的範例。
 */
export async function encryptPayload(
  uaPublicB64: string,
  authSecretB64: string,
  plaintext: Uint8Array,
  test?: { asPrivateB64: string; asPublicB64: string; saltB64: string },
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(uaPublicB64);
  const authSecret = b64urlDecode(authSecretB64);
  const salt = test ? b64urlDecode(test.saltB64) : crypto.getRandomValues(new Uint8Array(16));
  let asPrivate: CryptoKey;
  let asPublic: Uint8Array;
  if (test) {
    asPublic = b64urlDecode(test.asPublicB64);
    asPrivate = await crypto.subtle.importKey('jwk', { ...publicJwk(asPublic), d: test.asPrivateB64 }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  }
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // Workers 的型別把 public 寫成 $public，執行時一樣是標準的 public
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, asPrivate, 256));
  // HKDF（只要一個 block，直接用 HMAC 算）
  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 最後一個 record 後面接 0x02
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));
  const rs = 4096;
  const header = concat(salt, new Uint8Array([(rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255, asPublic.length]), asPublic);
  return concat(header, cipher);
}

// ---- VAPID ----

interface VapidKeys {
  privateKey: CryptoKey;
  /** 給瀏覽器訂閱用的公鑰（base64url，65 bytes） */
  publicKey: string;
}

let vapidCache: VapidKeys | null = null;

/** 讀 VAPID 金鑰；還沒有就產生一組存進 settings（同時有兩個請求產生時以先寫進去的為準） */
export async function vapidKeys(env: Env): Promise<VapidKeys> {
  if (vapidCache) return vapidCache;
  const read = async (): Promise<{ jwk: string; pub: string } | null> => {
    const r = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('vapid_private_jwk', 'vapid_public')").all<{ key: string; value: string }>();
    const m = new Map(r.results.map((x) => [x.key, x.value]));
    const jwk = m.get('vapid_private_jwk');
    const pub = m.get('vapid_public');
    return jwk && pub ? { jwk, pub } : null;
  };
  let stored = await read();
  if (!stored) {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
    const pub = b64urlEncode(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer));
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('vapid_private_jwk', ?, ?)").bind(jwk, now),
      env.DB.prepare("INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('vapid_public', ?, ?)").bind(pub, now),
    ]);
    stored = await read();
    if (!stored) throw new Error('vapid keys not stored');
  }
  const privateKey = await crypto.subtle.importKey('jwk', JSON.parse(stored.jwk) as JsonWebKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  vapidCache = { privateKey, publicKey: stored.pub };
  return vapidCache;
}

/** VAPID 的 Authorization 標頭：ES256 簽的 JWT，aud 是推播服務的網域 */
export async function vapidAuthorization(keys: VapidKeys, endpoint: string, now: number): Promise<string> {
  const head = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64urlEncode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: now + 12 * 3600, sub: VAPID_SUBJECT })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, enc.encode(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}

// ---- 訂閱 ----

export interface PushSubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  lat: number;
  lng: number;
  /** 訂閱者所在的時區（深夜不推照當地時間）；沒有就是台灣 */
  tz?: string | null;
}

export class PushError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname) && endpoint.length <= 1000;
  } catch {
    return false;
  }
}

/** 約略位置：小數點後 3 位（約 100 公尺） */
const coarse = (x: number): number => Math.round(x * 1000) / 1000;

/** 檢查瀏覽器送來的推播訂閱 { endpoint, keys: { p256dh, auth } } */
export function parseSubscription(v: unknown): Pick<PushSubRow, 'endpoint' | 'p256dh' | 'auth'> {
  const sub = (v ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const { endpoint } = sub;
  const p256dh = sub.keys?.p256dh;
  const auth = sub.keys?.auth;
  if (typeof endpoint !== 'string' || !isPushEndpoint(endpoint)) throw new PushError(400, '不支援這個瀏覽器的推播服務');
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !/^[\w-]{80,100}$/.test(p256dh) || !/^[\w-]{16,32}$/.test(auth)) throw new PushError(400, '推播訂閱資料不完整');
  return { endpoint, p256dh, auth };
}

/** 訂閱或更新位置：{ subscription: { endpoint, keys: { p256dh, auth } }, lat, lng } */
export async function saveSubscription(env: Env, body: unknown, now: number): Promise<{ ok: true; created: boolean }> {
  const b = (body ?? {}) as { subscription?: unknown; lat?: unknown; lng?: unknown; tz?: unknown };
  const { endpoint, p256dh, auth } = parseSubscription(b.subscription);
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new PushError(400, '位置不對');
  const tz = validTimeZone(typeof b.tz === 'string' ? b.tz.slice(0, 64) : null);
  const existed = await env.DB.prepare('SELECT 1 AS ok FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).first<{ ok: number }>();
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, lat, lng, tz, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, lat = excluded.lat, lng = excluded.lng, tz = excluded.tz, updated_at = excluded.updated_at`,
  )
    .bind(endpoint, p256dh, auth, coarse(lat), coarse(lng), tz, now, now)
    .run();
  return { ok: true, created: !existed };
}

export async function deleteSubscription(env: Env, body: unknown): Promise<{ ok: true }> {
  const endpoint = (body as { endpoint?: unknown } | null)?.endpoint;
  if (typeof endpoint !== 'string') throw new PushError(400, 'endpoint is required');
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
  return { ok: true };
}

// ---- 送出 ----

export interface PushMessage {
  title: string;
  body: string;
  /** 同一個 tag 的通知會取代，不會重複跳（網頁開著時的通知也用同一個 tag） */
  tag: string;
  /** 點通知打開的網址，相對於網站（例如「./?event=123」） */
  url: string;
  /** 同一個 tag 取代舊通知時也再響一次（管理者的回報通知） */
  renotify?: boolean;
}

/** 訂閱存在哪個表：大家的附近通知、管理者的回報通知 */
export type PushTable = 'push_subscriptions' | 'admin_push_subscriptions';

/** 送一則推播；回傳推播服務的狀態碼（201 成功；404、410 代表訂閱已失效，從 table 刪掉） */
export async function sendPush(
  env: Env,
  sub: Pick<PushSubRow, 'endpoint' | 'p256dh' | 'auth'>,
  msg: PushMessage,
  now: number,
  table: PushTable = 'push_subscriptions',
): Promise<number> {
  const keys = await vapidKeys(env);
  const body = await encryptPayload(sub.p256dh, sub.auth, enc.encode(JSON.stringify(msg)));
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: await vapidAuthorization(keys, sub.endpoint, now),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(PUSH_TTL_SEC),
      urgency: 'high',
    },
    body,
  });
  if (r.status === 404 || r.status === 410) await env.DB.prepare(`DELETE FROM ${table} WHERE endpoint = ?`).bind(sub.endpoint).run();
  else if (r.ok) await env.DB.prepare(`UPDATE ${table} SET last_push_at = ? WHERE endpoint = ?`).bind(now, sub.endpoint).run();
  else console.warn(`push ${new URL(sub.endpoint).host} ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status;
}

// ---- 排程：剛開始的發放、活動推給附近的人 ----

export interface StartedEvent {
  id: number;
  kind: string;
  title: string;
  place_text: string;
  lat: number;
  lng: number;
  approx_area: string | null;
}

export function distKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 深夜（23:00–08:00）不推；時區是訂閱者的，沒有就是台灣 */
export function isQuietHour(now: number, tz?: string | null): boolean {
  const offset = tz ? tzOffsetSec(now, tz) : 8 * 3600;
  const h = Math.floor((((now + offset) % 86400) + 86400) % 86400 / 3600);
  return h >= QUIET_FROM_H || h < QUIET_TO_H;
}

/** 每個訂閱者這次要推的：1 公里內剛開始的，近的在前；一個人一次只推一則（好幾個就合在一起） */
export function planPushes(subs: PushSubRow[], events: StartedEvent[]): Array<{ sub: PushSubRow; msg: PushMessage }> {
  const out: Array<{ sub: PushSubRow; msg: PushMessage }> = [];
  for (const sub of subs) {
    const near = events
      .map((e) => ({ e, km: distKm(sub, e) }))
      .filter((x) => x.km <= PUSH_RADIUS_KM)
      .sort((a, b) => a.km - b.km);
    if (near.length === 0) continue;
    const { e, km } = near[0];
    const head = near.length > 1 ? `附近 ${near.length} 個發放、活動開始了` : e.kind === 'activity' ? '活動開始' : '開始發放';
    const dist = `${Math.max(10, Math.round((km * 1000) / 10) * 10)} 公尺${e.approx_area ? '（約略位置）' : ''}`;
    const more = near.length > 1 ? `，還有 ${near.slice(1).map((x) => x.e.title).join('、')}` : '';
    out.push({ sub, msg: { title: head, body: `${e.title}｜${e.place_text}｜${dist}${more}`, tag: `ev-${e.id}`, url: `./?event=${e.id}` } });
  }
  return out;
}

/**
 * 找剛開始（或剛放上雷達就已經開始）、還沒推過的發放、活動，推給 1 公里內的訂閱者。
 * 找到的都標成推過（深夜、沒人在附近的也標），之後不會補推。
 */
export async function pushStarted(env: Env, now: number): Promise<{ events: number; sent: number; failed: number; quiet: number }> {
  const { results: events } = await env.DB.prepare(
    `SELECT id, kind, title, place_text, lat, lng, approx_area FROM events
      WHERE pushed_at IS NULL AND status IN ('upcoming', 'active') AND start_at <= ? AND end_at > ?
        AND (start_at > ? OR created_at > ?) AND spot = 0 AND all_day = 0
        AND lat IS NOT NULL AND lng IS NOT NULL AND merged_into IS NULL
      LIMIT 100`,
  )
    .bind(now, now, now - FRESH_SEC, now - FRESH_SEC)
    .all<StartedEvent>();
  if (events.length === 0) return { events: 0, sent: 0, failed: 0, quiet: 0 };
  await env.DB.prepare(`UPDATE events SET pushed_at = ? WHERE id IN (${events.map(() => '?').join(',')})`)
    .bind(now, ...events.map((e) => e.id))
    .run();
  // 只撈這些事件附近的訂閱
  const pad = PUSH_RADIUS_KM / 111 + 0.002;
  const lats = events.map((e) => e.lat);
  const lngs = events.map((e) => e.lng);
  // 經度一度的距離越往高緯度越短
  const lngPad = pad / Math.max(0.2, Math.cos((Math.max(...lats.map(Math.abs)) * Math.PI) / 180));
  const { results: subs } = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth, lat, lng, tz FROM push_subscriptions WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?',
  )
    .bind(Math.min(...lats) - pad, Math.max(...lats) + pad, Math.min(...lngs) - lngPad, Math.max(...lngs) + lngPad)
    .all<PushSubRow>();
  let sent = 0;
  let failed = 0;
  let quiet = 0;
  for (const { sub, msg } of planPushes(subs, events).slice(0, MAX_SENDS_PER_RUN)) {
    if (isQuietHour(now, sub.tz)) {
      quiet++;
      continue;
    }
    const status = await sendPush(env, sub, msg, now).catch((e) => {
      console.warn('push failed', e);
      return 0;
    });
    if (status >= 200 && status < 300) sent++;
    else failed++;
  }
  return { events: events.length, sent, failed, quiet };
}

/** 30 天沒打開網頁（沒更新訂閱）的刪掉 */
export async function purgeSubscriptions(env: Env, cutoff: number): Promise<number> {
  const r = await env.DB.prepare('DELETE FROM push_subscriptions WHERE updated_at < ?').bind(cutoff).run();
  return r.meta.changes ?? 0;
}
