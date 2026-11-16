/**
 * 使用者貼上的 Peatix 活動頁（v1.735，使用者說先做 Peatix）：robots.txt 允許讀活動頁（/event/*，Crawl-delay 1 秒），API（/v3/、/v4/）不能讀。
 * 頁面裡附一份 schema.org Event 的 microdata（不是 JSON-LD）：名稱、開始時間（沒寫時區）、場地名稱、地址、經緯度；
 * 沒有結束時間（雷達照「沒寫結束」排，顯示到開始後兩小時）、沒有取消狀態，介紹只有 meta description 那一小段。
 * 時間沒寫時區：只收經緯度在台灣（含金馬澎湖）的，當台灣時間；線上的（沒有地址、經緯度）不收。
 * 活動頁網址 peatix.com/event/編號，也有 /us/event/編號、主辦的子網域
 */
import { PAGE_UA, type EventPage, type PageFetch, type PageSession } from './eventpage';
import { decodeEntities } from './text';

const EVENT_RE = /https?:\/\/(?:[a-z0-9-]+\.)?peatix\.com\/(?:[a-z]{2}\/)?event\/(\d{4,12})(?!\d)/i;

export type PeatixLink = { id: string };

/** 從貼上的文字找出 Peatix 的活動頁 */
export function parsePeatixUrl(input: string): PeatixLink | null {
  const e = EVENT_RE.exec(input);
  return e ? { id: e[1] } : null;
}

export const peatixPermalink = (id: string): string => `https://peatix.com/event/${id}`;

/** 台灣（本島、金門、馬祖、澎湖、綠島、蘭嶼）的範圍：在這裡面的才當台灣時間 */
const TAIWAN = { s: 21.8, w: 118.1, n: 26.5, e: 122.2 };

const text = (v: string | undefined): string | null => {
  if (v === undefined) return null;
  // Peatix 的字有時候編碼兩次（「&amp;Ucirc;」）
  const s = decodeEntities(decodeEntities(v)).replace(/\s+/g, ' ').trim();
  return s || null;
};

/**
 * 活動頁的 HTML → 活動資料（一場）。itemtype=Event 那一段裡的 meta itemprop：第一個 name 是活動名稱，
 * location（Place）裡的 name、address 是場地，geo 是經緯度；票種（offers）的 name 不算。沒有 Event 回傳 null
 */
export function parsePeatixPage(html: string, id: string): EventPage | null {
  const at = html.search(/itemtype="https?:\/\/schema\.org\/Event"/i);
  if (at < 0) return null;
  const block = html.slice(at, at + 20000);
  const place = /itemprop="location"[^>]*itemtype="https?:\/\/schema\.org\/Place"/i.exec(block);
  const offers = block.search(/itemprop="offers"/i);
  const props = (part: string): Array<[string, string]> => [...part.matchAll(/<meta\s+itemprop="(\w+)"\s+content="([^"]*)"/gi)].map((m) => [m[1], m[2]]);
  const head = props(place ? block.slice(0, place.index) : offers >= 0 ? block.slice(0, offers) : block);
  const loc = place ? props(block.slice(place.index, offers > place.index ? offers : undefined)) : [];
  const get = (list: Array<[string, string]>, key: string): string | undefined => list.find(([k]) => k === key)?.[1];
  const name = text(get(head, 'name'));
  if (!name) return null;
  const lat = Number(get(loc, 'latitude'));
  const lng = Number(get(loc, 'longitude'));
  const geo = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
  const address = text(get(loc, 'address'))?.replace(/^(?:台灣|臺灣|Taiwan)[\s,]*/i, '') ?? null;
  const session: PageSession = {
    name,
    startDate: text(get(head, 'startDate')),
    endDate: text(get(head, 'endDate')),
    cancelled: false,
    // 線上的：場地寫「オンライン」「Online」，沒有地址、經緯度
    online: !address && !geo,
    venue: text(get(loc, 'name')),
    address,
    ...(geo ? { lat, lng } : {}),
    abroad: geo && !(lat >= TAIWAN.s && lat <= TAIWAN.n && lng >= TAIWAN.w && lng <= TAIWAN.e),
  };
  const desc = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(html)?.[1] ?? '';
  const description = (text(desc) ?? '').replace(/\s*powered by Peatix.*$/i, '').slice(0, 1500);
  return { id, name, organizer: null, description, sessions: [session] };
}

/** 讀活動頁：404、410、頁面裡沒有活動資料是不見了 */
export async function fetchPeatix(link: PeatixLink): Promise<PageFetch> {
  try {
    const res = await fetch(peatixPermalink(link.id), { headers: { 'user-agent': PAGE_UA, accept: 'text/html' }, redirect: 'follow' });
    if (res.status === 404 || res.status === 410) return { status: 'gone' };
    if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
    const page = parsePeatixPage(await res.text(), link.id);
    return page ? { status: 'ok', page } : { status: 'gone' };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}
