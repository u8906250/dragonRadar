/**
 * 店家的營業時間（台派雷達）：把「週二至週日 11:00–20:00，週一公休」這種文字讀成每週的時段，
 * 雷達才知道現在有沒有開。判讀出來的、回報的人在表單上改的都用這個讀；讀不懂就只顯示原文（不猜有沒有開）。
 *
 * 時段是 [星期幾, 開始分鐘, 結束分鐘]：星期 1 = 週一 … 7 = 週日，分鐘從那天 0 點算（台灣時間），
 * 開到半夜以後的結束超過 1440（「18:00–02:00」是 [d, 1080, 1560]）
 */
export type OpenSlot = [day: number, from: number, to: number];

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const DAY_CHAR: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

/** 全形數字、冒號、波浪號換成半形；周、星期、禮拜一律寫成「週」 */
function normalize(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':')
    .replace(/[～〜~—–－−﹣]/g, '-')
    .replace(/(?:星期|禮拜|礼拜|周)/g, '週')
    .replace(/[（(）)]/g, ' ');
}

/** 「週一至週五」「週二～日」「週一、三、五」「週六日」：展開成星期幾 */
function daysOf(spec: string): number[] {
  const out = new Set<number>();
  let rest = spec.replace(/週/g, '');
  for (const m of rest.matchAll(/([一二三四五六日天])\s*(?:-|至|到)\s*([一二三四五六日天])/g)) {
    // 「週五至週一」繞過週末
    let a = DAY_CHAR[m[1]];
    const b = DAY_CHAR[m[2]];
    for (let i = 0; i < 7; i++) {
      out.add(a);
      if (a === b) break;
      a = (a % 7) + 1;
    }
    rest = rest.replace(m[0], ' ');
  }
  for (const c of rest) if (DAY_CHAR[c]) out.add(DAY_CHAR[c]);
  return [...out].sort((x, y) => x - y);
}

const namedDays = (w: string): number[] => (w === '平日' ? [1, 2, 3, 4, 5] : /^(?:假日|週末|例假日)$/.test(w) ? [6, 7] : ALL_DAYS);

const WEEKDAY_SPEC = '週[一二三四五六日天](?:\\s*(?:-|至|到|、|,|，|/|及|和|與)?\\s*週?[一二三四五六日天])*';
const NAMED_SPEC = '每天|每日|天天|全年無休|平日|假日|週末|例假日';
const AMPM = '(?:上午|早上|中午|下午|晚上|凌晨|AM|am|PM|pm)?';
const TIME = `${AMPM}\\s*\\d{1,2}(?:\\s*[:.]\\s*\\d{2}|\\d{2})?\\s*(?:點|時)?\\s*半?`;
const TOKEN = new RegExp(
  [
    `(?<days>${WEEKDAY_SPEC}|${NAMED_SPEC})`,
    `(?<h24>24\\s*(?:小時|hr|HR|h|H))`,
    // 電話號碼（02-2345-6789）不算
    `(?<range>(?<!\\d)${TIME}\\s*(?:-|至|到)\\s*${TIME}(?![\\d-]))`,
    `(?<closed>(?:公休|店休|休息|午休|不營業|休假|休館|休)日?)`,
  ].join('|'),
  'g',
);

/** 「下午 2 點」「14:30」「1430」「9 點半」換成分鐘；看不懂是 null */
function minutesOf(text: string): number | null {
  const m = /^(上午|早上|中午|下午|晚上|凌晨|AM|am|PM|pm)?\s*(\d{1,2})(?:\s*[:.]\s*(\d{2})|(\d{2}))?\s*(?:點|時)?\s*(半)?$/.exec(text.trim());
  if (!m) return null;
  let h = Number(m[2]);
  const min = m[5] ? 30 : Number(m[3] ?? m[4] ?? 0);
  if (h > 30 || min > 59) return null;
  const ap = (m[1] ?? '').toLowerCase();
  if ((ap === '下午' || ap === '晚上' || ap === 'pm') && h < 12) h += 12;
  else if (ap === '晚上' && h === 12) h = 24;
  else if (ap === '中午' && h < 6) h += 12;
  return h * 60 + min;
}

/** 「11:00-20:00」拆成開始、結束（分鐘）；結束不比開始晚就是開到隔天 */
function rangeOf(text: string): [number, number] | null {
  const parts = text.trim().split(/\s*(?:-|至|到)\s*/);
  if (parts.length !== 2) return null;
  const from = minutesOf(parts[0]);
  let to = minutesOf(parts[1]);
  if (from === null || to === null || from >= 1440) return null;
  // 「晚上 6 點到 10 點」：後面沒寫上午、晚上，照前面的
  if (to <= from && to < 720 && /^(?:下午|晚上|pm)/i.test(parts[0].trim()) && !/^(?:上午|早上|凌晨|am)/i.test(parts[1].trim())) to += 720;
  if (to <= from) to += 1440;
  if (to - from > 1440) return null;
  return [from, to];
}

/** 從時段裡扣掉休息時間（午休） */
function subtract(ranges: Array<[number, number]>, cut: [number, number]): Array<[number, number]> {
  return ranges.flatMap(([a, b]): Array<[number, number]> => {
    if (cut[1] <= a || cut[0] >= b) return [[a, b]];
    const out: Array<[number, number]> = [];
    if (cut[0] > a) out.push([a, cut[0]]);
    if (cut[1] < b) out.push([cut[1], b]);
    return out;
  });
}

type Tok = { at: number; end: number } & ({ kind: 'days'; days: number[] } | { kind: 'range'; range: [number, number] } | { kind: 'closed'; word: string });

/**
 * 讀營業時間。寫了星期幾的那一段照那幾天；沒寫星期幾的時段是其他天都這樣（扣掉公休的、另外寫了的）。
 * 「週一公休」「公休日：週一」那幾天不開；「14:00-17:00 休息」「午休 14:00-17:00」從時段裡扣掉。
 * 讀不出任何時段（只寫「週一公休」、「營業到賣完」）回傳 null
 */
export function parseHours(raw: string | null | undefined): OpenSlot[] | null {
  if (!raw) return null;
  const text = normalize(raw);
  const toks: Tok[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const g = m.groups ?? {};
    const at = m.index ?? 0;
    const end = at + m[0].length;
    if (g.days) toks.push({ at, end, kind: 'days', days: g.days.startsWith('週') ? daysOf(g.days) : namedDays(g.days) });
    else if (g.h24) toks.push({ at, end, kind: 'range', range: [0, 1440] });
    else if (g.range) {
      const r = rangeOf(g.range);
      if (r) toks.push({ at, end, kind: 'range', range: r });
    } else if (g.closed) toks.push({ at, end, kind: 'closed', word: g.closed });
  }
  const own = new Map<number, Array<[number, number]>>();
  const generic: Array<[number, number]> = [];
  const closed = new Set<number>();
  const breaks: Array<{ days: number[] | null; range: [number, number] }> = [];
  let days: number[] | null = null;
  let closedNext = false;
  let breakNext = false;
  /** 上一個放進去的時段（後面寫「休息」時改成休息時間） */
  let last: { days: number[] | null; range: [number, number] } | null = null;
  const between = (a: Tok | undefined, b: Tok | undefined): string => (a && b ? text.slice(a.end, b.at) : '');
  for (const [i, t] of toks.entries()) {
    const prev = toks[i - 1];
    const next = toks[i + 1];
    // 中間隔了句號、分號、換行，前面的星期幾不再算
    if (days && prev && /[。；;\n]/.test(between(prev, t))) days = null;
    if (t.kind === 'days') {
      if (closedNext) {
        for (const d of t.days) closed.add(d);
        closedNext = false;
        days = null;
      } else days = t.days;
      continue;
    }
    if (t.kind === 'closed') {
      const breakWord = /^(?:休息|午休)$/.test(t.word);
      if (days && prev?.kind === 'days' && /^[\s:]*$/.test(between(prev, t))) {
        for (const d of days) closed.add(d);
        days = null;
      } else if (/日$/.test(t.word) || /^\s*:?\s*(?:為|是)?\s*每?週/.test(text.slice(t.end))) closedNext = true;
      // 「午休 14:00-17:00」寫在前面的優先，其次「12:00-13:00 休息」寫在後面的
      else if (breakWord && next?.kind === 'range' && /^[\s:]*$/.test(between(t, next))) breakNext = true;
      else if (breakWord && prev?.kind === 'range' && last && /^[\s,，、]*$/.test(between(prev, t))) {
        const target = last.days ? last.days.map((d) => own.get(d)) : [generic];
        for (const list of target) {
          const k = list?.indexOf(last.range) ?? -1;
          if (list && k >= 0) list.splice(k, 1);
        }
        breaks.push(last);
        last = null;
      }
      continue;
    }
    closedNext = false;
    if (breakNext) {
      breaks.push({ days, range: t.range });
      breakNext = false;
      continue;
    }
    if (days) for (const d of days) own.set(d, [...(own.get(d) ?? []), t.range]);
    else generic.push(t.range);
    last = { days, range: t.range };
  }
  const out: OpenSlot[] = [];
  for (const d of ALL_DAYS) {
    if (closed.has(d)) continue;
    let ranges = own.get(d) ?? generic;
    for (const b of breaks) if (!b.days || b.days.includes(d)) ranges = subtract(ranges, b.range);
    for (const [from, to] of ranges) out.push([d, from, to]);
  }
  return out.length > 0 ? out : null;
}

/** 存起來的時段（events.extra.open）讀回來：壞掉的那一筆不要 */
export function cleanSlots(v: unknown): OpenSlot[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter(
    (s): s is OpenSlot =>
      Array.isArray(s) && s.length === 3 && Number.isInteger(s[0]) && s[0] >= 1 && s[0] <= 7 && Number.isInteger(s[1]) && Number.isInteger(s[2]) && s[1] >= 0 && s[1] < 1440 && s[2] > s[1] && s[2] - s[1] <= 1440,
  );
  return out.length > 0 ? out.slice(0, 40) : null;
}
