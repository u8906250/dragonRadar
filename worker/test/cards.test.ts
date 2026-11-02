import { describe, expect, it } from 'vitest';
import { cleanCode, makeCode, parseClaim } from '../src/cards';

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

describe('transfer codes', () => {
  it('makes 8 easy-to-read characters, split in two', () => {
    const code = makeCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(makeCode(() => new Uint8Array([0, 1, 2, 3, 31, 32, 255, 8]))).toBe('ABCD-9A9J');
    expect(new Set(Array.from({ length: 50 }, () => makeCode())).size).toBe(50);
  });
  it('cleans what people type', () => {
    expect(cleanCode('kx7p-4m2q')).toBe('KX7P4M2Q');
    expect(cleanCode(' KX7P 4M2Q ')).toBe('KX7P4M2Q');
    expect(cleanCode('KX7P4M2Q')).toBe('KX7P4M2Q');
    // 0、O、1、I 不會出現在引繼碼裡；太短、太長、不是字串的不要
    expect(cleanCode('KX7P-4M2O')).toBeNull();
    expect(cleanCode('KX7P-4M21')).toBeNull();
    expect(cleanCode('KX7P-4M2')).toBeNull();
    expect(cleanCode('KX7P-4M2QQ')).toBeNull();
    expect(cleanCode(12345678)).toBeNull();
  });
});
