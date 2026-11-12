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
];
export function topicGlyph(topic: string | null | undefined): string | null {
  if (!topic) return null;
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
    case 'care': // 愛心
      return `<path d="M0 6 C-4 3 -7 0.5 -7 -2.5 a3.4 3.4 0 0 1 7 -1.2 a3.4 3.4 0 0 1 7 1.2 C7 0.5 4 3 0 6 z" fill="${c}"/>`;
    default:
      return '';
  }
}
