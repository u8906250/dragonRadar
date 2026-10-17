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
  it('parses fenced JSON strings', () => {
    const r = normalizeExtraction('```json\n{"is_giveaway":true,"title":"北車發貼紙","item":"貼紙","start_at":"2025-10-17T15:00:00+08:00","end_at":null,"place_text":"台北車站東三門","place_query":"台北市 台北車站 東三門","confidence":0.9}\n```');
    expect(r?.is_giveaway).toBe(true);
    expect(r?.place_query).toBe('台北市 台北車站 東三門');
    expect(r?.confidence).toBe(0.9);
  });
  it('clamps confidence and defaults title', () => {
    const r = normalizeExtraction({ is_giveaway: 'true', confidence: 7, title: '' });
    expect(r?.is_giveaway).toBe(true);
    expect(r?.confidence).toBe(1);
    expect(r?.title).toBe('發放活動');
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
