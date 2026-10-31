/** 台北大洋流「車掃地圖」（認領路段用）的公開資料：當天車掃的時間、實際路徑與各路段認領人數 */
export const CURRENT_MAP_URL = 'https://current-map.puma.taipei/';
const UA = 'Mozilla/5.0 (compatible; CurrentRadar/1.0; +https://current-radar.pages.dev)';

export type LatLngPair = [number, number];

export interface MapSegment {
  seq: number;
  from: string;
  to: string;
  path: LatLngPair[];
  lengthM: number;
  people: number;
  target: number;
}

export interface CurrentMapRoute {
  slug: string;
  /** YYYY-MM-DD，取自活動代碼 */
  date: string;
  name: string;
  /** 車掃出發、抵達終點的時間（unix 秒），頁面沒寫就是 null */
  depart: number | null;
  arrive: number | null;
  /** 抵達後在終點的活動，例如「市政開講 18:30–20:30 · 民權公園」 */
  after: { name: string; start: number; end: number; place: string } | null;
  segments: MapSegment[];
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

function at(date: string, hm: string): number {
  const [h, m] = hm.split(':');
  return Math.floor(Date.parse(`${date}T${h.padStart(2, '0')}:${m}:00+08:00`) / 1000);
}

/** 從頁面文字找出「車掃 17:30–18:30」和「🎤 市政開講 18:30–20:30 · 民權公園」 */
export function parseMapPage(html: string): { segmentsUrl: string; slug: string; date: string; name: string; times: Pick<CurrentMapRoute, 'depart' | 'arrive' | 'after'> } | null {
  const url = /data-segments-url="([^"]+)"/.exec(html)?.[1];
  const slug = url ? /\/events\/([^/]+)\/segments/.exec(url)?.[1] : undefined;
  const date = slug ? /^(\d{4}-\d{2}-\d{2})/.exec(slug)?.[1] : undefined;
  if (!url || !slug || !date) return null;
  const text = stripHtml(html);
  const name = /<title>([^｜|<]+)/.exec(html)?.[1].trim() ?? '車掃';
  const dash = '[–—~～-]';
  const parade = new RegExp(`車掃\\s*(\\d{1,2}:\\d{2})\\s*${dash}\\s*(\\d{1,2}:\\d{2})`).exec(text);
  const after = new RegExp(`(?:🎤\\s*)?([\\p{Script=Han}]{2,8})\\s*(\\d{1,2}:\\d{2})\\s*${dash}\\s*(\\d{1,2}:\\d{2})\\s*[·・]\\s*([^\\s，。]+)`, 'u').exec(text);
  return {
    segmentsUrl: url,
    slug,
    date,
    name,
    times: {
      depart: parade ? at(date, parade[1]) : null,
      arrive: parade ? at(date, parade[2]) : null,
      after: after && after[1] !== '車掃' ? { name: after[1], start: at(date, after[2]), end: at(date, after[3]), place: after[4] } : null,
    },
  };
}

interface RawSegment {
  seq?: number;
  from?: string;
  to?: string;
  path?: LatLngPair[];
  length_m?: number;
  people?: number;
  target?: number;
}

/** url：車掃地圖的哪一頁（首頁是最近的一場；每一場自己的頁面是 /e/2026-11-01-daan-wenshan 這種，可以先抓之後的場次） */
export async function fetchCurrentMap(url = CURRENT_MAP_URL): Promise<CurrentMapRoute | null> {
  const page = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' } });
  if (!page.ok) throw new Error(`current-map HTTP ${page.status}`);
  const info = parseMapPage(await page.text());
  if (!info) return null;
  const r = await fetch(info.segmentsUrl, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!r.ok) throw new Error(`segments HTTP ${r.status}`);
  const raw = ((await r.json()) as { segments?: RawSegment[] }).segments ?? [];
  const segments: MapSegment[] = raw
    .filter((s) => Array.isArray(s.path) && s.path.length >= 2)
    .map((s, i) => ({
      seq: s.seq ?? i + 1,
      from: s.from ?? '',
      to: s.to ?? '',
      path: s.path!.map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5] as LatLngPair),
      lengthM: s.length_m ?? 0,
      people: s.people ?? 0,
      target: s.target ?? 0,
    }))
    .sort((a, b) => a.seq - b.seq);
  if (segments.length === 0) return null;
  return { slug: info.slug, date: info.date, name: info.name, ...info.times, segments };
}

const toRad = (d: number): number => (d * Math.PI) / 180;

function distM(a: LatLngPair, b: LatLngPair): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 整條路線串成一條線，附上每個點從起點算起的累計距離（公尺） */
export function routeLine(segments: MapSegment[]): { pts: LatLngPair[]; cum: number[] } {
  const pts: LatLngPair[] = [];
  for (const s of segments) {
    for (const p of s.path) {
      const last = pts[pts.length - 1];
      if (last && last[0] === p[0] && last[1] === p[1]) continue;
      pts.push(p);
    }
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distM(pts[i - 1], pts[i]));
  return { pts, cum };
}

/**
 * 把一個點投影到路線上，回傳最近的位置與累計距離。
 * fromM：只找這個距離之後的部分（路線會重複經過同一條路，例如松山路，照順序找才不會對錯段）。
 */
export function projectOnRoute(line: { pts: LatLngPair[]; cum: number[] }, p: LatLngPair, fromM = 0): { at: LatLngPair; m: number; offM: number } | null {
  const { pts, cum } = line;
  const kx = Math.cos(toRad(p[0])) * 111320;
  const ky = 110540;
  let best: { at: LatLngPair; m: number; offM: number } | null = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    if (cum[i + 1] < fromM) continue;
    const ax = pts[i][1] * kx;
    const ay = pts[i][0] * ky;
    const bx = pts[i + 1][1] * kx;
    const by = pts[i + 1][0] * ky;
    const px = p[1] * kx;
    const py = p[0] * ky;
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2)) : 0;
    const qx = ax + t * (bx - ax);
    const qy = ay + t * (by - ay);
    const off = Math.hypot(px - qx, py - qy);
    const m = cum[i] + t * (cum[i + 1] - cum[i]);
    if (m < fromM) continue;
    if (!best || off < best.offM) best = { at: [qy / ky, qx / kx], m, offM: off };
  }
  return best;
}

/** 路段的擁擠程度，跟車掃地圖的顏色一致：沒人、缺人（未達 6 成）、快滿、已滿 */
export function crowdLevel(people: number, target: number): 'empty' | 'low' | 'mid' | 'full' {
  if (people === 0) return 'empty';
  const r = target > 0 ? people / target : 1;
  return r >= 1 ? 'full' : r >= 0.6 ? 'mid' : 'low';
}
