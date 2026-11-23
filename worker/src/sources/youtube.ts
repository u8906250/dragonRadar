/**
 * 使用者貼上的 YouTube 社群貼文（v1.806 使用者問 YouTube 的貼文能不能判讀）：不用登入就讀得到，robots.txt 沒擋 /post/。
 * 頁面附 schema.org DiscussionForumPosting（JSON-LD）：全文、確切的發文時間、作者名稱、頻道網址（youtube.com/@帳號）。
 * 只收社群貼文、不收影片；只讀文字、不讀圖片。貼文不存在回 404
 */

const POST_RE = /https?:\/\/(?:(?:www|m)\.)?youtube\.com\/post\/([A-Za-z0-9_-]{20,60})/i;
/** 頻道「社群」分頁點開一則：youtube.com/@帳號/community?lb=代碼（也有 /posts、/channel/編號 的） */
const COMMUNITY_RE = /https?:\/\/(?:(?:www|m)\.)?youtube\.com\/(?:@[^/\s?#]+|channel\/[A-Za-z0-9_-]+|c\/[^/\s?#]+)\/(?:community|posts)\?(?:[^#\s]*&)?lb=([A-Za-z0-9_-]{20,60})/i;

export type YoutubeLink = { id: string };

/** 從貼上的文字找出 YouTube 社群貼文 */
export function parseYoutubePostUrl(input: string): YoutubeLink | null {
  const m = POST_RE.exec(input) ?? COMMUNITY_RE.exec(input);
  return m ? { id: m[1] } : null;
}

export const youtubePermalink = (id: string): string => `https://www.youtube.com/post/${id}`;

export type YoutubeResult =
  | { status: 'ok'; text: string; username: string | null; author: string | null; postedAt: number | null }
  | { status: 'gone' }
  | { status: 'no_text' }
  | { status: 'error'; message: string };

type ForumPosting = { '@type'?: unknown; text?: unknown; headline?: unknown; datePublished?: unknown; author?: { name?: unknown; url?: unknown } };

/**
 * 內文整理：拿掉 YouTube 包在外面的方向隔離字元（U+2068、U+2069），只有盲文空白（U+2800，常拿來空一行）的行當空行，
 * 連續空行併成一行
 */
export function cleanYoutubeText(s: string): string {
  return s
    .replace(/[⁦-⁩‎‏]/g, '')
    .split('\n')
    .map((l) => (/^[\s⠀]*$/.test(l) ? '' : l.replace(/[ \t ]+$/g, '')))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 解析貼文頁：找 DiscussionForumPosting 的 JSON-LD；沒有（同意頁、要登入確認不是機器人）當讀取失敗 */
export function parseYoutubePostHtml(html: string): YoutubeResult {
  const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let post: ForumPosting | null = null;
  for (let m = re.exec(html); m && !post; m = re.exec(html)) {
    try {
      const j = JSON.parse(m[1]) as ForumPosting;
      if (typeof j['@type'] === 'string' && /DiscussionForumPosting$/.test(j['@type'])) post = j;
    } catch {
      // 其他 JSON-LD 讀不懂就跳過
    }
  }
  if (!post) return { status: 'error', message: 'no DiscussionForumPosting' };
  const raw = typeof post.text === 'string' ? post.text : typeof post.headline === 'string' ? post.headline : '';
  const text = cleanYoutubeText(raw);
  if (!text) return { status: 'no_text' };
  const url = typeof post.author?.url === 'string' ? post.author.url : '';
  const handle = /youtube\.com\/@([^/?#\s]+)/i.exec(url)?.[1];
  let username: string | null = null;
  if (handle) {
    try {
      username = decodeURIComponent(handle);
    } catch {
      username = handle;
    }
  }
  const author = typeof post.author?.name === 'string' ? post.author.name.trim() || null : null;
  const t = typeof post.datePublished === 'string' ? Date.parse(post.datePublished) : NaN;
  return { status: 'ok', text, username, author, postedAt: Number.isFinite(t) ? Math.floor(t / 1000) : null };
}

export async function fetchYoutubePost(id: string): Promise<YoutubeResult> {
  let res: Response;
  try {
    res = await fetch(youtubePermalink(id), {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; CurrentRadar/1.0; +https://current-radar.pages.dev)', 'accept-language': 'zh-TW,zh;q=0.9' },
      redirect: 'follow',
    });
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
  if (res.status === 404) return { status: 'gone' };
  if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
  return parseYoutubePostHtml(await res.text());
}
