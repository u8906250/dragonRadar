import { describe, expect, it } from 'vitest';
import { cleanNoteText, manualText, NOTE_MAX, ocrText, parseNoteImage } from '../src/reports';

describe('沒有連結的回報：貼的文字', () => {
  it('keeps line breaks, drops control and direction characters, squeezes blank lines', () => {
    expect(cleanNoteText('  市集\r\n11/15 10:00\n\n\n\n大稻埕碼頭\t ')).toBe('市集\n11/15 10:00\n\n大稻埕碼頭');
    expect(cleanNoteText('a\u0000b‮c​d')).toBe('abcd');
    expect(cleanNoteText(42)).toBe('');
    expect([...cleanNoteText('字'.repeat(NOTE_MAX + 10))].length).toBe(NOTE_MAX);
  });
});

describe('沒有連結的回報：截圖', () => {
  it('takes JPEG, PNG and WebP data URIs only', () => {
    expect(parseNoteImage('data:image/jpeg;base64,/9j/4AAQ==')).toBe('data:image/jpeg;base64,/9j/4AAQ==');
    expect(parseNoteImage('data:image/png;base64,iVBORw0KGgo=')).not.toBeNull();
    expect(parseNoteImage('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(parseNoteImage('https://example.com/a.jpg')).toBeNull();
    expect(parseNoteImage('data:image/jpeg;base64,abc def')).toBeNull();
    expect(parseNoteImage(`data:image/jpeg;base64,${'A'.repeat(3_000_001)}`)).toBeNull();
    expect(parseNoteImage(undefined)).toBeNull();
  });
  it('treats 沒有文字 and code fences from the model as nothing / plain text', () => {
    expect(ocrText('沒有文字')).toBe('');
    expect(ocrText('沒有文字。')).toBe('');
    expect(ocrText('```\n洋流市集\n11/15\n```')).toBe('洋流市集\n11/15');
    expect(ocrText({ not: 'text' })).toBe('');
  });
});

describe('自己填的內文', () => {
  it('writes one block per activity with title, time and place', () => {
    // 2026-11-15 10:00、12:00 台北時間
    const start = Date.UTC(2026, 10, 15, 2, 0) / 1000;
    expect(
      manualText([
        { title: '洋流市集', topic: '市集', startAt: start, endAt: start + 7200, place: '大稻埕碼頭', lat: null, lng: null },
        { title: '街頭講座', startAt: start, endAt: null, place: '西門町', lat: 25.04, lng: 121.5 },
      ]),
    ).toBe('【市集】洋流市集\n時間：11/15 10:00–12:00\n地點：大稻埕碼頭\n\n街頭講座\n時間：11/15 10:00 開始\n地點：西門町');
  });
  it('writes the end date when it ends on another day', () => {
    const start = Date.UTC(2026, 10, 15, 2, 0) / 1000;
    expect(manualText([{ title: '兩天的市集', startAt: start, endAt: start + 86400, place: '花博', lat: null, lng: null }])).toContain('11/15 10:00–11/16 10:00');
  });
});
