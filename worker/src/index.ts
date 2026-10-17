import { getAccessToken, makeClient, saveAccessToken } from './client';
import type { Env } from './env';
import { getEvent, getPost, ingestAll, listEvents, listKeywords, processBacklog, processPost, storePost, updateLifecycle, type EventRow } from './events';
import { jsonResponse, nowSec, parseIsoToUnix } from './util';

const REFRESH_CRON = '0 3 * * 1';

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let allow = '';
  if (allowed.includes('*')) allow = '*';
  else if (origin && allowed.includes(origin)) allow = origin;
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

  if (req.method === 'GET' && path === '/api/events') {
    const lat = num(url.searchParams.get('lat'));
    const lng = num(url.searchParams.get('lng'));
    const radiusKm = num(url.searchParams.get('radius_km')) ?? Number(env.DEFAULT_RADIUS_KM) ?? 30;
    const horizonH = num(url.searchParams.get('horizon_h')) ?? 24;
    const events = await listEvents(env, { lat, lng, radiusKm: Math.min(200, Math.max(1, radiusKm)), now, horizonSec: Math.min(168, Math.max(1, horizonH)) * 3600 });
    return jsonResponse({ now, events });
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
    return jsonResponse({ post_id: id, reason: result.reason, event: result.event, extraction: safeParse(extraction) });
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

  if (req.method === 'GET' && path === '/api/admin/posts') {
    const r = await env.DB.prepare('SELECT * FROM posts ORDER BY fetched_at DESC LIMIT 100').all();
    return jsonResponse({ posts: r.results.map((p) => ({ ...p, extraction: safeParse(p.extraction as string | null) })) });
  }

  if (req.method === 'GET' && path === '/api/admin/keywords') {
    return jsonResponse({ keywords: await listKeywords(env) });
  }

  if (req.method === 'POST' && path === '/api/admin/keywords') {
    const body = await readJson<{ term?: string }>(req);
    const term = body.term?.trim();
    if (!term) throw new HttpError(400, 'term is required');
    await env.DB.prepare('INSERT INTO keywords (term, enabled, created_at) VALUES (?, 1, ?) ON CONFLICT(term) DO UPDATE SET enabled = 1')
      .bind(term, now)
      .run();
    return jsonResponse({ keywords: await listKeywords(env) });
  }

  const kwMatch = /^\/api\/admin\/keywords\/(\d+)$/.exec(path);
  if (req.method === 'DELETE' && kwMatch) {
    await env.DB.prepare('UPDATE keywords SET enabled = 0 WHERE id = ?').bind(Number(kwMatch[1])).run();
    return jsonResponse({ keywords: await listKeywords(env) });
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
  console.log(JSON.stringify({ cron, mode: client.mode, ingest, backlog, lifecycle }));
}

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(env, req.headers.get('origin'));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const res = await handle(req, env, ctx);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
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
