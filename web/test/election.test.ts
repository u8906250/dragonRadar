import { describe, expect, it } from 'vitest';
import { countyLead, loadYear, partyColor, shadeOf, shapeAt, SHAPES, YEARS } from '../src/election';

const winner = async (year: number, county: string): Promise<string> => {
  const d = await loadYear(year);
  const c = d.data.counties.find((x) => x.name === county)!;
  return c.cands[countyLead(c).index][1];
};

describe('政黨雷達的資料', () => {
  it('has all 368 town shapes and every year covers them', async () => {
    expect(SHAPES).toHaveLength(368);
    for (const y of YEARS) {
      const d = await loadYear(y);
      expect(d.data.counties).toHaveLength(22);
      expect(d.towns).toHaveLength(368);
      for (const t of d.towns) expect(t.town.votes).toHaveLength(t.county.cands.length);
    }
  });
  it('finds the town a point is in', async () => {
    const d = await loadYear(2022);
    const at = (lat: number, lng: number): string | undefined => {
      const code = shapeAt(lat, lng)?.code;
      const t = code ? d.byCode.get(code) : undefined;
      return t ? `${t.county.name}${t.town.name}` : undefined;
    };
    expect(at(25.0336, 121.5648)).toBe('臺北市信義區'); // 台北 101
    expect(at(25.0478, 121.517)).toBe('臺北市中正區'); // 台北車站
    expect(at(22.6118, 120.3003)).toBe('高雄市苓雅區'); // 85 大樓
    expect(at(24.8016, 120.9716)).toBe('新竹市東區'); // 新竹火車站
    expect(at(23.5, 122.5)).toBeUndefined(); // 太平洋
  });
  it('uses the official winners for past years', async () => {
    expect(await winner(2018, '臺北市')).toBe('柯文哲');
    expect(await winner(2018, '高雄市')).toBe('韓國瑜');
    expect(await winner(2022, '新竹市')).toBe('高虹安');
    expect(await winner(2022, '嘉義市')).toBe('黃敏惠'); // 12/18 重行選舉
  });
  it('colors by party and shades by share', () => {
    expect(partyColor('民主進步黨')).toBe('#1b9431');
    expect(partyColor('中國國民黨')).toBe('#1f3fb4');
    expect(shadeOf(0.2)).toBeCloseTo(shadeOf(0.35));
    expect(shadeOf(0.9)).toBeCloseTo(shadeOf(0.75));
    expect(shadeOf(0.6)).toBeGreaterThan(shadeOf(0.5));
  });
});
