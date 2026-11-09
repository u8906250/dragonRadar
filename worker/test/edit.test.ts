import { describe, expect, it } from 'vitest';
import { keepLocated } from '../src/reports';

describe('補充資料沒改地點：沿用判讀時查到的位置', () => {
  const plan = (place: string, lat: number | null, approx: string | null = null) => ({ group: 0, reason: 'upcoming', plan: { place_text: place, lat, lng: lat === null ? null : 121.5, approx_area: approx } }) as never;
  const act = (place: string, lat: number | null = null) => ({ title: '市集', startAt: 1, endAt: null, place, lat, lng: lat === null ? null : 121.6 });
  it('keeps the coordinates when the place text is the same (newlines and spaces as the browser sends them)', () => {
    // 輸入欄的值會拿掉換行（不是換成空白），送出時空白縮成一個
    const [a] = keepLocated([act('迪化街一段32 巷口')], [plan('迪化街一段\n32  巷口', 25.05)]);
    expect([a.lat, a.lng]).toEqual([25.05, 121.5]);
  });
  it('looks the place up again when it was changed, pinned, or only located to a district', () => {
    expect(keepLocated([act('大稻埕碼頭')], [plan('迪化街', 25.05)])[0].lat).toBeNull();
    expect(keepLocated([act('迪化街', 25.1)], [plan('迪化街', 25.05)])[0].lat).toBe(25.1);
    expect(keepLocated([act('大同區')], [plan('大同區', 25.06, '大同區')])[0].lat).toBeNull();
    expect(keepLocated([act('迪化街')], [plan('迪化街', null)])[0].lat).toBeNull();
  });
});
