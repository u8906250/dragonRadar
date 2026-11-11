/**
 * 洋流總部的特效：更貼近政策的小動畫（v1.545 使用者選「1 3 4 7 8 9 10 11 13 14 15」，雷達、地圖共用的畫法）。
 * 螢幕像素、中心在 0,0；顏色、動畫在 styles.css（.sc-*），洋流號到了、河淡掉（.hq-idle）而且拉近（不是 .hq-far：電腦版 3 km、手機 2 km）才動，
 * 不動的時候只留場景（走路的人、硬幣、雨滴這些收起來），畫面不亂
 */

/**
 * 待機動畫的相位（CSS 的 --d，負的 animation-delay）照時鐘算：雷達航行中每一格、到站後每幾秒會整層重畫，固定的 delay 每次都從同一格重播，
 * 看起來停住或一直被打斷（v1.546 使用者說「新加的電腦版動畫都沒出來」）。照 Date.now() 算，重畫後接著同一個進度播；
 * 取餘數的長度是所有動畫週期（0.25～12 秒）的公倍數（84 分鐘），換一輪時不會跳
 */
export const IDLE_CYCLE_MS = 5_040_000;
export const idlePhase = (now: number, offsetMs: number): number => Math.round((now + offsetMs) % IDLE_CYCLE_MS);

/** 會自己畫一個小場景的圖示 */
export type SceneKind = 'sporthub' | 'workhub' | 'ridehub' | 'pocketpark' | 'detention' | 'cleanwater' | 'schoolwalk' | 'lunch' | 'piggy' | 'aiteam' | 'oldhouse' | 'streettree' | 'bikerack' | 'nightmayor' | 'buscharge' | 'library24' | 'lantern' | 'nightsky' | 'tpassgo' | 'tpasspark' | 'busterminal' | 'cyclerenew' | 'stagger' | 'expo' | 'respite';
const SCENE_KINDS: readonly string[] = ['sporthub', 'workhub', 'ridehub', 'pocketpark', 'detention', 'cleanwater', 'schoolwalk', 'lunch', 'piggy', 'aiteam', 'oldhouse', 'streettree', 'bikerack', 'nightmayor', 'buscharge', 'library24', 'lantern', 'nightsky', 'tpassgo', 'tpasspark', 'busterminal', 'cyclerenew', 'stagger', 'expo', 'respite'];
export const isSceneKind = (k: string): k is SceneKind => SCENE_KINDS.includes(k);

/** 站著的小人（腳在 y = 0、往右走）：身體的 class 決定衣服顏色，extra 是帽子、領帶這些 */
const person = (body: string, extra = ''): string =>
  `<g class="sc-bob"><path class="sc-leg" d="M0 -3.6L-1.4 0M0 -3.6L1.4 0"/><path class="${body}" d="M0 -7.6V-3.6"/><circle class="sc-head" cy="-9.3" r="1.6"/>${extra}</g>`;

/**
 * 1. 通學區（交通政見「學校四周 150 公尺……目標通學區零死亡」）：斑馬線上戴黃帽的小朋友一個接一個過馬路，
 * 導護舉旗、車子停在停止線後面等
 */
const SCHOOLWALK =
  '<rect class="sw-side" x="-17" y="-12" width="34" height="5" rx="1.5"/><rect class="sw-side" x="-17" y="7" width="34" height="5" rx="1.5"/>' +
  '<rect class="sw-road" x="-17" y="-7" width="34" height="14"/><path class="sw-lane" d="M-17 0H-7M7 0H17"/>' +
  '<path class="sw-zebra" d="M-4 -5.6H4M-4 -2.8H4M-4 0H4M-4 2.8H4M-4 5.6H4"/><path class="sw-stop" d="M-6.2 0.8V6.4M6.2 -0.8V-6.4"/>' +
  '<g class="sw-car"><rect class="sw-carbody" x="-15.6" y="1.4" width="8.2" height="4.6" rx="1.6"/><rect class="sw-carwin" x="-10.2" y="2.1" width="2" height="3.2" rx="0.6"/></g>' +
  [-1.6, 0.4, 2].map((x, i) =>
    `<g transform="translate(${x} 0)"><g class="sw-kid k${i + 1}"><g class="sc-bob"><path class="sc-leg" d="M-0.5 -2V0M0.5 -2V0"/><rect class="sw-uni${i === 1 ? ' b' : ''}" x="-1.1" y="-4.8" width="2.2" height="2.9" rx="0.6"/>` +
    '<circle class="sc-head" cy="-6.1" r="1.25"/><path class="sw-hat" d="M-1.45 -6.4A1.45 1.45 0 0 1 1.45 -6.4Z"/></g></g></g>').join('') +
  // 導護：在右上角的人行道上，旗子平舉到馬路上
  `<g transform="translate(8.6 -7.4)">${person('sw-vest')}<g class="sw-flag"><path class="sw-pole" d="M-0.4 -6.4V-12.4"/><path class="sw-cloth" d="M-0.4 -12.4H-4.6V-9.6H-0.4Z"/></g></g>`;

/**
 * 3. 運動驛站（「在重點捷運站旁與登山口設運動驛站，提供盥洗、置物與租借服務」）：捷運站旁一間小驛站（窗戶畫淋浴的水滴、置物櫃）。
 * 登山口那幾站（sporthub）：穿西裝的上班族走進去、換好運動服出來去爬山；
 * 騎車通勤（v1.552）：松山站（ridehub）穿西裝走進去、戴安全帽出來騎車；港墘站（workhub）騎到了戴安全帽進去、沖完澡換好上班的衣服出來；
 * 這兩站門口停一台黃色的腳踏車
 */
const SUIT = ['sh-suit', '<path class="sh-tie" d="M0 -7.3V-5.4"/><rect class="sh-case" x="1.1" y="-4.6" width="2.6" height="1.9" rx="0.3"/>'] as const;
const SPORT = ['sh-sport', '<path class="sh-cap" d="M-1.7 -9.7A1.7 1.7 0 0 1 1.7 -9.7H3Z"/><path class="sh-towel" d="M-0.9 -7.6Q0 -6.6 0.9 -7.6"/>'] as const;
const RIDER = ['sh-sport', '<path class="sh-helmet" d="M-1.9 -9.6A1.9 1.9 0 0 1 1.9 -9.6Z"/>'] as const;
const PARKED_BIKE =
  '<g class="sh-bike"><circle class="sh-wheel" cx="10.6" cy="4.7" r="1.6"/><circle class="sh-wheel" cx="15" cy="4.7" r="1.6"/>' +
  '<path class="sh-frame" d="M10.6 4.7L12.4 2.3H14.2L15 4.7M12.4 2.3L12.8 4.7L14.2 2.3M12.1 1.5H13M14 1.6L14.4 2.3"/></g>';
const dressed = ([body, extra]: readonly [string, string]): string => person(body, extra);
const hub = (mode: 'trail' | 'ride' | 'work'): string =>
  '<ellipse class="sc-shadow" cx="0" cy="6.6" rx="14" ry="1.4"/>' +
  '<rect class="sh-wall" x="-8" y="-6" width="16" height="12.4" rx="1"/><path class="sh-roof" d="M-9.5 -6H9.5V-9.4H-9.5Z"/>' +
  '<rect class="sh-win" x="-6.6" y="-4" width="4" height="3.8" rx="0.6"/><path class="sh-drop" d="M-4.6 -3.4Q-5.9 -1.7 -4.6 -0.9Q-3.3 -1.7 -4.6 -3.4Z"/>' +
  '<rect class="sh-win" x="2.6" y="-4" width="4" height="3.8" rx="0.6"/><path class="sh-lock" d="M3.4 -3.3H5.8V-0.9H3.4ZM4.6 -3.3V-0.9"/>' +
  '<rect class="sh-door" x="-1.9" y="0.6" width="3.8" height="5.8" rx="0.5"/>' +
  (mode === 'trail' ? '' : PARKED_BIKE) +
  `<g transform="translate(0 6.4)"><g class="sh-in">${dressed(mode === 'work' ? RIDER : SUIT)}</g><g class="sh-out">${dressed(mode === 'trail' ? SPORT : mode === 'ride' ? RIDER : SUIT)}</g></g>`;

/**
 * 4. 在地小農進校園（營養午餐）：學校旁邊一個便當冒熱氣、偶爾跳一顆愛心（小貨車另外沿路開，TRUCK_SVG）
 */
const HEART = 'M0 -1.6C-1.2 -2.8 -2.8 -3.4 -2.8 -4.9C-2.8 -5.9 -2 -6.6 -1.2 -6.6C-0.6 -6.6 -0.2 -6.3 0 -5.8C0.2 -6.3 0.6 -6.6 1.2 -6.6C2 -6.6 2.8 -5.9 2.8 -4.9C2.8 -3.4 1.2 -2.8 0 -1.6Z';
const LUNCH =
  '<g transform="translate(15 -12)">' +
  [-3, 0, 3].map((x, i) => `<path class="ln-steam s${i + 1}" d="M${x} -4q-1.4 -1.8 0 -3.6t0 -3.6"/>`).join('') +
  '<rect class="ln-box" x="-6.5" y="-3" width="13" height="7.5" rx="1.6"/><rect class="ln-rice" x="-5.4" y="-1.9" width="5.8" height="5.3" rx="1"/>' +
  '<circle class="ln-egg" cx="3" cy="-0.4" r="1.7"/><circle class="ln-yolk" cx="3" cy="-0.4" r="0.75"/><circle class="ln-veg" cx="2.2" cy="2.6" r="1.3"/><circle class="ln-veg" cx="4.4" cy="2.5" r="1.1"/>' +
  `<g transform="translate(0 -9)"><path class="ln-heart" d="${HEART}"/></g></g>`;

/**
 * 7. 口袋公園（「運用閒置土地規劃口袋公園，讓每位市民 300 公尺內都能走到有綠蔭的公園」）：虛線框的空地一格一格鋪上草皮、長出小樹、放上長椅，
 * 一隻蝴蝶飛來；過一陣子再從空地開始
 */
const POCKETPARK =
  '<rect class="pp-lot" x="-11" y="-5" width="22" height="12" rx="2"/>' +
  [-10, -5, 0, 5].map((x, i) => `<rect class="pp-t t${i + 1}" x="${x}" y="-4" width="5" height="10" rx="1"/>`).join('') +
  '<g class="pp-tree"><path class="pp-trunk" d="M-5.5 2.5V-4"/><circle class="pp-crown" cx="-5.5" cy="-7" r="4.4"/><circle class="pp-lit" cx="-7" cy="-8.6" r="1.4"/></g>' +
  '<g class="pp-bench"><path class="pp-wood" d="M2 1.4H9.4M2 3.4H9.4"/><path class="pp-leg" d="M2.8 3.4V5.6M8.6 3.4V5.6"/></g>' +
  '<g class="pp-fly"><g class="pp-flap"><path class="pp-wing" d="M0 0Q-2.2 -2.4 -2.6 0.3Q-1.4 1.2 0 0ZM0 0Q2.2 -2.4 2.6 0.3Q1.4 1.2 0 0Z"/></g></g>';

/**
 * 9. 微型社區滯洪（「推動分散式、微型社區滯洪，改造校園與公園」）：公園底下切開看得到滯洪池，小雨雲下雨時水位慢慢升、雨停慢慢退
 */
const DETENTION =
  '<rect class="dt-tank" x="-11" y="1.4" width="22" height="8.4" rx="1.6"/><rect class="dt-water" x="-10" y="2.6" width="20" height="6.4" rx="1"/>' +
  '<rect class="dt-grass" x="-13" y="-1.2" width="26" height="2.8" rx="1.3"/><path class="dt-grate" d="M6.6 0.2H10M7.4 -0.6V1M8.3 -0.6V1M9.2 -0.6V1"/>' +
  '<path class="pp-trunk" d="M-7 -1V-4.6"/><circle class="pp-crown" cx="-7" cy="-6.8" r="3"/>' +
  '<g class="dt-rain">' + [-1.5, 1.6, 4.7].map((x, i) => `<path class="dt-drop r${i + 1}" d="M${x} -9.4v2"/>`).join('') + '</g>' +
  '<path class="dt-cloud" d="M-2.6 -10.6a2.9 2.9 0 0 1 1.2 -5.3a3.4 3.4 0 0 1 6.2 -0.4a2.5 2.5 0 0 1 2.4 4.1a1.8 1.8 0 0 1 -0.9 1.6Z"/>';

/**
 * 13. 城市青年基金（「每月自存 1,500 元、市府配合 1,500 元」）：大學旁邊一隻小豬撲滿，金色（自己存）和橘色（市府配合）的硬幣輪流掉進去
 */
const PIGGY =
  '<g transform="translate(15 -13)"><ellipse class="sc-shadow" cx="0" cy="5.4" rx="6" ry="0.9"/>' +
  '<g class="pg-pig"><path class="pg-leg" d="M-3.4 3V5.2M3 3V5.2"/><ellipse class="pg-body" rx="6.4" ry="4.6"/><path class="pg-ear" d="M-3.4 -3.7L-2.2 -6.4L-0.6 -4.2Z"/>' +
  '<ellipse class="pg-snout" cx="6" cy="0.6" rx="1.5" ry="1.3"/><circle class="pg-nose" cx="5.6" cy="0.5" r="0.3"/><circle class="pg-nose" cx="6.4" cy="0.5" r="0.3"/>' +
  '<circle class="pg-eye" cx="3.2" cy="-1.4" r="0.55"/><path class="pg-slot" d="M-1.6 -4.3H1.6"/><path class="pg-tail" d="M-6.3 -0.6q-1.8 -0.6 -1.2 -2"/></g>' +
  '<g class="pg-coin c1"><circle class="pg-gold" cy="-6.2" r="2"/><path class="pg-mark" d="M0 -7.3V-5.1"/></g>' +
  '<g class="pg-coin c2"><circle class="pg-orange" cy="-6.2" r="2"/><path class="pg-mark" d="M0 -7.3V-5.1"/></g></g>';

/** 小機器人（AI 支援小隊）：圓圓的頭、天線上一顆會閃的燈、兩個綠色的眼睛 */
const robot = (x: number): string =>
  `<g transform="translate(${x} 0)"><g class="ai-bot"><path class="ai-ant" d="M0 -12V-14.6"/><circle class="ai-led" cy="-15.3" r="0.9"/>` +
  '<rect class="ai-head" x="-3.4" y="-12" width="6.8" height="5" rx="2"/><g class="ai-eyes"><circle class="ai-eye" cx="-1.3" cy="-9.5" r="0.75"/><circle class="ai-eye" cx="1.3" cy="-9.5" r="0.75"/></g>' +
  '<rect class="ai-body" x="-2.8" y="-6.4" width="5.6" height="5" rx="1.2"/><path class="ai-arm" d="M-2.8 -4.6L-4.4 -2.8M2.8 -4.6L4.4 -2.8"/></g></g>';

/**
 * 臺北市政府的 AI 支援小隊（公務員政策「專業 AI 團隊進駐工作現場，把重複的填表、數據整理與基礎行政流程自動化」、AI 政策「市政 AI 支持」）：
 * 桌上一疊公文一張張飛進小機器人，另一台冒出綠色打勾，旁邊的公務員輕鬆了、冒一顆愛心
 */
const AITEAM =
  '<ellipse class="sc-shadow" cx="0" cy="6.6" rx="19" ry="1.3"/><rect class="ai-desk" x="-18" y="-1.4" width="27" height="2.4" rx="0.6"/><path class="ai-deskleg" d="M-16.4 1V6M7.4 1V6"/>' +
  '<rect class="ai-paper-stack" x="-16.6" y="-4.6" width="6" height="3.2" rx="0.4"/><path class="ai-lines" d="M-15.6 -3.6H-11.6M-15.6 -2.4H-11.6"/>' +
  [1, 2, 3].map((i) => `<g class="ai-fly f${i}"><rect class="ai-sheet" x="-15.4" y="-8" width="3.8" height="4.6" rx="0.3"/><path class="ai-lines" d="M-14.8 -6.8H-12.2M-14.8 -5.6H-12.2"/></g>`).join('') +
  robot(-5) + robot(3) +
  [1, 2].map((i) => `<g class="ai-ok k${i}" transform="translate(3 -15)"><g class="ai-ok-pop"><circle r="2"/><path d="M-1 0L-0.2 0.8L1.2 -0.8"/></g></g>`).join('') +
  `<g transform="translate(14 6)">${person('ai-staff', '<path class="sh-tie" d="M0 -7.3V-5.4"/><path class="ai-cup" d="M1.4 -5.6H3.2V-3.6H1.4Z"/>')}</g>` +
  `<g transform="translate(14 -10)"><path class="ai-heart" d="${'M0 -1.6C-1.2 -2.8 -2.8 -3.4 -2.8 -4.9C-2.8 -5.9 -2 -6.6 -1.2 -6.6C-0.6 -6.6 -0.2 -6.3 0 -5.8C0.2 -6.3 0.6 -6.6 1.2 -6.6C2 -6.6 2.8 -5.9 2.8 -4.9C2.8 -3.4 1.2 -2.8 0 -1.6Z'}"/></g>`;

/**
 * 老宅延壽（中山大同、中正萬華政見開箱「老宅延壽行動服務團」，政策島 HEART 頁「老宅改善」；報導：增設電梯、樓梯輔具、更換老舊管線）：
 * 一棟頂樓有水塔的四層老公寓——服務團的小貨車開來、師傅提工具箱進門（A），外牆生鏽的水管從下往上換成藍色的新水管、水流順了（C），
 * 旁邊長出一座電梯、長輩坐電梯上下樓、冒愛心（B）；一輪 12 秒。不動的時候是修好的樣子（v1.550）
 */
const OLDHOUSE =
  '<ellipse class="sc-shadow" cx="2" cy="6.6" rx="20" ry="1.3"/>' +
  '<rect class="oh-tank" x="-6.4" y="-24.6" width="5.4" height="3.4" rx="1.3"/><path class="oh-tankleg" d="M-5.6 -21.2V-20M-1.8 -21.2V-20"/>' +
  '<rect class="oh-wall" x="-10" y="-20" width="15.4" height="26" rx="0.6"/><path class="oh-stain" d="M-7.4 -19q0.8 3 0 5.4M2.6 -13q-0.7 2.6 0 4.4M-3.6 -6.6q0.6 2.4 0 3.6"/>' +
  '<path class="oh-floor" d="M-10 -13.5H5.4M-10 -7H5.4M-10 -0.5H5.4"/>' +
  [-18.4, -11.9, -5.4].map((y) => [-8.2, -1.4].map((x) => `<rect class="oh-win" x="${x}" y="${y}" width="3.6" height="3.2" rx="0.3"/><path class="oh-grill" d="M${x + 1.2} ${y}V${y + 3.2}M${x + 2.4} ${y}V${y + 3.2}"/>`).join('')).join('') +
  '<rect class="oh-win" x="-8.2" y="1.1" width="3.6" height="3.2" rx="0.3"/><rect class="oh-door" x="-1.2" y="1.2" width="3.4" height="4.8" rx="0.3"/>' +
  // C. 外牆的水管：生鏽的舊管，藍色的新管從下往上換上去，換好水往下流
  '<path class="oh-pipe-old" d="M-11.2 -19.4V6"/><path class="oh-pipe-new" d="M-11.2 6V-19.4" pathLength="1"/><path class="oh-water" d="M-11.2 -19.4V6"/>' +
  // B. 外加的電梯：玻璃電梯井從地面長上去，電梯廂載長輩上下樓
  '<g class="oh-lift"><rect class="oh-shaft" x="5.8" y="-21" width="5.8" height="27" rx="0.8"/>' +
  '<g class="oh-car"><rect class="oh-carbox" x="6.3" y="0.4" width="4.8" height="5.4" rx="0.6"/><circle class="sc-head" cx="8.7" cy="2.3" r="1"/><path class="oh-hair" d="M7.7 2A1 1 0 0 1 9.7 2"/><path class="oh-elder" d="M8.7 3.4V5.4"/></g></g>' +
  `<g transform="translate(9.6 -27)"><path class="oh-heart" d="${HEART}"/></g>` +
  // A. 服務團的小貨車（白車、藍條、板手）、戴黃色安全帽提工具箱的師傅
  '<g class="oh-van"><path class="oh-vanbody" d="M14 5.2V-1.6H22.4L25.2 1.4V5.2Z"/><path class="oh-vanstripe" d="M14 2H25.2"/><path class="oh-vanwin" d="M22.6 -0.8L24.6 1.4H22.6Z"/>' +
  '<path class="oh-wrench" d="M16.4 0.4l2.4 -1.6M18.6 -1.6a0.9 0.9 0 1 0 0.6 0.4"/><circle class="tk-wheel" cx="16.6" cy="5.4" r="1.3"/><circle class="tk-wheel" cx="22.6" cy="5.4" r="1.3"/></g>' +
  `<g transform="translate(0.5 6)"><g class="oh-worker">${person('oh-overall', '<path class="oh-hat" d="M-1.9 -9.6A1.9 1.9 0 0 1 1.9 -9.6H2.4Z"/><rect class="oh-box" x="1.2" y="-3.6" width="2.8" height="1.8" rx="0.3"/>')}</g></g>`;

/**
 * 條通（v1.552 使用者選 1＋2＋3；v1.553 使用者說「不要用燈籠」——政見沒提，改用政見講的「樹木與車架」）：
 * 沈伯洋說在容易產生爭執的熱點，用車架或樹木做實體阻隔，走過去的人覺得有區隔、安全感提高、負面印象降低；人行道要明亮、不擁擠。
 * 巷子兩側一棵棵小樹（樹穴蓋板，樹不搖）、林森北路交叉口（熱點）放腳踏車架停兩台車；夜市長（紫色背心、黃色臂章、胸前月亮、拿板夾）來協調：
 * 店家和住戶冒出「！」的對話框，夜市長走過來站中間，對話框不見、三個人都冒愛心
 */
/**
 * 條通的燈籠、夜空（v1.555 使用者說「條通那邊可以放一些燈籠，那一區可以畫成晚上的感覺」；v1.553 曾經說不要燈籠，看過後改成放一些）：
 * 每條巷子的巷口（中山北路那頭）掛一盞，拉近時輕輕晃、燈光微微閃；夜色的一角有月亮和星星
 */
const LANTERN =
  '<g class="lt-sway"><path class="lt-string" d="M0 -9V-6.2"/><circle class="lt-glow" cy="-2.2" r="5.2"/><rect class="lt-cap" x="-1.6" y="-6.4" width="3.2" height="1"/>' +
  '<ellipse class="lt-body" cy="-2.3" rx="2.7" ry="3.4"/><path class="lt-rib" d="M-2.4 -3.6H2.4M-2.7 -2.3H2.7M-2.4 -1H2.4"/><rect class="lt-cap" x="-1.6" y="0.9" width="3.2" height="1"/><path class="lt-tassel" d="M0 1.9V3.8"/></g>';
const NIGHTSKY =
  '<path class="lb-moon" d="M-2.4 -5a4.2 4.2 0 1 0 5 5a3.3 3.3 0 1 1 -5 -5Z"/>' +
  '<path class="lb-star s1" d="M-9 -6l0.6 1.5 1.5 0.6 -1.5 0.6 -0.6 1.5 -0.6 -1.5 -1.5 -0.6 1.5 -0.6z"/><path class="lb-star s2" d="M7 -9l0.5 1.2 1.2 0.5 -1.2 0.5 -0.5 1.2 -0.5 -1.2 -1.2 -0.5 1.2 -0.5z"/>' +
  '<path class="lb-star s1" d="M5 4l0.4 1 1 0.4 -1 0.4 -0.4 1 -0.4 -1 -1 -0.4 1 -0.4z"/>';
// 條通的每一棵樹都掛一盞小燈籠（v1.556 使用者說「燈籠每棵樹都放」），從樹冠右邊垂下來
const STREETTREE =
  '<ellipse class="sc-shadow" cy="3.8" rx="3.8" ry="0.7"/><rect class="tt-pit" x="-2.6" y="2.6" width="5.2" height="1.3" rx="0.3"/>' +
  '<path class="pp-trunk" d="M0 3V-2"/><circle class="pp-crown" cy="-4.6" r="3.4"/><circle class="pp-lit" cx="-1.2" cy="-5.8" r="1.1"/>' +
  `<g transform="translate(3.6 -2.2) scale(0.62)">${LANTERN}</g>`;
const parkedBike = (x: number, cls: string): string =>
  `<g transform="translate(${x} 0)"><circle class="sh-wheel" cy="2.6" r="1.6"/><circle class="sh-wheel" cx="4.4" cy="2.6" r="1.6"/>` +
  `<path class="sh-frame${cls}" d="M0 2.6L1.8 0.2H3.6L4.4 2.6M1.8 0.2L2.2 2.6L3.6 0.2M1.5 -0.6H2.4M3.4 -0.5L3.8 0.2"/></g>`;
const BIKERACK =
  '<ellipse class="sc-shadow" cy="4.6" rx="7.4" ry="0.8"/><path class="br-rack" d="M-6 4.4V0.4A1.5 1.5 0 0 1 -3 0.4V4.4M-0.6 4.4V0.4A1.5 1.5 0 0 1 2.4 0.4V4.4M3.6 4.4V0.4A1.5 1.5 0 0 1 6.6 0.4V4.4"/>' +
  parkedBike(-6.6, '') + parkedBike(-1.2, ' b2');
/** 夜市長（身上的東西，腳在 y = 0、往右）：紫色背心、黃色臂章、胸前小月亮，手上拿板夾 */
const MAYOR_BITS =
  '<path class="nm-band" d="M-1.1 -6.6H1.1"/><path class="nm-moon" d="M-0.2 -5.4a0.9 0.9 0 1 0 0.9 -0.9a0.7 0.7 0 1 1 -0.9 0.9Z"/>' +
  '<rect class="nm-board" x="1" y="-6.8" width="2.4" height="3" rx="0.3"/><path class="nm-clip" d="M1.6 -6.8H2.8"/>';
const BUBBLE = (x: number, y: number): string =>
  `<g transform="translate(${x} ${y})"><g class="nm-bub"><path class="nm-bubble" d="M-3 -3H3V1.6H0.8L-0.6 3.2V1.6H-3Z"/><path class="nm-mark" d="M0 -2V-0.2M0 0.7V0.8"/></g></g>`;
const NIGHTMAYOR =
  '<ellipse class="sc-shadow" cy="6.6" rx="17" ry="1.2"/>' +
  '<rect class="nm-shop" x="-17" y="-6" width="9" height="12.4" rx="0.6"/><path class="nm-awn" d="M-17.6 -6L-16.4 -9H-8.6L-7.4 -6Z"/><rect class="nm-shopwin" x="-15.6" y="-3.6" width="6" height="4" rx="0.4"/>' +
  `<g transform="translate(-11.2 -9.6) scale(0.55)">${LANTERN}</g>` +
  `<g transform="translate(-6 6)">${person('nm-apron')}</g><g transform="translate(9 6)">${person('nm-resident')}</g>` +
  BUBBLE(-6, -12) + BUBBLE(9, -12) +
  `<g transform="translate(0 6)"><g class="nm-mayor">${person('nm-vest', MAYOR_BITS)}</g></g>` +
  [-6, 0, 9].map((x, i) => `<g transform="translate(${x} -12)"><path class="nm-heart h${i + 1}" d="${HEART}"/></g>`).join('');
/** 條通裡散步的人（往右走，往左時翻過來）：上衣顏色照 --c */
export const WALKER_SVG = `<g class="boat-flip"><ellipse class="bk-shadow" cx="0" cy="0.4" rx="3.6" ry="0.8"/><g class="walk-bob">${person('wk-body', '<rect class="wk-bag" x="1" y="-5" width="1.8" height="2.2" rx="0.4"/>').replace('<g class="sc-bob">', '<g>')}</g></g>`;
/** 在條通巡邏的夜市長 */
export const PATROL_SVG = `<g class="boat-flip"><ellipse class="bk-shadow" cx="0" cy="0.4" rx="3.6" ry="0.8"/><g class="walk-bob">${person('nm-vest', MAYOR_BITS).replace('<g class="sc-bob">', '<g>')}</g></g>`;

/**
 * 北士科星群（v1.553 使用者說「北士科星群做無人公車充電站，周邊再規劃 24 小時圖書館」）：
 * 1. 無人公車充電站（「變電站與公車充電站雙站合一」＋無人載具沙盒）：自動駕駛的電動公車（車頂光達、車頭綠色的感測眼，沒有司機）開進來，
 *    充電弓從桿子上降到車頂，後面變電站的電一閃一閃流過去、電池一格一格充滿、冒綠色打勾，充電弓升起、公車開走；一輪 10 秒
 * 2. 24 小時圖書館（「數位圖書館」沙盒，畫成整晚開著的圖書館）：月亮、星星下窗戶亮著、有人在看書翻頁，
 *    書變成小光點飛到外面長椅上的人的平板；一輪 6 秒
 */
const BC_GROUND = '<ellipse class="sc-shadow" cx="0" cy="6.6" rx="24" ry="1.3"/><path class="bc-road" d="M-26 6.4H26"/>';
const BC_SITE =
  '<rect class="bc-sub" x="14" y="-21" width="10" height="10" rx="0.8"/><path class="bc-fence" d="M14 -17.4H24M14 -14H24"/><path class="bc-sign" d="M19.4 -20L17.6 -16.8H19.2L18.2 -13.8L20.8 -17.4H19.2Z"/>' +
  '<path class="bc-mast" d="M11 6.2V-17.4H-1.6"/><path class="bc-cable" d="M14 -16Q12.6 -17 11 -17.4H-0.4"/><path class="bc-spark" d="M14 -16Q12.6 -17 11 -17.4H-0.4"/>' +
  '<g class="bc-panto"><path class="bc-arm" d="M-0.4 -17.4L-2 -13.6M-0.4 -17.4L1.2 -13.6"/><path class="bc-shoe" d="M-3 -13.3H2.2"/></g>';
const BC_BUS =
  '<g class="bc-bus"><rect class="bc-body" x="-12" y="-10" width="23" height="13" rx="2.2"/><rect class="bc-stripe" x="-12" y="-1.6" width="23" height="1.6"/>' +
  [-10, -5.4, -0.8].map((x) => `<rect class="bc-win" x="${x}" y="-8.2" width="3.8" height="4.2" rx="0.6"/>`).join('') +
  '<path class="bc-front" d="M4 -8.2H8.6Q10.2 -8.2 10.2 -6.6V-4H4Z"/><circle class="bc-eye" cx="8.3" cy="-6.2" r="0.95"/>' +
  '<rect class="bc-lidar" x="-7.4" y="-11.6" width="2.6" height="1.6" rx="0.7"/><path class="bc-scan" d="M-8.8 -13a2.8 2.8 0 0 1 5.4 0"/>' +
  '<circle class="tk-wheel" cx="-6.4" cy="3.6" r="2.1"/><circle class="tk-wheel" cx="6" cy="3.6" r="2.1"/><circle class="tk-hub" cx="-6.4" cy="3.6" r="0.8"/><circle class="tk-hub" cx="6" cy="3.6" r="0.8"/>' +
  '<g transform="translate(-12 -17)"><rect class="bc-bat" width="8" height="3.6" rx="0.6"/><rect class="bc-batcap" x="8" y="1.1" width="0.9" height="1.4"/><rect class="bc-batfill" x="0.6" y="0.6" width="6.8" height="2.4" rx="0.3"/></g>' +
  '<g transform="translate(-2 -19)"><g class="bc-ok"><circle r="1.9"/><path d="M-0.9 0L-0.2 0.7L1 -0.7"/></g></g></g>';
/**
 * 北士科的「城市分身」（v1.561 使用者選 A；AI 政見「北士科星群計畫」規劃數位孿生實驗沙盒）：充電站、圖書館的正上方各浮一份淡藍色虛線框的分身（約五成五大），
 * 裡面用的是一樣的動畫 class，所以公車進站、充電弓、電池、翻書都跟地上同步；地面到分身之間有小光點往上傳（資料同步）。拉近才出現；
 * 跟路樹數位雙生（TREE_TWIN）同一套淡藍虛線、小光點
 */
const twin = (inner: string, dx: number, dy: number, sc: number): string => `<g transform="translate(${dx} ${dy}) scale(${sc})"><g class="ct">${inner}</g></g>`;
const syncBits = (x: number, y: number, tx: number, ty: number): string =>
  [1, 2, 3].map((i) => `<circle class="ct-bit c${i}" cx="${x}" cy="${y}" r="0.75" style="--tx:${tx}px;--ty:${ty}px"/>`).join('');
const BUSCHARGE = BC_GROUND + BC_SITE + BC_BUS + syncBits(3, -21, 1.5, -6.5) + twin(BC_SITE + BC_BUS, 4, -28, 0.55);
const LB_BUILDING =
  '<path class="lb-roof" d="M-14.6 -10L-3 -16.4L8.6 -10Z"/><rect class="lb-wall" x="-13" y="-10" width="20" height="16.4" rx="0.8"/>' +
  '<circle class="lb-sign" cx="-3" cy="-12.4" r="2.5"/><text class="lb-24" x="-3" y="-11.3" text-anchor="middle">24</text>' +
  '<rect class="lb-win" x="-11.4" y="-7.4" width="7.4" height="6.2" rx="0.4"/><rect class="lb-win" x="-1.8" y="-7.4" width="7.4" height="6.2" rx="0.4"/>' +
  '<path class="lb-shelf" d="M-11.4 -5.6H-4M-1.8 -5.6H5.6"/><circle class="lb-reader" cx="-8.6" cy="-3.7" r="1.15"/><circle class="lb-reader" cx="1.6" cy="-3.7" r="1.15"/>' +
  '<g transform="translate(-7 -2.5)"><path class="lb-book" d="M-1.4 0.6L0 0L1.4 0.6V1.6L0 1L-1.4 1.6Z"/><path class="lb-page" d="M0 0L1.4 0.6V1.6L0 1Z"/></g>' +
  '<rect class="lb-door" x="-4.6" y="0.6" width="3.2" height="5.8" rx="0.4"/>';
const LIBRARY24 =
  '<ellipse class="sc-shadow" cx="1" cy="6.6" rx="19" ry="1.2"/>' +
  '<path class="lb-moon" d="M-17.4 -19.4a3 3 0 1 0 3.6 3.6a2.4 2.4 0 1 1 -3.6 -3.6Z"/><path class="lb-star s1" d="M-10 -21l0.5 1.3 1.3 0.5 -1.3 0.5 -0.5 1.3 -0.5 -1.3 -1.3 -0.5 1.3 -0.5z"/><path class="lb-star s2" d="M10 -19l0.4 1 1 0.4 -1 0.4 -0.4 1 -0.4 -1 -1 -0.4 1 -0.4z"/>' +
  LB_BUILDING +
  '<path class="pp-wood" d="M10.6 3.4H17.8"/><path class="pp-leg" d="M11.2 3.4V5.8M17.2 3.4V5.8"/>' +
  `<g transform="translate(14.2 3.6) scale(0.8)">${person('lb-coat', '<rect class="lb-tablet" x="1.2" y="-6.8" width="2.4" height="3.2" rx="0.4"/>')}</g>` +
  [1, 2, 3].map((i) => `<circle class="lb-bit b${i}" cx="3.8" cy="-4" r="0.75"/>`).join('') +
  syncBits(-3, -17, 0, -5.5) + twin(LB_BUILDING, -1.4, -26, 0.55);

/**
 * TPASS 共享機車（v1.555）：共享電動機車（藍綠色車殼），騎的人戴安全帽
 * 1. 捷運站旁的路上（tpassgo）：有人沿著路走到機車旁，拿記名 TPASS 嗶一下（波紋），車上冒出綠色的「10」分鐘計時圈，騎走；一輪 9 秒
 *    （v1.558 使用者說「不用人從建築走出來，走在路上就可以騎走」：拿掉捷運出口的建築）
 * 2. 合作停車場（tpasspark）：多層停車場（藍色 P）前面一排共享機車專用格，一台騎進空格停好、冒綠色打勾，人下車走開；一輪 9 秒
 */
const scooterBody = (cls = ''): string =>
  `<g${cls ? ` class="${cls}"` : ''}><circle class="tk-wheel" cx="-4.4" cy="-1.6" r="1.7"/><circle class="tk-wheel" cx="4.6" cy="-1.6" r="1.7"/>` +
  '<path class="ts-deck" d="M-6.2 -2.4H1.8L4 -6.2"/><rect class="ts-shell" x="-6.4" y="-4.6" width="5.8" height="2.4" rx="1"/><path class="ts-seat" d="M-6 -4.9H-1.4"/><path class="ts-bar" d="M3.6 -6.6H5.6"/></g>';
const SCOOTER_RIDER =
  '<path class="ts-arm" d="M-2.6 -8.6L4.2 -6.6"/><path class="ts-leg" d="M-2.6 -5.2L0.6 -3"/><path class="ts-torso" d="M-3.2 -9.6L-2.6 -5.2"/>' +
  '<circle class="sc-head" cx="-3.2" cy="-11.2" r="1.5"/><path class="ts-helmet" d="M-4.8 -11.4A1.6 1.6 0 0 1 -1.6 -11.4Z"/>';
/** 共享機車（騎著，往右；往左時翻過來） */
export const SCOOTER_SVG = `<g class="boat-flip"><ellipse class="bk-shadow" cx="0" cy="0.4" rx="7" ry="0.9"/>${scooterBody()}${SCOOTER_RIDER}</g>`;
const TPASS_TIMER =
  '<g class="ts-timer"><circle class="ts-ring-bg" r="3.2"/><circle class="ts-ring" r="3.2" pathLength="1" transform="rotate(-90)"/><text class="ts-ten" y="1.1" text-anchor="middle">10</text></g>';
const TPASS_GO =
  '<ellipse class="sc-shadow" cx="4" cy="6.6" rx="20" ry="1.2"/><path class="ts-walkway" d="M-18 6.6H24"/>' +
  `<g transform="translate(15 6)">${scooterBody()}</g>` +
  `<g transform="translate(5 6)">${scooterBody('ts-parked')}</g>` +
  `<g transform="translate(0 6)"><g class="ts-walker">${person('ts-coat', '<rect class="ts-card" x="1.4" y="-7.4" width="2.4" height="1.6" rx="0.3"/>')}</g></g>` +
  '<circle class="ts-beep" cx="4" cy="-4.4" r="1.6"/>' +
  // 騎走的就是剛剛走過來的那個人（紅衣服）
  `<g transform="translate(5 6)"><g class="ts-go">${scooterBody()}${SCOOTER_RIDER.replace('class="ts-torso"', 'class="ts-torso red"')}</g></g>` +
  `<g transform="translate(7 -12)">${TPASS_TIMER}</g>`;
const TPASS_PARK =
  '<ellipse class="sc-shadow" cx="2" cy="6.6" rx="24" ry="1.2"/>' +
  '<rect class="ts-lot" x="-21" y="-17" width="19" height="23" rx="0.8"/><path class="ts-floor" d="M-21 -11.2H-2M-21 -5.4H-2M-21 0.4H-2"/><path class="ts-ramp" d="M-21 6L-15 0.4"/>' +
  '<rect class="ts-p" x="-15.2" y="-21.4" width="6" height="6" rx="1"/><text class="ts-pt" x="-12.2" y="-16.8" text-anchor="middle">P</text>' +
  '<path class="ts-bay" d="M1 6.4V-1M9 6.4V-1M17 6.4V-1M25 6.4V-1"/>' +
  `<g transform="translate(5 6)">${scooterBody()}</g><g transform="translate(13 6)">${scooterBody()}</g>` +
  `<g transform="translate(21 6)"><g class="ts-in">${scooterBody()}${SCOOTER_RIDER.replace('<path class="ts-arm"', '<g class="ts-who"><path class="ts-arm"')}</g></g></g>` +
  `<g transform="translate(21 -4)"><g class="ts-ok"><circle r="2"/><path d="M-1 0L-0.2 0.8L1.2 -0.8"/></g></g>`;

/**
 * 公車安全改革（v1.555）：
 * 1. 市府轉運站（busterminal）：折返點休息納入班表——司機下車走進休息室，窗戶裡喝茶冒熱氣、牆上的時鐘轉一圈，休息好了冒愛心（直接補貼駕駛薪資）走回公車，
 *    公車頭上冒綠色打勾（準點出發、服務可靠度）；一輪 12 秒
 */
const CITY_BUS =
  '<rect class="cb-body" x="-11" y="-11" width="22" height="13" rx="2"/><rect class="cb-stripe" x="-11" y="-2.8" width="22" height="1.6"/>' +
  [-9, -4.6, -0.2].map((x) => `<rect class="bc-win" x="${x}" y="-9.2" width="3.6" height="4.2" rx="0.6"/>`).join('') +
  '<path class="bc-front" d="M4 -9.2H8.4Q10 -9.2 10 -7.6V-5H4Z"/><rect class="cb-door" x="5" y="-4.4" width="3" height="5.6" rx="0.4"/>' +
  '<circle class="tk-wheel" cx="-6" cy="2.4" r="2"/><circle class="tk-wheel" cx="6" cy="2.4" r="2"/><circle class="tk-hub" cx="-6" cy="2.4" r="0.8"/><circle class="tk-hub" cx="6" cy="2.4" r="0.8"/>';
const BUS_TERMINAL =
  '<ellipse class="sc-shadow" cx="1" cy="6.6" rx="25" ry="1.2"/>' +
  '<path class="cb-roof" d="M-24 -15H6L4 -13H-22Z"/><path class="cb-pillar" d="M-21 -13V6M3 -13V6"/>' +
  `<g transform="translate(-9 4)">${CITY_BUS}</g>` +
  '<rect class="cb-hut" x="9" y="-8" width="15" height="14" rx="0.8"/><path class="cb-hutroof" d="M8 -8L16.5 -12.6L25 -8Z"/><rect class="cb-hutwin" x="17" y="-5" width="5.4" height="4.6" rx="0.4"/>' +
  '<rect class="cb-hutdoor" x="11" y="-1.6" width="3.6" height="7.6" rx="0.3"/>' +
  '<g transform="translate(16.5 -10)"><circle class="cb-clock" r="1.7"/><path class="cb-hand-h" d="M0 0V-1"/><path class="cb-hand" d="M0 0V-1.4"/></g>' +
  '<g class="cb-inside"><circle class="lb-reader" cx="19" cy="-2.6" r="1"/><rect class="cb-cup" x="20.4" y="-2.4" width="1.4" height="1.4" rx="0.2"/><path class="cb-steam" d="M21.1 -2.8q-0.6 -0.8 0 -1.6t0 -1.6"/></g>' +
  `<g transform="translate(-2 6)"><g class="cb-driver">${person('cb-uniform', '<path class="cb-cap" d="M-1.7 -9.8A1.7 1.7 0 0 1 1.7 -9.8H2.6Z"/>')}<g transform="translate(0 -12)"><path class="cb-heart" d="${HEART}"/></g></g></g>` +
  '<g transform="translate(-9 -12)"><g class="cb-ok"><circle r="2.1"/><path d="M-1 0L-0.2 0.8L1.2 -0.8"/></g></g>';

/**
 * 循環都更（v1.566 使用者選「說明文字更新＋A 循環都更」；政見「無限都更、無限陪伴」的「先換屋、再都更」）：
 * 左邊一棟老公寓、右邊公有地上的新家，中間一個慢慢轉的循環箭頭——一家人（大人帶小孩）從老公寓走到新家（先換屋），
 * 老公寓圍起鷹架、吊車吊、新大樓從地上長出來（再都更），蓋好閃一下，下一戶人家走進新大樓（投入下一輪）；一輪 14 秒
 */
const family = (cls: string, a: string, b: string): string =>
  `<g class="${cls}">${person(a)}<g transform="translate(3.2 1.6) scale(0.7)">${person(b)}</g></g>`;
const CYCLE_RENEW =
  '<ellipse class="sc-shadow" cx="0" cy="6.6" rx="25" ry="1.3"/>' +
  // 循環箭頭（中間上方）
  '<g transform="translate(0 -16)"><g class="cr-loop"><path class="cr-arrow" d="M-4.6 -1.2A4.8 4.8 0 0 1 4.2 -2.2M4.6 1.2A4.8 4.8 0 0 1 -4.2 2.2"/><path class="cr-head" d="M4.2 -2.2L5.4 -4.4L2.6 -3.8ZM-4.2 2.2L-5.4 4.4L-2.6 3.8Z"/></g></g>' +
  // 老公寓（左）、圍起來的鷹架、長出來的新大樓
  '<g class="cr-old"><rect class="oh-wall" x="-23" y="-14" width="12" height="20" rx="0.5"/><path class="oh-stain" d="M-20.6 -12.6q0.6 2.6 0 4.4M-13.6 -6q-0.6 2 0 3.4"/>' +
  [-11.4, -5.4].map((y) => [-21.6, -16.4].map((x) => `<rect class="oh-win" x="${x}" y="${y}" width="3.2" height="3" rx="0.3"/>`).join('')).join('') +
  '<rect class="oh-door" x="-18.6" y="1" width="3.2" height="5" rx="0.3"/></g>' +
  '<g class="cr-new"><rect class="cr-tower" x="-24" y="-20" width="14" height="26" rx="0.6"/>' +
  [-17.6, -12, -6.4, -0.8].map((y) => [-22.4, -18.4, -14.4].map((x) => `<rect class="cr-glass" x="${x}" y="${y}" width="2.8" height="3.6" rx="0.3"/>`).join('')).join('') +
  '<rect class="cr-tdoor" x="-18.6" y="2.2" width="3.2" height="3.8" rx="0.3"/></g>' +
  '<g class="cr-site"><path class="cr-scaf" d="M-25 6V-16M-9 6V-16M-25 -16H-9M-25 -9H-9M-25 -2H-9M-25 6L-9 -16M-9 6L-25 -16"/>' +
  '<path class="cr-crane" d="M-5 6V-24M-5 -24H-22M-5 -24L-2 -24M-5 -22L-8 -24"/><g class="cr-hook"><path class="cr-rope" d="M-15 -24V-18"/><rect class="cr-load" x="-16.6" y="-18" width="3.2" height="2" rx="0.3"/></g></g>' +
  '<path class="cr-spark" d="M-6 -24l0.8 2 2 0.8 -2 0.8 -0.8 2 -0.8 -2 -2 -0.8 2 -0.8z"/>' +
  // 公有地上的新家（右）
  '<rect class="cr-land" x="8" y="5.2" width="17" height="1.6" rx="0.4"/><path class="cr-roof" d="M9 -6L16.5 -11.6L24 -6Z"/><rect class="cr-house" x="10" y="-6" width="13" height="11.4" rx="0.5"/>' +
  '<rect class="cr-hwin" x="11.6" y="-3.6" width="3.4" height="3" rx="0.3"/><rect class="cr-hwin" x="18" y="-3.6" width="3.4" height="3" rx="0.3"/><rect class="cr-hdoor" x="15" y="0.6" width="3" height="4.8" rx="0.3"/>' +
  // 一家人：先換屋（老公寓 → 新家）、下一戶（從左邊走進新大樓）
  `<g transform="translate(-17 6)">${family('cr-fam1', 'cr-a1', 'cr-c1')}</g>` +
  `<g transform="translate(-17 6)">${family('cr-fam2', 'cr-a2', 'cr-c2')}</g>` +
  `<g transform="translate(16.5 -15)"><path class="cr-heart" d="${HEART}"/></g>`;

/**
 * 10. 水圳淨水（「用植生過濾、濕地、礫間接觸等自然工法改善水質」）：水路上一叢蘆葦，水裡的小點從灰濁流過蘆葦變清澈的藍色；
 * deg 是水流的方向（螢幕角度，0 往右）
 */
export function cleanSvg(deg: number): string {
  return (
    `<g transform="rotate(${deg.toFixed(1)})"><path class="cw-band" d="M-17 0H17"/>` +
    [1, 2, 3, 4].map((i) => `<circle class="cw-dot d${i}" r="1.3"/>`).join('') +
    '<path class="cw-spark" d="M14 -4.6l0.6 1.6 1.6 0.6 -1.6 0.6 -0.6 1.6 -0.6 -1.6 -1.6 -0.6 1.6 -0.6z"/></g>' +
    '<g class="cw-reeds"><path class="ic-reed" d="M-2.5 2V-6M0 2V-9M2.5 2V-5"/><path class="ic-reed-top" d="M-2.5 -6l0.8 -2.8M0 -9l0.8 -2.8M2.5 -5l0.8 -2.8"/></g>'
  );
}

/**
 * 11. 濕地風廊（「從濕地、滯洪池出發，重新檢視台北夏季風廊」）：濕地吹出三縷淡藍的涼風，往市區（台北車站的方向）飄；deg 是螢幕角度，0 往右
 */
export function windSvg(deg: number): string {
  return `<g class="wd" transform="rotate(${deg.toFixed(1)})">${[-5, 1, 7].map((y, i) => `<path class="wd-line l${i + 1}" d="M${i === 1 ? 11 : 9} ${y}q6 -3 12 0t12 0"/>`).join('')}</g>`;
}

/** 這個場景的圖；deg 是水流方向的螢幕角度（只有水圳淨水用） */
/**
 * 內科智慧錯峰（v1.573；港湖政見開箱「內湖南港，交通順起來」：和內科企業談彈性工時，選 7–8 點或 8–9 點上班，選錯峰的拿點數換咖啡）：
 * 玻璃帷幕的辦公大樓、樓頂一個大時鐘從 7 點走到 9 點，左邊兩個時段牌「7–8」「8–9」輪流亮——
 * 第一批上班族在 7–8 點走進大樓，第二批在 8–9 點；走到門口冒「+1」點數，變成一杯熱咖啡；一輪 14 秒
 */
const STAGGER =
  '<ellipse class="sc-shadow" cx="-5" cy="6.6" rx="21" ry="1.2"/><path class="ts-walkway" d="M-25 6.6H14"/>' +
  '<rect class="sg-tower" x="-4" y="-22" width="16" height="28.4" rx="0.8"/><path class="sg-grid" d="M-4 -16H12M-4 -10H12M-4 -4H12M1.3 -22V0.6M6.7 -22V0.6"/>' +
  '<rect class="sg-door" x="2" y="0.6" width="4" height="5.8" rx="0.4"/>' +
  // 樓頂的時鐘：時針從 7 點（210 度）走到 9 點，分針一輪轉兩圈
  '<g transform="translate(4 -26)"><circle class="sg-clock" r="3.6"/><path class="sg-tick" d="M0 -3V-2.3M3 0H2.3M0 3V2.3M-3 0H-2.3"/>' +
  '<g transform="rotate(210)"><g class="sg-hour"><path d="M0 0V-1.8"/></g></g><g class="sg-min"><path d="M0 0V-2.7"/></g><circle class="sg-pin" r="0.45"/></g>' +
  [['a', '7–8', -16], ['b', '8–9', -9.6]]
    .map(([k, t, y]) => `<g transform="translate(-15 ${y})"><rect class="sg-chip ${k}" x="-6" y="-2.4" width="12" height="4.8" rx="2.4"/><text class="sg-ct" y="1.1" text-anchor="middle">${t}</text></g>`)
    .join('') +
  // 兩批上班族（西裝、公事包），一批兩個人
  ['a', 'b'].map((k) => `<g transform="translate(-22 6.4)"><g class="sg-${k}">${dressed(SUIT)}<g transform="translate(-4.6 0)">${dressed(SUIT)}</g></g></g>`).join('') +
  // 門口：冒「+1」點數，變成一杯熱咖啡
  '<g transform="translate(4 -9)"><g class="sg-pt"><circle class="sg-coin" r="2.6"/><text class="sg-one" y="1" text-anchor="middle">+1</text></g>' +
  '<g class="sg-cup"><path class="sg-mug" d="M-1.8 -1.6H1.8L1.4 2H-1.4Z"/><path class="sg-handle" d="M1.7 -0.8Q3 -0.6 1.6 0.9"/><path class="sg-steam" d="M-0.6 -2.2q-0.6 -0.8 0 -1.6t0 -1.6M0.8 -2.2q-0.6 -0.8 0 -1.6t0 -1.6"/></g></g>';

/**
 * 南港展覽館散場（v1.574；港湖政見開箱「展覽散場也要錯峰，並想辦法讓人看完展覽後留下來」）：
 * 波浪屋頂的展覽館、屋頂上一個小時鐘；散場的人分兩批走出來（錯峰），第一批往右、第二批往左。
 * 要去哪裡不畫在這裡（v1.575 使用者說不用示意圖）：main.ts 照真的路線畫到 LaLaport 南港、中南山登山步道，沿路有人走過去；一輪 14 秒
 */
const EXPO =
  '<ellipse class="sc-shadow" cx="-1" cy="6.6" rx="17" ry="1.2"/>' +
  '<rect class="nx-hall" x="-14" y="-7" width="26" height="13.4" rx="0.8"/><path class="nx-roof" d="M-15.6 -7Q-8 -14 -1 -9.5Q6 -14 13.6 -7Z"/>' +
  '<rect class="nx-glass" x="-12" y="-5" width="22" height="3.4" rx="0.4"/><rect class="nx-door" x="-12.6" y="0.4" width="5.2" height="6" rx="0.4"/>' +
  '<rect class="nx-sign" x="2" y="0.4" width="7.4" height="4.6" rx="0.6"/><text class="nx-zhan" x="5.7" y="3.9" text-anchor="middle">展</text>' +
  '<g transform="translate(-1 -12.4)"><circle class="sg-clock" r="2.2"/><g class="nx-hand"><path d="M0 0V-1.6"/></g><circle class="sg-pin" r="0.35"/></g>' +
  `<g transform="translate(-10 6.4)"><g class="nx-a">${person('nx-coat')}<g transform="translate(-4.4 0)">${person('nx-coat b')}</g></g></g>` +
  `<g transform="translate(-10 6.4)"><g class="nx-b"><g transform="scale(-1 1)">${person('nx-coat c')}<g transform="translate(-4.4 0)">${person('nx-coat')}</g></g></g></g>`;

/**
 * 每週免費臨托（v1.650 使用者說在洋流號政策加上提高臨托時數；家庭一站通「6 個月到學齡前每週最多 4 小時免費臨托」）：
 * 粉紅色的親子館，招牌寫「臨托 4h」。家長牽著孩子走到門口，孩子進去（窗戶裡冒出孩子、球一跳一跳），
 * 家長走到右邊的長椅坐下喝杯熱咖啡、冒一顆小愛心喘口氣，再走回門口，孩子出來，兩個人一起走；一輪 14 秒
 */
const RESPITE =
  '<ellipse class="sc-shadow" cx="1" cy="6.6" rx="20" ry="1.2"/><path class="ts-walkway" d="M-22 6.6H20"/>' +
  '<rect class="rs-wall" x="-9" y="-9" width="16" height="15.4" rx="1"/><path class="rs-roof" d="M-10.6 -9L-1 -15.4L8.6 -9Z"/>' +
  '<rect class="rs-sign" x="-6.4" y="-7.8" width="10.8" height="4" rx="2"/><text class="rs-st" x="-1" y="-4.9" text-anchor="middle">臨托 4h</text>' +
  '<rect class="rs-win" x="-7.4" y="-2.4" width="5.4" height="4.2" rx="0.6"/>' +
  // 窗戶裡：孩子在玩（進去之後才出現）、球一跳一跳
  '<g class="rs-play"><circle class="sc-head" cx="-5.6" cy="0.2" r="1.1"/><circle class="rs-ball" cx="-3.4" cy="0.9" r="0.7"/></g>' +
  '<rect class="rs-door" x="0.6" y="0.6" width="4" height="5.8" rx="0.4"/>' +
  // 右邊的長椅
  '<path class="pp-wood" d="M11 3.6H18.6"/><path class="pp-leg" d="M11.6 3.6V6M18 3.6V6"/>' +
  // 來：家長牽著孩子走到門口
  `<g transform="translate(-20 6.4)"><g class="rs-come">${person('rs-coat')}<g transform="translate(2.4 0) scale(0.62)">${person('rs-kid')}</g></g></g>` +
  // 喘口氣：家長坐在長椅上（屁股在椅面、腳往前垂下），手上一杯熱咖啡，冒一顆小愛心
  '<g transform="translate(13.4 3.2)"><g class="rs-rest"><path class="sc-leg" d="M0 0H2.4V2.8"/><path class="rs-coat" d="M0 0V-4"/><circle class="sc-head" cy="-5.7" r="1.6"/>' +
  '<g transform="translate(2.6 -3)"><path class="sg-mug" d="M-1.2 -1.1H1.2L0.9 1.3H-0.9Z"/><path class="sg-steam" d="M-0.3 -1.5q-0.5 -0.7 0 -1.3t0 -1.3"/></g>' +
  '<path class="rs-heart" d="M0 -9c-1.4 -1 -2.6 -1.9 -2.6 -3.1a1.3 1.3 0 0 1 2.6 -0.4a1.3 1.3 0 0 1 2.6 0.4c0 1.2 -1.2 2.1 -2.6 3.1z"/></g></g>' +
  // 接回來：從門口一起往左走
  `<g transform="translate(2.6 6.4)"><g class="rs-go"><g transform="scale(-1 1)">${person('rs-coat')}<g transform="translate(2.4 0) scale(0.62)">${person('rs-kid')}</g></g></g></g>`;

export function sceneSvg(kind: SceneKind, deg: number): string {
  switch (kind) {
    case 'schoolwalk':
      return SCHOOLWALK;
    case 'sporthub':
      return hub('trail');
    case 'workhub':
      return hub('work');
    case 'ridehub':
      return hub('ride');
    case 'streettree':
      return STREETTREE;
    case 'bikerack':
      return BIKERACK;
    case 'nightmayor':
      return NIGHTMAYOR;
    case 'buscharge':
      return BUSCHARGE;
    case 'library24':
      return LIBRARY24;
    case 'lantern':
      return LANTERN;
    case 'nightsky':
      return NIGHTSKY;
    case 'tpassgo':
      return TPASS_GO;
    case 'tpasspark':
      return TPASS_PARK;
    case 'busterminal':
      return BUS_TERMINAL;
    case 'cyclerenew':
      return CYCLE_RENEW;
    case 'stagger':
      return STAGGER;
    case 'expo':
      return EXPO;
    case 'respite':
      return RESPITE;

    case 'oldhouse':
      return OLDHOUSE;
    case 'lunch':
      return LUNCH;
    case 'pocketpark':
      return POCKETPARK;
    case 'detention':
      return DETENTION;
    case 'piggy':
      return PIGGY;
    case 'aiteam':
      return AITEAM;
    case 'cleanwater':
      return cleanSvg(deg);
  }
}

/**
 * 8. 樹醫生（都市微森林「樹醫生等綠領人才」「路樹數位雙生與健康履歷」）：長回來的大樹旁，穿白袍的樹醫生走過來拿聽診器聽一聽，
 * 樹上冒出綠色的打勾，再走開（接在 regrowSvg 後面；樹不動，v1.529 使用者說樹不用搖）
 */
export const TREE_DOCTOR =
  `<g transform="translate(0 6)"><g class="rg-doc">${person('rg-coat', '<path class="rg-cap" d="M-1.7 -9.8A1.7 1.7 0 0 1 1.7 -9.8Z"/><path class="rg-steth" d="M-0.9 -7.6Q0 -5.4 0.9 -7.6M0.9 -7.6Q2.6 -6.6 2.6 -5"/><circle class="rg-steth-end" cx="2.6" cy="-4.8" r="0.6"/>')}</g></g>` +
  '<g transform="translate(0 -24)"><g class="rg-ok"><circle r="3.2"/><path d="M-1.6 0L-0.4 1.3L1.8 -1.2"/></g></g>';

/**
 * 路樹數位雙生（v1.560 使用者說「先做路樹數位雙生」；都市微森林政見「用數位雙生、監控系統與動態健康履歷管理路樹，
 * 現有路樹分改善、更新、移除三級處理」）：長回來的大樹右邊浮一棵淡藍色線框的分身樹，上面一張健康履歷卡；
 * 樹和分身之間的小光點一直在同步，樹醫生來聽診時（跟 TREE_DOCTOR 同一個 9 秒）履歷卡的狀態條跑一下，變綠色、打勾。拉近才出現
 */
export const TREE_TWIN =
  '<g transform="translate(3 0)"><g class="tw">' +
  '<path class="tw-line" d="M17 6V-3"/><circle class="tw-line" cx="13.4" cy="-6.6" r="4.4"/><circle class="tw-line" cx="20.6" cy="-6.6" r="4.4"/><circle class="tw-line" cx="17" cy="-10.6" r="5"/>' +
  '<path class="tw-grid" d="M12 -6.6H22M17 -15V-2"/>' +
  [1, 2, 3].map((i) => `<circle class="tw-bit b${i}" cx="6" cy="-12" r="0.75"/>`).join('') +
  '<g transform="translate(17 -21)"><rect class="tw-card" x="-6" y="-3" width="12" height="6" rx="1"/><rect class="tw-track" x="-4.4" y="-0.8" width="6.4" height="1.6" rx="0.8"/>' +
  '<rect class="tw-bar" x="-4.4" y="-0.8" width="6.4" height="1.6" rx="0.8"/><g transform="translate(3.6 0)"><g class="tw-ok"><circle r="1.4"/><path d="M-0.7 0L-0.15 0.55L0.8 -0.55"/></g></g></g></g></g>';

/**
 * 14. 關渡國際足球場（「規劃符合國際賽事的關渡國際足球場，建立台北的城市主場」）：球員射門、球進網、看台的觀眾跟著做波浪
 */
export const SOCCER_SVG =
  '<ellipse class="ic-stand" rx="16" ry="10"/>' +
  Array.from({ length: 9 }, (_, i) => {
    const a = ((200 + i * 17.5) * Math.PI) / 180;
    return `<circle class="sc-fan f${i % 3}" style="--i:${i}" cx="${(13.5 * Math.cos(a)).toFixed(1)}" cy="${(8.1 * Math.sin(a)).toFixed(1)}" r="1.25"/>`;
  }).join('') +
  '<ellipse class="ic-field" rx="11" ry="6"/><path class="ic-lines" d="M0 -6V6"/><circle class="ic-lines" r="2"/>' +
  '<path class="sc-goal" d="M-9.4 -2.4H-10.8V2.4H-9.4"/><g class="sc-net"><path class="sc-goal" d="M9.4 -2.4H10.8V2.4H9.4"/><path class="sc-mesh" d="M10.1 -2.2V2.2"/></g>' +
  `<g transform="translate(-4.2 2.6) scale(0.6)">${person('sc-shirt')}</g><circle class="sc-ball" cx="-2.6" cy="2.2" r="0.95"/>`;

/**
 * 15. 花博旗艦運動中心（「場館無障礙與性別友善……全齡都能參與」「增設新興與適應運動空間」）：圓頂右邊一道無障礙坡道，
 * 坐輪椅的人從坡道推上去、進門
 */
export const DOME_SVG =
  '<path class="ic-base" d="M-14 4H14V7H-14Z"/><path class="ic-dome" d="M-13 4A13 13 0 0 1 13 4Z"/><path class="ic-rib" d="M0 -9V4M-7 -7Q0 -4 7 -7"/>' +
  '<rect class="dm-door" x="7.4" y="-0.8" width="3.4" height="4.8" rx="0.6"/><path class="dm-ramp" d="M27 7L14 4V7Z"/><path class="dm-rail" d="M27 4.4L14 1.4"/>' +
  '<g class="dm-roll"><circle class="dm-wheel" cy="-2" r="2"/><circle class="dm-wheel" cx="3" cy="-0.8" r="0.8"/><path class="dm-chair" d="M-0.8 -2.4H2.6M-0.8 -2.4V-6.2"/>' +
  '<path class="dm-body" d="M0.4 -2.8V-6.6M0.4 -2.8H2.8V-0.8"/><circle class="sc-head" cx="0.6" cy="-8.2" r="1.4"/></g>';

/** 4. 載菜的小貨車（往右開，往左時翻過來）：綠色車頭、車斗裝滿青菜 */
export const TRUCK_SVG =
  '<g class="boat-flip"><ellipse class="bk-shadow" cx="0" cy="0.4" rx="10" ry="1.1"/><g class="tk-bob">' +
  '<path class="tk-bed" d="M-10.5 -5.6H1.2V-2H-10.5Z"/><circle class="tk-veg" cx="-8.4" cy="-6.6" r="1.9"/><circle class="tk-carrot" cx="-5.2" cy="-7.2" r="2.1"/><circle class="tk-veg" cx="-2" cy="-6.5" r="1.8"/>' +
  '<path class="tk-leaf" d="M-5.2 -9.2l0.8 -1.6M-8.4 -8.4l-0.6 -1.4M-2 -8.2l0.7 -1.4"/>' +
  '<path class="tk-cab" d="M1.2 -2V-8.8H6.2L9.6 -5.2V-2Z"/><path class="tk-win" d="M2.6 -7.6H5.7L8 -5.2H2.6Z"/><rect class="tk-chassis" x="-11" y="-2.4" width="21" height="1.4" rx="0.5"/></g>' +
  '<circle class="tk-wheel" cx="-6.4" cy="-0.9" r="1.9"/><circle class="tk-wheel" cx="5.6" cy="-0.9" r="1.9"/><circle class="tk-hub" cx="-6.4" cy="-0.9" r="0.7"/><circle class="tk-hub" cx="5.6" cy="-0.9" r="0.7"/></g>';
