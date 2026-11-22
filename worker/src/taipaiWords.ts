/**
 * 台派用詞（migration 0061 的 taipai_words，v1.775 使用者說「台派店家也可以提供類似關鍵字審核讓我決定」）：
 * 台派雷達判讀時 AI 說判成台派的依據（taipai_by，一個短詞），放上雷達後記下來；新的詞先照判讀放上雷達、列成候選，
 * 管理者在管理頁決定：採用的寫進判讀說明（貼文寫到就算台派），不算台派的之後只靠這個詞判成台派的改送管理者判斷（已經放上雷達的不動）。
 * 看不出是台派、送給管理者判斷的店家，AI 也抓幾個可能是台派的說法（taipai_hints，v1.780），管理者在「台派店家待判斷」直接採用或不算。
 */
import type { Env } from './env';

export type TaipaiWordStatus = 'pending' | 'adopted' | 'rejected';
export interface TaipaiWord {
  word: string;
  status: TaipaiWordStatus;
  posts: number;
  lastPermalink: string | null;
  createdAt: number;
  updatedAt: number;
}
/** 判讀說明用的：採用的、不算台派的 */
export interface TaipaiWordLists {
  adopted: string[];
  rejected: string[];
}

/** 原本判讀說明裡寫的例子（migration 0061 先列成採用；查不到表時判讀照這些） */
export const SEED_TAIPAI_WORDS: TaipaiWordLists = { adopted: ['台派', '挺台', '顧台灣', '台灣價值', '台灣主權', '民主', '飄帶'], rejected: [] };
/** 判讀說明裡各列幾個（照幾則回報用過排） */
const PROMPT_WORDS = 40;
/** 一個詞最多幾個字 */
const WORD_MAX = 12;

/** AI 說的依據：去掉引號、#、空白，太長的截掉；沒有就 null */
export function cleanTaipaiWord(v: unknown): string | null {
  const t = typeof v === 'string' ? v.replace(/[「」『』"“”'‘’#＃\s]/g, '') : '';
  return t ? [...t].slice(0, WORD_MAX).join('') : null;
}

/** 判讀說明用的詞；查不到（例如還沒建表）就照原本的例子 */
export async function taipaiWordLists(env: Env): Promise<TaipaiWordLists> {
  try {
    const r = await env.DB.prepare("SELECT word, status FROM taipai_words WHERE status IN ('adopted', 'rejected') ORDER BY posts DESC, created_at, word").all<{ word: string; status: TaipaiWordStatus }>();
    const of = (s: TaipaiWordStatus): string[] => r.results.filter((x) => x.status === s).map((x) => x.word).slice(0, PROMPT_WORDS);
    return { adopted: of('adopted'), rejected: of('rejected') };
  } catch (e) {
    console.warn('taipai words failed', e);
    return SEED_TAIPAI_WORDS;
  }
}

/** 放上雷達了：判成台派的依據記下來（新的詞是候選，已經有的多算一則；採用、不算的照舊） */
export async function recordTaipaiWord(env: Env, word: string, postId: string, permalink: string | null, now: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO taipai_words (word, status, posts, last_post_id, last_permalink, created_at, updated_at) VALUES (?, 'pending', 1, ?, ?, ?, ?) ON CONFLICT(word) DO UPDATE SET posts = posts + 1, last_post_id = excluded.last_post_id, last_permalink = excluded.last_permalink, updated_at = excluded.updated_at",
  )
    .bind(word, postId, permalink, now, now)
    .run();
}

/** 管理頁：全部列出來（候選在前，照幾則回報用過排） */
export async function listTaipaiWords(env: Env): Promise<TaipaiWord[]> {
  const r = await env.DB.prepare(
    "SELECT word, status, posts, last_permalink, created_at, updated_at FROM taipai_words ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'adopted' THEN 1 ELSE 2 END, posts DESC, updated_at DESC LIMIT 500",
  ).all<{ word: string; status: TaipaiWordStatus; posts: number; last_permalink: string | null; created_at: number; updated_at: number }>();
  return r.results.map((x) => ({ word: x.word, status: x.status, posts: x.posts, lastPermalink: x.last_permalink, createdAt: x.created_at, updatedAt: x.updated_at }));
}

/** 管理頁：採用、不算台派、改回候選；還沒有的詞（「台派店家待判斷」AI 抓的說法）新增一個 */
export async function setTaipaiWord(env: Env, word: string, status: TaipaiWordStatus, now: number): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO taipai_words (word, status, posts, created_at, updated_at) VALUES (?, ?, 0, ?, ?) ON CONFLICT(word) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at',
  )
    .bind(word, status, now, now)
    .run();
}

/** 管理者判斷台派店家時按了 AI 抓的說法「採用」：這個詞採用，這家店算一則 */
export async function adoptTaipaiWord(env: Env, word: string, postId: string, permalink: string | null, now: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO taipai_words (word, status, posts, last_post_id, last_permalink, created_at, updated_at) VALUES (?, 'adopted', 1, ?, ?, ?, ?) ON CONFLICT(word) DO UPDATE SET status = 'adopted', posts = posts + 1, last_post_id = excluded.last_post_id, last_permalink = excluded.last_permalink, updated_at = excluded.updated_at",
  )
    .bind(word, postId, permalink, now, now)
    .run();
}

/** 這幾個詞現在的狀態（沒記過的不在裡面） */
export async function taipaiWordStatuses(env: Env, words: string[]): Promise<Map<string, TaipaiWordStatus>> {
  if (words.length === 0) return new Map();
  const r = await env.DB.prepare(`SELECT word, status FROM taipai_words WHERE word IN (${words.map(() => '?').join(',')})`)
    .bind(...words)
    .all<{ word: string; status: TaipaiWordStatus }>();
  return new Map(r.results.map((x) => [x.word, x.status]));
}
