/**
 * 羽球臨打模組：判讀兩種貼文
 * - offer 招臨打（提供）：球團、場主開放臨打名額，抽出球館、時段（每週固定的當成固定場）、費用、程度、缺幾位、用球、球團、怎麼報名；
 *   場次照洋流的發放活動一樣排（開始、結束、每週固定時段）
 * - seek 找臨打（需求）：球友想找地方打，抽出程度、可以打的時間、地區、怎麼聯絡；當成刊登（events.ts 的 planPostings）
 * 臨打自己的欄位放在 extra。
 */
import { conf, normalizeWeekdays, parseLoose, str, type ExtractedEvent, type Extraction, type ExtractSpec } from './extract';

const MAX_SESSIONS = 6;

const SESSION_PROMPT = `你是「羽球臨打雷達」的資料抽取器。你會收到一則台灣 Threads 貼文，判斷它是不是下面兩種之一，並抽出資訊：
- offer（招臨打）：球團、場主開放羽球「臨打」名額（臨時來打球的人，單次付費參加），有球館和時段。「徵臨打」「徵羽球臨打」「招臨打」「缺人」「開放臨打」都是 offer（「徵」是在找人來打）。
- seek（找臨打）：球友自己想去打，「找臨打」「想打」「找球團」「找球友一起打」，寫了程度、可以打的時間或地區。

只輸出 JSON：
{
  "is_event": 是否是上面兩種之一（布林值）,
  "events": [ offer 每個「球館 + 時段」一筆；seek 每則一筆；最多 ${MAX_SESSIONS} 筆 ]
}

events 每筆的欄位：
- role: "offer" 或 "seek"
- title: 16 字以內的短標題。offer 用球館或地點加「羽球臨打」，例如「信義運動中心羽球臨打」「丞風羽球館臨打」；seek 寫程度加地區，例如「中階找臨打（台北東區）」「新手找週末球友」。地點、城市要是貼文寫的，貼文沒寫城市就不要加（不要自己寫「台北」）
- start_at: 開始時間，ISO 8601 含時區，例如 2026-10-25T14:00:00+08:00；相對日期（今天、明天、週六）以「貼文發布時間」換算；無法判斷則 null
- end_at: 結束時間，同格式；沒寫則 null
- place_text: 貼文原文中的球館、學校、運動中心；seek 是想打的地區（例如「台北東區」「板橋」）
- place_query: 給地圖搜尋用：有門牌就用門牌；貼文寫了縣市才加縣市，例如「台北市 信義運動中心」「新北市板橋區文化路一段188巷」；只寫球館名稱、沒寫縣市的，就只填球館名稱（例如「丞風羽球館」），不要自己猜縣市；沒寫則 null
- spot: 每週固定時段都有臨打（例如「每週三 19:00-22:00」「固定每週六下午」）為 true；只有一場為 false
- weekdays: spot 為 true 時，每週哪幾天（1 = 週一 … 7 = 週日），例如「每週二、四」→ [2, 4]；否則 null
- until: 固定場的最後一天 YYYY-MM-DD；沒寫則 null
- fee: 費用原文，例如「$200/人」「250 元（含球）」；沒寫則 null
- level: 程度，例如「新手友善」「中階」「B 級以上」；沒寫則 null
- slots: 缺幾位，例如「缺 2 位」「男 1 女 2」；沒寫則 null
- shuttle: 用球，例如「RSL 4 號」「勝利 Master」；沒寫則 null
- team: 球團名稱；沒寫則 null
- contact: 怎麼報名或聯絡：form（表單）、line（LINE）、dm（私訊、留言）、phone（電話）、email、other；沒寫則 null。付款方式（現金、Line Pay、轉帳）不是聯絡方式
- available: seek 可以打的時間描述，例如「平日晚上」「週末下午」；offer 則 null
- confidence: 0 到 1 的信心分數

規則：
- 賣球拍或球具、教練課程招生、比賽報名、心得分享，is_event 為 false，events 為空陣列。
- seek 沒寫確切日期時段時，start_at、end_at 為 null（寫在 available）；寫了「這週六下午」這種就換算成 start_at、end_at。
- 同一則貼文寫了好幾個球館或好幾個時段，要拆成多筆。
- 每週固定時段的固定場只輸出一筆（不要每週拆一筆），start_at、end_at 填最近一次的時段。
- offer 只有時間沒有地點、或只有地點沒有時間，confidence 必須低於 0.5；seek 有寫地區就可以。
- 不要編造貼文裡沒有的時間或地點。
- 貼文最後如果有「【帳號簡介】」，那是發文帳號或貼文標記的店家帳號的名稱、簡介：貼文沒寫地點時，可以用它找出店名或地址填 place_text、place_query；貼文自己寫了地點時以貼文為準。`;

const SESSION_SCHEMA = {
  type: 'object',
  properties: {
    is_event: { type: 'boolean' },
    events: {
      type: 'array',
      maxItems: MAX_SESSIONS,
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['offer', 'seek'] },
          title: { type: 'string' },
          start_at: { type: ['string', 'null'] },
          end_at: { type: ['string', 'null'] },
          place_text: { type: ['string', 'null'] },
          place_query: { type: ['string', 'null'] },
          spot: { type: 'boolean' },
          weekdays: { type: ['array', 'null'], items: { type: 'integer' } },
          until: { type: ['string', 'null'] },
          fee: { type: ['string', 'null'] },
          level: { type: ['string', 'null'] },
          slots: { type: ['string', 'null'] },
          shuttle: { type: ['string', 'null'] },
          team: { type: ['string', 'null'] },
          contact: { type: ['string', 'null'] },
          available: { type: ['string', 'null'] },
          confidence: { type: 'number' },
        },
        required: ['role', 'title', 'start_at', 'end_at', 'place_text', 'place_query', 'spot', 'until', 'fee', 'level', 'slots', 'shuttle', 'team', 'contact', 'confidence'],
      },
    },
  },
  required: ['is_event', 'events'],
};

const CONTACTS = new Set(['form', 'line', 'dm', 'phone', 'email', 'other']);

export function normalizeSessions(raw: unknown): Extraction | null {
  const obj = parseLoose(raw);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const isEvent = o.is_event === true || o.is_event === 'true';
  const list = Array.isArray(o.events) ? o.events.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e)).slice(0, MAX_SESSIONS) : [];
  const events: ExtractedEvent[] = list.map((e) => {
    const contact = (str(e.contact) ?? '').toLowerCase();
    const until = str(e.until);
    const role = str(e.role)?.toLowerCase() === 'seek' ? 'seek' : 'offer';
    return {
      kind: 'session',
      title: str(e.title) ?? (role === 'seek' ? '找羽球臨打' : '羽球臨打'),
      item: str(e.fee),
      start_at: str(e.start_at),
      end_at: str(e.end_at),
      place_text: str(e.place_text),
      place_query: str(e.place_query),
      confidence: conf(e.confidence),
      // 找臨打是刊登，不是每週的場次
      spot: role === 'offer' && (e.spot === true || e.spot === 'true'),
      until: until && /^\d{4}-\d{2}-\d{2}/.test(until) ? until.slice(0, 10) : null,
      weekdays: normalizeWeekdays(e.weekdays),
      extra: {
        role,
        available: role === 'seek' ? str(e.available) : null,
        fee: str(e.fee),
        level: str(e.level),
        slots: str(e.slots),
        shuttle: str(e.shuttle),
        team: str(e.team),
        contact: CONTACTS.has(contact) ? contact : null,
      },
    };
  });
  return { is_event: isEvent, events: isEvent ? events : [] };
}

/** 羽球臨打的判讀 */
export const SESSION_SPEC: ExtractSpec = { system: SESSION_PROMPT, schema: SESSION_SCHEMA, normalize: normalizeSessions };
