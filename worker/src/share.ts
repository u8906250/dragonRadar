import type { Env } from './env';
import { DEFAULT_MODULE } from './modules';

/**
 * 分享活動的連結（current-radar.pages.dev/e/編號，網站的 Pages Functions 拿這個做 LINE、Threads 的預覽卡片；v1.688 使用者說的）。
 * 還在雷達上的才給標題、時間、地點（跟 /api/events 給的一樣是公開的）；結束、下架、刪掉的只說結束了，不再透露內容
 */
export interface ShareInfo {
  /** 打開時要選的那一則：固定據點這個時段過了，換成同一個據點下一個還沒結束的時段 */
  id: number;
  module: string;
  ended: boolean;
  title?: string;
  kind?: string;
  topic?: string | null;
  startAt?: number;
  endAt?: number;
  allDay?: boolean;
  endOpen?: boolean;
  spot?: boolean;
  tz?: string | null;
  placeText?: string;
}

interface ShareRow {
  id: number;
  post_id: string;
  kind: string | null;
  title: string;
  start_at: number;
  end_at: number;
  all_day: number | null;
  end_open: number | null;
  spot: number | null;
  tz: string | null;
  place_text: string;
  status: string;
  extra: string | null;
  merged_into: string | null;
  lat: number | null;
  module: string | null;
}

const SHARE_SELECT = `SELECT e.id, e.post_id, e.kind, e.title, e.start_at, e.end_at, e.all_day, e.end_open, e.spot, e.tz, e.place_text, e.status, e.extra, e.merged_into, e.lat, p.module
  FROM events e JOIN posts p ON p.id = e.post_id`;

/** 跟雷達上列出來的條件一樣（listEvents） */
const listed = (r: ShareRow, now: number): boolean => (r.status === 'upcoming' || r.status === 'active') && r.end_at > now && r.lat !== null && r.merged_into === null;

const topicOf = (extra: string | null): string | null => {
  try {
    const t = extra ? (JSON.parse(extra) as { topic?: unknown }).topic : null;
    return typeof t === 'string' ? t : null;
  } catch {
    return null;
  }
};

export async function shareInfo(env: Env, id: number, now: number): Promise<ShareInfo | null> {
  let r = await env.DB.prepare(`${SHARE_SELECT} WHERE e.id = ?`).bind(id).first<ShareRow>();
  if (!r) return null;
  if (!listed(r, now) && r.spot === 1) {
    const next = await env.DB.prepare(
      `${SHARE_SELECT} WHERE e.post_id = ? AND e.place_text = ? AND e.spot = 1 AND e.status IN ('upcoming', 'active') AND e.end_at > ? AND e.lat IS NOT NULL AND e.merged_into IS NULL ORDER BY e.start_at ASC LIMIT 1`,
    )
      .bind(r.post_id, r.place_text, now)
      .first<ShareRow>();
    if (next) r = next;
  }
  const module = r.module ?? DEFAULT_MODULE;
  if (!listed(r, now)) return { id: r.id, module, ended: true };
  return {
    id: r.id,
    module,
    ended: false,
    title: r.title,
    kind: r.kind ?? 'giveaway',
    topic: topicOf(r.extra),
    startAt: r.start_at,
    endAt: r.end_at,
    allDay: r.all_day === 1,
    endOpen: r.end_open === 1,
    spot: r.spot === 1,
    tz: r.tz,
    placeText: r.place_text,
  };
}
