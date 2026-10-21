import { applySupplementDate, dropBroughtItem, splitMultiDay, untilInText, weekdaysFromText, weekdaysInText } from '../src/extract';
import { isAreaOnly } from '../src/geocode';
import { existedOutcome, previewOf } from '../src/reports';
import { describe, expect, it } from 'vitest';
import { detectEnded, spotMergeMode, spotSessions } from '../src/events';
import { buildMessages, normalizeExtraction } from '../src/extract';
import { parseThreadsTimestamp } from '../src/threads';
import { parseIsoToUnix } from '../src/util';
import { parseEmbedHtml, parseThreadsUrl, shortcodeToUnix, withLocationTag } from '../src/sources/link';

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

import { adminArea, cityMatches, pickHit, placeCandidates } from '../src/geocode';
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

import { placeFidelity, responseContent } from '../src/extract';

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
    expect(s).toHaveLength(7);
    expect(s[0]).toMatchObject({ endOpen: false, untilOpen: true });
  });
  it('marks an unknown daily closing time', () => {
    const s = spotSessions({ start_at: '2026-10-17T13:00:00+08:00', end_at: null, until: '2026-10-19' }, posted, posted);
    expect(s[0]).toMatchObject({ allDay: false, endOpen: true, untilOpen: false });
    // 沒寫幾點結束就開到當天結束，不猜「兩小時後」
    expect(s[0].end).toBe(t('2026-10-18T00:00:00+08:00'));
  });
  it('keeps 7 days when no last day is given, and marks unknown hours as all-day', () => {
    const s = spotSessions({ start_at: '2026-10-17T00:00:00+08:00', end_at: null, until: null }, posted, posted);
    expect(s).toHaveLength(7);
    expect(s[0]).toEqual({ start: t('2026-10-17T00:00:00+08:00'), end: t('2026-10-18T00:00:00+08:00'), allDay: true, endOpen: false, untilOpen: true });
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
    expect(out[0].slots).toEqual([{ startAt: 3000, endAt: 4000 }, { startAt: 9000, endAt: 9900 }]);
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
