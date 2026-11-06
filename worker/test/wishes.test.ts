import { describe, expect, it } from 'vitest';
import { cleanText, groupWishes, parseLinks, parseTweak, parseWish, TWEAK_COST, TWEAK_FREE, tweakCost, WISH_COST, WISH_MAX } from '../src/wishes';

describe('許願的規則', () => {
  it('costs 5 順幣, 3 free tweaks, then 1 each', () => {
    expect(WISH_COST).toBe(5);
    expect(TWEAK_FREE).toBe(3);
    expect(TWEAK_COST).toBe(1);
    expect([0, 1, 2, 3, 4, 9].map(tweakCost)).toEqual([0, 0, 0, 1, 1, 1]);
  });
});

describe('cleanText', () => {
  it('keeps line breaks, drops control and direction characters, squeezes blank lines', () => {
    expect(cleanText('  第一行\r\n第二行\n\n\n\n第三行\t結束  ', 100)).toBe('第一行\n第二行\n\n第三行 結束');
    expect(cleanText('a\u0000b‮c​d', 100)).toBe('abcd');
    expect(cleanText('一二三四五', 3)).toBe('一二三');
    expect(cleanText(42, 10)).toBe('');
  });
});

describe('parseLinks', () => {
  it('takes up to 3 http(s) links, one per line, without duplicates', () => {
    expect(parseLinks('https://a.tw/x\n\nhttps://a.tw/x  http://b.tw')).toEqual(['https://a.tw/x', 'http://b.tw/']);
    expect(parseLinks(['https://a.tw', 3])).toEqual(['https://a.tw/']);
    expect(parseLinks(undefined)).toEqual([]);
  });
  it('refuses other schemes, non-links and too many', () => {
    expect(parseLinks('javascript:alert(1)')).toBe('參考連結要用 https:// 開頭');
    expect(parseLinks('ftp://a.tw')).toBe('參考連結要用 https:// 開頭');
    expect(parseLinks('看這裡')).toMatch(/不是網址/);
    expect(parseLinks('https://a.tw/1 https://a.tw/2 https://a.tw/3 https://a.tw/4')).toBe('參考連結最多 3 個');
  });
});

describe('parseWish', () => {
  it('needs an idea of at least 5 characters and the rules checked', () => {
    expect(parseWish({ body: '想要許願池', agree: true })).toEqual({ body: '想要許願池', nickname: null, links: [] });
    expect(parseWish({ body: '好', agree: true })).toBe('想法至少寫 5 個字');
    expect(parseWish({ body: '想要一個許願池', agree: 'yes' })).toBe('請先看過並勾選許願規範');
    expect(parseWish({ body: 'x'.repeat(WISH_MAX + 1), agree: true })).toBe(`想法最多 ${WISH_MAX} 字`);
    expect(parseWish(null)).toBe('想法至少寫 5 個字');
  });
  it('cleans the nickname and limits it to 20 characters', () => {
    expect(parseWish({ body: '想要一個許願池', nickname: '  小\n明 ', agree: true })).toMatchObject({ nickname: '小 明' });
    expect(parseWish({ body: '想要一個許願池', nickname: '   ', agree: true })).toMatchObject({ nickname: null });
    expect(parseWish({ body: '想要一個許願池', nickname: '名'.repeat(21), agree: true })).toBe('暱稱最多 20 字');
  });
});

describe('parseTweak', () => {
  it('needs at least 5 characters', () => {
    expect(parseTweak({ body: '池塘改粉紅色' })).toEqual({ body: '池塘改粉紅色' });
    expect(parseTweak({ body: '改' })).toBe('想改哪裡至少寫 5 個字');
  });
});

describe('groupWishes', () => {
  const row = (id: number, kind: 'wish' | 'tweak', status: string, extra: Record<string, unknown> = {}) =>
    ({ id, kind, parent_id: kind === 'tweak' ? 1 : null, body: `#${id}`, nickname: null, links: null, status, cost: 0, free: 0, reply: null, seen: 1, created_at: id, updated_at: id, ...extra }) as never;
  it('hangs tweaks under their wish and counts free tweaks left (withdrawn and rejected ones do not count)', () => {
    const [w] = groupWishes([
      row(1, 'wish', 'live', { links: '["https://a.tw/"]', cost: 5 }),
      row(2, 'tweak', 'live', { free: 1 }),
      row(3, 'tweak', 'withdrawn', { free: 1 }),
      row(4, 'tweak', 'rejected', { free: 1 }),
      row(5, 'tweak', 'live', { free: 1 }),
    ]);
    expect(w).toMatchObject({ id: 1, links: ['https://a.tw/'], freeLeft: 1, tweakCost: 0, tweaking: false });
    expect(w.tweaks.map((t) => t.id)).toEqual([2, 3, 4, 5]);
  });
  it('charges after the free ones and knows when a tweak is still in progress', () => {
    const [w] = groupWishes([row(1, 'wish', 'live'), row(2, 'tweak', 'live', { free: 1 }), row(3, 'tweak', 'live', { free: 1 }), row(4, 'tweak', 'live', { free: 1 }), row(5, 'tweak', 'building', { cost: 1 })]);
    expect(w).toMatchObject({ freeLeft: 0, tweakCost: 1, tweaking: true });
  });
});
