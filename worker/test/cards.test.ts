import { describe, expect, it } from 'vitest';
import { parseClaim } from '../src/cards';

describe('parseClaim', () => {
  it('takes a known card and one of its places', () => {
    expect(parseClaim({ card: 'xiaofa', place: '碑林' })).toEqual({ card: 'xiaofa', place: '碑林' });
    // 不認得的地點寫「中山公園」
    expect(parseClaim({ card: 'xiaofa', place: '我家' })).toEqual({ card: 'xiaofa', place: '中山公園' });
    expect(parseClaim({ card: 'xiaofa' })).toEqual({ card: 'xiaofa', place: '中山公園' });
  });
  it('refuses unknown cards', () => {
    expect(parseClaim({ card: 'toString' })).toBe('沒有這張卡');
    expect(parseClaim({ card: 'lucky' })).toBe('沒有這張卡');
    expect(parseClaim(null)).toBe('沒有這張卡');
  });
});
