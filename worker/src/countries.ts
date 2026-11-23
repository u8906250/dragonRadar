/**
 * 有活動、但雷達還沒畫地圖的國家（v1.793 使用者說只要有活動但沒有畫出的國家地圖就回報管理）：
 * 國外的活動判讀時認得出國家（ISO 兩碼，例如 SG），放上雷達時那個國家不在 MAPPED_COUNTRIES 就記下來（unmapped_countries），
 * 第一次出現的國家推到管理者的手機；管理頁列出來，按「知道了」就收起來、不再推。
 * 只記判讀時認得出國家的（貼文寫了國外地址）；台灣的活動沒有國家。
 */
import type { Env } from './env';
import { pushAdmins } from './push';
import { ReportError } from './reports';

/**
 * 雷達拉遠有畫地圖的國家（海岸線、界線、地名：web/src 的 netherlands.ts、japan.ts、korea.ts、usa-*.ts、australia-*.ts，main.ts 的 REGION_SLOTS）：
 * 再加國家要一起加在這裡。中國故意不畫（只畫虛線海岸），不算
 */
export const MAPPED_COUNTRIES = new Set(['TW', 'NL', 'JP', 'KR', 'US', 'AU']);
const NOT_TO_DRAW = new Set(['CN']);

/** 國名（繁體中文）；執行環境沒有中文的國名就用代碼 */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['zh-Hant-TW'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** 這個國家要不要回報（有國家、不是有畫的、不是故意不畫的） */
export const shouldReport = (country: string | null | undefined): country is string =>
  !!country && /^[A-Za-z]{2}$/.test(country) && !MAPPED_COUNTRIES.has(country.toUpperCase()) && !NOT_TO_DRAW.has(country.toUpperCase());

/** 放上雷達的活動在沒畫地圖的國家：記下來，第一次出現的國家推給管理者（推不出去不影響放上雷達） */
export async function noteCountry(env: Env, country: string | null | undefined, ev: { id: number; title: string; place_text: string }, now: number): Promise<void> {
  if (!shouldReport(country)) return;
  const code = country.toUpperCase();
  const row = await env.DB.prepare(
    `INSERT INTO unmapped_countries (country, events, last_event_id, last_title, last_place, first_at, last_at) VALUES (?, 1, ?, ?, ?, ?, ?)
     ON CONFLICT(country) DO UPDATE SET events = events + 1, last_event_id = excluded.last_event_id, last_title = excluded.last_title, last_place = excluded.last_place, last_at = excluded.last_at
     RETURNING events, dismissed`,
  )
    .bind(code, ev.id, ev.title, ev.place_text, now, now)
    .first<{ events: number; dismissed: number }>();
  if (row?.events !== 1) return;
  const name = countryName(code);
  await pushAdmins(env, { title: `${name}有活動，雷達還沒畫地圖`, body: `${ev.title}（${ev.place_text}）`.slice(0, 80), tag: `country-${code}`, url: './admin.html#countries', renotify: true }, now).catch(() => 0);
}

export interface UnmappedCountry {
  country: string;
  name: string;
  events: number;
  lastEventId: number | null;
  lastTitle: string | null;
  lastPlace: string | null;
  firstAt: number;
  lastAt: number;
  dismissed: boolean;
}

/** 管理頁：還沒畫地圖的國家（最近有活動的在前；已經畫了的不列） */
export async function listUnmapped(env: Env): Promise<UnmappedCountry[]> {
  const { results } = await env.DB.prepare('SELECT * FROM unmapped_countries ORDER BY dismissed, last_at DESC').all<{
    country: string;
    events: number;
    last_event_id: number | null;
    last_title: string | null;
    last_place: string | null;
    first_at: number;
    last_at: number;
    dismissed: number;
  }>();
  return results
    .filter((r) => !MAPPED_COUNTRIES.has(r.country))
    .map((r) => ({
      country: r.country,
      name: countryName(r.country),
      events: r.events,
      lastEventId: r.last_event_id,
      lastTitle: r.last_title,
      lastPlace: r.last_place,
      firstAt: r.first_at,
      lastAt: r.last_at,
      dismissed: !!r.dismissed,
    }));
}

/** 管理頁：「知道了」收起來（之後同一國的活動不再推）、或放回來 */
export async function setCountryDismissed(env: Env, body: unknown): Promise<UnmappedCountry[]> {
  const b = (body ?? {}) as { country?: unknown; dismissed?: unknown };
  if (typeof b.country !== 'string' || !/^[A-Z]{2}$/.test(b.country)) throw new ReportError(400, '國家代碼不對');
  await env.DB.prepare('UPDATE unmapped_countries SET dismissed = ? WHERE country = ?').bind(b.dismissed === false ? 0 : 1, b.country).run();
  return listUnmapped(env);
}
