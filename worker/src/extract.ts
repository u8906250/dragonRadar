import type { Env } from './env';
import { isAdminOnly } from './geocode';
import { formatTaipei, parseIsoToUnix } from './util';

/** giveaway 發放、activity 活動（洋流）；job 職缺（狗狗陪伴）；session 臨打（羽球臨打）；food 吃的（等一下吃什麼） */
export type EventKind = 'giveaway' | 'activity' | 'job' | 'session' | 'food';

/** 職缺（狗狗陪伴模組）：工作期間、每天時段、薪資、雇主、怎麼應徵 */
export interface JobInfo {
  /** hire 徵人（飼主、店家找人照顧）；offer 可照顧（個人說可以幫忙照顧、寄宿、遛狗，免費或收費） */
  role: 'hire' | 'offer';
  /** 工作期間第一天、最後一天 YYYY-MM-DD；沒寫是 null */
  work_from: string | null;
  work_to: string | null;
  /** 每天的工作時段，例如 ["09:00-12:00", "15:00-18:00"] */
  slots: string[];
  pay: string | null;
  employer: string | null;
  /** form 表單、line、dm 私訊、phone 電話、email、other；沒寫是 null */
  contact: string | null;
  requirements: string | null;
}

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
  /** 職缺才有 */
  job?: JobInfo;
  /** 模組自己的欄位（例如臨打的費用、程度、缺幾位），存在 events.extra */
  extra?: Record<string, unknown> | null;
}

export interface Extraction {
  /** 是否宣告了可到場的實體活動或發放 */
  is_event: boolean;
  events: ExtractedEvent[];
  /** 洋流的活動判讀：不是活動時，模型說的原因（「這是活動心得，不是預告」） */
  reason?: string | null;
  /** 洋流的活動判讀：車掃、掃街、車隊這種一天依序經過好幾個點的，整場的名稱（「蘇巧慧報告號次大車掃」） */
  route_title?: string | null;
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
- weekdays: 固定據點只在每週固定幾天開時，列出星期幾（1 = 週一 … 7 = 週日），例如「每週二、四」→ [2, 4]、「週一到週五」「上班日」「工作日」→ [1, 2, 3, 4, 5]；寫了公休日的列出有開的日子，例如「週一公休」→ [2, 3, 4, 5, 6, 7]；每天都開、或不是固定據點則 null。start_at 填第一個開放日

規則：
- 相對時間（今天、今晚、明天、週六、等等、下午）以「貼文發布時間」為基準換算，時區一律 +08:00。「今晚 5 點半」是發文當天 17:30。
- 「早上 9 點到下午 5 點」這種時段，start_at 是 9:00、end_at 是 17:00。
- 「🈺」是「營業中」的意思：「🈺11-21」「🈺 11:00-21:00」是營業時間 11:00 到 21:00，不是日期（不是 11/21，也不是 21 號）。
- 店家說「本店」「店內」發放，寫了營業時間或每天的發放時段（例如「晚上20-21點發放」），沒寫只有哪一天：是固定據點（spot 為 true），start_at 是發文當天，until 為 null；發放時段照貼文（例如 20:00–21:00），沒寫發放時段就用營業時間。
- 同一則貼文有多個地點或多個時段（例如行程表、車掃停靠點），要拆成多筆 events。
- 固定據點（spot 為 true）每個地點只輸出一筆，不要每天拆一筆；但一天有好幾個時段（例如「11:00–14:00／17:00–19:00」）時，每個時段各輸出一筆，地點、until 等其他欄位都一樣：start_at、end_at 填第一天的開放時段（例如「10/17~10/19 每日 11:00~18:00」→ start_at 10/17 11:00、end_at 10/17 18:00、until 2026-10-19）。沒寫每天幾點時，start_at 填第一天 00:00、end_at 為 null。「即日起」的第一天是發文當天。
- 只寫到幾點、沒寫幾點開始（「今天14:45前我都在」）：14:45 是結束時間（end_at），不是開始時間；start_at 填發文時間，不要自己猜開始時間
- 列出幾個發放時間點、沒寫發到幾點（例如「🕐 13:00｜10 個」「🕒 15:00｜10 個」）：每個時間點各輸出一筆，start_at 是那個時間、end_at 為 null（發完為止），不要合成「13:00–15:00」一段
- 固定據點有寫日期範圍或「每天」就算有時間，不需要因為沒寫幾點而降低 confidence。
- 車掃、遊行等移動路線，每個有時間的停靠點各一筆；沒有停靠點就用出發地。
- 「發完為止」「數量有限」代表沒有明確結束時間，end_at 為 null；但固定據點寫了營業時間或發放時段（例如「營業時間 12:00–21:00 … 發完為止」）時，end_at 是時段的結束時間（21:00）。
- 固定據點平日、假日的時段不同（例如「平日 0930-2030 假日 1000-1800」）：各輸出一筆，平日那筆 weekdays [1, 2, 3, 4, 5]、時段 09:30–20:30，假日那筆 weekdays [6, 7]、時段 10:00–18:00。
- 新聞報導、心得、活動回顧、徵求、詢問、線上抽獎、直播、線上活動、販售，is_event 為 false，events 為空陣列。
- 只有時間沒有地點、或只有地點沒有時間，該筆 confidence 必須低於 0.5。
- 不要編造貼文裡沒有的時間或地點，可以依上下文補上縣市。
- 貼文最後如果有「【回報的人補充】」，那是看到貼文的人補上的地點或時間（例如店名、地址、日期），貼文沒寫的一定要用它補上；跟貼文衝突時以貼文為準。補充寫了店名、或是誰的服務處（例如「陳致中前鎮服務處」），title 要用補充寫的名稱（例如「陳致中前鎮服務處發飄帶」）；貼文有好幾個地點時，只改補充提到的那個地點的 title。補充寫「只有 10/26」「只有那天」就是只有那一天：spot 為 false，start_at 用那天加貼文寫的時段。
- 貼文和補充都沒寫星期幾，weekdays 就是 null，不要自己猜。
- 貼文最後如果有「【帳號簡介】」，那是發文帳號或貼文標記的店家帳號的名稱、簡介。貼文沒寫地點時，用它找出店名或地址填 place_text、place_query（例如「由 @luguocafe 代為發放」、簡介是「爐鍋咖啡」→ place_query「爐鍋咖啡」；簡介有地址就用地址）；簡介沒有店名也沒有地址就不要用。貼文自己寫了地點時以貼文為準。
- 活動在國外（例如美國灣區、日本、歐洲的僑胞、留學生活動）：一樣要抽出來。start_at、end_at 寫當地的時間（貼文寫的時間就是當地時間），填 country、timezone；place_query 用當地的地名加城市，英文或當地語言，例如「Memorial Park, Cupertino」，不要加台灣的縣市。`;

export function buildMessages(text: string, postedAt: number, now: number, system: string = SYSTEM_PROMPT): Array<{ role: 'system' | 'user'; content: string }> {
  void now;
  const user = `貼文發布時間：${formatTaipei(postedAt)}
（貼文裡的「今天、今晚、明天」都以這個發布日期為準）

貼文內容：
"""
${text.trim()}
"""`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** 一種判讀（每個模組一種）：系統說明、JSON schema、把模型輸出整理成 Extraction */
export interface ExtractSpec {
  system: string;
  schema: object;
  normalize: (raw: unknown) => Extraction | null;
}

/** 洋流：發放、活動、固定據點 */
export const EVENT_SPEC: ExtractSpec = { system: SYSTEM_PROMPT, schema: SCHEMA, normalize: (raw) => normalizeExtraction(raw) };

/** 洋流的活動一則最多幾筆：車掃、掃街的停靠點常超過 6 個（連續好幾天的還是最多 6 天） */
const MAX_ACTIVITY_EVENTS = 20;

const ACTIVITY_SCHEMA = {
  type: 'object',
  properties: {
    is_event: { type: 'boolean' },
    reason: { type: ['string', 'null'] },
    route_title: { type: ['string', 'null'] },
    events: {
      type: 'array',
      maxItems: MAX_ACTIVITY_EVENTS,
      items: {
        type: 'object',
        properties: {
          topic: { type: ['string', 'null'] },
          title: { type: ['string', 'null'] },
          start_at: { type: ['string', 'null'] },
          end_at: { type: ['string', 'null'] },
          place_text: { type: ['string', 'null'] },
          place_query: { type: ['string', 'null'] },
          confidence: { type: 'number' },
          country: { type: ['string', 'null'] },
          timezone: { type: ['string', 'null'] },
        },
        required: ['topic', 'title', 'start_at', 'end_at', 'place_text', 'place_query', 'confidence'],
      },
    },
  },
  required: ['is_event', 'reason', 'events'],
};

const ACTIVITY_PROMPT = `你是「洋流雷達」的活動判讀器。你會收到一則台灣 Threads 貼文，請判斷它是否在宣告「民眾可以到場參加的實體活動」，照貼文內容判斷每一場是什麼主題，並抽出每一場的活動內容、地點、開始時間、結束時間。

活動：在特定時間地點舉行、民眾可以到場參加的，什麼主題都可以，不限政治、競選，例如遊行、講座、座談、讀書會、市集、展覽、表演、音樂會、運動、淨灘、志工、見面會、市政開講、車掃、掃街、造勢晚會、快閃、工作坊、發放小物。店家或個人開放大家去索取、領取東西也算（例如「只限今日小物補貨，現在到 19:00 歡迎索取」）。

只輸出 JSON：
{
  "is_event": 是否宣告了至少一場可到場的實體活動（布林值）,
  "reason": is_event 為 false 時，依這則貼文的內容用一句話（20 字以內）說明為什麼不算，例如「是線上直播」「在販售商品」「只是詢問哪裡有發」「在講昨天的活動心得」；is_event 為 true 則 null,
  "route_title": 車掃、掃街、車隊這種一天依序經過好幾個點的，整場活動的名稱，20 字以內、不含站名，要寫出是誰的，例如「蘇巧慧報告號次大車掃」「吳怡農中正萬華掃街」；不是則 null,
  "events": [ 每一個「地點 + 時段」一筆，最多 ${MAX_ACTIVITY_EVENTS} 筆 ]
}

events 每筆的欄位：
- topic: 這一場的主題，照貼文的內容判斷是什麼活動，2～4 字，例如「遊行」「講座」「座談」「讀書會」「市集」「展覽」「表演」「音樂會」「運動」「淨灘」「志工」「見面會」「開講」「車掃」「掃街」「造勢」「快閃」「工作坊」「發放」。照這一場主要做的事判斷：貼文提到某樣東西（例如飄帶、貼紙）不代表是發放，免費送東西給到場的人才是「發放」；同一則不同場的主題可以不一樣。看不出來則 null，不要只寫「活動」
- title: 活動內容，16 字以內的短標題，要寫出在哪裡做什麼，例如「保安宮市政開講」「景華公園表演同樂會」「華山草地市集」「凱道同志遊行」「秀水服務處發小物」。做什麼要照貼文寫的（遊行、表演、同樂會、講座、市集、掃街、見面會、發東西…），不要自己編；服務處、競選總部要寫出是誰的（看貼文署名或內文的名字）；店家發的寫店名（貼文或【帳號簡介】的名稱，沒有就用帳號），口號（例如「定慧贏」「凍蒜」）不是地點。看不出要做什麼則 null
- start_at: 開始時間，ISO 8601 含時區，例如 2026-10-17T15:00:00+08:00。貼文要寫出哪天、幾點開始；只寫日期沒寫幾點（例如「10/27 市集」）、沒寫幾點開始（例如只寫「14:45 前我都在」）則 null，不要填 00:00，也不要自己猜
- end_at: 結束時間，同格式。貼文要寫出幾點結束（例如「14:00–17:00」「到下午 5 點」「17:00 結束」）；只寫開始時間、「發完為止」「數量有限」、沒寫結束則 null，不要自己推算或補上
- place_text: 貼文原文中的地點描述。內文沒寫地點、但最後有「📍 貼文的地點標記：XX」時，用標記的地點，place_query 填「XX」。hashtag、活動名稱不是地點。「本店」「店裡」「門市」「現場」這種沒寫店名、也沒寫地址的不算地點，place_text、place_query 都給 null（不要只填縣市）
- place_query: 給地圖搜尋用的地址或地名。有門牌地址就用地址；要補上縣市，例如「宜蘭縣羅東鎮光榮路218號」「台北市 大龍峒保安宮」。鄉鎮區只有貼文寫了才加，不要自己猜。店家寫「近XX站」時，用「縣市 + 捷運XX站」。沒有能查的地名則 null
- confidence: 這一筆是真的可到場活動、而且內容時間地點都讀對的信心，0 到 1
- country: 活動在台灣以外的國家時，填國家代碼（ISO 3166-1 兩碼，例如 US、JP）；在台灣則 null
- timezone: 活動在國外時，填當地時區（IANA 名稱，例如 America/Los_Angeles、Asia/Tokyo）；在台灣則 null

規則：
- 相對時間（今天、今晚、明天、週六、下午）以「貼文發布時間」為基準換算，時區一律 +08:00。「今晚 5 點半」是發文當天 17:30。「現在到 19:00」從貼文發布時間開始。
- 貼文的錯字照意思讀，例如「現主時到 19:00」是「現在到 19:00」。
- 「現在開始可以領」「有就可以領」「營業時間內都可以來領」這種沒寫幾點的，is_event 為 true，只輸出發文當天一筆：start_at 是貼文發布時間（貼文或【帳號簡介】寫了營業時間、發文時還沒開門的，用當天開門的時間）；end_at 是當天打烊的時間，只有貼文或【帳號簡介】寫了營業時間才填，沒寫則 null，不要自己猜。
- is_event 為 true 時，events 至少要有一筆；時間或地點沒寫的欄位給 null，不要整筆省略。
- 沒寫地點（例如店家自己發文只寫「今天發放」）不是判成不是活動的理由：is_event 還是 true，place_text、place_query 給 null，系統會再找地點。
- 「早上 9 點到下午 5 點」：start_at 9:00、end_at 17:00。跨過午夜的（「22:00–02:00」）end_at 是隔天 02:00。
- 「🈺」是「營業中」的意思：「🈺11-21」是 11:00 到 21:00，不是日期。
- 同一則貼文有多個地點或多個時段（行程表、車掃停靠點、中午一場晚上一場），每個地點 + 時段各一筆。
- 車掃、掃街、車隊列出的每一個應援點、停靠點都要各一筆，第一站也要，一個都不能少（最多 ${MAX_ACTIVITY_EVENTS} 筆），照貼文的順序；start_at 是預計到那一點的時間，end_at 為 null。每一站的 place_text、place_query 要用那一站自己寫的名稱（例如「② 14:20｜蘇巧慧鶯歌服務處」的 place_query 是「新北市鶯歌區 蘇巧慧服務處」），不要套用前後站的地名。
- 連續好幾天、每天同樣時段的（「10/17~10/19 每日 11:00~18:00」、店家「即日起 每天 12:00–21:00 發放」），每天各一筆，最多 ${MAX_EVENTS_PER_POST} 天；沒寫到哪天為止的，只輸出第一天（「即日起」是發文當天）。
- 新聞報導、心得與活動回顧（只講已經發生的事）、徵求、詢問、線上抽獎、直播、線上活動、販售（有標價、「私訊下單」「面交」），is_event 為 false，events 為空陣列。
- 除了上面這些，寫了今天或之後的時間和地點、民眾可以到場的活動（晚會、講座、市集、遊行、發放…）都算，跟政治、競選無關的也算：沒寫「歡迎參加」、要報名、卡司和內容還沒公布的也算；叫大家追蹤社群帳號留意消息，不代表是線上活動；「現在到 19:00」「只限今日」也是。
- 不要編造貼文裡沒有的內容、時間或地點，可以依上下文補上縣市。
- 貼文最後如果有「【回報的人補充】」，那是看到貼文的人補上的活動內容、地點或時間，貼文沒寫的一定要用它補上；跟貼文衝突時以貼文為準。補充寫了店名、或是誰的服務處，title 要用補充寫的名稱。
- 貼文最後如果有「【帳號簡介】」，那是發文帳號或貼文標記的店家帳號的名稱、簡介。貼文沒寫地點時，用它找出店名或地址填 place_text、place_query；簡介沒有店名也沒有地址就不要用。貼文自己寫了地點時以貼文為準。
- 活動在國外：一樣要抽出來。start_at、end_at 寫當地的時間，填 country、timezone；place_query 用當地的地名加城市，英文或當地語言，不要加台灣的縣市。`;

/** 車掃、掃街、車隊的停靠點常一行一站：「① 14:00｜鶯歌永福宮」「14:20 蘇巧慧鶯歌服務處」 */
const STOP_LINE_RE = /^[\s\p{Extended_Pictographic}\uFE0F]*(?:[①-⑳]|\d{1,2}[.、)）]|[-•・*▶►➤])?\s*(\d{1,2})[:：](\d{2})\s*(?:[｜|│/:：、,，\-–—~～]\s*|\s+)(.+?)\s*$/u;

/** 貼文裡一行一站的清單（時間、站名），至少兩行才算 */
export function routeStopLines(text: string): Array<{ hm: string; name: string }> {
  const out: Array<{ hm: string; name: string }> = [];
  for (const line of halfWidth(text).split('\n')) {
    const m = STOP_LINE_RE.exec(line);
    if (!m) continue;
    const h = Number(m[1]);
    const min = Number(m[2]);
    // 站名去掉 emoji、後面括號的說明；「14:00–16:00 發飄帶」這種是時段，不是站
    const name = m[3].replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').replace(/\s*[（(].*$/, '').trim();
    if (h > 23 || min > 59 || [...name].length < 2 || [...name].length > 30 || /\d{1,2}[:：]\d{2}/.test(name)) continue;
    out.push({ hm: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`, name });
  }
  return out.length >= 2 ? out : [];
}

/**
 * 車掃、掃街、車隊：貼文一行一站的清單跟模型判讀的對一次。模型常漏掉一站，或把前後站的地名套到這一站
 * （「蘇巧慧鶯歌服務處」查成「新北市鶯歌區永福宮」）。同一天、同一個時間的：站名不一樣就照清單，
 * 查詢寫的是別站的地名就換成「縣市 站名」；清單有、模型漏掉的補上。模型的站不只一天、或國外的不動
 */
export function reconcileRouteStops(events: ExtractedEvent[], text: string): ExtractedEvent[] {
  if (!/車掃|掃街|車隊/.test(text)) return events;
  const lines = routeStopLines(text);
  if (lines.length === 0) return events;
  const local = events.filter((e) => !e.country && parseIsoToUnix(e.start_at) !== null);
  const days = new Set(local.map((e) => new Date(((parseIsoToUnix(e.start_at) as number) + 8 * 3600) * 1000).toISOString().slice(0, 10)));
  if (days.size !== 1) return events;
  const [day] = [...days];
  // 查詢用的縣市：模型寫最多的那個
  const cities = local.map((e) => /^(\S{2}[市縣])/.exec(e.place_query ?? '')?.[1]).filter((c): c is string => !!c);
  const city = cities.sort((a, b) => cities.filter((c) => c === b).length - cities.filter((c) => c === a).length)[0] ?? '';
  const core = (name: string): string => [...name].slice(-3).join('');
  const out = [...events];
  for (const { hm, name } of lines) {
    const at = parseIsoToUnix(`${day}T${hm}:00+08:00`);
    const query = city ? `${city} ${name}` : name;
    const same = out.find((e) => !e.country && parseIsoToUnix(e.start_at) === at);
    if (!same) {
      out.push({ kind: 'activity', title: name, item: null, start_at: `${day}T${hm}:00+08:00`, end_at: null, place_text: name, place_query: query, confidence: 0.9, spot: false, until: null, weekdays: null, country: null, timezone: null });
      continue;
    }
    const q = (same.place_query ?? '').replace(/\s+/g, '');
    const others = lines.filter((o) => o.name !== name).map((o) => core(o.name));
    if ((same.place_text ?? '').replace(/\s+/g, '') !== name.replace(/\s+/g, '')) {
      same.place_text = name;
      same.place_query = query;
    } else if (!q.includes(core(name)) && others.some((c) => q.includes(c))) same.place_query = query;
  }
  return out;
}

/** 洋流（改版後）：只判斷活動，每一場要有內容、地點、開始和結束時間 */
/** 模型有時把【帳號簡介】那一整行抄進地點（「@xxx：簡介「…地址：板橋區…」」），或地點只寫帳號（「@bellydailycafe」）：改用查詢用的地址 */
function placeFromBio(placeText: string | null, query: string | null): string | null {
  return placeText && /簡介「|^@[A-Za-z0-9_.]+(?:[：:]|\s*$)/.test(placeText) ? (query ?? placeText) : placeText;
}

/** 每一場的主題（「遊行」「講座」）：拿掉符號、emoji、後面的「活動」，太長（不是一個主題）或只寫「活動」的當成沒寫 */
export function cleanTopic(v: unknown): string | null {
  const t = (str(v) ?? '').replace(/[\s\p{P}\p{S}\p{Extended_Pictographic}\uFE0F]/gu, '');
  const topic = t.length > 2 ? t.replace(/活動$/, '') : t;
  return topic && topic !== '活動' && [...topic].length <= 6 ? topic : null;
}

/** 洋流的活動的主題，存在 events.extra（{ topic }） */
export const topicExtra = (topic: string | null | undefined): Record<string, unknown> | null => (topic ? { topic } : null);

export function normalizeActivities(raw: unknown): Extraction | null {
  const obj = parseLoose(raw);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const isEvent = o.is_event === true || o.is_event === 'true';
  const list = Array.isArray(o.events) ? o.events.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e)) : [];
  const events = list.slice(0, MAX_ACTIVITY_EVENTS).map(
    (e): ExtractedEvent => ({
      kind: 'activity',
      title: str(e.title) ?? '',
      item: null,
      start_at: str(e.start_at),
      end_at: str(e.end_at),
      place_text: placeFromBio(str(e.place_text), str(e.place_query)),
      place_query: str(e.place_query),
      confidence: conf(e.confidence),
      spot: false,
      until: null,
      weekdays: null,
      country: normalizeCountry(e.country),
      timezone: validTimeZone(str(e.timezone)),
      extra: topicExtra(cleanTopic(e.topic)),
    }),
  );
  return {
    is_event: isEvent,
    events: isEvent ? events : [],
    reason: isEvent ? null : (str(o.reason)?.slice(0, 60) ?? null),
    route_title: isEvent ? ([...(str(o.route_title) ?? '')].slice(0, 30).join('') || null) : null,
  };
}

export const ACTIVITY_SPEC: ExtractSpec = { system: ACTIVITY_PROMPT, schema: ACTIVITY_SCHEMA, normalize: normalizeActivities };

/** 一場活動一定要有的：活動內容、地點、開始時間（結束可以不寫） */
export type ActivityPart = 'content' | 'place' | 'start';

/** 貼文寫了半夜 12 點（「00:00」「24:00」「午夜」「凌晨 12 點」） */
const MIDNIGHT_RE = /(?<![\d:：])(?:0?0|24)\s*[:：]\s*00|午夜|零時|凌晨\s*(?:12|十二|0|零)\s*[點時:：]/;

/**
 * 開始時間是半夜 00:00、貼文又沒寫半夜：模型把「10/27」這種只寫日期的填成 00:00，當成沒寫幾點開始。
 * tz 是國外活動的當地時區（台灣是 null）
 */
export function guessedMidnight(start: number, tz: string | null, text: string): boolean {
  const tod = (((start + (tz ? tzOffsetSec(start, tz) : 8 * 3600)) % 86400) + 86400) % 86400;
  return tod === 0 && !MIDNIGHT_RE.test(halfWidth(text));
}

/** 這場活動缺了哪些（照 內容、地點、開始 的順序）；都有回傳空陣列 */
export function missingActivityParts(ex: Pick<ExtractedEvent, 'title' | 'place_text' | 'place_query' | 'start_at'>): ActivityPart[] {
  const out: ActivityPart[] = [];
  if (!ex.title.trim()) out.push('content');
  if (!(ex.place_query ?? ex.place_text)) out.push('place');
  if (parseIsoToUnix(ex.start_at) === null) out.push('start');
  return out;
}

export function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length && t.toLowerCase() !== 'null' ? t : null;
}

export function conf(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export function normalizeKind(v: unknown): EventKind {
  const k = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (k === 'job') return 'job';
  if (k === 'session') return 'session';
  if (k === 'food') return 'food';
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

/** 好幾個時區的國家，照州、省（ISO 3166-2）：回報的人直接填地址時用（沒有模型給的時區）。跨時區的州用大部分地方的 */
const REGION_TZ: Record<string, string> = {
  ...Object.fromEntries('CA OR WA NV'.split(' ').map((s) => [`US-${s}`, 'America/Los_Angeles'])),
  ...Object.fromEntries('CO MT NM UT WY'.split(' ').map((s) => [`US-${s}`, 'America/Denver'])),
  'US-AZ': 'America/Phoenix',
  'US-ID': 'America/Boise',
  ...Object.fromEntries('AL AR IA IL KS LA MN MO MS ND NE OK SD TN TX WI'.split(' ').map((s) => [`US-${s}`, 'America/Chicago'])),
  ...Object.fromEntries('CT DC DE FL GA KY MA MD ME NC NH NJ NY OH PA RI SC VA VT WV'.split(' ').map((s) => [`US-${s}`, 'America/New_York'])),
  'US-MI': 'America/Detroit',
  'US-IN': 'America/Indiana/Indianapolis',
  'US-AK': 'America/Anchorage',
  'US-HI': 'Pacific/Honolulu',
  'CA-BC': 'America/Vancouver',
  'CA-AB': 'America/Edmonton',
  'CA-SK': 'America/Regina',
  'CA-MB': 'America/Winnipeg',
  'CA-ON': 'America/Toronto',
  'CA-QC': 'America/Toronto',
  'CA-NB': 'America/Halifax',
  'CA-NS': 'America/Halifax',
  'CA-PE': 'America/Halifax',
  'CA-NL': 'America/St_Johns',
  'CA-YT': 'America/Whitehorse',
  'CA-NT': 'America/Yellowknife',
  'CA-NU': 'America/Iqaluit',
  'AU-NSW': 'Australia/Sydney',
  'AU-ACT': 'Australia/Sydney',
  'AU-VIC': 'Australia/Melbourne',
  'AU-QLD': 'Australia/Brisbane',
  'AU-SA': 'Australia/Adelaide',
  'AU-WA': 'Australia/Perth',
  'AU-TAS': 'Australia/Hobart',
  'AU-NT': 'Australia/Darwin',
};

export const regionTimeZone = (region: string | null | undefined): string | null => (region ? (REGION_TZ[region] ?? null) : null);

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
const WEEKLY_RE = /(?:每|逢)\s*(?:週|周|星期|禮拜)|(?:週|周|星期|禮拜)\s*[一二三四五六日天]\s*(?:到|至|~|～|-|－|、|,|，|和|與|及)\s*(?:週|周|星期|禮拜)?\s*[一二三四五六日天]|平日|週末|周末|假日|上班日|工作日|公休|店休/;

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
  // 後面接公休、店休的（「每週四公休」）是休息的日子，不是開的日子
  const open = (m: RegExpMatchArray): boolean => !CLOSED_AFTER_RE.test(text.slice((m.index ?? 0) + m[0].length));
  const m = [...text.matchAll(new RegExp(`每\\s*${DAY_LIST}`, 'g'))].find(open);
  if (m) return normalizeWeekdays(dayList(m[1]));
  // 營業時間寫「週三至周日」「週一到週六」這種範圍（前面不是日期的括號）
  const r = [...text.matchAll(/(?<![（(\d/])(?:週|周|星期|禮拜)\s*([一二三四五六日天])\s*(?:到|至|~|～|-|－)\s*(?:週|周|星期|禮拜)\s*([一二三四五六日天])(?![）)])/g)].find(open);
  return r ? normalizeWeekdays(dayList(`${r[1]}到${r[2]}`)) : null;
}

/** 星期幾後面接的休息字樣（「每週四公休」「週一店休」） */
const CLOSED_AFTER_RE = /^\s*(?:固定)?(?:公休|店休|休館|休息|休(?![閒憩假]))/;

/** 「一、三」「二到五」「六日」（前面的週、星期已經拿掉或不拿掉都可以） */
const DAY_LIST = '(?:週|周|星期|禮拜)\\s*([一二三四五六日天](?:\\s*[、,，和與及跟/／]?\\s*(?:[到至~～\\-－]\\s*)?(?:週|周|星期|禮拜)?\\s*[一二三四五六日天])*)';
function dayList(s: string): number[] {
  const out: number[] = [];
  const parts = s.replace(/(?:週|周|星期|禮拜)/g, '').replace(/\s/g, '');
  for (const r of parts.matchAll(/([一二三四五六日天])(?:[到至~～\-－]([一二三四五六日天]))?/g)) {
    const a = WEEKDAY_CHAR[r[1]];
    const b = r[2] ? WEEKDAY_CHAR[r[2]] : a;
    for (let d = a; d <= b; d++) out.push(d);
  }
  return out;
}

/**
 * 固定的公休日：「週一公休」「（週二、週三店休）」「每週一休」「公休：週日」。
 * 「這週六休息」「本週日店休」是臨時的，不算。
 */
export function closedWeekdays(text: string): number[] | null {
  const out: number[] = [];
  const before = new RegExp(`(?<![這本下上今明])(?:每\\s*)?${DAY_LIST}\\s*(?:固定)?(?:公休|店休|休館|休息|休(?![閒憩假]))`, 'g');
  const after = new RegExp(`(?:公休日?|店休日?|休館日|固定休)\\s*[:：]?\\s*(?:每\\s*)?${DAY_LIST}`, 'g');
  for (const re of [before, after]) for (const m of text.matchAll(re)) out.push(...dayList(m[1]));
  const days = [...new Set(out)].sort((a, b) => a - b);
  return days.length > 0 && days.length < 7 ? days : null;
}

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * 固定據點開哪幾天，照貼文（模型漏掉或算錯時的備援）：寫了公休日就是其他天（有寫「每週一到六」就從那幾天扣）；
 * 「上班日」「工作日」是週一到週五（有寫假日、週末的時段就不算）。都沒寫回傳 undefined，照模型的。
 */
export function openWeekdaysFromText(text: string): number[] | null | undefined {
  const listed = weekdaysFromText(text);
  const closed = closedWeekdays(text);
  if (closed) return normalizeWeekdays((listed ?? ALL_DAYS).filter((d) => !closed.includes(d)));
  if (listed) return listed;
  if (/上班日|工作日/.test(text) && !/假日|週末|周末|例假/.test(text)) return [1, 2, 3, 4, 5];
  return undefined;
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
const PM_RE = /下午|晚上|傍晚|晚間/;
/** 一個時刻：「12:00」「0930」「9點半」「下午7點30」「11」（「11-21」那種只寫小時的） */
const CLOCK = '(?:(上午|中午|下午|晚上|傍晚|晚間)\\s*)?(?:([01]\\d|2[0-4])([0-5]\\d)|([01]?\\d|2[0-4])(?:\\s*[:：點時]\\s*([0-5]\\d|半)?)?)';
const RANGE_RE = new RegExp(`(?<![\\d/.])${CLOCK}\\s*(?:[-–—~～至到]|－)\\s*${CLOCK}(?![\\d/.])`, 'g');
const START_RE = new RegExp(`(?<![\\d/.])${CLOCK}(?![\\d/.])\\s*(?:起|開始)`, 'g');

/** 照上午下午換成當天第幾秒；after 是同一段的開始（「11-21」「9點到5點」的結束比開始早就是下午） */
function clockSec(m: RegExpMatchArray, i: number, after?: number): number | null {
  const ampm = m[i] ?? '';
  let h = m[i + 1] !== undefined ? Number(m[i + 1]) : Number(m[i + 3]);
  const min = m[i + 1] !== undefined ? Number(m[i + 2]) : m[i + 4] === '半' ? 30 : m[i + 4] ? Number(m[i + 4]) : 0;
  if (!Number.isFinite(h) || h > 24) return null;
  if (h < 12 && PM_RE.test(ampm)) h += 12;
  if (ampm === '中午' && h < 6) h += 12;
  let sec = h * 3600 + min * 60;
  if (after !== undefined && sec <= after && h < 12) sec += 12 * 3600;
  return sec <= DAY_SEC ? sec : null;
}

/** 文字裡的時段（開始、結束都是當天第幾秒） */
export function timeRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of halfWidth(text).matchAll(RANGE_RE)) {
    const a = clockSec(m, 1);
    const b = a === null ? null : clockSec(m, 6, a);
    if (a !== null && b !== null && b > a) out.push([a, b]);
  }
  return out;
}

/**
 * 固定據點的時段照貼文校正（模型常讀錯）：
 * - 開始時間是貼文某個時段的開始（「11:30～14:30，17:00～20:30」的 11:30）：結束就是那個時段的結束，模型給的不算
 * - 開始時間貼文根本沒寫（只有一個時段時）：貼文只寫了一個開始時間（「每日上午 11:00 起」）就用它
 * - 還是沒有結束：「下午7點30結束」「六點打烊」（endPhrase 為 true 時才看，好幾個地點時不看）
 * 改了回傳 true。
 */
export function spotHoursFromText(ex: Pick<ExtractedEvent, 'spot' | 'start_at' | 'end_at'>, text: string, opts: { endPhrase?: boolean; single?: boolean } = {}): boolean {
  if (!ex.spot) return false;
  const start = parseIsoToUnix(ex.start_at);
  if (start === null) return false;
  let tod = (start + 8 * 3600) % DAY_SEC;
  // 00:00 是沒寫幾點（整天）
  if (tod === 0) return false;
  const day = start - tod;
  const t = halfWidth(text);
  const ranges = timeRanges(t);
  const starts = [...t.matchAll(START_RE)].map((m) => clockSec(m, 1)).filter((x): x is number => x !== null);
  const before = ex.start_at + '|' + ex.end_at;
  // 模型的開始時間貼文沒寫：只有一個候選時才換
  const mentioned = ranges.some(([a]) => a === tod) || starts.includes(tod) || clockMentioned(t, tod);
  if (!mentioned && opts.single) {
    const cands = [...new Set([...ranges.map(([a]) => a), ...starts])];
    if (cands.length === 1) {
      tod = cands[0];
      ex.start_at = taipeiIso(day + tod);
      const endNow = parseIsoToUnix(ex.end_at);
      if (endNow !== null && (endNow + 8 * 3600) % DAY_SEC <= tod) ex.end_at = null;
    }
  }
  const ends = [...new Set(ranges.filter(([a]) => a === tod).map(([, b]) => b))];
  if (ends.length === 1) ex.end_at = taipeiIso(day + ends[0]);
  else if (!ex.end_at && opts.endPhrase) {
    const phrase = /(上午|中午|下午|晚上|傍晚|晚間)?\s*(\d{1,2}|十[一二]?|[一二兩三四五六七八九])\s*[點:：時]\s*(\d{1,2}|半)?\s*分?\s*(?:就)?(?:結束|截止|打烊|收攤|為止)/.exec(t);
    if (phrase) {
      let h = /\d/.test(phrase[2]) ? Number(phrase[2]) : CN_NUM[phrase[2]];
      if (h < 12 && (PM_RE.test(phrase[1] ?? '') || h * 3600 <= tod)) h += 12;
      const end = h * 3600 + (phrase[3] === '半' ? 30 : phrase[3] ? Number(phrase[3]) : 0) * 60;
      if (end > tod && end <= DAY_SEC) ex.end_at = taipeiIso(day + end);
    }
  }
  return ex.start_at + '|' + ex.end_at !== before;
}

/**
 * 這個時段自己寫的星期幾：時段前面、同一句裡的「平日」「假日」「週一到週六」「每天」
 * （「週一到週六 08:30–12:00，平日晚上 18:30–21:00」的晚上是週一到五）。沒寫回傳 undefined。
 */
export function slotWeekdays(text: string, startAt: string | null): number[] | null | undefined {
  const start = parseIsoToUnix(startAt);
  if (start === null) return undefined;
  const tod = (start + 8 * 3600) % DAY_SEC;
  const t = halfWidth(text);
  for (const m of t.matchAll(RANGE_RE)) {
    if (clockSec(m, 1) !== tod) continue;
    const before = t.slice(0, m.index);
    const cut = Math.max(...['；', ';', '，', ',', '。', '\n', '、', '|', '／', '/'].map((c) => before.lastIndexOf(c)));
    const seg = before.slice(cut + 1);
    if (/每天|每日|天天/.test(seg)) return null;
    if (/平日|週間|周間/.test(seg)) return [1, 2, 3, 4, 5];
    if (/假日|週末|周末/.test(seg)) return [6, 7];
    const listed = new RegExp(`(?:每\\s*)?${DAY_LIST}`).exec(seg);
    if (listed) return normalizeWeekdays(dayList(listed[1]));
    return undefined;
  }
  return undefined;
}

/** 文字裡有沒有提到這個時刻（「13:00」「下午1點」「1300」） */
function clockMentioned(t: string, tod: number): boolean {
  for (const m of t.matchAll(new RegExp(`(?<![\\d/.])${CLOCK}(?![\\d/.])`, 'g'))) {
    if (m[2] === undefined && m[5] === undefined && !/[:：點時]/.test(m[0])) continue;
    const sec = clockSec(m, 1);
    if (sec === tod || (sec !== null && sec + 12 * 3600 === tod)) return true;
  }
  return false;
}

/**
 * 「平日 0930-2030 假日 1000-1800」模型只給一筆、沒分星期幾：拆成平日（週一到五）、假日（週六日）各一筆。
 * 已經有分星期幾的不動。
 */
export function splitWeekdayWeekend<T extends Pick<ExtractedEvent, 'spot' | 'start_at' | 'end_at' | 'weekdays'>>(ex: T, text: string): T[] {
  if (!ex.spot || ex.weekdays?.length) return [ex];
  const start = parseIsoToUnix(ex.start_at);
  if (start === null) return [ex];
  const t = halfWidth(text);
  const pick = (label: string): [number, number] | null => {
    const m = new RegExp(`(?:${label})\\s*[:：]?\\s*((?:[^\\n\\d]{0,4})${CLOCK}\\s*(?:[-–—~～至到]|－)\\s*${CLOCK})`).exec(t);
    return m ? (timeRanges(m[1])[0] ?? null) : null;
  };
  const weekday = pick('平日|週一至週五|周一至周五|週一到週五|周一到周五');
  const weekend = pick('假日|例假日|週末|周末|六日|週六日|周六日');
  if (!weekday || !weekend) return [ex];
  const day = start - ((start + 8 * 3600) % DAY_SEC);
  return [
    { ...ex, weekdays: [1, 2, 3, 4, 5], start_at: taipeiIso(day + weekday[0]), end_at: taipeiIso(day + weekday[1]) },
    { ...ex, weekdays: [6, 7], start_at: taipeiIso(day + weekend[0]), end_at: taipeiIso(day + weekend[1]) },
  ];
}

export function parseLoose(raw: unknown): unknown {
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
export async function runModel(env: Env, model: string, text: string, postedAt: number, now: number, spec: ExtractSpec = EVENT_SPEC): Promise<ModelAttempt> {
  const ai = env.AI as unknown as AiRunner;
  const messages = buildMessages(text, postedAt, now, spec.system);
  // Qwen3 預設會先長篇推理，可能把 token 用完沒有輸出；這種抽取工作不需要推理
  if (/qwen3/i.test(model)) messages[messages.length - 1].content += '\n/no_think';
  const t0 = Date.now();
  let result: unknown;
  let error: string | undefined;
  try {
    result = await ai.run(model, {
      messages,
      response_format: { type: 'json_schema', json_schema: spec.schema },
      // 車掃的停靠點最多 20 筆，1200 不夠
      max_tokens: 2400,
      temperature: 0.1,
    });
  } catch (e) {
    error = String(e);
    try {
      result = await ai.run(model, { messages, max_tokens: 2400, temperature: 0.1 });
      error = undefined;
    } catch (e2) {
      error = `${error} / ${String(e2)}`;
    }
  }
  const content = responseContent(result);
  const raw = typeof content === 'string' ? content : JSON.stringify(content ?? null);
  const extraction = error ? null : spec.normalize(content);
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
  opts: { secondOpinion?: boolean; spec?: ExtractSpec } = {},
): Promise<{ extraction: Extraction | null; raw: string; model: string; garbled: boolean }> {
  const models = [env.AI_MODEL, env.AI_MODEL_FALLBACK].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
  let last: ModelAttempt | null = null;
  for (const m of models) {
    const attempt = await runModel(env, m, text, postedAt, now, opts.spec);
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
