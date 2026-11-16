import { describe, expect, it } from 'vitest';
import { splitWeeklyOpenDays, type ExtractedEvent } from '../src/extract';

/** 使用者給的貼文（踏石牙醫診所，2026-11-16 週一 17:41 發文） */
const POST = '補充了兩百條洋流飄帶，以及新一期的順報\n歡迎大家來拿～\n\n台派牙醫診所，洋流好店\n\n【踏石牙醫診所】\n臺北市大安區樂利路42巷2號\n診所Line ID: @zxd5128p\n週一至週五　13:00 - 20:00\n（02）8732-6633';
const tpe = (s: string): number => Date.parse(`${s}+08:00`) / 1000;
const ev = (start: string, end: string): ExtractedEvent => ({
  kind: 'activity', title: '踏石牙醫診所發飄帶', item: null, start_at: `${start}+08:00`, end_at: `${end}+08:00`, place_text: '臺北市大安區樂利路42巷2號', place_query: '臺北市大安區樂利路42巷2號', confidence: 0.9, spot: false, until: null,
});
const days = (list: ExtractedEvent[]): string[] => list.map((e) => `${e.start_at!.slice(5, 16)}–${e.end_at!.slice(11, 16)}`);

describe('splitWeeklyOpenDays', () => {
  it('turns 週一至週五 13:00-20:00 posted on Monday into Monday to Friday', () => {
    const out = splitWeeklyOpenDays([ev('2026-11-16T17:41:00', '2026-11-16T20:00:00')], POST, tpe('2026-11-16T17:41:00'));
    expect(days(out)).toEqual(['11-16T17:41–20:00', '11-17T13:00–20:00', '11-18T13:00–20:00', '11-19T13:00–20:00', '11-20T13:00–20:00']);
  });
  it('posted on Thursday: Thursday, Friday, then Monday to Wednesday of the next week', () => {
    const out = splitWeeklyOpenDays([ev('2026-11-19T13:00:00', '2026-11-19T20:00:00')], POST, tpe('2026-11-19T10:00:00'));
    expect(days(out)).toEqual(['11-19T13:00–20:00', '11-20T13:00–20:00', '11-23T13:00–20:00', '11-24T13:00–20:00', '11-25T13:00–20:00']);
  });
  it('posted on a closed day (Saturday): only the open days, not that day', () => {
    const out = splitWeeklyOpenDays([ev('2026-11-21T15:00:00', '2026-11-21T20:00:00')], POST, tpe('2026-11-21T15:00:00'));
    expect(days(out)).toEqual(['11-23T13:00–20:00', '11-24T13:00–20:00', '11-25T13:00–20:00', '11-26T13:00–20:00', '11-27T13:00–20:00']);
  });
  it('drops the first day when it has already closed', () => {
    const out = splitWeeklyOpenDays([ev('2026-11-16T13:00:00', '2026-11-16T20:00:00')], POST, tpe('2026-11-16T20:30:00'));
    expect(days(out)).toEqual(['11-17T13:00–20:00', '11-18T13:00–20:00', '11-19T13:00–20:00', '11-20T13:00–20:00']);
  });
  it('splits every time slot', () => {
    const text = '每週二、四 11:00-14:00、17:00-20:00 來店領飄帶';
    const out = splitWeeklyOpenDays([ev('2026-11-17T11:00:00', '2026-11-17T14:00:00'), ev('2026-11-17T17:00:00', '2026-11-17T20:00:00')], text, tpe('2026-11-17T09:00:00'));
    expect(days(out)).toEqual(['11-17T11:00–14:00', '11-17T17:00–20:00', '11-19T11:00–14:00', '11-19T17:00–20:00']);
  });
  it('leaves it alone: every day, only today, another date, hours not in the post, routes', () => {
    const one = (): ExtractedEvent[] => [ev('2026-11-16T17:41:00', '2026-11-16T20:00:00')];
    const at = tpe('2026-11-16T17:41:00');
    expect(splitWeeklyOpenDays(one(), '即日起每天 13:00-20:00 歡迎來拿', at)).toHaveLength(1);
    expect(splitWeeklyOpenDays(one(), '只有今天！週一至週五 13:00-20:00 營業', at)).toHaveLength(1);
    expect(splitWeeklyOpenDays(one(), '11/20 限定 週一至週五 13:00-20:00', at)).toHaveLength(1);
    // 時段、星期幾只在帳號簡介（own 不含簡介）
    expect(splitWeeklyOpenDays(one(), '補了飄帶，歡迎來拿', at)).toHaveLength(1);
    expect(splitWeeklyOpenDays(one(), '週一至週五車掃 13:00-20:00', at)).toHaveLength(1);
    // 週一到週日＝每天：照舊只給第一天
    expect(splitWeeklyOpenDays(one(), '週一至週日 13:00 - 20:00', at)).toHaveLength(1);
  });
});
