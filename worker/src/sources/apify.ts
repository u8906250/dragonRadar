import type { Env } from '../env';
import { runModel } from '../extract';
import { nowSec } from '../util';

/** Apify 上不需登入的 Threads 爬蟲（只在管理員試用時呼叫，不寫入資料庫） */
const ACTOR = 'aydar_cosmos~threads-scraper';

interface ApifyPost {
  id?: string;
  code?: string;
  url?: string;
  text?: string;
  caption?: string;
  timestamp?: string | number;
  publishedAt?: string | number;
  taken_at?: number;
  published_at?: string | number;
  like_count?: number;
  reply_count?: number;
  username?: string;
  author?: { username?: string } | string;
  likeCount?: number;
  likes?: number;
  [k: string]: unknown;
}

function toUnix(v: unknown): number | null {
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  }
  return null;
}

export interface TrialItem {
  username: string | null;
  postedAt: string | null;
  ageHours: number | null;
  likes: number | null;
  text: string;
  url: string | null;
  isEvent?: boolean;
  events?: Array<{ kind: string; title: string; start_at: string | null; place_query: string | null }>;
}

export async function apifyTrial(env: Env, query: string, maxResults: number, extract: boolean): Promise<{ ms: number; count: number; keys: string[]; items: TrialItem[]; error?: string }> {
  if (!env.APIFY_TOKEN) return { ms: 0, count: 0, keys: [], items: [], error: '還沒設定 APIFY_TOKEN' };
  const t0 = Date.now();
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=180&format=json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.APIFY_TOKEN}` },
    body: JSON.stringify({ mode: 'search', query, maxResults, proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] } }),
  });
  const body = await res.text();
  if (!res.ok) return { ms: Date.now() - t0, count: 0, keys: [], items: [], error: `Apify HTTP ${res.status}: ${body.slice(0, 300)}` };
  let rows: ApifyPost[] = [];
  try {
    rows = JSON.parse(body) as ApifyPost[];
  } catch {
    return { ms: Date.now() - t0, count: 0, keys: [], items: [], error: `無法解析回傳：${body.slice(0, 200)}` };
  }
  const now = nowSec();
  const items: TrialItem[] = [];
  for (const r of rows) {
    const ts = toUnix(r.published_at ?? r.timestamp ?? r.publishedAt ?? r.taken_at);
    const author = typeof r.author === 'string' ? r.author : r.author?.username;
    const text = String(r.text ?? r.caption ?? '');
    const item: TrialItem = {
      username: r.username ?? author ?? null,
      postedAt: ts ? new Date(ts * 1000).toISOString() : null,
      ageHours: ts ? Math.round(((now - ts) / 3600) * 10) / 10 : null,
      likes: typeof r.like_count === 'number' ? r.like_count : typeof r.likeCount === 'number' ? r.likeCount : typeof r.likes === 'number' ? r.likes : null,
      text: text.slice(0, 160),
      url: r.url ?? null,
    };
    if (extract && text.trim()) {
      const a = await runModel(env, env.AI_MODEL, text, ts ?? now, now);
      item.isEvent = a.extraction?.is_event ?? false;
      item.events = (a.extraction?.events ?? []).map((e) => ({ kind: e.kind, title: e.title, start_at: e.start_at, place_query: e.place_query }));
    }
    items.push(item);
  }
  return { ms: Date.now() - t0, count: rows.length, keys: rows[0] ? Object.keys(rows[0]).slice(0, 40) : [], items };
}
