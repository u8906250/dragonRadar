import { describe, expect, it } from 'vitest';
import { crowdLevel, parseMapPage, projectOnRoute, routeLine, type MapSegment } from '../src/sources/currentmap';

const PAGE = `<html><head><title>松山信義車掃｜大洋流車掃地圖</title></head><body>
<div data-segments-url="https://current-map.puma.taipei/api/v1/events/2026-10-18-songshan-xinyi/segments"></div>
<h1>松山信義車掃</h1><p>10/18（週日）</p><p>車掃 17:30–18:30</p><p>🎤 市政開講 18:30–20:30 · 民權公園</p>
<script>var x = '車掃 01:00–02:00';</script></body></html>`;

describe('current-map page', () => {
  it('reads date, parade time and the event after arrival', () => {
    const r = parseMapPage(PAGE)!;
    expect(r.slug).toBe('2026-10-18-songshan-xinyi');
    expect(r.date).toBe('2026-10-18');
    expect(r.name).toBe('松山信義車掃');
    expect(r.times.depart).toBe(Date.parse('2026-10-18T17:30:00+08:00') / 1000);
    expect(r.times.arrive).toBe(Date.parse('2026-10-18T18:30:00+08:00') / 1000);
    expect(r.times.after).toEqual({
      name: '市政開講',
      start: Date.parse('2026-10-18T18:30:00+08:00') / 1000,
      end: Date.parse('2026-10-18T20:30:00+08:00') / 1000,
      place: '民權公園',
    });
  });

  it('returns null without a segments url', () => {
    expect(parseMapPage('<html></html>')).toBeNull();
  });

  it('missing times stay null', () => {
    const r = parseMapPage(PAGE.replace('車掃 17:30–18:30', '').replace(/🎤.*民權公園/, ''))!;
    expect(r.times).toEqual({ depart: null, arrive: null, after: null });
  });
});

describe('route projection', () => {
  // 往東走 1 km，再折返往西 1 km（同一條路走兩次）
  const seg = (seq: number, path: [number, number][]): MapSegment => ({ seq, from: '', to: '', path, lengthM: 0, people: 0, target: 0 });
  const segs = [seg(1, [[25, 121.5], [25, 121.51]]), seg(2, [[25, 121.51], [25.0001, 121.5]])];
  const line = routeLine(segs);

  it('joins segments without duplicating shared points', () => {
    expect(line.pts).toHaveLength(3);
    expect(line.cum[2]).toBeGreaterThan(1900);
  });

  it('respects order when the route passes the same street twice', () => {
    const p: [number, number] = [25, 121.505];
    const first = projectOnRoute(line, p)!;
    expect(first.m).toBeGreaterThan(450);
    expect(first.m).toBeLessThan(560);
    const second = projectOnRoute(line, p, first.m + 10)!;
    expect(second.m).toBeGreaterThan(1400);
  });

  it('crowd levels match the official map colours', () => {
    expect(crowdLevel(0, 100)).toBe('empty');
    expect(crowdLevel(59, 100)).toBe('low');
    expect(crowdLevel(60, 100)).toBe('mid');
    expect(crowdLevel(100, 100)).toBe('full');
  });
});
