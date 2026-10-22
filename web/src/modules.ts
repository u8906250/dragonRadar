/**
 * 模組：同一套雷達、地圖、清單、回報，換不同主題的資料（跟伺服器的 worker/src/modules.ts 對應）。
 * 洋流有自己的官方航線、車掃、漂流瓶、地標、搜尋關鍵字；其他模組只有大家回報的貼文。
 */
export type ModuleId = 'current' | 'dog';

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

export const MODULES: ModuleDef[] = [
  {
    id: 'current',
    name: '洋流雷達',
    short: '洋流',
    tagline: '附近的洋流飄帶發放、活動、固定據點',
    emoji: '🌊',
    current: true,
    unit: '個',
    emptyText: '',
    searchPlaceholder: '搜尋標題、地點、物品、帳號…',
    reportIntro: '看到發放或活動的 Threads 貼文？貼上連結，雷達會讀取貼文、判讀時間地點，標到地圖上給大家看。店家、服務處連續好幾天的發放也一樣貼，會自動判斷成固定據點。',
    reportTips: [],
    notEventText: '這則看起來不是發放或活動。貼文要寫出在哪裡、什麼時候發放或舉辦，雷達才會收。',
    noPlaceText: '看得出是發放或活動，但貼文沒寫具體地點（或查不到），所以還沒放上雷達。知道在哪裡的話，可以在下面補充地點再判讀一次。',
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

/** 每則職缺都顯示的防詐提醒 */
export const JOB_SAFETY_TIPS = [
  '不要先付任何費用（保證金、押金、訓練費、代墊）。',
  '不要給身分證、提款卡、存摺、網銀帳密，也不要幫忙收款、轉帳。',
  '先確認雇主是誰、在哪裡；見面約在公開場所，告訴家人朋友。',
  '「高薪、輕鬆、只留表單或 LINE」要特別小心。遇到可疑的打 165 反詐騙專線。',
];
