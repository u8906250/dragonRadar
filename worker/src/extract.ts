import type { Env } from './env';
import { formatTaipei } from './util';

/** 一則貼文裡的一個發放場次（地點或時段不同就是不同場次） */
export interface ExtractedEvent {
  title: string;
  item: string | null;
  start_at: string | null;
  end_at: string | null;
  place_text: string | null;
  place_query: string | null;
  confidence: number;
}

export interface Extraction {
  is_giveaway: boolean;
  events: ExtractedEvent[];
}

const MAX_EVENTS_PER_POST = 6;

const EVENT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    item: { type: ['string', 'null'] },
    start_at: { type: ['string', 'null'] },
    end_at: { type: ['string', 'null'] },
    place_text: { type: ['string', 'null'] },
    place_query: { type: ['string', 'null'] },
    confidence: { type: 'number' },
  },
  required: ['title', 'item', 'start_at', 'end_at', 'place_text', 'place_query', 'confidence'],
};

const SCHEMA = {
  type: 'object',
  properties: {
    is_giveaway: { type: 'boolean' },
    events: { type: 'array', items: EVENT_SCHEMA, maxItems: MAX_EVENTS_PER_POST },
  },
  required: ['is_giveaway', 'events'],
};

const SYSTEM_PROMPT = `你是「洋流雷達」的資料抽取器。你會收到一則台灣 Threads 貼文，請判斷它是否在宣告「實體發放」：
在特定時間與地點，免費發送飄帶、貼紙、文宣、周邊、飲料等給到場的人（常見於競選服務處、競選總部、車掃、市場開講）。

只輸出 JSON：
{
  "is_giveaway": 是否為實體發放公告（布林值）,
  "events": [ 每一個「地點 + 時段」一筆，最多 ${MAX_EVENTS_PER_POST} 筆 ]
}

events 每筆的欄位：
- title: 12 字以內的短標題，例如「秀水服務處發飄帶」
- item: 發放的物品，例如「洋流飄帶」；沒寫則 null
- start_at: 開始時間，ISO 8601 含時區，例如 2026-10-17T15:00:00+08:00；無法判斷則 null
- end_at: 結束時間，同格式；沒有明確結束時間則 null
- place_text: 貼文原文中的地點描述
- place_query: 給地圖搜尋用的地址或地名。有門牌地址就用地址；一定要補上縣市（和鄉鎮區），例如「宜蘭縣羅東鎮光榮路218號」「台北市 捷運市政府站 2號出口」。只有「XX服務處」「競選總部」而沒有地址時，填你能確定的最具體地名；沒有則 null
- confidence: 這一筆 0 到 1 的信心分數

規則：
- 相對時間（今天、今晚、明天、週六、等等、下午）以「貼文發布時間」為基準換算，時區一律 +08:00。「今晚 5 點半」是發文當天 17:30。
- 「早上 9 點到下午 5 點」這種時段，start_at 是 9:00、end_at 是 17:00。
- 同一則貼文有多個地點或多個時段，要拆成多筆 events。
- 「發完為止」「數量有限」代表沒有明確結束時間，end_at 為 null。
- 新聞報導、心得、徵求、詢問、線上抽獎、販售、已經結束的活動回顧，is_giveaway 為 false，events 為空陣列。
- 只有時間沒有地點、或只有地點沒有時間，該筆 confidence 必須低於 0.5。
- 不要編造貼文裡沒有的時間或地點，可以依上下文補上縣市。`;

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

function normalizeEvent(o: Record<string, unknown>): ExtractedEvent {
  return {
    title: str(o.title) ?? '發放活動',
    item: str(o.item),
    start_at: str(o.start_at),
    end_at: str(o.end_at),
    place_text: str(o.place_text),
    place_query: str(o.place_query),
    confidence: conf(o.confidence),
  };
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
  const isGiveaway = o.is_giveaway === true || o.is_giveaway === 'true';
  let events: ExtractedEvent[] = [];
  if (Array.isArray(o.events)) {
    events = o.events
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e))
      .slice(0, MAX_EVENTS_PER_POST)
      .map(normalizeEvent);
  } else if ('start_at' in o || 'place_text' in o || 'place_query' in o) {
    events = [normalizeEvent(o)];
  }
  return { is_giveaway: isGiveaway, events: isGiveaway ? events : [] };
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
