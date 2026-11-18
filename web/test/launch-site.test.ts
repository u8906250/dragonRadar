import { describe, expect, it } from 'vitest';
import { LAUNCH_AREAS, LAUNCH_DRAW_KM, LAUNCH_PADS, LAUNCH_ROCKET, launchSiteSvg } from '../src/launch-site';
import { ringHas } from '../src/geo';

/** 經緯度的一圈換成平方公尺（範圍小，平面近似） */
const areaM2 = (r: Array<[number, number]>): number => {
  const kx = 111_320 * Math.cos((r[0][0] * Math.PI) / 180);
  let a = 0;
  for (let i = 0; i + 1 < r.length; i++) a += r[i][1] * kx * r[i + 1][0] * 110_574 - r[i + 1][1] * kx * r[i][0] * 110_574;
  return Math.abs(a / 2);
};

describe('launch-site', () => {
  it('has the three development areas adding up to the 26.02 ha in the EIA', () => {
    expect(LAUNCH_AREAS).toHaveLength(3);
    const ha = LAUNCH_AREAS.reduce((s, r) => s + areaM2(r), 0) / 1e4;
    expect(ha).toBeGreaterThan(25.5);
    expect(ha).toBeLessThan(26.5);
  });
  it('puts the pads and the rocket inside the launch core area', () => {
    for (const { at } of LAUNCH_PADS) expect(ringHas(LAUNCH_AREAS[0], at[0], at[1])).toBe(true);
    expect(ringHas(LAUNCH_AREAS[0], LAUNCH_ROCKET[0], LAUNCH_ROCKET[1])).toBe(true);
  });
  it('draws only when zoomed in near Jiupeng', () => {
    const near = { lat: LAUNCH_ROCKET[0], lng: LAUNCH_ROCKET[1] };
    expect(launchSiteSvg(near, LAUNCH_DRAW_KM * 1.5)).toBe('');
    expect(launchSiteSvg({ lat: 25.04, lng: 121.5 }, 1)).toBe('');
    const svg = launchSiteSvg(near, 0.3);
    expect(svg).toContain('launch-area');
    expect(svg).toContain('launch-rocket parked');
  });
});
