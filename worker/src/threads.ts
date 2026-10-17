export interface ThreadsPost {
  id: string;
  text: string;
  username: string;
  permalink: string;
  /** Threads 回傳格式，例如 2025-10-17T07:00:00+0000 */
  timestamp: string;
  media_type?: string;
}

export interface KeywordSearchOptions {
  q: string;
  since?: number;
  until?: number;
  authorUsername?: string;
  searchType?: 'TOP' | 'RECENT';
  limit?: number;
}

export interface ThreadsClient {
  readonly mode: 'live' | 'mock';
  keywordSearch(opts: KeywordSearchOptions): Promise<ThreadsPost[]>;
  replies(postId: string): Promise<ThreadsPost[]>;
  refreshToken(): Promise<{ access_token: string; expires_in: number } | null>;
}

export class ThreadsApiError extends Error {
  constructor(
    public readonly status: number,
    body: string,
  ) {
    super(`Threads API ${status}: ${body}`);
  }
}

export function parseThreadsTimestamp(ts: string): number {
  const fixed = ts.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(fixed);
  if (Number.isNaN(ms)) throw new Error(`bad Threads timestamp: ${ts}`);
  return Math.floor(ms / 1000);
}

const POST_FIELDS = 'id,text,username,permalink,timestamp,media_type';

type Params = Record<string, string | number | undefined>;

export class ThreadsApi implements ThreadsClient {
  readonly mode = 'live' as const;

  constructor(
    private readonly base: string,
    private readonly token: string,
  ) {}

  private async get<T>(path: string, params: Params): Promise<T> {
    const url = new URL(`${this.base.replace(/\/$/, '')}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
    url.searchParams.set('access_token', this.token);
    const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
    const body = await res.text();
    if (!res.ok) throw new ThreadsApiError(res.status, body.slice(0, 500));
    return JSON.parse(body) as T;
  }

  async keywordSearch(o: KeywordSearchOptions): Promise<ThreadsPost[]> {
    const data = await this.get<{ data?: ThreadsPost[] }>('/keyword_search', {
      q: o.q,
      search_type: o.searchType ?? 'RECENT',
      since: o.since,
      until: o.until,
      author_username: o.authorUsername,
      limit: o.limit ?? 100,
      fields: POST_FIELDS,
    });
    return (data.data ?? []).filter((p) => typeof p.text === 'string' && p.text.trim().length > 0);
  }

  async replies(postId: string): Promise<ThreadsPost[]> {
    const data = await this.get<{ data?: ThreadsPost[] }>(`/${encodeURIComponent(postId)}/replies`, {
      fields: POST_FIELDS,
      reverse: 'false',
    });
    return (data.data ?? []).filter((p) => typeof p.text === 'string');
  }

  async refreshToken(): Promise<{ access_token: string; expires_in: number } | null> {
    const url = new URL('/refresh_access_token', this.base);
    url.searchParams.set('grant_type', 'th_refresh_token');
    url.searchParams.set('access_token', this.token);
    const res = await fetch(url.toString());
    const body = await res.text();
    if (!res.ok) throw new ThreadsApiError(res.status, body.slice(0, 500));
    const j = JSON.parse(body) as { access_token?: string; expires_in?: number };
    if (!j.access_token) return null;
    return { access_token: j.access_token, expires_in: j.expires_in ?? 0 };
  }
}
