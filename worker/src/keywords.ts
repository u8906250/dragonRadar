import type { Env } from './env';
import { nowSec } from './util';

/** 同時搜尋的關鍵字上限。每個關鍵字每天約 144 次查詢，10 個約 1,440 次，留空間給追蹤查詢 */
export const MAX_ACTIVE_KEYWORDS = 10;
/** 使用者新增的關鍵字多久沒人追蹤就停止搜尋 */
export const KEYWORD_TTL_SEC = 7 * 86400;
const TOUCH_INTERVAL_SEC = 3600;
const MIN_LEN = 2;
const MAX_LEN = 20;

export interface KeywordRow {
  id: number;
  term: string;
  enabled: number;
  last_since: number | null;
  created_at: number;
  pinned: number;
  source: string;
  last_requested_at: number | null;
}

export interface KeywordOut {
  term: string;
  pinned: boolean;
}

/** 清理使用者輸入的關鍵字，不合格回 null */
export function normalizeKeyword(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.normalize('NFKC').replace(/\s+/g, ' ').trim().replace(/^#+/, '').trim();
  const len = [...t].length;
  if (len < MIN_LEN || len > MAX_LEN) return null;
  if (/[<>{}\\%_]/.test(t)) return null;
  return t;
}

/** 解析 ?keywords=a,b,c，去重並限制數量 */
export function parseKeywordList(raw: string | null, max = 20): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const k = normalizeKeyword(part);
    if (k && !out.includes(k)) out.push(k);
    if (out.length >= max) break;
  }
  return out;
}

export const toKeywordOut = (k: KeywordRow): KeywordOut => ({ term: k.term, pinned: k.pinned === 1 });

export async function listAllKeywords(env: Env): Promise<KeywordRow[]> {
  return (await env.DB.prepare('SELECT * FROM keywords ORDER BY pinned DESC, id').all<KeywordRow>()).results;
}

/** 目前會被 cron 搜尋的關鍵字：固定的，加上 7 天內有人追蹤的 */
export async function listActiveKeywords(env: Env, now = nowSec()): Promise<KeywordRow[]> {
  const r = await env.DB.prepare(
    'SELECT * FROM keywords WHERE enabled = 1 AND (pinned = 1 OR last_requested_at > ?) ORDER BY pinned DESC, id',
  )
    .bind(now - KEYWORD_TTL_SEC)
    .all<KeywordRow>();
  return r.results;
}

/** 前端查事件時順便標記這些關鍵字還有人追蹤，一小時最多寫一次 */
export async function touchKeywords(env: Env, terms: string[], now = nowSec()): Promise<void> {
  if (terms.length === 0) return;
  const marks = terms.map(() => '?').join(',');
  await env.DB.prepare(
    `UPDATE keywords SET last_requested_at = ?
     WHERE term IN (${marks}) AND enabled = 1
       AND (last_requested_at IS NULL OR last_requested_at < ?)
       AND (pinned = 1 OR last_requested_at > ?)`,
  )
    .bind(now, ...terms, now - TOUCH_INTERVAL_SEC, now - KEYWORD_TTL_SEC)
    .run();
}

export type AddResult =
  | { status: 'exists' | 'created' | 'reactivated'; keyword: KeywordRow }
  | { status: 'full' };

export async function addUserKeyword(env: Env, term: string, now = nowSec()): Promise<AddResult> {
  const existing = await env.DB.prepare('SELECT * FROM keywords WHERE term = ?').bind(term).first<KeywordRow>();
  const isActive = (k: KeywordRow): boolean =>
    k.enabled === 1 && (k.pinned === 1 || (k.last_requested_at ?? 0) > now - KEYWORD_TTL_SEC);

  if (existing && isActive(existing)) {
    await env.DB.prepare('UPDATE keywords SET last_requested_at = ? WHERE id = ?').bind(now, existing.id).run();
    return { status: 'exists', keyword: { ...existing, last_requested_at: now } };
  }

  const active = await listActiveKeywords(env, now);
  if (active.length >= MAX_ACTIVE_KEYWORDS) return { status: 'full' };

  if (existing) {
    // 停用很久的關鍵字重新開始，last_since 歸零，避免一次撈回大量舊貼文
    const row = await env.DB.prepare('UPDATE keywords SET enabled = 1, last_requested_at = ?, last_since = NULL WHERE id = ? RETURNING *')
      .bind(now, existing.id)
      .first<KeywordRow>();
    return { status: 'reactivated', keyword: row as KeywordRow };
  }
  const row = await env.DB.prepare(
    "INSERT INTO keywords (term, enabled, pinned, source, last_requested_at, created_at) VALUES (?, 1, 0, 'user', ?, ?) RETURNING *",
  )
    .bind(term, now, now)
    .first<KeywordRow>();
  return { status: 'created', keyword: row as KeywordRow };
}
