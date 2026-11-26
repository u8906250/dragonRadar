/**
 * 書店雷達：獨立書店、二手書店（書店自己介紹，或網友推薦、整理的書店清單）。
 * 跟台派雷達一樣是店家：每家店只記名稱、地點、營業時間和書店類型，放上雷達後一年內都顯示（STORE_DAYS），
 * 營業時間讀成每週的時段（hours.ts），雷達照這個標營業中、休息中。連鎖書店、出版社、網路書店不收。
 */
import { aiTags, parseLoose, str, TAGS_SCHEMA, type Extraction, type ExtractSpec } from './extract';
import { MAX_STORES, storeEvents } from './taipai';

/** 書店類型（雷達、地圖的小圖示和類型按鈕照這個分；跟網頁的 topic-icons.ts BOOK_TYPES 一樣）。key 不能跟台派雷達的店家類型、活動主題重複 */
export const BOOK_TYPES: Record<string, string> = {
  general: '人文綜合',
  issue: '社會議題',
  used: '二手書',
  kids: '童書繪本',
  lit: '文學詩集',
  art: '藝術設計',
  comic: '漫畫',
  other: '其他',
};

const BOOKS_PROMPT = `你是「書店雷達」的資料抽取器。你會收到一則台灣 Threads 貼文，判斷它是不是在介紹實體的獨立書店（含二手書店），並抽出每一家書店的資料。

獨立書店：個人或小團隊經營、自己選書的實體書店，例如社區書店、主題書店（性別、社會議題、繪本、文學、藝術設計、漫畫）、二手書店、書店兼咖啡或展覽空間。可以是書店自己介紹，也可以是網友推薦、整理的書店清單。
【回報的人補充】寫的店名、地點、營業時間也可以用。

只輸出 JSON：
{
  "is_event": 是否在介紹實體的獨立書店或二手書店（布林值）,
  "reason": is_event 為 false 時，用一句話（20 字以內）說明，例如「是連鎖書店」「是書店的講座活動」「沒寫店名」；true 則 null,
  "tags": 這則貼文的關鍵字 3～6 個，每個 2～4 字、不含 #，只寫貼文裡提到的，讓人搜尋得到，例如「女性主義」「繪本」「二手書」「咖啡」「講座」「寵物友善」；不要寫地名、店名、時間、人名，也不要寫「書店」,
  "events": [ 每家書店一筆，最多 ${MAX_STORES} 筆 ]
}

events 每筆的欄位：
- name: 店名，照貼文寫的（不要加地點）
- type: 書店類型，只能選一個，照選書的主題：general（人文、社科、綜合選書的社區書店）、issue（性別、女性主義、同志、人權、環境、台灣歷史與民主等社會議題）、used（二手書店、舊書店）、kids（童書、繪本、親子共讀）、lit（文學、詩集、小說）、art（藝術、設計、攝影、建築、獨立出版刊物 zine）、comic（漫畫）、other（其他，例如旅行、外文、宗教書店）
- hours: 營業時間，照貼文（或書店帳號的簡介）寫的整理成一行，例如「週二至週日 12:00–21:00，週一公休」「平日 13:00–20:00，假日 11:00–20:00」；沒寫則 null，不要自己猜
- place_text: 貼文原文中的店址、地點
- place_query: 給地圖搜尋用：有門牌就用門牌；貼文寫了縣市才加縣市，例如「桃園市中壢區中央西路二段 100 號」；沒寫門牌時用店名加路名或地標（例如「瑯嬛書屋 中壢」），不要只填路名；只寫店名就只填店名，不要自己猜縣市；沒寫則 null
- from_profile: 這一家哪些資料是從【帳號簡介】讀的（貼文沒寫、簡介寫了）："name"（店名）、"hours"（營業時間）、"place"（地點）；都是貼文寫的則空陣列
- confidence: 0 到 1 的信心分數

規則：
- 連鎖書店（誠品、金石堂、墊腳石、何嘉仁、諾貝爾、紀伊國屋這類有很多分店的）、出版社、網路書店、只在網路賣的二手書、圖書館不收。
- 書店自己的帳號發的貼文，內容不一定要介紹自己：公告、在自己店裡辦的活動（講座、讀書會、簽書會、展覽）都算這家書店（is_event 為 true，照書店的資料列，店名、地址、營業時間可以用【帳號簡介】的）。別人（網友、主辦單位）宣傳在書店辦的活動、市集擺攤不收，is_event 為 false（活動請到活動雷達回報）；介紹書店時順便提到活動的照樣收。
- 書展、書店歇業或停業的公告不收。
- 沒寫店名也沒寫地點的那一家不要列；只有店名的也可以列，confidence 低一點。
- 不要編造貼文裡沒有的店名、地點、營業時間。
- 貼文最後如果有「【帳號簡介】」，那是發文帳號、貼文標記的帳號的名稱和簡介。帳號是這家書店自己的（帳號名稱或簡介跟店名對得上）時，貼文沒寫的店名、地址、營業時間可以用簡介寫的；貼文自己寫了以貼文為準。
  不是這家書店自己的帳號（例如推薦的網友自己的帳號）：簡介的地址、營業時間不要用。`;

const BOOKS_SCHEMA = {
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
          type: { type: 'string', enum: Object.keys(BOOK_TYPES) },
          hours: { type: ['string', 'null'] },
          from_profile: { type: 'array', items: { type: 'string', enum: ['name', 'hours', 'place'] } },
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

export function normalizeBooks(raw: unknown): Extraction | null {
  const obj = parseLoose(raw);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const isEvent = o.is_event === true || o.is_event === 'true';
  // 書店雷達沒有「台派」：簡介讀的只算營業時間、地點
  const events = storeEvents(o.events, BOOK_TYPES, '書店', (e) => (Array.isArray(e.from_profile) ? e.from_profile.filter((f) => f !== 'taipai') : null));
  return {
    is_event: isEvent,
    reason: isEvent ? null : (str(o.reason)?.slice(0, 60) ?? null),
    events: isEvent ? events : [],
    tags: aiTags(o, isEvent),
  };
}

/** 書店雷達的判讀 */
export const BOOKS_SPEC: ExtractSpec = { system: BOOKS_PROMPT, schema: BOOKS_SCHEMA, normalize: normalizeBooks };
