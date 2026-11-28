import { describe, expect, it } from 'vitest';
import { COUNTIES, countyLead, partyColor, shadeOf, TOWNS, townAt } from '../src/election';

describe('政黨雷達的資料', () => {
  it('has all 368 towns with shapes and votes', () => {
    expect(COUNTIES).toHaveLength(22);
    expect(TOWNS).toHaveLength(368);
    for (const t of TOWNS) {
      expect(t.rings.length).toBeGreaterThan(0);
      expect(t.town.votes).toHaveLength(t.county.cands.length);
    }
  });
  it('finds the town a point is in', () => {
    const at = (lat: number, lng: number): string | undefined => {
      const t = townAt(lat, lng);
      return t ? `${t.county.name}${t.town.name}` : undefined;
    };
    expect(at(25.0336, 121.5648)).toBe('臺北市信義區'); // 台北 101
    expect(at(25.0478, 121.517)).toBe('臺北市中正區'); // 台北車站
    expect(at(22.6118, 120.3003)).toBe('高雄市苓雅區'); // 85 大樓
    expect(at(24.1477, 120.6736)).toBe('臺中市西區'); // 台中市政府舊址附近
    expect(at(23.5, 122.5)).toBeUndefined(); // 太平洋
  });
  it('colors by party and shades by share', () => {
    expect(partyColor('民主進步黨')).toBe('#1b9431');
    expect(partyColor('中國國民黨')).toBe('#1f3fb4');
    expect(shadeOf(0.2)).toBeCloseTo(shadeOf(0.35));
    expect(shadeOf(0.9)).toBeCloseTo(shadeOf(0.75));
    expect(shadeOf(0.6)).toBeGreaterThan(shadeOf(0.5));
  });
  it('picks the county winner from the county totals', () => {
    const tpe = COUNTIES.find((c) => c.name === '臺北市')!;
    const lead = countyLead(tpe);
    expect(tpe.cands[lead.index][3]).toBe(Math.max(...tpe.cands.map((c) => c[3])));
    expect(lead.done).toBe(tpe.sent >= tpe.total);
  });
});
