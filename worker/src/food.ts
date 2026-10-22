/**
 * 等一下吃什麼模組：判讀三種貼文
 * - vendor 出攤（店家發布）：餐車、市集攤位、快閃攤位公告哪天幾點在哪裡擺攤；照洋流的場次排（每週固定的當成固定擺攤）
 * - recommend 推薦（網友）：推薦某家店、某個攤位好吃；當成刊登（events.ts 的 planPostings）
 * - meetup 揪團（網友）：揪人一起吃飯；當成刊登，寫了約的時間就到那個時段結束
 * 店名、吃什麼、價位、營業時間、缺幾人、怎麼報名放在 extra。店家自己的優惠、限量、新開幕廣告不收。
 */
import { conf, normalizeWeekdays, parseLoose, str, type ExtractedEvent, type Extraction, type ExtractSpec } from './extract';

const MAX_FOOD = 6;

const FOOD_PROMPT = `你是「等一下吃什麼」雷達的資料抽取器。你會收到一則台灣 Threads 貼文，判斷它是不是下面三種之一，並抽出資訊：
- vendor（出攤）：餐車、市集攤位、快閃攤位公告哪天幾點在哪裡擺攤（攤販自己或市集主辦發的）。
- recommend（推薦）：網友推薦某家店、某個攤位好吃（美食心得、推薦文），寫了店名或地點。
- meetup（揪團）：網友揪人一起吃飯，例如「今晚想吃火鍋缺 2 人」「週六中午揪吃燒肉」。

只輸出 JSON：
{
  "is_event": 是否是上面三種之一（布林值）,
  "events": [ vendor 每個「地點 + 時段」一筆；recommend 每家店一筆；meetup 每則一筆；最多 ${MAX_FOOD} 筆 ]
}

events 每筆的欄位：
- role: "vendor"、"recommend" 或 "meetup"
- title: 16 字以內的短標題。vendor 寫攤名加地點，例如「阿明炸雞餐車（大安森林公園）」；recommend 寫店名加推薦什麼，例如「阿城鵝肉推薦鵝肉麵」；meetup 寫什麼時候吃什麼，例如「今晚揪吃火鍋」。地點、城市要是貼文寫的，貼文沒寫城市就不要加
- shop: 店名、攤名；沒寫則 null
- food: 吃什麼、賣什麼、推薦什麼，20 字以內；沒寫則 null
- price: 價位原文，例如「一碗 80 元」「人均 500」；沒寫則 null
- hours: recommend 的營業時間原文，例如「11:00-20:00 週一休」；沒寫或不是 recommend 則 null
- start_at: vendor 擺攤開始時間、meetup 約的時間，ISO 8601 含時區，例如 2026-10-25T18:00:00+08:00；相對日期（今天、今晚、明天、週六）以「貼文發布時間」換算；recommend 一律 null；沒寫則 null
- end_at: 結束時間，同格式；沒寫則 null
- place_text: 貼文原文中的店、攤位、市集、約的地點
- place_query: 給地圖搜尋用：有門牌就用門牌；貼文寫了縣市才加縣市，例如「台北市 大安森林公園」「新北市板橋區府中路1號」；只寫店名就只填店名，不要自己猜縣市；推薦沒寫門牌時，用店名加路名或地標（例如「阿城鵝肉 吉林路」），不要只填路名；沒寫則 null
- spot: vendor 每週固定時段在同一個地方擺攤（例如「每週六都在 xx 市集」）為 true；其他 false
- weekdays: spot 為 true 時，每週哪幾天（1 = 週一 … 7 = 週日）；否則 null
- until: 固定擺攤的最後一天 YYYY-MM-DD；沒寫則 null
- slots: meetup 缺幾人，例如「缺 2 人」；其他 null
- contact: meetup 怎麼報名：form（表單）、line（LINE）、dm（私訊、留言）、phone（電話）、other；其他或沒寫則 null。付款方式（現金、Line Pay）不是聯絡方式
- confidence: 0 到 1 的信心分數

規則：
- 店家自己的優惠、限量、新開幕、新菜單廣告不收（餐車、市集攤位公告出攤時間地點的除外）；食譜、在家煮、外送平台廣告、徵人、沒寫店名也沒寫地點的心得，is_event 為 false，events 為空陣列。
- vendor 每週固定時段的只輸出一筆（不要每週拆一筆），start_at、end_at 填最近一次的時段。
- vendor 只有時間沒有地點、或只有地點沒有時間，confidence 必須低於 0.5；recommend 有店名或地點就可以；meetup 有地點或地區就可以。
- 不要編造貼文裡沒有的時間、地點、店名。`;

const FOOD_SCHEMA = {
  type: 'object',
  properties: {
    is_event: { type: 'boolean' },
    events: {
      type: 'array',
      maxItems: MAX_FOOD,
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['vendor', 'recommend', 'meetup'] },
          title: { type: 'string' },
          shop: { type: ['string', 'null'] },
          food: { type: ['string', 'null'] },
          price: { type: ['string', 'null'] },
          hours: { type: ['string', 'null'] },
          start_at: { type: ['string', 'null'] },
          end_at: { type: ['string', 'null'] },
          place_text: { type: ['string', 'null'] },
          place_query: { type: ['string', 'null'] },
          spot: { type: 'boolean' },
          weekdays: { type: ['array', 'null'], items: { type: 'integer' } },
          until: { type: ['string', 'null'] },
          slots: { type: ['string', 'null'] },
          contact: { type: ['string', 'null'] },
          confidence: { type: 'number' },
        },
        required: ['role', 'title', 'shop', 'food', 'price', 'hours', 'start_at', 'end_at', 'place_text', 'place_query', 'spot', 'until', 'slots', 'contact', 'confidence'],
      },
    },
  },
  required: ['is_event', 'events'],
};

const ROLES = new Set(['vendor', 'recommend', 'meetup']);
const CONTACTS = new Set(['form', 'line', 'dm', 'phone', 'email', 'other']);

export function normalizeFood(raw: unknown): Extraction | null {
  const obj = parseLoose(raw);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const isEvent = o.is_event === true || o.is_event === 'true';
  const list = Array.isArray(o.events) ? o.events.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e)).slice(0, MAX_FOOD) : [];
  const events: ExtractedEvent[] = list.map((e) => {
    const r = (str(e.role) ?? '').toLowerCase();
    const role = ROLES.has(r) ? r : 'recommend';
    const contact = (str(e.contact) ?? '').toLowerCase();
    const until = str(e.until);
    const vendor = role === 'vendor';
    return {
      kind: 'food',
      title: str(e.title) ?? str(e.shop) ?? '等一下吃什麼',
      item: str(e.food),
      // 推薦沒有時間；出攤、揪團才有
      start_at: role === 'recommend' ? null : str(e.start_at),
      end_at: role === 'recommend' ? null : str(e.end_at),
      place_text: str(e.place_text),
      place_query: str(e.place_query),
      confidence: conf(e.confidence),
      spot: vendor && (e.spot === true || e.spot === 'true'),
      until: vendor && until && /^\d{4}-\d{2}-\d{2}/.test(until) ? until.slice(0, 10) : null,
      weekdays: vendor ? normalizeWeekdays(e.weekdays) : null,
      extra: {
        role,
        shop: str(e.shop),
        food: str(e.food),
        price: str(e.price),
        hours: role === 'recommend' ? str(e.hours) : null,
        slots: role === 'meetup' ? str(e.slots) : null,
        contact: role === 'meetup' && CONTACTS.has(contact) ? contact : null,
      },
    };
  });
  return { is_event: isEvent, events: isEvent ? events : [] };
}

/** 等一下吃什麼的判讀 */
export const FOOD_SPEC: ExtractSpec = { system: FOOD_PROMPT, schema: FOOD_SCHEMA, normalize: normalizeFood };
