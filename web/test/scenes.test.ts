import { describe, expect, it } from 'vitest';
import { cleanSvg, isSceneKind, sceneSvg, windSvg, type SceneKind } from '../src/hq-scenes';
import { HQ_DETENTION, HQ_FARM_TRUCKS, HQ_POCKETPARKS, HQ_SERVICES } from '../src/hq-voyage';
import { haversineKm } from '../src/geo';

describe('更貼近政策的小動畫', () => {
  it('draws every scene kind', () => {
    const kinds: SceneKind[] = ['sporthub', 'pocketpark', 'detention', 'cleanwater', 'schoolwalk', 'lunch', 'piggy'];
    for (const k of kinds) {
      expect(isSceneKind(k)).toBe(true);
      expect(sceneSvg(k, 0).length).toBeGreaterThan(100);
    }
    expect(isSceneKind('wetland')).toBe(false);
    expect(cleanSvg(30)).toContain('rotate(30.0)');
    expect(windSvg(-45)).toContain('rotate(-45.0)');
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
});
