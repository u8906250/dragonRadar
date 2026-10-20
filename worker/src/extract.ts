import type { Env } from './env';
import { formatTaipei } from './util';

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
- activity（活動）：在特定時間地點舉行、民眾可以到場參加的活動，例如車掃、掃街、市場開講、造勢晚會、見面會、座談、講座、遊行、快閃、志工集合。

只輸出 JSON：
{
  "is_event": 是否宣告了至少一個可到場的實體活動或發放（布林值）,
  "events": [ 每一個「地點 + 時段」一筆，最多 ${MAX_EVENTS_PER_POST} 筆 ]
}

events 每筆的欄位：
- kind: "giveaway" 或 "activity"。活動現場也有發放東西時，用 "giveaway"，不要拆成兩筆
- title: 12 字以內的短標題，要有地點或店名，例如「秀水服務處發飄帶」「保安宮市政開講」「豬跳舞小餐館發小物」
- item: 發放的物品，例如「洋流飄帶」；活動或沒寫則 null
- start_at: 開始時間，ISO 8601 含時區，例如 2026-10-17T15:00:00+08:00；無法判斷則 null
- end_at: 結束時間，同格式；沒有明確結束時間則 null
- place_text: 貼文原文中的地點描述。內文沒寫地點、但最後有「📍 貼文的地點標記：XX」時，用標記的地點（店家發文時標的位置），place_query 填「XX」。hashtag（例如「#洋流」）、活動名稱不是地點
- place_query: 給地圖搜尋用的地址或地名。有門牌地址就用地址；要補上縣市，例如「宜蘭縣羅東鎮光榮路218號」「台北市 大龍峒保安宮」。鄉鎮區只有貼文寫了才加，不要自己猜（猜錯會定位到別的區）。店家寫「近XX站」時，用「縣市 + 捷運XX站」，例如「台北市 捷運忠孝復興站」。只有「XX服務處」「競選總部」而沒有地址時，填你能確定的最具體地名；沒有則 null
- confidence: 這一筆 0 到 1 的信心分數
- spot: 是否為「固定據點」：店家、服務處、競選總部等，連續多天在固定時段都可以去領或參加（例如寫了「每天」「每日」「營業時間」「營業日」「即日起」「長期」「10/17~10/19」）。店家、餐廳、服務處在自己店裡發放（「歡迎來店索取」「來索取」「到店領取」），而且寫了發放或領取時段的，也是固定據點，就算只寫了開始那天的日期（例如「明天（10/21）開始 歡迎來店索取」「10/21 洋流小物 … 歡迎來索取 發放時間 12:00-13:30；18:00-20:30」），start_at 填那天、until 為 null；除非寫明只有那一天（「只有今天」「限定一天」「僅此一天」）。在路口、車站、公園、市場等公共場所的單次發放，或只有一天的活動，spot 為 false
- until: 固定據點的最後一天，格式 YYYY-MM-DD；沒寫最後一天或不是固定據點則 null
- weekdays: 固定據點只在每週固定幾天開時，列出星期幾（1 = 週一 … 7 = 週日），例如「每週二、四」→ [2, 4]、「週一到週五」→ [1, 2, 3, 4, 5]；每天都開、或不是固定據點則 null。start_at 填第一個開放日

規則：
- 相對時間（今天、今晚、明天、週六、等等、下午）以「貼文發布時間」為基準換算，時區一律 +08:00。「今晚 5 點半」是發文當天 17:30。
- 「早上 9 點到下午 5 點」這種時段，start_at 是 9:00、end_at 是 17:00。
- 同一則貼文有多個地點或多個時段（例如行程表、車掃停靠點），要拆成多筆 events。
- 固定據點（spot 為 true）每個地點只輸出一筆，不要每天拆一筆；但一天有好幾個時段（例如「11:00–14:00／17:00–19:00」）時，每個時段各輸出一筆，地點、until 等其他欄位都一樣：start_at、end_at 填第一天的開放時段（例如「10/17~10/19 每日 11:00~18:00」→ start_at 10/17 11:00、end_at 10/17 18:00、until 2026-10-19）。沒寫每天幾點時，start_at 填第一天 00:00、end_at 為 null。「即日起」的第一天是發文當天。
- 固定據點有寫日期範圍或「每天」就算有時間，不需要因為沒寫幾點而降低 confidence。
- 車掃、遊行等移動路線，每個有時間的停靠點各一筆；沒有停靠點就用出發地。
- 「發完為止」「數量有限」代表沒有明確結束時間，end_at 為 null。
- 新聞報導、心得、活動回顧、徵求、詢問、線上抽獎、直播、線上活動、販售，is_event 為 false，events 為空陣列。
- 只有時間沒有地點、或只有地點沒有時間，該筆 confidence 必須低於 0.5。
- 不要編造貼文裡沒有的時間或地點，可以依上下文補上縣市。
- 貼文最後如果有「【回報的人補充】」，那是看到貼文的人補上的地點或時間（例如店名、地址、日期），貼文沒寫的一定要用它補上；跟貼文衝突時以貼文為準。補充寫「只有 10/26」「只有那天」就是只有那一天：spot 為 false，start_at 用那天加貼文寫的時段。
- 貼文和補充都沒寫星期幾，weekdays 就是 null，不要自己猜。`;

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
  };
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

/**
 * 從貼文找「每週二、四」「每週一至五」「每週六日」：模型漏掉時的備援。
 * 一定要有「每」，「10/21（週二）」這種日期註記不算。
 */
/** 寫了「每週」「週二、四」「週一到週五」「平日」「週末」這類字才算有寫星期幾 */
const WEEKLY_RE = /(?:每|逢)\s*(?:週|周|星期|禮拜)|(?:週|周|星期|禮拜)\s*[一二三四五六日天]\s*(?:到|至|~|～|-|－|、|,|，|和|與|及)\s*(?:週|周|星期|禮拜)?\s*[一二三四五六日天]|平日|週末|周末|假日/;

/** 模型給的每週幾要貼文（或補充）真的有寫，不然當成每天（模型有時會自己編） */
export function weekdaysInText(weekdays: number[] | null | undefined, text: string): number[] | null {
  return weekdays?.length && WEEKLY_RE.test(text) ? weekdays : null;
}

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

/** 主要模型判讀失敗或地點亂碼時，換備用模型再試 */
export async function extractFromPost(
  env: Env,
  text: string,
  postedAt: number,
  now: number,
): Promise<{ extraction: Extraction | null; raw: string; model: string; garbled: boolean }> {
  const models = [env.AI_MODEL, env.AI_MODEL_FALLBACK].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
  let last: ModelAttempt | null = null;
  for (const m of models) {
    last = await runModel(env, m, text, postedAt, now);
    if (last.ok) break;
    console.warn(`extract with ${m} not usable: fidelity=${last.fidelity.toFixed(2)} error=${last.error ?? ''}`);
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
