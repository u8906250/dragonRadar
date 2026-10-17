import { describe, expect, it } from 'vitest';
import { detectEnded } from '../src/events';
import { buildMessages, normalizeExtraction } from '../src/extract';
import { parseThreadsTimestamp } from '../src/threads';
import { parseIsoToUnix } from '../src/util';
import { parseEmbedHtml, parseThreadsUrl, shortcodeToUnix } from '../src/sources/link';

describe('parseThreadsTimestamp', () => {
  it('accepts Threads +0000 offsets', () => {
    expect(parseThreadsTimestamp('2025-10-17T07:00:00+0000')).toBe(Date.UTC(2025, 9, 17, 7) / 1000);
  });
  it('throws on garbage', () => {
    expect(() => parseThreadsTimestamp('nope')).toThrow();
  });
});

describe('parseIsoToUnix', () => {
  it('parses full ISO with +08:00', () => {
    expect(parseIsoToUnix('2025-10-17T15:00:00+08:00')).toBe(Date.UTC(2025, 9, 17, 7) / 1000);
  });
  it('treats bare datetime as Taipei time', () => {
    expect(parseIsoToUnix('2025-10-17 15:00')).toBe(Date.UTC(2025, 9, 17, 7) / 1000);
  });
  it('returns null for empty or invalid', () => {
    expect(parseIsoToUnix(null)).toBeNull();
    expect(parseIsoToUnix('下午三點')).toBeNull();
  });
});

describe('detectEnded', () => {
  it('matches common end phrases', () => {
    expect(detectEnded('大家謝謝，已經發完囉')).toBe(true);
    expect(detectEnded('今天提前結束，下次見')).toBe(true);
  });
  it('ignores normal updates', () => {
    expect(detectEnded('還有很多，快來拿')).toBe(false);
  });
});

describe('normalizeExtraction', () => {
  it('parses fenced JSON with multiple events', () => {
    const r = normalizeExtraction('```json\n' + JSON.stringify({
      is_giveaway: true,
      events: [
        { title: '秀水服務處發飄帶', item: '洋流飄帶', start_at: '2026-10-13T09:00:00+08:00', end_at: '2026-10-13T17:00:00+08:00', place_text: '藍駿宇服務處', place_query: '彰化縣秀水鄉 藍駿宇服務處', confidence: 0.8 },
        { title: '花壇服務處發飄帶', item: '洋流飄帶', start_at: '2026-10-13T14:00:00+08:00', end_at: null, place_text: '李成濟服務處', place_query: '彰化縣花壇鄉 李成濟服務處', confidence: 0.75 },
      ],
    }) + '\n```');
    expect(r?.is_event).toBe(true);
    expect(r?.events).toHaveLength(2);
    expect(r?.events[1].end_at).toBeNull();
    expect(r?.events[0].place_query).toBe('彰化縣秀水鄉 藍駿宇服務處');
  });
  it('still accepts the old single-event shape', () => {
    const r = normalizeExtraction({ is_giveaway: true, title: '北車發貼紙', start_at: '2026-10-17T15:00:00+08:00', place_text: '台北車站東三門', confidence: 0.9 });
    expect(r?.events).toHaveLength(1);
    expect(r?.events[0].title).toBe('北車發貼紙');
  });
  it('clamps confidence, defaults title and treats "null" strings as null', () => {
    const r = normalizeExtraction({ is_giveaway: 'true', events: [{ confidence: 7, title: '', end_at: 'null' }] });
    expect(r?.events[0].confidence).toBe(1);
    expect(r?.events[0].title).toBe('活動');
    expect(r?.events[0].end_at).toBeNull();
  });
  it('reads kind and the new is_event flag', () => {
    const r = normalizeExtraction({ is_event: true, events: [{ kind: 'activity', title: '保安宮市政開講', start_at: '2026-10-11T19:00:00+08:00', place_text: '保安宮', confidence: 0.9 }, { title: 'x', confidence: 0.8 }] });
    expect(r?.is_event).toBe(true);
    expect(r?.events[0].kind).toBe('activity');
    expect(r?.events[1].kind).toBe('giveaway');
  });
  it('drops events when the post is not an event', () => {
    const r = normalizeExtraction({ is_giveaway: false, events: [{ title: 'x', confidence: 0.9 }] });
    expect(r?.is_event).toBe(false);
    expect(r?.events).toEqual([]);
  });
  it('rejects non-JSON', () => {
    expect(normalizeExtraction('not json at all')).toBeNull();
  });
});

describe('buildMessages', () => {
  it('anchors relative dates on the post time only', () => {
    const msgs = buildMessages('test', 1760684400, 1760688000);
    expect(msgs[1].content).toContain('貼文發布時間');
    expect(msgs[1].content).not.toContain('現在時間');
    expect(msgs[1].content).toContain('Asia/Taipei');
    expect(msgs[1].content).toContain('test');
  });
});

import { placeCandidates } from '../src/geocode';
import { normalizeKeyword, parseKeywordList } from '../src/keywords';

describe('normalizeKeyword', () => {
  it('trims, strips leading # and collapses spaces', () => {
    expect(normalizeKeyword('  #洋流飄帶 ')).toBe('洋流飄帶');
    expect(normalizeKeyword('免費   發放')).toBe('免費 發放');
  });
  it('normalizes full-width characters', () => {
    expect(normalizeKeyword('ＡＢＣ貼紙')).toBe('ABC貼紙');
  });
  it('rejects too short, too long, or unsafe input', () => {
    expect(normalizeKeyword('洋')).toBeNull();
    expect(normalizeKeyword('一二三四五六七八九十一二三四五六七八九十一')).toBeNull();
    expect(normalizeKeyword('100%發放')).toBeNull();
    expect(normalizeKeyword('<script>')).toBeNull();
    expect(normalizeKeyword(42)).toBeNull();
  });
});

describe('parseKeywordList', () => {
  it('splits, dedupes and drops invalid entries', () => {
    expect(parseKeywordList('洋流飄帶,洋流飄帶, 免費發放 ,x')).toEqual(['洋流飄帶', '免費發放']);
    expect(parseKeywordList(null)).toEqual([]);
  });
});

describe('placeCandidates', () => {
  it('falls back from exit-level detail to the station name', () => {
    const c = placeCandidates('台北市 捷運中山站 4號出口', '捷運中山站 4號出口');
    expect(c[0]).toBe('台北市 捷運中山站 4號出口');
    expect(c).toContain('台北市 捷運中山站');
    expect(c).toContain('台北市 中山站');
    expect(c.length).toBeLessThanOrEqual(5);
  });
  it('strips gate numbers', () => {
    const c = placeCandidates('台北市 台北車站 東三門', '台北車站東三門');
    expect(c.some((x) => !x.includes('東三門') && x.includes('台北車站'))).toBe(true);
    expect(c).not.toContain('台北市 車站');
  });
  it('keeps plain landmarks untouched', () => {
    expect(placeCandidates('台北市 松山文創園區', null)).toEqual(['台北市 松山文創園區']);
  });
});

import { verifySignedRequest } from '../src/oauth';

async function sign(payload: object, secret: string): Promise<string> {
  const enc = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const p = enc(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(p)));
  return `${enc(sig)}.${p}`;
}

describe('verifySignedRequest', () => {
  it('accepts a request signed with the app secret', async () => {
    const s = await sign({ algorithm: 'HMAC-SHA256', user_id: '123' }, 'secret-1');
    expect((await verifySignedRequest(s, 'secret-1'))?.user_id).toBe('123');
  });
  it('rejects a wrong secret or tampered payload', async () => {
    const s = await sign({ user_id: '123' }, 'secret-1');
    expect(await verifySignedRequest(s, 'secret-2')).toBeNull();
    expect(await verifySignedRequest(s.replace(/\.(.)/, '.A'), 'secret-1')).toBeNull();
    expect(await verifySignedRequest('garbage', 'secret-1')).toBeNull();
  });
});

import { placeFidelity, responseContent } from '../src/extract';

describe('responseContent', () => {
  it('reads both Workers AI and OpenAI-style shapes', () => {
    expect(responseContent({ response: 'a' })).toBe('a');
    expect(responseContent({ choices: [{ message: { content: 'b' } }] })).toBe('b');
  });
});

describe('placeFidelity', () => {
  const text = '洋流測試：今晚 9 點在捷運市政府站 2號出口發放洋流飄帶';
  const ev = (place: string) => ({ is_event: true, events: [{ kind: 'giveaway' as const, title: 't', item: null, start_at: null, end_at: null, place_text: place, place_query: null, confidence: 0.9 }] });
  it('is high when the place comes from the post', () => {
    expect(placeFidelity(ev('捷運市政府站 2號出口'), text)).toBe(1);
  });
  it('is low for garbled output', () => {
    expect(placeFidelity(ev('越車政園给行 2号 出口'), text)).toBeLessThan(0.7);
  });
});

describe('normalizeExtraction with reasoning output', () => {
  it('strips <think> blocks', () => {
    const r = normalizeExtraction('<think>先找時間…</think>\n{"is_giveaway":true,"events":[{"title":"x","place_text":"台北車站","confidence":0.8}]}');
    expect(r?.events[0].place_text).toBe('台北車站');
  });
});

import { extractArticleText, parseRss } from '../src/sources/text';
import { parseTicketTime, taipeiMidnight } from '../src/sources/voyage';

describe('parseRss', () => {
  it('reads CDATA titles, links and dates', () => {
    const xml = `<rss><channel><item><title><![CDATA[劉建國10/18虎尾成立總部 發洋流飄帶]]></title><link>https://news.ltn.com.tw/news/politics/breakingnews/1</link><pubDate>Sat, 17 Oct 2026 15:21:02 +0800</pubDate><description><![CDATA[<p>現場預計發送限量「洋流」飄帶</p>]]></description></item><item><title>沒有連結</title></item></channel></rss>`;
    const items = parseRss(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain('洋流飄帶');
    expect(items[0].description).toBe('現場預計發送限量「洋流」飄帶');
    expect(items[0].pubDate).toBe(Date.parse('2026-10-17T15:21:02+08:00') / 1000);
  });
});

describe('extractArticleText', () => {
  it('keeps article paragraphs and drops scripts and boilerplate', () => {
    const html = `<meta property="og:description" content="劉建國明（18）日將舉辦虎尾競選總部成立大會，現場發送洋流飄帶。"><script>var x = "<p>不要我</p>";</script>
      <p>為達最佳瀏覽效果，建議使用 Chrome 的瀏覽器。</p><p>劉建國表示，虎尾競選總部成立大會將在明天下午3點半開始舉辦。</p><p>短</p>`;
    const t = extractArticleText(html);
    expect(t).toContain('下午3點半');
    expect(t).toContain('洋流飄帶');
    expect(t).not.toContain('不要我');
    expect(t).not.toContain('瀏覽器');
  });
});

describe('voyage time helpers', () => {
  it('parses the official ticket time with the stop year', () => {
    expect(parseTicketTime('10/18（日）17:30', '2026')).toBe(Date.parse('2026-10-18T17:30:00+08:00') / 1000);
    expect(parseTicketTime(undefined, '2026')).toBeNull();
  });
  it('computes Taipei midnight', () => {
    expect(taipeiMidnight('2026-10-25')).toBe(Date.parse('2026-10-24T16:00:00Z') / 1000);
  });
});

describe('threads link helpers', () => {
  it('finds the post code in pasted text', () => {
    expect(parseThreadsUrl('快看 https://www.threads.net/@ab.c_1/post/DNG2tXiBjzN?xmt=abc 謝謝')).toEqual({ code: 'DNG2tXiBjzN', username: 'ab.c_1' });
    expect(parseThreadsUrl('https://threads.com/t/DNG2tXiBjzN')).toEqual({ code: 'DNG2tXiBjzN', username: null });
    expect(parseThreadsUrl('https://www.instagram.com/p/DNG2tXiBjzN/')).toBeNull();
  });
  it('decodes the creation time from the code', () => {
    // 嵌入頁顯示 1:16 PM · Aug 8, 2025（美西時間）
    expect(shortcodeToUnix('DNG2tXiBjzN')).toBe(Math.floor(Date.parse('2025-08-08T20:16:19.357Z') / 1000));
    expect(shortcodeToUnix('AAAAAAAAAAA')).toBeNull();
  });
  it('reads the main post from an embed page, skipping the parent post', () => {
    const block = (full: boolean, user: string, body: string) =>
      `<div class="OuterContainer${full ? ' OuterContainerFull' : ''}"><div class="HeaderContainer"><a class="HeaderLink"><span>${user}</span></a></div>` +
      `<span class="TextContentContainer"><span class="BodyTextContainer"><span>${body}</span></span></span><div class="PostDateContainer"><span class="Timestamp">1:16 PM</span></div></div>`;
    const html = block(false, 'parent', '上一層') + block(true, 'giver', '今天 15:00<br>市政府站 <a href="#">#洋流</a> 發飄帶&amp;貼紙');
    expect(parseEmbedHtml(html)).toEqual({ status: 'ok', username: 'giver', text: '今天 15:00\n市政府站 #洋流 發飄帶&貼紙' });
    expect(parseEmbedHtml('<div class="OuterErrorContainer">Thread not available</div>')).toEqual({ status: 'gone' });
    expect(parseEmbedHtml('<html>login</html>').status).toBe('error');
  });
});
