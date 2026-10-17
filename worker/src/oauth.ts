import { saveAccessToken } from './client';
import type { Env } from './env';
import { jsonResponse, nowSec } from './util';

const AUTHORIZE_URL = 'https://www.threads.com/oauth/authorize';
const GRAPH = 'https://graph.threads.net';
/** 只要這兩個權限：讀基本資料、關鍵字搜尋 */
const SCOPES = ['threads_basic', 'threads_keyword_search'];
const STATE_TTL_SEC = 600;

export const CALLBACK_PATH = '/auth/threads/callback';
export const UNINSTALL_PATH = '/auth/threads/uninstall';
export const DELETE_PATH = '/auth/threads/delete';
export const DELETION_STATUS_PATH = '/auth/threads/deletion-status';

function html(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;font-family:'PingFang TC','Noto Sans TC',system-ui,sans-serif;background:#ea611d;color:#15171c;display:grid;place-items:center;min-height:100dvh;padding:16px;box-sizing:border-box}
main{background:#f4efe6;border:2px solid #15171c;border-radius:16px;box-shadow:6px 6px 0 #15171c;padding:24px;max-width:440px;width:100%}h1{font-size:20px;margin:0 0 12px}p{line-height:1.6;margin:0 0 10px}code{word-break:break-all}a{color:#03615a;font-weight:700}</style></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  )
    .bind(key, value, nowSec())
    .run();
}

async function getSetting(env: Env, key: string): Promise<string | null> {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

function randomHex(bytes = 16): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 管理員用：導向 Threads 授權頁。需要 ?key=ADMIN_TOKEN，避免別人把自己的帳號綁上來 */
export async function startAuth(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (!env.ADMIN_TOKEN || url.searchParams.get('key') !== env.ADMIN_TOKEN) return html('沒有權限', '<p>網址缺少正確的 key。</p>', 401);
  if (!env.THREADS_APP_ID || !env.THREADS_APP_SECRET) {
    return html('還沒設定 App', '<p>請先在 Cloudflare 設定 <code>THREADS_APP_ID</code> 與 <code>THREADS_APP_SECRET</code>。</p>', 500);
  }
  const state = randomHex();
  await setSetting(env, 'oauth_state', `${state}:${nowSec() + STATE_TTL_SEC}`);
  const auth = new URL(AUTHORIZE_URL);
  auth.searchParams.set('client_id', env.THREADS_APP_ID);
  auth.searchParams.set('redirect_uri', `${url.origin}${CALLBACK_PATH}`);
  auth.searchParams.set('scope', SCOPES.join(','));
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('state', state);
  return Response.redirect(auth.toString(), 302);
}

/** Threads 授權完成後回到這裡：code 換短效 token，再換 60 天長效 token，存進 D1 */
export async function handleCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const err = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (err) return html('授權取消', `<p>${err.replace(/[<>&]/g, '')}</p>`, 400);

  const code = (url.searchParams.get('code') ?? '').replace(/#_$/, '');
  const state = url.searchParams.get('state') ?? '';
  const saved = await getSetting(env, 'oauth_state');
  const [savedState, exp] = (saved ?? ':0').split(':');
  if (!code || !state || state !== savedState || Number(exp) < nowSec()) {
    return html('連結已失效', '<p>請重新從授權網址開始，10 分鐘內完成。</p>', 400);
  }
  await setSetting(env, 'oauth_state', '');

  const form = new URLSearchParams({
    client_id: env.THREADS_APP_ID ?? '',
    client_secret: env.THREADS_APP_SECRET ?? '',
    code,
    grant_type: 'authorization_code',
    redirect_uri: `${url.origin}${CALLBACK_PATH}`,
  });
  const shortRes = await fetch(`${GRAPH}/oauth/access_token`, { method: 'POST', body: form });
  const shortJson = (await shortRes.json().catch(() => ({}))) as { access_token?: string; user_id?: number | string; error?: { message?: string } };
  if (!shortRes.ok || !shortJson.access_token) {
    return html('換取 token 失敗', `<p>${(shortJson.error?.message ?? `HTTP ${shortRes.status}`).replace(/[<>&]/g, '')}</p>`, 502);
  }

  const longUrl = new URL(`${GRAPH}/access_token`);
  longUrl.searchParams.set('grant_type', 'th_exchange_token');
  longUrl.searchParams.set('client_secret', env.THREADS_APP_SECRET ?? '');
  longUrl.searchParams.set('access_token', shortJson.access_token);
  const longRes = await fetch(longUrl.toString());
  const longJson = (await longRes.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!longRes.ok || !longJson.access_token) {
    return html('換取長效 token 失敗', `<p>${(longJson.error?.message ?? `HTTP ${longRes.status}`).replace(/[<>&]/g, '')}</p>`, 502);
  }

  await saveAccessToken(env, longJson.access_token, longJson.expires_in);
  if (shortJson.user_id !== undefined) await setSetting(env, 'threads_user_id', String(shortJson.user_id));
  const days = Math.round((longJson.expires_in ?? 0) / 86400);
  return html(
    '已連線 Threads',
    `<p>長效 token 已存好${days ? `，有效 ${days} 天，系統每週會自動續期` : ''}。</p><p>10 分鐘內雷達會開始用關鍵字搜尋 Threads。</p><p><a href="https://current-radar.pages.dev/">回到洋流雷達</a></p>`,
  );
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** 驗證 Meta 送來的 signed_request（HMAC-SHA256，金鑰是 app secret），回傳 payload */
export async function verifySignedRequest(signed: string, secret: string): Promise<Record<string, unknown> | null> {
  const [sigPart, payloadPart] = signed.split('.');
  if (!sigPart || !payloadPart || !secret) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sigPart), new TextEncoder().encode(payloadPart));
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadPart))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readSigned(req: Request, env: Env): Promise<Record<string, unknown> | null> {
  const ct = req.headers.get('content-type') ?? '';
  let signed = '';
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    signed = String((await req.formData()).get('signed_request') ?? '');
  } else {
    signed = new URL(req.url).searchParams.get('signed_request') ?? '';
  }
  return verifySignedRequest(signed, env.THREADS_APP_SECRET ?? '');
}

/** 使用者移除授權或要求刪除資料時，刪掉我們存的 token（我們沒有存其他使用者資料） */
async function forgetUser(env: Env, userId: string): Promise<void> {
  const stored = await getSetting(env, 'threads_user_id');
  if (stored && stored === userId) {
    await env.DB.prepare("DELETE FROM settings WHERE key IN ('threads_access_token', 'threads_token_expires_at', 'threads_user_id')").run();
  }
}

export async function handleUninstall(req: Request, env: Env): Promise<Response> {
  const payload = await readSigned(req, env);
  if (!payload) return jsonResponse({ error: 'invalid signed_request' }, 400);
  await forgetUser(env, String(payload.user_id ?? ''));
  return jsonResponse({ ok: true });
}

export async function handleDelete(req: Request, env: Env): Promise<Response> {
  const payload = await readSigned(req, env);
  if (!payload) return jsonResponse({ error: 'invalid signed_request' }, 400);
  await forgetUser(env, String(payload.user_id ?? ''));
  const code = randomHex(8);
  const origin = new URL(req.url).origin;
  return jsonResponse({ url: `${origin}${DELETION_STATUS_PATH}?id=${code}`, confirmation_code: code });
}

export function deletionStatus(req: Request): Response {
  const id = (new URL(req.url).searchParams.get('id') ?? '').replace(/[^a-f0-9]/g, '');
  return html('資料刪除狀態', `<p>刪除要求 ${id ? `<code>${id}</code> ` : ''}已完成。洋流雷達不再保存你的 Threads 授權。</p>`);
}
