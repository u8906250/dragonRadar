/**
 * 使用者貼上的 Luma 活動頁（v1.736，使用者看了 Peatix 掃描的結果後說做 Luma）：robots.txt 只限制 Googlebot 讀幾個跟活動無關的路徑，活動頁可以讀。
 * 頁面裡附 schema.org Event（JSON-LD，eventpage.ts）：開始、結束時間帶時區、場地、經緯度、取消、實體或線上、介紹、主辦。
 * 網址 luma.com/代碼 或 lu.ma/代碼；主辦也可以設自訂網址（luma.com/day1taipei），所以先讀一次，照頁面寫的網址認是哪一場。
 * 城市、日曆頁（luma.com/taipei）不是單一活動，讀不到 Event 就當找不到
 */
import { fetchEventPage, type PageFetch } from './eventpage';

/** Luma 自己的頁面（不是活動） */
const NOT_EVENT = new Set(['discover', 'user', 'calendar', 'home', 'signin', 'login', 'signup', 'create', 'explore', 'pricing', 'about', 'settings', 'event', 'events', 'social-share', 'in', 'company', 'download', 'ios', 'android', 'help', 'terms', 'privacy']);
const URL_RE = /https?:\/\/(?:www\.)?(?:lu\.ma|luma\.com)\/([A-Za-z0-9_-]{3,60})(?=$|[/?#\s）)」』,，。])/i;
const PAGE_ID_RE = /https?:\/\/(?:www\.)?(?:lu\.ma|luma\.com)\/([A-Za-z0-9_-]{3,60})/i;

/** 都先讀一次（自訂網址、分享網址轉到同一場）；重讀時用頁面上的代碼 */
export type LumaLink = { go: string } | { id: string };

/** 從貼上的文字找出 Luma 的活動頁 */
export function parseLumaUrl(input: string): LumaLink | null {
  const m = URL_RE.exec(input);
  return m && !NOT_EVENT.has(m[1].toLowerCase()) ? { go: m[1] } : null;
}

export const lumaPermalink = (id: string): string => `https://luma.com/${id}`;

/** 讀活動頁：照活動資料的網址或 canonical 認是哪一場；一頁一場 */
export function fetchLuma(link: LumaLink): Promise<PageFetch> {
  const slug = 'id' in link ? link.id : link.go;
  return fetchEventPage(
    lumaPermalink(slug),
    (res, html) => {
      const ld = /"@type"\s*:\s*"Event"[\s\S]{0,400}?"url"\s*:\s*"(https?:\/\/(?:www\.)?(?:lu\.ma|luma\.com)\/[A-Za-z0-9_-]+)"/.exec(html)?.[1];
      const canonical = /<link rel="canonical" href="([^"]+)"/i.exec(html)?.[1];
      return PAGE_ID_RE.exec(ld ?? canonical ?? res.url)?.[1] ?? slug;
    },
    false,
  );
}
