import { getAccessToken, makeClient, saveAccessToken } from './client';
import type { Env } from './env';
import { fetchThreadsProfile } from './sources/profile';
import { DEFAULT_DURATION_SEC, ENDED_WORDS, MAX_FUTURE_SEC, MIN_CONFIDENCE, SPOT_MAX_DAYS, extendOpenSpots, getEvent, getPost, ingestAll, ingestKeyword, clearEventSnapshots, listEvents, locatePlaceForEvent, processBacklog, processPost, relocateApprox, planPost, reprocessPost, setManualTitle, storePost, updateLifecycle, type EventRow, type PostRow } from './events';
import { normalizeExtraction, runModel } from './extract';
import { geocode } from './geocode';
import { ingestNews, NEWS_FEEDS } from './sources/news';
import { listRoutes, syncVoyage, VOYAGE_PAGE } from './sources/voyage';
import { CURRENT_MAP_URL } from './sources/currentmap';
import { mergeIntoOfficial } from './sources/merge';
import { apifyTrial } from './sources/apify';
import { fetchThreadsPost, resolveThreadsLink, shortcodeToUnix } from './sources/link';
import { applyFeedback, deleteAdminSubscription, listFeedback, notifyAdmins, purgeFeedback, saveAdminSubscription, setFeedbackStatus, submitFeedback } from './feedback';
import { SESSION_SPEC } from './badminton';
import { FOOD_SPEC } from './food';
import { JOB_SPEC } from './jobs';
import { moduleOf } from './modules';
import { PUSH_RADIUS_KM, PushError, b64urlEncode, deleteSubscription, encryptPayload, purgeSubscriptions, pushStarted, saveSubscription, sendPush, vapidKeys } from './push';
import { confirmLink, ENDED_REPORTS_NEEDED, MAX_LINK_AGE_SEC, ReportError, ipHash, myReports, purgeReports, recheckLinks, rejectLink, reportEnded, submitLink, supplementLink, withdrawReport } from './reports';
import { D1Meter, isTransient, withResilientDb } from './db';
import { addressCacheKey, geocodeAddress, parseTwAddress } from './address';
import { adminListBottles, adminSetBottle, BOTTLE_MAX_WEIGHT, BOTTLE_TTL_SEC, bottlesEnabled, collectLetter, deleteBottle, deviceId, DRIFT_EVERY_SEC, driftBottles, dropBottle, listBottles, myBottles, PER_DEVICE_PER_DAY, PICK_RADIUS_M, pickBottle, purgeBottles, recycleBottle, reportBottle } from './bottles';
import { approveSpotRequest, autoReview, cancelSpotRequest, listSpotRequests, locatePlace, rejectSpotRequest, SPOT_MAX_AGE_SEC, spotRequestStatus, type ApproveBody, type SpotRequestRow } from './spots';
import { addUserKeyword, listActiveKeywords, listAllKeywords, MAX_ACTIVE_KEYWORDS, normalizeKeyword, parseKeywordList, toKeywordOut, touchKeywords } from './keywords';
import { CALLBACK_PATH, DELETE_PATH, DELETION_STATUS_PATH, UNINSTALL_PATH, deletionStatus, handleCallback, handleDelete, handleUninstall, startAuth } from './oauth';
import { etagMatches, jsonResponse, nowSec, parseIsoToUnix } from './util';

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
    'access-control-allow-headers': 'content-type,authorization,x-device',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

async function sha1Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
    return jsonResponse({ ok: true, mode: client.mode, time: now, version: env.APP_VERSION ?? 'dev' });
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
    const module = moduleOf(url.searchParams.get('module'));
    const events = await listEvents(env, {
      module,
      lat,
      lng,
      // 全球：半個地球（約 20,000 km）
      radiusKm: Math.min(20040, Math.max(1, radiusKm)),
      now,
      horizonSec: Math.min(MAX_FUTURE_SEC / 3600, Math.max(1, horizonH)) * 3600,
      keywords,
    });
    if (keywords.length > 0) ctx.waitUntil(touchKeywords(env, keywords, now).catch((e) => console.warn('touch failed', e)));
    // 資料沒變就回 304（不再傳幾百 KB）：ETag 照事件內容算，瀏覽器的快取會自動帶 If-None-Match、拿快取的內容
    const body = JSON.stringify(events);
    const etag = `W/"${await sha1Hex(body)}"`;
    const headers = { etag, 'cache-control': 'private, no-cache' };
    if (etagMatches(req.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers });
    return new Response(`{"now":${now},"events":${body}}`, { headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
  }

  // 手機推播：公鑰、訂閱（含約略位置，換位置時再送一次）、取消
  if (req.method === 'GET' && path === '/api/push/key') {
    return jsonResponse({ key: (await vapidKeys(env)).publicKey, radiusKm: PUSH_RADIUS_KM });
  }
  if (req.method === 'POST' && path === '/api/push/subscribe') {
    const body = await readJson<{ subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } }>(req);
    const r = await saveSubscription(env, body, now);
    // 第一次訂閱送一則確認通知，順便確認收得到
    if (r.created && body.subscription?.endpoint && body.subscription.keys?.p256dh && body.subscription.keys.auth) {
      const sub = { endpoint: body.subscription.endpoint, p256dh: body.subscription.keys.p256dh, auth: body.subscription.keys.auth, lat: 0, lng: 0 };
      const msg = { title: '洋流雷達通知已開啟', body: `附近 ${PUSH_RADIUS_KM} 公里內開始發放、活動開始時會通知你（深夜 23:00–8:00 不通知）`, tag: 'welcome', url: './' };
      ctx.waitUntil(sendPush(env, sub, msg, now).catch((e) => console.warn('welcome push failed', e)));
    }
    return jsonResponse(r);
  }
  if (req.method === 'POST' && path === '/api/push/unsubscribe') {
    return jsonResponse(await deleteSubscription(env, await readJson<{ endpoint?: string }>(req)));
  }

  // 今天的車掃路線（實際路徑、各站預計時間、各路段認領人數）
  if (req.method === 'GET' && path === '/api/routes') {
    return jsonResponse({ now, routes: await listRoutes(env, now) });
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
        spotMaxDays: SPOT_MAX_DAYS,
        minConfidence: MIN_CONFIDENCE,
        endedWords: ENDED_WORDS,
        region: '全台灣',
        kinds: { giveaway: '發放', activity: '活動' },
        sources: {
          threads: env.THREADS_SEARCH_STATUS === 'approved' ? 'approved' : 'review',
          link: { maxAgeDays: MAX_LINK_AGE_SEC / 86400, recheckMin: 30, endedReportsNeeded: ENDED_REPORTS_NEEDED },
          spot: { maxAgeDays: SPOT_MAX_AGE_SEC / 86400, autoReview: env.SPOT_AUTO_REVIEW !== 'false' },
          bottles: { enabled: bottlesEnabled(env), maxWeight: BOTTLE_MAX_WEIGHT, maxChars: BOTTLE_MAX_WEIGHT / 2, pickRadiusM: PICK_RADIUS_M, ttlDays: BOTTLE_TTL_SEC / 86400, perDay: PER_DEVICE_PER_DAY, driftHours: DRIFT_EVERY_SEC / 3600 },
          official: { name: '台北大洋流「未來航線」', url: VOYAGE_PAGE, mapName: '大洋流車掃地圖', mapUrl: CURRENT_MAP_URL, intervalMin: 10 },
          news: { names: [...new Set(NEWS_FEEDS.map((f) => f.name))], intervalMin: 30 },
        },
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

  // 回報的人確認判讀沒錯就放上雷達：{ postId, token }；說判讀錯了：{ postId, token, note? }
  if (req.method === 'POST' && path === '/api/reports/confirm') {
    const result = await confirmLink(env, await readJson<{ postId?: unknown; token?: unknown }>(req), now, await deviceId(env, req));
    await mergeIntoOfficial(env, now).catch((e) => console.warn('merge failed', e));
    return jsonResponse(result);
  }
  // 貼文沒寫地點或時間：回報的人補充後再判讀一次 { postId, token, note }
  if (req.method === 'POST' && path === '/api/reports/supplement') {
    return jsonResponse(await supplementLink(env, await readJson<{ postId?: unknown; token?: unknown; note?: unknown }>(req), await ipHash(env, req), now, await deviceId(env, req)));
  }
  // 我的回報（裝置代碼放在 x-device 標頭）：列出、刪除自己回報的
  if (req.method === 'GET' && path === '/api/reports/mine') {
    const dev = await deviceId(env, req);
    return jsonResponse({ reports: dev ? await myReports(env, dev) : [] });
  }
  const mineDel = /^\/api\/reports\/(link-[\w-]+)$/.exec(path);
  if (req.method === 'DELETE' && mineDel) {
    const dev = await deviceId(env, req);
    if (!dev) throw new HttpError(400, '缺少裝置代碼，請重新整理頁面');
    return jsonResponse(await withdrawReport(env, mineDel[1], dev, now));
  }
  if (req.method === 'POST' && path === '/api/reports/reject') {
    return jsonResponse(await rejectLink(env, await readJson<{ postId?: unknown; token?: unknown; note?: unknown }>(req)));
  }

  // 使用者貼上 Threads 貼文連結：{ url }。判讀好先回傳預覽（outcome = 'preview'），確認了才上雷達
  if (req.method === 'POST' && path === '/api/reports') {
    const body = await readJson<{ url?: unknown; module?: unknown }>(req);
    if (typeof body.url !== 'string' || body.url.length > 2000) throw new HttpError(400, '請貼上 Threads 貼文連結');
    const result = await submitLink(env, body.url, await ipHash(env, req), now, await deviceId(env, req), moduleOf(body.module));
    // 回報的如果是官方車掃，馬上併進去，不用等排程
    await mergeIntoOfficial(env, now).catch((e) => console.warn('merge failed', e));
    return jsonResponse(result);
  }

  // 固定據點回報已經拿掉，統一用 /api/reports 判讀（AI 會自己判斷是不是固定據點）；
  // 舊版網頁還開著的人送出時告訴他改用哪裡。以前送出的進度查詢、取消照舊。
  if (req.method === 'POST' && path === '/api/spot-requests') {
    throw new HttpError(410, '固定據點回報已經合併到「回報 Threads 貼文」，直接貼連結就好，會自動判斷成固定據點。請重新整理頁面');
  }

  // ---- 漂流瓶（裝置代碼放在 x-device 標頭）----
  if (path === '/api/bottles' || path.startsWith('/api/bottles/')) {
    if (!bottlesEnabled(env)) throw new HttpError(403, '漂流瓶暫時關閉');
    const dev = await deviceId(env, req);
    if (req.method === 'GET' && path === '/api/bottles') {
      const radiusKm = Math.min(600, Math.max(0.1, num(url.searchParams.get('radius_km')) ?? 20));
      return jsonResponse({ now, bottles: await listBottles(env, dev, { lat: num(url.searchParams.get('lat')), lng: num(url.searchParams.get('lng')), radiusKm }, now) });
    }
    if (req.method === 'GET' && path === '/api/bottles/mine') return jsonResponse(await myBottles(env, dev, now));
    if (req.method === 'POST' && path === '/api/bottles') {
      return jsonResponse(await dropBottle(env, dev, await ipHash(env, req), await readJson<{ text?: unknown; lat?: unknown; lng?: unknown }>(req), now), 201);
    }
    const one = /^\/api\/bottles\/(\d+)(?:\/(pick|report|recycle|collect|uncollect))?$/.exec(path);
    if (one) {
      const id = Number(one[1]);
      if (req.method === 'POST' && (one[2] === 'collect' || one[2] === 'uncollect')) return jsonResponse(await collectLetter(env, dev, id, one[2] === 'collect', now));
      if (req.method === 'POST' && one[2] === 'recycle') return jsonResponse(await recycleBottle(env, dev, id, now));
      if (req.method === 'POST' && one[2] === 'pick') return jsonResponse(await pickBottle(env, dev, id, await readJson<{ lat?: unknown; lng?: unknown }>(req), now));
      if (req.method === 'POST' && one[2] === 'report') {
        const body = await readJson<{ reason?: unknown }>(req);
        return jsonResponse(await reportBottle(env, dev, await ipHash(env, req), id, body.reason, now));
      }
      if (req.method === 'DELETE' && !one[2]) return jsonResponse(await deleteBottle(env, dev, id));
    }
    throw new HttpError(404, 'not found');
  }

  // 回報的人取消自己的固定據點回報：{ key, cancelKey }
  if (req.method === 'POST' && path === '/api/spot-requests/cancel') {
    const body = await readJson<{ key?: unknown; cancelKey?: unknown }>(req);
    return jsonResponse(await cancelSpotRequest(env, body.key, body.cancelKey, now));
  }

  // 回報的人查審核進度：?keys=代碼,代碼
  if (req.method === 'GET' && path === '/api/spot-requests') {
    const keys = (url.searchParams.get('keys') ?? '').split(',').filter(Boolean);
    return jsonResponse({ requests: await spotRequestStatus(env, keys) });
  }

  const endedMatch = /^\/api\/events\/(\d+)\/ended$/.exec(path);
  if (req.method === 'POST' && endedMatch) {
    return jsonResponse(await reportEnded(env, Number(endedMatch[1]), await ipHash(env, req), now));
  }

  // 回報問題（地點錯誤、時間錯誤…）：{ kind, note }，推到管理者手機
  const fbMatch = /^\/api\/events\/(\d+)\/feedback$/.exec(path);
  if (req.method === 'POST' && fbMatch) {
    const { result, created } = await submitFeedback(env, Number(fbMatch[1]), await readJson(req), await deviceId(env, req), await ipHash(env, req), now);
    if (created) ctx.waitUntil(notifyAdmins(env, created, now).catch((e) => console.warn('notify admins failed', e)));
    return jsonResponse(result);
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

async function handleAdmin(req: Request, env: Env, ctx: ExecutionContext, path: string, now: number): Promise<Response> {
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
    const body = await readJson<{ text?: string; posted_at?: string | number; models?: string[]; module?: string }>(req);
    if (!body.text?.trim()) throw new HttpError(400, 'text is required');
    // module：用哪個模組的判讀（dog、badminton），沒給是洋流
    const mod = moduleOf(body.module);
    const spec = mod === 'dog' ? JOB_SPEC : mod === 'badminton' ? SESSION_SPEC : mod === 'food' ? FOOD_SPEC : undefined;
    const postedAt = typeof body.posted_at === 'number' ? body.posted_at : parseIsoToUnix(body.posted_at) ?? now;
    const models = (body.models?.length ? body.models : [env.AI_MODEL, env.AI_MODEL_FALLBACK]).filter((m): m is string => !!m).slice(0, 6);
    const results = [];
    for (const m of models) results.push(await runModel(env, m, body.text, postedAt, now, spec));
    return jsonResponse({ results });
  }

  // 試跑回報流程（判讀、定位、帳號簡介提示），不存檔：{ text, username?, posted_at?, supplement?, module? }
  if (req.method === 'POST' && path === '/api/admin/plan') {
    const body = await readJson<{ text?: string; username?: string; posted_at?: string | number; supplement?: string; module?: string }>(req);
    if (!body.text?.trim()) throw new HttpError(400, 'text is required');
    const postedAt = typeof body.posted_at === 'number' ? body.posted_at : parseIsoToUnix(body.posted_at) ?? now;
    const post: PostRow = { id: `dry-${crypto.randomUUID()}`, username: body.username ?? null, text: body.text, permalink: null, posted_at: postedAt, keyword: null, source: 'link', fetched_at: now, processed_at: null, extraction: null, supplement: body.supplement ?? null, module: moduleOf(body.module) };
    return jsonResponse(await planPost(env, post, now));
  }
  // 讀 Threads 帳號的公開名稱、簡介（確認伺服器抓得到）
  if (req.method === 'POST' && path === '/api/admin/profile') {
    const body = await readJson<{ username?: string }>(req);
    return jsonResponse({ profile: body.username ? await fetchThreadsProfile(body.username) : null });
  }

  // 問題回報：?status=open（預設）| resolved
  if (req.method === 'GET' && path === '/api/admin/feedback') {
    return jsonResponse({ feedback: await listFeedback(env, url.searchParams.get('status')) });
  }
  // 套用回報：{ action: 'supplement', note } 把說明當成補充、重新判讀；{ action: 'takedown', scope } 從雷達下架
  const fbApply = /^\/api\/admin\/feedback\/(\d+)\/apply$/.exec(path);
  if (req.method === 'POST' && fbApply) {
    return jsonResponse(await applyFeedback(env, Number(fbApply[1]), await readJson(req), now));
  }
  const fbStatus = /^\/api\/admin\/feedback\/(\d+)$/.exec(path);
  if (req.method === 'POST' && fbStatus) {
    return jsonResponse(await setFeedbackStatus(env, Number(fbStatus[1]), await readJson(req), now));
  }
  // 管理者手機收回報通知：{ subscription }；取消：{ endpoint }
  if (req.method === 'POST' && path === '/api/admin/push/subscribe') {
    const r = await saveAdminSubscription(env, await readJson(req), now);
    if (r.created) {
      const msg = { title: '會收到回報通知了', body: '有人回報地點錯誤、時間錯誤等問題時會通知你，點通知打開管理頁', tag: 'feedback-welcome', url: './admin.html' };
      ctx.waitUntil(sendPush(env, r.sub, msg, now, 'admin_push_subscriptions').catch((e) => console.warn('admin welcome push failed', e)));
    }
    return jsonResponse({ ok: true, created: r.created });
  }
  if (req.method === 'POST' && path === '/api/admin/push/unsubscribe') {
    return jsonResponse(await deleteAdminSubscription(env, await readJson(req)));
  }

  // 推播加密在 Workers 上對不對（RFC 8291 的範例），和目前的訂閱數
  if (req.method === 'POST' && path === '/api/admin/push-selftest') {
    const out = await encryptPayload(
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      'BTBZMqHH6r4Tts7J_aSIgg',
      new TextEncoder().encode('When I grow up, I want to be a watermelon'),
      { asPrivateB64: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', asPublicB64: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', saltB64: 'DGv6ra1nlYgDCS1FRnbzlw' },
    );
    const expected = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
    const subs = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{ n: number }>();
    // 雜湊用的鹽有沒有存好（換 ADMIN_TOKEN 前要是 true）
    const salt = await env.DB.prepare("SELECT 1 AS ok FROM settings WHERE key = 'hash_salt'").first<{ ok: number }>();
    return jsonResponse({ rfc8291: b64urlEncode(out) === expected, vapid: !!(await vapidKeys(env)).publicKey, subscriptions: subs?.n ?? 0, hashSaltStored: !!salt });
  }

  // 試用 Apify 的 Threads 爬蟲：只回傳結果與 AI 判讀，不寫入資料庫
  if (req.method === 'POST' && path === '/api/admin/apify-trial') {
    const body = await readJson<{ query?: string; maxResults?: number; extract?: boolean }>(req);
    const query = (body.query ?? '洋流').trim();
    const maxResults = Math.min(100, Math.max(1, Number(body.maxResults) || 50));
    return jsonResponse(await apifyTrial(env, query, maxResults, body.extract !== false));
  }

  // 只讀取貼文連結的內容、不判讀也不存檔，用來確認讀得到：{ url }
  if (req.method === 'POST' && path === '/api/admin/link-fetch') {
    const body = await readJson<{ url?: string }>(req);
    const link = await resolveThreadsLink(body.url ?? '');
    if (!link) throw new HttpError(400, 'not a Threads post URL');
    const postedAt = shortcodeToUnix(link.code, now);
    return jsonResponse({ link, postedAt, fetched: await fetchThreadsPost(link.code) });
  }

  // 立刻同步官方航線與新聞
  if (req.method === 'POST' && path === '/api/admin/sources') {
    const voyage = await syncVoyage(env, now);
    const news = await ingestNews(env, now);
    const merge = await mergeIntoOfficial(env, now);
    return jsonResponse({ voyage, news, merge });
  }

  if (req.method === 'POST' && path === '/api/admin/ingest') {
    const client = await makeClient(env);
    const ingest = await ingestAll(env, client, now);
    const backlog = await processBacklog(env, now);
    const lifecycle = await updateLifecycle(env, client, now);
    const extended = await extendOpenSpots(env, now);
    const relocated = await relocateApprox(env, now);
    return jsonResponse({ mode: client.mode, ingest, backlog, lifecycle, extended, relocated });
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

  // 用目前的判讀與定位規則重跑一則貼文：還沒結束的舊事件先刪掉
  const reMatch = /^\/api\/admin\/posts\/([^/]+)\/reprocess$/.exec(path);
  if (req.method === 'POST' && reMatch) {
    const id = decodeURIComponent(reMatch[1]);
    if (!(await getPost(env, id))) throw new HttpError(404, 'post not found');
    const result = await reprocessPost(env, id, now).catch((e: Error) => {
      throw new HttpError(400, e.message);
    });
    return jsonResponse({ post_id: id, reasons: result.reasons, events: result.events });
  }

  // 手動修正事件位置：{ lat, lng } 或 { query }（拿去查地圖）；approx_area 有值就標成約略位置，沒給就當作精確位置
  // 管理者直接改標題（同一個地點的每天時段一起改，重新判讀後照用）：{ title }
  const titleMatch = /^\/api\/admin\/events\/(\d+)\/title$/.exec(path);
  if (req.method === 'POST' && titleMatch) {
    const body = await readJson<{ title?: string }>(req);
    const title = (body.title ?? '').replace(/\s+/g, ' ').trim();
    if (!title || [...title].length > 30) throw new HttpError(400, 'title must be 1-30 chars');
    return jsonResponse({ changed: await setManualTitle(env, Number(titleMatch[1]), title, now) });
  }

  // 管理者改地點文字（同一則貼文、同一個地點還沒結束的一起改）：{ place_text }
  const placeMatch = /^\/api\/admin\/events\/(\d+)\/place$/.exec(path);
  if (req.method === 'POST' && placeMatch) {
    const body = await readJson<{ place_text?: string }>(req);
    const placeText = (body.place_text ?? '').replace(/\s+/g, ' ').trim();
    if (!placeText || [...placeText].length > 80) throw new HttpError(400, 'place_text must be 1-80 chars');
    const ev = await env.DB.prepare('SELECT post_id, place_text FROM events WHERE id = ?').bind(Number(placeMatch[1])).first<{ post_id: string; place_text: string }>();
    if (!ev) throw new HttpError(404, 'event not found');
    const r = await env.DB.prepare(
      "UPDATE events SET place_text = ?, updated_at = ? WHERE post_id = ? AND place_text = ? AND status IN ('upcoming', 'active', 'unlocated')",
    )
      .bind(placeText, now, ev.post_id, ev.place_text)
      .run();
    return jsonResponse({ changed: r.meta.changes ?? 0 });
  }

  const locMatch = /^\/api\/admin\/events\/(\d+)\/locate$/.exec(path);
  if (req.method === 'POST' && locMatch) {
    const body = await readJson<{ lat?: number; lng?: number; query?: string; approx_area?: string | null }>(req);
    let point: { lat: number; lng: number } | null = null;
    if (Number.isFinite(body.lat) && Number.isFinite(body.lng)) point = { lat: Number(body.lat), lng: Number(body.lng) };
    else if (body.query?.trim()) point = await geocode(env, body.query.trim());
    if (!point) throw new HttpError(400, '查不到這個地點，請直接給 lat、lng');
    const id = Number(locMatch[1]);
    await env.DB.prepare(
      "UPDATE events SET lat = ?, lng = ?, place_query = COALESCE(?, place_query), approx_area = ?, status = CASE WHEN status = 'unlocated' THEN (CASE WHEN start_at <= ? THEN 'active' ELSE 'upcoming' END) ELSE status END, updated_at = ? WHERE id = ?",
    )
      .bind(point.lat, point.lng, body.query?.trim() || null, body.approx_area?.trim() || null, now, now, id)
      .run();
    const ev = await getEvent(env, id, now);
    if (!ev) throw new HttpError(404, 'event not found');
    return jsonResponse({ event: ev });
  }

  // 固定據點只在每週幾開（例如貼文沒寫、查到週一公休）：{ weekdays: [2, 3, 4, 5, 6, 7] }，
  // 其他天還沒結束的時段下架（ended_reason = 'closed_day'），留下的時段標上每週幾
  const wdMatch = /^\/api\/admin\/posts\/([^/]+)\/weekdays$/.exec(path);
  if (req.method === 'POST' && wdMatch) {
    const id = decodeURIComponent(wdMatch[1]);
    const body = await readJson<{ weekdays?: unknown }>(req);
    const days = Array.isArray(body.weekdays) ? [...new Set(body.weekdays.map(Number))].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort() : [];
    if (days.length === 0 || days.length === 7) throw new HttpError(400, 'weekdays 要是 1–7（週一到週日）裡的幾天，不能全選');
    const r = await env.DB.prepare("SELECT id, start_at FROM events WHERE post_id = ? AND spot = 1 AND status IN ('upcoming', 'active')").bind(id).all<{ id: number; start_at: number }>();
    // 台北時間的星期幾：1 = 週一 … 7 = 週日
    const weekday = (t: number): number => ((Math.floor((t + 8 * 3600) / 86400) + 3) % 7) + 1;
    const closed = r.results.filter((e) => !days.includes(weekday(e.start_at))).map((e) => e.id);
    const kept = r.results.filter((e) => days.includes(weekday(e.start_at))).map((e) => e.id);
    const stmts = [
      ...closed.map((eid) => env.DB.prepare("UPDATE events SET status = 'ended', ended_reason = 'closed_day', updated_at = ? WHERE id = ?").bind(now, eid)),
      ...kept.map((eid) => env.DB.prepare('UPDATE events SET weekdays = ?, updated_at = ? WHERE id = ?').bind(days.join(','), now, eid)),
    ];
    if (stmts.length > 0) await env.DB.batch(stmts);
    return jsonResponse({ post_id: id, weekdays: days, closed, kept: kept.length });
  }

  // 拿掉回報的人補充的資料（重複或寫錯）：只改詳細資料上的顯示，雷達上的事件不動。
  // POST { note }：管理者替貼文補充（例如查到店名地址），之後用 .../reprocess 重新判讀
  const supDel = /^\/api\/admin\/posts\/([^/]+)\/supplement$/.exec(path);
  if (req.method === 'POST' && supDel) {
    const id = decodeURIComponent(supDel[1]);
    const body = await readJson<{ note?: string }>(req);
    const note = (body.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (note.length < 2) throw new HttpError(400, 'note is required');
    const r = await env.DB.prepare('UPDATE posts SET supplement = ? WHERE id = ?').bind(note, id).run();
    return jsonResponse({ post_id: id, updated: r.meta.changes ?? 0, supplement: note });
  }
  if (req.method === 'DELETE' && supDel) {
    const id = decodeURIComponent(supDel[1]);
    const r = await env.DB.prepare('UPDATE posts SET supplement = NULL WHERE id = ?').bind(id).run();
    return jsonResponse({ post_id: id, updated: r.meta.changes ?? 0 });
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

  // 漂流瓶：?status=active|hidden|deleted|removed
  if (req.method === 'GET' && path === '/api/admin/bottles') {
    return jsonResponse({ bottles: await adminListBottles(env, url.searchParams.get('status')) });
  }
  const bottleAdmin = /^\/api\/admin\/bottles\/(\d+)\/(remove|restore)$/.exec(path);
  if (req.method === 'POST' && bottleAdmin) {
    return jsonResponse(await adminSetBottle(env, Number(bottleAdmin[1]), bottleAdmin[2] === 'remove' ? 'removed' : 'active'));
  }

  // 固定據點審核佇列：?status=pending|approved|rejected
  if (req.method === 'GET' && path === '/api/admin/spot-requests') {
    return jsonResponse({ requests: await listSpotRequests(env, url.searchParams.get('status')) });
  }

  // 通過（再按一次就是修改）：{ title, item?, kind?, place_text?, place_query? 或 lat、lng, from?, until?, open?, close? }
  const spotOk = /^\/api\/admin\/spot-requests\/(\d+)\/approve$/.exec(path);
  if (req.method === 'POST' && spotOk) {
    return jsonResponse(await approveSpotRequest(env, Number(spotOk[1]), await readJson<ApproveBody>(req), now));
  }

  // 一次性：還在雷達上的事件，依當初的 AI 判讀標出「沒寫結束時間」「沒寫最後一天」（0015 之前建的）
  if (req.method === 'POST' && path === '/api/admin/backfill-open-end') {
    const { results } = await env.DB.prepare(
      `SELECT e.id, e.title, e.spot, e.all_day, p.extraction FROM events e JOIN posts p ON p.id = e.post_id
        WHERE e.status IN ('upcoming', 'active') AND p.source NOT IN ('official', 'spot') AND p.extraction IS NOT NULL`,
    ).all<{ id: number; title: string; spot: number; all_day: number; extraction: string }>();
    const day = (iso: string | null): string => (iso ?? '').slice(0, 10);
    const updates = [];
    for (const r of results) {
      const ex = normalizeExtraction((safeParse(r.extraction) as { response?: unknown } | null)?.response ?? null)?.events.find((x) => x.title === r.title);
      if (!ex) continue;
      const endOpen = r.all_day === 0 && ex.end_at === null;
      const untilOpen = r.spot === 1 && ex.until === null && !(ex.end_at && day(ex.end_at) > day(ex.start_at));
      updates.push(env.DB.prepare('UPDATE events SET end_open = ?, until_open = ? WHERE id = ?').bind(endOpen ? 1 : 0, untilOpen ? 1 : 0, r.id));
    }
    if (updates.length > 0) await env.DB.batch(updates);
    return jsonResponse({ checked: results.length, updated: updates.length });
  }

  // 查地點（給審核用）：{ q }，回傳門牌解析、門牌定位與最後用的座標
  if (req.method === 'POST' && path === '/api/admin/geocode') {
    const body = await readJson<{ q?: string; refresh?: boolean }>(req);
    const q = (body.q ?? '').trim();
    if (!q) throw new HttpError(400, 'q is required');
    const debug: { error?: string } = {};
    const address = parseTwAddress(q);
    // refresh：清掉這個門牌的快取重查（規則改了、之前查錯）
    if (body.refresh && address) await env.DB.prepare('DELETE FROM geocode_cache WHERE query = ?').bind(addressCacheKey(address)).run();
    const byAddress = await geocodeAddress(env, q, debug);
    // forEvent：判讀事件時實際的定位（門牌查不到退到那條路、再退到鄉鎮區）
    return jsonResponse({ address, byAddress, error: debug.error ?? null, located: await locatePlace(env, q), forEvent: await locatePlaceForEvent(env, q, q, Date.now() + 8000) });
  }

  // 用目前的規則重跑一次自動審核（例如自動審核暫時失敗的）
  const spotAuto = /^\/api\/admin\/spot-requests\/(\d+)\/auto$/.exec(path);
  if (req.method === 'POST' && spotAuto) {
    const row = await env.DB.prepare('SELECT * FROM spot_requests WHERE id = ?').bind(Number(spotAuto[1])).first<SpotRequestRow>();
    if (!row) throw new HttpError(404, 'request not found');
    return jsonResponse(await autoReview(env, row, now));
  }

  // 不通過：{ reason }；已通過的會從雷達撤下
  const spotNo = /^\/api\/admin\/spot-requests\/(\d+)\/reject$/.exec(path);
  if (req.method === 'POST' && spotNo) {
    const body = await readJson<{ reason?: string }>(req);
    return jsonResponse(await rejectSpotRequest(env, Number(spotNo[1]), body.reason ?? null, now));
  }

  // ?confirm=rejected 看回報的人說判讀錯的、pending 還沒確認的
  // D1 讀了幾列：?day=YYYY-MM-DD（UTC，預設今天），加上最近一次排程讀最多的查詢
  if (req.method === 'GET' && path === '/api/admin/usage') {
    const day = url.searchParams.get('day') ?? new Date(now * 1000).toISOString().slice(0, 10);
    const r = await env.DB.prepare('SELECT label, calls, rows_read FROM d1_usage WHERE day = ? ORDER BY rows_read DESC').bind(day).all();
    const top = await env.DB.prepare("SELECT value, updated_at FROM settings WHERE key = 'usage:cron:top'").first<{ value: string; updated_at: number }>();
    return jsonResponse({ day, usage: r.results, cronTop: top ? { at: top.updated_at, queries: safeParse(top.value) } : null });
  }

  if (req.method === 'GET' && path === '/api/admin/posts') {
    const confirm = url.searchParams.get('confirm');
    const r = confirm
      ? await env.DB.prepare('SELECT * FROM posts WHERE confirm_state = ? ORDER BY fetched_at DESC LIMIT 100').bind(confirm).all()
      : await env.DB.prepare('SELECT * FROM posts ORDER BY fetched_at DESC LIMIT 100').all();
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
  return r.reduce((n, x) => n + (x.meta.changes ?? 0), 0) + (await purgeReports(env, cutoff)) + (await purgeBottles(env, cutoff)) + (await purgeSubscriptions(env, cutoff)) + (await purgeFeedback(env, cutoff));
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

async function runScheduled(env: Env, cron: string, meter: D1Meter): Promise<void> {
  if (cron === REFRESH_CRON) {
    await refreshTokenJob(env);
    return;
  }
  const now = nowSec();
  // 每一項工作讀了幾列分開算（meter.label）
  const step = <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    meter.label = `cron:${label}`;
    return fn();
  };
  const client = await makeClient(env);
  // AUTO_SOURCES = "false"：不自動抓資料（Threads 關鍵字搜尋、新聞、官方航線），資料只從使用者回報來
  const auto = env.AUTO_SOURCES !== 'false';
  const ingest = auto ? await step('ingest', () => ingestAll(env, client, now)) : null;
  const backlog = await step('backlog', () => processBacklog(env, now));
  // 官方航線與車掃地圖每次都讀（路段認領人數會一直變），新聞每 30 分鐘（cron 每 10 分鐘跑一次）
  const minute = new Date(now * 1000).getUTCMinutes();
  const voyage = auto ? await step('voyage', () => syncVoyage(env, now)).catch((e) => ({ error: String(e) })) : null;
  const news = auto && minute % 30 < 10 ? await step('news', () => ingestNews(env, now)).catch((e) => ({ error: String(e) })) : null;
  const lifecycle = await step('lifecycle', () => updateLifecycle(env, client, now));
  // 剛開始的發放、活動推給 1 公里內有開通知的人
  const pushed = await step('push', () => pushStarted(env, now)).catch((e) => ({ error: String(e) }));
  // 沒寫最後一天的固定據點每天往後補時段（發完為止，不預設最後一天）
  // 下面幾項每次都要掃很多列（D1 免費方案每天讀 500 萬列），不用每 10 分鐘：每小時一次（整點後 10 分鐘內那次）
  const hourly = minute < 10;
  const extended = hourly ? await step('extend', () => extendOpenSpots(env, now)).catch((e) => ({ error: String(e) })) : null;
  // 有門牌卻只定位到路或鄉鎮區的，定時重查門牌（Overpass 恢復、OSM 補了門牌就改成精確位置）
  const relocated = hourly ? await step('relocate', () => relocateApprox(env, now)).catch((e) => ({ error: String(e) })) : null;
  const links = hourly ? await step('links', () => recheckLinks(env, now)).catch((e) => ({ error: String(e) })) : null;
  // 新聞、貼文講的是官方車掃就併進去（不管誰先到，每 30 分鐘重新比對；回報確認時另外會比對）
  const merge = auto && minute % 30 < 10 ? await step('merge', () => mergeIntoOfficial(env, now)).catch((e) => ({ error: String(e) })) : null;
  const drift = bottlesEnabled(env) ? await step('drift', () => driftBottles(env, now)).catch((e) => ({ error: String(e) })) : null;
  const purged = hourly ? await step('purge', () => purgeOldData(env, now)) : null;
  meter.label = '';
  console.log(JSON.stringify({ cron, mode: client.mode, ingest, backlog, voyage, news, lifecycle, pushed, extended, relocated, links, merge, drift, purged, rowsRead: meter.rowsRead }));
}

/** 這個 isolate 累積、還沒寫進 d1_usage 的 API 讀取量；最多每 2 分鐘寫一次 */
const pendingUsage = new Map<string, { calls: number; rows: number }>();
let usageFlushedAt = 0;
const USAGE_FLUSH_MS = 120_000;

function noteUsage(label: string, rows: number): void {
  const cur = pendingUsage.get(label) ?? { calls: 0, rows: 0 };
  cur.calls++;
  cur.rows += rows;
  pendingUsage.set(label, cur);
}

async function flushUsage(db: D1Database, force = false): Promise<void> {
  if (pendingUsage.size === 0 || (!force && Date.now() - usageFlushedAt < USAGE_FLUSH_MS)) return;
  usageFlushedAt = Date.now();
  const day = new Date().toISOString().slice(0, 10);
  const rows = [...pendingUsage];
  pendingUsage.clear();
  await db
    .batch(
      rows.map(([label, v]) =>
        db
          .prepare('INSERT INTO d1_usage (day, label, calls, rows_read) VALUES (?, ?, ?, ?) ON CONFLICT(day, label) DO UPDATE SET calls = calls + excluded.calls, rows_read = rows_read + excluded.rows_read')
          .bind(day, label, v.calls, v.rows),
      ),
    )
    .catch((e) => console.warn('usage flush failed', e));
}

/** API 的標籤：路徑裡的編號換成 :id */
const usageLabel = (method: string, path: string): string => `${method} ${path.replace(/\/(?:link-[\w-]+|spot-[\w-]+|\d+)(?=\/|$)/g, '/:id')}`;

export default {
  async fetch(req, rawEnv, ctx) {
    const meter = new D1Meter();
    const env = withResilientDb(rawEnv, meter);
    const reqPath = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
    // 讀了幾列：回應標頭附上（方便量），也累積起來寫進 d1_usage
    const done = (res: Response): Response => {
      res.headers.set('x-d1-rows-read', String(meter.rowsRead));
      // 管理者：附上讀最多的查詢
      if (isAdmin(req, rawEnv)) res.headers.set('x-d1-top', encodeURIComponent(JSON.stringify(meter.top(10))));
      if (reqPath.startsWith('/api/')) {
        noteUsage(usageLabel(req.method, reqPath), meter.rowsRead);
        ctx.waitUntil(flushUsage(rawEnv.DB));
      }
      return res;
    };
    const cors = corsHeaders(env, req.headers.get('origin'));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      // Response.redirect() 等回應的標頭是唯讀的，先複製一份再補 CORS 標頭
      const original = await handle(req, env, ctx);
      // 有寫入的請求（回報、確認、管理者修改）：這個 isolate 暫存的事件清掉，下一次重讀
      if (req.method !== 'GET') clearEventSnapshots();
      const out = new Response(original.body, original);
      for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      return done(out);
    } catch (e) {
      if (e instanceof HttpError || e instanceof ReportError || e instanceof PushError) return done(jsonResponse({ error: e.message }, e.status, cors));
      // 非預期的錯誤（重試後還是失敗的資料庫錯誤等）：使用者只看到「暫時失敗」，細節留在紀錄；管理 API 照樣回傳細節方便除錯
      console.error(e);
      const detail = e instanceof Error ? e.message : String(e);
      const admin = new URL(req.url).pathname.startsWith('/api/admin/');
      return jsonResponse({ error: admin ? detail : '暫時失敗，請再試一次' }, isTransient(e) ? 503 : 500, cors);
    }
  },

  async scheduled(event, env, ctx) {
    const meter = new D1Meter();
    ctx.waitUntil(
      runScheduled(withResilientDb(env, meter), event.cron, meter).finally(async () => {
        for (const [label, rows] of meter.byLabel) noteUsage(label, rows);
        await flushUsage(env.DB, true);
        // 最近一次排程讀最多的查詢（找出哪裡讀太多）
        await env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
          .bind('usage:cron:top', JSON.stringify(meter.top(25)), nowSec())
          .run()
          .catch(() => undefined);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
