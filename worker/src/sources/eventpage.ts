/**
 * 活動頁裡附的 schema.org Event 資料（ACCUPASS 活動通、OPENTIX 兩廳院售票共用，v1.591）：名稱、每一場的開始結束時間、
 * 活動狀態（取消）、實體或線上、場地名稱和地址、主辦、介紹。時間地點照這份資料，不用 AI 猜
 */
import { decodeEntities } from './text';

export const PAGE_UA = 'Mozilla/5.0 (compatible; CurrentRadar/1.0; +https://current-radar.pages.dev)';

/** 一場（OPENTIX 的巡演一個地點一場；活動通是一場） */
export interface PageSession {
  name: string;
  /** ISO 時間；沒寫時區的當成台灣時間（OPENTIX 沒寫） */
  startDate: string | null;
  endDate: string | null;
  cancelled: boolean;
  /** 只有線上（沒有實體地點） */
  online: boolean;
  /** 場地名稱、地址（地址前面的「台灣」拿掉） */
  venue: string | null;
  address: string | null;
}

export interface EventPage {
  /** 網站上的活動編號 */
  id: string;
  name: string;
  organizer: string | null;
  description: string;
  sessions: PageSession[];
}

export type PageFetch = { status: 'ok'; page: EventPage } | { status: 'gone' } | { status: 'error'; message: string };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? decodeEntities(v).replace(/\s+/g, ' ').trim() : null);

/** 地址可能是字串，也可能是 PostalAddress（縣市、區、街道分開） */
function addressOf(a: unknown): string | null {
  if (typeof a === 'string') return str(a);
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  const parts = [o.addressRegion, o.addressLocality, o.streetAddress].map(str).filter(Boolean);
  return parts.length ? parts.join('') : null;
}

/** ISO 時間沒寫時區（「2026-11-22T14:30:00」）：台灣的售票網站，當成台灣時間 */
export const zoned = (iso: string | null): string | null => (iso && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? `${iso}+08:00` : iso);
/** ISO 時間 → unix 秒（看不懂是 NaN） */
export const pageTime = (iso: string | null): number => (iso ? Math.floor(Date.parse(zoned(iso)!) / 1000) : NaN);

function sessionOf(ev: Record<string, unknown>): PageSession | null {
  const name = str(ev.name);
  if (!name) return null;
  const locs = (Array.isArray(ev.location) ? ev.location : [ev.location]).filter((l): l is Record<string, unknown> => !!l && typeof l === 'object');
  const place = locs.find((l) => l['@type'] !== 'VirtualLocation');
  return {
    name,
    startDate: str(ev.startDate),
    endDate: str(ev.endDate),
    cancelled: /EventCancelled/i.test(String(ev.eventStatus ?? '')),
    online: /OnlineEventAttendanceMode/i.test(String(ev.eventAttendanceMode ?? '')) || (!place && locs.length > 0),
    venue: place ? str(place.name) : null,
    address: place ? (addressOf(place.address)?.replace(/^(?:台灣|臺灣)\s*/, '') ?? null) : null,
  };
}

/** 活動頁的 HTML → 活動資料：頁面裡所有的 Event（all 是 false 只取第一個）；沒有回傳 null */
export function parseEventPage(html: string, id: string, all: boolean): EventPage | null {
  const events: Array<Record<string, unknown>> = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    for (const d of Array.isArray(data) ? data : [data]) if (d && typeof d === 'object' && (d as Record<string, unknown>)['@type'] === 'Event') events.push(d as Record<string, unknown>);
  }
  const sessions = (all ? events : events.slice(0, 1)).map(sessionOf).filter((s): s is PageSession => !!s);
  if (sessions.length === 0) return null;
  const first = events[0];
  const org = first.organizer && typeof first.organizer === 'object' ? str((first.organizer as Record<string, unknown>).name) : null;
  return { id, name: sessions[0].name, organizer: org, description: (typeof first.description === 'string' ? decodeEntities(first.description) : '').trim().slice(0, 1500), sessions };
}

/** 「11/22 13:45」：台北時間 */
function when(iso: string | null): string {
  const t = pageTime(iso);
  if (!Number.isFinite(t)) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

/**
 * 存成貼文的內文（雷達詳細資料的摘錄、AI 判斷分類和關鍵字用，重讀時跟這個比有沒有改）：名稱、時間、地點（好幾場的一場一行）、主辦，加上活動介紹
 */
export function eventPageText(page: EventPage): string {
  const time = (s: PageSession): string => [when(s.startDate), when(s.endDate)].filter(Boolean).join(' – ');
  const where = (s: PageSession): string => [s.venue, s.address].filter(Boolean).join('　');
  const lines =
    page.sessions.length === 1
      ? [time(page.sessions[0]) ? `時間：${time(page.sessions[0])}` : '', where(page.sessions[0]) ? `地點：${where(page.sessions[0])}` : '']
      : page.sessions.map((s) => `場次：${[time(s), where(s)].filter(Boolean).join('　')}${s.cancelled ? '（取消）' : ''}`);
  return [page.name, ...lines, page.organizer ? `主辦：${page.organizer}` : '', page.description].filter(Boolean).join('\n');
}

/** 讀活動頁：404、410、頁面裡沒有活動資料是不見了 */
export async function fetchEventPage(url: string, id: (res: Response, html: string) => string | null, all: boolean): Promise<PageFetch> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': PAGE_UA, accept: 'text/html' }, redirect: 'follow' });
    if (res.status === 404 || res.status === 410) return { status: 'gone' };
    if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
    const html = await res.text();
    const key = id(res, html);
    const page = key ? parseEventPage(html, key, all) : null;
    return page ? { status: 'ok', page } : { status: 'gone' };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}
