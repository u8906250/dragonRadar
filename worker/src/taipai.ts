/**
 * 台派雷達：台派店家（店家自己表態、或網友推薦、整理的台派店家）。
 * 每家店只記名稱、地點、營業時間和店家類型；不是單次的活動，放上雷達後一直顯示（STORE_DAYS），
 * 原貼文刪除、回報問題由管理者下架才拿掉。營業時間讀成每週的時段（hours.ts），雷達照這個標營業中、休息中。
 */
import { aiTags, conf, parseLoose, str, TAGS_SCHEMA, type ExtractedEvent, type Extraction, type ExtractSpec } from './extract';
import { parseHours } from './hours';

/** 一則貼文最多幾家（「台派店家推薦」這種清單） */
const MAX_STORES = 10;
/** 放上雷達後顯示多久：一年後店家還在的話再回報一次 */
export const STORE_DAYS = 365;

/** 店家類型（雷達、地圖的小圖示和類型按鈕照這個分；跟網頁的 topic-icons.ts STORE_TYPES 一樣） */
export const STORE_TYPES: Record<string, string> = {
  eat: '餐廳小吃',
  cafe: '咖啡甜點',
  drink: '飲料',
  bar: '酒吧',
  book: '書店',
  shop: '選物雜貨',
  beauty: '美髮美容',
  stay: '住宿',
  clinic: '醫療',
  other: '其他',
};
export const isStoreType = (v: unknown): v is string => typeof v === 'string' && Object.prototype.hasOwnProperty.call(STORE_TYPES, v);

const TAIPAI_PROMPT = `你是「台派雷達」的資料抽取器。你會收到一則台灣 Threads 貼文，判斷它是不是在介紹台派店家，並抽出每一家店的資料。

台派店家：貼文寫出這家店是台派、挺台灣（例如「台派店家」「台派老闆」「挺台店家」「顧台灣」「台灣價值」「支持台灣主權、民主」），可以是店家自己表態，也可以是網友推薦、整理的台派店家清單。
店家在店裡發飄帶（也寫成「漂帶」，例如「歡迎來拿飄帶」「店裡有飄帶可以索取」）也算台派；這種貼文收的是發飄帶的這家店本身（照店家的資料列），不是發放活動。
【回報的人補充】寫了為什麼是台派的也算。

只輸出 JSON：
{
  "is_event": 是否在介紹台派店家（布林值）,
  "reason": is_event 為 false 時，用一句話（20 字以內）說明為什麼不算，例如「沒寫這家店是台派」「是抵制名單」「沒寫店名」；true 則 null,
  "tags": 這則貼文的關鍵字 3～6 個，每個 2～4 字、不含 #，只寫貼文裡提到的，讓人搜尋得到，例如「咖啡」「早午餐」「寵物友善」「手作」；不要寫地名、店名、時間、人名，也不要寫「台派」,
  "events": [ 每家店一筆，最多 ${MAX_STORES} 筆 ]
}

events 每筆的欄位：
- name: 店名，照貼文寫的（不要加地點）
- type: 店家類型，只能選一個：eat（餐廳、小吃、便當、早餐店）、cafe（咖啡廳、甜點、麵包、早午餐）、drink（手搖飲、果汁、茶飲）、bar（酒吧、居酒屋、精釀啤酒）、book（書店、獨立書店）、shop（服飾、雜貨、文創、選物、花店、超市等賣東西的店）、beauty（美髮、美甲、美容、按摩）、stay（民宿、旅館、背包客棧）、clinic（診所、牙醫、藥局、動物醫院）、other（其他）
- hours: 營業時間，照貼文（或店家帳號的簡介）寫的整理成一行，例如「週二至週日 11:00–20:00，週一公休」「平日 09:30–20:30，假日 10:00–18:00」；沒寫則 null，不要自己猜
- place_text: 貼文原文中的店址、地點
- place_query: 給地圖搜尋用：有門牌就用門牌；貼文寫了縣市才加縣市，例如「台北市大安區復興南路一段 100 號」；沒寫門牌時用店名加路名或地標（例如「慢工咖啡 師大路」），不要只填路名；只寫店名就只填店名，不要自己猜縣市；沒寫則 null
- from_profile: 這一家哪些資料是從【帳號簡介】讀的（貼文沒寫、簡介寫了）："taipai"（是台派）、"hours"（營業時間）、"place"（地點）；都是貼文寫的則空陣列
- confidence: 0 到 1 的信心分數

規則：
- 只收台派店家。單純的美食心得、店家廣告、新開幕，沒寫跟台派有關的，is_event 為 false。
- 抵制、黑名單、批評某家店（「不要去 xx」「xx 是紅色店家」）不收，is_event 為 false。
- 沒有實體店面的（網拍、外送、線上課程）不收；活動、市集擺攤不收。
- 沒寫店名也沒寫地點的那一家不要列；只有店名的也可以列，confidence 低一點。
- 不要編造貼文裡沒有的店名、地點、營業時間。
- 貼文最後如果有「【帳號簡介】」，那是發文帳號、貼文標記的帳號的名稱和簡介。帳號是這家店自己的（帳號名稱或簡介跟店名對得上）時：
  - 簡介寫了這家店是台派、挺台灣，或寫了店裡發飄帶，也算台派；
  - 貼文沒寫的店名、地址、營業時間，可以用簡介寫的；
  - 貼文自己寫了以貼文為準。
  不是這家店自己的帳號（例如推薦的網友自己的帳號）：簡介寫台派也不算這家店是台派，簡介的地址、營業時間也不要用。`;

const TAIPAI_SCHEMA = {
  type: 'object',
  properties: {
    is_event: { type: 'boolean' },
    reason: { type: ['string', 'null'] },
    tags: TAGS_SCHEMA,
    events: {
      type: 'array',
      maxItems: MAX_STORES,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: Object.keys(STORE_TYPES) },
          hours: { type: ['string', 'null'] },
          from_profile: { type: 'array', items: { type: 'string', enum: ['taipai', 'hours', 'place'] } },
          place_text: { type: ['string', 'null'] },
          place_query: { type: ['string', 'null'] },
          confidence: { type: 'number' },
        },
        required: ['name', 'type', 'hours', 'place_text', 'place_query', 'from_profile', 'confidence'],
      },
    },
  },
  required: ['is_event', 'reason', 'tags', 'events'],
};

/** 營業時間最多幾個字 */
export const HOURS_MAX = 100;
export const cleanHours = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t ? [...t].slice(0, HOURS_MAX).join('') : null;
};

/** 一家店存在 events.extra 的欄位：類型、營業時間（原文和讀出來的每週時段） */
export function storeExtra(type: unknown, hours: string | null): Record<string, unknown> {
  return { type: isStoreType(type) ? type : 'other', hours, open: parseHours(hours) };
}

/** 從帳號簡介讀的是哪幾項（預覽、詳細資料寫明「店家帳號簡介寫的」）：沒有就不帶 */
export const PROFILE_FIELDS = ['taipai', 'hours', 'place'] as const;
function profileFields(v: unknown): { from_profile?: string[] } {
  const list = Array.isArray(v) ? PROFILE_FIELDS.filter((f) => v.includes(f)) : [];
  return list.length > 0 ? { from_profile: list } : {};
}

export function normalizeTaipai(raw: unknown): Extraction | null {
  const obj = parseLoose(raw);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const isEvent = o.is_event === true || o.is_event === 'true';
  const list = Array.isArray(o.events) ? o.events.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e)).slice(0, MAX_STORES) : [];
  const events: ExtractedEvent[] = list.flatMap((e): ExtractedEvent[] => {
    const name = str(e.name);
    const placeText = str(e.place_text);
    const placeQuery = str(e.place_query);
    if (!name && !placeText && !placeQuery) return [];
    const type = (str(e.type) ?? '').toLowerCase();
    return [
      {
        kind: 'store',
        title: [...(name ?? placeText ?? '台派店家')].slice(0, 40).join(''),
        item: null,
        start_at: null,
        end_at: null,
        // 只有店名：拿店名去查
        place_text: placeText ?? name,
        place_query: placeQuery ?? (placeText ? null : name),
        confidence: conf(e.confidence),
        spot: false,
        until: null,
        extra: { ...storeExtra(type, cleanHours(e.hours)), ...profileFields(e.from_profile) },
      },
    ];
  });
  return { is_event: isEvent, reason: isEvent ? null : (str(o.reason)?.slice(0, 60) ?? null), events: isEvent ? events : [], tags: aiTags(o, isEvent) };
}

/** 台派雷達的判讀 */
export const TAIPAI_SPEC: ExtractSpec = { system: TAIPAI_PROMPT, schema: TAIPAI_SCHEMA, normalize: normalizeTaipai };
