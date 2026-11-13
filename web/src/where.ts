import { TW_TOWNS } from './places-tw';

/**
 * 一個位置在哪個縣市、鄉鎮市區：照最近的鄉鎮市區中心（places-tw.ts 的點）估算，邊界附近可能算到隔壁區；
 * 離最近的點超過 40 公里當成國外（回傳 null）。統計頁、雷達統計（後端）共用
 */
export function whereOf(lat: number, lng: number): { county: string; town: string } | null {
  const kx = Math.cos((lat * Math.PI) / 180);
  let best: (typeof TW_TOWNS)[number] | null = null;
  let bd = Infinity;
  for (const t of TW_TOWNS) {
    const d = (t[1] - lat) ** 2 + ((t[2] - lng) * kx) ** 2;
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  if (!best || Math.sqrt(bd) * 111 > 40) return null;
  return { county: best[3], town: best[0] };
}
