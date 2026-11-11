import { describe, expect, it } from 'vitest';
import { chinaMask, eaCoast, EA_BOX } from '../src/eastasia';

describe('chinaMask', () => {
  it('covers mainland China, coast included', () => {
    for (const [name, lat, lng] of [
      ['廈門', 24.48, 118.09],
      ['福州', 26.07, 119.3],
      ['上海', 31.23, 121.47],
      ['深圳', 22.54, 114.06],
      ['北京', 39.9, 116.4],
      ['黃岐', 26.33, 119.9],
    ] as const) expect(chinaMask.contains(lat, lng), name).toBe(true);
  });
  it('leaves out Kinmen, Matsu, Wuqiu, Hong Kong, Macao, Taiwan, Korea, Japan', () => {
    for (const [name, lat, lng] of [
      ['金門', 24.44, 118.35],
      ['烈嶼', 24.43, 118.24],
      ['大膽', 24.383, 118.155],
      ['南竿', 26.155, 119.93],
      ['東引', 26.367, 120.49],
      ['烏坵', 24.99, 119.45],
      ['香港', 22.3, 114.17],
      ['澳門', 22.19, 113.54],
      ['台北', 25.04, 121.52],
      ['首爾', 37.57, 126.98],
      ['東京', 35.68, 139.77],
    ] as const) expect(chinaMask.contains(lat, lng), name).toBe(false);
  });
});

describe('eaCoast', () => {
  it('decodes into lines inside the East Asia box', () => {
    expect(eaCoast.length).toBeGreaterThan(100);
    for (const l of eaCoast) for (const [lat, lng] of l) {
      expect(lat).toBeGreaterThanOrEqual(EA_BOX.s - 0.01);
      expect(lat).toBeLessThanOrEqual(EA_BOX.n + 0.01);
      expect(lng).toBeGreaterThanOrEqual(EA_BOX.w - 0.01);
      expect(lng).toBeLessThanOrEqual(EA_BOX.e + 0.01);
    }
  });
});
