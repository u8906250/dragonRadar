import { describe, expect, it } from 'vitest';
import { parseParkMark } from '../src/parkmarks';

describe('parseParkMark', () => {
  it('takes a kind, a spot in 中山公園, a heading and a short note', () => {
    expect(parseParkMark({ kind: 'lamp', lat: 25.03853, lng: 121.56024 })).toEqual({ kind: 'lamp', lat: 25.03853, lng: 121.56024, heading: 0, note: null });
    expect(parseParkMark({ kind: 'bench', lat: 25.038531234567, lng: 121.560241234567, heading: -90, note: '  映池 南邊\n第二張 ' })).toEqual({
      kind: 'bench',
      lat: 25.0385312,
      lng: 121.5602412,
      heading: 270,
      note: '映池 南邊 第二張',
    });
    expect(parseParkMark({ kind: 'other', lat: 25.039, lng: 121.56, heading: 725, note: '   ' })).toMatchObject({ heading: 5, note: null });
    expect([...((parseParkMark({ kind: 'bin', lat: 25.039, lng: 121.56, note: '洋'.repeat(100) }) as { note: string }).note)]).toHaveLength(60);
  });
  it('refuses unknown kinds, missing or far-away spots and bad headings', () => {
    expect(parseParkMark({ kind: 'tree', lat: 25.039, lng: 121.56 })).toMatch(/kind/);
    expect(parseParkMark({ kind: 'lamp', lat: '25.039', lng: 121.56 })).toMatch(/lat/);
    expect(parseParkMark({ kind: 'lamp', lat: 25.0478, lng: 121.517 })).toBe('not in 中山公園');
    expect(parseParkMark({ kind: 'lamp', lat: 25.039, lng: 121.56, heading: 'north' })).toMatch(/heading/);
    expect(parseParkMark(null)).toMatch(/kind/);
  });
});
