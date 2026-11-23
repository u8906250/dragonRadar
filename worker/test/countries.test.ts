import { describe, expect, it } from 'vitest';
import { countryName, MAPPED_COUNTRIES, shouldReport } from '../src/countries';

describe('unmapped countries (v1.793)', () => {
  it('reports countries without a radar map, not Taiwan, the mapped ones or China', () => {
    expect(shouldReport('SG')).toBe(true);
    expect(shouldReport('gb')).toBe(true);
    for (const c of ['TW', 'JP', 'KR', 'US', 'NL', 'AU', 'jp', 'CN', null, undefined, '', 'XYZ']) expect(shouldReport(c), String(c)).toBe(false);
    expect([...MAPPED_COUNTRIES].sort()).toEqual(['AU', 'JP', 'KR', 'NL', 'TW', 'US']);
  });
  it('names countries in Traditional Chinese', () => {
    expect(countryName('SG')).toBe('新加坡');
    expect(countryName('DE')).toBe('德國');
  });
});
