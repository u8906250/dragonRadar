/**
 * 模組：同一套雷達、地圖、清單、回報，換不同主題的資料（跟伺服器的 worker/src/modules.ts 對應）。
 * 洋流有自己的官方航線、車掃、漂流瓶、地標、搜尋關鍵字；其他模組只有大家回報的貼文。
 */
export type ModuleId = 'current' | 'dog' | 'badminton' | 'food';

export interface ModuleDef {
  id: ModuleId;
  /** 完整名稱，也是頁面標題（洋流用主題的名稱） */
  name: string;
  /** 標題列上的短名稱 */
  short: string;
  /** 切換選單上的說明 */
  tagline: string;
  emoji: string;
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

/** 洋流的回報說明（改版後只判斷活動）；index.html 的 #report-intro 也是這段 */
const REPORT_INTRO = '看到活動的 Threads 貼文？貼上連結，雷達會照貼文內容判斷是什麼活動（遊行、講座、市集、表演…），讀出活動內容、地點、開始時間，三個都讀到才會標到地圖上給大家看；結束時間可以不寫。';

export const MODULES: ModuleDef[] = [
  {
    id: 'current',
    name: '洋流雷達',
    short: '洋流',
    tagline: '附近可以參加的活動',
    emoji: '🌊',
    current: true,
    unit: '個',
    emptyText: '',
    searchPlaceholder: '搜尋標題、地點、物品、帳號…',
    reportIntro: REPORT_INTRO,
    reportTips: [],
    notEventText: '這則看起來不是可以到場參加的活動。貼文要寫出做什麼、在哪裡、哪天幾點開始，雷達才會收。',
    noPlaceText: '看得出是活動，但貼文寫的地點在地圖上查不到，所以還沒放上雷達。知道在哪裡的話，可以在下面補上完整地址或店名，或在地圖上標出位置。',
    helpPage: 'help.html',
  },
  {
    id: 'dog',
    name: '狗狗陪伴雷達',
    short: '狗狗陪伴',
    tagline: '附近徵人照顧狗狗的工作，和可以幫忙照顧狗狗的人（請注意安全）',
    emoji: '🐶',
    current: false,
    unit: '個刊登',
    emptyText: '附近還沒有狗狗陪伴的刊登',
    searchPlaceholder: '搜尋地點、薪資、免費、寄宿…',
    reportIntro: '看到徵人照顧狗狗、或有人說可以幫忙照顧狗狗的 Threads 貼文？貼上連結，雷達會判讀地點、期間、時段、薪資或費用，標到地圖上。⚠️ 網路上常有假職缺，雷達會標出可疑的地方，但不保證是真的。',
    reportTips: [
      '收兩種：徵人（飼主、店家找人照顧、陪伴、遛狗）、可照顧（個人說可以幫忙照顧、寄宿、遛狗，免費或收費）。寵物旅館等店家廣告、領養、走失協尋不收。',
      '貼文要寫出地點，最好有門牌或區；只寫到城市的會標成約略位置。',
      '會顯示到期間最後一天；沒寫期間的顯示 14 天。原貼文刪除或改成「已徵到」會自動下架。',
    ],
    notEventText: '這則看起來不是徵人照顧狗狗、也不是可以幫忙照顧狗狗的貼文。要寫出在哪裡、做什麼，雷達才會收。',
    noPlaceText: '看得出是狗狗陪伴的刊登，但貼文沒寫地點（或查不到），所以還沒放上雷達。知道在哪裡的話，可以在下面補充地點再判讀一次。',
    helpPage: 'help-dog.html',
  },
];

MODULES.push({
  id: 'badminton',
  name: '羽球臨打雷達',
  short: '羽球臨打',
  tagline: '附近開放臨打的球團，和想找臨打的球友',
  emoji: '🏸',
  current: false,
  unit: '場',
  emptyText: '附近還沒有羽球臨打',
  searchPlaceholder: '搜尋球館、程度、費用…',
  reportIntro: '看到招臨打（球團開放名額）或找臨打（球友想找地方打）的 Threads 貼文？貼上連結，雷達會判讀球館、時段、費用、程度、缺幾位，標到地圖上。',
  reportTips: [
    '收兩種：招臨打（球團、場主開放臨打名額）、找臨打（球友想找球團、找人一起打）。賣球具、教練招生、比賽報名不收。',
    '招臨打要寫出球館和時段；「每週三 19:00–22:00」這種會排成每週的固定場。',
    '找臨打沒寫確切時間的顯示 7 天；寫了想打的時段就顯示到那個時段結束。原貼文刪除或改成「名額已滿」「臨打取消」會自動下架。',
  ],
  notEventText: '這則看起來不是招臨打或找臨打的貼文。要寫出球館和時段（或想打的地區），雷達才會收。',
  noPlaceText: '看得出是羽球臨打，但貼文沒寫球館或地區（或查不到），所以還沒放上雷達。知道在哪裡的話，可以在下面補充地點再判讀一次。',
  helpPage: 'help-badminton.html',
});

MODULES.push({
  id: 'food',
  name: '等一下吃什麼',
  short: '吃什麼',
  tagline: '附近的餐車、市集攤位，網友推薦的店，揪團吃飯',
  emoji: '🍜',
  current: false,
  unit: '個',
  emptyText: '附近還沒有等一下吃什麼的資料',
  searchPlaceholder: '搜尋店名、吃什麼、地點…',
  reportIntro: '看到餐車、市集攤位出攤，網友推薦的店，或揪團吃飯的 Threads 貼文？貼上連結，雷達會判讀地點、時間、吃什麼、價位，標到地圖上。',
  reportTips: [
    '收三種：出攤（餐車、市集攤位公告哪天幾點在哪裡）、推薦（網友推薦某家店）、揪團（揪人一起吃飯）。店家自己的優惠、限量、新開幕廣告不收。',
    '出攤要寫出時間和地點；「每週六都在 xx 市集」這種會排成每週固定擺攤。推薦要寫出店名或地點。',
    '推薦顯示 14 天；揪團寫了約的時間就顯示到那時，沒寫顯示 3 天。原貼文刪除或改成「今天不出攤」「揪滿了」會自動下架。',
  ],
  notEventText: '這則看起來不是出攤、推薦或揪團吃飯的貼文。要寫出店名、攤位或地點，雷達才會收。',
  noPlaceText: '看得出是吃的，但貼文沒寫店名、地點（或查不到），所以還沒放上雷達。知道在哪裡的話，可以在下面補充地點再判讀一次。',
  helpPage: 'help-food.html',
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
