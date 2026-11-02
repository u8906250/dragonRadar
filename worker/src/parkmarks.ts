/**
 * 中山公園的標記：管理者在 3D 公園裡標的路燈、長椅、垃圾桶等真的位置（只有管理 token 能讀寫，之後畫進雷達、3D 公園）
 */
import type { Env } from './env';

export const PARK_MARK_KINDS = {
  lamp: '路燈',
  bench: '長椅',
  bin: '垃圾桶',
  other: '其他',
} as const;
export type ParkMarkKind = keyof typeof PARK_MARK_KINDS;

/** 中山公園附近（公園外框再往外約 100 公尺）：標在這外面的不收 */
export const PARK_BOX = { south: 25.0368, north: 25.0420, west: 121.5567, east: 121.5625 } as const;
const NOTE_MAX = 60;
/** 最多存幾個（防呆） */
export const PARK_MARK_MAX = 3000;

export interface ParkMarkInput {
  kind: ParkMarkKind;
  lat: number;
  lng: number;
  heading: number;
  note: string | null;
}
export interface ParkMark extends ParkMarkInput {
  id: number;
  created_at: number;
  updated_at: number;
}

const isKind = (v: unknown): v is ParkMarkKind => typeof v === 'string' && Object.prototype.hasOwnProperty.call(PARK_MARK_KINDS, v);

/** 檢查送來的標記：種類、在公園附近的經緯度、面向（0～360，沒給是 0）、備註（最多 60 字，空的是 null）；不對回傳錯誤訊息 */
export function parseParkMark(body: unknown): ParkMarkInput | string {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isKind(b.kind)) return `kind must be one of ${Object.keys(PARK_MARK_KINDS).join(', ')}`;
  const { lat, lng } = b;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return 'lat and lng are required';
  if (lat < PARK_BOX.south || lat > PARK_BOX.north || lng < PARK_BOX.west || lng > PARK_BOX.east) return 'not in 中山公園';
  const h = b.heading ?? 0;
  if (typeof h !== 'number' || !Number.isFinite(h)) return 'heading must be a number';
  const note = typeof b.note === 'string' ? [...b.note.replace(/\s+/g, ' ').trim()].slice(0, NOTE_MAX).join('') || null : null;
  return { kind: b.kind, lat: Math.round(lat * 1e7) / 1e7, lng: Math.round(lng * 1e7) / 1e7, heading: Math.round((((h % 360) + 360) % 360) * 10) / 10, note };
}

export async function listParkMarks(env: Env): Promise<ParkMark[]> {
  const { results } = await env.DB.prepare('SELECT id, kind, lat, lng, heading, note, created_at, updated_at FROM park_marks ORDER BY id').all<ParkMark>();
  return results ?? [];
}

export async function addParkMark(env: Env, m: ParkMarkInput, now: number): Promise<ParkMark | null> {
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM park_marks').first<{ n: number }>();
  if ((n?.n ?? 0) >= PARK_MARK_MAX) return null;
  const r = await env.DB.prepare('INSERT INTO park_marks (kind, lat, lng, heading, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(m.kind, m.lat, m.lng, m.heading, m.note, now, now)
    .first<{ id: number }>();
  return r ? { ...m, id: r.id, created_at: now, updated_at: now } : null;
}

/** 改一個標記（整個換掉：種類、位置、面向、備註）；找不到回傳 null */
export async function updateParkMark(env: Env, id: number, m: ParkMarkInput, now: number): Promise<ParkMark | null> {
  return await env.DB.prepare('UPDATE park_marks SET kind = ?, lat = ?, lng = ?, heading = ?, note = ?, updated_at = ? WHERE id = ? RETURNING id, kind, lat, lng, heading, note, created_at, updated_at')
    .bind(m.kind, m.lat, m.lng, m.heading, m.note, now, id)
    .first<ParkMark>();
}

export async function deleteParkMark(env: Env, id: number): Promise<boolean> {
  const r = await env.DB.prepare('DELETE FROM park_marks WHERE id = ?').bind(id).run();
  return (r.meta?.changes ?? 0) > 0;
}
