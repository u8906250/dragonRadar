/** 給 RSS 與新聞頁用的簡易 HTML / XML 文字處理（Workers 沒有 DOMParser） */

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

export const stripTags = (s: string): string => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export interface RssItem {
  title: string;
  link: string;
  pubDate: number | null;
  description: string;
}

function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? m[1] : '';
}

export function parseRss(xml: string): RssItem[] {
  const out: RssItem[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const b = m[1];
    const title = stripTags(decodeEntities(tag(b, 'title')));
    const link = stripTags(decodeEntities(tag(b, 'link')));
    const ms = Date.parse(stripTags(tag(b, 'pubDate')));
    if (!title || !/^https?:\/\//.test(link)) continue;
    out.push({ title, link, pubDate: Number.isNaN(ms) ? null : Math.floor(ms / 1000), description: stripTags(decodeEntities(tag(b, 'description'))) });
  }
  return out;
}

const BOILERPLATE = /瀏覽器|APP看新聞|版權所有|不得轉載|加入Google|訂閱|點我|按讚|請繼續往下閱讀|攝）$|翻攝）$|提供）$/;

/** 從新聞頁抓出摘要與內文段落，最多 maxLen 字 */
export function extractArticleText(html: string, maxLen = 1500): string {
  const clean = html.replace(/<(script|style|noscript|template|nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ');
  const og = /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)/i.exec(clean)?.[1] ?? '';
  const parts: string[] = [];
  const push = (t: string): void => {
    const s = t.replace(/\s+/g, ' ').trim();
    if (s.length < 20 || s.length > 600 || BOILERPLATE.test(s)) return;
    if (parts.some((p) => p.includes(s) || s.includes(p))) return;
    parts.push(s);
  };
  push(decodeEntities(og));
  for (const m of clean.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    push(stripTags(m[1]));
    if (parts.join('\n').length > maxLen) break;
  }
  return parts.join('\n').slice(0, maxLen);
}

export async function sha1Hex(s: string, len = 16): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
}
