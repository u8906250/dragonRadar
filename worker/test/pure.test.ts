import type { ExtractedEvent } from '../src/extract';
import { applySupplementDate, closedWeekdays, dropBroughtItem, dropSelfPlace, openWeekdaysFromText, splitDropTimes, splitMultiDay, slotWeekdays, spotHoursFromText, splitWeekdayWeekend, startNowForDeadline, untilInText, weekdaysFromText, weekdaysInText } from '../src/extract';
import { isAreaOnly } from '../src/geocode';
import { existedOutcome, notListedWhy, previewOf } from '../src/reports';
import { describe, expect, it } from 'vitest';
import { approxRank, detectEnded, lngRange, postExcerpt, spotMergeMode, spotScope, spotSessions } from '../src/events';
import { buildMessages, localizeTimes, localToUnix, normalizeCountry, normalizeExtraction, validTimeZone } from '../src/extract';
import { parseThreadsTimestamp } from '../src/threads';
import { parseIsoToUnix } from '../src/util';
import { parseEmbedHtml, parseThreadsUrl, shortcodeToUnix, withLocationTag } from '../src/sources/link';
import { parseProfileHtml, profileCandidates } from '../src/sources/profile';

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

import { adminArea, citiesOfDistrict, cityLevel, cityMatches, sharesName, pickHit, placeCandidates, streetFallbacks, worldCandidates } from '../src/geocode';
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
    expect(c.length).toBeLessThanOrEqual(8);
  });
  it('strips gate numbers', () => {
    const c = placeCandidates('台北市 台北車站 東三門', '台北車站東三門');
    expect(c.some((x) => !x.includes('東三門') && x.includes('台北車站'))).toBe(true);
    expect(c).not.toContain('台北市 車站');
  });
  it('uses the station hint in parentheses and drops a guessed district', () => {
    const c = placeCandidates('台北市中正區忠孝復興站附近', '日常生活 a day cafe(近忠孝復興站）');
    expect(c).toContain('台北市 忠孝復興站');
    expect(c).toContain('忠孝復興站');
    expect(c.some((x) => x.includes('中正區忠孝復興站') && !x.includes(' '))).toBe(true);
  });
  it('never queries a bare city or district', () => {
    const c = placeCandidates('台北市', '民權公園');
    expect(c[0]).toBe('台北市 民權公園');
    expect(c).not.toContain('台北市');
    expect(placeCandidates('台北市 大安區', null)).toEqual([]);
  });
  it('uses the station, not the whole "near ... station" hint, and tries it as an MRT station first', () => {
    const c = placeCandidates('台北市 松菸文創大街', '近國父紀念館站/大巨蛋');
    expect(c[0]).toBe('台北市 松菸文創大街');
    expect(c[1]).toBe('台北市 捷運國父紀念館站');
    expect(c).not.toContain('近國父紀念館站/大巨蛋');
    expect(c).not.toContain('台北市 近國父紀念館站/大巨蛋');
    expect(placeCandidates('台北市 台北車站', null)).not.toContain('台北市 捷運台北車站');
  });
  it('keeps plain landmarks untouched', () => {
    expect(placeCandidates('台北市 松山文創園區', null)).toEqual(['台北市 松山文創園區']);
  });
  it('turns the colloquial 市府站 into 市政府站', () => {
    const c = placeCandidates('台北市 捷運市府站', '捷運市府站2號出口附近');
    expect(c).toContain('台北市 捷運市政府站');
    expect(c.indexOf('台北市 捷運市政府站')).toBeLessThan(c.indexOf('捷運市府站'));
    expect(c).not.toContain('市府站');
  });
});

describe('cityMatches / pickHit', () => {
  const taichung = { display_name: '捷運市府站(出口1), 文心路二段, 西屯區, 臺中市, 臺灣' };
  const taipei = { display_name: '捷運市政府站, 忠孝東路五段, 信義區, 臺北市, 臺灣' };
  it('rejects a hit outside the city the query names', () => {
    expect(cityMatches('台北市 捷運市府站', taichung.display_name)).toBe(false);
    expect(cityMatches('台北市 捷運市府站', taipei.display_name)).toBe(true);
    expect(pickHit('台北市 捷運市府站', [taichung])).toBeUndefined();
    expect(pickHit('台北市 捷運市府站', [taichung, taipei])).toBe(taipei);
  });
  it('does not treat 新北投 as 新北市', () => {
    expect(cityMatches('新北投站', '新北投, 北投區, 臺北市, 臺灣')).toBe(true);
  });
  it('prefers Taipei / New Taipei when the query names no city', () => {
    expect(pickHit('捷運市府站', [taichung, taipei])).toBe(taipei);
    expect(pickHit('捷運市府站', [taichung])).toBe(taichung);
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

import type { Env } from '../src/env';
import { extractFromPost, placeFidelity, responseContent } from '../src/extract';

describe('responseContent', () => {
  it('reads both Workers AI and OpenAI-style shapes', () => {
    expect(responseContent({ response: 'a' })).toBe('a');
    expect(responseContent({ choices: [{ message: { content: 'b' } }] })).toBe('b');
  });
});

describe('placeFidelity', () => {
  const text = '洋流測試：今晚 9 點在捷運市政府站 2號出口發放洋流飄帶';
  const ev = (place: string) => ({ is_event: true, events: [{ kind: 'giveaway' as const, title: 't', item: null, start_at: null, end_at: null, place_text: place, place_query: null, confidence: 0.9, spot: false, until: null }] });
  it('is high when the place comes from the post', () => {
    expect(placeFidelity(ev('捷運市政府站 2號出口'), text)).toBe(1);
  });
  it('is low for garbled output', () => {
    expect(placeFidelity(ev('越車政園给行 2号 出口'), text)).toBeLessThan(0.7);
  });
});

describe('approxRank', () => {
  it('ranks an exact point over a road over a district', () => {
    expect(approxRank(null)).toBe(2);
    expect(approxRank('宜蘭縣羅東鎮公正路')).toBe(1);
    expect(approxRank('臺南市中西區北門路一段')).toBe(1);
    expect(approxRank('新北市淡水區北新路184巷')).toBe(1);
    expect(approxRank('南投縣南投市')).toBe(0);
    expect(approxRank('桃園市桃園區')).toBe(0);
  });
});

describe('extractFromPost second opinion', () => {
  const NOT_EVENT = '{"is_event":false,"events":[]}';
  const EVENT = '{"is_event":true,"events":[{"title":"珈琲無花果發小物","place_text":"安西街19號","confidence":0.9}]}';
  const text = '珈琲無花果 📍台北市大同區安西街19號 各式貼紙請酌量自取';
  // 模擬 Workers AI：每個模型回固定的內容，丟出錯誤就當作模型壞掉
  const env = (answers: Record<string, string | Error>) => {
    const calls: string[] = [];
    const ai = {
      run: async (model: string) => {
        calls.push(model);
        const a = answers[model];
        if (a instanceof Error) throw a;
        return { response: a };
      },
    };
    return { calls, env: { AI: ai, AI_MODEL: 'primary', AI_MODEL_FALLBACK: 'fallback' } as unknown as Env };
  };

  it('asks the fallback when the primary says not an event', async () => {
    const m = env({ primary: NOT_EVENT, fallback: EVENT });
    const r = await extractFromPost(m.env, text, 0, 0, { secondOpinion: true });
    expect(r.model).toBe('fallback');
    expect(r.extraction?.is_event).toBe(true);
  });
  it('keeps the primary answer when the fallback breaks', async () => {
    const m = env({ primary: NOT_EVENT, fallback: new Error('down') });
    const r = await extractFromPost(m.env, text, 0, 0, { secondOpinion: true });
    expect(r.model).toBe('primary');
    expect(r.extraction?.is_event).toBe(false);
  });
  it('does not ask again without secondOpinion or when the primary found events', async () => {
    const a = env({ primary: NOT_EVENT, fallback: EVENT });
    expect((await extractFromPost(a.env, text, 0, 0)).extraction?.is_event).toBe(false);
    expect(a.calls).toEqual(['primary']);
    const b = env({ primary: EVENT, fallback: NOT_EVENT });
    expect((await extractFromPost(b.env, text, 0, 0, { secondOpinion: true })).extraction?.is_event).toBe(true);
    expect(b.calls).toEqual(['primary']);
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
    expect(parseEmbedHtml(html)).toEqual({ status: 'ok', username: 'giver', text: '今天 15:00\n市政府站 #洋流 發飄帶&貼紙', location: null });
    expect(parseEmbedHtml('<div class="OuterErrorContainer">Thread not available</div>')).toEqual({ status: 'gone' });
    expect(parseEmbedHtml('<html>login</html>').status).toBe('error');
  });
  it('reads the location tag and adds it for the model only when the text does not name it', () => {
    const html =
      '<div class="OuterContainer OuterContainerFull"><div class="HeaderContainer"><a class="HeaderLink"><span>chef</span></a></div>' +
      '<span class="BodyTextContainer"><span>10/21 洋流小物</span></span><div class="LocationTag"><span class="LocationText">豬跳舞小餐館</span></div></div>';
    expect(parseEmbedHtml(html)).toEqual({ status: 'ok', username: 'chef', text: '10/21 洋流小物', location: '豬跳舞小餐館' });
    expect(withLocationTag('10/21 洋流小物', '豬跳舞小餐館')).toBe('10/21 洋流小物\n\n📍 貼文的地點標記：豬跳舞小餐館');
    expect(withLocationTag('來豬跳舞小餐館領', '豬跳舞小餐館')).toBe('來豬跳舞小餐館領');
    expect(withLocationTag('來店裡領', null)).toBe('來店裡領');
  });
});

describe('spotSessions', () => {
  const t = (iso: string) => Date.parse(iso) / 1000;
  const posted = t('2026-10-17T12:35:00+08:00');
  it('expands a daily window up to the last day, skipping finished days', () => {
    const now = t('2026-10-17T20:35:00+08:00');
    const s = spotSessions({ start_at: '2026-10-17T11:00:00+08:00', end_at: '2026-10-17T18:00:00+08:00', until: '2026-10-19' }, posted, now);
    expect(s).toEqual([
      { start: t('2026-10-18T11:00:00+08:00'), end: t('2026-10-18T18:00:00+08:00'), allDay: false, endOpen: false, untilOpen: false },
      { start: t('2026-10-19T11:00:00+08:00'), end: t('2026-10-19T18:00:00+08:00'), allDay: false, endOpen: false, untilOpen: false },
    ]);
  });
  it('splits a merged multi-day range into daily windows', () => {
    const s = spotSessions({ start_at: '2026-10-17T11:00:00+08:00', end_at: '2026-10-19T18:00:00+08:00', until: null }, posted, posted);
    expect(s.map((x) => x.end - x.start)).toEqual([7 * 3600, 7 * 3600, 7 * 3600]);
  });
  it('treats a last day equal to the first day as "from that day" (「10/16 起」), marking the last day as unknown', () => {
    const s = spotSessions({ start_at: '2026-10-17T13:00:00+08:00', end_at: '2026-10-17T20:00:00+08:00', until: '2026-10-17' }, posted, posted);
    expect(s).toHaveLength(14);
    expect(s[0]).toMatchObject({ endOpen: false, untilOpen: true });
  });
  it('marks an unknown daily closing time', () => {
    const s = spotSessions({ start_at: '2026-10-17T13:00:00+08:00', end_at: null, until: '2026-10-19' }, posted, posted);
    expect(s[0]).toMatchObject({ allDay: false, endOpen: true, untilOpen: false });
    // 沒寫幾點結束就開到當天結束，不猜「兩小時後」
    expect(s[0].end).toBe(t('2026-10-18T00:00:00+08:00'));
  });
  it('schedules two weeks ahead (no default last day) when none is given, and marks unknown hours as all-day', () => {
    const s = spotSessions({ start_at: '2026-10-17T00:00:00+08:00', end_at: null, until: null }, posted, posted);
    expect(s).toHaveLength(14);
    expect(s.every((x) => x.untilOpen)).toBe(true);
    expect(s[0]).toEqual({ start: t('2026-10-17T00:00:00+08:00'), end: t('2026-10-18T00:00:00+08:00'), allDay: true, endOpen: false, untilOpen: true });
  });
  it('never schedules an open-ended spot past 30 days after the post (privacy policy)', () => {
    const later = t('2026-11-10T09:00:00+08:00');
    const s = spotSessions({ start_at: '2026-10-17T13:00:00+08:00', end_at: '2026-10-17T15:00:00+08:00', until: null }, posted, later);
    expect(s.at(-1)?.start).toBe(t('2026-11-15T13:00:00+08:00'));
  });
});

describe('adminArea', () => {
  it('finds county plus township for approximate locations', () => {
    expect(adminArea('雲林縣虎尾鎮', '虎尾競選總部')).toBe('雲林縣虎尾鎮');
    expect(adminArea('台東縣 台東市服務處', null)).toBe('台東縣台東市');
  });
  it('does not accept a city alone', () => {
    expect(adminArea('台北市', '民權公園')).toBeNull();
    expect(adminArea('台北市 民權公園', null)).toBeNull();
  });
});

describe('previewOf', () => {
  const base = { kind: 'giveaway' as const, title: '佳里服務處發飄帶', item: '洋流飄帶', place_text: '佳里服務處', place_query: '臺南市佳里區文化路140號', lat: 23.16, lng: 120.17, confidence: 0.9, all_day: false, spot: true, approx_area: null, end_open: true, until_open: true };
  it('merges the daily sessions of a spot into one item and drops past ones', () => {
    const day = 86400;
    const items = [0, 1, 2].map((d) => ({ group: 0, reason: 'planned', plan: { ...base, start_at: 1000 + d * day, end_at: 2000 + d * day } }));
    items.push({ group: 1, reason: 'no_place', plan: null as never });
    const out = previewOf(items, 2500);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ days: 2, startAt: 1000 + day, lastStartAt: 1000 + 2 * day, spot: true, untilOpen: true });
  });
  it('merges time slots at the same place into one item', () => {
    const one = { ...base, spot: false, until_open: false, end_open: false };
    const items = [
      { group: 0, reason: 'planned', plan: { ...one, start_at: 3000, end_at: 4000 } },
      { group: 1, reason: 'planned', plan: { ...one, start_at: 9000, end_at: 9900 } },
    ];
    const out = previewOf(items, 2500);
    expect(out).toHaveLength(1);
    expect(out[0].slots).toEqual([
      { startAt: 3000, endAt: 4000, endOpen: false },
      { startAt: 9000, endAt: 9900, endOpen: false },
    ]);
  });
  it('keeps "no end time" per slot so the page can say 發完為止', () => {
    const one = { ...base, spot: false, until_open: false, end_open: true };
    const out = previewOf(
      [
        { group: 0, reason: 'planned', plan: { ...one, start_at: 3000, end_at: 8000 } },
        { group: 1, reason: 'planned', plan: { ...one, start_at: 5000, end_at: 8000 } },
      ],
      2500,
    );
    expect(out[0].slots?.map((x) => x.endOpen)).toEqual([true, true]);
    expect(out[0].endOpen).toBe(true);
  });
  it('tells the reporter when the spot is already on the radar', () => {
    const merge = { mode: 'replace' as const, postId: 'spot-x', placeText: '蘭鄉排骨飯', eventId: 75, title: '蘭鄉排骨飯發飄帶' };
    const out = previewOf([{ group: 0, reason: 'planned', plan: { ...base, start_at: 3000, end_at: 4000 }, merge }], 2500);
    expect(out[0].update).toEqual({ mode: 'replace', title: '蘭鄉排骨飯發飄帶' });
  });
});

describe('spotMergeMode', () => {
  it('replaces only when the same account posts again', () => {
    expect(spotMergeMode('psalmnprovers', 'PsalmNProvers')).toBe('replace');
    expect(spotMergeMode('someone', 'psalmnprovers')).toBe('attach');
    expect(spotMergeMode(null, null)).toBe('attach');
  });
});

describe('existedOutcome', () => {
  it('says it is on the radar when events are there, even without a recorded result', () => {
    expect(existedOutcome([], 14)).toBe('added');
    expect(existedOutcome(['unlocated', 'unlocated'], 3)).toBe('added');
    expect(existedOutcome(['duplicate_of_3'], 1)).toBe('duplicate');
    expect(existedOutcome(['attached_to_75', 'attached_to_75'], 1)).toBe('attached');
  });
  it('does not claim it is on the radar when nothing is there', () => {
    expect(existedOutcome(['upcoming'], 0)).toBe('not_listed');
    expect(existedOutcome(['not_event'], 0)).toBe('not_event');
    expect(existedOutcome([], 0)).toBe('not_listed');
  });
});

describe('isAreaOnly', () => {
  it('treats district names alone as too vague', () => {
    expect(isAreaOnly('台北市 中正萬華區')).toBe(true);
    expect(isAreaOnly('中正萬華區')).toBe(true);
    expect(isAreaOnly('台北市大安區')).toBe(true);
  });
  it('keeps real place names', () => {
    expect(isAreaOnly('南港軟體園區')).toBe(false);
    expect(isAreaOnly('信義計畫區')).toBe(false);
    expect(isAreaOnly('台北市 厝邊咖啡')).toBe(false);
  });
});

describe('weekdays', () => {
  it('reads 每週 patterns but not date notes', () => {
    expect(weekdaysFromText('💧領取時間｜每週二、四 14:00–18:00')).toEqual([2, 4]);
    expect(weekdaysFromText('每週一至五 10:00-17:00')).toEqual([1, 2, 3, 4, 5]);
    expect(weekdaysFromText('每週六日下午')).toEqual([6, 7]);
    expect(weekdaysFromText('每星期三、星期五')).toEqual([3, 5]);
    expect(weekdaysFromText('10/21（週二）上午 9 點開始')).toBeNull();
    expect(weekdaysFromText('每週一到週日')).toBeNull();
  });
  it('only makes sessions on those days', () => {
    // 2026-10-20 是週二
    const posted = Date.parse('2026-10-20T08:00:00+08:00') / 1000;
    const s = spotSessions({ start_at: '2026-10-20T14:00:00+08:00', end_at: '2026-10-20T18:00:00+08:00', until: null, weekdays: [2, 4] }, posted, posted);
    const days = s.map((x) => new Date((x.start + 8 * 3600) * 1000).toISOString().slice(0, 10));
    // 沒寫最後一天：每週幾才開的排兩週
    expect(days).toEqual(['2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29']);
  });
});

describe('untilInText', () => {
  it('keeps an end date the post actually wrote', () => {
    expect(untilInText('2026-10-29', '10/17~10/29 每日 11:00')).toBe('2026-10-29');
    expect(untilInText('2026-10-25', '發到10月25日為止')).toBe('2026-10-25');
    expect(untilInText('2026-11-05', '到 11/5')).toBe('2026-11-05');
    expect(untilInText('2026-10-19', '10/17~19 每日 11:00')).toBe('2026-10-19');
    expect(untilInText('2026-10-19', '10月17日至19日')).toBe('2026-10-19');
  });
  it('drops an end date the model made up', () => {
    expect(untilInText('2026-12-31', '每週二、四 14:00–18:00，送完為止')).toBeNull();
    expect(untilInText('2026-10-29', '10/2 開始，10/290 號')).toBeNull();
  });
});

describe('weekdaysInText', () => {
  it('drops weekdays the post never mentions', () => {
    expect(weekdaysInText([2, 4, 6], '發放時間｜13:30－14:00\n【回報的人補充】只有10/26')).toBeNull();
    expect(weekdaysInText([2, 4], '10/21（週二）開始')).toBeNull();
  });
  it('keeps weekdays that are written', () => {
    expect(weekdaysInText([2, 4], '每週二、四 14:00–18:00')).toEqual([2, 4]);
    expect(weekdaysInText([1, 2, 3, 4, 5], '週一到週五 11:00')).toEqual([1, 2, 3, 4, 5]);
    expect(weekdaysInText([6, 7], '週末下午兩點')).toEqual([6, 7]);
  });
});

describe('applySupplementDate', () => {
  const posted = Date.parse('2026-10-19T23:59:00+08:00') / 1000;
  const post = '📍 發放地點｜ 吳棋楠議員服務處（南投市民族路5號）\n🕜 發放時間｜ 13:30－14:00';
  it('moves the event to the one date the reporter supplied when the post has none', () => {
    const ex = { start_at: '2026-10-20T13:30:00+08:00', end_at: '2026-10-20T14:00:00+08:00' };
    applySupplementDate(ex, '只有10/26 比較像活動', post, posted);
    expect(ex).toEqual({ start_at: '2026-10-26T13:30:00+08:00', end_at: '2026-10-26T14:00:00+08:00' });
  });
  it('keeps the post date when the post names a day, or the supplement is ambiguous', () => {
    const ex = { start_at: '2026-10-21T12:00:00+08:00', end_at: null };
    applySupplementDate(ex, '只有10/26', '10/21 洋流小物 12:00', posted);
    expect(ex.start_at).toBe('2026-10-21T12:00:00+08:00');
    applySupplementDate(ex, '10/26 或 10/27', post, posted);
    expect(ex.start_at).toBe('2026-10-21T12:00:00+08:00');
  });
});

describe('splitMultiDay', () => {
  const text = '𖦹 日期：10/24（六）～ 10/26（一）\n𖦹 時間：12:00 ～ 18:30';
  it('turns a multi-day span with daily hours into a spot', () => {
    const ex = { start_at: '2026-10-24T12:00:00+08:00', end_at: '2026-10-26T18:30:00+08:00', spot: false, until: null as string | null };
    expect(splitMultiDay(ex, text)).toBe(true);
    expect(ex).toEqual({ start_at: '2026-10-24T12:00:00+08:00', end_at: '2026-10-24T18:30:00+08:00', spot: true, until: '2026-10-26' });
  });
  it('leaves overnight events and spans without a written last day alone', () => {
    const night = { start_at: '2026-10-24T22:00:00+08:00', end_at: '2026-10-25T02:00:00+08:00', spot: false, until: null };
    expect(splitMultiDay(night, '10/24 22:00 到天亮')).toBe(false);
    const guessed = { start_at: '2026-10-24T12:00:00+08:00', end_at: '2026-10-26T18:30:00+08:00', spot: false, until: null };
    expect(splitMultiDay(guessed, '週末 12:00 ～ 18:30')).toBe(false);
  });
});

describe('dropBroughtItem', () => {
  it('treats "bring your own ribbon and I will braid it" as an activity, not a giveaway', () => {
    const ex = { kind: 'activity' as const, item: '洋流飄帶' as string | null };
    expect(dropBroughtItem(ex, '歡迎大家帶著自己的飄帶來找我～～很樂意幫小水滴們編飄帶唷！！')).toBe(true);
    expect(ex).toEqual({ kind: 'activity', item: null });
  });
  it('keeps real giveaways', () => {
    const ex = { kind: 'giveaway' as const, item: '洋流飄帶' as string | null };
    expect(dropBroughtItem(ex, '現場發放洋流飄帶，也可以自備飄帶來編')).toBe(false);
    expect(dropBroughtItem(ex, '明天 15:00 市政府站發飄帶')).toBe(false);
    expect(ex.item).toBe('洋流飄帶');
  });
});

describe('dropSelfPlace', () => {
  const ev = (place_text: string | null, place_query: string | null) => ({ kind: 'giveaway', title: 't', item: null, start_at: null, end_at: null, place_text, place_query, confidence: 0.9, spot: true, until: null }) as ExtractedEvent;
  it('treats 本店 with only a city as no place', () => {
    const e = ev('本店', '台北市');
    expect(dropSelfPlace(e)).toBe(true);
    expect(e.place_text).toBeNull();
    expect(e.place_query).toBeNull();
    expect(dropSelfPlace(ev('店裡', null))).toBe(true);
    expect(dropSelfPlace(ev(null, '台北市 本店'))).toBe(true);
  });
  it('keeps 本店 when the query names the shop or address', () => {
    expect(dropSelfPlace(ev('本店', '台北市萬華區環河南路二段5巷6弄20號'))).toBe(false);
    expect(dropSelfPlace(ev('本店', '青雲 Misty'))).toBe(false);
  });
  it('keeps real places', () => {
    expect(dropSelfPlace(ev('青雲 Misty 本店', '台北市'))).toBe(false);
    expect(dropSelfPlace(ev('捷運市府站2號出口附近', '台北市 捷運市府站'))).toBe(false);
  });
});

describe('splitDropTimes', () => {
  const ev = (start_at: string, end_at: string | null, kind: 'giveaway' | 'activity' = 'giveaway') => ({ kind, title: 't', item: '小物', start_at, end_at, place_text: '青雲 Misty', place_query: null, confidence: 0.9, spot: true, until: null }) as ExtractedEvent;
  const drops = '📍 每日投放時間\n\n* 🕐 13:00｜10 個\n* 🕒 15:00｜10 個\n\n每天都有！';
  const starts = (xs: ExtractedEvent[]) => xs.map((x) => [x.start_at?.slice(11, 16), x.end_at]);
  it('splits "13:00 / 15:00 各發 10 個" merged into one window', () => {
    expect(starts(splitDropTimes([ev('2026-10-21T13:00:00+08:00', '2026-10-21T15:00:00+08:00')], drops))).toEqual([
      ['13:00', null],
      ['15:00', null],
    ]);
  });
  it('adds the drops the model left out, without duplicates', () => {
    expect(starts(splitDropTimes([ev('2026-10-21T13:00:00+08:00', null)], drops))).toEqual([
      ['13:00', null],
      ['15:00', null],
    ]);
    const both = [ev('2026-10-21T13:00:00+08:00', null), ev('2026-10-21T15:00:00+08:00', null)];
    expect(starts(splitDropTimes(both, drops))).toEqual([
      ['13:00', null],
      ['15:00', null],
    ]);
    expect(splitDropTimes([ev('2026-10-21T13:00:00+08:00', null)], drops)[1].start_at).toBe('2026-10-21T15:00:00+08:00');
  });
  it('splits two separate times the model merged, even without counts', () => {
    expect(starts(splitDropTimes([ev('2026-10-21T13:00:00+08:00', '2026-10-21T15:00:00+08:00')], '下午 13:00、15:00 兩次發放'))).toEqual([
      ['13:00', null],
      ['15:00', null],
    ]);
  });
  it('keeps real ranges and stated end times', () => {
    const e = ev('2026-10-21T13:00:00+08:00', '2026-10-21T15:00:00+08:00');
    for (const text of ['發放時間 13:00-15:00，限量 100 個', '13:00 開始發放，到 15:00', '13:00 開始，15:00 結束', '１３：００～１５：００', '下午一點開始']) {
      expect(splitDropTimes([e], text)).toEqual([e]);
    }
    expect(splitDropTimes([e], '13:00-15:00 發 50 個、18:00-20:00 發 50 個')).toEqual([e]);
  });
  it('leaves activities alone', () => {
    const a = ev('2026-10-21T13:00:00+08:00', '2026-10-21T15:00:00+08:00', 'activity');
    expect(splitDropTimes([a], drops)).toEqual([a]);
  });
});

describe('startNowForDeadline', () => {
  const now = Date.parse('2026-10-21T11:34:20+08:00') / 1000;
  const ev = (start_at: string | null, end_at: string | null, spot = false) => ({ kind: 'giveaway', title: 't', item: null, start_at, end_at, place_text: '仁信裝潢', place_query: null, confidence: 0.95, spot, until: null }) as ExtractedEvent;
  const text = '店門有開就可以直接進來詢問\n今天14:45前我都在喔！\n仁信裝潢-新北市新店區順安街35號';
  it('starts now when the post only says "14:45前"', () => {
    const e = ev('2026-10-21T14:00:00+08:00', '2026-10-21T14:45:00+08:00');
    expect(startNowForDeadline(e, text, now)).toBe(true);
    expect(e.start_at).toBe('2026-10-21T11:34:00+08:00');
    expect(e.end_at).toBe('2026-10-21T14:45:00+08:00');
    const g = ev('2026-10-21T14:45:00+08:00', null);
    expect(startNowForDeadline(g, text, now)).toBe(true);
    expect([g.start_at, g.end_at]).toEqual(['2026-10-21T11:34:00+08:00', '2026-10-21T14:45:00+08:00']);
    const f = ev(null, '2026-10-21T14:45:00+08:00');
    expect(startNowForDeadline(f, '今天１４：４５以前都在', now)).toBe(true);
    expect(f.start_at).toBe('2026-10-21T11:34:00+08:00');
  });
  it('keeps a start time the post wrote', () => {
    const e = ev('2026-10-21T13:00:00+08:00', '2026-10-21T14:45:00+08:00');
    expect(startNowForDeadline(e, '13:00 開始，14:45前發完', now)).toBe(false);
    expect(e.start_at).toBe('2026-10-21T13:00:00+08:00');
  });
  it('leaves other days, spots, and posts without "前" alone', () => {
    expect(startNowForDeadline(ev('2026-10-22T14:00:00+08:00', '2026-10-22T14:45:00+08:00'), '明天14:45前我都在', now)).toBe(false);
    expect(startNowForDeadline(ev('2026-10-21T14:00:00+08:00', '2026-10-21T14:45:00+08:00', true), text, now)).toBe(false);
    expect(startNowForDeadline(ev('2026-10-21T14:00:00+08:00', '2026-10-21T14:45:00+08:00'), '14:00-14:45 發放', now)).toBe(false);
  });
  it('keeps a start time that the post also writes without "前"', () => {
    const e = ev('2026-10-21T19:00:00+08:00', null);
    const post = '📣 今天 10/21（三）19:00，免費發送 88 個虎爺鑰匙圈！\n所以這次如果 19:00 前，現場排隊人數已達 88 位，就可能提前發放。';
    expect(startNowForDeadline(e, post, now)).toBe(false);
    expect([e.start_at, e.end_at]).toEqual(['2026-10-21T19:00:00+08:00', null]);
  });
});

describe('postExcerpt', () => {
  const misty = '🌊 洋流小物投放計畫正式啟動！\n不消費也能免費領，這次我們真的要讓洋流遍地開花！\n\n首先，請大家一起感謝一位不具名的美女課金阿嬤🥹💙\n\n豪氣贊助 8,000 元，讓我們印製了 100 個精緻洋流吊牌！\n\n從明天 10/21 開始，每天固定投放 20 個洋流小物，一路發到選舉前！\n\n📍 每日投放時間\n\n* 🕐 13:00｜10 個\n* 🕒 15:00｜10 個\n\n每天都有！每天都有！每天都有！\n（很重要所以說三次🤣）';
  it('keeps only the time and place lines, about 90 characters, and marks the cut', () => {
    const e = postExcerpt(misty, 'link');
    expect(e).toContain('🕐 13:00｜10 個');
    expect(e).toContain('🕒 15:00｜10 個');
    expect(e).not.toContain('阿嬤');
    expect(e.endsWith('\n…')).toBe(true);
    expect([...e].length).toBeLessThanOrEqual(115);
  });
  it('leaves a short post whole and keeps only the news headline', () => {
    expect(postExcerpt('今天 15:00 捷運市政府站發飄帶', 'link')).toBe('今天 15:00 捷運市政府站發飄帶');
    expect(postExcerpt('洋流外溢？標題\n\n摘要很長的一段', 'news')).toBe('洋流外溢？標題');
  });
  it('cuts one very long line instead of dropping everything', () => {
    const e = postExcerpt('x'.repeat(300), 'link');
    expect(e.startsWith('x'.repeat(90) + '…')).toBe(true);
  });
});

describe('streetFallbacks', () => {
  it('tries the lane first, then the road', () => {
    expect(streetFallbacks('北新路184巷')).toEqual(['北新路184巷', '北新路']);
    expect(streetFallbacks('信義路四段395巷6弄')).toEqual(['信義路四段395巷', '信義路四段']);
    expect(streetFallbacks('民富十七街')).toEqual(['民富十七街']);
  });
});

describe('overseas events', () => {
  it('reads the wall clock in the local time zone, including daylight saving', () => {
    // 11/07 加州已經換回標準時間（UTC-8）
    expect(localToUnix('2026-11-07T11:30:00+08:00', 'America/Los_Angeles')).toBe(Date.parse('2026-11-07T19:30:00Z') / 1000);
    // 10/22 還是夏令時間（UTC-7）
    expect(localToUnix('2026-10-22T09:00', 'America/Los_Angeles')).toBe(Date.parse('2026-10-22T16:00:00Z') / 1000);
    expect(localToUnix('2026-11-07T11:30', 'Asia/Tokyo')).toBe(Date.parse('2026-11-07T02:30:00Z') / 1000);
  });
  it('localizes extracted times and falls back to single-zone countries', () => {
    const ev = { kind: 'activity', title: '灣區洋流野餐日', item: null, start_at: '2026-11-07T11:30:00+08:00', end_at: '2026-11-07T14:00:00+08:00', place_text: 'Cupertino Memorial Park', place_query: 'Memorial Park, Cupertino', confidence: 0.9, spot: false, until: null, country: 'US', timezone: 'America/Los_Angeles' } as ExtractedEvent;
    expect(localizeTimes(ev)).toBe('America/Los_Angeles');
    expect([ev.start_at, ev.end_at]).toEqual(['2026-11-07T19:30:00Z', '2026-11-07T22:00:00Z']);
    const jp = { ...ev, start_at: '2026-11-07T11:30:00+08:00', end_at: null, country: 'JP', timezone: null } as ExtractedEvent;
    expect(localizeTimes(jp)).toBe('Asia/Tokyo');
    expect(jp.start_at).toBe('2026-11-07T02:30:00Z');
    const us = { ...ev, start_at: '2026-11-07T11:30:00+08:00', timezone: null } as ExtractedEvent;
    expect(localizeTimes(us)).toBeNull();
    expect(us.start_at).toBe('2026-11-07T11:30:00+08:00');
  });
  it('normalizes country codes and time zones', () => {
    expect(normalizeCountry('us')).toBe('US');
    expect(normalizeCountry('TW')).toBeNull();
    expect(normalizeCountry('Taiwan')).toBeNull();
    expect(validTimeZone('America/Los_Angeles')).toBe('America/Los_Angeles');
    expect(validTimeZone('Asia/Taipei')).toBeNull();
    expect(validTimeZone('Mars/Olympus')).toBeNull();
  });
  it('tries shorter place queries for Nominatim', () => {
    expect(worldCandidates('Memorial Park, Cupertino, CA, USA', 'Cupertino Memorial Park')).toEqual([
      'Memorial Park, Cupertino, CA, USA',
      'Memorial Park, Cupertino, CA',
      'Memorial Park, Cupertino',
      'Cupertino Memorial Park',
    ]);
  });
});

describe('lngRange', () => {
  it('wraps around the antimeridian and drops the limit for the whole world', () => {
    expect(lngRange(121.5, 10)).toEqual({ sql: 'e.lng BETWEEN ? AND ?', binds: [111.5, 131.5] });
    expect(lngRange(121.5, 199)).toBeNull();
    expect(lngRange(170, 20)).toEqual({ sql: '(e.lng >= ? OR e.lng <= ?)', binds: [150, -170] });
    expect(lngRange(-170, 20)).toEqual({ sql: '(e.lng >= ? OR e.lng <= ?)', binds: [170, -150] });
  });
});

describe('citiesOfDistrict', () => {
  it('finds the one city of a unique district and all cities of a shared name', () => {
    expect(citiesOfDistrict('淡水區', [{ category: 'boundary', display_name: '淡水區, 滬尾, 新北市, 臺灣' }])).toEqual(['新北市']);
    expect(
      citiesOfDistrict('東區', [
        { category: 'boundary', display_name: '東區, 虎尾寮, 臺南市, 701, 臺灣' },
        { category: 'boundary', display_name: '東區, 新竹市, 臺灣' },
        { category: 'highway', display_name: '東區路, 臺中市, 臺灣' },
      ]),
    ).toEqual(['臺南市', '新竹市']);
  });
});

describe('notListedWhy', () => {
  const day = 86400;
  it('names the reason when every item failed the same way', () => {
    expect(notListedWhy([{ group: 0, plan: null, reason: 'already_over', start: 1000, end: 8200, tz: null }, { group: 1, plan: null, reason: 'already_over', start: 5000, end: 9000, tz: null }])).toEqual({ reason: 'already_over', startAt: 5000, endAt: 9000, tz: null });
    const far = notListedWhy([{ group: 0, plan: null, reason: 'too_far_in_future', start: 30 * day, end: 30 * day + 7200, tz: 'America/Los_Angeles' }]);
    expect(far).toEqual({ reason: 'too_far_in_future', startAt: 30 * day, endAt: 30 * day + 7200, tz: 'America/Los_Angeles', reportFrom: 9 * day });
    expect(notListedWhy([{ group: 0, plan: null, reason: 'no_start_time' }])).toEqual({ reason: 'no_start_time' });
    expect(notListedWhy([{ group: 0, plan: null, reason: 'already_over' }])).toEqual({ reason: 'already_over' });
  });
  it('stays vague when the reasons are mixed or not about time', () => {
    expect(notListedWhy([{ group: 0, plan: null, reason: 'already_over', start: 1, end: 2 }, { group: 1, plan: null, reason: 'too_far_in_future', start: 3, end: 4 }])).toBeUndefined();
    expect(notListedWhy([{ group: 0, plan: null, reason: 'low_confidence' }])).toBeUndefined();
  });
});

describe('cityLevel', () => {
  it('recognizes places that only name a city or county', () => {
    expect(cityLevel('台中市區')).toBe('臺中市');
    expect(cityLevel('📍台北市 一帶')).toBe('臺北市');
    expect(cityLevel('新竹')).toBe('新竹市');
    expect(cityLevel('宜蘭')).toBe('宜蘭縣');
    expect(cityLevel('台中市西區自立街22號')).toBeNull();
    expect(cityLevel('台中車站')).toBeNull();
  });
  it('makes city-only text count as an area, not a place', () => {
    expect(isAreaOnly('台中市區')).toBe(true);
  });
});

describe('sharesName', () => {
  it('rejects a hit whose name has nothing to do with the query', () => {
    expect(sharesName('丞風羽球館', '玉勅鳳邑琉球城隍廟, 觀光港路, 琉球鄉, 屏東縣, 臺灣')).toBe(false);
  });
  it('accepts real matches', () => {
    expect(sharesName('台北市 捷運市政府站', '市政府, 信義路五段, 信義區, 臺北市, 臺灣')).toBe(true);
    expect(sharesName('南港國小', '臺北市南港區南港國民小學, 南港區, 臺北市')).toBe(true);
    expect(sharesName('台北市 信義運動中心', '臺北市信義運動中心, 松勤街, 信義區')).toBe(true);
    expect(sharesName('台北市 大龍峒保安宮', '大龍峒保安宮, 哈密街, 大同區, 臺北市')).toBe(true);
  });
  it('does not check queries that are only a city or district', () => {
    expect(sharesName('臺中市', '臺中市, 臺灣')).toBe(true);
    expect(sharesName('新北市 淡水區', '淡水區, 新北市')).toBe(true);
  });
});

describe('fixed spot opening days and closing time', () => {
  it('reads closed days, workdays and listed days', () => {
    expect(closedWeekdays('12:00-20:00\n（週一公休）')).toEqual([1]);
    expect(closedWeekdays('營業時間：11:30～14:30（週二、週三店休）')).toEqual([2, 3]);
    expect(closedWeekdays('公休：週日')).toEqual([7]);
    expect(closedWeekdays('這週六休息一天')).toBeNull();
    expect(openWeekdaysFromText('雙貓戲絲堂 12:00-20:00（週一公休）')).toEqual([2, 3, 4, 5, 6, 7]);
    expect(openWeekdaysFromText('（週二、週三店休）')).toEqual([1, 4, 5, 6, 7]);
    expect(openWeekdaysFromText('服務時間：09:00~18:00（上班日）')).toEqual([1, 2, 3, 4, 5]);
    expect(openWeekdaysFromText('每週一到六 10:00-18:00，週三公休')).toEqual([1, 2, 4, 5, 6]);
    expect(openWeekdaysFromText('平日0930-2030 假日1000-1800')).toBeUndefined();
    expect(openWeekdaysFromText('每日 11:00 起')).toBeUndefined();
  });
  it('corrects spot hours from the post', () => {
    const ex = (start: string, end: string | null = null) => ({ spot: true, start_at: start, end_at: end });
    const a = ex('2026-10-21T12:00:00+08:00');
    expect(spotHoursFromText(a, '發完為止\n🕛營業時間：週三至周日的 12:00–21:00')).toBe(true);
    expect(a.end_at).toBe('2026-10-21T21:00:00+08:00');
    const b = ex('2026-10-22T11:00:00+08:00');
    expect(spotHoursFromText(b, '☀️ 每日上午 11:00 起\n\n【回報的人補充】時間：下午7點30結束', { endPhrase: true })).toBe(true);
    expect(b.end_at).toBe('2026-10-22T19:30:00+08:00');
    const c = ex('2026-10-21T14:00:00+08:00');
    expect(spotHoursFromText(c, '10/21（三）14:00 開始\n【回報的人補充】時間：下午六點結束', { endPhrase: true })).toBe(true);
    expect(c.end_at).toBe('2026-10-21T18:00:00+08:00');
    // 模型把兩段合成 11:30–20:30
    const d = ex('2026-10-21T11:30:00+08:00', '2026-10-21T20:30:00+08:00');
    expect(spotHoursFromText(d, '營業時間：11:30～14:30，17:00～20:30')).toBe(true);
    expect(d.end_at).toBe('2026-10-21T14:30:00+08:00');
    // 模型編了 13:00（貼文是「11:00 起」和「下午 1:15」限定場）
    const e = ex('2026-10-22T13:00:00+08:00', '2026-10-22T19:30:00+08:00');
    expect(spotHoursFromText(e, '☀️ 每日上午 11:00 起\n🌊 10/22（四） 下午 1:15 限定\n【回報的人補充】時間：下午7點30結束', { endPhrase: true, single: true })).toBe(true);
    expect([e.start_at, e.end_at]).toEqual(['2026-10-22T11:00:00+08:00', '2026-10-22T19:30:00+08:00']);
    expect(spotHoursFromText(ex('2026-10-24T12:00:00+08:00'), '日期：10/24（六）～ 10/26（一）')).toBe(false);
    expect(spotHoursFromText(ex('2026-10-22T00:00:00+08:00'), '10:00-19:00')).toBe(false);
    const f = ex('2026-10-22T20:00:00+08:00', '2026-10-22T21:00:00+08:00');
    expect(spotHoursFromText(f, '🈺11-21\n晚上20-21點發放')).toBe(false);
  });
  it('splits weekday and weekend hours', () => {
    const out = splitWeekdayWeekend({ spot: true, start_at: '2026-10-22T09:30:00+08:00', end_at: '2026-10-22T20:30:00+08:00', weekdays: null }, '板橋莒光路99號\n\n平日0930-2030\n假日1000-1800');
    expect(out.map((e) => [e.weekdays, e.start_at.slice(11, 16), e.end_at?.slice(11, 16)])).toEqual([[[1, 2, 3, 4, 5], '09:30', '20:30'], [[6, 7], '10:00', '18:00']]);
    expect(splitWeekdayWeekend({ spot: true, start_at: '2026-10-22T09:30:00+08:00', end_at: null, weekdays: null }, '每日 09:30-20:30')).toHaveLength(1);
  });
  it('reads a bare weekday range', () => {
    expect(weekdaysFromText('🕛營業時間：週三至周日的 12:00–21:00')).toEqual([3, 4, 5, 6, 7]);
    expect(weekdaysFromText('10/21（週三）~10/25（週日）')).toBeNull();
  });
  it('scopes text to one of several spots', () => {
    const text = '✅小港服務處：沿海一路261號\n服務時間：09:00~18:00（上班日）\n✅前鎮服務處：崗山中街228號\n服務時間：09:00~18:00（上班日）';
    const all = [{ spot: true, place_text: '小港服務處：沿海一路261號', place_query: 'a' }, { spot: true, place_text: '前鎮服務處：崗山中街228號', place_query: 'b' }];
    expect(spotScope(text, all[0], all)).toBe('小港服務處：沿海一路261號\n服務時間：09:00~18:00（上班日）\n✅');
    expect(openWeekdaysFromText(spotScope(text, all[1], all) ?? '')).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('threads profile hints', () => {
  it('parses name and bio from the profile page', () => {
    const html = '<meta property="og:title" content="爐鍋咖啡 Luguo Cafe (&#064;luguocafe) &#x2022; Threads, Say more" /><meta property="og:description" content="5.3K Followers &#x2022; 861 Threads &#x2022; &#x1f49a;LuguoCafe in Taiwan. #爐鍋咖啡好喝. See the latest conversations with @luguocafe." />';
    expect(parseProfileHtml(html, 'luguocafe')).toEqual({ username: 'luguocafe', name: '爐鍋咖啡 Luguo Cafe', bio: '💚LuguoCafe in Taiwan. #爐鍋咖啡好喝.' });
    const empty = '<meta property="og:title" content="kylekuo1979 (&#064;kylekuo1979) &#x2022; Threads, Say more" /><meta property="og:description" content="180 Followers &#x2022; 61 Threads. See the latest conversations with @kylekuo1979." />';
    expect(parseProfileHtml(empty, 'kylekuo1979')).toEqual({ username: 'kylekuo1979', name: null, bio: null });
    const zh = '<meta property="og:description" content="180 位粉絲 &#x2022; 61 則串文。查看 @kylekuo1979 參與的最新對話。" />';
    expect(parseProfileHtml(zh, 'kylekuo1979')).toEqual({ username: 'kylekuo1979', name: null, bio: null });
    const zh2 = '<meta property="og:description" content="5,300 位粉絲 &#x2022; 861 則串文 &#x2022; LuguoCafe in Taiwan. #爐鍋咖啡好喝 #luguocafe.com 。查看 @luguocafe 參與的最新對話。" />';
    expect(parseProfileHtml(zh2, 'luguocafe')?.bio).toBe('LuguoCafe in Taiwan. #爐鍋咖啡好喝 #luguocafe.com');
  });
  it('picks the shop accounts to look up', () => {
    expect(profileCandidates('準備了50個 由挺台店家@luguocafe "爐鍋咖啡@ 小藝埕" 代為發放', 'kylekuo1979')).toEqual(['luguocafe']);
    expect(profileCandidates('本店今天發飄帶，希望 @pumashen 當選', 'someshop')).toEqual(['someshop']);
    expect(profileCandidates('支持 @pumashen 加油', 'someone')).toEqual([]);
    expect(profileCandidates('若 10.23 臺北市放颱風假，美好也將配合店休\n設計師 @sasaki790108\n請在櫃檯出示您的船員證', 'lovelyrooom')).toEqual(['lovelyrooom']);
  });
});

describe('slotWeekdays', () => {
  const sup = '門診時間：週一到週六 08:30–12:00、14:30–18:00，平日晚上 18:30–21:00，週六晚上、週日休診';
  it('reads the weekdays written right before a slot', () => {
    expect(slotWeekdays(sup, '2026-10-22T08:30:00+08:00')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(slotWeekdays(sup, '2026-10-22T14:30:00+08:00')).toBeUndefined();
    expect(slotWeekdays(sup, '2026-10-22T18:30:00+08:00')).toEqual([1, 2, 3, 4, 5]);
    expect(slotWeekdays('平日0930-2030\n假日1000-1800', '2026-10-22T10:00:00+08:00')).toEqual([6, 7]);
    expect(slotWeekdays('營業時間：11:30～14:30，17:00～20:30', '2026-10-22T11:30:00+08:00')).toBeUndefined();
  });
});
