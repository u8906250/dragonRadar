/**
 * 使用者貼上的 OPENTIX 兩廳院文化生活（售票）活動頁（v1.591，使用者測過 Peatix、Beclass、OPENTIX 後選了先做 OPENTIX）：
 * robots.txt 允許，頁面裡每一場各附一個 schema.org Event（巡演每個地點一場，eventpage.ts），時間沒寫時區（當成台灣時間）。
 * 活動頁網址是 /event/編號
 */
import { fetchEventPage, type PageFetch } from './eventpage';

const EVENT_RE = /https?:\/\/(?:www\.)?opentix\.life\/event\/(\d{10,30})/i;

export type OpentixLink = { id: string };

/** 從貼上的文字找出 OPENTIX 的活動頁 */
export function parseOpentixUrl(input: string): OpentixLink | null {
  const e = EVENT_RE.exec(input);
  return e ? { id: e[1] } : null;
}

export const opentixPermalink = (id: string): string => `https://www.opentix.life/event/${id}`;

/** 讀活動頁：每一場都收 */
export function fetchOpentix(link: OpentixLink): Promise<PageFetch> {
  return fetchEventPage(opentixPermalink(link.id), () => link.id, true);
}
