import type * as Leaflet from 'leaflet';
import { DOME_SVG, idlePhase, isSceneKind, PATROL_SVG, sceneSvg, SCOOTER_SVG, SOCCER_SVG, TRUCK_SVG, WALKER_SVG, windSvg, type SceneKind } from './hq-scenes';
import { alongLine, BOAT_SVG, crackSvg, FITBUS_BODY, FITBUS_SVG, hqDenseZoom, hqMotionZoom, HQ_LABEL_ZOOM, HQ_NET_LABEL_KM, BIKE_SVG, HIKER_SVG, PETWALK_SVG, FISH_SVG, WETLAND_BIRDS, MUSIC_NOTES, bikePhase, fitbusPhase, fitbusStopSvg, cultureSvg, regrowSvg, serviceSvg, stitchSvg, boatPhase, fireworksSvg, FIREWORKS_MS, flowOut, HQ_VOYAGE_MS, RAINBOW_FLOW_TOTAL, RAINBOW_STAGGER_MS, surge, SURGE_TOTAL, voyagePhase, voyageTimeOf } from './flow';
import { haversineKm, type LatLng } from './geo';
import type { EventKind, Phase } from './types';
import { LANDMARKS } from './landmarks';

export interface MapItem {
  id: number;
  kind: EventKind;
  lat: number;
  lng: number;
  phase: Phase;
  spot?: boolean;
  /** 服務處、競選總部的固定據點：畫成房子圖示（其他是圓點） */
  office?: boolean;
  approx?: boolean;
  /** 還沒開始的清楚程度：1 快開始了 … 0 一週以上 */
  fade?: number;
  /** 車掃的起點、終點：畫成 🚩、🏁 */
  flag?: string;
  title: string;
  subtitle: string;
  selected: boolean;
}

/** 底圖：nlsc 台灣通用電子地圖（國土測繪中心）、osm OpenStreetMap */
export type BaseMap = 'nlsc' | 'osm';

/** 地圖上的車掃路線：每段依認領人數上色 */
export interface MapRoute {
  id: string;
  title: string;
  state: 'planned' | 'live' | 'done';
  claimUrl: string | null;
  /** report：回報的車掃貼文，各站直線連起來、沒有認領人數 */
  source?: 'official' | 'report';
  /** 畫成彩虹（同志遊行）：每一段是一條路線（from 是名稱、to 是經過的路） */
  rainbow?: boolean;
  /** 洋流車掃（台北大洋流官方的）：路線畫成一道往前流的水，進行中再加湧過去的浪 */
  ocean?: boolean;
  /** 彩虹從出發的地方流出、洋流湧過去：開始的時間（Date.now() 的毫秒）；沒有是不流 */
  flowAt?: number;
  segments: Array<{ seq: number; from: string; to: string; path: Array<[number, number]>; people: number; target: number; passed?: boolean }>;
  /** 中間點（官方車掃轉彎的地方）：路線上的小圓點，點了寫預計經過的時間和名稱 */
  turns?: Array<{ lat: number; lng: number; label: string }>;
  /** 洋流號：沿著路線一直重複開的船（動畫，不是車隊的實際位置） */
  boat?: boolean;
  /** 只開一趟的洋流號（點了洋流總部，開到台北市政府）：出發的時間（Date.now() 的毫秒）；只畫水、不分段上色，跟著淡入淡出 */
  voyage?: number;
  /** 這一趟洋流號的代號（出發時的時間）：加速時 voyage 一直往前挪，重畫要不要照這個判斷，不然每一格都整個重畫 */
  voyageKey?: number;
  /** 終點放煙火：開始放的時間（Date.now() 的毫秒） */
  fireworks?: number;
  /** 經過的地方：船經過時（at，Date.now() 的毫秒）寫一下名字再淡掉；keep 的一直寫著（終點）；stay 的出現後留著；dy 是字離那一點多高（螢幕像素，預設 -10） */
  stops?: Array<{ lat: number; lng: number; label: string; at: number; keep?: boolean; stay?: boolean; dy?: number; hideKm?: number }>;
  /** 終點用虛線畫出來的外框（台北市政府） */
  outline?: Array<[number, number]>;
  /** 畫成一條河（洋流總部的特效）：跟著船（voyage）從起點長出來，河面上一道道波光往下游流；河岸兩邊跟著長出一棵棵樹 */
  river?: boolean;
  /** 老水路（水域政策「把水找回來」）：船到 at 前先浮出虛線的鬼影，到了從第一點（源頭）注水填滿；label 寫在中間 */
  canals?: Array<{ path: Array<[number, number]>; at: number; label: string }>;
  /** 湧泉（堀仔頭）：船到 at 時一圈圈漣漪冒出來、留著 */
  springs?: Array<{ lat: number; lng: number; at: number; label: string }>;
  /** 老水塘（雙連陂）：船到 at 前先浮出虛線的鬼影，到了填成水、留著 */
  ponds?: Array<{ ring: Array<[number, number]>; at: number; label: string }>;
  /** 種樹的地方（都市微森林）：船經過時在那裡長出一叢樹；cut 是有砍樹爭議的地方（多一點、光環、寫名字），plant 是政見說要加強種樹的地方 */
  plantings?: Array<{ lat: number; lng: number; at: number; kind: 'cut' | 'plant'; label?: string; spreadM?: number }>;
  /** 街道的路樹（都市微森林）：船經過市區時離路線稍遠的一個中心（在街道上）往四周的街道長出一排排的樹，離中心越遠越晚長 */
  blooms?: Array<{ center: [number, number]; at: number; streets: Array<{ pts: Array<[number, number]>; mid: number }> }>;
  /** 真的河（水域政策「親水」）：船沿河走時（at）水面亮成藍色、留著 */
  rivers?: Array<{ ring: Array<[number, number]>; at: number }>;
  /** 一條線從頭長到尾：trail 山林徑、bridge 自行車橋、stars 星座、culture 文化徑的線（color）；label 寫在尾端（文化徑寫在中間） */
  reveals?: Array<{ path: Array<[number, number]>; at: number; kind: 'trail' | 'bridge' | 'stars' | 'culture'; label?: string; color?: string; labelAt?: number; hideKm?: number }>;
  /** 騎自行車的人：跟雷達一樣（經緯度） */
  bikes?: Array<{ path: Array<[number, number]>; start: number; lap: number; kind?: 'bike' | 'hiker' | 'pet' | 'truck' | 'walker' | 'patrol' | 'scooter'; loop?: boolean; color?: string }>;
  /** 健身小巴：跟雷達一樣（經緯度） */
  fitbuses?: Array<{ path: Array<[number, number]>; start: number; lineAt: number; stopAt: number[]; stops: Array<{ at: [number, number]; label: string }>; focus?: boolean; dim?: boolean; driveMs: number }>;
  /** 縫合（市民大道）：跟雷達一樣（經緯度） */
  seams?: Array<{
    path: Array<[number, number]>;
    at: number;
    healAt: number;
    label: string;
    labelAt: number;
    stitches: Array<{ at: number; center: [number, number]; along: [number, number]; label: string; below?: boolean }>;
    walkers: Array<{ from: [number, number]; to: [number, number]; at: number; south?: boolean }>;
  }>;
  /** 綠覆率：整個台北市（ring）在 steps 的每個時間再鋪一層很淡的綠 */
  green?: { ring: Array<[number, number]>; steps: number[] };
  /** 一塊地方（社子島）：at 時淡入、留著，虛線外框、名字寫在中間 */
  /** 一塊夜色（條通）：at 慢慢暗下來 */
  nights?: Array<{ ring: Array<[number, number]>; at: number }>;
  areas?: Array<{ ring: Array<[number, number]>; center: [number, number]; at: number; label: string; zones?: Array<Array<[number, number]>>; zonesAt?: number }>;
  /** 洋流號的河什麼時候淡掉（到終點後拿掉，政策的東西才看得清楚） */
  riverOut?: number;
  /** 文化網（點 —— 線 —— 面） */
  network?: { at: number; lines: Array<{ path: Array<[number, number]>; color: string }>; dots: Array<{ lat: number; lng: number; color: string }>; noFace?: boolean; faceR?: number };
  /** 一個東西冒出來：hut 登山中心、stadium 足球場、dome 運動中心、star 星星、regrow 樹樁（grow 時長回大樹）、culture 文化徑的點（small 的名字地圖上不寫，滑鼠移過去看介紹） */
  icons?: Array<{ lat: number; lng: number; at: number; kind: 'hut' | 'stadium' | 'dome' | 'bigdome' | 'star' | 'regrow' | 'culture' | 'service' | 'wetland' | 'archbridge' | 'chest' | 'chestlock' | 'paw' | 'umusic' | 'uart' | 'uexhibit' | 'uyouth' | 'ushop' | 'fitbus' | SceneKind; label?: string; hideKm?: number; scale?: number; grow?: number; char?: string; color?: string; small?: boolean; focus?: boolean; rot?: number; calm?: boolean }>;
  /** 政策圖層開著：其他特效變淡，只有 focus 的地方、通學區的圈清楚 */
  focus?: boolean;
  /** 都更的基地範圍（at 時淡入） */
  sites?: Array<{ rings: Array<Array<[number, number]>>; at: number }>;
  /** 通學區：國小四周 radiusM 公尺，at 時淡入 */
  circles?: Array<{ lat: number; lng: number; radiusM: number; at: number }>;
  /** 滑鼠移過去的介紹（at 之後才感應；dy 是往上移幾像素） */
  hits?: Array<{ lat: number; lng: number; at: number; title: string; intro: string; dy?: number; r?: number }>;
  /** 水上活動：船經過時（at）河上出現 SUP、龍舟；heading 是船頭朝哪（度，0 是上、順時針） */
  boats?: Array<{ lat: number; lng: number; at: number; kind: 'sup' | 'dragon'; heading: number }>;
}

/** 種樹的地方長幾棵（砍樹的地方多一點）、老水路的鬼影在船到之前幾毫秒浮出來（洋流總部的特效，跟 radar.ts 一樣） */
const MAP_PLANT_CUT_TREES = 22;
const MAP_PLANT_TREES = 10;
/** 街道的路樹每隔幾公里一棵；河流每幾個點固定成一段 */
const MAP_STREET_TREE_KM = 0.07;
const MAP_RIVER_CHUNK = 24;
const MAP_CANAL_GHOST_MS = 1200;
/** 河到終點後多久拿掉（淡出 1.5 秒，多留一點） */
const MAP_RIVER_GONE_MS = 1700;
/** 水上活動的船（跟 radar.ts 一樣的畫法，顏色在 styles.css） */
const MAP_SUP_SVG =
  '<path class="wb-wake" d="M-14 2.5q-4 0 -7 1.6"/>' +
  '<path class="wb-board" d="M-11 -2.6H9q4 0 5.5 2.6Q13 2.6 9 2.6H-11q-3.5 0 -3.5 -2.6Q-14.5 -2.6 -11 -2.6Z"/>' +
  '<path class="wb-stripe" d="M-9 0H9"/>' +
  '<path class="wb-paddle" d="M-2 -9.5L6 5.5"/>' +
  '<circle class="wb-head" cx="-1" cy="-7.8" r="2.2"/>' +
  '<path class="wb-body" d="M-1 -5.6V-1"/>';
const MAP_DRAGON_SVG =
  '<path class="wb-wake" d="M-24 3q-6 0 -10 2"/>' +
  '<path class="wb-hull" d="M-22 -3.2H18Q26 -3.2 29 0Q26 3.2 18 3.2H-22Q-26 3.2 -26 0Q-26 -3.2 -22 -3.2Z"/>' +
  '<path class="wb-stripe" d="M-21 0H18"/>' +
  '<path class="wb-dragon" d="M23 -3.4q6 -3 6 -8q2 3 0 6q4 1 2 5.4Z"/>' +
  '<circle class="wb-eye" cx="25.6" cy="-7.4" r="0.9"/>' +
  '<path class="wb-tail" d="M-26 0q-4 -4 -2 -8q1 3 4 5Z"/>' +
  Array.from({ length: 6 }, (_, i) => {
    const x = -16 + i * 6;
    return `<path class="wb-paddle" d="M${x} -4.5L${x + 3} -9"/><circle class="wb-head" cx="${x}" cy="-1.2" r="1.6"/>`;
  }).join('');
/** 冒出來的東西（跟 radar.ts 一樣的畫法，顏色在 styles.css） */
const MAP_ICON_SVG: Record<'hut' | 'stadium' | 'dome' | 'bigdome' | 'star' | 'wetland' | 'archbridge' | 'chest' | 'chestlock' | 'paw' | 'umusic' | 'uart' | 'uexhibit' | 'uyouth' | 'ushop' | 'fitbus', string> = {
  fitbus: `<g transform="translate(0 9)">${FITBUS_BODY}</g>`,
  // 音樂的圖示飄出小音符（v1.534）
  umusic: '<circle class="ud-bg" r="9"/><path class="ud-ink" d="M-1.5 4V-5.5L5 -7.5V2"/><ellipse class="ud-fill" cx="-3.6" cy="4.2" rx="2.6" ry="2"/><ellipse class="ud-fill" cx="2.9" cy="2.2" rx="2.6" ry="2"/>' + MUSIC_NOTES,
  uart: '<circle class="ud-bg" r="9"/><path class="ud-pal" d="M-6 2Q-8 -6 0 -6.5Q7 -6.5 6.5 -1Q6 2 3 1.5Q1 1.2 1 3.5Q1 6 -2 5.5Q-5 5 -6 2Z"/><circle class="ud-c1" cx="-3" cy="-2.6" r="1.3"/><circle class="ud-c2" cx="0.8" cy="-4" r="1.3"/><circle class="ud-c3" cx="4" cy="-2" r="1.3"/>',
  uexhibit: '<circle class="ud-bg" r="9"/><rect class="ud-frame" x="-6" y="-5" width="12" height="9.5" rx="1"/><path class="ud-mtn" d="M-4.5 3L-1.5 -1L0.8 1.6L2.4 0L4.5 3Z"/><circle class="ud-c3" cx="2.4" cy="-2.6" r="1.2"/>',
  uyouth: '<circle class="ud-bg" r="9"/><path class="ud-bub" d="M-7 -5H1.5V1H-3L-5.2 3.2V1H-7Z"/><path class="ud-bub2" d="M-1.5 -1.5H7V4.5H5.2V6.6L3 4.5H-1.5Z"/>',
  ushop: '<circle class="ud-bg" r="9"/><rect class="ud-shop" x="-5.5" y="-2.5" width="11" height="8" rx="0.6"/><path class="ud-awn" d="M-7 -2.5L-5.5 -6.5H5.5L7 -2.5Z"/><path class="ud-awn-s" d="M-3.5 -6.5L-4.2 -2.5M0 -6.5V-2.5M3.5 -6.5L4.2 -2.5"/><rect class="ud-door" x="-1.6" y="0.6" width="3.2" height="4.9"/>',
  chest: '<path class="ch-beam" d="M-8 -7L-13 -21H13L8 -7Z"/><path class="ch-lid-o" d="M-11 -6Q-12 -17 0 -18Q12 -17 11 -6Z"/><path class="ch-lid-in" d="M-8.5 -6.5Q-9 -14 0 -14.8Q9 -14 8.5 -6.5Z"/><path class="ch-gold" d="M-10.5 -4.5Q-8 -9.5 -4 -6.5Q-1 -11 3 -7Q6 -10 10.5 -4.5Z"/><circle class="ch-coin" cx="-4.5" cy="-7.5" r="1.6"/><circle class="ch-coin" cx="3" cy="-8.6" r="1.6"/><rect class="ch-box" x="-12" y="-5" width="24" height="13" rx="3"/><path class="ch-dark" d="M-11.3 3.5H11.3V5.2Q11.3 7.3 9 7.3H-9Q-11.3 7.3 -11.3 5.2Z"/><rect class="ch-trim" x="-12" y="-1.6" width="24" height="2.6"/><rect class="ch-trim" x="-2.6" y="-5" width="5.2" height="13" rx="1"/><path class="ch-gem" d="M0 -2.6L2.4 0.2L0 3L-2.4 0.2Z"/><circle class="ch-hi" cx="-0.7" cy="-0.6" r="0.6"/><path class="ch-shine" d="M-9.4 -3V1.8"/><path class="kira k1" d="M-14.0 -17.2L-13.1 -14.9L-10.8 -14.0L-13.1 -13.1L-14.0 -10.8L-14.9 -13.1L-17.2 -14.0L-14.9 -14.9Z"/><path class="kira k2" d="M13.5 -13.6L14.2 -11.7L16.1 -11.0L14.2 -10.3L13.5 -8.4L12.8 -10.3L10.9 -11.0L12.8 -11.7Z"/><path class="kira k3" d="M8.0 -23.0L8.6 -21.6L10.0 -21.0L8.6 -20.4L8.0 -19.0L7.4 -20.4L6.0 -21.0L7.4 -21.6Z"/>',
  chestlock: '<path class="ch-lid-c" d="M-12 -4Q-12 -14.5 0 -14.5Q12 -14.5 12 -4Z"/><path class="ch-lid-hi" d="M-8.5 -7Q-8 -12 -2 -12.6"/><rect class="ch-box" x="-12" y="-4" width="24" height="12" rx="3"/><path class="ch-dark" d="M-11.3 3.5H11.3V5.2Q11.3 7.3 9 7.3H-9Q-11.3 7.3 -11.3 5.2Z"/><rect class="ch-trim" x="-12" y="-5" width="24" height="2.4"/><rect class="ch-trim" x="-8.4" y="-13" width="2.6" height="21" rx="1"/><rect class="ch-trim" x="5.8" y="-13" width="2.6" height="21" rx="1"/><path class="ch-shackle" d="M-2.4 -2V-5A2.4 2.4 0 0 1 2.4 -5V-2"/><rect class="ch-lockbody" x="-4" y="-2.4" width="8" height="6.6" rx="1.6"/><circle class="ch-key" cx="0" cy="0.2" r="1"/><path class="ch-keyline" d="M0 0.6V2.6"/><path class="ch-shine" d="M-9.4 -1.6V2"/><path class="kira k2" d="M13.5 -14.4L14.2 -12.7L15.9 -12.0L14.2 -11.3L13.5 -9.6L12.8 -11.3L11.1 -12.0L12.8 -12.7Z"/>',
  paw: '<ellipse class="pw" cx="0" cy="4" rx="6.5" ry="5.5"/><ellipse class="pw" cx="-8" cy="-3" rx="2.8" ry="3.6" transform="rotate(-20 -8 -3)"/><ellipse class="pw" cx="-3" cy="-8" rx="2.8" ry="3.8" transform="rotate(-6 -3 -8)"/><ellipse class="pw" cx="3" cy="-8" rx="2.8" ry="3.8" transform="rotate(6 3 -8)"/><ellipse class="pw" cx="8" cy="-3" rx="2.8" ry="3.6" transform="rotate(20 8 -3)"/>',
  archbridge: '<path class="ic-stone" d="M-16 -3H16V6H11A6 6 0 0 0 1 6H-1A6 6 0 0 0 -11 6H-16Z"/><path class="ic-stone-line" d="M-16 0H16M-6 -3V0M6 -3V0"/><path class="ic-lamp" d="M-13 -3V-8M0 -3V-8M13 -3V-8"/><circle class="ic-lamp-top" cx="-13" cy="-9" r="1.6"/><circle class="ic-lamp-top" cx="0" cy="-9" r="1.6"/><circle class="ic-lamp-top" cx="13" cy="-9" r="1.6"/>',
  // 濕地上兩隻小鳥飛起來繞一圈再降落（v1.534）
  wetland: '<ellipse class="ic-pond" cx="0" cy="4" rx="11" ry="4.5"/><path class="ic-reed" d="M-6 4V-7M-2 4V-11M2 4V-6M6 4V-9"/><path class="ic-reed-top" d="M-6 -7l1 -3.5M-2 -11l1 -3.5M2 -6l1 -3.5M6 -9l1 -3.5"/>' + WETLAND_BIRDS,
  hut: '<path class="ic-roof" d="M-9 -1L0 -11L9 -1Z"/><path class="ic-wall" d="M-7 -1H7V7H-7Z"/><path class="ic-door" d="M-2 7V2H2V7Z"/><path class="ic-flag" d="M0 -11V-17M0 -17H5L3.5 -15L5 -13H0"/>',
  stadium: SOCCER_SVG,
  dome: DOME_SVG,
  // 大巨蛋：扁扁的銀灰色金屬屋頂（屋頂接縫、頂上一圈）、深色玻璃帶、淺灰外牆的直條（v1.522 使用者說外殼改成灰色比較貼近原本的樣子；花博旗艦運動中心照舊用 dome）
  bigdome: '<ellipse class="dm-shadow" cx="0" cy="7.4" rx="16.5" ry="2.1"/><path class="dm-base" d="M-16 6.6L-15 1H15L16 6.6Z"/><path class="dm-fin" d="M-12.5 2.6V6.2M-9.5 2.6V6.4M-6.5 2.6V6.4M-3.5 2.6V6.4M-0.5 2.6V6.4M2.5 2.6V6.4M5.5 2.6V6.4M8.5 2.6V6.4M11.5 2.6V6.4M14.2 2.6V6"/><path class="dm-glass" d="M-15 1H15L15.3 2.6H-15.3Z"/><path class="dm-roof" d="M-15 1C-12 -9 12 -9 15 1Z"/><path class="dm-sh" d="M15 1C13.2 -4.2 9 -6.1 4 -6.4C8.8 -4.6 11.8 -2 12.6 1Z"/><path class="dm-hi" d="M-12.6 -0.6C-10.4 -5 -5 -6.3 -0.5 -6.5C-5.2 -5.5 -8.8 -3.4 -10.4 0.2Z"/><path class="dm-rib" d="M0 -6.5V1M-5.2 -5.9Q-6.8 -2.6 -7.6 1M5.2 -5.9Q6.8 -2.6 7.6 1M-9.6 -3.9Q-11.4 -1.6 -12.2 1M9.6 -3.9Q11.4 -1.6 12.2 1"/><path class="dm-ring" d="M-6.2 -5.1Q0 -7.6 6.2 -5.1"/>',
  star: '<path class="ic-star" d="M0 -7L2 -2.2L7 -2.2L3 0.9L4.4 5.8L0 2.9L-4.4 5.8L-3 0.9L-7 -2.2L-2 -2.2Z"/>',
};
/** 0～1 的固定亂數（照編號，重畫一樣） */
const mapHash = (n: number): number => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
/** 彩虹旗的六個顏色（紅、橙、黃、綠、藍、紫） */
export const RAINBOW = ['#e40303', '#ff8c00', '#ffed00', '#008026', '#004dff', '#750787'];

/** 跟大洋流車掃地圖一樣的顏色：沒人灰、缺人綠、快滿（6 成以上）橘、已滿紅 */
const CROWD = {
  empty: { color: '#9ca3af', label: '還沒有人' },
  low: { color: '#16a34a', label: '缺人' },
  mid: { color: '#f59e0b', label: '快滿' },
  full: { color: '#dc2626', label: '已滿' },
} as const;

export function crowdOf(people: number, target: number): keyof typeof CROWD {
  if (people === 0) return 'empty';
  const r = target > 0 ? people / target : 1;
  return r >= 1 ? 'full' : r >= 0.6 ? 'mid' : 'low';
}

const BASES: Record<BaseMap, { url: string; attribution: string; maxNativeZoom: number }> = {
  nlsc: {
    url: 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}',
    attribution: '<a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noopener">內政部國土測繪中心</a>',
    maxNativeZoom: 19,
  },
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    maxNativeZoom: 19,
  },
};

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function markerColor(kind: EventKind, phase: Phase, spot = false): string {
  if (phase === 'later') return cssVar('--muted', '#888888');
  if (spot) return cssVar('--blip-spot', '#1d4e89');
  if (kind === 'activity') return cssVar('--blip-activity', '#03615a');
  return phase === 'soon' ? cssVar('--blip-soon', '#ffe08a') : cssVar('--blip', '#ea611d');
}

/** 服務處的房子圖示（SVG），外框虛線跟其他固定據點一樣 */
function officeSvg(fill: string, stroke: string, strokeW: number, fillOpacity: number, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-12 -12 24 24"><path d="M0 -9.5 L9 -1.5 V9 H-9 V-1.5 Z" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${strokeW}" stroke-dasharray="3 2" stroke-linejoin="round"/></svg>`;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Leaflet 地圖，第一次切到地圖時才載入 */
export interface MapBottle {
  id: number;
  lat: number;
  lng: number;
  state: 'near' | 'pick';
  mine: boolean;
  picked: boolean;
}

const MAP_BOTTLE_PATH = 'M-1.8 -8 h3.6 v3 l2.4 3 v8.2 a1.6 1.6 0 0 1 -1.6 1.6 h-5.2 a1.6 1.6 0 0 1 -1.6 -1.6 v-8.2 l2.4 -3 z';

/** 拉遠就不寫的字：雷達的公里數對到地圖的哪一級（5 km → 縮放 14 以下、10 km → 13 以下、文化網 12 km → 12.5 以下；styles.css 的 #map.label-far*） */
const farCls = (km: number): string => (km >= 12 ? 'far-label-12' : km >= 10 ? 'far-label-10' : 'far-label');

export class MapView {
  private L: typeof Leaflet | null = null;
  private map: Leaflet.Map | null = null;
  private loading: Promise<void> | null = null;
  private tiles: Leaflet.TileLayer | null = null;
  private layer: Leaflet.LayerGroup | null = null;
  private originMarker: Leaflet.CircleMarker | null = null;
  private accuracyCircle: Leaflet.Circle | null = null;
  /** 雷達目前的範圍（外圈），切到地圖時用同樣的比例 */
  private rangeCircle: Leaflet.Circle | null = null;
  private readonly markers = new Map<number, Leaflet.CircleMarker | Leaflet.Marker>();
  /** 房子圖示目前的樣子，沒變就不重畫（每 5 秒更新一次） */
  private readonly iconKeys = new Map<number, string>();
  /** 選到的那一則外面的亮環 */
  private selRing: Leaflet.CircleMarker | null = null;
  private routeLayer: Leaflet.LayerGroup | null = null;
  /** 範圍比 50 km 大時的海岸線 */
  private outline: Leaflet.Polygon | null = null;
  private outlineRings: Array<Array<[number, number]>> = [];
  /** 洋流的地標（★）：其他模組不顯示 */
  private landmarkGroup: Leaflet.LayerGroup | null = null;
  /** 地標的星星標記（照 id），星星轉走的動畫要找得到 */
  private starMarkers = new Map<string, Leaflet.Marker>();
  private landmarksOn = true;
  private routes: MapRoute[] = [];
  /** 洋流號：路線的經緯度（cum 是每一點走了幾公里）和船，每一格畫面照現在的時間擺；往哪邊開記在 boatLeft */
  private boatTracks: Array<{ id: string; marker: Leaflet.Marker; lat: Float64Array; lng: Float64Array; cum: Float64Array; voyage?: number; bus?: { start: number; stopAt: number[]; driveMs: number; stops: Leaflet.Marker[] }; ride?: { start: number; lap: number; loop?: boolean } }> = [];
  /** 河流：整條的經緯度（cum 是每一點走了幾公里）、河岸、河面、亮的那道、兩道波光，畫到哪（at，沒變就不重畫） */
  private riverTracks: Array<{ pts: Array<[number, number]>; cum: Float64Array; voyage: number; at: number; lines: Leaflet.Polyline[]; all: Leaflet.Polyline[]; chunkStart: number; chunkEnd: number; riverOut?: number }> = [];
  private readonly boatLeft = new Map<string, boolean>();
  private boatFrame = 0;
  /** 拉遠了：一直動的停下來（健身小巴停在第一站） */
  private motionFar = false;
  /** 洋流總部滑鼠介紹的感應圈：還沒到時間的（armHits 照時間打開） */
  private hitPending: Array<{ el: SVGElement; at: number }> = [];
  private hitTimer = 0;
  /** 時間到的感應圈打開，再排下一個（加速時 shiftClock 也叫） */
  private armHits = (): void => {
    window.clearTimeout(this.hitTimer);
    const now = Date.now();
    this.hitPending = this.hitPending.filter((h) => {
      if (h.at > now) return true;
      h.el.style.visibility = 'visible';
      return false;
    });
    if (this.hitPending.length) this.hitTimer = window.setTimeout(this.armHits, Math.max(16, Math.min(...this.hitPending.map((h) => h.at)) - now));
  };
  /** 畫通學區小朋友時地圖的正中間（離開 1.5 km 重畫） */
  private sceneCenter: Leaflet.LatLng | null = null;
  private bottleLayer: Leaflet.LayerGroup | null = null;
  private bottles: MapBottle[] = [];
  /** 座標一樣合成一個點時，每個項目對應到畫出來的那個標記 */
  private readonly leaderOf = new Map<number, number>();
  /** 畫出來的標記代表哪些項目 */
  private readonly groupIds = new Map<number, number[]>();
  private items: MapItem[] = [];
  private origin: LatLng;
  private accuracy: number | null = null;
  private base: BaseMap;

  constructor(
    private readonly el: HTMLElement,
    origin: LatLng,
    private readonly handlers: { onSelect: (id: number, group: number[]) => void; onBottle?: (id: number) => void; onLandmark?: (id: string) => void },
    base: BaseMap = 'nlsc',
  ) {
    this.origin = origin;
    this.base = base;
  }

  /** 地圖畫面顯示時呼叫：第一次載入 Leaflet，之後重算尺寸 */
  invalidate(): void {
    if (this.map) {
      this.map.invalidateSize();
      this.moveBoats();
      return;
    }
    void this.ensure();
  }

  private ensure(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const [mod] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
      const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
      this.L = L;
      const map = L.map(this.el, { zoomControl: true, attributionControl: true, zoomSnap: 0 }).setView([this.origin.lat, this.origin.lng], 15);
      map.attributionControl.setPrefix(false);
      this.map = map;
      this.routeLayer = L.layerGroup().addTo(map);
      this.bottleLayer = L.layerGroup().addTo(map);
      this.layer = L.layerGroup().addTo(map);
      this.accuracyCircle = L.circle([this.origin.lat, this.origin.lng], {
        radius: 0,
        color: '#3b82f6',
        weight: 1,
        opacity: 0.5,
        fillColor: '#3b82f6',
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(map);
      this.rangeCircle = L.circle([this.origin.lat, this.origin.lng], {
        radius: 0,
        color: '#888888',
        weight: 1.5,
        opacity: 0.6,
        dashArray: '6 6',
        fill: false,
        interactive: false,
      }).addTo(map);
      this.originMarker = L.circleMarker([this.origin.lat, this.origin.lng], {
        radius: 8,
        color: '#ffffff',
        weight: 3,
        fillColor: '#3b82f6',
        fillOpacity: 1,
      })
        .bindTooltip('我的位置')
        .addTo(map);
      // 自己拖、滾輪、雙指縮放：記下時間（程式移動地圖不算）
      map.on('dragstart', () => (this.lastUserMove = Date.now()));
      // 縮放時要跟著變的大小、要收起來的東西：放在 CSS 變數和 class，不用整個重畫
      let farKey = '';
      const fitScale = (): void => {
        // 縫線跟著縮放：拉近變大、拉遠變小（v1.535），再小一點（v1.536）：縮放 14 是 0.7 倍，0.35～1.1 倍
        const zs = 2 ** ((map.getZoom() - 14) / 2);
        this.el.style.setProperty('--stitch-scale', Math.min(1.1, Math.max(0.35, 0.7 * zs)).toFixed(3));
        // 寶箱、健身小巴也跟著縮放（v1.536 使用者說「寶箱、巴士也是拉近變大、拉遠變小」）：縮放 14 原來的大小，0.45～1.6 倍
        this.el.style.setProperty('--zoom-scale', Math.min(1.6, Math.max(0.45, zs)).toFixed(3));
        // 拉遠了，一直動的停下來或收起來（hq-far）
        this.motionFar = map.getZoom() < hqMotionZoom();
        this.el.classList.toggle('hq-far', this.motionFar);
        this.el.classList.toggle('hq-near', !this.motionFar);
        // 很密的東西（條通、通學區的斑馬線）電腦版拉近到縮放 14.7 才畫
        this.el.classList.toggle('hq-dense-far', map.getZoom() < hqDenseZoom());
        // 寶箱、橋下空間、大巨蛋、毛孩安心養的字拉遠（縮放 14 以下）不寫
        this.el.classList.toggle('label-far', map.getZoom() < HQ_LABEL_ZOOM);
        // 公園、運動中心、大型建築的字拉得更遠（縮放 13 以下，雷達 10 km）才不寫
        this.el.classList.toggle('label-far10', map.getZoom() < HQ_LABEL_ZOOM - 1);
        // 看整個文化網（縮放 12）時縫合、北士科星群、把樹種回來的字不寫（把水找回來跟文化徑有關，留著）
        this.el.classList.toggle('label-far12', map.getZoom() < 12.5);
        // 藏起來（display: none）的 CSS 動畫再出現時會從頭播、用畫的時候的 delay（例如還要等 70 秒），人流、腳踏車道、字就一直不出來、不動：
        // 跨過門檻時整層重畫一次，delay 照現在的時間重新算（v1.544 使用者說「電腦版的裂縫人流沒有在動」）
        const key = ['hq-far', 'hq-dense-far', 'label-far', 'label-far10', 'label-far12'].map((c) => +this.el.classList.contains(c)).join('');
        if (farKey && key !== farKey && this.routes.some((r) => r.voyage !== undefined)) this.pushRoutes();
        farKey = key;
      };
      map.on('zoomend', fitScale);
      map.on('moveend', () => {
        const c = this.sceneCenter;
        if (c && map.distance(c, map.getCenter()) > 1500 && this.routes.some((r) => r.icons?.some((ic) => ic.kind === 'schoolwalk'))) this.pushRoutes();
      });
      fitScale();
      for (const ev of ['wheel', 'touchstart'] as const) map.getContainer().addEventListener(ev, () => (this.lastUserMove = Date.now()), { passive: true });
      this.landmarkGroup = L.layerGroup();
      if (this.landmarksOn) this.landmarkGroup.addTo(map);
      for (const lm of LANDMARKS) {
        L.marker([lm.lat, lm.lng], {
          // 星星包在 span 裡：轉走的動畫動的是 span，Leaflet 定位用的 transform 在外面的 div 才不會被蓋掉
          icon: L.divIcon({ className: 'map-star', html: '<span>★</span>', iconSize: [26, 26], iconAnchor: [13, 14] }),
          title: lm.name,
          keyboard: false,
          // 放在所有標記上面，疊在一起時也點得到
          zIndexOffset: 1000,
        })
          .bindPopup(
            `<strong>★ ${escapeHtml(lm.name)}</strong><br>${escapeHtml(lm.address)}<br>${escapeHtml(lm.about)}<br>` +
              `<a href="https://www.google.com/maps/dir/?api=1&destination=${lm.lat},${lm.lng}&travelmode=walking" target="_blank" rel="noopener">導航</a>・` +
              lm.links.map((l) => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.name)}</a>`).join('・'),
            { closeButton: false },
          )
          // 點了洋流總部：洋流號開到台北市政府、放煙火（main.ts）
          .on('click', () => this.handlers.onLandmark?.(lm.id))
          .addTo(this.landmarkGroup);
        this.starMarkers.set(lm.id, this.landmarkGroup.getLayers()[this.landmarkGroup.getLayers().length - 1] as Leaflet.Marker);
      }
      // 地圖還沒建好時星星就開始轉了：建好後補上
      if (this.starSpin) this.applyStarSpin(this.starSpin, null);
      this.applyBase();
      this.pushOrigin();
      this.pushOutline();
      this.pushRoutes();
      this.pushBottles();
      this.pushItems();
      // 地圖容器剛從 hidden 變成顯示，尺寸要再算一次
      requestAnimationFrame(() => map.invalidateSize());
    })();
    return this.loading;
  }

  private applyBase(): void {
    const L = this.L;
    const map = this.map;
    if (!L || !map) return;
    this.tiles?.remove();
    const b = BASES[this.base];
    this.tiles = L.tileLayer(b.url, { maxZoom: 20, maxNativeZoom: b.maxNativeZoom, attribution: b.attribution }).addTo(map);
  }

  private pushOrigin(): void {
    if (!this.originMarker || !this.accuracyCircle) return;
    this.originMarker.setLatLng([this.origin.lat, this.origin.lng]);
    this.accuracyCircle.setLatLng([this.origin.lat, this.origin.lng]);
    this.accuracyCircle.setRadius(this.accuracy ?? 0);
    this.rangeCircle?.setLatLng([this.origin.lat, this.origin.lng]);
  }

  private pushItems(): void {
    const L = this.L;
    const layer = this.layer;
    if (!L || !layer) return;
    const stroke = cssVar('--blip-stroke', '#15171c');
    const selectedStroke = cssVar('--blip-selected', '#ffffff');
    // 座標一樣（到小數點 5 位，約 1 公尺）的合成一個點，旁邊標「+N」，點下去再選；放大地圖也分不開
    const groups = new Map<string, MapItem[]>();
    for (const it of this.items) {
      const k = `${it.lat.toFixed(5)},${it.lng.toFixed(5)}`;
      const g = groups.get(k);
      if (g) g.push(it);
      else groups.set(k, [it]);
    }
    const keep = new Set<number>();
    this.leaderOf.clear();
    this.groupIds.clear();
    for (const g of groups.values()) {
      const it = g.find((x) => x.selected) ?? g.find((x) => x.phase === 'active') ?? g[0];
      const ids = g.map((x) => x.id);
      keep.add(it.id);
      // 服務處（位置精確的）畫房子圖示、車掃起終點畫 🚩🏁，其他畫圓點；類型變了就換一個
      const house = (!!it.office && !it.approx) || !!it.flag;
      let m = this.markers.get(it.id);
      if (m && ('setRadius' in m) === house) {
        layer.removeLayer(m);
        this.markers.delete(it.id);
        this.iconKeys.delete(it.id);
        m = undefined;
      }
      if (!m) {
        const id = it.id;
        m = house ? L.marker([it.lat, it.lng], { keyboard: false }) : L.circleMarker([it.lat, it.lng]);
        m.on('click', () => this.handlers.onSelect(id, this.groupIds.get(id) ?? [id]));
        m.bindPopup('', { closeButton: false });
        layer.addLayer(m);
        this.markers.set(it.id, m);
      }
      this.groupIds.set(it.id, ids);
      m.setLatLng([it.lat, it.lng]);
      const fillOpacity = it.approx ? 0.15 : it.fade !== undefined ? 0.2 + 0.6 * it.fade : it.phase === 'later' || it.phase === 'closed' ? 0.5 : 0.95;
      const opacity = it.fade !== undefined && !it.selected ? 0.45 + 0.55 * it.fade : 1;
      if ('setRadius' in m) {
        m.setRadius(it.approx ? 14 : it.phase === 'active' ? 10 : 8);
        m.setStyle({
          color: it.selected ? selectedStroke : stroke,
          weight: it.selected ? 3 : 2,
          fillColor: markerColor(it.kind, it.phase, it.spot),
          fillOpacity,
          opacity,
          // 固定據點、約略位置、稍後開始用虛線外框，跟精確、進行中的分開
          dashArray: it.spot || it.approx || it.phase === 'later' ? '3 3' : '',
        });
      } else if (it.flag) {
        const size = it.phase === 'active' || it.selected ? 30 : 26;
        const html = `<span class="${it.selected ? 'selected' : ''}" style="font-size:${size - 6}px">${it.flag}</span>`;
        if (this.iconKeys.get(it.id) !== html) {
          m.setIcon(L.divIcon({ className: 'map-flag', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }));
          this.iconKeys.set(it.id, html);
        }
        m.setOpacity(opacity);
        m.setZIndexOffset(it.selected ? 500 : 100);
      } else {
        const size = it.phase === 'active' || it.selected ? 26 : 22;
        const svg = officeSvg(markerColor(it.kind, it.phase, true), it.selected ? selectedStroke : stroke, it.selected ? 3 : 2, fillOpacity, size);
        if (this.iconKeys.get(it.id) !== svg) {
          m.setIcon(L.divIcon({ className: 'map-office', html: svg, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }));
          this.iconKeys.set(it.id, svg);
        }
        m.setOpacity(opacity);
        m.setZIndexOffset(it.selected ? 500 : 0);
      }
      m.setPopupContent(
        g.length > 1
          ? `<strong>這裡有 ${g.length} 個</strong><br>${g.map((x) => escapeHtml(x.title)).join('<br>')}`
          : `<strong>${escapeHtml(it.title)}</strong><br>${escapeHtml(it.subtitle)}`,
      );
      if (g.length > 1) {
        if (m.getTooltip()) m.setTooltipContent(`+${g.length - 1}`);
        else m.bindTooltip(`+${g.length - 1}`, { permanent: true, direction: 'right', className: 'map-count', offset: [8, 0] });
      } else if (m.getTooltip()) m.unbindTooltip();
      for (const x of g) this.leaderOf.set(x.id, it.id);
    }
    // 選到的那一則：外面一圈亮環（慢慢一明一暗），點不到、不擋點擊
    const sel = this.items.find((x) => x.selected);
    if (sel) {
      const r = sel.approx ? 22 : 17;
      if (!this.selRing) {
        this.selRing = L.circleMarker([sel.lat, sel.lng], { radius: r, interactive: false, className: 'map-sel-ring', color: cssVar('--accent', '#0f766e'), weight: 3, fill: false });
        layer.addLayer(this.selRing);
      }
      this.selRing.setLatLng([sel.lat, sel.lng]);
      this.selRing.setRadius(r);
    } else if (this.selRing) {
      layer.removeLayer(this.selRing);
      this.selRing = null;
    }
    for (const [id, m] of this.markers) {
      if (!keep.has(id)) {
        layer.removeLayer(m);
        this.markers.delete(id);
        this.iconKeys.delete(id);
      }
    }
  }

  setOrigin(p: LatLng, pan = false, accuracyM: number | null = null): void {
    this.origin = p;
    this.accuracy = accuracyM;
    this.pushOrigin();
    if (pan && this.map) this.map.setView([p.lat, p.lng], Math.max(this.map.getZoom(), 15), { animate: true });
  }

  /**
   * 切到地圖時呼叫：以目前位置為中心，每公里的像素和雷達一樣（px = 雷達外圈的半徑像素），
   * 虛線圈就是雷達的外圈。不知道雷達多大時，讓畫面短邊剛好裝下範圍。
   */
  showRange(km: number, px: number): void {
    void this.ensure().then(() => {
      const L = this.L;
      const map = this.map;
      if (!L || !map) return;
      map.invalidateSize();
      const center = L.latLng(this.origin.lat, this.origin.lng);
      // 全球：半個地球的圓在地圖（麥卡托投影）上會變形，不畫，地圖縮到看得到全世界
      this.rangeCircle?.setLatLng(center).setRadius(km * 1000).setStyle({ opacity: km > 5000 ? 0 : 0.6 });
      const size = map.getSize();
      const fit = Math.min(size.x, size.y) / 2;
      const radiusPx = px > 0 ? Math.min(px, fit) : fit;
      if (radiusPx <= 0) return;
      // Web Mercator：縮放 z 時每像素 = 40075016.686 × cos(緯度) ÷ 2^(z+8) 公尺
      const z = Math.log2((40075016.686 * Math.cos((center.lat * Math.PI) / 180) * radiusPx) / (km * 1000)) - 8;
      map.setView(center, Math.min(Math.max(z, map.getMinZoom()), map.getMaxZoom()), { animate: false });
    });
  }

  /** 地圖目前在你的位置附近每像素幾公里；地圖還沒載入時回傳 null */
  kmPerPx(): number | null {
    if (!this.map) return null;
    return (40075.016686 * Math.cos((this.origin.lat * Math.PI) / 180)) / 2 ** (this.map.getZoom() + 8);
  }

  setBase(base: BaseMap): void {
    if (base === this.base) return;
    this.base = base;
    this.applyBase();
  }

  /** 深色主題：用 CSS 把底圖轉成深色調（見 styles.css 的 .map-dark） */
  setDark(dark: boolean): void {
    this.el.classList.toggle('map-dark', dark);
    this.pushItems();
  }

  focus(id: number): void {
    void this.ensure().then(() => {
      const it = this.items.find((x) => x.id === id);
      const m = this.markers.get(this.leaderOf.get(id) ?? id);
      if (!it || !m || !this.map) return;
      this.map.setView([it.lat, it.lng], Math.max(this.map.getZoom(), 15), { animate: true });
      m.openPopup();
    });
  }

  /**
   * 這個點不在看得到的地方才移過去（移最少、不改縮放）。cover 是卡片蓋住地圖右邊、下面幾 px，
   * 蓋住的地方不算看得到（至少留 120 px 給地圖）
   */
  panIntoView(p: LatLng, cover = { right: 0, bottom: 0 }): void {
    void this.ensure().then(() => {
      if (!this.map) return;
      const size = this.map.getSize();
      const right = Math.max(0, Math.min(cover.right, size.x - 120));
      const bottom = Math.max(0, Math.min(cover.bottom, size.y - 120));
      this.map.panInside([p.lat, p.lng], { paddingTopLeft: [40, 40], paddingBottomRight: [40 + right, 40 + bottom] });
    });
  }

    /** 地圖移到某個點（例如洋流總部） */
  focusLatLng(p: LatLng): void {
    void this.ensure().then(() => {
      if (this.map) this.map.setView([p.lat, p.lng], Math.max(this.map.getZoom(), 16), { animate: true });
    });
  }

  render(items: MapItem[]): void {
    this.items = items;
    this.pushItems();
  }

  /** 顯示或藏起洋流的地標（換到其他模組時藏起來） */
  setLandmarksVisible(on: boolean): void {
    this.landmarksOn = on;
    if (!this.map || !this.landmarkGroup) return;
    if (on) this.landmarkGroup.addTo(this.map);
    else this.landmarkGroup.remove();
  }

  /** 海岸線（範圍比 50 km 大時）；空陣列就不畫 */
  setOutline(rings: Array<Array<[number, number]>>): void {
    if (rings === this.outlineRings) return;
    this.outlineRings = rings;
    this.pushOutline();
  }

  private pushOutline(): void {
    const L = this.L;
    const map = this.map;
    if (!L || !map) return;
    this.outline?.remove();
    this.outline = null;
    if (this.outlineRings.length === 0) return;
    this.outline = L.polygon(this.outlineRings, { color: '#03615a', weight: 3.5, opacity: 0.9, dashArray: '8 6', fillColor: '#03615a', fillOpacity: 0.08, interactive: false }).addTo(map);
    this.outline.bringToBack();
  }

  /** 漂流瓶：遠的畫成約 150 m 的淡圈（只知道大概在哪），近的畫成瓶子 */
  setBottles(list: MapBottle[]): void {
    const sig = (bs: MapBottle[]): string => JSON.stringify(bs.map((b) => [b.id, b.state, b.mine, b.picked]));
    if (sig(list) === sig(this.bottles)) return;
    this.bottles = list;
    this.pushBottles();
  }

  private pushBottles(): void {
    const L = this.L;
    const layer = this.bottleLayer;
    if (!L || !layer) return;
    layer.clearLayers();
    for (const b of this.bottles) {
      const open = (): void => this.handlers.onBottle?.(b.id);
      const icon = L.divIcon({
        className: `map-bottle${b.state === 'pick' ? ' can-pick' : ''}${b.mine ? ' mine' : ''}${b.picked ? ' picked' : ''}`,
        html: `<svg viewBox="-10 -10 20 20" width="24" height="24"><path d="${MAP_BOTTLE_PATH}" transform="rotate(-20)"/></svg>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      layer.addLayer(L.marker([b.lat, b.lng], { icon, keyboard: false, title: b.mine ? '你丟的漂流瓶' : '漂流瓶' }).on('click', open));
    }
  }

  setRoutes(routes: MapRoute[]): void {
    const sig = (rs: MapRoute[]): string =>
      // 洋流總部的特效：文化網、政策圖層（多出來的地方、通學區的圈）開關時也要重畫
      JSON.stringify(rs.map((r) => [r.id, r.state, r.flowAt ?? null, r.segments.map((x) => [x.people, x.target, x.path.length, !!x.passed]), r.turns ?? [], !!r.boat, r.voyageKey ?? r.voyage ?? null, r.network?.at ?? null, r.icons?.length ?? 0, r.seams?.length ?? 0, r.fitbuses?.[0]?.focus ?? null, r.circles?.length ?? 0, r.sites?.length ?? 0, !!r.focus, r.riverOut !== undefined && Date.now() > r.riverOut + 1600]));
    const same = sig(routes) === sig(this.routes);
    // 時間往前推（加速）時不重畫，但留著新的時間，之後重畫（縮放跨過門檻）才會照新的時間排
    this.routes = routes;
    if (same) return;
    this.pushRoutes();
  }

  /** 洋流號加速：時間往前推 d 毫秒（跟 radar.ts 的 shiftClock 一樣） */
  shiftClock(d: number): void {
    for (const t of this.boatTracks) {
      if (t.voyage !== undefined) t.voyage -= d;
      if (t.ride) t.ride.start -= d;
      if (t.bus) t.bus.start -= d;
    }
    for (const t of this.riverTracks) {
      t.voyage -= d;
      if (t.riverOut !== undefined) t.riverOut -= d;
    }
    for (const h of this.hitPending) h.at -= d;
    this.armHits();
  }

  /** 已經畫好的 CSS 動畫往前推 d 毫秒（跟 radar.ts 的 shiftCss 一樣） */
  shiftCss(d: number): void {
    for (const a of this.el.getAnimations({ subtree: true })) if (a.currentTime !== null) a.currentTime = Number(a.currentTime) + d;
  }

  /** 使用者最後一次自己拖、縮放地圖的時間（Date.now() 的毫秒）：洋流總部的特效到站時沒動過才拉近 */
  get userMovedAt(): number {
    return this.lastUserMove;
  }
  private lastUserMove = 0;
  /** 星星轉走（洋流總部點下去：快速旋轉、縮小不見）：哪一顆、什麼時候開始；null 是彈回來 */
  private starSpin: { id: string; at: number } | null = null;
  setStarSpin(spin: { id: string; at: number } | null): void {
    const prev = this.starSpin;
    // 同一次的轉（載入資料後再叫一次）不要重設，不然動畫會跳
    if (spin && prev && spin.id === prev.id && spin.at === prev.at) return;
    this.starSpin = spin;
    this.applyStarSpin(spin, prev);
  }

  private applyStarSpin(spin: { id: string; at: number } | null, prev: { id: string; at: number } | null): void {
    const e = this.starMarkers.get((spin ?? prev)?.id ?? '')?.getElement();
    if (!e) return;
    e.classList.toggle('spin-away', !!spin);
    e.classList.toggle('star-back', !spin && !!prev);
    const sp = e.querySelector('span');
    if (sp) sp.style.animationDelay = spin ? `${Math.round(spin.at - Date.now())}ms` : '0ms';
  }

  /** 地圖慢慢飛到這個點、拉到這個縮放（洋流總部的特效到站：拉近台北市政府） */
  flyToLatLng(p: LatLng, zoom: number): void {
    void this.ensure().then(() => this.map?.flyTo([p.lat, p.lng], zoom, { duration: 1.4 }));
  }

  /** 這個點快出畫面（離邊不到 12%）就把地圖移過去（洋流總部的特效跟著船） */
  keepInView(p: LatLng): void {
    const map = this.map;
    if (!map) return;
    const b = map.getBounds().pad(-0.12);
    if (!b.contains([p.lat, p.lng])) map.panTo([p.lat, p.lng], { animate: true, duration: 0.8 });
  }

  /** 地圖移到看得到整條線（洋流總部的特效：總部到台北市政府） */
  focusPath(pts: Array<[number, number]>): void {
    void this.ensure().then(() => {
      // 煙火在終點上面、往兩邊炸開（台北市政府在東邊）：上面、右邊多留一點
      if (this.L && this.map && pts.length > 1) this.map.fitBounds(this.L.latLngBounds(pts), { paddingTopLeft: [40, 220], paddingBottomRight: [150, 40] });
    });
  }

  /** 地圖移到整條路線 */
  focusRoute(id: string): void {
    void this.ensure().then(() => {
      const L = this.L;
      const r = this.routes.find((x) => x.id === id);
      if (!L || !this.map || !r) return;
      const pts = r.segments.flatMap((x) => x.path);
      if (pts.length > 0) this.map.fitBounds(L.latLngBounds(pts), { padding: [24, 24] });
    });
  }

  private pushRoutes(): void {
    const L = this.L;
    const layer = this.routeLayer;
    if (!L || !layer) return;
    layer.clearLayers();
    this.boatTracks = [];
    this.riverTracks = [];
    this.hitPending = [];
    for (const r of this.routes) {
      if (r.state === 'done') continue;
      if (r.rainbow) {
        // 遊行：六條由粗到細疊成彩虹（紅在最外、紫在中間），還沒出發的淡一點；點了看是哪一條路線。
        // 剛出發時每一條路線同時從出發的地方流到終點（重畫時接著流）
        const ago = r.flowAt !== undefined ? Date.now() - r.flowAt : Infinity;
        for (const seg of r.segments) {
          RAINBOW.forEach((color, i) => {
            const line = L.polyline(seg.path, { color, weight: 13 - i * 2, opacity: r.state === 'planned' ? 0.55 : 0.9, lineCap: 'round', lineJoin: 'round' });
            line.bindPopup(`<strong>${escapeHtml(r.title)}・${escapeHtml(seg.from)}</strong><br>${escapeHtml(seg.to)}<br>主辦單位公布的路線，以現場為準`, { closeButton: false });
            layer.addLayer(line);
            const path = line.getElement();
            if (ago < RAINBOW_FLOW_TOTAL && path instanceof SVGPathElement) flowOut(path, ago - i * RAINBOW_STAGGER_MS);
          });
        }
        continue;
      }
      if (r.source === 'report') {
        // 回報的車掃：活動的顏色，還沒出發畫虛線，已經經過的那段畫淡；不知道實際走哪些路，是直線
        for (const seg of r.segments) {
          const line = L.polyline(seg.path, {
            color: cssVar('--blip-activity', '#03615a'),
            weight: 5,
            opacity: seg.passed ? 0.3 : 0.85,
            dashArray: r.state === 'planned' ? '8 8' : undefined,
            lineCap: 'round',
          });
          line.bindPopup(`<strong>${escapeHtml(r.title)}・第 ${seg.seq} 段</strong><br>${escapeHtml(seg.from)} → ${escapeHtml(seg.to)}<br>直線連接各站，實際路線以現場為準`, { closeButton: false });
          layer.addLayer(line);
          line.bringToBack();
        }
        continue;
      }
      // 河流（洋流總部的特效）：跟著船長出來的一條河，不畫路段；老水路、公園的樹照時間排好
      // 河先畫，步道、老水路、文化徑這些線畫在河上面（v1.549；圖示、字本來就在上面那一層）
      if (r.river && r.voyage !== undefined) {
        this.addRiver(r, r.voyage);
        this.addVoyageExtras(r);
      }
      // 只開一趟的（洋流總部的特效）只畫水，不分段上色
      for (const seg of r.voyage !== undefined ? [] : r.segments) {
        const c = CROWD[crowdOf(seg.people, seg.target)];
        const line = L.polyline(seg.path, { color: c.color, weight: 6, opacity: 0.85, lineCap: 'round', lineJoin: 'round' });
        line.bindPopup(
          `<strong>${escapeHtml(r.title)}・第 ${seg.seq} 段</strong><br>${escapeHtml(seg.from)} → ${escapeHtml(seg.to)}<br>` +
            `認領 ${seg.people} / 目標 ${seg.target} 人（${c.label}）` +
            (r.claimUrl ? `<br><a href="${escapeHtml(r.claimUrl)}" target="_blank" rel="noopener">到車掃地圖認領路段</a>` : ''),
          { closeButton: false },
        );
        layer.addLayer(line);
        line.bringToBack();
      }
      // 洋流車掃：整條路線是一道水流（認領顏色下面淡藍的水，上面深藍的水紋、白色的浪花用不同的速度往前流；點不到，點的還是路段）；
      // 進行中剛出發、之後每隔一段時間，深藍、淺藍的浪從出發的地方湧到終點再淡掉
      if (r.ocean && !r.river) {
        const whole = r.segments.flatMap((sg) => sg.path);
        const line = { lineCap: 'round', lineJoin: 'round', interactive: false } as const;
        const water = L.polyline(whole, { ...line, color: '#4cc3e6', weight: 18, opacity: 0.35 });
        layer.addLayer(water);
        water.bringToBack();
        if (r.state === 'live') {
          const ago = r.flowAt !== undefined ? Date.now() - r.flowAt : Infinity;
          [
            { color: '#0d6ea8', weight: 18, opacity: 0.45 },
            { color: '#3fd0e0', weight: 10, opacity: 0.6 },
          ].forEach((o, i) => {
            const wave = L.polyline(whole, { ...o, ...line, className: 'ocean-surge' });
            layer.addLayer(wave);
            const el = wave.getElement();
            if (ago < SURGE_TOTAL && el instanceof SVGPathElement) surge(el, ago - i * RAINBOW_STAGGER_MS);
          });
        }
        const flow = L.polyline(whole, { ...line, color: '#1784b8', weight: 3, opacity: 0.85, dashArray: '10 20', className: 'map-water-flow' });
        const glint = L.polyline(whole, { ...line, color: '#ffffff', weight: 3, opacity: 0.95, dashArray: '3 27', className: 'map-water-glint' });
        layer.addLayer(flow);
        layer.addLayer(glint);
        // 只開一趟的：水跟著淡入、放完煙火淡掉
        if (r.voyage !== undefined) {
          for (const p of [water, flow, glint]) {
            const e = p.getElement() as SVGElement | undefined;
            if (e) Object.assign(e.style, { animationDuration: `${HQ_VOYAGE_MS}ms`, animationDelay: `${r.voyage - Date.now()}ms` });
            e?.classList.add('map-voyage');
          }
        }
      }
      // 中間點：路線上的小圓點，點了寫預計經過的時間和名稱
      for (const t of r.turns ?? []) {
        const dot = L.circleMarker([t.lat, t.lng], { radius: 5, color: '#0d6ea8', weight: 2.5, fillColor: '#ffffff', fillOpacity: 1 });
        dot.bindPopup(`<strong>${escapeHtml(r.title)}・中間點</strong><br>${escapeHtml(t.label)}<br>時間用路線長度平均推算，以現場為準`, { closeButton: false });
        layer.addLayer(dot);
      }
      // 終點的外框（虛線）、經過的區名
      if (r.outline && r.outline.length > 2) {
        const box = L.polygon(r.outline, { color: '#15171c', weight: 2, dashArray: '6 5', fillColor: '#ffd43b', fillOpacity: 0.2, interactive: false });
        layer.addLayer(box);
        box.bringToBack();
      }
      for (const st of r.stops ?? []) {
        const delay = st.keep ? '' : ` style="animation-delay:${st.at - Date.now()}ms"`;
        const icon = L.divIcon({ className: `map-voyage-stop${st.keep ? ' keep' : st.stay ? ' stay' : ''}${st.hideKm ? ` ${farCls(st.hideKm)}` : ''}`, html: `<span${delay}>${escapeHtml(st.label)}</span>`, iconSize: [96, 18], iconAnchor: [48, st.keep ? -10 : 20 - (st.dy ?? -10)] });
        layer.addLayer(L.marker([st.lat, st.lng], { icon, interactive: false, keyboard: false, zIndexOffset: 1500 }));
      }
      if (r.boat || r.voyage !== undefined) this.addBoat(r);
      // 終點放煙火（螢幕像素的大小）
      const fw = r.fireworks !== undefined ? Date.now() - r.fireworks : Infinity;
      const end = r.segments[r.segments.length - 1]?.path.at(-1);
      if (fw < FIREWORKS_MS && end) {
        const icon = L.divIcon({ className: 'map-fireworks', html: `<svg viewBox="-130 -230 260 250" width="260" height="250" aria-hidden="true">${fireworksSvg(fw)}</svg>`, iconSize: [260, 250], iconAnchor: [130, 230] });
        layer.addLayer(L.marker(end, { icon, interactive: false, keyboard: false, zIndexOffset: 2000 }));
      }
    }
    this.moveBoats();
  }

  /** 河流（洋流總部的特效）：河岸淺色寬一點、河面、中間一道亮的、兩道往下游流的波光（地圖上寬度固定，螢幕像素），每一格照船開到哪畫到哪 */
  private addRiver(r: MapRoute, voyage: number): void {
    const L = this.L;
    const layer = this.routeLayer;
    const riverOut = r.riverOut;
    // 到終點後河淡完了就不畫
    if (riverOut !== undefined && Date.now() > riverOut + 1600) return;
    const pts = r.segments.flatMap((sg) => sg.path);
    if (!L || !layer || pts.length < 2) return;
    const cum = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + haversineKm({ lat: pts[i - 1][0], lng: pts[i - 1][1] }, { lat: pts[i][0], lng: pts[i][1] });
    const o = { lineCap: 'round', lineJoin: 'round', interactive: false } as const;
    const lines = [
      // 洋流號的水流是橘色的（真的河是藍色）
      L.polyline([], { ...o, color: '#ffd8b0', weight: 15, opacity: 0.9 }),
      L.polyline([], { ...o, color: '#f0812e', weight: 9, opacity: 0.92 }),
      L.polyline([], { ...o, color: '#ffc78f', weight: 2, opacity: 0.85 }),
      L.polyline([], { ...o, color: '#ffffff', weight: 1.6, opacity: 0.85, className: 'map-river-flow' }),
    ];
    for (const l of lines) {
      layer.addLayer(l);
      // 跟著淡入；到終點後淡掉（riverOut）
      const e = l.getElement() as SVGElement | undefined;
      if (e) Object.assign(e.style, { animationDuration: `${HQ_VOYAGE_MS}ms`, animationDelay: `${voyage - Date.now()}ms` });
      e?.classList.add('map-voyage');
      this.riverFade(e, riverOut);
    }
    // 河分段畫：流過的部分一段一段固定成自己的線，每一格只動最前面正在長的那一段（lines）
    const t = { pts, cum, voyage, at: -1, lines, all: [...lines], chunkStart: 0, chunkEnd: Math.min(pts.length - 1, MAP_RIVER_CHUNK), riverOut };
    this.riverTracks.push(t);
    this.drawRiver(t, voyagePhase(Date.now() - voyage).at);
  }

  /** 洋流號的河到終點後淡掉（map-river-out：stroke-opacity 慢慢變 0）；已經過了就直接藏 */
  private riverFade(e: Element | undefined, outAt: number | undefined): void {
    if (!e || outAt === undefined) return;
    const wait = outAt - Date.now();
    if (wait <= 0) e.classList.add('map-river-out', 'done');
    else window.setTimeout(() => e.classList.add('map-river-out'), wait);
  }

  /** 河流過的一段固定下來（跟最前面那一段同樣的 4 條線） */
  private riverChunk(t: (typeof this.riverTracks)[number], a: number, b: number): void {
    const L = this.L;
    const layer = this.routeLayer;
    if (!L || !layer) return;
    const seg = t.pts.slice(a, b + 1);
    const o = { lineCap: 'round', lineJoin: 'round', interactive: false } as const;
    for (const [opt, i] of [[{ color: '#ffd8b0', weight: 15, opacity: 0.9 }, 0], [{ color: '#f0812e', weight: 9, opacity: 0.92 }, 1], [{ color: '#ffc78f', weight: 2, opacity: 0.85 }, 2], [{ color: '#ffffff', weight: 1.6, opacity: 0.85, className: 'map-river-flow' }, 3]] as const) {
      const l = L.polyline(seg, { ...o, ...opt });
      layer.addLayer(l);
      t.all.push(l);
      const e = l.getElement() as SVGElement | undefined;
      if (e) {
        Object.assign(e.style, { animationDuration: `${HQ_VOYAGE_MS}ms`, animationDelay: `${t.voyage - Date.now()}ms` });
        e.classList.add('map-voyage');
        this.riverFade(e, t.riverOut);
      }
      // 最前面那一段要在固定的上面
      t.lines[i].bringToFront();
    }
  }

  /** 出現後留著的字（洋流總部的特效）；anchorY 是字在那一點上面幾像素 */
  private stayLabel(at: Leaflet.LatLngExpression, text: string, delayMs: number, anchorY: number, extra = ''): void {
    const L = this.L;
    if (!L || !this.routeLayer) return;
    const icon = L.divIcon({ className: `map-voyage-stop stay${extra ? ` ${extra}` : ''}`, html: `<span style="animation-delay:${Math.round(delayMs)}ms">${escapeHtml(text)}</span>`, iconSize: [120, 18], iconAnchor: [60, anchorY] });
    this.routeLayer.addLayer(L.marker(at, { icon, interactive: false, keyboard: false, zIndexOffset: 1500 }));
  }

  /** 老水路、種樹的地方（洋流總部的特效）：照時間用 CSS 的 delay 排好 */
  private addVoyageExtras(r: MapRoute): void {
    this.map?.getContainer().classList.toggle('hq-focus', !!r.focus);
    // 待機的小動作等洋流號到了、河淡掉才開始（v1.527）
    // 看整個文化網時健身小巴退到後面（小、淡，各站不畫）
    this.el.classList.toggle('fit-dim', !!r.fitbuses?.some((f) => f.dim));
    this.map?.getContainer().classList.toggle('hq-idle', r.riverOut !== undefined && Date.now() > r.riverOut + 1000);
    const L = this.L;
    const layer = this.routeLayer;
    const map = this.map;
    if (!L || !layer || !map) return;
    const now = Date.now();
    const o = { lineCap: 'round', lineJoin: 'round', interactive: false } as const;
    for (const c of r.canals ?? []) {
      if (c.path.length < 2) continue;
      const lines = [
        L.polyline(c.path, { ...o, color: '#15171c', weight: 1.5, opacity: 0.6, className: 'map-canal-ghost' }),
        L.polyline(c.path, { ...o, color: '#bfe8f5', weight: 9, opacity: 0.9, className: 'map-canal-fill' }),
        L.polyline(c.path, { ...o, color: '#3fa9dc', weight: 5, opacity: 0.95, className: 'map-canal-fill' }),
      ];
      lines.forEach((l, i) => {
        layer.addLayer(l);
        const e = l.getElement();
        if (!e) return;
        e.setAttribute('pathLength', '1');
        (e as SVGElement).style.animationDelay = `${Math.round(c.at - (i === 0 ? MAP_CANAL_GHOST_MS : 0) - now)}ms`;
        if (i === lines.length - 1) {
          // 注水完（3 秒）淡淡的波紋一直往下游流、兩條小錦鯉跳出水面（v1.534）
          const flow = L.polyline(c.path, { ...o, color: '#fff', weight: 1.5, opacity: 0.75, dashArray: '2 12', className: 'map-canal-flow' });
          layer.addLayer(flow);
          const fe = flow.getElement() as SVGElement | undefined;
          if (fe) fe.style.animationDelay = `${Math.round(c.at + 3000 - now)}ms,${Math.round(c.at + 3000 - now)}ms`;
          [0.3, 0.7].forEach((f, fi) => {
            const j = Math.min(c.path.length - 2, Math.floor((c.path.length - 1) * f));
            const left = c.path[j + 1][1] < c.path[j][1];
            const d = Math.round(c.at + 4000 + fi * 2600 - now);
            const svg = FISH_SVG.replace('class="cf-jump"', `class="cf-jump" style="animation-delay:${d}ms"`).replace('class="cf-splash"', `class="cf-splash" style="animation-delay:${d}ms"`);
            const icon = L.divIcon({ className: 'map-canal-fish', html: `<svg viewBox="-10 -10 20 14" width="26" height="18" aria-hidden="true"><g transform="scale(${left ? -1 : 1} 1)">${svg}</g></svg>`, iconSize: [26, 18], iconAnchor: [13, 13] });
            layer.addLayer(L.marker(c.path[j], { icon, interactive: false, keyboard: false, zIndexOffset: 1100 }));
          });
        }
      });
      const mid = c.path[Math.floor(c.path.length / 2)];
      this.stayLabel(mid, c.label, c.at + 1200 - now, 30);
    }
    // 湧泉：藍色的小點、三圈漣漪一直往外冒
    for (const sp of r.springs ?? []) {
      const icon = L.divIcon({ className: 'map-voyage-spring', html: `<svg viewBox="-20 -20 40 40" width="40" height="40" aria-hidden="true"><g class="spring-pop" style="animation-delay:${Math.round(sp.at - now)}ms"><circle class="spring-ring" r="4" style="animation-delay:${Math.round(sp.at - now)}ms"/><circle class="spring-ring" r="4" style="animation-delay:${Math.round(sp.at + 900 - now)}ms"/><circle class="spring-ring" r="4" style="animation-delay:${Math.round(sp.at + 1800 - now)}ms"/><circle class="spring-dot" r="3.2"/></g></svg>`, iconSize: [40, 40], iconAnchor: [20, 20] });
      layer.addLayer(L.marker([sp.lat, sp.lng], { icon, interactive: false, keyboard: false, zIndexOffset: 1300 }));
      this.stayLabel([sp.lat, sp.lng], sp.label, sp.at + 600 - now, 32);
    }
    // 老水塘：先虛線的鬼影，到了填成水
    for (const pd of r.ponds ?? []) {
      if (pd.ring.length < 3) continue;
      const ghost = L.polygon(pd.ring, { color: '#15171c', weight: 1.5, opacity: 0.6, fill: false, interactive: false, className: 'map-canal-ghost' });
      const fill = L.polygon(pd.ring, { color: '#3fa9dc', weight: 1, fillColor: '#4cc3e6', fillOpacity: 0.55, interactive: false, className: 'map-voyage-river' });
      for (const [l, delay] of [[ghost, pd.at - MAP_CANAL_GHOST_MS - now], [fill, pd.at - now]] as const) {
        layer.addLayer(l);
        const e = l.getElement() as SVGElement | undefined;
        if (!e) continue;
        if (l === ghost) e.setAttribute('pathLength', '1');
        e.style.animationDelay = `${Math.round(delay)}ms`;
      }
      this.stayLabel(fill.getBounds().getCenter(), pd.label, pd.at + 800 - now, 30);
    }
    // 街道的路樹：船經過市區時離路線稍遠的中心（在街道上）往四周的街道長（每 MAP_STREET_TREE_KM 公里一棵、左右輪流、離街的距離照現在的縮放算成像素），離中心越遠越晚長
    for (const [bi, bl] of (r.blooms ?? []).entries()) {
      const center = { lat: bl.center[0], lng: bl.center[1] };
      for (const [si, st] of bl.streets.entries()) {
        const cum = new Float64Array(st.pts.length);
        for (let i = 1; i < st.pts.length; i++) cum[i] = cum[i - 1] + haversineKm({ lat: st.pts[i - 1][0], lng: st.pts[i - 1][1] }, { lat: st.pts[i][0], lng: st.pts[i][1] });
        const mi = Math.max(0, Math.min(st.pts.length - 1, st.mid));
        const base = haversineKm({ lat: st.pts[mi][0], lng: st.pts[mi][1] }, center);
        let i = 1;
        for (let km = MAP_STREET_TREE_KM / 2, j = 0; km < cum[cum.length - 1]; km += MAP_STREET_TREE_KM, j++) {
          while (i < st.pts.length - 1 && cum[i] < km) i++;
          const w = (km - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
          const a = map.latLngToLayerPoint(st.pts[i - 1]);
          const b = map.latLngToLayerPoint(st.pts[i]);
          const [dx, dy] = [b.x - a.x, b.y - a.y];
          const len = Math.hypot(dx, dy) || 1;
          // 像行道樹：路的兩邊各一排
          for (const side of [1, -1]) {
            const off = 4 * side;
            const p = L.point(a.x + dx * w + (-dy / len) * off, a.y + dy * w + (dx / len) * off);
            const m = L.circleMarker(map.layerPointToLatLng(p), { radius: 2.2 + mapHash(bi * 59 + si * 17 + j * 13 + side) * 0.8, color: cssVar('--grass', '#3f8f2f'), weight: 1, fillColor: cssVar('--grass', '#3f8f2f'), fillOpacity: 0.95, interactive: false, className: 'map-tree' });
            layer.addLayer(m);
            const e = m.getElement() as SVGElement | undefined;
            if (e) e.style.animationDelay = `${Math.round(bl.at + (base + Math.abs(km - cum[mi])) * 1000 * 2.4 - now)}ms`;
          }
        }
      }
    }
    // 綠覆率：整個台北市一層一層變很淡的綠（放到最下面）
    if (r.green && r.green.ring.length > 2) {
      for (const at of r.green.steps) {
        const poly = L.polygon(r.green.ring, { stroke: false, fillColor: '#3f8f2f', fillOpacity: 0.025, interactive: false, className: 'map-green-step' });
        layer.addLayer(poly);
        poly.bringToBack();
        const e = poly.getElement() as SVGElement | undefined;
        if (e) e.style.animationDelay = `${Math.round(at - now)}ms`;
      }
    }
    // 一塊地方（社子島）：淡淡的土色、虛線外框
    // 條通的夜色（v1.555）：一塊淡淡的深藍，慢慢暗下來
    for (const nt of r.nights ?? []) {
      if (nt.ring.length < 3) continue;
      const poly = L.polygon(nt.ring, { stroke: false, fillColor: '#232a66', fillOpacity: 0.32, interactive: false, className: 'map-night-area' });
      layer.addLayer(poly);
      const e = poly.getElement() as SVGElement | undefined;
      if (e) e.style.animationDelay = `${Math.round(nt.at - now)}ms`;
    }
    for (const ar of r.areas ?? []) {
      if (ar.ring.length < 3) continue;
      const poly = L.polygon(ar.ring, { color: '#7d6a45', weight: 1.8, dashArray: '6 4', fill: false, interactive: false, className: 'map-voyage-area' });
      layer.addLayer(poly);
      const e = poly.getElement() as SVGElement | undefined;
      if (e) e.style.animationDelay = `${Math.round(ar.at - now)}ms`;
      // 分區一區一區亮起來
      (ar.zones ?? []).forEach((z, i) => {
        const zp = L.polygon(z, { color: '#7d6a45', weight: 1.2, opacity: 0.5, fillColor: '#f2b544', fillOpacity: 0, interactive: false, className: 'map-area-zone' });
        layer.addLayer(zp);
        const ze = zp.getElement() as SVGElement | undefined;
        if (ze) ze.style.animationDelay = `${Math.round((ar.zonesAt ?? ar.at) + i * 450 - now)}ms`;
      });
      this.stayLabel(ar.center, ar.label, ar.at + 300 - now, 9);
    }
    // 都更：基地範圍（紅框）
    for (const st of r.sites ?? []) {
      const poly = L.polygon(st.rings, { color: '#b03030', weight: 1.6, fillColor: '#d64545', fillOpacity: 0.3, interactive: false, className: 'map-renewal-site' });
      layer.addLayer(poly);
      const e = poly.getElement() as SVGElement | undefined;
      if (e) e.style.animationDelay = `${Math.round(st.at - now)}ms`;
    }
    // 通學區：國小四周 150 公尺
    for (const c of r.circles ?? []) {
      const ci = L.circle([c.lat, c.lng], { radius: c.radiusM, color: '#2a6fd6', weight: 1.3, dashArray: '4 3', fillColor: '#2a6fd6', fillOpacity: 0.12, interactive: false, className: 'map-school-zone' });
      layer.addLayer(ci);
      const e = ci.getElement() as SVGElement | undefined;
      if (e) e.style.animationDelay = `${Math.round(c.at - now)}ms`;
    }
    // 文化網（點 —— 線 —— 面）：面（很粗很淡的光暈）→ 線 → 點，照時間亮
    if (r.network) {
      const nw = r.network;
      const d0 = nw.at - now;
      const add = (l: Leaflet.Path, cls: string, delay: number, len1 = false): void => {
        layer.addLayer(l);
        const e = l.getElement() as SVGElement | undefined;
        if (!e) return;
        e.classList.add(cls);
        if (len1) e.setAttribute('pathLength', '1');
        e.style.animationDelay = `${Math.round(delay)}ms`;
      };
      for (const ln of nw.lines) add(L.polyline(ln.path, { color: ln.color, weight: 34, opacity: 0.2, lineCap: 'round', lineJoin: 'round', interactive: false }), 'map-net-face', d0 + 2100);
      if (!nw.noFace) for (const dt of nw.dots) add(L.circleMarker([dt.lat, dt.lng], { radius: nw.faceR ?? 24, stroke: false, fillColor: dt.color, fillOpacity: 0.18, interactive: false }), 'map-net-face-dot', d0 + 2100);
      for (const ln of nw.lines) add(L.polyline(ln.path, { color: ln.color, weight: 6, opacity: 0.55, lineCap: 'round', lineJoin: 'round', interactive: false }), 'map-net-line', d0 + 900, true);
      for (const dt of nw.dots) add(L.circleMarker([dt.lat, dt.lng], { radius: 9, color: dt.color, weight: 2.5, fill: false, interactive: false }), 'map-net-dot', d0);
    }
    // 線從頭長到尾（步道、自行車橋、星座、文化徑）
    // 縫合市民大道：深灰色的裂縫、橘色的交叉針腳一針一針縫、縫完變淡；SOGO 走到微風的人流小點（畫在橋下空間的線下面）
    for (const sm of r.seams ?? []) {
      if (sm.path.length < 2) continue;
      // 不畫整條深色的帶子（v1.523 使用者說有點可怕），只在要縫的地方畫淡淡的裂縫
      for (const w of sm.walkers) {
        for (const [color, weight] of [['#fff', 8.4], [w.south ? '#ff8a5c' : '#3a6fd8', 6]] as const) {
          const l = L.polyline([w.from, w.to], { color, weight, opacity: 1, lineCap: 'round', dashArray: '0 15', interactive: false, className: 'map-seam-walkers' });
          layer.addLayer(l);
          const e = l.getElement() as SVGElement | undefined;
          if (e) e.style.animationDelay = `${Math.round(w.at - now)}ms,${Math.round(w.at - now)}ms`;
        }
      }
      for (const st of sm.stitches) {
        const [c, a] = [map.latLngToLayerPoint(st.center), map.latLngToLayerPoint(st.along)];
        const ang = (Math.atan2(a.y - c.y, a.x - c.x) * 180) / Math.PI;
        const icon = L.divIcon({ className: 'map-seam-stitch', html: `<svg viewBox="-20 -20 40 40" width="40" height="40" aria-hidden="true"><g transform="rotate(${ang.toFixed(1)})">${crackSvg(sm.at + 600 - now, st.at + 900 - now)}${stitchSvg(st.at - now)}</g></svg>`, iconSize: [40, 40], iconAnchor: [20, 20] });
        layer.addLayer(L.marker(st.center, { icon, interactive: false, keyboard: false, zIndexOffset: 1200 }));
        // 兩個縫線離不到 1 公里，名字一上一下才不會連在一起
        this.stayLabel(st.center, st.label, sm.at + 1400 - now, st.below ? -12 : 24, farCls(HQ_NET_LABEL_KM));
      }
      this.stayLabel(sm.path[Math.floor((sm.path.length - 1) * sm.labelAt)], sm.label, sm.healAt - now, 22, farCls(HQ_NET_LABEL_KM));
    }
    for (const rv of r.reveals ?? []) {
      if (rv.path.length < 2) continue;
      const style: Record<string, Leaflet.PolylineOptions> = {
        trail: { color: '#8a5a24', weight: 3, dashArray: '6 5' },
        bridge: { color: '#5b6b7a', weight: 7 },
        stars: { color: '#f2b544', weight: 1.5 },
        culture: { color: rv.color ?? '#555', weight: 3, opacity: 0.9 },
      };
      const lines = rv.kind === 'bridge' ? [L.polyline(rv.path, { color: '#e8eef3', weight: 11, interactive: false }), L.polyline(rv.path, { ...style.bridge, interactive: false })] : [L.polyline(rv.path, { ...style[rv.kind], interactive: false })];
      for (const l of lines) {
        layer.addLayer(l);
        const e = l.getElement() as SVGElement | undefined;
        if (!e) continue;
        e.classList.add('map-reveal');
        e.setAttribute('pathLength', '1');
        e.style.animationDelay = `${Math.round(rv.at - now)}ms`;
      }
      // 自行車橋上的腳踏車改成騎自行車的人（bikes，v1.529），不畫小點
      if (rv.label) this.stayLabel(rv.path[rv.labelAt !== undefined ? Math.floor((rv.path.length - 1) * rv.labelAt) : rv.kind === 'culture' ? Math.floor(rv.path.length / 2) : rv.path.length - 1], rv.label, rv.at + 2200 - now, rv.kind === 'culture' ? 22 : 32, rv.hideKm ? farCls(rv.hideKm) : '');
    }
    // 冒出來的東西：登山中心、足球場、運動中心、星星
    // 通學區過馬路的小朋友（一百多所國小）只畫地圖正中間 3 km 內的，移動超過 1.5 km 再重畫（moveend）
    this.sceneCenter = map.getCenter();
    // 通學區的斑馬線只有地圖正中間最近的 10 所在動，其他的停著（v1.568 效能）
    const c0 = this.sceneCenter;
    const walking = new Set((r.icons ?? []).filter((ic) => ic.kind === 'schoolwalk').sort((a, b) => map.distance(c0, [a.lat, a.lng]) - map.distance(c0, [b.lat, b.lng])).slice(0, 10));
    for (const ic of r.icons ?? []) {
      if (ic.kind === 'schoolwalk' && map.distance(this.sceneCenter, [ic.lat, ic.lng]) > 3000) continue;
      const calm = ic.calm || (ic.kind === 'schoolwalk' && !walking.has(ic));
      const sc = ic.scale ?? 1;
      // 方向（rot 是地理方位）轉成螢幕角度：0 往右
      const deg = (ic.rot ?? 90) - 90;
      const body = isSceneKind(ic.kind)
        ? sceneSvg(ic.kind, deg)
        : ic.kind === 'regrow'
          ? regrowSvg((ic.grow ?? ic.at) - now)
          : ic.kind === 'culture'
            ? cultureSvg(ic.char ?? '', ic.color ?? '#555')
            : ic.kind === 'service'
              ? serviceSvg(ic.char ?? '', ic.color ?? '#555')
              : MAP_ICON_SVG[ic.kind] + (ic.kind === 'wetland' && ic.rot !== undefined ? windSvg(deg) : '');
      const icon = L.divIcon({ className: `map-voyage-icon ${ic.kind}${ic.focus ? ' focus' : ''}${calm ? ' calm' : ''}`, html: `<svg viewBox="-20 -20 40 40" width="${40 * sc}" height="${40 * sc}" aria-hidden="true"><g class="boat-pop" style="animation-delay:${Math.round(ic.at - now)}ms"><g class="idle idle-${ic.kind}" style="--d:-${idlePhase(now, ((((ic.at * 0.618) % 1) + 1) % 1) * 4000)}ms">${body}</g></g></svg>`, iconSize: [40 * sc, 40 * sc], iconAnchor: [20 * sc, 20 * sc] });
      layer.addLayer(L.marker([ic.lat, ic.lng], { icon, interactive: false, keyboard: false, zIndexOffset: 1300 }));
      if (ic.label && !ic.small) this.stayLabel([ic.lat, ic.lng], ic.label, (ic.grow ?? ic.at) + 500 - now, 20 * sc + 16, ic.hideKm ? farCls(ic.hideKm) : '');
    }
    // 健身小巴：綠色的巡迴路線（示意）、停站時冒出運動的長輩、一台小巴沿著路線繞（moveBoats 擺位置）
    for (const [bi, fb] of (r.fitbuses ?? []).entries()) {
      if (fb.path.length < 2) continue;
      const on = fb.focus ? ' focus' : '';
      for (const [color, weight] of [['#e8f5ee', 6], ['#2f9e6a', 3]] as const) {
        const l = L.polyline(fb.path, { color, weight, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false, className: `map-reveal map-fitbus-line${on}` });
        layer.addLayer(l);
        const e = l.getElement() as SVGElement | undefined;
        if (e) {
          e.setAttribute('pathLength', '1');
          e.style.animationDelay = `${Math.round(fb.lineAt - now)}ms`;
        }
      }
      // 停站的長輩：小巴停在這一站時（moveBoats 加 on）才冒出來
      const stopMarkers: Leaflet.Marker[] = [];
      fb.stops.forEach((st) => {
        const icon = L.divIcon({ className: `map-voyage-icon fitbus-stop${on}`, html: `<svg viewBox="-30 -20 60 50" width="60" height="50" aria-hidden="true">${fitbusStopSvg()}</svg>`, iconSize: [60, 50], iconAnchor: [30, 20] });
        const sm = L.marker(st.at, { icon, interactive: false, keyboard: false, zIndexOffset: 1250 });
        layer.addLayer(sm);
        stopMarkers.push(sm);
        this.stayLabel(st.at, st.label, fb.lineAt + 1200 - now, -24, 'fit-label');
      });
      const n = fb.path.length;
      const [lat, lng, cum] = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
      fb.path.forEach(([a, b], i) => {
        [lat[i], lng[i]] = [a, b];
        cum[i] = i > 0 ? cum[i - 1] + haversineKm({ lat: lat[i - 1], lng: lng[i - 1] }, { lat: a, lng: b }) : 0;
      });
      if (cum[n - 1] > 0) {
        const icon = L.divIcon({ className: `map-boat map-fitbus${on}`, html: `<svg viewBox="-24 -30 48 34" width="48" height="34" aria-hidden="true">${FITBUS_SVG}</svg>`, iconSize: [48, 34], iconAnchor: [24, 30] });
        const marker = L.marker([lat[0], lng[0]], { icon, interactive: false, keyboard: false, zIndexOffset: 1260 });
        layer.addLayer(marker);
        this.boatTracks.push({ id: `hq-fitbus-${bi}`, marker, lat, lng, cum, bus: { start: fb.start, stopAt: fb.stopAt, driveMs: fb.driveMs, stops: stopMarkers } });
      }
    }
    // 騎自行車的人（河濱自行車道、迎風—港墘橋）：沿著路騎（moveBoats 擺位置），拉遠收起來
    (r.bikes ?? []).forEach((bk, i) => {
      const n = bk.path.length;
      if (n < 2) return;
      const [lat, lng, cum] = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
      bk.path.forEach(([a, b], j) => {
        [lat[j], lng[j]] = [a, b];
        cum[j] = j > 0 ? cum[j - 1] + haversineKm({ lat: lat[j - 1], lng: lng[j - 1] }, { lat: a, lng: b }) : 0;
      });
      if (!(cum[n - 1] > 0)) return;
      // 騎自行車的人、登山客（山林徑）、牽狗散步的人（大安森林公園）
      const kind = bk.kind ?? 'bike';
      // 載菜的小貨車（「教育・午餐」按鈕開著才有）不跟著其他特效變淡（focus）
      const icon = L.divIcon({ className: `map-boat map-bike ${kind}${kind === 'truck' ? ' focus' : ''}`, html: `<svg viewBox="-12 -20 24 22" width="27" height="25" aria-hidden="true"${bk.color ? ` style="--c:${bk.color}"` : ''}>${kind === 'hiker' ? HIKER_SVG : kind === 'pet' ? PETWALK_SVG : kind === 'truck' ? TRUCK_SVG : kind === 'walker' ? WALKER_SVG : kind === 'patrol' ? PATROL_SVG : kind === 'scooter' ? SCOOTER_SVG : BIKE_SVG}</svg>`, iconSize: [27, 25], iconAnchor: [13.5, 22.5] });
      const marker = L.marker([lat[0], lng[0]], { icon, interactive: false, keyboard: false, zIndexOffset: 1240 });
      layer.addLayer(marker);
      this.boatTracks.push({ id: `hq-bike-${i}`, marker, lat, lng, cum, ride: { start: bk.start, lap: bk.lap, loop: bk.loop } });
    });
    // 滑鼠移過去的介紹：看不見的感應圈，到時間才感應（visibility），Leaflet 的 tooltip 顯示
    for (const h of r.hits ?? []) {
      const c = map.latLngToLayerPoint([h.lat, h.lng]);
      const m = L.circleMarker(map.layerPointToLatLng(L.point(c.x, c.y - (h.dy ?? 0))), { radius: h.r ?? 12, stroke: false, fillOpacity: 0, className: 'map-intro-hit' });
      m.bindTooltip(`<b>${escapeHtml(h.title)}</b>${h.intro ? `<br>${escapeHtml(h.intro).replace(/\n/g, '<br>')}` : ''}`, { direction: 'top', className: 'hq-intro-tip-map', offset: [0, -8] });
      layer.addLayer(m);
      // 到時間才感應：一個計時器照順序打開（v1.568：原本每個圈各掛一個等著開始的 CSS 動畫）
      const e = m.getElement() as SVGElement | undefined;
      if (e) {
        e.style.visibility = h.at <= now ? 'visible' : 'hidden';
        if (h.at > now) this.hitPending.push({ el: e, at: h.at });
      }
    }
    this.armHits();
    // 真的河：船沿河走時亮起來（畫在最下面）
    for (const rv of r.rivers ?? []) {
      if (rv.ring.length < 3) continue;
      const poly = L.polygon(rv.ring, { color: '#3fa9dc', weight: 1, fillColor: '#4cc3e6', fillOpacity: 0.55, interactive: false, className: 'map-voyage-river' });
      layer.addLayer(poly);
      poly.bringToBack();
      const e = poly.getElement() as SVGElement | undefined;
      if (e) e.style.animationDelay = `${Math.round(rv.at - now)}ms`;
    }
    // 水上活動：SUP、龍舟（螢幕像素的大小，船頭朝 heading）
    for (const b of r.boats ?? []) {
      const sc = b.kind === 'dragon' ? 0.65 : 0.8;
      const svg = `<svg viewBox="-34 -16 68 32" width="68" height="32" aria-hidden="true"><g transform="rotate(${(b.heading - 90).toFixed(1)}) scale(${sc})"><g class="boat-glide" style="animation-delay:${Math.round(b.at - mapHash(b.at) * 3000 - now)}ms"><g class="boat-bob" style="animation-delay:${Math.round(-mapHash(b.at) * 1600)}ms">${b.kind === 'sup' ? MAP_SUP_SVG : MAP_DRAGON_SVG}</g></g></g></svg>`;
      // SUP、龍舟拉遠（縮放 13 以下，雷達 10 km）就不畫（v1.535）
      const icon = L.divIcon({ className: `map-voyage-boat ${b.kind} far-label-10`, html: `<div class="boat-pop" style="animation-delay:${Math.round(b.at - now)}ms">${svg}</div>`, iconSize: [68, 32], iconAnchor: [34, 16] });
      layer.addLayer(L.marker([b.lat, b.lng], { icon, interactive: false, keyboard: false, zIndexOffset: 1200 }));
    }
    for (const pl of r.plantings ?? []) {
      const cut = pl.kind === 'cut';
      // 一叢樹：以那一點為中心、照現在的縮放換成像素散開（砍樹的地方多一點、散開一點），一棵接一棵長
      const [count, spread] = cut ? [MAP_PLANT_CUT_TREES, 22] : [MAP_PLANT_TREES, 15];
      // 離水近的散開不能超過 spreadM 公尺（照現在的縮放換成像素），樹才不會長到河上
      const mPerPx = (40_075_016.686 * Math.cos((pl.lat * Math.PI) / 180)) / 2 ** (map.getZoom() + 8);
      const maxD = Math.min(spread, pl.spreadM ? pl.spreadM / mPerPx : Infinity);
      const seed = Math.round(pl.lat * 1000 + pl.lng * 7);
      const c = map.latLngToLayerPoint([pl.lat, pl.lng]);
      for (let j = 0; j < count; j++) {
        const a = mapHash(seed + j * 3 + 1) * 2 * Math.PI;
        const d = Math.sqrt(mapHash(seed + j * 3 + 2)) * maxD;
        const m = L.circleMarker(map.layerPointToLatLng(L.point(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d)), { radius: (cut ? 4 : 3.5) + mapHash(seed + j * 3 + 3) * 3, color: cssVar('--grass', '#3f8f2f'), weight: 1.2, fillColor: cssVar('--grass', '#3f8f2f'), fillOpacity: 0.95, interactive: false, className: 'map-tree' });
        layer.addLayer(m);
        const e = m.getElement() as SVGElement | undefined;
        if (e) e.style.animationDelay = `${Math.round(pl.at + j * 45 - now)}ms`;
      }
      if (pl.label) {
        const icon = L.divIcon({ className: 'map-voyage-stop', html: `<span style="animation-delay:${Math.round(pl.at + 300 - now)}ms">${escapeHtml(pl.label)}</span>`, iconSize: [120, 18], iconAnchor: [60, 34] });
        layer.addLayer(L.marker([pl.lat, pl.lng], { icon, interactive: false, keyboard: false, zIndexOffset: 1500 }));
      }
    }
  }

  /** 河流畫到 at（0～1）：流過整段的固定下來，最前面那一段從固定好的地方到現在的位置（整點，再加最前面那一點內插） */
  private drawRiver(t: (typeof this.riverTracks)[number], at: number): void {
    if (Math.abs(at - t.at) < 1e-4) return;
    t.at = at;
    const { pts, cum } = t;
    const n = pts.length;
    const want = at * cum[n - 1];
    while (t.chunkStart < n - 1 && cum[t.chunkEnd] <= want) {
      this.riverChunk(t, t.chunkStart, t.chunkEnd);
      t.chunkStart = t.chunkEnd;
      t.chunkEnd = Math.min(n - 1, t.chunkEnd + MAP_RIVER_CHUNK);
      if (t.chunkStart >= n - 1) break;
    }
    let i = t.chunkStart;
    while (i < n && cum[i] <= want) i++;
    const shown = pts.slice(t.chunkStart, i);
    if (i > t.chunkStart && i < n) {
      const w = (want - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      shown.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * w, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * w]);
    }
    for (const l of t.lines) l.setLatLngs(shown.length > 1 ? shown : []);
  }

  /** 洋流號：路線的經緯度照實際距離記下來，船是點不到的標記（在其他標記下面） */
  private addBoat(r: MapRoute): void {
    const L = this.L;
    const layer = this.routeLayer;
    const pts = r.segments.flatMap((sg) => sg.path);
    const n = pts.length;
    if (!L || !layer || n < 2) return;
    const [lat, lng, cum] = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
    pts.forEach(([a, b], i) => {
      [lat[i], lng[i]] = [a, b];
      cum[i] = i > 0 ? cum[i - 1] + haversineKm({ lat: lat[i - 1], lng: lng[i - 1] }, { lat: a, lng: b }) : 0;
    });
    if (!(cum[n - 1] > 0)) return;
    const icon = L.divIcon({ className: 'map-boat', html: `<svg viewBox="-24 -46 48 50" width="48" height="50" aria-hidden="true">${BOAT_SVG}</svg>`, iconSize: [48, 50], iconAnchor: [24, 46] });
    const marker = L.marker([lat[0], lng[0]], { icon, interactive: false, keyboard: false, zIndexOffset: -1000 });
    layer.addLayer(marker);
    this.boatTracks.push({ id: r.id, marker, lat, lng, cum, voyage: r.voyage });
  }

  /** 每一格畫面把洋流號擺到現在的位置（跟雷達同一個時鐘；地圖藏起來時不擺，回來接著開）；沒有船就停 */
  private moveBoats = (): void => {
    cancelAnimationFrame(this.boatFrame);
    this.boatFrame = 0;
    if (this.boatTracks.length === 0) return;
    if (this.el.offsetWidth > 0) {
      const now = Date.now();
      const lap = boatPhase(now);
      // 河流跟著船長出來；到終點淡完就整條拿掉（v1.568）
      this.riverTracks = this.riverTracks.filter((t) => {
        if (t.riverOut === undefined || now < t.riverOut + MAP_RIVER_GONE_MS) return true;
        for (const l of t.all) this.routeLayer?.removeLayer(l);
        return false;
      });
      for (const t of this.riverTracks) this.drawRiver(t, voyagePhase(now - t.voyage).at);
      for (const t of this.boatTracks) {
        // 只開一趟的（洋流總部的特效）照出發的時間走，其他的一直重複開
        // 騎自行車的人：拉遠收起來
        if (t.ride) {
          const box = t.marker.getElement();
          if (box) box.style.display = this.motionFar ? 'none' : '';
          if (this.motionFar) continue;
        }
        const ph = t.bus ? fitbusPhase(now - t.bus.start, t.bus.stopAt, t.bus.driveMs) : t.ride ? bikePhase(now - t.ride.start, t.ride.lap, t.ride.loop) : null;
        // 拉遠了，健身小巴停在第一站不開
        const { at, alpha } = t.bus && ph ? (this.motionFar ? { at: t.bus.stopAt[0], alpha: ph.alpha } : ph) : ph ?? (t.voyage !== undefined ? voyagePhase(now - t.voyage) : lap);
        // 停在哪一站，那一站的長輩才出來
        if (t.bus && ph && 'stop' in ph) t.bus.stops.forEach((m, i) => m.getElement()?.classList.toggle('on', !this.motionFar && ph.stop === i));
        // 經度往東是畫面的右邊
        const p = alongLine(t.lng, t.lat, t.cum, at);
        if (p.left !== null) this.boatLeft.set(t.id, p.left);
        t.marker.setLatLng([p.y, p.x]);
        const box = t.marker.getElement();
        if (box) {
          box.style.opacity = alpha.toFixed(2);
          box.classList.toggle('left', !!this.boatLeft.get(t.id));
        }
      }
    }
    this.boatFrame = requestAnimationFrame(this.moveBoats);
  };
}

/** 標位置用的小地圖：點地圖或拖標記改位置，每次改都呼叫 onPick */
export interface PinPicker {
  /** 把標記移到這裡（不呼叫 onPick），null 是拿掉標記 */
  set(p: LatLng | null, zoom?: number): void;
  /** 只移動地圖，不動標記 */
  view(p: LatLng, zoom?: number): void;
  remove(): void;
}

/**
 * 在 el 放一張小地圖：有 pin 就標在那裡，沒有就以 center 為中心、等使用者點。
 * mark 是要對照的原本位置（灰色圓點，不能拖），例如管理頁改車掃一站的地點時，那一站現在在哪
 */
export async function pinPicker(
  el: HTMLElement,
  pin: LatLng | null,
  center: LatLng,
  base: BaseMap,
  onPick: (p: LatLng) => void,
  mark?: { at: LatLng; title: string },
): Promise<PinPicker> {
  const [mod] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
  const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
  const start = pin ?? center;
  const map = L.map(el, { zoomControl: true, attributionControl: true, zoomSnap: 0 }).setView([start.lat, start.lng], pin || mark ? 17 : 15);
  map.attributionControl.setPrefix(false);
  // 國土測繪中心的底圖只有台灣：標國外的位置時換成 OpenStreetMap
  let shown: BaseMap | null = null;
  let tiles: Leaflet.TileLayer | null = null;
  const useBase = (): void => {
    const c = map.getCenter();
    const want: BaseMap = base === 'nlsc' && !(c.lat > 21 && c.lat < 26.5 && c.lng > 118 && c.lng < 123) ? 'osm' : base;
    if (want === shown) return;
    tiles?.remove();
    const b = BASES[want];
    tiles = L.tileLayer(b.url, { maxZoom: 20, maxNativeZoom: b.maxNativeZoom, attribution: b.attribution }).addTo(map);
    shown = want;
  };
  useBase();
  map.on('moveend', useBase);
  const icon = L.divIcon({ className: 'pin-marker', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 26] });
  let marker: Leaflet.Marker | null = null;
  const place = (p: LatLng): Leaflet.Marker => {
    if (marker) return marker.setLatLng([p.lat, p.lng]);
    marker = L.marker([p.lat, p.lng], { icon, draggable: true, autoPan: true, keyboard: false }).addTo(map);
    marker.on('dragend', () => {
      const ll = marker?.getLatLng();
      if (ll) onPick({ lat: ll.lat, lng: ll.lng });
    });
    return marker;
  };
  if (mark) {
    L.circleMarker([mark.at.lat, mark.at.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#6b7280', fillOpacity: 0.9, interactive: false })
      .bindTooltip(mark.title, { permanent: true, direction: 'top', offset: [0, -8], className: 'pin-mark-label' })
      .addTo(map);
  }
  if (pin) place(pin);
  map.on('click', (e: Leaflet.LeafletMouseEvent) => {
    place({ lat: e.latlng.lat, lng: e.latlng.lng });
    onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
  });
  // 剛從 hidden 變成顯示，尺寸要再算一次
  requestAnimationFrame(() => map.invalidateSize());
  return {
    set(p, zoom) {
      if (!p) {
        marker?.remove();
        marker = null;
        return;
      }
      place(p);
      map.setView([p.lat, p.lng], zoom ?? map.getZoom());
    },
    view(p, zoom) {
      map.setView([p.lat, p.lng], zoom ?? map.getZoom());
    },
    remove: () => map.remove(),
  };
}
