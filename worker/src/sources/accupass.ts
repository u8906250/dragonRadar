/**
 * 使用者貼上的 ACCUPASS 活動通活動頁（v1.590，使用者問「除了 Threads 還有什麼有確實來源的活動」選了先做活動通）：
 * robots.txt 允許讀活動頁，頁面裡附 schema.org 的 Event 資料（eventpage.ts），時間地點照這份資料。
 * 活動頁網址是 /event/編號；分享的短網址 /go/xxx 會轉到活動頁。
 */
import { fetchEventPage, type PageFetch } from './eventpage';

const EVENT_RE = /https?:\/\/(?:www\.)?accupass\.com\/event\/(\d{10,30})/i;
const GO_RE = /https?:\/\/(?:www\.)?accupass\.com\/go\/([A-Za-z0-9_-]{1,60})/i;

export type AccupassLink = { id: string } | { go: string };

/** 從貼上的文字找出活動通的活動頁或分享短網址 */
export function parseAccupassUrl(input: string): AccupassLink | null {
  const e = EVENT_RE.exec(input);
  if (e) return { id: e[1] };
  const g = GO_RE.exec(input);
  return g ? { go: g[1] } : null;
}

export const accupassPermalink = (id: string): string => `https://www.accupass.com/event/${id}`;

/** 讀活動頁（短網址先轉到活動頁，照轉到的網址或 canonical 認是哪一場）；活動通一頁一場 */
export function fetchAccupass(link: AccupassLink): Promise<PageFetch> {
  const url = 'id' in link ? accupassPermalink(link.id) : `https://www.accupass.com/go/${link.go}`;
  return fetchEventPage(
    url,
    (res, html) => ('id' in link ? link.id : (EVENT_RE.exec(res.url)?.[1] ?? /<link rel="canonical" href="https?:\/\/(?:www\.)?accupass\.com\/event\/(\d{10,30})"/i.exec(html)?.[1] ?? null)),
    false,
  );
}
