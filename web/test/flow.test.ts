import { describe, expect, it } from 'vitest';
import { fireworksSvg, HQ_SAIL_MS, HQ_VOYAGE_MS, voyagePhase, voyageTimeOf } from '../src/flow';
import { HQ_TOUR, HQ_TOUR_AT, HQ_VOYAGE } from '../src/hq-voyage';
import { LANDMARKS } from '../src/landmarks';
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
  it('starts at the HQ landmark and ends at 台北市政府', () => {
    const hq = LANDMARKS.find((l) => l.id === 'hq')!;
    expect(haversineKm(hq, { lat: HQ_VOYAGE[0][0], lng: HQ_VOYAGE[0][1] })).toBeLessThan(0.05);
    const end = HQ_VOYAGE[HQ_VOYAGE.length - 1];
    expect(haversineKm({ lat: end[0], lng: end[1] }, { lat: 25.0375, lng: 121.5644 })).toBeLessThan(0.15);
  });
  it('winds through all 12 districts of Taipei along real roads, not over 陽明山', () => {
    const districts = ['中正區', '萬華區', '大同區', '中山區', '士林區', '北投區', '內湖區', '南港區', '松山區', '文山區', '大安區', '信義區'];
    expect(new Set(HQ_TOUR.map((s) => s.district))).toEqual(new Set(districts));
    // 每一站都在線上附近（照路算的，snap 到最近的路；動物園門口離路遠一點），走到幾成一站比一站多
    HQ_TOUR.forEach((st, i) => {
      const near = Math.min(...HQ_VOYAGE.map(([lat, lng]) => haversineKm(st, { lat, lng })));
      expect(near).toBeLessThan(0.5);
      if (i > 0) expect(HQ_TOUR_AT[i]).toBeGreaterThan(HQ_TOUR_AT[i - 1]);
    });
    expect(HQ_TOUR_AT).toHaveLength(HQ_TOUR.length);
    expect(HQ_TOUR_AT[HQ_TOUR_AT.length - 1]).toBe(1);
    // 陽明山不繞進去：整條都在北緯 25.15 度以南
    expect(Math.max(...HQ_VOYAGE.map(([lat]) => lat))).toBeLessThan(25.15);
    // 經過那一站的時間：照速度倒推回去
    for (const at of [0.1, 0.5, 0.9]) expect(voyagePhase(voyageTimeOf(at)).at).toBeCloseTo(at, 4);
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
