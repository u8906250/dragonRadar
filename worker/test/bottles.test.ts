import { describe, expect, it } from 'vitest';
import { distM, driftStep, parsePhoto, ruleCheck, scatter, seaPoint, sha256Hex, stripJpegMeta, xLength } from '../src/bottles';
import { WOOF_KM, WOOF_SEA } from '../src/woofsea';

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
  const home = { lat: 25.0456, lng: 121.5263 };
  it('wanders at most about 60 m a step', () => {
    const b = { ...home, origin_lat: home.lat, origin_lng: home.lng };
    for (const r of [0.1, 0.5, 0.9]) expect(meters(b, driftStep(b, () => r))).toBeLessThanOrEqual(61);
  });
  it('never strays more than about 200 m from where it was dropped', () => {
    let b = { ...home, origin_lat: home.lat, origin_lng: home.lng };
    let seed = 1;
    const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) {
      b = { ...b, ...driftStep(b, rand) };
      expect(meters(home, b)).toBeLessThanOrEqual(202);
    }
  });
  it('heads back when it is outside the range', () => {
    const b = { lat: home.lat + 300 / 111320, lng: home.lng, origin_lat: home.lat, origin_lng: home.lng };
    const to = driftStep(b, () => 0.99);
    expect(meters(home, to)).toBeLessThan(meters(home, b) - 50);
  });
});

describe('seaPoint', () => {
  const woofM = WOOF_KM * 1000;
  it('lands within 250 m of one of the sea points on 汪星', () => {
    for (const from of [{ lat: 25.13, lng: 121.5 }, { lat: 24.15, lng: 120.67 }, null]) {
      for (const r of [0, 0.3, 0.7, 0.99]) {
        const p = seaPoint(from, () => r);
        const d = Math.min(...WOOF_SEA.map(([lat, lng]) => distM({ lat, lng }, p, woofM)));
        expect(d).toBeLessThanOrEqual(252);
      }
    }
  });
  it('goes to the coast in the same direction as where it was dropped (seen from the middle of Taipei)', () => {
    // 北投（北邊）→ 方向接近北的海邊；台中（西南）→ 西南的海邊
    const gap = (a: number, b: number): number => Math.abs((((a - b) % 360) + 540) % 360 - 180);
    const near = (p: { lat: number; lng: number }): number => {
      let best = WOOF_SEA[0];
      for (const s of WOOF_SEA) if (distM({ lat: s[0], lng: s[1] }, p, woofM) < distM({ lat: best[0], lng: best[1] }, p, woofM)) best = s;
      return best[2];
    };
    expect(gap(near(seaPoint({ lat: 25.2, lng: 121.56 }, () => 0)), 0)).toBeLessThan(40);
    expect(gap(near(seaPoint({ lat: 24.15, lng: 120.67 }, () => 0)), 220)).toBeLessThan(40);
  });
});

describe('sha256Hex', () => {
  it('hashes the text like everyone else does', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('photos', () => {
  const seg = (marker: number, payload: number[]): number[] => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
  const jpeg = Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 9, 9, 9, 9]),
    ...seg(0xfe, [0x68, 0x69]),
    ...seg(0xdb, [0, 1, 2, 3]),
    ...seg(0xda, [1, 2, 3, 4, 5, 6]),
    0x11, 0x22, 0xff, 0x00, 0x33, 0xff, 0xd9,
  ]);
  it('drops EXIF (GPS, camera) and comments but keeps the picture', () => {
    const out = [...stripJpegMeta(jpeg)];
    const hex = out.map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).not.toContain('ffe1');
    expect(hex).not.toContain('fffe');
    expect(hex).toContain('ffe0');
    expect(hex).toContain('ffdb');
    expect(hex.endsWith('1122ff0033ffd9')).toBe(true);
    expect(out.length).toBe(jpeg.length - 14 - 6);
  });
  it('rejects things that are not a JPEG', () => {
    expect(() => stripJpegMeta(Uint8Array.from([0xff, 0xd8, 0x00, 0x01, 0x02, 0x03]))).toThrow();
    expect(() => parsePhoto('data:image/png;base64,AAAA')).toThrow();
    expect(() => parsePhoto(`data:image/jpeg;base64,${btoa('hello')}`)).toThrow();
    expect(parsePhoto(undefined)).toBeNull();
    expect(parsePhoto('')).toBeNull();
  });
  it('accepts a small JPEG data URL', () => {
    const b64 = btoa(String.fromCharCode(...jpeg));
    expect(parsePhoto(`data:image/jpeg;base64,${b64}`)?.bytes.length).toBe(jpeg.length);
  });
});
