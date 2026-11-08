import { describe, expect, it } from 'vitest';
import { cleanSvg, isSceneKind, sceneSvg, windSvg, type SceneKind } from '../src/hq-scenes';
import { HQ_BIKE_HUBS, HQ_BRIDGE, HQ_COMMUTE, HQ_DETENTION, HQ_FARM_TRUCKS, HQ_POCKETPARKS, HQ_SERVICES, HQ_STAGGER, HQ_TIAOTONG } from '../src/hq-voyage';
import { haversineKm } from '../src/geo';

describe('更貼近政策的小動畫', () => {
  it('draws every scene kind', () => {
    const kinds: SceneKind[] = ['sporthub', 'pocketpark', 'detention', 'cleanwater', 'schoolwalk', 'lunch', 'piggy', 'aiteam', 'workhub', 'ridehub', 'oldhouse', 'streettree', 'bikerack', 'nightmayor', 'buscharge', 'library24', 'lantern', 'nightsky', 'tpassgo', 'tpasspark', 'busterminal', 'cyclerenew', 'stagger'];
    for (const k of kinds) {
      expect(isSceneKind(k)).toBe(true);
      expect(sceneSvg(k, 0).length).toBeGreaterThan(100);
    }
    expect(isSceneKind('wetland')).toBe(false);
    expect(cleanSvg(30)).toContain('rotate(30.0)');
    expect(windSvg(-45)).toContain('rotate(-45.0)');
  });

  it('puts 內科智慧錯峰 in the Neihu science park, away from the 港墘 hub and the bike bridge', () => {
    // 內湖科技園區（OpenStreetMap landuse 的範圍）
    expect(HQ_STAGGER.lat).toBeGreaterThan(25.0684);
    expect(HQ_STAGGER.lat).toBeLessThan(25.0838);
    expect(HQ_STAGGER.lng).toBeGreaterThan(121.5615);
    expect(HQ_STAGGER.lng).toBeLessThan(121.5841);
    const hub = HQ_BIKE_HUBS.find((h) => h.mode === 'work')!;
    for (const p of [hub, { lat: HQ_BRIDGE.to[0], lng: HQ_BRIDGE.to[1] }]) expect(haversineKm(HQ_STAGGER, p)).toBeGreaterThan(0.6);
    expect(sceneSvg('stagger', 0)).toContain('7–8');
  });

  it('drives each farm truck from the farm to its school', () => {
    expect(HQ_FARM_TRUCKS).toHaveLength(3);
    for (const tk of HQ_FARM_TRUCKS) {
      const sv = HQ_SERVICES.find((x) => x.name === tk.school);
      expect(sv, tk.school).toBeDefined();
      const end = tk.path[tk.path.length - 1];
      expect(haversineKm({ lat: end[0], lng: end[1] }, sv!)).toBeLessThan(0.3);
      expect(tk.lengthM).toBeGreaterThan(500);
    }
  });

  it('keeps pocket parks and detention ponds inside Taipei', () => {
    for (const p of [...HQ_POCKETPARKS, ...HQ_DETENTION]) {
      expect(p.lat).toBeGreaterThan(24.95);
      expect(p.lat).toBeLessThan(25.2);
      expect(p.lng).toBeGreaterThan(121.45);
      expect(p.lng).toBeLessThan(121.67);
    }
  });

  it('rides from 松山站 along the river, over the bike bridge, to 港墘站', () => {
    const near = (a: [number, number], b: { lat: number; lng: number }): number => haversineKm({ lat: a[0], lng: a[1] }, b);
    const [ss, kg] = [HQ_BIKE_HUBS.find((h) => h.name === '松山')!, HQ_BIKE_HUBS.find((h) => h.name === '港墘')!];
    const p = HQ_COMMUTE.path;
    expect(near(p[0], ss)).toBeLessThan(0.2);
    expect(near(p[p.length - 1], kg)).toBeLessThan(0.2);
    // 經過自行車橋的兩頭
    for (const end of [HQ_BRIDGE.from, HQ_BRIDGE.to]) expect(Math.min(...p.map((q) => near(q, { lat: end[0], lng: end[1] })))).toBeLessThan(0.05);
  });

  it('draws 二～九條通 (not the big roads) west to east', () => {
    expect(HQ_TIAOTONG.map((t) => t.name)).toEqual(['二條通', '三條通', '五條通', '六條通', '七條通', '八條通', '九條通']);
    for (const t of HQ_TIAOTONG) for (const w of t.ways) expect(w.pts[0][1]).toBeLessThanOrEqual(w.pts[w.pts.length - 1][1]);
  });
});
