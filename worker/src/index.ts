import { getAccessToken, makeClient, saveAccessToken } from './client';
import type { Env } from './env';
import { DEFAULT_DURATION_SEC, ENDED_WORDS, MAX_FUTURE_SEC, MIN_CONFIDENCE, getEvent, getPost, ingestAll, ingestKeyword, listEvents, processBacklog, processPost, storePost, updateLifecycle, type EventRow } from './events';
import { runModel } from './extract';
import { addUserKeyword, listActiveKeywords, listAllKeywords, MAX_ACTIVE_KEYWORDS, normalizeKeyword, parseKeywordList, toKeywordOut, touchKeywords } from './keywords';
import { CALLBACK_PATH, DELETE_PATH, DELETION_STATUS_PATH, UNINSTALL_PATH, deletionStatus, handleCallback, handleDelete, handleUninstall, startAuth } from './oauth';
import { jsonResponse, nowSec, parseIsoToUnix } from './util';

const REFRESH_CRON = '0 3 * * 1';

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let allow = '';
  if (allowed.includes('*')) allow = '*';
  else if (origin && allowed.includes(origin)) allow = origin;
  else if (origin && /^https:\/\/[a-z0-9-]+\.current-radar\.pages\.dev$/.test(origin)) allow = origin;
  else allow = allowed[0] ?? '';
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function isAdmin(req: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  const auth = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return !!m && m[1].trim() === env.ADMIN_TOKEN;
}

function num(v: string | null): number | undefined {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function handle(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const now = nowSec();

  if (req.method === 'GET' && (path === '/' || path === '/api/health')) {
    const client = await makeClient(env);
    return jsonResponse({ ok: true, mode: client.mode, time: now });
  }

  // Threads 授權（給管理員綁定搜尋用的帳號）與 Meta 要求的解除授權、刪除資料回呼
  if (req.method === 'GET' && path === '/auth/threads/start') return startAuth(req, env);
  if (req.method === 'GET' && path === CALLBACK_PATH) return handleCallback(req, env);
  if (req.method === 'POST' && path === UNINSTALL_PATH) return handleUninstall(req, env);
  if (req.method === 'POST' && path === DELETE_PATH) return handleDelete(req, env);
  if (req.method === 'GET' && path === DELETION_STATUS_PATH) return deletionStatus(req);

  if (req.method === 'GET' && path === '/api/events') {
    const lat = num(url.searchParams.get('lat'));
    const lng = num(url.searchParams.get('lng'));
    const radiusKm = num(url.searchParams.get('radius_km')) ?? Number(env.DEFAULT_RADIUS_KM) ?? 80;
    const horizonH = num(url.searchParams.get('horizon_h')) ?? 24;
    const keywords = parseKeywordList(url.searchParams.get('keywords'));
    const events = await listEvents(env, {
      lat,
      lng,
      radiusKm: Math.min(600, Math.max(1, radiusKm)),
      now,
      horizonSec: Math.min(168, Math.max(1, horizonH)) * 3600,
      keywords,
    });
    if (keywords.length > 0) ctx.waitUntil(touchKeywords(env, keywords, now).catch((e) => console.warn('touch failed', e)));
    return jsonResponse({ now, events });
  }

  if (req.method === 'GET' && path === '/api/keywords') {
    const active = await listActiveKeywords(env, now);
    return jsonResponse({
      max: MAX_ACTIVE_KEYWORDS,
      userAdd: env.ALLOW_USER_KEYWORDS === 'true',
      keywords: active.map(toKeywordOut),
      // 給前端「判讀規則」說明用，跟實際程式共用同一組數值
      rules: {
        intervalMin: 10,
        defaultDurationMin: DEFAULT_DURATION_SEC / 60,
        maxFutureDays: MAX_FUTURE_SEC / 86400,
        minConfidence: MIN_CONFIDENCE,
        endedWords: ENDED_WORDS,
        region: '全台灣',
        kinds: { giveaway: '發放', activity: '活動' },
        timezone: 'Asia/Taipei',
      },
    });
  }

  // 使用者新增關鍵字：所有人共用，有上限，7 天沒人追蹤會自動停止搜尋
  if (req.method === 'POST' && path === '/api/keywords') {
    if (env.ALLOW_USER_KEYWORDS !== 'true') throw new HttpError(403, '目前不開放新增關鍵字');
    const body = await readJson<{ term?: unknown }>(req);
    const term = normalizeKeyword(body.term);
    if (!term) throw new HttpError(400, '關鍵字需為 2 到 20 個字，不能含特殊符號');
    const r = await addUserKeyword(env, term, now);
    if (r.status === 'full') throw new HttpError(429, `目前已有 ${MAX_ACTIVE_KEYWORDS} 個關鍵字在搜尋，請先追蹤現有的關鍵字`);
    if (r.status !== 'exists') {
      // 新關鍵字馬上搜一次，不用等下一輪 cron
      const kw = r.keyword;
      ctx.waitUntil(
        (async () => {
          const client = await makeClient(env);
          const res = await ingestKeyword(env, client, kw, nowSec());
          console.log(JSON.stringify({ firstIngest: res }));
        })().catch((e) => console.error('first ingest failed', e)),
      );
    }
    const active = await listActiveKeywords(env, now);
    return jsonResponse({ status: r.status, keyword: toKeywordOut(r.keyword), max: MAX_ACTIVE_KEYWORDS, keywords: active.map(toKeywordOut) }, r.status === 'created' ? 201 : 200);
  }

  const evMatch = /^\/api\/events\/(\d+)$/.exec(path);
  if (req.method === 'GET' && evMatch) {
    const ev = await getEvent(env, Number(evMatch[1]), now);
    if (!ev) throw new HttpError(404, 'not found');
    return jsonResponse({ now, event: ev });
  }

  if (path.startsWith('/api/admin/')) {
    if (!isAdmin(req, env)) throw new HttpError(401, 'unauthorized');
    return handleAdmin(req, env, ctx, path, now);
  }

  throw new HttpError(404, 'not found');
}

async function handleAdmin(req: Request, env: Env, _ctx: ExecutionContext, path: string, now: number): Promise<Response> {
  const allKeywords = async (): Promise<Response> => jsonResponse({ max: MAX_ACTIVE_KEYWORDS, keywords: await listAllKeywords(env) });
  const url = new URL(req.url);

  // 手動塞一則貼文進來跑完整流程（審核期間或測試用）
  if (req.method === 'POST' && path === '/api/admin/posts') {
    const body = await readJson<{ text?: string; username?: string; permalink?: string; posted_at?: string | number; keyword?: string }>(req);
    if (!body.text?.trim()) throw new HttpError(400, 'text is required');
    const postedAt = typeof body.posted_at === 'number' ? body.posted_at : parseIsoToUnix(body.posted_at) ?? now;
    const id = `manual-${crypto.randomUUID()}`;
    await storePost(env, { id, username: body.username ?? null, text: body.text, permalink: body.permalink ?? null, posted_at: postedAt, keyword: body.keyword ?? null, source: 'manual' }, now);
    const post = await getPost(env, id);
    if (!post) throw new HttpError(500, 'post not stored');
    const result = await processPost(env, post, now);
    const extraction = (await getPost(env, id))?.extraction ?? null;
    return jsonResponse({ post_id: id, reasons: result.reasons, events: result.events, extraction: safeParse(extraction) });
  }

  // 只判讀不存檔，用來比較模型：{ text, posted_at?, models?: string[] }
  if (req.method === 'POST' && path === '/api/admin/extract') {
    const body = await readJson<{ text?: string; posted_at?: string | number; models?: string[] }>(req);
    if (!body.text?.trim()) throw new HttpError(400, 'text is required');
    const postedAt = typeof body.posted_at === 'number' ? body.posted_at : parseIsoToUnix(body.posted_at) ?? now;
    const models = (body.models?.length ? body.models : [env.AI_MODEL, env.AI_MODEL_FALLBACK]).filter((m): m is string => !!m).slice(0, 6);
    const results = [];
    for (const m of models) results.push(await runModel(env, m, body.text, postedAt, now));
    return jsonResponse({ results });
  }

  if (req.method === 'POST' && path === '/api/admin/ingest') {
    const client = await makeClient(env);
    const ingest = await ingestAll(env, client, now);
    const backlog = await processBacklog(env, now);
    const lifecycle = await updateLifecycle(env, client, now);
    return jsonResponse({ mode: client.mode, ingest, backlog, lifecycle });
  }

  if (req.method === 'GET' && path === '/api/admin/events') {
    const status = url.searchParams.get('status');
    const sql = status
      ? 'SELECT e.*, p.username, p.permalink, p.text FROM events e JOIN posts p ON p.id = e.post_id WHERE e.status = ? ORDER BY e.start_at DESC LIMIT 200'
      : 'SELECT e.*, p.username, p.permalink, p.text FROM events e JOIN posts p ON p.id = e.post_id ORDER BY e.start_at DESC LIMIT 200';
    const stmt = status ? env.DB.prepare(sql).bind(status) : env.DB.prepare(sql);
    const r = await stmt.all<EventRow>();
    return jsonResponse({ events: r.results });
  }

  // 刪除一則貼文與它產生的事件（作者要求移除、或測試貼文）
  const postDel = /^\/api\/admin\/posts\/([^/]+)$/.exec(path);
  if (req.method === 'DELETE' && postDel) {
    const id = decodeURIComponent(postDel[1]);
    const r = await env.DB.batch([
      env.DB.prepare('DELETE FROM events WHERE post_id = ?').bind(id),
      env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id),
    ]);
    return jsonResponse({ deleted_events: r[0].meta.changes ?? 0, deleted_posts: r[1].meta.changes ?? 0 });
  }

  if (req.method === 'GET' && path === '/api/admin/posts') {
    const r = await env.DB.prepare('SELECT * FROM posts ORDER BY fetched_at DESC LIMIT 100').all();
    return jsonResponse({ posts: r.results.map((p) => ({ ...p, extraction: safeParse(p.extraction as string | null) })) });
  }

  if (req.method === 'GET' && path === '/api/admin/keywords') {
    return allKeywords();
  }

  if (req.method === 'POST' && path === '/api/admin/keywords') {
    // 管理員新增的關鍵字是固定搜尋（pinned），不受 7 天規則影響
    const body = await readJson<{ term?: unknown }>(req);
    const term = normalizeKeyword(body.term);
    if (!term) throw new HttpError(400, 'term must be 2-20 chars');
    await env.DB.prepare(
      "INSERT INTO keywords (term, enabled, pinned, source, created_at) VALUES (?, 1, 1, 'admin', ?) ON CONFLICT(term) DO UPDATE SET enabled = 1, pinned = 1",
    )
      .bind(term, now)
      .run();
    return allKeywords();
  }

  const kwMatch = /^\/api\/admin\/keywords\/(\d+)$/.exec(path);
  if (req.method === 'DELETE' && kwMatch) {
    await env.DB.prepare('UPDATE keywords SET enabled = 0, pinned = 0 WHERE id = ?').bind(Number(kwMatch[1])).run();
    return allKeywords();
  }

  if (req.method === 'POST' && path === '/api/admin/token') {
    const body = await readJson<{ access_token?: string; expires_in?: number }>(req);
    if (!body.access_token) throw new HttpError(400, 'access_token is required');
    await saveAccessToken(env, body.access_token, body.expires_in);
    return jsonResponse({ ok: true });
  }

  if (req.method === 'GET' && path === '/api/admin/token') {
    const token = await getAccessToken(env);
    const exp = await env.DB.prepare("SELECT value FROM settings WHERE key = 'threads_token_expires_at'").first<{ value: string }>();
    return jsonResponse({ has_token: !!token, token_suffix: token ? token.slice(-6) : null, expires_at: exp ? Number(exp.value) : null });
  }

  throw new HttpError(404, 'not found');
}

function safeParse(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** 隱私權政策承諾的保存期限：貼文與事件最多留 30 天 */
const RETENTION_SEC = 30 * 86400;
async function purgeOldData(env: Env, now: number): Promise<number> {
  const cutoff = now - RETENTION_SEC;
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM events WHERE end_at < ?').bind(cutoff),
    env.DB.prepare('DELETE FROM posts WHERE fetched_at < ? AND id NOT IN (SELECT post_id FROM events)').bind(cutoff),
  ]);
  return r.reduce((n, x) => n + (x.meta.changes ?? 0), 0);
}

async function refreshTokenJob(env: Env): Promise<void> {
  const client = await makeClient(env);
  if (client.mode !== 'live') return;
  const r = await client.refreshToken();
  if (!r) {
    console.warn('token refresh returned nothing');
    return;
  }
  await saveAccessToken(env, r.access_token, r.expires_in);
  console.log(`threads token refreshed, expires in ${r.expires_in}s`);
}

async function runScheduled(env: Env, cron: string): Promise<void> {
  if (cron === REFRESH_CRON) {
    await refreshTokenJob(env);
    return;
  }
  const now = nowSec();
  const client = await makeClient(env);
  const ingest = await ingestAll(env, client, now);
  const backlog = await processBacklog(env, now);
  const lifecycle = await updateLifecycle(env, client, now);
  const purged = await purgeOldData(env, now);
  console.log(JSON.stringify({ cron, mode: client.mode, ingest, backlog, lifecycle, purged }));
}

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(env, req.headers.get('origin'));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      // Response.redirect() 等回應的標頭是唯讀的，先複製一份再補 CORS 標頭
      const original = await handle(req, env, ctx);
      const out = new Response(original.body, original);
      for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      return out;
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, status, cors);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(env, event.cron));
  },
} satisfies ExportedHandler<Env>;
