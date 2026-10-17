import type { Env } from './env';
import { MockThreadsClient } from './mock';
import { ThreadsApi, type ThreadsClient } from './threads';
import { nowSec } from './util';

const TOKEN_KEY = 'threads_access_token';

export async function getAccessToken(env: Env): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(TOKEN_KEY).first<{ value: string }>();
  return row?.value || env.THREADS_ACCESS_TOKEN || null;
}

export async function saveAccessToken(env: Env, token: string, expiresIn?: number): Promise<void> {
  const now = nowSec();
  const stmt = env.DB.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  );
  const batch = [stmt.bind(TOKEN_KEY, token, now)];
  if (expiresIn) batch.push(stmt.bind('threads_token_expires_at', String(now + expiresIn), now));
  await env.DB.batch(batch);
}

/** MOCK_MODE=true 或沒有 token 時回傳示範 client */
export async function makeClient(env: Env): Promise<ThreadsClient> {
  if (env.MOCK_MODE === 'true') return new MockThreadsClient();
  const token = await getAccessToken(env);
  if (!token) return new MockThreadsClient();
  return new ThreadsApi(env.THREADS_API_BASE, token);
}
