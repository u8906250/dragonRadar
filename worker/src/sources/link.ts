/**
 * 使用者貼上的 Threads 貼文連結：讀 Meta 提供給網站嵌入用的公開頁面（/embed）取得內文，
 * 發文時間從貼文代碼推算（Threads 沿用 Instagram 的編號，前 41 位元是建立時間）。
 */
import { decodeEntities } from './text';

export interface ThreadsLink {
  code: string;
  username: string | null;
}

const CODE_RE = /^[A-Za-z0-9_-]{6,20}$/;
/** Instagram 編號的起算時間（毫秒） */
const IG_EPOCH_MS = 1314220021721n;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Threads 上線前的代碼不可能是 Threads 貼文 */
const THREADS_LAUNCH = Date.UTC(2023, 6, 1) / 1000;

/** 從貼上的文字中找出 Threads 貼文連結，支援 threads.com / threads.net、@帳號/post/代碼 與 /t/代碼 */
export function parseThreadsUrl(input: string): ThreadsLink | null {
  const m = /https?:\/\/(?:www\.)?threads\.(?:com|net)\/(?:@([A-Za-z0-9_.]{1,30})\/post|t)\/([A-Za-z0-9_-]+)/i.exec(input);
  if (!m || !CODE_RE.test(m[2])) return null;
  return { code: m[2], username: m[1] ?? null };
}

const SHARE_RE = /https?:\/\/(?:www\.)?threads\.(?:com|net)\/share\/([A-Za-z0-9_-]{4,40})/i;

/** 連結或 Threads App「分享」產生的短網址（/share/xxx，會 302 轉到貼文） */
export async function resolveThreadsLink(input: string): Promise<ThreadsLink | null> {
  const direct = parseThreadsUrl(input);
  if (direct) return direct;
  const share = SHARE_RE.exec(input);
  if (!share) return null;
  try {
    const res = await fetch(`https://www.threads.com/share/${share[1]}/`, {
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; CurrentRadar/1.0; +https://current-radar.pages.dev)' },
    });
    const loc = res.headers.get('location');
    return loc ? parseThreadsUrl(loc) : null;
  } catch {
    return null;
  }
}

/** 貼文代碼換算成建立時間（unix 秒），不合理就回傳 null */
export function shortcodeToUnix(code: string, now = Math.floor(Date.now() / 1000)): number | null {
  if (!CODE_RE.test(code) || code.length > 11) return null;
  let n = 0n;
  for (const c of code) n = n * 64n + BigInt(ALPHABET.indexOf(c));
  const sec = Number(((n >> 23n) + IG_EPOCH_MS) / 1000n);
  return sec >= THREADS_LAUNCH && sec <= now + 3600 ? sec : null;
}

export type EmbedResult =
  | { status: 'ok'; text: string; username: string | null; location?: string | null }
  | { status: 'gone' }
  | { status: 'no_text' }
  | { status: 'error'; message: string };

/** 解析 /embed 頁面：回覆串會連上一層一起顯示，主貼文是帶 Full 的那一塊 */
export function parseEmbedHtml(html: string): EmbedResult {
  if (/OuterErrorContainer/.test(html)) return { status: 'gone' };
  const fullAt = html.indexOf('OuterContainerFull');
  const main = fullAt >= 0 ? html.slice(fullAt) : html;
  if (!/HeaderContainer/.test(main)) return { status: 'error', message: 'unexpected embed page' };
  const username = /class="HeaderLink"><span>([A-Za-z0-9_.]+)<\/span>/.exec(main)?.[1] ?? null;
  // 貼文的地點標記（Threads 發文時選的地點），內文沒寫地點時靠它
  const tag = /class="LocationText">([^<]{1,80})<\/span>/.exec(main)?.[1];
  const location = tag ? decodeEntities(tag).trim() || null : null;
  // 內文裡的 hashtag、連結是巢狀的 span / a，取到下一個 div（發文日期或圖片）之前
  const body = /class="BodyTextContainer">([\s\S]*?)<div/.exec(main)?.[1];
  if (body === undefined) return { status: 'no_text' };
  const text = decodeEntities(body.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
  return text ? { status: 'ok', text, username, location } : { status: 'no_text' };
}

/** 內文接上地點標記給判讀用；內文已經寫了同一個地點就不重複 */
export function withLocationTag(text: string, location: string | null | undefined): string {
  return location && !text.includes(location) ? `${text}\n\n📍 貼文的地點標記：${location}` : text;
}

export async function fetchThreadsPost(code: string): Promise<EmbedResult> {
  let res: Response;
  try {
    res = await fetch(`https://www.threads.com/t/${code}/embed`, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; CurrentRadar/1.0; +https://current-radar.pages.dev)', 'accept-language': 'zh-TW,zh;q=0.9' },
      redirect: 'follow',
    });
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
  if (res.status === 404) return { status: 'gone' };
  if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
  return parseEmbedHtml(await res.text());
}
