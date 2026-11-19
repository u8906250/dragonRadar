import { describe, expect, it } from 'vitest';
import { cleanSlots, parseHours } from '../src/hours';

/** 每天的時段寫成「1:11:00-20:00」好比對 */
const fmt = (s: ReturnType<typeof parseHours>): string[] =>
  (s ?? []).map(([d, a, b]) => `${d}:${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}-${String(Math.floor(b / 60)).padStart(2, '0')}:${String(b % 60).padStart(2, '0')}`);

describe('parseHours', () => {
  it('每天同一個時段', () => {
    expect(fmt(parseHours('11:00-20:00'))).toEqual([1, 2, 3, 4, 5, 6, 7].map((d) => `${d}:11:00-20:00`));
    expect(fmt(parseHours('每日 11：00～20：00'))).toHaveLength(7);
  });
  it('週一公休', () => {
    expect(fmt(parseHours('11:00-20:00，週一公休'))).toEqual([2, 3, 4, 5, 6, 7].map((d) => `${d}:11:00-20:00`));
    expect(fmt(parseHours('週二至週日 11:00–20:00（週一公休）'))).toEqual([2, 3, 4, 5, 6, 7].map((d) => `${d}:11:00-20:00`));
    expect(fmt(parseHours('11:00-20:00 公休日：週一、週二'))).toEqual([3, 4, 5, 6, 7].map((d) => `${d}:11:00-20:00`));
    expect(fmt(parseHours('11:00-20:00 每週三休'))).toEqual([1, 2, 4, 5, 6, 7].map((d) => `${d}:11:00-20:00`));
  });
  it('平日、假日不一樣', () => {
    expect(fmt(parseHours('平日 0930-2030 假日 1000-1800'))).toEqual([...[1, 2, 3, 4, 5].map((d) => `${d}:09:30-20:30`), '6:10:00-18:00', '7:10:00-18:00']);
    expect(fmt(parseHours('週一至週五 11:00-14:00、17:00-21:00\n週六日 11:00-21:00'))).toEqual([
      ...[1, 2, 3, 4, 5].flatMap((d) => [`${d}:11:00-14:00`, `${d}:17:00-21:00`]),
      '6:11:00-21:00',
      '7:11:00-21:00',
    ]);
  });
  it('沒寫的星期幾照「其他天」', () => {
    expect(fmt(parseHours('11:00-20:00，週六 10:00-22:00'))).toEqual([...[1, 2, 3, 4, 5].map((d) => `${d}:11:00-20:00`), '6:10:00-22:00', '7:11:00-20:00']);
  });
  it('開到半夜以後', () => {
    expect(fmt(parseHours('週二～週六 18:00-02:00'))).toEqual([2, 3, 4, 5, 6].map((d) => `${d}:18:00-26:00`));
    expect(fmt(parseHours('晚上 6 點到 10 點'))).toHaveLength(7);
    expect(parseHours('晚上 6 點到 10 點')?.[0]).toEqual([1, 18 * 60, 22 * 60]);
    expect(parseHours('下午2點-晚上12點')?.[0]).toEqual([1, 14 * 60, 24 * 60]);
  });
  it('24 小時', () => {
    expect(parseHours('24小時營業')).toEqual([1, 2, 3, 4, 5, 6, 7].map((d) => [d, 0, 1440]));
  });
  it('午休從時段扣掉', () => {
    expect(fmt(parseHours('週一至週五 09:00-18:00，12:00-13:00 休息'))).toEqual([1, 2, 3, 4, 5].flatMap((d) => [`${d}:09:00-12:00`, `${d}:13:00-18:00`]));
    expect(fmt(parseHours('10:00-21:00 午休 14:00-17:00'))[0]).toBe('1:10:00-14:00');
  });
  it('讀不懂的是 null', () => {
    expect(parseHours('週一公休')).toBeNull();
    expect(parseHours('營業到賣完為止')).toBeNull();
    expect(parseHours('')).toBeNull();
    expect(parseHours('電話 02-2345-6789')).toBeNull();
  });
  it('存起來的時段', () => {
    expect(cleanSlots([[1, 660, 1200], [8, 0, 10], 'x', [2, 1300, 1200]])).toEqual([[1, 660, 1200]]);
    expect(cleanSlots(null)).toBeNull();
  });
});
