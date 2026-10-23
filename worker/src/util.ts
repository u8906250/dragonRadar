export const nowSec = (): number => Math.floor(Date.now() / 1000);

const taipeiFmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 給 LLM 看的台北時間字串 */
export function formatTaipei(unix: number): string {
  return `${taipeiFmt.format(new Date(unix * 1000))} (Asia/Taipei, UTC+8)`;
}

/**
 * 把 ISO 字串轉成 unix 秒。
 * 容許 "2025-10-17 15:00"（視為 +08:00）與 "+0800" 這種沒有冒號的時區。
 */
export function parseIsoToUnix(s: string | null | undefined): number | null {
  if (!s) return null;
  let t = s.trim();
  const bare = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$/.exec(t);
  if (bare) t = `${bare[1]}T${bare[2]}${bare[3] ?? ':00'}+08:00`;
  t = t.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** If-None-Match 有沒有對到（可能好幾個、可能被 Cloudflare 改成弱 ETag 的 W/） */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const bare = (t: string): string => t.trim().replace(/^W\//, '');
  return header.split(',').some((t) => t.trim() === '*' || bare(t) === bare(etag));
}
