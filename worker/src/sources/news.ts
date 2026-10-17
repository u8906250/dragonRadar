import type { Env } from '../env';
import { getPost, processPost, storePost } from '../events';
import { listActiveKeywords } from '../keywords';
import { nowSec } from '../util';
import { extractArticleText, parseRss, sha1Hex } from './text';

export const NEWS_FEEDS = [
  { name: '自由時報', url: 'https://news.ltn.com.tw/rss/politics.xml' },
  { name: '自由時報', url: 'https://news.ltn.com.tw/rss/local.xml' },
  { name: 'Yahoo新聞', url: 'https://tw.news.yahoo.com/rss/politics' },
];

const MAX_AGE_SEC = 3 * 86400;
const MAX_ARTICLES_PER_RUN = 8;
/** 判讀完只保留標題加這麼多字的摘要，不保存新聞全文 */
const KEEP_EXCERPT = 120;

export interface NewsResult {
  matched: number;
  processed: number;
  created: number;
  errors: string[];
}

// 有些新聞網站會擋非瀏覽器的 User-Agent
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'accept-language': 'zh-TW,zh;q=0.9,en;q=0.6',
};

export async function ingestNews(env: Env, now = nowSec()): Promise<NewsResult> {
  const out: NewsResult = { matched: 0, processed: 0, created: 0, errors: [] };
  const keywords = (await listActiveKeywords(env, now)).map((k) => k.term);
  if (keywords.length === 0) return out;

  const seenTitles = new Set<string>();
  const candidates: Array<{ feed: string; title: string; link: string; pubDate: number; keyword: string; description: string }> = [];
  for (const feed of NEWS_FEEDS) {
    try {
      const res = await fetch(feed.url, { headers: { ...HEADERS, accept: 'application/rss+xml, application/xml, text/xml' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for (const it of parseRss(await res.text())) {
        const kw = keywords.find((k) => it.title.includes(k) || it.description.includes(k));
        const pub = it.pubDate ?? now;
        if (!kw || pub < now - MAX_AGE_SEC) continue;
        const titleKey = it.title.replace(/\s+/g, '');
        if (seenTitles.has(titleKey)) continue;
        seenTitles.add(titleKey);
        candidates.push({ feed: feed.name, title: it.title, link: it.link, pubDate: pub, keyword: kw, description: it.description });
      }
    } catch (e) {
      out.errors.push(`${feed.url}: ${String(e)}`);
    }
  }
  out.matched = candidates.length;

  for (const c of candidates) {
    if (out.processed >= MAX_ARTICLES_PER_RUN) break;
    const id = `news-${await sha1Hex(c.link)}`;
    if (await getPost(env, id)) continue;
    // 同一篇新聞常被不同網站轉載，標題一樣就跳過
    const dupTitle = await env.DB.prepare("SELECT id FROM posts WHERE source = 'news' AND substr(text, 1, ?) = ? LIMIT 1")
      .bind(c.title.length, c.title)
      .first<{ id: string }>();
    if (dupTitle) continue;
    try {
      const res = await fetch(c.link, { headers: { ...HEADERS, accept: 'text/html' } });
      let body = res.ok ? extractArticleText(await res.text()) : '';
      // 文章頁被擋或抓不到內文時，退回 RSS 摘要
      if (body.length < 40) {
        if (!res.ok) out.errors.push(`${c.link}: article HTTP ${res.status}, used RSS description`);
        body = c.description.replace(/…+$/, '');
      }
      const text = `${c.title}\n\n${body}`.trim();
      await storePost(env, { id, username: c.feed, text, permalink: c.link, posted_at: c.pubDate, keyword: c.keyword, source: 'news' }, now);
      const post = await getPost(env, id);
      if (!post) continue;
      const r = await processPost(env, post, now);
      out.processed++;
      out.created += r.events.filter((e) => e.status !== 'unlocated').length;
      const excerpt = body.slice(0, KEEP_EXCERPT);
      await env.DB.prepare('UPDATE posts SET text = ? WHERE id = ?').bind(`${c.title}${excerpt ? `\n\n${excerpt}…` : ''}`, id).run();
    } catch (e) {
      out.errors.push(`${c.link}: ${String(e)}`);
    }
  }
  return out;
}
