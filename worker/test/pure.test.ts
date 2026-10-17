import { describe, expect, it } from 'vitest';
import { detectEnded } from '../src/events';
import { buildMessages, normalizeExtraction } from '../src/extract';
import { parseThreadsTimestamp } from '../src/threads';
import { parseIsoToUnix } from '../src/util';

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
    expect(r?.is_giveaway).toBe(true);
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
    expect(r?.events[0].title).toBe('發放活動');
    expect(r?.events[0].end_at).toBeNull();
  });
  it('drops events when the post is not a giveaway', () => {
    const r = normalizeExtraction({ is_giveaway: false, events: [{ title: 'x', confidence: 0.9 }] });
    expect(r?.is_giveaway).toBe(false);
    expect(r?.events).toEqual([]);
  });
  it('rejects non-JSON', () => {
    expect(normalizeExtraction('not json at all')).toBeNull();
  });
});

describe('buildMessages', () => {
  it('includes both post time and now in Taipei', () => {
    const msgs = buildMessages('test', 1760684400, 1760688000);
    expect(msgs[1].content).toContain('貼文發布時間');
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
