import type { Env } from '../env';

/**
 * 新聞、Threads、使用者貼的連結講的如果是官方車掃，就併進官方那一場（events.merged_into = 官方貼文 id），
 * 不再單獨顯示，原文連結改列在官方那一場的「相關報導」。
 *
 * 判斷條件（全部符合）：
 * 1. 類型是活動（發放不合併，就算在同一個公園）
 * 2. 標題或內文提到車掃（車掃、掃街、大洋流號、洋流號、市政開講）
 * 3. 跟官方航線某一站同一天（台北時間）
 * 4. 地點對得上：提到那一站的行政區（松山、信義、松信）或路線上的地名（五分埔、民權公園、加油點），
 *    或座標在路線 1.5 km 內
 */

const PARADE_WORDS = /車掃|掃街|大洋流號|洋流號|市政開講/;
const TAIPEI_DISTRICTS = ['松山', '信義', '大安', '中山', '中正', '大同', '萬華', '文山', '南港', '內湖', '士林', '北投'];
const NEAR_KM = 1.5;

export interface OfficialStop {
  postId: string;
  /** YYYY-MM-DD */
  date: string;
  /** 行政區、簡稱、路線上的地名 */
  names: string[];
  /** 路線或各站的座標 */
  points: Array<[number, number]>;
}

export interface Candidate {
  id: number;
  kind: string;
  title: string;
  placeText: string;
  text: string;
  startAt: number;
  lat: number | null;
  lng: number | null;
}

export const taipeiDate = (unix: number): string => new Date((unix + 8 * 3600) * 1000).toISOString().slice(0, 10);

/** 官方航線貼文的行政區與地名：「台北大洋流 松山信義艦隊 車掃」→ 松山、信義、松信、松山信義 */
export function stopNames(postText: string, placeTexts: string[]): string[] {
  const names = new Set<string>();
  const fleet = /台北大洋流\s*(\S+?)艦隊/.exec(postText)?.[1] ?? '';
  const districts = TAIPEI_DISTRICTS.filter((d) => fleet.includes(d));
  if (fleet) names.add(fleet);
  for (const d of districts) names.add(d);
  if (districts.length > 1) names.add(districts.map((d) => d[0]).join(''));
  // 各站地名：「張文潔服務處（中坡南路277號）」→ 張文潔服務處、張文潔
  for (const p of placeTexts) {
    const name = p.replace(/（.*$/, '').trim();
    if (name.length >= 2) names.add(name);
    const person = name.replace(/(加油點|加油站|服務處)$/, '');
    if (person !== name && person.length >= 2) names.add(person);
  }
  // 官方路線經過的路名（「中坡北路」這種三個字以上的才算，太短容易誤中）
  const route = /路線：(.+)/.exec(postText)?.[1] ?? '';
  for (const step of route.split('→')) {
    const s = step.replace(/（.*$/, '').trim();
    if (s.length >= 3) names.add(s);
  }
  return [...names];
}

function km(a: [number, number], b: [number, number]): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 這個事件該併進哪一場官方車掃；不是就回傳 null */
export function matchOfficial(c: Candidate, stops: OfficialStop[]): string | null {
  if (c.kind !== 'activity') return null;
  if (!PARADE_WORDS.test(`${c.title}\n${c.text}`)) return null;
  const date = taipeiDate(c.startAt);
  const hay = `${c.title}\n${c.placeText}\n${c.text}`;
  for (const s of stops) {
    if (s.date !== date) continue;
    if (s.names.some((n) => hay.includes(n))) return s.postId;
    if (c.lat !== null && c.lng !== null && s.points.some((p) => km(p, [c.lat as number, c.lng as number]) <= NEAR_KM)) return s.postId;
  }
  return null;
}

/** 讀出近期的官方車掃（今天以後），每一站的地名與路線座標 */
async function loadOfficialStops(env: Env, now: number): Promise<OfficialStop[]> {
  const { results: posts } = await env.DB.prepare("SELECT id, text FROM posts WHERE source = 'official' AND id LIKE 'voyage-%'").all<{ id: string; text: string }>();
  const today = taipeiDate(now);
  const out: OfficialStop[] = [];
  for (const p of posts) {
    const date = /日期：(\d{4}-\d{2}-\d{2})/.exec(p.text)?.[1];
    if (!date || date < today) continue;
    const { results: evs } = await env.DB.prepare('SELECT place_text, lat, lng FROM events WHERE post_id = ?')
      .bind(p.id)
      .all<{ place_text: string; lat: number | null; lng: number | null }>();
    const points: Array<[number, number]> = evs.filter((e) => e.lat !== null && e.lng !== null).map((e) => [e.lat as number, e.lng as number]);
    const route = await env.DB.prepare('SELECT segments FROM routes WHERE post_id = ?').bind(p.id).first<{ segments: string }>();
    if (route) {
      const segs = JSON.parse(route.segments) as Array<{ path: Array<[number, number]> }>;
      // 每 5 個點取 1 個就夠判斷 1.5 km 了
      segs.forEach((s) => s.path.forEach((pt, i) => i % 5 === 0 && points.push(pt)));
    }
    out.push({ postId: p.id, date, names: stopNames(p.text, evs.map((e) => e.place_text)), points });
  }
  return out;
}

/** 重新比對近期的非官方活動，併進官方車掃（或解除錯誤的合併） */
export async function mergeIntoOfficial(env: Env, now: number): Promise<{ checked: number; merged: number; changed: number }> {
  const stops = await loadOfficialStops(env, now);
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.kind, e.title, e.place_text, e.start_at, e.lat, e.lng, e.merged_into, p.text
       FROM events e JOIN posts p ON p.id = e.post_id
      WHERE p.source != 'official' AND e.end_at > ?`,
  )
    .bind(now - 86400)
    .all<{ id: number; kind: string; title: string; place_text: string; start_at: number; lat: number | null; lng: number | null; merged_into: string | null; text: string }>();
  let merged = 0;
  const updates = [];
  for (const r of results) {
    const target = matchOfficial({ id: r.id, kind: r.kind, title: r.title, placeText: r.place_text, text: r.text, startAt: r.start_at, lat: r.lat, lng: r.lng }, stops);
    if (target) merged++;
    if (target !== r.merged_into) updates.push(env.DB.prepare('UPDATE events SET merged_into = ? WHERE id = ?').bind(target, r.id));
  }
  if (updates.length > 0) await env.DB.batch(updates);
  return { checked: results.length, merged, changed: updates.length };
}
