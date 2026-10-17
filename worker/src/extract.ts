import type { Env } from './env';
import { formatTaipei } from './util';

export interface Extraction {
  is_giveaway: boolean;
  title: string;
  item: string | null;
  start_at: string | null;
  end_at: string | null;
  place_text: string | null;
  place_query: string | null;
  confidence: number;
}

const SCHEMA = {
  type: 'object',
  properties: {
    is_giveaway: { type: 'boolean' },
    title: { type: 'string' },
    item: { type: ['string', 'null'] },
    start_at: { type: ['string', 'null'] },
    end_at: { type: ['string', 'null'] },
    place_text: { type: ['string', 'null'] },
    place_query: { type: ['string', 'null'] },
    confidence: { type: 'number' },
  },
  required: ['is_giveaway', 'title', 'item', 'start_at', 'end_at', 'place_text', 'place_query', 'confidence'],
};

const SYSTEM_PROMPT = `你是「發放雷達」的資料抽取器。你會收到一則台灣 Threads 貼文，請判斷它是否在宣告一場「實體發放」活動：
在特定時間與地點免費發送貼紙、飲料、周邊、試用品、小物等給到場的人。

只輸出 JSON，欄位如下：
- is_giveaway: 是否為實體發放公告（布林值）
- title: 10 字以內的短標題，例如「市政府站發貼紙」
- item: 發放的物品；沒有則 null
- start_at: 發放開始時間，ISO 8601 含時區，例如 2025-10-17T15:00:00+08:00；無法判斷則 null
- end_at: 發放結束時間，同格式；沒有明確結束時間則 null
- place_text: 貼文原文中的地點描述；沒有則 null
- place_query: 適合地圖搜尋的地點名稱或地址，務必補上縣市，例如「台北市 捷運市政府站 2號出口」；沒有則 null
- confidence: 0 到 1 的信心分數

規則：
- 相對日期（今天、明天、週六、今晚、等等）以「貼文發布時間」為基準換算，時區一律 +08:00。
- 只有時間沒有地點，或只有地點沒有時間，is_giveaway 仍可為 true，但 confidence 必須低於 0.5。
- 徵求、詢問、轉貼心得、線上抽獎、網路活動、販售都不算實體發放，is_giveaway 為 false。
- 「發完為止」代表沒有明確結束時間，end_at 為 null。
- 不要編造貼文裡沒有的時間或地點。`;

export function buildMessages(text: string, postedAt: number, now: number): Array<{ role: 'system' | 'user'; content: string }> {
  const user = `貼文發布時間：${formatTaipei(postedAt)}
現在時間：${formatTaipei(now)}

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
  return t.length ? t : null;
}

/** 把 LLM 回傳的任意東西整理成 Extraction，格式不對就回 null */
export function normalizeExtraction(raw: unknown): Extraction | null {
  let obj = raw;
  if (typeof obj === 'string') {
    const cleaned = obj.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      obj = JSON.parse(cleaned);
    } catch {
      const m = /\{[\s\S]*\}/.exec(cleaned);
      if (!m) return null;
      try {
        obj = JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const confidenceRaw = typeof o.confidence === 'number' ? o.confidence : Number(o.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0;
  const isGiveaway = o.is_giveaway === true || o.is_giveaway === 'true';
  return {
    is_giveaway: isGiveaway,
    title: str(o.title) ?? '發放活動',
    item: str(o.item),
    start_at: str(o.start_at),
    end_at: str(o.end_at),
    place_text: str(o.place_text),
    place_query: str(o.place_query),
    confidence,
  };
}

interface AiRunner {
  run(model: string, inputs: unknown): Promise<unknown>;
}

export async function extractFromPost(
  env: Env,
  text: string,
  postedAt: number,
  now: number,
): Promise<{ extraction: Extraction | null; raw: string }> {
  const ai = env.AI as unknown as AiRunner;
  const result = (await ai.run(env.AI_MODEL, {
    messages: buildMessages(text, postedAt, now),
    response_format: { type: 'json_schema', json_schema: SCHEMA },
    max_tokens: 400,
    temperature: 0.1,
  })) as { response?: unknown } | null;
  const response = result && typeof result === 'object' && 'response' in result ? result.response : result;
  const raw = typeof response === 'string' ? response : JSON.stringify(response ?? null);
  return { extraction: normalizeExtraction(response), raw };
}
