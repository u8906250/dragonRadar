/**
 * 把據點的地點文字拆成「店名」和「地址」：
 * 「Thebirdscafe鳥咖啡 110臺北市信義區…399號」→ 店名「Thebirdscafe鳥咖啡」、地址「110臺北市信義區…399號」；
 * 「張文潔服務處（中坡南路277號）」→ 店名「張文潔服務處」、地址「中坡南路277號」。
 * 找不到店名（整段都是地址，或只是地標）時 name 是 null。
 */
const CITY = '(?:臺北|台北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|嘉義|苗栗|彰化|南投|雲林|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|連江)[市縣]';
/** 地址開頭：郵遞區號加縣市，或縣市 */
const ADDRESS_START = new RegExp(`\\d{3,6}\\s*${CITY}|${CITY}`);
/** 門牌後面的樓層：「2樓」「2F」「B1」「地下1樓」 */
const FLOOR = '(?:\\s*(?:\\d+\\s*(?:樓|[Ff](?![A-Za-z]))|[Bb]\\d+(?![A-Za-z])|地下\\d+樓))?(?:之\\d+)?';
/** 沒寫縣市的門牌：路名加號碼（可以有段、巷、弄、樓） */
const STREET_NUMBER = new RegExp(`[一-鿿]{1,6}(?:路|街|大道)(?:[一二三四五六七八九十\\d]段)?(?:\\d+巷)?(?:\\d+弄)?\\d+(?:[之-]\\d+)?號${FLOOR}`);

/** 位置提示、大樓名稱不是店名：「近捷運江子翠站二號出口」「走路三分鐘」「農村公園正對面」「三信大樓」 */
const LOCATION_HINT = /^(?:近|靠近|鄰近|位於)|出口|步行|走路|分鐘|對面|旁邊|附近|(?:大樓|大廈)$/;
/** 只有樓層（「2F」「3樓」「B1」）不是店名 */
const FLOOR_ONLY = /^(?:\d+\s*(?:[Ff]|樓)|[Bb]\d+|地下\d+樓)$/;
const isName = (s: string): boolean => s.length >= 2 && !LOCATION_HINT.test(s) && !FLOOR_ONLY.test(s);

const tidy = (s: string): string => s.replace(/^[\s,，、:：·・\-–]+|[\s,，、:：·・\-–]+$/g, '').trim();

export function splitPlace(text: string): { name: string | null; address: string } {
  const full = text.trim();
  // 括號裡是地址：「店名（地址）」
  const paren = /^(.+?)[（(]([^）)]+)[）)]\s*$/.exec(full);
  if (paren && (ADDRESS_START.test(paren[2]) || STREET_NUMBER.test(paren[2]))) {
    const name = tidy(paren[1]);
    return { name: name.length >= 2 ? name : null, address: tidy(paren[2]) };
  }
  const m = ADDRESS_START.exec(full) ?? STREET_NUMBER.exec(full);
  if (!m) {
    // 括號裡是位置提示不是地址：「日常生活 a day cafe(近忠孝復興站）」→ 店名取括號前，地點保留原文
    const hint = /^(.+?)\s*[（(][^）)]*[）)]\s*$/.exec(full);
    const name = hint ? tidy(hint[1]) : '';
    return { name: name.length >= 2 ? name : null, address: full };
  }
  const before = tidy(full.slice(0, m.index));
  if (isName(before)) return { name: before, address: tidy(full.slice(m.index)) };
  // 地址在前、店名在後：「台北市中正區青島東路25-2號 蘭鄉排骨飯」「…18號（棲木咖啡）」；
  // 括號裡是位置提示的不是店名：「…263巷18號 (近捷運江子翠站二號出口…)」
  const end = new RegExp(`號${FLOOR}`).exec(full.slice(m.index));
  if (end) {
    const cut = m.index + end.index + end[0].length;
    const after = tidy(full.slice(cut));
    const inner = /^[（(](.*)[）)]$/.exec(after)?.[1].trim() ?? after;
    if (isName(inner)) return { name: inner, address: tidy(full.slice(0, cut)) };
  }
  return { name: null, address: full };
}
