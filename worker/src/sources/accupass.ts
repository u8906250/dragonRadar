/**
 * 使用者貼上的 ACCUPASS 活動通活動頁（v1.590，使用者問「除了 Threads 還有什麼有確實來源的活動」選了先做活動通）：
 * robots.txt 允許讀活動頁，頁面裡附 schema.org 的 Event 資料（名稱、開始結束時間、地點地址、活動狀態、線上或實體），
 * 時間地點照這份資料，不用 AI 猜。活動頁網址是 /event/編號；分享的短網址 /go/xxx 會轉到活動頁。
 */
import { decodeEntities } from './text';

const UA = 'Mozilla/5.0 (compatible; CurrentRadar/1.0; +https://current-radar.pages.dev)';
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

export interface AccupassEvent {
  id: string;
  name: string;
  /** ISO 時間（帶時區） */
  startDate: string | null;
  endDate: string | null;
  /** 活動通標成取消 */
  cancelled: boolean;
  /** 只有線上（沒有實體地點） */
  online: boolean;
  /** 場地名稱、地址（地址前面的「台灣」拿掉） */
  venue: string | null;
  address: string | null;
  organizer: string | null;
  description: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? decodeEntities(v).replace(/\s+/g, ' ').trim() : null);

/** 地址可能是字串，也可能是 PostalAddress（郵遞區號、縣市、街道分開） */
function addressOf(a: unknown): string | null {
  if (typeof a === 'string') return str(a);
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  const parts = [o.addressRegion, o.addressLocality, o.streetAddress].map(str).filter(Boolean);
  return parts.length ? parts.join('') : null;
}

/** 活動頁的 HTML → 活動資料（頁面裡沒有 Event 資料回傳 null） */
export function parseAccupassHtml(html: string, id: string): AccupassEvent | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const list = Array.isArray(data) ? data : [data];
    const ev = list.find((d): d is Record<string, unknown> => !!d && typeof d === 'object' && (d as Record<string, unknown>)['@type'] === 'Event');
    if (!ev) continue;
    const name = str(ev.name);
    if (!name) return null;
    const locs = (Array.isArray(ev.location) ? ev.location : [ev.location]).filter((l): l is Record<string, unknown> => !!l && typeof l === 'object');
    const place = locs.find((l) => l['@type'] !== 'VirtualLocation');
    const mode = String(ev.eventAttendanceMode ?? '');
    const address = place ? addressOf(place.address)?.replace(/^(?:台灣|臺灣)\s*/, '') ?? null : null;
    const venue = place ? str(place.name) : null;
    const org = ev.organizer && typeof ev.organizer === 'object' ? str((ev.organizer as Record<string, unknown>).name) : null;
    return {
      id,
      name,
      startDate: str(ev.startDate),
      endDate: str(ev.endDate),
      cancelled: /EventCancelled/i.test(String(ev.eventStatus ?? '')),
      online: /OnlineEventAttendanceMode/i.test(mode) || (!place && locs.length > 0),
      venue,
      address,
      organizer: org,
      description: (typeof ev.description === 'string' ? decodeEntities(ev.description) : '').trim().slice(0, 1500),
    };
  }
  return null;
}

export type AccupassFetch = { status: 'ok'; event: AccupassEvent } | { status: 'gone' } | { status: 'error'; message: string };

/** 讀活動頁（短網址先轉到活動頁）：404、410 是活動頁不見了 */
export async function fetchAccupass(link: AccupassLink): Promise<AccupassFetch> {
  try {
    const url = 'id' in link ? accupassPermalink(link.id) : `https://www.accupass.com/go/${link.go}`;
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow' });
    if (res.status === 404 || res.status === 410) return { status: 'gone' };
    if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
    const html = await res.text();
    const id = 'id' in link ? link.id : (EVENT_RE.exec(res.url)?.[1] ?? /<link rel="canonical" href="https?:\/\/(?:www\.)?accupass\.com\/event\/(\d{10,30})"/i.exec(html)?.[1]);
    if (!id) return { status: 'gone' };
    const event = parseAccupassHtml(html, id);
    return event ? { status: 'ok', event } : { status: 'gone' };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

/** 「11/22 13:45」：台北時間 */
function when(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

/**
 * 存成貼文的內文（雷達詳細資料的摘錄、AI 判斷分類和關鍵字用，重讀時跟這個比有沒有改）：名稱、時間、地點、主辦，加上活動介紹
 */
export function accupassText(ev: AccupassEvent): string {
  const where = [ev.venue, ev.address].filter(Boolean).join('　');
  const time = [when(ev.startDate), when(ev.endDate)].filter(Boolean).join(' – ');
  return [ev.name, time ? `時間：${time}` : '', where ? `地點：${where}` : '', ev.organizer ? `主辦：${ev.organizer}` : '', ev.description].filter(Boolean).join('\n');
}
