import { describe, expect, it } from 'vitest';
import { altOf, azOf, moonEnu, moonLit, skyLook, sunEnu } from '../src/sky';

// 中山公園
const [LAT, LNG] = [25.0394, 121.5596];
const sunAt = (iso: string): { alt: number; az: number } => {
  const d = sunEnu(new Date(iso), LAT, LNG);
  return { alt: altOf(d), az: azOf(d) };
};
const moonAt = (iso: string): { alt: number; az: number; lit: number } => {
  const at = new Date(iso);
  const m = moonEnu(at, LAT, LNG);
  return { alt: altOf(m), az: azOf(m), lit: moonLit(sunEnu(at, LAT, LNG), m) };
};

describe('3D 國館的天空（v1.777）', () => {
  it('puts the sun where Taipei sees it', () => {
    // 11/22 中午：南邊、高約 45 度（90 − 25 − 20）
    const noon = sunAt('2026-11-22T12:00:00+08:00');
    expect(noon.alt).toBeCloseTo(44.7, 0);
    expect(Math.abs(noon.az - 180)).toBeLessThan(10);
    // 日出約 6:13、日落約 17:05
    expect(sunAt('2026-11-22T06:00:00+08:00').alt).toBeLessThan(0);
    expect(sunAt('2026-11-22T06:30:00+08:00').alt).toBeGreaterThan(0);
    expect(sunAt('2026-11-22T06:30:00+08:00').az).toBeGreaterThan(100);
    expect(sunAt('2026-11-22T16:55:00+08:00').alt).toBeGreaterThan(0);
    expect(sunAt('2026-11-22T17:15:00+08:00').alt).toBeLessThan(0);
    // 夏至中午快到頭頂（台北在北回歸線南邊一點）
    expect(sunAt('2026-06-21T12:05:00+08:00').alt).toBeGreaterThan(85);
  });
  it('puts the moon where it is, with its phase', () => {
    // 2026-11-24 滿月：快全亮，半夜高高在南邊（赤緯約 +20 度）
    const full = moonAt('2026-11-24T23:30:00+08:00');
    expect(full.lit).toBeGreaterThan(0.97);
    expect(full.alt).toBeGreaterThan(70);
    // 2026-11-09 新月：幾乎看不到
    expect(moonAt('2026-11-09T12:00:00+08:00').lit).toBeLessThan(0.03);
    // 上弦月（11/17）：一半亮，傍晚在南邊天上
    const half = moonAt('2026-11-17T19:00:00+08:00');
    expect(half.lit).toBeGreaterThan(0.4);
    expect(half.lit).toBeLessThan(0.6);
    expect(half.alt).toBeGreaterThan(30);
    expect(Math.abs(half.az - 200)).toBeLessThan(30);
  });
  it('turns the sky from day to night by the sun', () => {
    const day = skyLook(40);
    expect(day.night).toBe(0);
    expect(day.horizon).toBe(0xcfe0ea);
    expect(day.sunI).toBeCloseTo(1.9);
    // 日落：地平線偏橘、路燈快亮了
    const set = skyLook(0);
    expect((set.horizon >> 16) & 255).toBeGreaterThan(set.horizon & 255);
    expect(set.night).toBeCloseTo(0.25);
    // 天黑透：路燈全亮、沒有太陽光，城市的天空不會全黑
    const night = skyLook(-30);
    expect(night.night).toBe(1);
    expect(night.sunI).toBe(0);
    expect(night.hemiI).toBeGreaterThan(0.5);
    expect(night.zenith).toBe(0x0d1a3a);
    // 中間照比例慢慢變
    expect(skyLook(-1).hemiI).toBeLessThan(set.hemiI);
    expect(skyLook(-1).hemiI).toBeGreaterThan(skyLook(-3).hemiI);
  });
});
