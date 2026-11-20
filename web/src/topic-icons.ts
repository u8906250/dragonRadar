/**
 * 活動的主題分幾類，圓點裡畫一個小圖示：地圖（v1.671 使用者說不同類型的活動在地圖上有不同的圖示）、
 * 全螢幕的雷達（v1.672）共用。主題是 AI 判讀的自由文字，照裡面的字分；分不出來的照舊只畫圓點
 */
const TOPIC_GROUPS: Array<{ key: string; words: RegExp }> = [
  { key: 'gift', words: /發放|贈送|索取|抽獎|領取/ },
  { key: 'rally', words: /造勢|晚會|大會|誓師|成立|拜票|掃街|車掃|應援/ },
  { key: 'talk', words: /開講|講座|論壇|座談|分享|說明|演講|對談|讀書/ },
  { key: 'music', words: /音樂|演唱|表演|演出|戲劇|舞|電影|放映|晚會/ },
  { key: 'market', words: /市集|擺攤|市場|園遊|二手/ },
  { key: 'craft', words: /工作坊|塗鴉|手作|體驗|課程|繪|畫/ },
  { key: 'parade', words: /遊行|踩街|健走|路跑|騎/ },
  { key: 'exhibit', words: /展/ },
  { key: 'care', words: /淨灘|志工|清潔|捐|愛心/ },
  // v1.677 使用者說加聯誼、用愛心（志工改成小樹苗）
  { key: 'social', words: /聯誼|交友|相親|派對|聚會|約會/ },
];
/** 每一類的名稱（搜尋框下面的類型按鈕，v1.676 使用者說提供這些活動類型快速搜尋），照 TOPIC_GROUPS 的順序 */
export const TOPIC_TYPES: Array<{ key: string; label: string }> = [
  { key: 'gift', label: '發放' },
  { key: 'rally', label: '造勢' },
  { key: 'talk', label: '講座' },
  { key: 'music', label: '表演' },
  { key: 'market', label: '市集' },
  { key: 'craft', label: '工作坊' },
  { key: 'parade', label: '遊行' },
  { key: 'exhibit', label: '展覽' },
  { key: 'care', label: '志工' },
  { key: 'social', label: '聯誼' },
];
/**
 * 台派雷達的店家類型（判讀時選一個，跟伺服器 worker/src/taipai.ts 的 STORE_TYPES 一樣）：雷達、地圖的小圖示和類型按鈕照這個分。
 * 店家的 topic 直接是 key（topicFor），不用照字分
 */
export const STORE_TYPES: Array<{ key: string; label: string }> = [
  { key: 'eat', label: '餐廳小吃' },
  { key: 'cafe', label: '咖啡甜點' },
  { key: 'drink', label: '飲料' },
  { key: 'bar', label: '酒吧' },
  { key: 'book', label: '書店' },
  { key: 'shop', label: '選物雜貨' },
  { key: 'beauty', label: '美髮美容' },
  { key: 'stay', label: '住宿' },
  { key: 'clinic', label: '醫療' },
  { key: 'other', label: '其他' },
];
/** 書店雷達的書店類型（跟伺服器 worker/src/books.ts 的 BOOK_TYPES 一樣）；key 不跟台派雷達的店家類型、活動主題重複，「其他」共用 */
export const BOOK_TYPES: Array<{ key: string; label: string }> = [
  { key: 'general', label: '人文綜合' },
  { key: 'issue', label: '社會議題' },
  { key: 'used', label: '二手書' },
  { key: 'kids', label: '童書繪本' },
  { key: 'lit', label: '文學詩集' },
  { key: 'art', label: '藝術設計' },
  { key: 'comic', label: '漫畫' },
  { key: 'other', label: '其他' },
];
/** 所有雷達的店家類型（查名稱用） */
export const ALL_STORE_TYPES = [...STORE_TYPES, ...BOOK_TYPES.filter((t) => t.key !== 'other')];
const STORE_KEYS = new Set(ALL_STORE_TYPES.map((t) => t.key));
export const isStoreType = (v: unknown): v is string => typeof v === 'string' && STORE_KEYS.has(v);

export function topicGlyph(topic: string | null | undefined): string | null {
  if (!topic) return null;
  if (STORE_KEYS.has(topic)) return topic;
  return TOPIC_GROUPS.find((g) => g.words.test(topic))?.key ?? null;
}
/** 小圖示（viewBox -12 -12 24 24，圓點半徑約 10；c 是圖示的顏色，可以是 currentColor） */
export function glyphSvg(key: string, c: string): string {
  const s = `stroke="${c}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  switch (key) {
    case 'gift': // 禮物盒
      return `<rect x="-5.5" y="-1.5" width="11" height="7" rx="1" fill="${c}"/><rect x="-6.5" y="-4.5" width="13" height="3" rx="0.8" fill="${c}"/><path d="M0 -4.5 c-1.2 -3 -4.6 -3 -3.6 -0.6 M0 -4.5 c1.2 -3 4.6 -3 3.6 -0.6" ${s} stroke-width="1.5"/><path d="M0 -4.5 V5.5" stroke="#00000055" stroke-width="1.6"/>`;
    case 'rally': // 擴音器
      return `<path d="M-6.5 -2.5 h3 l6.5 -4 v13 l-6.5 -4 h-3 z" fill="${c}"/><path d="M-4.5 2.5 l1 4" ${s} stroke-width="1.8"/><path d="M5 -2.5 q1.6 2.5 0 5" ${s} stroke-width="1.5"/>`;
    case 'talk': // 麥克風
      return `<rect x="-2.6" y="-7.5" width="5.2" height="9" rx="2.6" fill="${c}"/><path d="M-5 -0.5 a5 5 0 0 0 10 0 M0 4.5 v2.5 M-3 7 h6" ${s} stroke-width="1.6"/>`;
    case 'music': // 兩個音符
      return `<path d="M-2 4 V-5.5 L5.5 -7 V2.5" ${s} stroke-width="1.6"/><ellipse cx="-4" cy="4.2" rx="2.4" ry="1.9" fill="${c}"/><ellipse cx="3.5" cy="2.7" rx="2.4" ry="1.9" fill="${c}"/>`;
    case 'market': // 攤位（條紋遮陽篷）
      return `<path d="M-7 -2.5 L-5.5 -7 H5.5 L7 -2.5 Z" fill="${c}"/><path d="M-7 -2.5 q1.75 2.2 3.5 0 q1.75 2.2 3.5 0 q1.75 2.2 3.5 0 q1.75 2.2 3.5 0" fill="${c}"/><path d="M-5.5 0 V6.5 M5.5 0 V6.5 M-6.5 3 H6.5" ${s} stroke-width="1.6"/>`;
    case 'craft': // 鉛筆
      return `<path d="M-6.5 6.5 l1.2 -4.2 l7.8 -7.8 l3 3 l-7.8 7.8 z" fill="${c}"/><path d="M-5.3 2.3 l3 3" stroke="#00000055" stroke-width="1.2"/>`;
    case 'parade': // 小旗子
      return `<path d="M-4.5 7 V-7" ${s} stroke-width="1.8"/><path d="M-4.5 -7 L6.5 -4 L-4.5 -1 Z" fill="${c}"/>`;
    case 'exhibit': // 畫框
      return `<rect x="-6.5" y="-6" width="13" height="12" rx="1" ${s} stroke-width="1.6"/><path d="M-4.5 3.8 l3 -4 l2 2.4 l1.6 -1.6 l2.4 3.2 z" fill="${c}"/><circle cx="2.6" cy="-2.6" r="1.3" fill="${c}"/>`;
    case 'care': // 小樹苗（志工、淨灘；v1.677 愛心給聯誼）
      return `<path d="M0 7 V-1" ${s} stroke-width="1.8"/><path d="M0 0 C-0.8 -4.6 -5.6 -6 -7 -4.2 C-6.2 -0.9 -3 0.3 0 0 Z" fill="${c}"/><path d="M0 -1.8 C0.9 -6.6 5.8 -7.8 7 -5.8 C6 -2.6 3 -1.6 0 -1.8 Z" fill="${c}"/><path d="M-3.5 7 H3.5" ${s} stroke-width="1.6"/>`;
    case 'social': // 愛心（聯誼）
      return `<path d="M0 6 C-4 3 -7 0.5 -7 -2.5 a3.4 3.4 0 0 1 7 -1.2 a3.4 3.4 0 0 1 7 1.2 C7 0.5 4 3 0 6 z" fill="${c}"/>`;
    case 'eat': // 碗和筷子
      return `<path d="M-7 -1 h14 a7 6.5 0 0 1 -14 0 z" fill="${c}"/><path d="M-3.5 6.5 h7" ${s} stroke-width="1.6"/><path d="M1 -2.5 L5.5 -8 M3 -2.5 L7.5 -7" ${s} stroke-width="1.4"/>`;
    case 'cafe': // 咖啡杯冒煙
      return `<path d="M-6.5 -1.5 h10 v4 a5 5 0 0 1 -10 0 z" fill="${c}"/><path d="M3.5 0 h1.4 a2 2 0 0 1 0 4 h-1.6" ${s} stroke-width="1.5"/><path d="M-3.5 -4 q-1 -1.6 0 -3.2 M0 -4 q-1 -1.6 0 -3.2" ${s} stroke-width="1.3"/>`;
    case 'drink': // 手搖杯和吸管
      return `<path d="M-4.6 -3.5 h9.2 l-1.4 10.5 h-6.4 z" fill="${c}"/><path d="M-5.6 -3.5 h11.2" ${s} stroke-width="1.6"/><path d="M0.5 -3.5 L2.5 -8.5" ${s} stroke-width="1.5"/><circle cx="-1.6" cy="4.6" r="0.9" fill="#00000055"/><circle cx="1.4" cy="4.8" r="0.9" fill="#00000055"/>`;
    case 'bar': // 雞尾酒杯
      return `<path d="M-6.5 -6 h13 l-6.5 7 z" fill="${c}"/><path d="M0 1 V6.5 M-3.5 6.8 h7" ${s} stroke-width="1.6"/>`;
    case 'book': // 打開的書
    case 'general':
      return `<path d="M0 -4.5 C-2.5 -6.5 -5.5 -6.5 -7 -5.5 V5.5 C-5.5 4.5 -2.5 4.5 0 6.5 Z" fill="${c}"/><path d="M0 -4.5 C2.5 -6.5 5.5 -6.5 7 -5.5 V5.5 C5.5 4.5 2.5 4.5 0 6.5 Z" fill="${c}"/><path d="M0 -4.5 V6.5" stroke="#00000055" stroke-width="1"/>`;
    case 'shop': // 購物袋
      return `<rect x="-5.5" y="-2.5" width="11" height="9" rx="1.2" fill="${c}"/><path d="M-2.6 -2.5 v-1.5 a2.6 2.6 0 0 1 5.2 0 v1.5" ${s} stroke-width="1.5"/>`;
    case 'beauty': // 剪刀
      return `<circle cx="-3.6" cy="4.2" r="2.3" ${s} stroke-width="1.5"/><circle cx="3.6" cy="4.2" r="2.3" ${s} stroke-width="1.5"/><path d="M-2.2 2.4 L4 -7 M2.2 2.4 L-4 -7" ${s} stroke-width="1.6"/>`;
    case 'stay': // 床
      return `<path d="M-7 5.5 V-5 M7 5.5 V1 M-7 1 H7" ${s} stroke-width="1.6"/><rect x="-6.5" y="-2.8" width="4.6" height="3.2" rx="1.2" fill="${c}"/><path d="M-1.4 1 V-2 h6.6 a1.8 1.8 0 0 1 1.8 1.8 V1 z" fill="${c}"/>`;
    case 'clinic': // 十字
      return `<path d="M-2.2 -7 h4.4 v4.8 h4.8 v4.4 h-4.8 v4.8 h-4.4 v-4.8 h-4.8 v-4.4 h4.8 z" fill="${c}"/>`;
    case 'issue': // 封面有愛心的書（性別、人權、台灣這些社會議題）
      return `<rect x="-5.5" y="-7" width="11" height="14" rx="1.2" fill="${c}"/><path d="M-3.6 -7 V7" stroke="#00000055" stroke-width="1.2"/><path d="M1 3.4 c-2.4 -1.6 -3.6 -2.8 -3.6 -4.3 a1.8 1.8 0 0 1 3.6 -0.5 a1.8 1.8 0 0 1 3.6 0.5 c0 1.5 -1.2 2.7 -3.6 4.3 z" fill="#00000055"/>`;
    case 'used': // 疊起來的書（二手書）
      return `<rect x="-6.5" y="2" width="13" height="4.6" rx="1" fill="${c}"/><rect x="-5.5" y="-2.8" width="11" height="4.2" rx="1" fill="${c}"/><rect x="-6" y="-7.4" width="11.5" height="4" rx="1" fill="${c}" transform="rotate(-6)"/><path d="M-4 4.3 h8 M-3 -0.7 h6" stroke="#00000055" stroke-width="1"/>`;
    case 'kids': // 氣球（童書繪本）
      return `<ellipse cx="0" cy="-2.2" rx="5" ry="5.8" fill="${c}"/><path d="M-1.1 3.5 h2.2 l-1.1 1.5 z" fill="${c}"/><path d="M0 5 q-2 1.6 0 3.2" ${s} stroke-width="1.2"/>`;
    case 'lit': // 羽毛筆（文學詩集）
      return `<path d="M6.5 -7.5 C0 -6.5 -4 -1.5 -4.8 4.8 C-1 3 4 -1.5 6.5 -7.5 Z" fill="${c}"/><path d="M-3.4 3.2 L3.2 -3.6" stroke="#00000055" stroke-width="1.1" stroke-linecap="round"/><path d="M-4.8 4.8 L-6.8 7.2" ${s} stroke-width="1.5"/>`;
    case 'art': // 調色盤
      return `<path d="M0 -7 C-5 -7 -7.5 -3.5 -7.5 0 C-7.5 4.5 -4 7 0 7 C1.8 7 2.2 5.6 1.2 4.4 C0.2 3.2 1 1.6 2.8 1.8 C5.5 2 7.5 0.5 7.5 -1.5 C7.5 -4.5 4.5 -7 0 -7 Z" fill="${c}"/><circle cx="-4" cy="-0.6" r="1.3" fill="#00000055"/><circle cx="-1.6" cy="-4.2" r="1.3" fill="#00000055"/><circle cx="2.6" cy="-4" r="1.3" fill="#00000055"/><circle cx="-3.2" cy="3.6" r="1.3" fill="#00000055"/>`;
    case 'comic': // 對話框加驚嘆號（漫畫）
      return `<path d="M-7 -5.5 a2 2 0 0 1 2 -2 h10 a2 2 0 0 1 2 2 v7 a2 2 0 0 1 -2 2 h-5 l-4.2 3.6 v-3.6 h-0.8 a2 2 0 0 1 -2 -2 z" fill="${c}"/><path d="M0 -5.2 v3.6" stroke="#00000055" stroke-width="1.8" stroke-linecap="round"/><circle cx="0" cy="0.9" r="1" fill="#00000055"/>`;
    case 'other': // 小店面（遮雨棚加門）
      return `<path d="M-7 -2 L-5.5 -6.5 H5.5 L7 -2 Z" fill="${c}"/><rect x="-5.5" y="-1" width="11" height="7.5" fill="${c}"/><rect x="-1.6" y="1.8" width="3.2" height="4.7" fill="#00000055"/>`;
    default:
      return '';
  }
}

/** 類型按鈕上的小圖示：跟地圖、雷達一樣的圓點加白色圖示 */
export const topicChipSvg = (key: string): string =>
  `<svg class="type-ic" viewBox="-12 -12 24 24" aria-hidden="true"><circle r="11.5" fill="var(--blip-activity)"/>${glyphSvg(key, '#ffffff')}</svg>`;
