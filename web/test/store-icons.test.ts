import { describe, expect, it } from 'vitest';
import { ALL_STORE_TYPES, STORE_GLYPH_MIN_SCALE, storeColor, storeIconScale, topicChipSvg, TOPIC_TYPES } from '../src/topic-icons';

describe('店家圖示（v1.776）', () => {
  it('gives every store type a colour and activities none', () => {
    for (const t of [...ALL_STORE_TYPES, { key: 'other', label: '其他' }]) expect(storeColor(t.key)).toMatch(/^#[0-9a-f]{6}$/);
    for (const t of TOPIC_TYPES) expect(storeColor(t.key)).toBeNull();
    expect(storeColor(null)).toBeNull();
    // 台派雷達的店家類型顏色都不一樣
    const taipai = ['eat', 'cafe', 'drink', 'bar', 'book', 'shop', 'beauty', 'stay', 'clinic', 'other'].map(storeColor);
    expect(new Set(taipai).size).toBe(taipai.length);
    // 類型按鈕照同樣的顏色（圖例）
    expect(topicChipSvg('cafe')).toContain(`fill="${storeColor('cafe')}"`);
    expect(topicChipSvg('talk')).toContain('fill="var(--blip-activity)"');
  });
  it('shrinks store icons as the radar zooms out', () => {
    expect(storeIconScale(2)).toBe(1);
    expect(storeIconScale(8)).toBe(1);
    expect(storeIconScale(16)).toBeCloseTo(0.8);
    // 預設 50 km：一半，只畫有顏色的圓點
    expect(storeIconScale(50)).toBe(0.5);
    expect(storeIconScale(50)).toBeLessThan(STORE_GLYPH_MIN_SCALE);
    expect(storeIconScale(20)).toBeGreaterThan(STORE_GLYPH_MIN_SCALE);
    expect(storeIconScale(5000)).toBe(0.5);
    expect(storeIconScale(Infinity)).toBe(0.5);
  });
});
