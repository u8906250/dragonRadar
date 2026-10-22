import type { Env } from './env';
import { isAdminOnly } from './geocode';
import { formatTaipei, parseIsoToUnix } from './util';

export type EventKind = 'giveaway' | 'activity';

/** 一則貼文裡的一個場次（地點或時段不同就是不同場次） */
export interface ExtractedEvent {
  kind: EventKind;
  title: string;
  item: string | null;
  start_at: string | null;
  end_at: string | null;
  place_text: string | null;
  place_query: string | null;
  confidence: number;
  /** 固定據點：店家、服務處等連續多天在固定時段都能去 */
  spot: boolean;
  /** 固定據點的最後一天 YYYY-MM-DD，沒寫則 null */
  until: string | null;
  /** 固定據點只在每週幾開（1 = 週一 … 7 = 週日），每天開或不是固定據點則 null */
  weekdays?: number[] | null;
  /** 活動在哪個國家（ISO 3166-1 兩碼，例如 US、JP）；台灣或沒寫是 null */
  country?: string | null;
  /** 國外活動的當地時區（IANA，例如 America/Los_Angeles）；台灣或不確定是 null */
  timezone?: string | null;
}

export interface Extraction {
  /** 是否宣告了可到場的實體活動或發放 */
  is_event: boolean;
  events: ExtractedEvent[];
}

const MAX_EVENTS_PER_POST = 6;

const EVENT_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['giveaway', 'activity'] },
    title: { type: 'string' },
    item: { type: ['string', 'null'] },
    start_at: { type: ['string', 'null'] },
    end_at: { type: ['string', 'null'] },
    place_text: { type: ['string', 'null'] },
    place_query: { type: ['string', 'null'] },
    confidence: { type: 'number' },
    spot: { type: 'boolean' },
    until: { type: ['string', 'null'] },
    weekdays: { type: ['array', 'null'], items: { type: 'integer' } },
    country: { type: ['string', 'null'] },
    timezone: { type: ['string', 'null'] },
  },
  required: ['kind', 'title', 'item', 'start_at', 'end_at', 'place_text', 'place_query', 'confidence', 'spot', 'until'],
};

const SCHEMA = {
  type: 'object',
  properties: {
    is_event: { type: 'boolean' },
    events: { type: 'array', items: EVENT_SCHEMA, maxItems: MAX_EVENTS_PER_POST },
  },
  required: ['is_event', 'events'],
};

const SYSTEM_PROMPT = `你是「洋流雷達」的資料抽取器。你會收到一則台灣 Threads 貼文，請判斷它是否在宣告「可以到場參加的實體活動或發放」，並抽出時間與地點。

兩種類型：
- giveaway（發放）：在特定時間地點免費發送飄帶、貼紙、文宣、周邊、飲料等給到場的人。
- activity（活動）：在特定時間地點舉行、民眾可以到場參加的活動，例如車掃、掃街、市場開講、造勢晚會、見面會、座談、講座、遊行、快閃、志工集合，還有市集擺攤幫忙編飄帶、綁飄帶、彩繪、拍照。
- 只說「帶自己的飄帶來」「幫你編飄帶」而沒有免費送東西的，是 activity，不是 giveaway，item 為 null。

只輸出 JSON：
{
  "is_event": 是否宣告了至少一個可到場的實體活動或發放（布林值）,
  "events": [ 每一個「地點 + 時段」一筆，最多 ${MAX_EVENTS_PER_POST} 筆 ]
}

events 每筆的欄位：
- kind: "giveaway" 或 "activity"。活動現場也有發放東西時，用 "giveaway"，不要拆成兩筆
- title: 16 字以內的短標題，要有地點或店名，活動要寫出做什麼，例如「秀水服務處發飄帶」「保安宮市政開講」「豬跳舞小餐館發小物」「散步遊者市集幫編飄帶」「景華公園表演同樂會」。做什麼要照貼文寫的（表演、同樂會、野餐、講座、掃街、見面會…）；貼文沒寫「市政」「開講」就不要寫「市政活動」「市政開講」。服務處、競選總部要寫出是誰的（看貼文署名或內文的名字），例如「郭凡信義服務處發飄帶」「吳棋楠服務處發小風車」
- item: 免費送出的物品，例如「洋流飄帶」；要民眾自己帶來的東西（例如自備飄帶來編）不算；活動沒送東西或沒寫則 null
- start_at: 開始時間，ISO 8601 含時區，例如 2026-10-17T15:00:00+08:00；無法判斷則 null
- end_at: 結束時間，同格式；沒有明確結束時間則 null
- place_text: 貼文原文中的地點描述。內文沒寫地點、但最後有「📍 貼文的地點標記：XX」時，用標記的地點（店家發文時標的位置），place_query 填「XX」。hashtag（例如「#洋流」）、活動名稱不是地點。「本店」「店裡」「門市」「現場」這種沒寫店名、也沒寫地址的不算地點，place_text、place_query 都給 null（不要只填縣市），回報的人會補充店名
- place_query: 給地圖搜尋用的地址或地名。有門牌地址就用地址；要補上縣市，例如「宜蘭縣羅東鎮光榮路218號」「台北市 大龍峒保安宮」。鄉鎮區只有貼文寫了才加，不要自己猜（猜錯會定位到別的區）。店家寫「近XX站」時，用「縣市 + 捷運XX站」，例如「台北市 捷運忠孝復興站」。只有「XX服務處」「競選總部」而沒有地址時，填你能確定的最具體地名；沒有則 null
- confidence: 這一筆 0 到 1 的信心分數
- spot: 是否為「固定據點」：店家、服務處、競選總部等，連續多天在固定時段都可以去領或參加（例如寫了「每天」「每日」「營業時間」「營業日」「即日起」「長期」「10/17~10/19」）。店家、餐廳、服務處在自己店裡發放（「歡迎來店索取」「來索取」「到店領取」），而且寫了發放或領取時段的，也是固定據點，就算只寫了開始那天的日期（例如「明天（10/21）開始 歡迎來店索取」「10/21 洋流小物 … 歡迎來索取 發放時間 12:00-13:30；18:00-20:30」），start_at 填那天、until 為 null；除非寫明只有那一天（「只有今天」「限定一天」「僅此一天」）。在路口、車站、公園、市場等公共場所的單次發放，或只有一天的活動，spot 為 false
- until: 固定據點的最後一天，格式 YYYY-MM-DD；沒寫最後一天或不是固定據點則 null
- country: 活動在台灣以外的國家時，填國家代碼（ISO 3166-1 兩碼，例如美國 US、日本 JP、英國 GB）；在台灣則 null
- timezone: 活動在國外時，填當地時區（IANA 名稱，例如美國灣區、洛杉磯 America/Los_Angeles、紐約 America/New_York、東京 Asia/Tokyo）；在台灣則 null
- weekdays: 固定據點只在每週固定幾天開時，列出星期幾（1 = 週一 … 7 = 週日），例如「每週二、四」→ [2, 4]、「週一到週五」→ [1, 2, 3, 4, 5]；每天都開、或不是固定據點則 null。start_at 填第一個開放日

規則：
- 相對時間（今天、今晚、明天、週六、等等、下午）以「貼文發布時間」為基準換算，時區一律 +08:00。「今晚 5 點半」是發文當天 17:30。
- 「早上 9 點到下午 5 點」這種時段，start_at 是 9:00、end_at 是 17:00。
- 同一則貼文有多個地點或多個時段（例如行程表、車掃停靠點），要拆成多筆 events。
- 固定據點（spot 為 true）每個地點只輸出一筆，不要每天拆一筆；但一天有好幾個時段（例如「11:00–14:00／17:00–19:00」）時，每個時段各輸出一筆，地點、until 等其他欄位都一樣：start_at、end_at 填第一天的開放時段（例如「10/17~10/19 每日 11:00~18:00」→ start_at 10/17 11:00、end_at 10/17 18:00、until 2026-10-19）。沒寫每天幾點時，start_at 填第一天 00:00、end_at 為 null。「即日起」的第一天是發文當天。
- 只寫到幾點、沒寫幾點開始（「今天14:45前我都在」）：14:45 是結束時間（end_at），不是開始時間；start_at 填發文時間，不要自己猜開始時間
- 列出幾個發放時間點、沒寫發到幾點（例如「🕐 13:00｜10 個」「🕒 15:00｜10 個」）：每個時間點各輸出一筆，start_at 是那個時間、end_at 為 null（發完為止），不要合成「13:00–15:00」一段
- 固定據點有寫日期範圍或「每天」就算有時間，不需要因為沒寫幾點而降低 confidence。
- 車掃、遊行等移動路線，每個有時間的停靠點各一筆；沒有停靠點就用出發地。
- 「發完為止」「數量有限」代表沒有明確結束時間，end_at 為 null。
- 新聞報導、心得、活動回顧、徵求、詢問、線上抽獎、直播、線上活動、販售，is_event 為 false，events 為空陣列。
- 只有時間沒有地點、或只有地點沒有時間，該筆 confidence 必須低於 0.5。
- 不要編造貼文裡沒有的時間或地點，可以依上下文補上縣市。
- 貼文最後如果有「【回報的人補充】」，那是看到貼文的人補上的地點或時間（例如店名、地址、日期），貼文沒寫的一定要用它補上；跟貼文衝突時以貼文為準。補充寫了店名、或是誰的服務處（例如「陳致中前鎮服務處」），title 要用補充寫的名稱（例如「陳致中前鎮服務處發飄帶」）；貼文有好幾個地點時，只改補充提到的那個地點的 title。補充寫「只有 10/26」「只有那天」就是只有那一天：spot 為 false，start_at 用那天加貼文寫的時段。
- 貼文和補充都沒寫星期幾，weekdays 就是 null，不要自己猜。
- 活動在國外（例如美國灣區、日本、歐洲的僑胞、留學生活動）：一樣要抽出來。start_at、end_at 寫當地的時間（貼文寫的時間就是當地時間），填 country、timezone；place_query 用當地的地名加城市，英文或當地語言，例如「Memorial Park, Cupertino」，不要加台灣的縣市。`;

export function buildMessages(text: string, postedAt: number, now: number): Array<{ role: 'system' | 'user'; content: string }> {
  void now;
  const user = `貼文發布時間：${formatTaipei(postedAt)}
（貼文裡的「今天、今晚、明天」都以這個發布日期為準）

貼文內容：
"""
${text.trim()}
"""`;
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length && t.toLowerCase() !== 'null' ? t : null;
}

function conf(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export function normalizeKind(v: unknown): EventKind {
  const k = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return k === 'activity' || k === 'event' || k === '活動' ? 'activity' : 'giveaway';
}

function normalizeEvent(o: Record<string, unknown>): ExtractedEvent {
  return {
    kind: normalizeKind(o.kind),
    title: str(o.title) ?? '活動',
    item: str(o.item),
    start_at: str(o.start_at),
    end_at: str(o.end_at),
    place_text: str(o.place_text),
    place_query: str(o.place_query),
    confidence: conf(o.confidence),
    spot: o.spot === true || o.spot === 'true',
    until: /^\d{4}-\d{2}-\d{2}/.test(str(o.until) ?? '') ? (str(o.until) as string).slice(0, 10) : null,
    weekdays: normalizeWeekdays(o.weekdays),
    country: normalizeCountry(o.country),
    timezone: validTimeZone(str(o.timezone)),
  };
}

/** 國家代碼：兩個英文字母、大寫；台灣（TW）當成 null */
export function normalizeCountry(v: unknown): string | null {
  const c = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(c) && c !== 'TW' ? c : null;
}

/** 合法的 IANA 時區才收；台灣時間當成 null */
export function validTimeZone(tz: string | null): string | null {
  if (!tz || tz === 'Asia/Taipei') return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** 只有一個時區的國家：模型沒給時區時用（美國、加拿大、澳洲這種好幾個時區的不猜） */
const COUNTRY_TZ: Record<string, string> = {
  JP: 'Asia/Tokyo', KR: 'Asia/Seoul', HK: 'Asia/Hong_Kong', MO: 'Asia/Macau', SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur',
  TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh', PH: 'Asia/Manila', GB: 'Europe/London', IE: 'Europe/Dublin', FR: 'Europe/Paris',
  DE: 'Europe/Berlin', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', CH: 'Europe/Zurich', AT: 'Europe/Vienna', IT: 'Europe/Rome',
  ES: 'Europe/Madrid', CZ: 'Europe/Prague', PL: 'Europe/Warsaw', SE: 'Europe/Stockholm', NO: 'Europe/Oslo', DK: 'Europe/Copenhagen',
  FI: 'Europe/Helsinki', NZ: 'Pacific/Auckland', IN: 'Asia/Kolkata', IL: 'Asia/Jerusalem', AE: 'Asia/Dubai',
};

export const timeZoneOf = (ex: Pick<ExtractedEvent, 'country' | 'timezone'>): string | null => ex.timezone ?? (ex.country ? (COUNTRY_TZ[ex.country] ?? null) : null);

/** 某個時區在某個時間點比 UTC 快幾秒（夏令時間也算進去） */
export function tzOffsetSec(unix: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(unix * 1000));
  const g = (k: string): number => Number(parts.find((p) => p.type === k)?.value ?? 0);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) / 1000 - unix;
}

/** 「2026-11-07T11:30」當成 tz 的當地時間，換成 unix 秒（不管字串後面寫的時區） */
export function localToUnix(iso: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(iso);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) / 1000;
  const first = wall - tzOffsetSec(wall, tz);
  // 換算後的偏移不一樣（剛好碰到夏令時間切換）就用換算後的
  const off = tzOffsetSec(first, tz);
  return wall - off;
}

/**
 * 國外的活動：模型寫的是當地時間，換成正確的時間點（存成 UTC 的 ISO 字串，後面照常處理）。
 * 回傳當地時區；不是國外或不知道時區回傳 null（時間照模型給的）。
 */
export function localizeTimes(ex: ExtractedEvent): string | null {
  const tz = timeZoneOf(ex);
  if (!tz) return null;
  for (const k of ['start_at', 'end_at'] as const) {
    const v = ex[k];
    const t = v ? localToUnix(v, tz) : null;
    if (t !== null) ex[k] = new Date(t * 1000).toISOString().replace('.000Z', 'Z');
  }
  return tz;
}

/** 1–7 不重複、排好；全部 7 天等於每天，回傳 null */
export function normalizeWeekdays(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const days = [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort((a, b) => a - b);
  return days.length > 0 && days.length < 7 ? days : null;
}

/**
 * 模型給的最後一天要在貼文裡找得到（「10/29」「10月29日」「10.29」），找不到就是模型自己猜的
 * （例如沒寫結束就填年底），當成沒寫，畫面寫「發完為止」。
 */
export function untilInText(until: string | null, text: string): string | null {
  if (!until) return null;
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(until);
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  const t = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const re = new RegExp(`(?<!\\d)0?${mo}\\s*(?:[/.\\-]|月)\\s*0?${d}(?!\\d)`);
  // 「10/17~19」「10月17日至19日」：後半段省略月份
  const range = new RegExp(`(?<!\\d)0?${mo}\\s*(?:[/.]|月)\\s*\\d{1,2}\\s*日?\\s*[~～至到\\-－]\\s*0?${d}(?!\\d)`);
  return re.test(t) || range.test(t) ? until : null;
}

const WEEKDAY_CHAR: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

/** 寫了「每週」「週二、四」「週一到週五」「平日」「週末」這類字才算有寫星期幾 */
const WEEKLY_RE = /(?:每|逢)\s*(?:週|周|星期|禮拜)|(?:週|周|星期|禮拜)\s*[一二三四五六日天]\s*(?:到|至|~|～|-|－|、|,|，|和|與|及)\s*(?:週|周|星期|禮拜)?\s*[一二三四五六日天]|平日|週末|周末|假日/;

/** 模型給的每週幾要貼文（或補充）真的有寫，不然當成每天（模型有時會自己編） */
export function weekdaysInText(weekdays: number[] | null | undefined, text: string): number[] | null {
  return weekdays?.length && WEEKLY_RE.test(text) ? weekdays : null;
}

const halfWidth = (s: string): string => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const DATE_RE = /(?<!\d)(\d{1,2})\s*(?:[/.]|月)\s*(\d{1,2})(?!\d)/g;
/** 貼文自己有寫哪天（日期、今天明天、星期幾）：這時以貼文為準，不拿補充的日期改 */
const POST_DAY_RE = /(?<!\d)\d{1,2}\s*(?:[/.]|月)\s*\d{1,2}(?!\d)|今天|今日|明天|明日|後天|本週|這週|週[一二三四五六日天]|周[一二三四五六日天]|星期[一二三四五六日天]|禮拜[一二三四五六日天]/;
const DAY_SEC = 86400;
const taipeiDay = (unix: number): number => Math.floor((unix + 8 * 3600) / DAY_SEC);
const taipeiIso = (unix: number): string => `${new Date((unix + 8 * 3600) * 1000).toISOString().slice(0, 19)}+08:00`;

/**
 * 貼文沒寫哪天、回報的人補充了一個日期（「只有10/26」）：模型有時不理補充、填發文當天，
 * 這裡把開始、結束時間搬到補充的那天，幾點照模型讀到的。補充寫了好幾個日期就不動。
 */
export function applySupplementDate(ex: Pick<ExtractedEvent, 'start_at' | 'end_at'>, supplement: string | null | undefined, postText: string, postedAt: number): void {
  if (!supplement || POST_DAY_RE.test(halfWidth(postText))) return;
  const dates = new Set([...halfWidth(supplement).matchAll(DATE_RE)].map((m) => `${Number(m[1])}/${Number(m[2])}`));
  if (dates.size !== 1) return;
  const [mo, d] = [...dates][0].split('/').map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return;
  const start = parseIsoToUnix(ex.start_at);
  if (start === null) return;
  // 年份跟發文那年；比發文早一個月以上就是明年
  const year = new Date((postedAt + 8 * 3600) * 1000).getUTCFullYear();
  let target = Math.floor(Date.UTC(year, mo - 1, d) / 1000 / DAY_SEC);
  if (target < taipeiDay(postedAt) - 30) target = Math.floor(Date.UTC(year + 1, mo - 1, d) / 1000 / DAY_SEC);
  const shift = (target - taipeiDay(start)) * DAY_SEC;
  if (shift === 0) return;
  ex.start_at = taipeiIso(start + shift);
  const end = parseIsoToUnix(ex.end_at);
  if (end !== null) ex.end_at = taipeiIso(end + shift);
}

const BRING_OWN_RE = /帶著?(?:你|妳|大家)?自己的|自備|自行攜帶|自己帶/;
const GIVE_RE = /發放|贈送|免費送|送給|送出|送完|領取|索取|發送|限量/;

/**
 * 「帶著自己的飄帶來找我，幫你編飄帶」：東西是民眾自己帶的，不是發放。貼文沒有任何送東西的字時，
 * 改成活動、拿掉物品，免得畫面寫「發放：洋流飄帶」。改了回傳 true。
 */
export function dropBroughtItem(ex: Pick<ExtractedEvent, 'kind' | 'item'>, text: string): boolean {
  if (!BRING_OWN_RE.test(text) || GIVE_RE.test(text)) return false;
  if (!ex.item && ex.kind === 'activity') return false;
  ex.item = null;
  ex.kind = 'activity';
  return true;
}

/**
 * 「10/24～10/26 12:00～18:30」被模型讀成從 10/24 12:00 一路到 10/26 18:30（半夜也算進行中）：
 * 跨了好幾天、每天幾點到幾點的，改成固定據點每天一個時段，最後一天要貼文有寫。改了回傳 true。
 */
export function splitMultiDay(ex: Pick<ExtractedEvent, 'start_at' | 'end_at' | 'spot' | 'until'>, text: string): boolean {
  if (ex.spot) return false;
  const start = parseIsoToUnix(ex.start_at);
  const end = parseIsoToUnix(ex.end_at);
  if (start === null || end === null || end - start < 20 * 3600 || taipeiDay(end) <= taipeiDay(start)) return false;
  const tod = (t: number): number => (t + 8 * 3600) % DAY_SEC;
  // 每天的結束時間要比開始晚（12:00～18:30）；跨夜的（22:00 到隔天 02:00）不是這種
  if (tod(end) <= tod(start)) return false;
  const until = untilInText(taipeiIso(end).slice(0, 10), text);
  if (!until) return false;
  ex.spot = true;
  ex.until = until;
  ex.end_at = taipeiIso(start + (tod(end) - tod(start)));
  return true;
}

/**
 * 從貼文找「每週二、四」「每週一至五」「每週六日」：模型漏掉時的備援。
 * 一定要有「每」，「10/21（週二）」這種日期註記不算。
 */
export function weekdaysFromText(text: string): number[] | null {
  const m = /每\s*(?:週|周|星期|禮拜)\s*([一二三四五六日天](?:\s*[、,，和與及跟/／]?\s*(?:[到至~～\-－]\s*)?(?:週|周|星期|禮拜)?\s*[一二三四五六日天])*)/.exec(text);
  if (!m) return null;
  const out: number[] = [];
  const parts = m[1].replace(/(?:週|周|星期|禮拜)/g, '').replace(/\s/g, '');
  const re = /([一二三四五六日天])(?:[到至~～\-－]([一二三四五六日天]))?/g;
  for (const r of parts.matchAll(re)) {
    const a = WEEKDAY_CHAR[r[1]];
    const b = r[2] ? WEEKDAY_CHAR[r[2]] : a;
    for (let d = a; d <= b; d++) out.push(d);
  }
  return normalizeWeekdays(out);
}

function parseLoose(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  // 推理型模型（Qwen3、GLM 等）可能先輸出 <think>…</think>
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = /\{[\s\S]*\}/.exec(cleaned);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

/**
 * 把 LLM 回傳的東西整理成 Extraction，格式不對就回 null。
 * 也接受舊的單筆格式（欄位直接放在最外層）。
 */
export function normalizeExtraction(raw: unknown): Extraction | null {
  const obj = parseLoose(raw);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  // 舊格式叫 is_giveaway，新格式叫 is_event
  const flag = o.is_event ?? o.is_giveaway;
  const isEvent = flag === true || flag === 'true';
  let events: ExtractedEvent[] = [];
  if (Array.isArray(o.events)) {
    events = o.events
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e))
      .slice(0, MAX_EVENTS_PER_POST)
      .map(normalizeEvent);
  } else if ('start_at' in o || 'place_text' in o || 'place_query' in o) {
    events = [normalizeEvent(o)];
  }
  return { is_event: isEvent, events: isEvent ? events : [] };
}

interface AiRunner {
  run(model: string, inputs: unknown): Promise<unknown>;
}

/** 各模型回傳格式不同：Workers AI 舊格式是 { response }，新模型是 OpenAI 相容的 { choices } */
export function responseContent(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const r = result as Record<string, unknown> & { choices?: Array<{ message?: { content?: unknown } }> };
  if ('response' in r) return r.response;
  const c = r.choices?.[0]?.message?.content;
  if (c !== undefined) return c;
  if (typeof r.output_text === 'string') return r.output_text;
  return r;
}

const HAN = /\p{Script=Han}/u;

/**
 * 判讀結果裡的地點文字，有多少漢字真的出現在原文。
 * 模型亂碼時（例如「捷運市政府站」變成「越車政園给行」）比例會很低。
 */
export function placeFidelity(ex: Extraction, text: string): number {
  let worst = 1;
  for (const e of ex.events) {
    const han = [...(e.place_text ?? '')].filter((c) => HAN.test(c));
    if (han.length === 0) continue;
    const hit = han.filter((c) => text.includes(c)).length / han.length;
    worst = Math.min(worst, hit);
  }
  return worst;
}

const MIN_FIDELITY = 0.7;

export interface ModelAttempt {
  model: string;
  ms: number;
  extraction: Extraction | null;
  raw: string;
  fidelity: number;
  ok: boolean;
  error?: string;
}

/** 用指定模型判讀一次。先用 JSON schema，模型不支援就退回純提示 */
export async function runModel(env: Env, model: string, text: string, postedAt: number, now: number): Promise<ModelAttempt> {
  const ai = env.AI as unknown as AiRunner;
  const messages = buildMessages(text, postedAt, now);
  // Qwen3 預設會先長篇推理，可能把 token 用完沒有輸出；這種抽取工作不需要推理
  if (/qwen3/i.test(model)) messages[messages.length - 1].content += '\n/no_think';
  const t0 = Date.now();
  let result: unknown;
  let error: string | undefined;
  try {
    result = await ai.run(model, {
      messages,
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      max_tokens: 1200,
      temperature: 0.1,
    });
  } catch (e) {
    error = String(e);
    try {
      result = await ai.run(model, { messages, max_tokens: 1200, temperature: 0.1 });
      error = undefined;
    } catch (e2) {
      error = `${error} / ${String(e2)}`;
    }
  }
  const content = responseContent(result);
  const raw = typeof content === 'string' ? content : JSON.stringify(content ?? null);
  const extraction = error ? null : normalizeExtraction(content);
  const fidelity = extraction ? placeFidelity(extraction, text) : 0;
  return { model, ms: Date.now() - t0, extraction, raw, fidelity, ok: !!extraction && fidelity >= MIN_FIDELITY, error };
}

/**
 * 主要模型判讀失敗或地點亂碼時，換備用模型再試。
 * secondOpinion：主要模型說「不是活動」也請備用模型再看一次（使用者貼連結回報的，
 * 主要模型對同一則有時判成不是、有時判成是）；備用模型壞掉就照主要模型的
 */
export async function extractFromPost(
  env: Env,
  text: string,
  postedAt: number,
  now: number,
  opts: { secondOpinion?: boolean } = {},
): Promise<{ extraction: Extraction | null; raw: string; model: string; garbled: boolean }> {
  const models = [env.AI_MODEL, env.AI_MODEL_FALLBACK].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
  let last: ModelAttempt | null = null;
  for (const m of models) {
    const attempt = await runModel(env, m, text, postedAt, now);
    if (last?.ok && !attempt.ok) {
      console.warn(`second opinion with ${m} not usable, keeping ${last.model}: error=${attempt.error ?? ''}`);
      break;
    }
    last = attempt;
    if (last.ok && (last.extraction?.is_event || !opts.secondOpinion)) break;
    if (!last.ok) console.warn(`extract with ${m} not usable: fidelity=${last.fidelity.toFixed(2)} error=${last.error ?? ''}`);
  }
  if (!last) return { extraction: null, raw: 'null', model: '', garbled: false };
  const garbled = !!last.extraction && last.fidelity < MIN_FIDELITY;
  return {
    extraction: garbled ? null : last.extraction,
    raw: JSON.stringify({ model: last.model, fidelity: Number(last.fidelity.toFixed(2)), response: last.raw }),
    model: last.model,
    garbled,
  };
}

/** 沒寫店名的自稱（「本店」「店裡」）：拿去查地圖只會對到同名的別的地方 */
const SELF_PLACE_RE = /^(?:本店|本館|本處|本公司|本工作室|店內|店裡|店面|店門口|門口|門市|現場|小店|敝店|我們(?:的)?(?:店|店裡|這裡)?|這裡|我家|老地方|服務處)$/;

function isSelfPlace(s: string | null): boolean {
  return SELF_PLACE_RE.test((s ?? '').replace(/(台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|嘉義)[市縣]/g, '').replace(/[\s，,、。.!！📍]/g, ''));
}

/**
 * 地點只寫「本店」、查詢只有縣市（或也是「本店」）：當成沒寫地點，讓回報的人補充店名，
 * 不然會對到別的地方（「台北市 本店」查到中山區一個不相干的點）。查詢有寫店名或地址的照用。
 */
export function dropSelfPlace(ex: ExtractedEvent): boolean {
  if (!isSelfPlace(ex.place_text) && !(ex.place_text === null && isSelfPlace(ex.place_query))) return false;
  if (ex.place_query && !isAdminOnly(ex.place_query) && !isSelfPlace(ex.place_query)) return false;
  ex.place_text = null;
  ex.place_query = null;
  return true;
}

/** 「🕐 13:00｜10 個」：時間後面接數量（不是「13:00-15:00」這種一段） */
const DROP_RE = /(?<![\d:]|[-–—~～至到]\s*)(\d{1,2}):(\d{2})(?!\d)(?!\s*(?:[-–—~～]|至|到))[^\n\d]{0,6}\d+\s*(?:個|份|條|張|組|包|束|枚|顆|支)/g;

/** 貼文列出的發放時間點（一天的第幾秒），至少兩個才算 */
function dropTimes(text: string): number[] {
  const t = halfWidth(text).replace(/：/g, ':');
  const out = new Set<number>();
  for (const m of t.matchAll(DROP_RE)) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 24 && min < 60) out.add(h * 3600 + min * 60);
  }
  return out.size >= 2 ? [...out].sort((a, b) => a - b) : [];
}

/**
 * 「🕐 13:00｜10 個」「🕒 15:00｜10 個」這種幾點各發幾個、沒寫發到幾點的：每個時間點各一筆、不寫結束（畫面寫「發完為止」）。
 * 模型常合成「13:00–15:00」一段（到 15:00 第二波開始時雷達反而顯示結束），或只給第一個時間。
 * 沒有數量的「13:00、15:00」只在模型合成一段時拆；貼文寫成一段（「13:00-15:00」）或寫明幾點結束（「15:00 結束」）的照舊。
 */
export function splitDropTimes(events: ExtractedEvent[], text: string): ExtractedEvent[] {
  const drops = dropTimes(text);
  const out: ExtractedEvent[] = [];
  const seen = new Set<string>();
  const push = (e: ExtractedEvent): void => {
    const k = `${e.start_at}|${e.end_at}|${e.place_query ?? e.place_text}|${e.spot}|${e.kind}`;
    if (!seen.has(k)) out.push(e);
    seen.add(k);
  };
  for (const ex of events) {
    const start = parseIsoToUnix(ex.start_at);
    const end = parseIsoToUnix(ex.end_at);
    if (ex.kind !== 'giveaway' || start === null || (end !== null && (end <= start || end - start > 12 * 3600))) {
      push(ex);
      continue;
    }
    const day = (taipeiDay(start) * DAY_SEC) - 8 * 3600;
    const tod = (u: number): number => u - day;
    if (drops.includes(tod(start)) && (end === null || drops.includes(tod(end)))) {
      for (const d of drops) push({ ...ex, start_at: taipeiIso(day + d), end_at: null });
      continue;
    }
    if (end !== null && mergedTwoTimes(start, end, text)) {
      push({ ...ex, end_at: null });
      push({ ...ex, start_at: taipeiIso(end), end_at: null });
      continue;
    }
    push(ex);
  }
  return out;
}

/** 貼文分開寫了開始和結束這兩個時間，沒寫成一段、也沒說幾點結束：是兩個發放時間點 */
function mergedTwoTimes(start: number, end: number, text: string): boolean {
  const t = halfWidth(text).replace(/：/g, ':');
  const timeRe = (unix: number): string => {
    const [h, m] = new Date((unix + 8 * 3600) * 1000).toISOString().slice(11, 16).split(':');
    return `(?<![\\d:])0?${Number(h)}:${m}(?!\\d)`;
  };
  const a = timeRe(start);
  const b = timeRe(end);
  if (!new RegExp(a).test(t) || !new RegExp(b).test(t)) return false;
  if (new RegExp(`${a}\\s*(?:[-–—~～]|至|到)\\s*${b}`).test(t)) return false;
  return !new RegExp(`(?:到|至)\\s*${b}|${b}\\s*(?:結束|截止|為止|止|收|前)`).test(t);
}

/** 「14:45前」「14:45 以前」：只寫到幾點 */
const BEFORE_RE = /(?<![\d:])(\d{1,2}):(\d{2})\s*(?:以前|之前|前)/g;

/**
 * 「今天14:45前我都在喔！」只寫到幾點、沒寫幾點開始：從現在到 14:45。
 * 模型常自己猜一個開始時間（14:00–14:45），或把 14:45 當成開始時間、沒給結束（變成 14:45 起兩小時）。
 * 貼文有寫開始時間（「13:00 開始」「13:00-14:45」）、或同一個時間別的地方沒有「前」的照貼文；不是今天的、固定據點不動。改了回傳 true。
 */
export function startNowForDeadline(ex: ExtractedEvent, text: string, now: number): boolean {
  if (ex.spot) return false;
  const t = halfWidth(text).replace(/：/g, ':');
  const tod = (u: number): number => (u + 8 * 3600) % DAY_SEC;
  const deadlines = new Set([...t.matchAll(BEFORE_RE)].map((m) => Number(m[1]) * 3600 + Number(m[2]) * 60));
  if (deadlines.size === 0) return false;
  let start = parseIsoToUnix(ex.start_at);
  let end = parseIsoToUnix(ex.end_at);
  // 把「14:45前」當成開始時間、沒給結束
  if (end === null && start !== null && deadlines.has(tod(start))) {
    end = start;
    start = null;
  }
  if (end === null || end <= now || taipeiDay(end) !== taipeiDay(now) || !deadlines.has(tod(end))) return false;
  // 同一個時間別的地方寫成開始時間（「19:00，免費發送 … 如果 19:00 前排隊已達 88 位就提前發」）：照模型的
  const [eh, em] = [Math.floor(tod(end) / 3600), String(Math.floor((tod(end) % 3600) / 60)).padStart(2, '0')];
  if (new RegExp(`(?<![\\d:])0?${eh}:${em}(?!\\d)(?!\\s*(?:以前|之前|前))`).test(t)) return false;
  if (start !== null && start < end) {
    const [h, m] = new Date((start + 8 * 3600) * 1000).toISOString().slice(11, 16).split(':');
    if (new RegExp(`(?<![\\d:])0?${Number(h)}:${m}(?!\\d)`).test(t)) return false;
  }
  ex.start_at = taipeiIso(Math.floor(now / 60) * 60);
  ex.end_at = taipeiIso(end);
  return true;
}
