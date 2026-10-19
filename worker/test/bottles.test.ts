import { describe, expect, it } from 'vitest';
import { ruleCheck, scatter } from '../src/bottles';

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
    expect(ruleCheck('加'.repeat(61))).toMatch(/60/);
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
