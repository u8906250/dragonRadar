import { describe, expect, it } from 'vitest';
import { fireworksSvg, HQ_SAIL_MS, HQ_VOYAGE_MS, voyagePhase } from '../src/flow';
import { HQ_VOYAGE, LANDMARKS } from '../src/landmarks';
import { haversineKm } from '../src/geo';

describe('洋流總部的特效', () => {
  it('sails once from 洋流總部 to 台北市政府, slow at both ends, then fades after the fireworks', () => {
    expect(voyagePhase(-100)).toEqual({ at: 0, alpha: 0 });
    expect(voyagePhase(0).at).toBe(0);
    expect(voyagePhase(HQ_SAIL_MS / 2).at).toBeCloseTo(0.5);
    expect(voyagePhase(HQ_SAIL_MS * 0.1).at).toBeLessThan(0.1);
    // 到了停在終點，煙火放完淡掉
    expect(voyagePhase(HQ_SAIL_MS + 1000)).toEqual({ at: 1, alpha: 1 });
    expect(voyagePhase(HQ_VOYAGE_MS - 300).alpha).toBeCloseTo(0.5);
    expect(voyagePhase(HQ_VOYAGE_MS + 10).alpha).toBe(0);
  });
  it('starts at the HQ landmark and ends at 台北市政府 (市府路)', () => {
    const hq = LANDMARKS.find((l) => l.id === 'hq')!;
    expect(haversineKm(hq, { lat: HQ_VOYAGE[0][0], lng: HQ_VOYAGE[0][1] })).toBeLessThan(0.05);
    const end = HQ_VOYAGE[HQ_VOYAGE.length - 1];
    expect(haversineKm({ lat: end[0], lng: end[1] }, { lat: 25.0375, lng: 121.5637 })).toBeLessThan(0.1);
  });
  it('keeps the fireworks going when redrawn (negative delays for what already started)', () => {
    expect(fireworksSvg(0)).toContain('animation-delay:0ms');
    const later = fireworksSvg(1000);
    expect(later).toContain('animation-delay:-1000ms');
    // 還沒開始的等一下才放
    expect(fireworksSvg(-500)).toContain('animation-delay:500ms');
    expect((later.match(/class="fw-spark"/g) ?? []).length).toBeGreaterThan(60);
  });
});
