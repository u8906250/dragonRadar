/**
 * 手動加的關鍵字（migration 0047 的 learned_tags）：回報的人直接修改時加了判讀沒抽到的關鍵字，放上雷達後記成候選；
 * 管理者在管理頁採用了，之後同一個雷達的貼文內文寫到就標上（判讀的 postTags 把採用的跟寫死的常見詞 MODULE_TAGS 一起比對）。
 * 只影響關鍵字，判讀說明（給 AI 的 prompt）不動
 */
import { cleanTag, MODULE_TAGS } from './extract';
import type { Env } from './env';

export type LearnedStatus = 'pending' | 'adopted' | 'rejected';
export interface LearnedTag {
  module: string;
  tag: string;
  status: LearnedStatus;
  posts: number;
  lastPostId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 回報的人自己加的：最後的關鍵字裡，判讀原本沒有、也不是這個雷達寫死的常見詞 */
export function manualTags(module: string, finalTags: string[], judged: string[]): string[] {
  const common = MODULE_TAGS[module] ?? [];
  return [...new Set(finalTags)].filter((t) => !judged.includes(t) && !common.includes(t));
}

/** 放上雷達了：手動加的記成候選（已經有的多算一則；採用、不要的照舊） */
export async function learnTags(env: Env, module: string, tags: string[], postId: string, now: number): Promise<void> {
  const clean = [...new Set(tags.map(cleanTag).filter((t): t is string => !!t))];
  if (clean.length === 0) return;
  await env.DB.batch(
    clean.map((tag) =>
      env.DB.prepare(
        "INSERT INTO learned_tags (module, tag, status, posts, last_post_id, created_at, updated_at) VALUES (?, ?, 'pending', 1, ?, ?, ?) ON CONFLICT(module, tag) DO UPDATE SET posts = posts + 1, last_post_id = excluded.last_post_id, updated_at = excluded.updated_at",
      ).bind(module, tag, postId, now, now),
    ),
  );
}

/** 這個雷達採用的關鍵字（判讀時跟常見詞一起比對）；查不到（例如還沒建表）就當沒有 */
export async function adoptedTags(env: Env, module: string): Promise<string[]> {
  try {
    const r = await env.DB.prepare("SELECT tag FROM learned_tags WHERE module = ? AND status = 'adopted' ORDER BY posts DESC, tag").bind(module).all<{ tag: string }>();
    return r.results.map((x) => x.tag);
  } catch (e) {
    console.warn('adopted tags failed', e);
    return [];
  }
}

/** 管理頁：全部列出來（候選在前，同一種照幾則回報加過排） */
export async function listLearnedTags(env: Env): Promise<LearnedTag[]> {
  const r = await env.DB.prepare(
    "SELECT module, tag, status, posts, last_post_id, created_at, updated_at FROM learned_tags ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'adopted' THEN 1 ELSE 2 END, posts DESC, updated_at DESC LIMIT 500",
  ).all<{ module: string; tag: string; status: LearnedStatus; posts: number; last_post_id: string | null; created_at: number; updated_at: number }>();
  return r.results.map((x) => ({ module: x.module, tag: x.tag, status: x.status, posts: x.posts, lastPostId: x.last_post_id, createdAt: x.created_at, updatedAt: x.updated_at }));
}

/** 管理頁：採用、不要、改回候選；沒有這個詞回 false */
export async function setLearnedTag(env: Env, module: string, tag: string, status: LearnedStatus, now: number): Promise<boolean> {
  const r = await env.DB.prepare('UPDATE learned_tags SET status = ?, updated_at = ? WHERE module = ? AND tag = ?').bind(status, now, module, tag).run();
  return (r.meta.changes ?? 0) > 0;
}
