import { describe, expect, it } from 'vitest';
import { fireworksSvg, HQ_SAIL_MS, HQ_VOYAGE_MS, voyagePhase, voyageTimeOf } from '../src/flow';
import { HQ_BLOOMS, HQ_BOATS, HQ_BRIDGE, HQ_CANALS, HQ_AREAS, HQ_CULTURE, HQ_CULTURE_LINES, HQ_CULTURE_THEMES, HQ_INTROS, HQ_POLICY_LAYERS, HQ_RENEWAL, HQ_SEAM, HQ_SERVICE_KINDS, HQ_SERVICES, HQ_CHESTS, HQ_DOME, HQ_MEIJI, HQ_PAW, HQ_TAIPEI_RING, HQ_VIADUCTS, HQ_WETLANDS, HQ_PLANTINGS, HQ_PONDS, HQ_SPRINGS, HQ_STARS, HQ_TOUR, HQ_TOUR_AT, HQ_TRAILS, HQ_VENUES, HQ_VOYAGE } from '../src/hq-voyage';
import { LANDMARKS } from '../src/landmarks';
import { haversineKm } from '../src/geo';

describe('洋流總部的特效', () => {
  it('sails once from 洋流總部 to 台北市政府, slow at both ends, then fades after the fireworks', () => {
    expect(voyagePhase(-100)).toEqual({ at: 0, alpha: 0 });
    expect(voyagePhase(0).at).toBe(0);
    expect(voyagePhase(HQ_SAIL_MS / 2).at).toBeCloseTo(0.5);
    expect(voyagePhase(HQ_SAIL_MS * 0.1).at).toBeLessThan(0.1);
    // 到了停在終點
    expect(voyagePhase(HQ_SAIL_MS + 1000)).toEqual({ at: 1, alpha: 1 });
    // 播完不會自己淡掉（手動關閉）
    expect(voyagePhase(HQ_VOYAGE_MS - 300).alpha).toBe(1);
    expect(voyagePhase(HQ_VOYAGE_MS + 60_000).alpha).toBe(1);
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
  it('has the policy props: the old canals start near their stops, the sites, boats and streets sit by the route', () => {
    const nearRoute = (p: { lat: number; lng: number }): number => Math.min(...HQ_VOYAGE.map(([lat, lng]) => haversineKm(p, { lat, lng })));
    for (const c of HQ_CANALS) {
      const stop = HQ_TOUR.find((st) => st.place === c.stop)!;
      expect(stop).toBeDefined();
      // 源頭（第一點）在那一站附近（大灣的源頭在六張犁山區，離嘉興街幾百公尺）
      expect(haversineKm(stop, { lat: c.points[0][0], lng: c.points[0][1] })).toBeLessThan(1);
      expect(c.points.length).toBeGreaterThan(10);
      expect(c.name.length).toBeGreaterThan(1);
    }
    // 種樹的地方都在路線附近（船經過才長）；砍樹的地方有名字和來源
    for (const p of HQ_PLANTINGS) {
      expect(nearRoute(p)).toBeLessThan(1.2);
      expect(['cut', 'plant']).toContain(p.kind);
      expect(p.name.length).toBeGreaterThan(1);
      if (p.kind === 'cut') expect(p.source).toMatch(/^https?:/);
    }
    expect(HQ_PLANTINGS.filter((p) => p.kind === 'cut').length).toBeGreaterThanOrEqual(5);
    // 湧泉、水塘、船、街道都在路線附近；船都在夠寬的河段（整艘在水上）
    for (const p of [...HQ_SPRINGS, ...HQ_BOATS]) expect(nearRoute(p)).toBeLessThan(1.5);
    for (const b of HQ_BOATS) expect(b.width).toBeGreaterThanOrEqual(b.kind === 'dragon' ? 200 : 120);
    for (const pd of HQ_PONDS) expect(pd.ring.length).toBeGreaterThanOrEqual(6);
    // 其他政見：步道從捷運站開始、登山口在步道上，橋兩端在路線附近，球場、運動中心、星群都在路線附近
    for (const tr of HQ_TRAILS) {
      expect(HQ_TOUR.some((st) => st.place === tr.stop)).toBe(true);
      expect(haversineKm({ lat: tr.pts[0][0], lng: tr.pts[0][1] }, { lat: tr.station[0], lng: tr.station[1] })).toBeLessThan(0.1);
      expect(Math.min(...tr.pts.map(([lat, lng]) => haversineKm({ lat, lng }, { lat: tr.head[0], lng: tr.head[1] })))).toBeLessThan(0.02);
      expect(nearRoute({ lat: tr.station[0], lng: tr.station[1] })).toBeLessThan(2.5);
    }
    expect(nearRoute({ lat: HQ_BRIDGE.from[0], lng: HQ_BRIDGE.from[1] })).toBeLessThan(2);
    // 文化徑的點：政見四大主題裡點名的（現代台北沒點名），都在台北市裡、每個主題都有；介紹都寫了
    expect(HQ_CULTURE.length).toBeGreaterThanOrEqual(28);
    for (const th of Object.keys(HQ_CULTURE_THEMES)) expect(HQ_CULTURE.some((c) => c.theme === th)).toBe(true);
    for (const c of HQ_CULTURE) {
      expect(c.lat).toBeGreaterThan(24.96);
      expect(c.lat).toBeLessThan(25.21);
      expect(c.lng).toBeGreaterThan(121.45);
      expect(c.lng).toBeLessThan(121.67);
    }
    for (const name of [...HQ_TRAILS.map((t) => t.name), HQ_BRIDGE.name, ...HQ_VENUES.map((v) => v.name), ...HQ_CANALS.map((c) => c.name), ...HQ_SPRINGS.map((x) => x.name), ...HQ_PONDS.map((x) => x.name), '北士科星群', '水上活動', '綠覆率']) expect(HQ_INTROS[name]?.length ?? 0).toBeGreaterThan(10);
    for (const p of HQ_PLANTINGS.filter((x) => x.kind === 'cut')) expect(p.why.length).toBeGreaterThan(5);
    // 文化徑的線：每一站都是文化徑的點、線走過每一站（100 公尺內）
    for (const ln of HQ_CULTURE_LINES) {
      for (const n of ln.stops) {
        const c = HQ_CULTURE.find((x) => x.name === n);
        expect(c, n).toBeTruthy();
        expect(Math.min(...ln.pts.map(([lat, lng]) => haversineKm({ lat, lng }, c!)))).toBeLessThan(0.1);
      }
    }
    // 台北市界：圈得住市政府、總部、所有文化徑的點
    const inside = (lat: number, lng: number): boolean => {
      let ok = false;
      for (let i = 0, j = HQ_TAIPEI_RING.length - 1; i < HQ_TAIPEI_RING.length; j = i++) {
        const [ya, xa] = HQ_TAIPEI_RING[i];
        const [yb, xb] = HQ_TAIPEI_RING[j];
        if (ya > lat !== yb > lat && lng < xa + ((lat - ya) * (xb - xa)) / (yb - ya)) ok = !ok;
      }
      return ok;
    };
    expect(HQ_TAIPEI_RING.length).toBeGreaterThan(100);
    for (const p of [...HQ_TOUR, ...HQ_CULTURE, ...HQ_SERVICES]) expect(inside(p.lat, p.lng), 'place' in p ? p.place : p.name).toBe(true);
    // 其他政見的地方：每一種都有、國小 100 所以上、12 區運動中心和健康服務中心，政策圖層用到的種類都有資料
    expect(HQ_SERVICES.filter((x) => x.kind === '小').length).toBeGreaterThan(100);
    expect(HQ_SERVICES.filter((x) => x.kind === '動').length).toBe(12);
    expect(HQ_SERVICES.filter((x) => x.kind === '健').length).toBe(12);
    for (const k of Object.keys(HQ_SERVICE_KINDS)) expect(HQ_SERVICES.some((x) => x.kind === k), k).toBe(true);
    for (const ly of HQ_POLICY_LAYERS) for (const k of ly.kinds) expect(HQ_SERVICE_KINDS[k].intro.length).toBeGreaterThan(20);
    // 各區政見開箱、大巨蛋、狗掌、橋下空間：都在台北市裡，橋下空間每條至少 3 公里
    expect(HQ_CHESTS.length).toBeGreaterThanOrEqual(6);
    for (const p of [...HQ_CHESTS, HQ_DOME, HQ_PAW]) expect(inside(p.lat, p.lng)).toBe(true);
    for (const vd of HQ_VIADUCTS) {
      let L = 0;
      for (let i = 1; i < vd.pts.length; i++) L += haversineKm({ lat: vd.pts[i - 1][0], lng: vd.pts[i - 1][1] }, { lat: vd.pts[i][0], lng: vd.pts[i][1] });
      expect(L, vd.name).toBeGreaterThan(3);
    }
    // 縫合市民大道：三個縫線都有介紹；人流小點真的跨過高架（SOGO 在南、微風在北）；北流在台北市裡
    const civic = HQ_VIADUCTS.find((v) => v.name.startsWith('市民'))!.pts;
    const civicLat = (lng: number): number => {
      for (let i = 1; i < civic.length; i++) {
        const [a, b] = [civic[i - 1], civic[i]];
        if ((a[1] - lng) * (b[1] - lng) <= 0) return a[0] + ((b[0] - a[0]) * (lng - a[1])) / (b[1] - a[1] || 1);
      }
      return NaN;
    };
    expect(HQ_SEAM.stitches.length).toBe(3);
    for (const st of HQ_SEAM.stitches) expect(HQ_INTROS[st.intro]?.length ?? 0, st.intro).toBeGreaterThan(20);
    expect(HQ_INTROS['縫合市民大道']?.length ?? 0).toBeGreaterThan(20);
    const walk = HQ_SEAM.stitches.find((st) => st.walk)!.walk!;
    expect(walk[0][0]).toBeLessThan(civicLat(walk[0][1]));
    expect(walk[1][0]).toBeGreaterThan(civicLat(walk[1][1]));
    expect(inside(HQ_SEAM.beiliu.lat, HQ_SEAM.beiliu.lng)).toBe(true);
    // 明治橋：在台北市裡、離路線 2 公里內、有介紹
    expect(inside(HQ_MEIJI.lat, HQ_MEIJI.lng)).toBe(true);
    expect(nearRoute(HQ_MEIJI)).toBeLessThan(2);
    expect(HQ_INTROS['明治橋']?.length ?? 0).toBeGreaterThan(20);
    // 青年：大學 20 所以上；濕地都在台北市裡、離路線 2 公里內
    expect(HQ_SERVICES.filter((x) => x.kind === '大').length).toBeGreaterThanOrEqual(20);
    for (const w of HQ_WETLANDS) {
      expect(inside(w.lat, w.lng), w.name).toBe(true);
      expect(nearRoute(w)).toBeLessThan(2);
    }
    // 核定滿 5 年未開工的都更案：都在台北市裡、2021-11-05 以前核定、都有基地範圍
    expect(HQ_RENEWAL.length).toBe(66);
    for (const rn of HQ_RENEWAL) {
      expect(rn.approved <= '2021-11-05', rn.id).toBe(true);
      expect(rn.rings.length).toBeGreaterThan(0);
      expect(inside(rn.center[0], rn.center[1]), rn.id).toBe(true);
    }
    // 社子島分 9 區（示意）
    expect(HQ_AREAS[0].zones?.length).toBe(9);
    expect(HQ_INTROS['臺北市政府']?.length ?? 0).toBeGreaterThan(20);
    for (const v of [...HQ_VENUES, ...HQ_STARS]) expect(nearRoute(v)).toBeLessThan(2.5);
    // 街道的路樹：中心離路線 200～700 公尺（不是在路線上），每個中心至少 3 條街、街都在中心 500 公尺內
    expect(HQ_BLOOMS.length).toBeGreaterThan(30);
    for (const bl of HQ_BLOOMS.filter((_, i) => i % 4 === 0)) {
      const d = nearRoute({ lat: bl.center[0], lng: bl.center[1] });
      expect(d).toBeGreaterThan(0.2);
      expect(d).toBeLessThan(0.9);
      expect(bl.streets.length).toBeGreaterThanOrEqual(3);
      for (const st of bl.streets) {
        expect(st.mid).toBeLessThan(st.pts.length);
        expect(haversineKm({ lat: st.pts[st.mid][0], lng: st.pts[st.mid][1] }, { lat: bl.center[0], lng: bl.center[1] })).toBeLessThan(0.5);
      }
    }
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
