import { describe, expect, it } from 'vitest';
import { driftStep, ruleCheck, scatter, xLength } from '../src/bottles';

describe('ruleCheck', () => {
  it('lets short cheering messages through', () => {
    expect(ruleCheck('台北加油！大家一起努力 🌊')).toBeNull();
    expect(ruleCheck('謝謝今天發飄帶的志工')).toBeNull();
  });
  it('blocks links, phones, emails and handles', () => {
    expect(ruleCheck('看這裡 https://example.com')).toMatch(/連結/);
    expect(ruleCheck('找我 www.abc.tw')).toMatch(/連結/);
    expect(ruleCheck('打給我 0912-345-678')).toMatch(/電話/);
    expect(ruleCheck('寫信 a.b@example.com')).toMatch(/Email/);
    expect(ruleCheck('加我 line id: abc123')).toMatch(/帳號/);
    expect(ruleCheck('追蹤 @someone_tw')).toMatch(/帳號/);
  });
  it('blocks empty, symbol-only and too long text', () => {
    expect(ruleCheck('   ')).not.toBeNull();
    expect(ruleCheck('！！！')).not.toBeNull();
    expect(ruleCheck('加'.repeat(140))).toBeNull();
    expect(ruleCheck('加'.repeat(141))).toMatch(/140/);
    expect(ruleCheck('go '.repeat(93) + 'g')).toBeNull();
    expect(ruleCheck('a'.repeat(281))).toMatch(/280/);
  });
});

describe('xLength', () => {
  it('counts like X: latin 1, CJK and emoji 2', () => {
    expect(xLength('hello, world')).toBe(12);
    expect(xLength('台北加油')).toBe(8);
    expect(xLength('加油！')).toBe(6);
    expect(xLength('🌊')).toBe(2);
    expect(xLength('👨‍👩‍👧')).toBe(2);
    expect(xLength('Taipei 加油 🌊')).toBe(6 + 1 + 4 + 1 + 2);
  });
});

describe('scatter', () => {
  it('moves the point but stays within about 100 m', () => {
    const p = { lat: 25.0478, lng: 121.517 };
    for (const r of [0, 0.25, 0.5, 0.99]) {
      const q = scatter(p, () => r);
      const dy = (q.lat - p.lat) * 111320;
      const dx = (q.lng - p.lng) * 111320 * Math.cos((p.lat * Math.PI) / 180);
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(101);
    }
  });
});

const meters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number =>
  Math.hypot((b.lat - a.lat) * 111320, (b.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180));

describe('driftStep', () => {
  const hq = { lat: 25.0456, lng: 121.5263 };
  it('moves at most about 300 m toward the nearest place within 3 km', () => {
    const b = { id: 1, lat: 25.0456 + 1500 / 111320, lng: 121.5263 };
    const to = driftStep(b, [hq, { lat: 25.2, lng: 121.6 }], () => 0.5);
    expect(to).not.toBeNull();
    expect(meters(b, to!)).toBeLessThanOrEqual(302);
    expect(meters(to!, hq)).toBeLessThan(meters(b, hq) - 290);
  });
  it('stops 80–200 m short of the place and then stays', () => {
    let b = { id: 7, lat: 25.0456 + 700 / 111320, lng: 121.5263 };
    for (let i = 0; i < 10; i++) {
      const to = driftStep(b, [hq], () => 0.5);
      if (!to) break;
      b = { ...b, ...to };
    }
    const d = meters(b, hq);
    expect(d).toBeGreaterThanOrEqual(75);
    expect(d).toBeLessThanOrEqual(225);
    expect(driftStep(b, [hq], () => 0.5)).toBeNull();
  });
  it('wanders a little when nothing is within reach', () => {
    const b = { id: 3, lat: 23.5, lng: 120.5 };
    const to = driftStep(b, [hq], () => 0.9)!;
    expect(meters(b, to)).toBeLessThanOrEqual(81);
  });
});
