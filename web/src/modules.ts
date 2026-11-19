/**
 * 模組：同一套雷達、地圖、清單、回報，換不同主題的資料（跟伺服器的 worker/src/modules.ts 對應）。
 * 洋流有自己的官方航線、車掃、漂流瓶、地標、搜尋關鍵字；其他模組只有大家回報的貼文。
 */
export type ModuleId = 'current' | 'dog' | 'badminton' | 'food' | 'work' | 'taipai';

export interface ModuleDef {
  id: ModuleId;
  /** 完整名稱，也是頁面標題（活動雷達換成洋流以外的主題時用主題的名稱） */
  name: string;
  /** 標題列上的短名稱 */
  short: string;
  /** 切換選單上的說明 */
  tagline: string;
  emoji: string;
  /** 切換選單上的小圖（SVG），沒有就用 emoji */
  icon?: string;
  /** 洋流才有：官方航線、車掃、漂流瓶、地標、搜尋關鍵字、開始時推播 */
  current: boolean;
  /** 清單上一個項目的量詞 */
  unit: string;
  emptyText: string;
  searchPlaceholder: string;
  /** 回報面板的說明 */
  reportIntro: string;
  reportTips: string[];
  /** 判讀結果：不是這個模組要的貼文 */
  notEventText: string;
  noPlaceText: string;
  /** 「說明」按鈕打開的頁面 */
  helpPage: string;
}

/** 紅貴賓（狗狗陪伴的小圖，v1.752 使用者說換紅貴賓）：捲捲的頭頂、垂下來的捲毛耳朵、淺一點的嘴巴，emoji 的貴賓狗是灰白的 */
const RED_POODLE = '<svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true"><g fill="#b4532b"><circle cx="9" cy="17" r="5"/><circle cx="7.6" cy="23" r="5"/><circle cx="8.6" cy="29" r="4.6"/><circle cx="31" cy="17" r="5"/><circle cx="32.4" cy="23" r="5"/><circle cx="31.4" cy="29" r="4.6"/></g><g fill="#c8693a"><circle cx="13.5" cy="10" r="5.6"/><circle cx="20" cy="7" r="6.4"/><circle cx="26.5" cy="10" r="5.6"/><ellipse cx="20" cy="20" rx="10" ry="10.4"/></g><g fill="none" stroke="#8f3d1d" stroke-width="1.1" stroke-linecap="round"><path d="M6 21 q2 -2 4 0 M6.5 27 q2 -2 4 0 M29.5 21 q2 -2 4 0 M29.5 27 q2 -2 4 0 M16.5 6 q2 -2 4 0 M21 9 q2 -2 4 0 M11 11 q2 -2 4 0"/></g><ellipse cx="20" cy="25.6" rx="5.6" ry="4.6" fill="#e0925c"/><circle cx="15.6" cy="19.2" r="2" fill="#2b1810"/><circle cx="24.4" cy="19.2" r="2" fill="#2b1810"/><circle cx="16.2" cy="18.5" r="0.7" fill="#fff"/><circle cx="25" cy="18.5" r="0.7" fill="#fff"/><ellipse cx="20" cy="23.6" rx="2.1" ry="1.5" fill="#2b1810"/><path d="M20 25 v1.6 M17.6 27 q2.4 1.8 4.8 0" fill="none" stroke="#2b1810" stroke-width="1" stroke-linecap="round"/><path d="M19 27.9 q1 2.6 2 0 z" fill="#ef8a8a"/></svg>';

/** 台灣本島（台派雷達的小圖）：Natural Earth 的海岸線簡化，綠色、中間一顆小愛心 */
const TAIWAN_HEART = '<svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true"><path d="M27.6 7.2 L26.7 8.8 L26.8 10.1 L27.4 10.5 L26.5 12.1 L26.4 13.2 L25 15.4 L25.2 16 L23.2 24.2 L21.3 27.7 L20 28.9 L19.3 30.1 L18.7 31.8 L18.3 36 L17.7 35.5 L17.3 35.7 L16.4 32.3 L13.5 29.6 L13.2 29 L12.3 25.8 L11.5 25.2 L11.9 24.7 L11.6 24.1 L12.4 22.6 L12.1 20.7 L12.7 18.3 L17.1 10.5 L18.2 9.9 L20.2 6.2 L23 5.2 L23.5 4.4 L24.8 4 L25.8 5.2 L27.6 5.7 L27.7 6.5 L28.5 6.7 Z" fill="#3f9b5f" stroke="#256b3e" stroke-width="1.2" stroke-linejoin="round"/><path d="M18.6 23.6 c-2.5 -1.7 -3.8 -3 -3.8 -4.6 a1.9 1.9 0 0 1 3.8 -0.6 a1.9 1.9 0 0 1 3.8 0.6 c0 1.6 -1.3 2.9 -3.8 4.6 z" fill="#fff"/></svg>';

/** 洋流的回報說明（改版後只判斷活動）；index.html 的 #report-intro 也是這段 */
const REPORT_INTRO = '看到活動的 Threads 貼文，或 ACCUPASS 活動通、OPENTIX、Peatix、Luma 的活動頁？貼上連結，雷達會判斷是什麼活動（遊行、講座、市集、表演…），讀出活動內容、地點、開始時間，三個都讀到才會標到地圖上給大家看；沒寫幾點開始的從發文的時間算，結束時間可以不寫。';

export const MODULES: ModuleDef[] = [
  {
    id: 'current',
    name: '活動雷達',
    short: '活動雷達',
    tagline: '附近可以參加的活動',
    emoji: '🌊',
    current: true,
    unit: '個',
    emptyText: '',
    searchPlaceholder: '搜尋標題、地點、物品、週六…',
    reportIntro: REPORT_INTRO,
    reportTips: [],
    notEventText: '這則看起來不是可以到場參加的活動。貼文要寫出做什麼、在哪裡、哪天幾點開始，雷達才會收。',
    noPlaceText: '看得出是活動，但貼文寫的地點在地圖上查不到，所以還沒放上雷達。知道在哪裡的話，可以在下面補上完整地址或店名，或在地圖上標出位置。',
    helpPage: 'help.html',
  },
  {
    id: 'dog',
    name: '狗狗陪伴',
    short: '狗狗陪伴',
    tagline: '附近徵人照顧狗狗的工作，和可以幫忙照顧狗狗的人（請注意安全）',
    emoji: '🐶',
    icon: RED_POODLE,
    current: false,
    unit: '個刊登',
    emptyText: '附近還沒有狗狗陪伴的刊登',
    searchPlaceholder: '搜尋地點、薪資、寄宿、週六…',
    reportIntro: '看到徵人照顧狗狗、或有人說可以幫忙照顧狗狗的 Threads 貼文？貼上連結，雷達會判讀地點、期間、時段、薪資或費用，標到地圖上。⚠️ 網路上常有假職缺，雷達會標出可疑的地方，但不保證是真的。',
    reportTips: [
      '收兩種：徵人（飼主、店家找人照顧、陪伴、遛狗）、可照顧（個人說可以幫忙照顧、寄宿、遛狗，免費或收費）。寵物旅館等店家廣告、領養、走失協尋不收。',
      '貼文要寫出地點，最好有門牌或區；只寫到城市的會標成約略位置。',
      '只收單次的：要寫哪天照顧，最多連續 7 天；沒寫日期的、長期的不放上雷達。會顯示到期間最後一天，原貼文刪除或改成「已徵到」會自動下架。',
    ],
    notEventText: '這則看起來不是徵人照顧狗狗、也不是可以幫忙照顧狗狗的貼文。要寫出在哪裡、做什麼，雷達才會收。',
    noPlaceText: '看得出是狗狗陪伴的刊登，但貼文沒寫地點（或查不到），所以還沒放上雷達。知道在哪裡的話，可以在下面補充地點再判讀一次。',
    helpPage: 'help-dog.html',
  },
];

MODULES.push({
  id: 'badminton',
  name: '羽球臨打',
  short: '羽球臨打',
  tagline: '附近開放臨打的球團，和想找臨打的球友',
  emoji: '🏸',
  current: false,
  unit: '場',
  emptyText: '附近還沒有羽球臨打',
  searchPlaceholder: '搜尋球館、程度、費用、週六…',
  reportIntro: '看到招臨打（球團開放名額）或找臨打（球友想找地方打）的 Threads 貼文？貼上連結，雷達會判讀球館、時段、費用、程度、缺幾位，標到地圖上。',
  reportTips: [
    '收兩種：招臨打（球團、場主開放臨打名額）、找臨打（球友想找球團、找人一起打）。賣球具、教練招生、比賽報名不收。',
    '只收單次的：招臨打要寫出球館和哪天幾點；「每週三 19:00–22:00」這種每週固定場不收。',
    '找臨打要寫出想打的時段（例如「這週六下午」），顯示到那個時段結束；沒寫時間的不收。原貼文刪除或改成「名額已滿」「臨打取消」會自動下架。',
  ],
  notEventText: '這則看起來不是招臨打或找臨打的貼文。要寫出球館和時段（或想打的地區），雷達才會收。',
  noPlaceText: '看得出是羽球臨打，但貼文沒寫球館或地區（或查不到），所以還沒放上雷達。知道在哪裡的話，可以在下面補充地點再判讀一次。',
  helpPage: 'help-badminton.html',
});

MODULES.push({
  id: 'food',
  name: '美食品味',
  short: '美食品味',
  tagline: '附近的餐車、市集攤位，網友推薦的店，揪團吃飯',
  emoji: '🍜',
  current: false,
  unit: '個',
  emptyText: '附近還沒有美食品味的資料',
  searchPlaceholder: '搜尋店名、吃什麼、地點、週六…',
  reportIntro: '看到餐車、市集攤位出攤，網友推薦的店，或揪團吃飯的 Threads 貼文？貼上連結，雷達會判讀地點、時間、吃什麼、價位，標到地圖上。',
  reportTips: [
    '收三種：出攤（餐車、市集攤位公告哪天幾點在哪裡）、推薦（網友推薦某家店）、揪團（揪人一起吃飯）。店家自己的優惠、限量、新開幕廣告不收。',
    '只收單次的：出攤要寫出哪天幾點、在哪裡；「每週六都在 xx 市集」這種每週固定擺攤、網友推薦的店（長期都在）不收。',
    '揪團要寫出約的時間，顯示到那時；沒寫時間的不收。原貼文刪除或改成「今天不出攤」「揪滿了」會自動下架。',
  ],
  notEventText: '這則看起來不是出攤、推薦或揪團吃飯的貼文。要寫出店名、攤位或地點，雷達才會收。',
  noPlaceText: '看得出是吃的，但貼文沒寫店名、地點（或查不到），所以還沒放上雷達。知道在哪裡的話，可以在下面補充地點再判讀一次。',
  helpPage: 'help-food.html',
});

MODULES.push({
  id: 'work',
  name: '找工作',
  short: '找工作',
  tagline: '附近的短期、兼職、工讀，和想找這類工作的人（請注意安全）',
  emoji: '🐝',
  current: false,
  unit: '個刊登',
  emptyText: '附近還沒有找工作的刊登',
  searchPlaceholder: '搜尋地點、工作內容、時薪、週六…',
  reportIntro: '看到徵短期、兼職、工讀，或有人想找這類工作的 Threads 貼文？貼上連結，雷達會判讀工作內容、地點、期間、時段、薪資、怎麼應徵，標到地圖上。⚠️ 網路上常有假職缺，雷達會標出可疑的地方，但不保證是真的。',
  reportTips: [
    '收兩種：徵人（選舉、活動、展場、店家的工讀、兼職、臨時工）、求職（個人想找短期、兼職、工讀）。正職、人力銀行或派遣的職缺廣告、沒有薪水的志工招募不收。',
    '貼文要寫出地點，最好有門牌或區；只寫到區或城市的會標成約略位置（例如「主要在大安區」）。',
    '只收單次的：要寫哪天上工，最多連續 7 天；沒寫日期的、長期的（長期徵人、求職）不放上雷達。會顯示到工作期間最後一天，原貼文刪除或改成「已徵到」「已找到」會自動下架。',
  ],
  notEventText: '這則看起來不是短期、兼職、工讀的徵人，也不是想找這類工作的貼文。要寫出在哪裡、做什麼，雷達才會收。',
  noPlaceText: '看得出是找工作的刊登，但貼文沒寫地點（或查不到），所以還沒放上雷達。知道在哪裡的話，可以在下面補充地點再判讀一次。',
  helpPage: 'help-work.html',
});

MODULES.push({
  id: 'taipai',
  name: '台派雷達',
  short: '台派雷達',
  tagline: '附近的台派店家：吃的、喝的、書店、選物…',
  emoji: '🏪',
  icon: TAIWAN_HEART,
  current: false,
  unit: '家',
  emptyText: '附近還沒有台派店家',
  searchPlaceholder: '搜尋店名、地點、咖啡、週一…',
  reportIntro: '看到介紹台派店家的 Threads 貼文（店家自己表態，或網友推薦、整理的台派店家）？貼上連結，雷達會讀出每一家店的名稱、地點、營業時間和類型，標到地圖上。',
  reportTips: [
    '貼文要寫出這家店是台派（例如「台派店家」「挺台灣」），店家自己帳號的簡介寫了也算；都沒寫的話，可以在「補充資料」說明。抵制、黑名單不收。',
    '一則貼文可以有好幾家店（最多 10 家）。營業時間照貼文寫的，貼文沒寫會看店家帳號的簡介，雷達會標現在有沒有開；都沒寫也收。',
    '確認前可以按「補充資料」直接改店名、地點、營業時間、類型，位置不對可以在雷達上標。放上雷達後一年內都會顯示，原貼文刪除會自動下架。',
  ],
  notEventText: '這則看起來不是在介紹台派店家。貼文要寫出店名或地點，也要寫出這家店是台派（店家自己帳號的簡介寫了也算）；都沒寫的話可以按「補充資料」說明為什麼是台派。',
  noPlaceText: '看得出是台派店家，但貼文沒寫地點（或查不到），所以還沒放上雷達。知道在哪裡的話，可以在下面補上地址或在地圖上標出位置。',
  helpPage: 'help-taipai.html',
});

export const DEFAULT_MODULE: ModuleId = 'current';
export const getModule = (id: string | null | undefined): ModuleDef => MODULES.find((m) => m.id === id) ?? (MODULES[0] as ModuleDef);

/** 職缺的防詐提醒（伺服器判讀時標的） */
export const JOB_RISK_TEXT: Record<string, string> = {
  no_employer: '沒寫雇主或單位名稱',
  form_only: '只留表單，沒有電話也沒有單位名稱：常見蒐集個資的手法',
  line_only: '只要你加 LINE，沒有電話也沒有單位名稱：常見把人引到私下聊天再詐騙',
  money: '提到保證金、先付款、提款卡或帳戶：詐騙常見，千萬不要給',
};

/** 可照顧（個人說可以幫忙照顧）：給飼主的安全提醒 */
export const OFFER_SAFETY_TIPS = [
  '把狗狗交給陌生人前，先見面、看看照顧的環境，確認對方的真實姓名和聯絡方式。',
  '先說好照顧方式、時間、緊急時的處理和就醫，留下狗狗的病歷、晶片資料。',
  '不要預付費用或保證金；說是免費的，中途要求收費要特別小心。',
  '照顧期間請對方定時傳照片、影片回報；覺得不對勁就提早接回。',
];

/** 求職（找工作：個人想找工作）：聯絡前的安全提醒（看的人可能是要找人的，也可能是想找工作的） */
export const SEEK_SAFETY_TIPS = [
  '要找人：私訊說清楚單位名稱、工作內容、時薪、地點和時間。',
  '想找工作：說要先付保證金、訓練費，或要你給提款卡、帳戶的都是詐騙。',
  '第一次見面約在公開場所，告訴家人朋友去哪裡、跟誰。',
  '不要在公開的留言寫電話、身分證字號、住址。',
];

/** 揪團吃飯：跟網友吃飯前的安全提醒 */
export const MEETUP_SAFETY_TIPS = [
  '第一次見面約在人多的店或公開場所，告訴家人朋友去哪裡、跟誰。',
  '各付各的；不要先轉帳給不認識的人「幫忙訂位」。',
  '喝酒要節制，自己的飲料不要離開視線；覺得不對勁就先離開。',
];

/** 每則職缺都顯示的防詐提醒 */
export const JOB_SAFETY_TIPS = [
  '不要先付任何費用（保證金、押金、訓練費、代墊）。',
  '不要給身分證、提款卡、存摺、網銀帳密，也不要幫忙收款、轉帳。',
  '先確認雇主是誰、在哪裡；見面約在公開場所，告訴家人朋友。',
  '「高薪、輕鬆、只留表單或 LINE」要特別小心。遇到可疑的打 165 反詐騙專線。',
];
