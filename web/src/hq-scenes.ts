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
export type SceneKind = 'sporthub' | 'pocketpark' | 'detention' | 'cleanwater' | 'schoolwalk' | 'lunch' | 'piggy' | 'aiteam';
const SCENE_KINDS: readonly string[] = ['sporthub', 'pocketpark', 'detention', 'cleanwater', 'schoolwalk', 'lunch', 'piggy', 'aiteam'];
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
 * 3. 運動驛站（「在重點捷運站旁與登山口設運動驛站，提供盥洗、置物與租借服務」）：捷運站旁一間小驛站（窗戶畫淋浴的水滴、置物櫃），
 * 穿西裝的上班族走進去、換好運動服出來
 */
const SPORTHUB =
  '<ellipse class="sc-shadow" cx="0" cy="6.6" rx="14" ry="1.4"/>' +
  '<rect class="sh-wall" x="-8" y="-6" width="16" height="12.4" rx="1"/><path class="sh-roof" d="M-9.5 -6H9.5V-9.4H-9.5Z"/>' +
  '<rect class="sh-win" x="-6.6" y="-4" width="4" height="3.8" rx="0.6"/><path class="sh-drop" d="M-4.6 -3.4Q-5.9 -1.7 -4.6 -0.9Q-3.3 -1.7 -4.6 -3.4Z"/>' +
  '<rect class="sh-win" x="2.6" y="-4" width="4" height="3.8" rx="0.6"/><path class="sh-lock" d="M3.4 -3.3H5.8V-0.9H3.4ZM4.6 -3.3V-0.9"/>' +
  '<rect class="sh-door" x="-1.9" y="0.6" width="3.8" height="5.8" rx="0.5"/>' +
  `<g transform="translate(0 6.4)"><g class="sh-in">${person('sh-suit', '<path class="sh-tie" d="M0 -7.3V-5.4"/><rect class="sh-case" x="1.1" y="-4.6" width="2.6" height="1.9" rx="0.3"/>')}</g>` +
  `<g class="sh-out">${person('sh-sport', '<path class="sh-cap" d="M-1.7 -9.7A1.7 1.7 0 0 1 1.7 -9.7H3Z"/><path class="sh-towel" d="M-0.9 -7.6Q0 -6.6 0.9 -7.6"/>')}</g></g>`;

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
export function sceneSvg(kind: SceneKind, deg: number): string {
  switch (kind) {
    case 'schoolwalk':
      return SCHOOLWALK;
    case 'sporthub':
      return SPORTHUB;
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
