import { describe, expect, it } from 'vitest';
import { normalizeFood } from '../src/food';
import { detectEnded } from '../src/events';

describe('normalizeFood', () => {
  it('reads a weekly food truck as a vendor spot', () => {
    const r = normalizeFood({
      is_event: true,
      events: [{ role: 'vendor', title: '阿明炸雞餐車（大安森林公園）', shop: '阿明炸雞', food: '炸雞、薯條', price: '一份 120 元', hours: '11-20', start_at: '2026-10-24T11:00:00+08:00', end_at: '2026-10-24T14:00:00+08:00', place_text: '大安森林公園 2 號出口', place_query: '台北市 大安森林公園', spot: true, weekdays: [6], until: null, slots: '缺 1', contact: 'dm', confidence: 0.9 }],
    });
    expect(r?.events[0]).toMatchObject({ kind: 'food', item: '炸雞、薯條', spot: true, weekdays: [6], start_at: '2026-10-24T11:00:00+08:00' });
    // 出攤沒有營業時間、缺幾人、報名方式
    expect(r?.events[0].extra).toEqual({ role: 'vendor', shop: '阿明炸雞', food: '炸雞、薯條', price: '一份 120 元', hours: null, slots: null, contact: null });
  });
  it('drops times from recommendations and keeps meetup details', () => {
    const r = normalizeFood({
      is_event: true,
      events: [
        { role: 'recommend', title: '阿城鵝肉推薦鵝肉麵', shop: '阿城鵝肉', food: '鵝肉麵', price: null, hours: '11:00-20:00', start_at: '2026-10-22T12:00:00+08:00', end_at: null, place_text: '阿城鵝肉 吉林路', place_query: '台北市 阿城鵝肉', spot: true, weekdays: null, until: null, slots: null, contact: null, confidence: 0.8 },
        { role: 'meetup', title: '今晚揪吃火鍋', shop: null, food: '火鍋', price: '人均 500', hours: null, start_at: '2026-10-22T19:00:00+08:00', end_at: null, place_text: '台北車站附近', place_query: '台北市 台北車站', spot: false, weekdays: null, until: null, slots: '缺 2 人', contact: 'DM', confidence: 0.8 },
      ],
    });
    expect(r?.events[0]).toMatchObject({ start_at: null, spot: false, extra: { role: 'recommend', hours: '11:00-20:00' } });
    expect(r?.events[1]).toMatchObject({ start_at: '2026-10-22T19:00:00+08:00', extra: { role: 'meetup', slots: '缺 2 人', contact: 'dm' } });
  });
});

describe('detectEnded for food', () => {
  it('sees a vendor skipping today or a full meetup', () => {
    expect(detectEnded('下雨今天不出攤，抱歉')).toBe(true);
    expect(detectEnded('火鍋揪滿了，謝謝')).toBe(true);
  });
});
