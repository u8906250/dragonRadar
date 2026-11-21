/**
 * 台派雷達：台派店家（店家自己表態、或網友推薦、整理的台派店家）。
 * 每家店只記名稱、地點、營業時間和店家類型；不是單次的活動，放上雷達後一直顯示（STORE_DAYS），
 * 原貼文刪除、回報問題由管理者下架才拿掉。營業時間讀成每週的時段（hours.ts），雷達照這個標營業中、休息中。
 * 是店家但看不出是台派的（v1.771 使用者說「如果無法判斷為台派店家，可回報給管理員判斷」）：照樣讀出店家資料，
 * 回報的人可以送給管理者判斷（NOT_TAIPAI），通過才放上雷達。
 */
import { aiTags, conf, parseLoose, str, TAGS_SCHEMA, type ExtractedEvent, type Extraction, type ExtractSpec } from './extract';
import { parseHours } from './hours';
import { cleanTaipaiWord, SEED_TAIPAI_WORDS, type TaipaiWordLists } from './taipaiWords';

/** 一則貼文最多幾家（「台派店家推薦」這種清單） */
export const MAX_STORES = 10;
/** 放上雷達後顯示多久：一年後店家還在的話再回報一次 */
export const STORE_DAYS = 365;
/** 判讀結果的 early：是店家，但看不出是台派，要送給管理者判斷才放得上雷達 */
export const NOT_TAIPAI = 'not_taipai';

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

const quoted = (words: string[]): string => words.map((w) => `「${w}」`).join('');

/**
 * 台派雷達的判讀說明：哪些說法算台派照管理者在管理頁決定的台派用詞（taipaiWords.ts）；
 * 飄帶是 v1.769 使用者決定算的，管理者改成不算台派時，發飄帶的說明也拿掉
 */
export function taipaiPrompt(words: TaipaiWordLists): string {
  const ribbon = !words.rejected.includes('飄帶');
  return `你是「台派雷達」的資料抽取器。你會收到一則台灣 Threads 貼文，判斷它是不是在介紹實體店家、看不看得出是台派店家，並抽出每一家店的資料。

台派店家：貼文寫出這家店是台派、挺台灣，可以是店家自己表態，也可以是網友推薦、整理的台派店家清單。${
    words.adopted.length > 0 ? `\n【台派用詞】管理者採用的說法，貼文寫到這些（或意思一樣的說法）就算台派：${quoted(words.adopted)}` : ''
  }${words.rejected.length > 0 ? `\n【不算台派的用詞】管理者決定不算台派的說法：${quoted(words.rejected)}；只靠這些說法（或意思一樣的說法）看不出是台派，taipai 填 false。` : ''}${
    ribbon ? '\n店家在店裡發飄帶（也寫成「漂帶」，例如「歡迎來拿飄帶」「店裡有飄帶可以索取」）也算台派；這種貼文收的是發飄帶的這家店本身（照店家的資料列），不是發放活動。' : ''
  }
【回報的人補充】寫了為什麼是台派的也算。
看不出是台派的店家（單純的美食心得、店家廣告、新開幕）照樣列出店家資料，taipai 填 false，之後由管理者判斷。

只輸出 JSON：
{
  "is_event": 是否在介紹實體店家（布林值；看不出是台派的店家也是 true）,
  "taipai": 看不看得出這些店家是台派（布林值）；is_event 為 false 時填 false,
  "reason": is_event 或 taipai 為 false 時，用一句話（20 字以內）說明，例如「沒寫這家店是台派」「是抵制名單」「沒寫店名」；都是 true 則 null,
  "taipai_by": taipai 為 true 時，判成台派的依據，一個 2～8 字的短詞：跟【台派用詞】意思一樣就照抄那個詞（例如「台派老闆」填「台派」、「歡迎來拿飄帶」填「飄帶」），都不像才照貼文的說法自己寫一個短詞；taipai 為 false 時填 null,
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
- 單純的美食心得、店家廣告、新開幕，沒寫跟台派有關的：is_event 為 true、taipai 為 false，照樣列出每一家店。
- 抵制、黑名單、批評某家店（「不要去 xx」「xx 是紅色店家」）不收，is_event 為 false。
- 沒有實體店面的（網拍、外送、線上課程）不收；活動、市集擺攤不收。
- 沒寫店名也沒寫地點的那一家不要列；只有店名的也可以列，confidence 低一點。
- 不要編造貼文裡沒有的店名、地點、營業時間。
- 貼文最後如果有「【帳號簡介】」，那是發文帳號、貼文標記的帳號的名稱和簡介。帳號是這家店自己的（帳號名稱或簡介跟店名對得上）時：
  - 簡介寫了這家店是台派、挺台灣${ribbon ? '，或寫了店裡發飄帶' : ''}，也算台派；
  - 貼文沒寫的店名、地址、營業時間，可以用簡介寫的；
  - 貼文自己寫了以貼文為準。
  不是這家店自己的帳號（例如推薦的網友自己的帳號）：簡介寫台派也不算這家店是台派，簡介的地址、營業時間也不要用。`;
}

const TAIPAI_SCHEMA = {
  type: 'object',
  properties: {
    is_event: { type: 'boolean' },
    taipai: { type: 'boolean' },
    reason: { type: ['string', 'null'] },
    taipai_by: { type: ['string', 'null'] },
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
  required: ['is_event', 'taipai', 'reason', 'taipai_by', 'tags', 'events'],
};

/** 營業時間最多幾個字 */
export const HOURS_MAX = 100;
export const cleanHours = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t ? [...t].slice(0, HOURS_MAX).join('') : null;
};

/** 一家店存在 events.extra 的欄位：類型（types 是這個雷達的店家類型）、營業時間（原文和讀出來的每週時段） */
export function storeExtra(type: unknown, hours: string | null, types: Record<string, string> = STORE_TYPES): Record<string, unknown> {
  return { type: typeof type === 'string' && Object.prototype.hasOwnProperty.call(types, type) ? type : 'other', hours, open: parseHours(hours) };
}

/** 從帳號簡介讀的是哪幾項（預覽、詳細資料寫明「店家帳號簡介寫的」）：沒有就不帶 */
export const PROFILE_FIELDS = ['taipai', 'hours', 'place'] as const;
export function profileFields(v: unknown): { from_profile?: string[] } {
  const list = Array.isArray(v) ? PROFILE_FIELDS.filter((f) => v.includes(f)) : [];
  return list.length > 0 ? { from_profile: list } : {};
}

/**
 * 判讀結果的每一家店（台派雷達、書店雷達共用）：沒寫店名也沒寫地點的不列，只有店名的拿店名去查；
 * types 是這個雷達的店家類型，fallback 是沒寫店名時的名稱，fromProfile 是這一家哪些資料是從帳號簡介讀的
 */
export function storeEvents(raw: unknown, types: Record<string, string>, fallback: string, fromProfile: (e: Record<string, unknown>) => unknown): ExtractedEvent[] {
  const list = Array.isArray(raw) ? raw.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e)).slice(0, MAX_STORES) : [];
  return list.flatMap((e): ExtractedEvent[] => {
    const name = str(e.name);
    const placeText = str(e.place_text);
    const placeQuery = str(e.place_query);
    if (!name && !placeText && !placeQuery) return [];
    const type = (str(e.type) ?? '').toLowerCase();
    return [
      {
        kind: 'store',
        title: [...(name ?? placeText ?? fallback)].slice(0, 40).join(''),
        item: null,
        start_at: null,
        end_at: null,
        // 只有店名：拿店名去查
        place_text: placeText ?? name,
        place_query: placeQuery ?? (placeText ? null : name),
        confidence: conf(e.confidence),
        spot: false,
        until: null,
        extra: { ...storeExtra(type, cleanHours(e.hours), types), ...profileFields(fromProfile(e)) },
      },
    ];
  });
}

/** rejected 是管理者決定不算台派的用詞：只靠這些判成台派的當成看不出是台派（送管理者判斷） */
export function normalizeTaipai(raw: unknown, rejected: string[] = []): Extraction | null {
  const obj = parseLoose(raw);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const isEvent = o.is_event === true || o.is_event === 'true';
  // 判成台派的依據（台派用詞）
  const word = cleanTaipaiWord(o.taipai_by);
  const refused = word !== null && rejected.includes(word);
  // 沒說是台派（漏了這一欄也算）、依據是管理者決定不算的：等管理者判斷
  const taipai = (o.taipai === true || o.taipai === 'true') && !refused;
  // 看不出是台派：「台派是從簡介讀的」不成立
  const events = storeEvents(o.events, STORE_TYPES, '台派店家', (e) => (taipai ? e.from_profile : Array.isArray(e.from_profile) ? e.from_profile.filter((f) => f !== 'taipai') : null));
  const sure = isEvent && taipai;
  return {
    is_event: isEvent,
    ...(isEvent && !taipai ? { not_taipai: true } : {}),
    reason: sure ? null : isEvent && refused ? `「${word}」管理者決定不算台派` : (str(o.reason)?.slice(0, 60) ?? null),
    ...(sure && word ? { taipai_word: word } : {}),
    events: isEvent ? events : [],
    tags: aiTags(o, isEvent),
  };
}

/** 台派雷達的判讀：照管理者決定的台派用詞 */
export const taipaiSpec = (words: TaipaiWordLists): ExtractSpec => ({ system: taipaiPrompt(words), schema: TAIPAI_SCHEMA, normalize: (raw) => normalizeTaipai(raw, words.rejected) });
/** 台派雷達的判讀（原本的例子；實際判讀照資料庫裡的台派用詞） */
export const TAIPAI_SPEC: ExtractSpec = taipaiSpec(SEED_TAIPAI_WORDS);
