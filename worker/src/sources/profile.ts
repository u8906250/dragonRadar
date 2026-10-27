/**
 * Threads 帳號的公開名稱和簡介：貼文找不到地點時，從發文的店家帳號、或貼文標記的店家帳號（「由 @luguocafe 代為發放」）
 * 找店名、地址，當成提示再判讀一次。只拿來判讀，不存下來、不顯示。
 */
import { decodeEntities } from './text';

export interface ThreadsProfile {
  username: string;
  /** 顯示名稱；跟帳號一樣時是 null */
  name: string | null;
  bio: string | null;
}

const meta = (html: string, prop: string): string | null => {
  const m = new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`).exec(html) ?? new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="${prop}"`).exec(html);
  return m ? decodeEntities(m[1]) : null;
};

/** 解析帳號頁的 og:title（「名稱 (@帳號) • Threads, Say more」）和 og:description（「追蹤數 • 貼文數 • 簡介 See the latest…」） */
export function parseProfileHtml(html: string, username: string): ThreadsProfile | null {
  const title = meta(html, 'og:title');
  const desc = meta(html, 'og:description');
  if (!title && !desc) return null;
  const rawName = title ? /^(.*?)\s*\(@[A-Za-z0-9_.]+\)/.exec(title)?.[1]?.trim() : null;
  const name = rawName && rawName.toLowerCase() !== username.toLowerCase() ? rawName : null;
  const bio =
    desc
      ?.replace(/^\s*[\d.,]+\s*[KMkm萬]?\s*(?:Followers?|位粉絲|粉絲)\s*•\s*(?:[\d.,]+\s*[KMkm萬]?\s*(?:Threads?|則串文|串文)\s*[•.。]?\s*)?/, '')
      .replace(/\s*See the latest conversations with @[A-Za-z0-9_.]+\.?\s*$/, '')
      .replace(/\s*[。.]?\s*查看 @[A-Za-z0-9_.]+ .*?最新對話。?\s*$/, '')
      .trim() || null;
  // 沒有簡介、名稱又跟帳號一樣：沒有線索
  if (!name && (!bio || /^[\d.,]+\s*[KMkm萬]?\s*(?:Followers?|粉絲)/.test(bio))) return { username, name: null, bio: null };
  return { username, name, bio: bio && bio.length > 300 ? `${bio.slice(0, 300)}…` : bio };
}

export async function fetchThreadsProfile(username: string, timeoutMs = 8000): Promise<ThreadsProfile | null> {
  if (!/^[A-Za-z0-9_.]{1,30}$/.test(username)) return null;
  try {
    const res = await fetch(`https://www.threads.com/@${username}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; CurrentRadar/1.0; +https://current-radar.pages.dev)', 'accept-language': 'zh-TW,zh;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return parseProfileHtml(await res.text(), username);
  } catch {
    return null;
  }
}

/** 貼文是店家自己發的（「本店」「歡迎來店」「我們有就可以領」「直接跟我們說要哪一款」）：發文帳號就是店家 */
const OWN_SHOP_RE = /本店|店內|店裡|小店|本攤|我們店|來店|到店|門市|本館|店休|公休|櫃檯|櫃台|店員|營業時間|跟我們(?:說|拿|領)|找我們|我們有就/;
/** 標記的帳號前後有這些字，才當成店家（「由挺台店家 @luguocafe 代為發放」「在 @xxx 領取」） */
const SHOP_BEFORE_RE = /店|館|坊|咖啡|餐|攤|市集|代為|代發|在|到|地點|地址/;
const SHOP_AFTER_RE = /代為|代發|領取|索取|店|館|坊|咖啡|餐|攤/;

/**
 * 要查哪些帳號：店家自己發的查發文帳號；標記的帳號旁邊寫了店家、發放、領取的也查。最多 max 個
 */
export function profileCandidates(text: string, author: string | null, max = 2): string[] {
  const out: string[] = [];
  if (author && OWN_SHOP_RE.test(text)) out.push(author);
  for (const m of text.matchAll(/@([A-Za-z0-9_.]{2,30})/g)) {
    const u = m[1].replace(/\.+$/, '');
    const at = m.index ?? 0;
    const before = text.slice(Math.max(0, at - 6), at);
    const after = text.slice(at + m[0].length, at + m[0].length + 10);
    if ((SHOP_BEFORE_RE.test(before) || SHOP_AFTER_RE.test(after)) && !out.includes(u)) out.push(u);
  }
  return out.slice(0, max);
}

/** 給判讀用的提示文字 */
export function profileHintText(profiles: ThreadsProfile[]): string | null {
  const lines = profiles.filter((p) => p.name || p.bio).map((p) => `@${p.username}：${p.name ? `名稱「${p.name}」` : ''}${p.name && p.bio ? '；' : ''}${p.bio ? `簡介「${p.bio.replace(/\s+/g, ' ')}」` : ''}`);
  return lines.length > 0 ? lines.join('\n') : null;
}
