import './styles.css';
import { FITBUS_MS_PER_M, hqDenseKm, hqMotionKm, HQ_NET_LABEL_KM, HQ_SAIL_MS, HQ_STAR_MS, HQ_VOYAGE_MS, RAINBOW_EVERY_MS, voyagePhase, voyageTimeOf } from './flow';
import { addKeyword, deletePushSubscription, locateFeedbackPlace, sendFeedback, type FeedbackKind, fetchPushKey, savePushSubscription, confirmReport, editReport, locatePlace, rejectReport, supplementReport, deleteBottle, dropBottle, readBottle, type BottleHere, fetchBottleInfo, fetchBottlePhoto, fetchBottleProof, fetchBottles, fetchWoofBottles, rememberBottlePhoto, uncollectLetter, verifyBottleProof, fetchEvents, fetchHealth, fetchKeywords, fetchMyBottles, fetchMyReports, fetchRoutes, pickBottle, reportBottle, submitLink, withdrawReport } from './api';
import { compassSupported, startCompass } from './compass';
import { bearingDeg, compassLabel, destination, formatKm, haversineKm, taiwanRadiusKm, type LatLng } from './geo';
import { TAIWAN_RINGS } from './taiwan';
import type { SceneKind } from './hq-scenes';
import { LANDMARKS } from './landmarks';
import { getModule, JOB_RISK_TEXT, JOB_SAFETY_TIPS, MEETUP_SAFETY_TIPS, MODULES, OFFER_SAFETY_TIPS, SEEK_SAFETY_TIPS, type ModuleDef, type ModuleId } from './modules';
import { X_MAX_WEIGHT, xLength } from './xcount';
import { shortAddress, splitPlace } from './place';
import { crowdOf, MapView, pinPicker, type BaseMap, type MapRoute, type PinPicker } from './map';
import { beep, ensureNotificationPermission, iosNeedsHomeScreen, notificationState, pushSubscription, pushSupported, registerServiceWorker, showBanner, systemNotify, unlockAudio, unsubscribePush } from './notify';
import { checkWishNews, findCard, gotReward, myCards, onWishNews, openAlbum, openHelp, openItems, openWishes, overlay } from './cards';
import { DEEP_FROM_KM, LY_KM, Radar, SPACE_FROM_KM, type RadarLabel, type RadarRoute, type RadarStreets, type SpaceView } from './radar';
import { DEFAULT_THEME_ID, getTheme, THEMES, type Theme } from './themes';
import type { WoofBottleMark } from './space';
import { topicChipSvg, topicGlyph, TOPIC_TYPES } from './topic-icons';
import type { BottleOut, BottleProof, EventOut, Item, KeywordInfo, KeywordRules, MyBottles, MyReport, Origin, Phase, PickedBottle, RelatedPost, RouteOut, PreviewItem, RouteStop, RoutePreview, SubmitResult, FailedItem, EditItem, EditInput } from './types';

const DEFAULT_ORIGIN: Origin = { lat: 25.0478, lng: 121.517, source: 'default' }; // 台北車站
const SOON_SEC = 30 * 60;
/** 後端查詢半徑：至少 80 km，選大範圍時跟著放大，才不會漏掉邊緣的發放 */
/** 永遠抓全台（含離島）的資料，清單分「範圍內」與「雷達範圍外」 */
const FETCH_RADIUS_KM = 600;
/** 範圍超過 600 km（全球、縮放到很遠）就抓全世界的，平常只抓附近 600 km */
let lastFetchRadius = FETCH_RADIUS_KM;
/**
 * 自動更新的間隔（秒），0 是關掉（預設）：一直開著的網頁每次更新都算伺服器的請求數（免費方案每天 10 萬次）。
 * 關掉時點「更新 HH:MM」手動更新；新貼文是伺服器排程每 10 分鐘才抓一次，自己回報、確認、換位置時另外會馬上更新
 */
const POLL_CHOICES = [0, 60, 300, 600];
const LS_POLL = 'dr.poll';
/** 切回這個分頁時，上次更新超過這麼久就馬上更新 */
const STALE_ON_SHOW_SEC = 120;
/** 車掃路線最多每 10 分鐘抓一次（伺服器的排程也是每 10 分鐘才更新） */
const ROUTES_EVERY_SEC = 600;
const TICK_MS = 5_000;
const LS_SCALE = 'dr.scale';
/** 雙指縮放後的自訂範圍（公里） */
const LS_SCALE_KM = 'dr.scaleKm';
/** 在汪星上（點汪星飛過去、搭火箭過去）：中心、轉的角度，重新整理也回到汪星同一個地方；離開汪星就清掉 */
const LS_SPACE = 'dr.space';
const LS_ORIGIN = 'dr.origin';
/** 移動成手動位置之前的位置（「定位」還沒收到 GPS 時先回這裡，不用等重新定位） */
const LS_HOME = 'dr.home';
const LS_THEME = 'dr.theme';
/** 全螢幕（像 Google 地圖）：'1' 是開著；電腦全螢幕時收起清單：'1' */
const LS_FULL = 'dr.full';
const LS_LIST_OFF = 'dr.listOff';
const LS_BASE = 'dr.base';
const BASES: BaseMap[] = ['nlsc', 'osm'];
const LS_KEYWORDS = 'dr.keywords';
/** 這個瀏覽器回報過貼文：開頁面時才去拿「我的回報」，沒回報過的不用多一次請求 */
const LS_REPORTED = 'dr.reported';
const LS_SPOTS = 'dr.showSpots';
const LS_GIVEAWAYS = 'dr.showGiveaways';
const LS_ACTIVITIES = 'dr.showActivities';
const LS_ONLY_ACTIVE = 'dr.onlyActive';
const LS_TIME = 'dr.timeRange';
/** 丟過瓶子（才需要去問有沒有被收藏）、看過的最後一次「被收藏」時間 */
const LS_BOTTLE_DROPPED = 'dr.bottleDropped';
const LS_BOTTLE_SEEN = 'dr.bottleSeen';
/** 這台裝置看過內容的瓶子（編號，最近 BOTTLE_READ_MAX 個） */
const LS_BOTTLE_READ = 'dr.bottleRead';
/** 開始提醒（音效、震動、橫幅、系統通知）的開關：on／off；沒設過時，瀏覽器已允許通知就算開 */
const LS_NOTIFY = 'dr.notify';
/** 手機推播（網頁關掉也收得到）開著：'on' */
const LS_PUSH = 'dr.push';
/** 之前就開了通知的人，提示過一次可以開手機推播 */
const LS_PUSH_HINT = 'dr.pushHint';
/** 管理頁（admin.html）存的：管理 token、這支手機有沒有開回報通知 */
const LS_ADMIN_TOKEN = 'dr.adminToken';
const LS_ADMIN_PUSH = 'dr.adminPush';
/** 固定據點休息中、下一段在這個時間內開始才畫淡光點 */
const SPOT_SHOW_AHEAD_SEC = 24 * 3600;
const KEYWORD_RE_INVALID = /[<>{}\\%_]/;

const $ = <T extends HTMLElement>(sel: string): T => {
  const n = document.querySelector<T>(sel);
  if (!n) throw new Error(`missing element ${sel}`);
  return n;
};

const timeFmt = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtTime = (unix: number): string => timeFmt.format(new Date(unix * 1000));
const nowSec = (): number => Math.floor(Date.now() / 1000);

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 隱私模式等情況忽略 */
  }
}

function loadOrigin(): Origin | null {
  const raw = lsGet(LS_ORIGIN);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Origin;
    if (o.source === 'manual' && Number.isFinite(o.lat) && Number.isFinite(o.lng)) return o;
  } catch {
    /* ignore */
  }
  return null;
}

// ---- state ----
let origin: Origin = loadOrigin() ?? DEFAULT_ORIGIN;
let events: EventOut[] = [];
/** 今天的車掃路線 */
let routes: RouteOut[] = [];
/** 上次抓到的車掃路線（換模組再換回洋流時直接用） */
let routesCache: RouteOut[] = [];
let routesAt = 0;

/** 因為有沒有路線的車掃點而重抓過路線的貼文（伺服器說有路線、但路線清單裡沒有的，不要每次都重抓） */
const routesRefetched = new Set<string>();

async function currentRoutes(): Promise<RouteOut[]> {
  if (nowSec() - routesAt < ROUTES_EVERY_SEC) return routesCache;
  routesCache = await fetchRoutes();
  routesAt = nowSec();
  return routesCache;
}
/** 打開的是哪條路線的時間表 */
let selectedRoute: string | null = null;
/** 點了雷達上的星星（固定地標） */
let selectedLandmark: string | null = null;
/** 附近的漂流瓶（沒有內容），點了雷達上的哪一個 */
let bottles: BottleOut[] = [];
/** 漂到汪星海上的漂流瓶（你在汪星才抓） */
let woofBottles: BottleOut[] = [];
let selectedBottle: number | null = null;
/** 剛丟出去、自動打開的瓶子：詳細資料不再顯示一次內容（v1.656 使用者說的；關掉再點瓶子才顯示） */
let justThrown: number | null = null;
/** 打開來看過（自己丟的、收藏的、走到附近看的）瓶子內容 */
const bottleTexts = new Map<number, PickedBottle>();
/**
 * 看過內容的瓶子（v1.658 使用者說自己看過的漂流瓶顯示空瓶）：雷達、地圖、汪星海上畫成空瓶（沒有信卷，v1.659 軟木塞也拿掉）；
 * 詳細資料裡真的顯示了內容才算（剛丟完自動打開、沒顯示內容的不算），記在這台裝置
 */
const BOTTLE_READ_MAX = 500;
const readBottles = new Set<number>(
  ((): number[] => {
    try {
      const v: unknown = JSON.parse(lsGet(LS_BOTTLE_READ) ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : [];
    } catch {
      return [];
    }
  })(),
);
function markBottleRead(id: number): void {
  if (readBottles.has(id)) return;
  readBottles.add(id);
  lsSet(LS_BOTTLE_READ, JSON.stringify([...readBottles].slice(-BOTTLE_READ_MAX)));
}
/** 漂流瓶詳細資料上的訊息（看不到、收藏不到的原因、檢舉結果） */
let bottleMsg = '';
/** 最近一次讀到的「我的瓶子」：丟的、收藏的信 */
let myBottlesData: MyBottles | null = null;
/** 這次打開網頁已經提示過「瓶子被收藏了」 */
let bottleNewsShown = false;
type ScaleSetting = '1' | '5' | '20' | 'taiwan' | 'world' | 'custom';
/**
 * 下方按鈕的範圍；custom 是雙指縮放或滾輪調出來的（從「全球」再拉遠就是太空）。
 * 台灣哪裡都一樣：預設 50 km（DEFAULT_KM，沒有按鈕），「全台」「全球」才照位置算到涵蓋整個台灣、地球
 */
const SCALE_SETTINGS: ScaleSetting[] = ['1', '5', '20', 'taiwan', 'world'];
const DEFAULT_KM = 50;
const isAutoScale = (s: ScaleSetting): boolean => s === 'taiwan' || s === 'world';
/** 「全球」的範圍：半個地球（地球另一面最遠約 20,000 km） */
const WORLD_KM = SPACE_FROM_KM;
/**
 * 太空最遠拉到哪：約 6000 萬光年，看得到 M87（5350 萬光年）
 * （第 1 號願望「Kepler-22b，拉遠看得到其他星系」，v1.582 到 400 萬光年（仙女座、三角座星系）；以前只到整個太陽系，5e9 km；
 * 第 3 號願望「還有哪些星系可以畫出來」，v1.637 拉到 6000 萬光年）
 */
const SPACE_MAX_KM = 6e7 * LY_KM;
const MIN_ZOOM_KM = 0.5;
/**
 * 你在哪一顆：火箭在哪一邊你就在哪一邊（park.ts 存在 dr.rocket；搭火箭到汪星就在汪星，點別的星球只是看過去，坐火箭回來才回到地球）。
 * 在汪星時：太陽系寫「汪星（你）」、「定位」回到汪星的發射口、範圍按鈕是汪星的
 */
let youOn: 'earth' | 'woof' = ((): 'earth' | 'woof' => {
  try {
    return (JSON.parse(lsGet('dr.rocket') ?? 'null') as { world?: string } | null)?.world === 'woof' ? 'woof' : 'earth';
  } catch {
    return 'earth';
  }
})();
/** 你在汪星、上次鏡頭在汪星：重新整理也回到汪星（null 是在地球、其他星球；你在地球時不記，汪星的地圖要搭火箭過去才看得到） */
const savedWoof = ((): SpaceView | null => {
  try {
    const v = JSON.parse(lsGet(LS_SPACE) ?? 'null') as { focus?: string; yaw?: number; pitch?: number } | null;
    return youOn === 'woof' && v?.focus === 'woof' && Number.isFinite(v.yaw) && Number.isFinite(v.pitch) ? { focus: 'woof', yaw: v.yaw!, pitch: v.pitch! } : null;
  } catch {
    return null;
  }
})();
/** 火箭飛行中（整趟不接受範圍按鈕、定位）；tripTo 是要去哪一顆 */
let tripping = false;
let tripTo: 'earth' | 'woof' | null = null;
/** 汪星的地圖（台北的陸地、道路、中山公園）看不看得到：你在汪星，或火箭正飛過去；你在地球時汪星是普通的星球、只能看整顆 */
const woofMap = (): boolean => youOn === 'woof' || tripTo === 'woof';
// 汪星的中山公園可以放大到 1 公尺以內：重新整理後還在汪星就照存的範圍（最近 0.5 公尺，跟 park.ts 的 PARK_MIN_KM 一樣），回到地球至少是雷達平常的最小範圍
// 第一次打開、以前選「雙北」（已經拿掉）的：50 km
const savedScale = lsGet(LS_SCALE);
const scaleKnown = ([...SCALE_SETTINGS, 'custom'] as string[]).includes(savedScale ?? '');
let customKm = Math.max(youOn === 'woof' ? 0.0005 : MIN_ZOOM_KM, (scaleKnown && Number(lsGet(LS_SCALE_KM))) || DEFAULT_KM);
let scaleSetting: ScaleSetting = scaleKnown ? (savedScale as ScaleSetting) : 'custom';
if (!scaleKnown) lsSet(LS_SCALE_KM, String(DEFAULT_KM));
let scaleKm = 5;
let view: 'radar' | 'map' = 'radar';
let selectedId: number | null = null;
let lastFetchAt = 0;
let notifiedOnce = false;
let stopCompass: (() => void) | null = null;
let available: KeywordInfo[] = [];
/** 後端開放使用者自訂關鍵字時才顯示編輯功能 */
let canEditKeywords = false;
let keywordRules: KeywordRules | null = null;
let savedFollowed: string[] | null = loadFollowed();
let theme: Theme = getTheme(new URLSearchParams(location.search).get('theme') ?? lsGet(LS_THEME) ?? DEFAULT_THEME_ID);
/** 已經提醒過的事件；固定據點用據點 key，每天開門不會重複嗶 */
const seenActive = new Set<string>();
/** 清單上方的開關：發放、活動（含車掃）、固定據點各自顯示或隱藏 */
type Category = 'giveaway' | 'activity' | 'spot' | 'job';
const CATEGORY_LS: Record<Category, string> = { giveaway: LS_GIVEAWAYS, activity: LS_ACTIVITIES, spot: LS_SPOTS, job: 'dr.showJobs' };
// 職缺只有一類（狗狗陪伴），不給關
const shown: Record<Category, boolean> = { giveaway: lsGet(LS_GIVEAWAYS) !== '0', activity: lsGet(LS_ACTIVITIES) !== '0', spot: lsGet(LS_SPOTS) !== '0', job: true };
const categoryOf = (it: Item): Category => (it.ev.kind === 'job' ? 'job' : it.spot ? 'spot' : it.ev.kind === 'activity' ? 'activity' : 'giveaway');

// ---- 模組：洋流、狗狗陪伴…（同一套雷達換資料），網址 ?module=dog 或上次選的 ----
const LS_MODULE = 'dr.module';
let mod: ModuleDef = getModule(new URLSearchParams(location.search).get('module') ?? lsGet(LS_MODULE));

// ---- 職缺（狗狗陪伴、找工作）----
interface JobExtra {
  /** hire 徵人；offer 可照顧（狗狗陪伴：個人說可以幫忙照顧）、求職（找工作：個人想找工作） */
  role?: 'hire' | 'offer';
  work_from?: string | null;
  work_to?: string | null;
  slots?: string[];
  pay?: string | null;
  employer?: string | null;
  contact?: string | null;
  requirements?: string | null;
  risks?: string[];
}
const jobOf = (ev: { extra?: Record<string, unknown> | null }): JobExtra => (ev.extra ?? {}) as JobExtra;
const isOffer = (ev: { extra?: Record<string, unknown> | null }): boolean => jobOf(ev).role === 'offer';
/** 職缺的說法照模組：狗狗陪伴是徵人、可照顧，找工作是徵人、求職 */
interface JobWords {
  offer: string;
  hireType: string;
  offerType: string;
  offerPay: string;
  offerPeriod: string;
  offerNeeds: string;
  offerEnded: string;
  offerTipsTitle: string;
  offerTips: string[];
  /** 可照顧寫提供者（店家或個人）；求職是個人，不寫 */
  offerWho: boolean;
}
const JOB_WORDS: Record<'dog' | 'work', JobWords> = {
  dog: { offer: '可照顧', hireType: '徵人（找人照顧狗狗）', offerType: '可照顧（有人可以幫忙照顧狗狗）', offerPay: '費用', offerPeriod: '可照顧期間', offerNeeds: '條件', offerEnded: '已不提供', offerTipsTitle: '把狗狗交給別人前', offerTips: OFFER_SAFETY_TIPS, offerWho: true },
  work: { offer: '求職', hireType: '徵人（短期、兼職、工讀）', offerType: '求職（想找短期、兼職、工讀）', offerPay: '希望薪資', offerPeriod: '可以工作的時間', offerNeeds: '想做的工作', offerEnded: '已找到工作', offerTipsTitle: '聯絡前', offerTips: SEEK_SAFETY_TIPS, offerWho: false },
};
const jobWords = (): JobWords => JOB_WORDS[mod.id === 'work' ? 'work' : 'dog'];

// ---- 羽球臨打：招臨打（提供）照場次排，找臨打（需求）是刊登 ----
interface SessionExtra {
  role?: 'offer' | 'seek';
  available?: string | null;
  fee?: string | null;
  level?: string | null;
  slots?: string | null;
  shuttle?: string | null;
  team?: string | null;
  contact?: string | null;
  /** 找臨打寫了想打的時段 */
  play_at?: number | null;
  play_end?: number | null;
}
const sessionOf = (ev: { extra?: Record<string, unknown> | null }): SessionExtra => (ev.extra ?? {}) as SessionExtra;
const isSeek = (ev: { kind: string; extra?: Record<string, unknown> | null }): boolean => ev.kind === 'session' && sessionOf(ev).role === 'seek';
/** 找臨打、揪團的時間：「想打 10/25（六）14:00–17:00」「約 10/22（四）19:00」，沒寫就是「可以打 週末下午」「時間可討論」 */
function seekWhen(ev: { kind: string; extra?: Record<string, unknown> | null }): string {
  const x = sessionOf(ev);
  const verb = ev.kind === 'food' ? '約' : '想打';
  if (x.play_at) return `${verb} ${dateFmt.format(new Date(x.play_at * 1000))} ${fmtTime(x.play_at)}${x.play_end ? `–${fmtTime(x.play_end)}` : ''}`;
  return ev.kind === 'food' ? '時間可討論' : `可以打 ${x.available ?? '時間可討論'}`;
}

// ---- 美食品味：出攤（店家發布）照時間排；網友推薦、揪團吃飯是刊登 ----
interface FoodExtra {
  role?: 'vendor' | 'recommend' | 'meetup';
  shop?: string | null;
  food?: string | null;
  price?: string | null;
  hours?: string | null;
  slots?: string | null;
  contact?: string | null;
  play_at?: number | null;
  play_end?: number | null;
}
const foodOf = (ev: { extra?: Record<string, unknown> | null }): FoodExtra => (ev.extra ?? {}) as FoodExtra;
const foodRole = (ev: { kind: string; extra?: Record<string, unknown> | null }): FoodExtra['role'] | null => (ev.kind === 'food' ? (foodOf(ev).role ?? 'recommend') : null);

/** 刊登的角色在清單上另外一段：找臨打、網友推薦、揪團吃飯 */
const POSTING_SECTION: Record<string, string> = { seek: '找臨打', recommend: '網友推薦', meetup: '揪團吃飯' };
/** 每週固定的那一段叫什麼 */
const SPOT_SECTION: Record<string, string> = { badminton: '每週固定場', food: '每週固定擺攤' };
function postingRole(ev: { kind: string; extra?: Record<string, unknown> | null }): string | null {
  if (ev.kind !== 'session' && ev.kind !== 'food') return null;
  const role = (ev.extra?.role as string | undefined) ?? (ev.kind === 'food' ? 'recommend' : null);
  return role && POSTING_SECTION[role] ? role : null;
}

/** 其他模組的摘要：「2 場招臨打、1 個找臨打」「1 個出攤、3 家推薦、1 個揪團」；狗狗陪伴是徵人、可照顧 */
function moduleSummary(singles: Row[], spotsIn: Row[], postings: Map<string, Row[]>): string {
  const n = (role: string): number => postings.get(role)?.length ?? 0;
  const join = (parts: Array<[number, string]>): string => parts.filter(([c]) => c > 0).map(([c, t]) => `${c} ${t}`).join('、');
  if (mod.id === 'badminton') return join([[singles.length + spotsIn.length, '場招臨打'], [n('seek'), '個找臨打']]);
  if (mod.id === 'food') return join([[singles.length + spotsIn.length, '個出攤'], [n('recommend'), '家推薦'], [n('meetup'), '個揪團']]);
  return singles.length ? dogSummary(singles) : '';
}

/** 美食品味的詳細資料：出攤寫時間、攤名、賣什麼、價位；推薦寫店名、推薦什麼、營業時間；揪團寫時間、缺幾人、怎麼報名，加上安全提醒 */
function foodDetailHtml(it: Item, now: number): string {
  const { ev } = it;
  const x = foodOf(ev);
  const role = foodRole(ev);
  const line = (k: string, v: string | null | undefined): string => (v ? `${k}：${esc(v)}<br>` : '');
  const where = `地點：${esc(placeOf(ev))}${ev.approxArea ? `<br><span class="approx-note">約略位置：只知道在${esc(ev.approxArea)}</span>` : ''}`;
  if (role === 'meetup') {
    return `<div class="fraud-box"><b>⚠️ 跟網友吃飯前</b><ul>${MEETUP_SAFETY_TIPS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div><p>類型：揪團吃飯<br>${line('吃什麼', x.food)}時間：${esc(seekWhen(ev))}<br>${line('缺幾人', x.slots)}${line('預算', x.price)}${line('報名方式', x.contact ? (CONTACT_TEXT[x.contact] ?? x.contact) : null)}${where}</p>`;
  }
  if (role === 'recommend') {
    return `<p>類型：網友推薦<br>${line('店名', x.shop)}${line('推薦', x.food)}${line('價位', x.price)}${line('營業時間', x.hours)}${where}</p><p class="muted small">推薦是網友的心得；營業時間、價位以店家公告為準。</p>`;
  }
  const time = it.spot ? spotSchedule(it) : eventTimeText(ev);
  return `<p>類型：${it.spot ? '出攤・每週固定擺攤' : '出攤（餐車、市集攤位）'}<br>時間：${esc(time)}<br>${line('攤名', x.shop)}${line('賣什麼', x.food)}${line('價位', x.price)}${where} · ${esc(timeLine(it, now))}</p>`;
}
const CONTACT_TEXT: Record<string, string> = { form: '填表單', line: '加 LINE', dm: '私訊、留言', phone: '打電話', email: 'Email', other: '其他方式' };
const mdText = (d: string): string => d.slice(5).split('-').map(Number).join('/');
/** 「11/20–11/30・每天 09:00–12:00、15:00–18:00」 */
function jobPeriod(j: JobExtra): string {
  const range = j.work_from && j.work_to && j.work_from !== j.work_to ? `${mdText(j.work_from)}–${mdText(j.work_to)}` : j.work_from ? mdText(j.work_from) : j.work_to ? `到 ${mdText(j.work_to)}` : '';
  const slots = (j.slots ?? []).map((s) => s.replace('-', '–')).join('、');
  return [range, slots && `每天 ${slots}`].filter(Boolean).join('・') || '沒寫工作期間';
}
/** 有防詐提醒的職缺 */
const jobRisky = (ev: { extra?: Record<string, unknown> | null }): boolean => (jobOf(ev).risks ?? []).some((r) => r !== 'no_employer');
/** 職缺的防詐提醒：這則的可疑之處，加上每則都提醒的（可照顧的是給飼主的安全提醒，求職的是聯絡前的提醒） */
function fraudBoxHtml(ev: { extra?: Record<string, unknown> | null }): string {
  const risks = (jobOf(ev).risks ?? []).map((r) => JOB_RISK_TEXT[r]).filter(Boolean);
  const offer = isOffer(ev);
  const w = jobWords();
  return `<div class="fraud-box"><b>⚠️ ${offer ? w.offerTipsTitle : '防詐提醒'}</b>${risks.length ? `<ul>${risks.map((r) => `<li class="risk">${esc(r)}</li>`).join('')}</ul>` : ''}<ul>${(offer ? w.offerTips : JOB_SAFETY_TIPS).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
}
/**
 * 只看進行中：跟發放、活動、據點開關一起用，有打開的那幾類裡，只留現在就能去的
 * （進行中的發放、活動，開放中的據點，車掃中）
 */
let onlyActive = lsGet(LS_ONLY_ACTIVE) === '1';
/** 時間範圍（跟距離範圍對應）：雷達、地圖只畫這段時間內會開始的，進行中、開放中的一定畫 */
type TimeSetting = 'now' | '3h' | '24h' | '3d' | 'all';
const TIME_SEC: Record<TimeSetting, number> = { now: 0, '3h': 3 * 3600, '24h': 24 * 3600, '3d': 3 * 86400, all: Infinity };
// 時間範圍的按鈕先拿掉看看：固定「全部」，之前選過別的也不管（只看進行中用清單上的「進行中」）
let timeSetting: TimeSetting = 'all';
/** 用這個瀏覽器回報過的貼文（伺服器認裝置代碼）；詳細資料看到自己回報的可以刪除 */
let myReports: MyReport[] = [];
const myReportIds = new Set<string>();

// ---- elements ----
const bannerEl = $('#banner');
const listEl = $<HTMLUListElement>('#event-list');
const emptyEl = $('#empty-hint');
const detailEl = $('#detail');
const countLabel = $('#count-label');
const originLabel = $('#origin-label');
/** 汪星的狗：「鎖定」按鈕、點過可以鎖定的狗（10 秒沒按就收起來）、鎖定中的狗 */
const dogLockBtn = $<HTMLButtonElement>('#dog-lock-btn');
let dogOffer: string | null = null;
let dogLocked: string | null = null;
let dogOfferTimer = 0;
let dogFollow = 0;
const updatedLabel = $<HTMLButtonElement>('#updated-label');
const pollSelect = $<HTMLSelectElement>('#poll-select');

let pollSec = ((): number => {
  const v = Number(lsGet(LS_POLL) ?? 0);
  return POLL_CHOICES.includes(v) ? v : 0;
})();
let pollTimer = 0;

/** 自動更新：照選的間隔重抓；分頁在背景（切到別的分頁、手機鎖螢幕）時不抓，切回來時 visibilitychange 會補抓 */
function setPoll(sec: number): void {
  pollSec = POLL_CHOICES.includes(sec) ? sec : 0;
  lsSet(LS_POLL, pollSec ? String(pollSec) : null);
  pollSelect.value = String(pollSec);
  window.clearInterval(pollTimer);
  pollTimer = pollSec
    ? window.setInterval(() => {
        if (document.visibilityState === 'visible') void refresh();
      }, pollSec * 1000)
    : 0;
}
const modeBadge = $('#mode-badge');
const notifyBtn = $<HTMLButtonElement>('#notify-btn');
const viewBtn = $<HTMLButtonElement>('#view-btn');
const compassBtn = $<HTMLButtonElement>('#compass-btn');
const panelEl = $('#panel');
const appEl = $('#app');
const themeBtn = $<HTMLButtonElement>('#theme-btn');
const themeSheet = $('#theme-sheet');
const themeList = $<HTMLUListElement>('#theme-list');
const brandText = $('#brand-text');
const searchInput = $<HTMLInputElement>('#search-input');
const searchClear = $<HTMLButtonElement>('#search-clear');
const kwSheet = $('#kw-sheet');
const kwList = $('#kw-list');
const kwForm = $<HTMLFormElement>('#kw-form');
const kwInput = $<HTMLInputElement>('#kw-input');
const kwAddBtn = $<HTMLButtonElement>('#kw-add');
const kwMsg = $('#kw-msg');
const kwMaxEl = $('#kw-max');
const kwRulesEl = $('#kw-rules');
const kwTitle = $('#kw-title');
const kwIntro = $('#kw-intro');
const kwShareNote = $('#kw-share-note');
const locateBtn = $<HTMLButtonElement>('#locate-btn');
const reportBtn = $<HTMLButtonElement>('#report-btn');
const reportSheet = $('#report-sheet');
const reportForm = $<HTMLFormElement>('#report-form');
const reportInput = $<HTMLInputElement>('#report-input');
const reportSubmit = $<HTMLButtonElement>('#report-submit');
const reportPaste = $<HTMLButtonElement>('#report-paste');
const reportResult = $('#report-result');
const reportTips = $('#report-tips');
const myReportsEl = $('#my-reports');
const myReportList = $<HTMLUListElement>('#my-report-list');
const myReportsMore = $<HTMLButtonElement>('#my-reports-more');
const bottleBtn = $<HTMLButtonElement>('#bottle-btn');
const bottleBadge = $('#bottle-badge');
const bottleSheet = $('#bottle-sheet');
const feedbackSheet = $('#feedback-sheet');
const feedbackForm = $<HTMLFormElement>('#feedback-form');
const feedbackNote = $<HTMLTextAreaElement>('#feedback-note');
const feedbackSubmit = $<HTMLButtonElement>('#feedback-submit');
/** 正在回報問題的事件 */
let feedbackEventId: number | null = null;
const bottleText = $<HTMLTextAreaElement>('#bottle-text');
const bottleCount = $('#bottle-count');
/** 牛皮紙旁邊的空瓶子：點了就捲起來丟出去 */
const bottleDropEl = $('#bottle-drop');
const bottleResult = $('#bottle-result');
/** 打開收藏頁的信封上的小紅點（自己丟的瓶子被收藏了） */
/** 選單的「收藏」（v1.645 使用者說漂流瓶畫面裡的收藏按鈕改放到選單）：漂流瓶收藏、我丟的瓶子 */
const lettersBtn = $<HTMLButtonElement>('#letters-btn');
/** 選單上的小紅點：許願有新進度、自己丟的瓶子被收藏了；收進「⋯」時「⋯」也亮 */
const menuNews = { wish: false, letters: false };
function paintMenuNews(): void {
  $('#wishes-btn').classList.toggle('has-news', menuNews.wish);
  lettersBtn.classList.toggle('has-news', menuNews.letters);
  $('#more-btn').classList.toggle('has-news', menuNews.wish || menuNews.letters);
}
const lettersMine = $('#letters-mine');
const bottlePhotoFig = $('#bottle-photo');
const bottlePhotoBtn = $('#bottle-photo-btn');
const bottlePhotoInput = $<HTMLInputElement>('#bottle-photo-input');
/** 要放進瓶子的照片（瀏覽器縮小、重新存好的 JPEG data URL） */
let bottlePhotoData: string | null = null;
const lettersPage = $('#letters-page');
const lettersList = $('#letters-list');
const filterRow = $('#filter-row');
const catGroup = $('#cat-group');
const sortGroup = $('#sort-group');
const sortChips = Array.from(document.querySelectorAll<HTMLButtonElement>('#sort-group [data-sort]'));
/** 清單（和活動卡片的 ▲ ▼）怎麼排：time 照開始時間（分進行中、即將開始、稍後開始），distance 不分段、全部由近到遠；記在 localStorage */
const LS_SORT = 'dr.sort';
let sortBy: 'time' | 'distance' = lsGet(LS_SORT) === 'distance' ? 'distance' : 'time';
/** 換了排序：打開著的活動卡片的 ▲ ▼ 照新的順序（距離還是從打開卡片時的地方算） */
let stepResort = false;
function setSort(v: 'time' | 'distance'): void {
  sortBy = v;
  lsSet(LS_SORT, v);
  stepResort = true;
  render();
}
const categoryToggles = Array.from(document.querySelectorAll<HTMLButtonElement>('#filter-row [data-cat]'));
const activeToggle = $<HTMLButtonElement>('#active-toggle');
const onlyGroup = $('#only-group');
const timeChips = Array.from(document.querySelectorAll<HTMLButtonElement>('#time-chips [data-time]'));
const timeChipsEl = $('#time-chips');
const timeToggle = $('#time-toggle') as HTMLButtonElement;
const dateToggle = $<HTMLButtonElement>('#date-toggle');
const datePanel = $('#date-panel');
const baseChipsEl = $('#base-chips');
const baseChips = Array.from(document.querySelectorAll<HTMLButtonElement>('#base-chips [data-base]'));
let baseMap: BaseMap = (BASES as string[]).includes(lsGet(LS_BASE) ?? '') ? (lsGet(LS_BASE) as BaseMap) : 'nlsc';
/** 最近一次 GPS 的誤差（公尺），手動或預設位置時為 null */
let gpsAccuracy: number | null = null;
const scaleChips = Array.from(document.querySelectorAll<HTMLButtonElement>('#scale-chips [data-scale]'));
/** 範圍按鈕原本（地球）的字和說明：到汪星時換成汪星的（woofChips），回來換回去 */
const earthChips = new Map(scaleChips.map((b) => [b, { text: b.textContent ?? '', title: b.title }]));

const radar = new Radar(
  $('#radar-view'),
  select,
  (factor, done) => zoomRadar(factor, done, true),
  (id) => selectLandmark(id),
  (id) => selectBottle(id),
  (bearing, km, done) => panRadar(bearing, km, done),
);
// 點了車掃的中間點：打開那條車掃的時間表
radar.onRoute = (id) => selectRoute(id);
// 回報的位置直接在雷達上拖、點（v1.699 使用者說回報的定位直接用雷達的地圖，不用切到地圖）
radar.onPreviewDrag = (i, at) => {
  const p = destination(origin, at.bearing, at.distanceKm);
  if (markCard) placeMark(p);
  else void movePin(i, p);
};
radar.onEmptyTap = (at) => {
  if (markCard && !reportSheet.hidden) placeMark(destination(origin, at.bearing, at.distanceKm));
};
// 點了中山公園的銅像（地球或汪星）：發射口打開、升起火箭、關上，火箭停在那邊；點火箭問要不要飛到另一邊（rocketTrip）
// （火箭記得在哪一邊；不在這一邊、已經出來了就沒有反應）
// 火箭停在草皮上時再點銅像：收回井裡
radar.youOn = youOn;
radar.onStatue = (world) => {
  void import('./park').then((m) => {
    if (!m.summonRocket(world) && !m.stowRocket(world)) return;
    radar.redrawPark();
    window.setTimeout(() => radar.redrawPark(), Math.max(m.SUMMON_MS, m.STOW_MS) + 50);
  });
};
radar.onRocket = (world) => {
  void import('./park').then((m) => {
    if (m.rocketNow().phase !== 'parked' || !window.confirm(world === 'earth' ? '是否要到汪星球？' : '是否要回地球？')) return;
    void rocketTrip(m, world);
  });
};
// 點了汪星的狗：轉過來面向你坐下，左上角出現「鎖定」
radar.onDog = (id) => {
  void import('./park').then((m) => {
    parkMod = m;
    m.petDog(id);
    radar.redrawPark();
    offerDogLock(id);
  });
};
/** 尋找小法：在 3D 國館點到小法（雷達上點到不算）還沒有小法卡就拿一張，卡上寫在公園哪裡找到的（小法當時的位置） */
function foundDog(m: typeof import('./park'), id: string): void {
  const at = m.dogAt(id);
  void findCard(id, at ? m.parkPlaceName(at) : '中山公園', (msg) => showBanner(bannerEl, msg, 4000));
}
// 太陽系那幾層拖曳移開了視野、拉回地球：「地圖」按鈕跟著出現、消失；自己移動了就不再跟著狗
radar.onSpaceMove = () => {
  onWoofWalk();
  if (dogLocked || dogOffer) lockDog(null);
  updateViewBtn();
  saveSpaceView();
  updateScaleChips();
  // 從汪星的中山公園（可以放大到 1 公尺以內）回到地球：地球上不在中山公園附近就拉遠到雷達平常的最小範圍
  fitEarthZoom();
};
const map = new MapView(
  $('#map'),
  origin,
  {
    onSelect: select,
    onBottle: (id) => selectBottle(id),
    onLandmark: (id) => {
      if (id === 'hq') startHqVoyage();
    },
    onPreviewMove: (i, to) => (markCard ? placeMark(to) : void movePin(i, to)),
    onMapClick: (p) => {
      if (markCard && !reportSheet.hidden) placeMark(p);
    },
  },
  baseMap,
);

// ---- logic ----
function phaseOf(ev: EventOut, now: number): Phase {
  // 沒公布幾點的就當整天，當天都算進行中
  if (ev.allDay) return ev.startAt <= now && now < ev.endAt ? 'active' : 'later';
  if (ev.startAt <= now && now < ev.endAt) return 'active';
  if (ev.startAt > now && ev.startAt - now <= SOON_SEC) return 'soon';
  return 'later';
}

/** 同地點（150 m 內）、開始時間差 30 分鐘內的事件只留一筆 */
function dedupeEvents(list: EventOut[]): EventOut[] {
  const kept: EventOut[] = [];
  for (const ev of list) {
    const dup = kept.some((k) => Math.abs(k.startAt - ev.startAt) <= 1800 && haversineKm(k, ev) <= 0.15);
    if (!dup) kept.push(ev);
  }
  return kept;
}

const spotKey = (ev: EventOut): string => `${ev.post.id}|${ev.placeText}`;

/** 固定據點：目前開放中的時段，否則下一個時段 */
function spotItem(key: string, sessions: EventOut[], me: LatLng, now: number): Item {
  sessions.sort((a, b) => a.startAt - b.startAt);
  const ev = sessions.find((s) => s.startAt <= now && now < s.endAt) ?? sessions[0];
  const open = ev.startAt <= now && now < ev.endAt;
  // 沒公布幾點的據點當成整天開放，跟官方行程一樣不會嗶
  const phase: Phase = open ? 'active' : ev.startAt - now <= SPOT_SHOW_AHEAD_SEC ? 'closed' : 'later';
  return { ev, distanceKm: haversineKm(me, ev), bearing: bearingDeg(me, ev), phase, spot: { key, sessions } };
}

function computeItems(now: number): Item[] {
  const me: LatLng = { lat: origin.lat, lng: origin.lng };
  const items: Item[] = [];
  const spots = new Map<string, EventOut[]>();
  for (const ev of dedupeEvents(events)) {
    if (ev.endAt <= now) continue;
    if (ev.spot) {
      const k = spotKey(ev);
      spots.set(k, [...(spots.get(k) ?? []), ev]);
    } else {
      items.push({ ev, distanceKm: haversineKm(me, ev), bearing: bearingDeg(me, ev), phase: phaseOf(ev, now) });
    }
  }
  for (const [k, sessions] of spots) items.push(spotItem(k, sessions, me, now));
  // 車掃還沒出發時，路線上的點（整天顯示的加油點也一樣）都算還沒開始，跟清單上的車掃卡片一致
  for (const it of items) {
    const r = routeOf(it.ev);
    if (r && routeState(r, now) === 'planned') it.phase = routePhase(r, [], now);
  }
  return items
    // 進行中的照距離排；還沒開始的照開始時間排，同時間再照距離
    .sort((a, b) => {
      if (a.phase === 'active' && b.phase === 'active') return a.distanceKm - b.distanceKm;
      if (a.phase === 'active') return -1;
      if (b.phase === 'active') return 1;
      return a.ev.startAt - b.ev.startAt || a.distanceKm - b.distanceKm;
    });
}

const dateFmt = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short' });

const taipeiDay = (unix: number): number => Math.floor((unix + 8 * 3600) / 86400);

function dayWord(unix: number, now: number): string {
  const d = taipeiDay(unix) - taipeiDay(now);
  return d === 0 ? '今天' : d === 1 ? '明天' : dateFmt.format(new Date(unix * 1000));
}

/** 國外活動用當地時間顯示：時區不同的格式化器各存一個 */
const tzFmts = new Map<string, { time: Intl.DateTimeFormat; date: Intl.DateTimeFormat }>();
function fmtsFor(tz: string): { time: Intl.DateTimeFormat; date: Intl.DateTimeFormat } {
  let f = tzFmts.get(tz);
  if (!f) {
    f = {
      time: new Intl.DateTimeFormat('zh-TW', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }),
      date: new Intl.DateTimeFormat('zh-TW', { timeZone: tz, month: 'numeric', day: 'numeric', weekday: 'short' }),
    };
    tzFmts.set(tz, f);
  }
  return f;
}
/** 國外活動的當地時區；台灣的是 null */
const localTz = (ev: { tz?: string | null }): string | null => (ev.tz && ev.tz !== 'Asia/Taipei' ? ev.tz : null);
const fmtTimeTz = (unix: number, tz: string | null): string => (tz ? fmtsFor(tz).time.format(new Date(unix * 1000)) : fmtTime(unix));
const fmtDateTz = (unix: number, tz: string | null): string => (tz ? fmtsFor(tz).date.format(new Date(unix * 1000)) : dateFmt.format(new Date(unix * 1000)));

/** 詳細資料的時間（單次的）：國外的寫當地日期時間，後面附台灣時間 */
function eventTimeText(ev: EventOut): string {
  const rs = reportedStop(ev);
  if (rs?.at) {
    const day = dateFmt.format(new Date(rs.at * 1000));
    return rs.kind === 'start' ? `${day} ${fmtTime(rs.at)} 從這裡出發` : `${day} 約 ${fmtTime(rs.at)} 車隊${rs.kind === 'end' ? '抵達' : '經過'}`;
  }
  const tz = localTz(ev);
  const span = (z: string | null): string => (ev.endOpen ? `${fmtTimeTz(ev.startAt, z)} 開始` : `${fmtTimeTz(ev.startAt, z)} – ${fmtTimeTz(ev.endAt, z)}`);
  const open = ev.endOpen && openEndText(ev) ? `，${openEndText(ev)}` : '';
  // 不是今天的寫日期和星期幾
  if (!tz) return `${taipeiDay(ev.startAt) === taipeiDay(nowSec()) ? '' : `${dateFmt.format(new Date(ev.startAt * 1000))} `}${span(null)}${open}`;
  return `${fmtDateTz(ev.startAt, tz)} ${span(tz)}${open}（當地時間；台灣時間 ${fmtDateTz(ev.startAt, null)} ${span(null)}）`;
}

/**
 * 貼文沒寫結束時間時的說法。發放寫「發完為止」；
 * 洋流的單場活動不一定是發東西，不寫發完為止，寫雷達先估到幾點（從開始排兩小時）；不知道排到幾點的（好幾個時段一起寫）什麼都不寫
 */
const openEndText = (ev: { kind: EventOut['kind']; spot?: boolean; endAt?: number; tz?: string | null }): string =>
  // 臨打、擺攤的每週固定場沒寫到哪天：長期開放；單場沒寫幾點結束
  ev.kind === 'session' || ev.kind === 'food'
    ? ev.spot
      ? '長期開放'
      : '沒寫結束時間'
    : ev.kind === 'activity'
      ? ev.spot
        ? '長期開放'
        : ev.endAt
          ? `沒寫結束時間，預估到 ${fmtTimeTz(ev.endAt, localTz(ev))}`
          : ''
      : '發完為止';
/** 「，發完為止」；活動沒有說法就不加 */
const openEndTail = (ev: { kind: EventOut['kind']; spot?: boolean; endAt?: number; tz?: string | null }): string => (openEndText(ev) ? `，${openEndText(ev)}` : '');

/** 每週幾：[2, 4] →「每週二、四」，沒有就是 null */
function weeklyText(days: number[] | null | undefined): string | null {
  if (!days?.length) return null;
  const name = (d: number): string => '一二三四五六日'[d - 1];
  // 只休一天：「每天（週一公休）」比列出六天好讀
  if (days.length === 6) return `每天（週${name([1, 2, 3, 4, 5, 6, 7].find((d) => !days.includes(d)) as number)}公休）`;
  // 連續三天以上：「每週一到五」
  if (days.length >= 3 && days[days.length - 1] - days[0] === days.length - 1) return `每週${name(days[0])}到${name(days[days.length - 1])}`;
  return `每週${days.map(name).join('、')}`;
}

/** 固定據點的開放時段，例如「每天 11:00–18:00」「每週二、四 14:00–18:00」「每天 11:00–14:00、17:00–19:00」；沒寫幾點結束就只寫開始 */
function spotHours(sessions: EventOut[]): string {
  // 時段的星期幾不一樣（「週一到六 08:30–12:00；週一到五 18:30–21:00」）：照星期幾分開寫
  const key = (s: EventOut): string => (s.weekdays ?? []).join(',');
  const keys = [...new Set(sessions.map(key))];
  if (keys.length > 1 && !sessions.some((s) => s.allDay)) {
    const tod = (s: EventOut): number => (s.startAt + 8 * 3600) % 86400;
    return keys
      .map((k) => sessions.filter((s) => key(s) === k))
      .sort((a, b) => Math.min(...a.map(tod)) - Math.min(...b.map(tod)))
      .map((group) => {
        const text = spotHours(group.map((s) => ({ ...s, untilOpen: true })));
        return group[0].weekdays?.length ? text : text.startsWith('每天') ? text : `每天 ${text}`;
      })
      .join('；');
  }
  const weekly = weeklyText(sessions[0]?.weekdays);
  if (sessions.some((s) => s.allDay)) return weekly ? `${weekly}整天` : new Set(sessions.map((s) => taipeiDay(s.startAt))).size > 1 ? '每天整天' : '整天';
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const s of [...sessions].sort((a, b) => ((a.startAt + 8 * 3600) % 86400) - ((b.startAt + 8 * 3600) % 86400))) {
    const text = s.endOpen ? `${fmtTime(s.startAt)} 開始` : `${fmtTime(s.startAt)}–${fmtTime(s.endAt)}`;
    if (!seen.has(text)) parts.push(text);
    seen.add(text);
  }
  // 只有一天的據點不寫「每天」
  const days = new Set(sessions.map((s) => taipeiDay(s.startAt)));
  if (weekly) return `${weekly} ${parts.join('、')}`;
  return `${days.size > 1 || sessions.some((s) => s.untilOpen) ? '每天 ' : ''}${parts.join('、')}`;
}

function spotUntil(it: Item, now: number): string {
  const last = it.spot?.sessions.at(-1);
  if (!last) return '';
  if (last.untilOpen) return openEndText(last);
  return taipeiDay(last.startAt) === taipeiDay(now) ? '今天最後一天' : `到 ${dateFmt.format(new Date(last.startAt * 1000))}`;
}

function spotLine(it: Item, now: number): string {
  const { ev } = it;
  const until = spotUntil(it, now);
  if (ev.startAt <= now && now < ev.endAt) {
    if (ev.allDay) return `開放中・${until}`;
    // 沒寫幾點結束：不寫「今天到幾點」，寫「發完為止」（活動是「長期開放」）
    if (ev.endOpen) return `營業中・${openEndText(ev)}${until === openEndText(ev) ? '' : `・${until}`}`;
    return `營業中・今天到 ${fmtTime(ev.endAt)}・${until}`;
  }
  const next = ev.allDay ? `${dayWord(ev.startAt, now)}開放` : `${dayWord(ev.startAt, now)} ${fmtTime(ev.startAt)} 開始`;
  // 第一個時段還沒到：是還沒開始，不是休息中
  const notYet = (ev.firstStartAt ?? Math.min(...(it.spot?.sessions ?? [ev]).map((x) => x.startAt))) > now;
  return `${notYet ? '還沒開始' : '休息中'}・${next}・${until}`;
}

/** 沒有開始時間的：整天，或知道最晚到幾點（例如加油點到車隊經過為止） */
function allDayText(ev: EventOut, today: boolean): string {
  if (ev.endAt - ev.startAt >= 86400 - 60) return today ? '今天整天' : '整天';
  return `${today ? '今天' : '整天，'}到 ${fmtTime(ev.endAt)}`;
}

function timeLine(it: Item, now: number): string {
  // 職缺：工作期間、每天時段（從刊登起都算刊登中）；可照顧的沒寫期間就是時間可討論
  if (isSeek(it.ev)) return seekWhen(it.ev);
  const fr = foodRole(it.ev);
  if (fr === 'meetup') return seekWhen(it.ev);
  if (fr === 'recommend') return `網友推薦${foodOf(it.ev).hours ? `・營業 ${foodOf(it.ev).hours}` : ''}`;
  if (it.ev.kind === 'job') {
    const period = jobPeriod(jobOf(it.ev));
    return isOffer(it.ev) ? `${jobWords().offer} ${period === '沒寫工作期間' ? '時間可討論' : period}` : `工作 ${period}`;
  }
  if (it.spot) return spotLine(it, now);
  const { ev } = it;
  // 回報的車掃的一站：寫車隊預計幾點經過（雷達上從前 10 分鐘顯示到經過後 15 分鐘）
  const rs = reportedStop(ev);
  if (rs?.at) {
    // 起點寫「出發」、終點寫「抵達」、中間的站寫「經過」
    const verb = rs.kind === 'start' ? '出發' : rs.kind === 'end' ? '抵達' : '經過';
    if (it.phase === 'active') {
      if (rs.kind === 'start') return now < rs.at ? `${fmtTime(rs.at)} 從這裡出發 · 快出發了` : `${fmtTime(rs.at)} 從這裡出發 · 可能剛出發`;
      return `車隊預計 ${fmtTime(rs.at)} ${verb} · ${now < rs.at ? '快到了' : `可能剛${verb}`}`;
    }
    const day = taipeiDay(rs.at) === taipeiDay(now) ? '' : `${dateFmt.format(new Date(rs.at * 1000))} `;
    return `${day}${rs.kind === 'start' ? '' : '約 '}${fmtTime(rs.at)} ${verb} · ${startsIn(rs.at, now)}`;
  }
  if (ev.allDay) {
    const today = ev.startAt <= now && now < ev.endAt;
    const stop = stopOf(ev);
    if (today && stop?.kind === 'cheer' && stop.at) return now < stop.at ? `${it.phase === 'active' ? '進行中 · ' : ''}車隊預計 ${fmtTime(stop.at)} 經過` : `車隊預計 ${fmtTime(stop.at)} 已經過`;
    if (today) return `進行中 · ${allDayText(ev, true)}`;
    return `${dateFmt.format(new Date(ev.startAt * 1000))} ${allDayText(ev, false)}${ev.startAt > now ? ` · ${startsIn(ev.startAt, now)}` : ''}`;
  }
  if (it.phase === 'active') {
    // 活動沒寫結束：只寫進行中
    if (ev.endOpen) return openEndText(ev) ? `進行中 · ${openEndText(ev)}` : '進行中';
    const left = Math.max(0, Math.round((ev.endAt - now) / 60));
    return `進行中 · 約 ${left} 分鐘後結束`;
  }
  // 國外的：一律寫當地日期（台灣的「今天」不一定是當地的今天）
  const tz = localTz(ev);
  if (tz) return `當地 ${fmtDateTz(ev.startAt, tz)} ${fmtTimeTz(ev.startAt, tz)} 開始 · ${startsIn(ev.startAt, now)}`;
  // 不是今天開始的寫日期和星期幾（v1.613 使用者說卡片不是今天的也在時間旁邊寫星期幾；以前 24 小時內的連日期都不寫）
  const day = taipeiDay(ev.startAt) === taipeiDay(now) ? '' : `${dateFmt.format(new Date(ev.startAt * 1000))} `;
  return `${day}${fmtTime(ev.startAt)} 開始 · ${startsIn(ev.startAt, now)}`;
}

/** 還有多久開始：「還有 25 分鐘」「還有 5 小時 20 分」「還有 2 天 3 小時」 */
function startsIn(startAt: number, now: number): string {
  const mins = Math.max(0, Math.round((startAt - now) / 60));
  if (mins < 60) return `還有 ${mins} 分鐘`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `還有 ${h} 小時${mins % 60 ? ` ${mins % 60} 分` : ''}`;
  return `還有 ${Math.floor(h / 24)} 天${h % 24 ? ` ${h % 24} 小時` : ''}`;
}

/** 雷達光點下方的短版：「25分」「5小時」「2天(六)」；不是今天開始的後面寫星期幾（v1.612 使用者說的，今天的不寫） */
function startsInShort(startAt: number, now: number): string {
  const mins = Math.max(0, Math.round((startAt - now) / 60));
  const h = Math.floor(mins / 60);
  const left = mins < 60 ? `${mins}分` : h < 24 ? `${h}小時` : `${Math.floor(h / 24)}天`;
  return taipeiDay(startAt) === taipeiDay(now) ? left : `${left}(${WEEKDAYS[new Date((startAt + 8 * 3600) * 1000).getUTCDay()]})`;
}
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 離開始越近越清楚：快開始是 1，到時間範圍的盡頭是 0（「全部」算一週；取對數，近的差別看得出來） */
const FADE_FULL_SEC = 7 * 24 * 3600;
function clarityOf(ev: EventOut, now: number): number {
  const span = Math.min(TIME_SEC[timeSetting], FADE_FULL_SEC);
  if (span <= 0) return 1;
  const t = Math.max(0, ev.startAt - now);
  return 1 - Math.min(1, Math.log1p(t / 600) / Math.log1p(span / 600));
}

/** 還沒開始的單次發放、活動（即將開始、稍後開始），回報的車掃的每一站也算；固定據點、官方車掃路線另外處理 */
const isUpcoming = (it: Item): boolean => {
  if (it.spot || it.phase === 'active') return false;
  const r = routeOf(it.ev);
  return !r || isReported(r);
};

/** 在不在時間範圍內：進行中（開放中、車掃中）的一定在；其他看多久後開始（車掃看出發時間，據點看下一個時段） */
function inTime(it: Item, now: number): boolean {
  if (it.phase === 'active') return true;
  const r = routeOf(it.ev);
  if (r && routeState(r, now) !== 'planned') return true;
  return (r?.departAt ?? it.ev.startAt) - now <= TIME_SEC[timeSetting];
}

/** 清單最下面放時間範圍外的那一段的標題 */
const laterLabel = (): string => (timeSetting === 'now' ? '還沒開始、休息中' : `${{ '3h': '3 小時', '24h': '24 小時', '3d': '3 天' }[timeSetting as '3h' | '24h' | '3d']}以後才開始`);

// ---- 雷達範圍 ----
/** 在不在雷達範圍內：距離在範圍內（「全球」都算） */
const inScope = (distanceKm: number): boolean => distanceKm <= scaleKm;

let outlineFor = '';
let radarOutline: Array<Array<{ bearing: number; distanceKm: number }>> = [];

/** 範圍比 16 km 大時畫的海岸線：台灣用詳細的，加上全世界的（約 30 KB，第一次用到才載入；世界資料裡的台灣只有幾個點，換掉） */
let landRings: Array<Array<[number, number]>> = TAIWAN_RINGS;
/** 縣市在陸地上的交界（counties.ts，跟世界海岸線一起載入），範圍 1000 km 內才畫（「全球」時台灣只剩幾個像素） */
let countyLines: Array<Array<[number, number]>> = [];
const COUNTY_MAX_KM = 1000;
let worldLoaded = false;
let worldLoading = false;
const inTaiwanBox = (ring: Array<[number, number]>): boolean => ring.every(([lat, lng]) => lat > 21 && lat < 26.5 && lng > 118 && lng < 123);
/** 世界的海岸線（world.ts，台灣那一塊換成 taiwan.ts）；雷達上東亞那一塊再換成 eastasia.ts 的 */
let worldRings: Array<Array<[number, number]>> = [];

/*
 * 東亞（eastasia.ts，v1.642 使用者說日本、韓國也要修正，中國那邊不管放大到多近都不要顯示細節、最多畫到虛線）：
 * 雷達附近碰到東亞那一塊才載入（約 40 KB）。拉遠時日本、韓國、中國沿海用 1:10m 的海岸線；
 * 中國的範圍裡不畫路、不畫近距離的實線海岸，近距離（16 km 內）也畫虛線海岸
 */
let eaMod: typeof import('./eastasia') | null = null;
let eaLoading = false;
function loadEastAsia(): void {
  if (eaMod || eaLoading) return;
  eaLoading = true;
  void import('./eastasia')
    .then((m) => {
      eaMod = m;
      outlineFor = '';
      streetsFor = '';
      updateOutline();
      updateStreets();
    })
    .finally(() => {
      eaLoading = false;
    });
}
/** 東亞那一塊（跟 eastasia.ts 的 EA_BOX 一樣；這裡先寫一份，載入前就判斷得了） */
const EA_AREA = { s: 18, w: 108, n: 46, e: 146 };
/** 雷達附近（正中間方圓 km）碰不碰到東亞那一塊 */
function touchesEastAsia(km: number): boolean {
  const dLat = km / 111;
  const dLng = km / (111 * Math.max(0.1, Math.cos((origin.lat * Math.PI) / 180)));
  return km >= 2500 || !(origin.lat + dLat < EA_AREA.s || origin.lat - dLat > EA_AREA.n || origin.lng + dLng < EA_AREA.w || origin.lng - dLng > EA_AREA.e);
}
/** 在台灣本島（含綠島、蘭嶼） */
const onTaiwanMain = (p: LatLng): boolean => p.lat > 21.8 && p.lat < 25.4 && p.lng > 120.0 && p.lng < 122.1;
/**
 * 雷達附近 km 公里內可能碰到中國：不在台灣本島的，或範圍往西過東經 120 度、往北過北緯 25.9 度
 * （照 eastasia.ts 的中國範圍量的：東經 120 度以東的最南到北緯 26.58 度，北緯 25.9 度以南的最東到東經 119.91 度）。
 * v1.708：以前在台灣本島就當作碰不到，全螢幕拉遠時角落的綠地塗到福建
 */
function mayTouchChina(km: number): boolean {
  if (!touchesEastAsia(km)) return false;
  if (!onTaiwanMain(origin)) return true;
  const dLat = km / 111;
  const dLng = km / (111 * Math.cos((origin.lat * Math.PI) / 180));
  return origin.lng - dLng < 120.0 || origin.lat + dLat > 25.9;
}

// ---- 道路：600 km 內都畫（台灣哪裡選「全台」都在這裡面；streets.ts，OpenFreeMap 的向量圖磚，第一次用到才載入；範圍越大畫的路越少） ----
const ROADS_KM = 600;
let streetsMod: typeof import('./streets') | null = null;
let streetsLoading = false;
/** 上次畫的位置、範圍、抓到第幾張圖磚，沒變就不重算 */
let streetsFor = '';
let streetTiles = 0;
/**
 * 道路換成公里數時的原點（錨點）：拖曳時正中間離它不到範圍的 1/4 就不重算，只告訴雷達位移了多少
 * （streetLoose：換算時多留了外面一圈，拖曳中才這樣）
 */
let streetAnchor: LatLng | null = null;
let streetLines: RadarStreets | null = null;
let streetLoose = false;
/** 拖曳開始時的位置（拖曳中才有，panRadar） */

/**
 * 比這個範圍大，雷達就畫海岸線、縣市界的虛線（道路照畫），台灣哪裡都一樣。
 * v1.639 從 50 km 改成 16 km（使用者要檢查澎湖：澎湖的路都標次要道路，16～50 km 只畫幹道，整片空白；16 km 內大街小巷都畫）
 */
const OUTLINE_KM = 16;
/** 地圖照舊比 50 km 大才畫海岸線（底圖本來就看得到海岸） */
const MAP_OUTLINE_KM = 50;
/** 換算時太遠的點換成這個（線在這裡斷開，不會跨過去接起來） */
const FAR_POINT = { bearing: 0, distanceKm: 1e9 };

/** streets.ts 第一次用到才載入：載好了重畫雷達的道路和汪星的街道 */
function loadStreets(): void {
  if (streetsMod || streetsLoading) return;
  streetsLoading = true;
  void import('./streets')
    .then((m) => {
      streetsMod = m;
      updateStreets();
      radar.redrawSpace();
    })
    .finally(() => {
      streetsLoading = false;
    });
}

// 全螢幕鋪滿時看得到的範圍變了（換方向、改視窗大小）：道路抓到畫面的角
radar.onView = () => updateStreets();
radar.setScaleBar($('#scale-bar'));
radar.setCompass($('#mini-compass'));
const woofStreets: import('./space').WoofStreets = (lat, lng, km, rangeKm) => {
  if (!streetsMod) {
    loadStreets();
    return null;
  }
  return streetsMod.streetTiles(lat, lng, km, rangeKm, () => radar.redrawSpace());
};

/** 範圍內的道路換成相對於圓心的公里數（範圍不大，用平面近似就夠準，拖曳時每一幀都要算） */
function updateStreets(): void {
  // 再大的只畫海岸線的虛線
  const show = scaleKm <= ROADS_KM && !radar.spaceFocused;
  // 中山公園拉近（外圈約 1.8 km 內畫樹冠、屋頂）：地球上公園在附近、汪星上，註明樹冠、屋頂、橋寬是照國土測繪中心的正射影像判讀的
  const trees = scaleKm <= PARK_TREES_KM && (radar.spaceFocused ? radar.spaceFocusKey === 'woof' : haversineKm(origin, PARK_NEAR) < scaleKm * 1.5 + 0.5);
  $('#radar-attrib').hidden = !show && !trees;
  $('#street-attrib').hidden = !show;
  $('#tree-attrib').hidden = !trees;
  $('#park3d-btn').hidden = !trees;
  if (!show) {
    if (streetsFor) radar.setStreets(null);
    streetsFor = '';
    streetLines = null;
    return;
  }
  if (!streetsMod) {
    loadStreets();
    return;
  }
  // 全螢幕鋪滿時抓到畫面的角（radar.reach 是範圍的幾倍，平常是 1）
  const reach = scaleKm * radar.reach * 1.05;
  // 中國的範圍裡不畫路、不畫實線海岸、不塗綠地（v1.642）：可能碰到中國的，等東亞的資料載入才畫（不要先閃一下）；
  // 在台灣本島拉遠時先載入，拉到碰得到的時候才不會整片空白一下
  const mayChina = mayTouchChina(reach * 1.25);
  if (!eaMod && mayTouchChina(reach * 2.5)) loadEastAsia();
  if (mayChina && !eaMod) {
    loadEastAsia();
    if (streetsFor) radar.setStreets(null);
    streetsFor = '';
    streetLines = null;
    return;
  }
  const mask = mayChina ? eaMod!.chinaMask : null;
  /** 一條線的中間那一點在中國的範圍裡 */
  const hidden = (pts: Float64Array): boolean => {
    if (!mask) return false;
    const m = Math.floor(pts.length / 4) * 2;
    return mask.contains(pts[m], pts[m + 1]);
  };
  const ky = 110.574;
  // 拖曳中：範圍、圖磚沒變，正中間離錨點不到範圍的 1/4（換算時多留的那一圈）就只給位移
  const key = `${scaleKm}|${streetTiles}|${radar.reach.toFixed(2)}|${!!mask}|${hqVoyageAt !== null}|${radar.filling}`;
  if (streetLines && streetAnchor && streetsFor === key) {
    if (!panFrom && origin.lat === streetAnchor.lat && origin.lng === streetAnchor.lng) return;
    if (panFrom && streetLoose) {
      const kx = 111.32 * Math.cos((streetAnchor.lat * Math.PI) / 180);
      const shift: [number, number] = [(origin.lng - streetAnchor.lng) * kx, (origin.lat - streetAnchor.lat) * ky];
      if (Math.hypot(...shift) <= reach / 4) {
        radar.setStreets(streetLines, shift, true);
        return;
      }
    }
  }
  streetsFor = key;
  streetAnchor = { lat: origin.lat, lng: origin.lng };
  // 拖曳中多換算外面一圈，接下來拖一點都不用重算
  streetLoose = !!panFrom;
  const get = streetLoose ? reach * 1.25 : reach;
  // 16 km 內多拿圖磚裡的海岸線（v1.640 使用者說「不管放大到什麼程度都要有邊界」；再大用 updateOutline 的海岸線）
  const { lines, coast, roads, stations, green } = streetsMod.streetTiles(origin.lat, origin.lng, get, scaleKm, () => {
    streetTiles++;
    updateStreets();
  });
  const kx = 111.32 * Math.cos((origin.lat * Math.PI) / 180);
  const box = [origin.lat - get / ky, origin.lng - get / kx, origin.lat + get / ky, origin.lng + get / kx];
  const coastXy: Float64Array[] = [];
  const out: RadarStreets = { major: [], minor: [], coast: coastXy };
  const toXy = (l: { pts: Float64Array; box: [number, number, number, number] }): Float64Array | null => {
    if (l.box[0] > box[2] || l.box[2] < box[0] || l.box[1] > box[3] || l.box[3] < box[1]) return null;
    const xy = new Float64Array(l.pts.length);
    for (let i = 0; i < l.pts.length; i += 2) {
      xy[i] = (l.pts[i + 1] - origin.lng) * kx;
      xy[i + 1] = (l.pts[i] - origin.lat) * ky;
    }
    return xy;
  };
  for (const l of lines) {
    const xy = hidden(l.pts) ? null : toXy(l);
    if (xy) out[l.cls].push(xy);
  }
  for (const l of coast) {
    const xy = hidden(l.pts) ? null : toXy(l);
    if (xy) coastXy.push(xy);
  }
  // 公園綠地塗淡綠：只有全螢幕（v1.705 使用者說的），洋流總部特效播放時不塗（特效自己會把台北染淡綠）；
  // 2 km 內再加自己整理的公園外框（v1.706：圖磚不收太小的，例如通化公園），這時才載入
  const parkShapes = radar.filling && hqVoyageAt === null && scaleKm <= 2 ? parkAreas() : [];
  if (radar.filling && hqVoyageAt === null && green.length + parkShapes.length > 0) {
    out.green = [];
    for (const a of [...green, ...parkShapes]) {
      if (a.box[0] > box[2] || a.box[2] < box[0] || a.box[1] > box[3] || a.box[3] < box[1]) continue;
      if (mask && mask.contains(a.rings[0][0], a.rings[0][1])) continue;
      out.green.push(
        a.rings.map((r) => {
          const xy = new Float64Array(r.length);
          for (let i = 0; i < r.length; i += 2) {
            xy[i] = (r[i + 1] - origin.lng) * kx;
            xy[i + 1] = (r[i] - origin.lat) * ky;
          }
          return xy;
        }),
      );
    }
  }
  out.labels = placeLabels(streetsMod, roads, stations, get, kx, ky, mask);
  // 畫了樹冠、屋頂的中山公園上面不寫名稱（v1.698：大巨蛋的名字被擠到公園上）
  if (out.labels.length > 0 && trees && parkMod) {
    const [s0, w0, n0, e0] = parkMod.PARK_BOX;
    out.noLabel = [[(w0 - origin.lng) * kx, (s0 - origin.lat) * ky, (e0 - origin.lng) * kx, (n0 - origin.lat) * ky]];
  }
  streetLines = out;
  radar.setStreets(out, [0, 0], streetLoose);
}

/**
 * 雷達上寫的地名（v1.691 使用者說適度放縣市、區、路、地標，但畫面不要太亂）：照範圍分層，由重要到不重要、同樣重要的離正中間近的先，
 * 雷達那邊放不下（重疊、壓到光點）的不寫、一個畫面最多十幾個。
 * 33 km 以上縣市；1～33 km 鄉鎮市區；5 km 內加國道、快速道路的名字，2 km 內加幹道，1 km 內大街小巷的路名和捷運、火車站（不寫鄉鎮市區）；
 * 地標（v1.698 使用者說拉近可以放大巨蛋、公園等）：5 km 內寫大的（體育場、遊樂園、市政府、大公園），2 km 內都寫（pois-tw.ts，這時才載入）；
 * 一般的公園（沒有 Wikidata）1 km 內都寫、2 km 內寫 1 公頃以上的（v1.701）。
 * 只有全螢幕寫（v1.692 使用者說一般的雷達不用顯示）；中國的範圍不寫（跟道路一樣）；洋流總部的特效播放時不寫
 */
/**
 * 公園外框（parks-tw.ts，壓縮後約 180 KB）：全螢幕拉近到 2 km 內才載入，載入好解開 polyline、算外框，重畫道路。
 * 還沒載入回傳空的
 */
let parkShapesMod: Array<{ rings: Float64Array[]; box: [number, number, number, number] }> | null = null;
let parkShapesLoading = false;
function parkAreas(): Array<{ rings: Float64Array[]; box: [number, number, number, number] }> {
  if (parkShapesMod) return parkShapesMod;
  if (!parkShapesLoading) {
    parkShapesLoading = true;
    void import('./parks-tw')
      .then((m) => {
        parkShapesMod = m.TW_PARK_SHAPES.map((rings) => {
          const rs = rings.map(decodePolyline);
          // 方向跟圖磚的綠地一樣：外圈在地圖上順時針、挖空的逆時針（雷達用 nonzero 填色，反了的話跟圖磚重疊的地方會變成洞）
          rs.forEach((r, i) => {
            if (streetsMod!.ringArea(r) > 0 === (i === 0)) reversePairs(r);
          });
          let [s0, w0, n0, e0] = [Infinity, Infinity, -Infinity, -Infinity];
          const o = rs[0];
          for (let i = 0; i < o.length; i += 2) {
            s0 = Math.min(s0, o[i]);
            n0 = Math.max(n0, o[i]);
            w0 = Math.min(w0, o[i + 1]);
            e0 = Math.max(e0, o[i + 1]);
          }
          return { rings: rs, box: [s0, w0, n0, e0] as [number, number, number, number] };
        });
        streetsFor = '';
        updateStreets();
      })
      .catch(() => {
        parkShapesLoading = false;
      });
  }
  return [];
}

/** [緯度, 經度, …] 前後倒過來（一圈換方向） */
function reversePairs(r: Float64Array): void {
  for (let i = 0, j = r.length - 2; i < j; i += 2, j -= 2) {
    [r[i], r[j]] = [r[j], r[i]];
    [r[i + 1], r[j + 1]] = [r[j + 1], r[i + 1]];
  }
}

/** Google polyline（精度小數 5 位）→ [緯度, 經度, …] */
function decodePolyline(str: string): Float64Array {
  const out: number[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0;
      let result = 0;
      let b: number;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d;
      else lng += d;
    }
    out.push(lat / 1e5, lng / 1e5);
  }
  return Float64Array.from(out);
}

/** 地標（pois-tw.ts，約 100 KB）：全螢幕拉近到 5 km 內才載入，載入好重畫道路和名稱 */
let poisMod: typeof import('./pois-tw') | null = null;
let poisLoading = false;
function loadPois(): void {
  if (poisMod || poisLoading) return;
  poisLoading = true;
  void import('./pois-tw')
    .then((m) => {
      poisMod = m;
      streetsFor = '';
      updateStreets();
    })
    .catch(() => {
      poisLoading = false;
    });
}

function placeLabels(
  sm: typeof import('./streets'),
  roads: import('./streets').RoadName[],
  stations: import('./streets').StationName[],
  get: number,
  kx: number,
  ky: number,
  mask: { contains: (lat: number, lng: number) => boolean } | null,
): RadarLabel[] {
  if (hqVoyageAt !== null || !radar.filling) return [];
  const km = scaleKm;
  const out: Array<RadarLabel & { pri: number; d: number }> = [];
  const add = (lat: number, lng: number, text: string, kind: RadarLabel['kind'], pri: number): void => {
    if (mask?.contains(lat, lng)) return;
    const x = (lng - origin.lng) * kx;
    const y = (lat - origin.lat) * ky;
    if (Math.abs(x) > get || Math.abs(y) > get) return;
    out.push({ x, y, text, kind, pri, d: Math.hypot(x, y) });
  };
  if (km > 33) for (const [n, lat, lng] of sm.TW_COUNTIES) add(lat, lng, n, 'county', 100);
  else if (km > 1) for (const [n, lat, lng] of sm.TW_TOWNS) add(lat, lng, n, 'town', 90);
  if (km <= 5) {
    const pri: Record<string, number> = { motorway: 70, trunk: 68, primary: 62, secondary: 58, tertiary: 50, minor: 40 };
    const ok = (cls: string): boolean => (km > 2 ? cls === 'motorway' || cls === 'trunk' : km > 1 ? cls !== 'tertiary' && cls !== 'minor' : true);
    // 同名的路只寫一次：寫在離正中間最近的那一點
    const best = new Map<string, { lat: number; lng: number; d: number; cls: string }>();
    for (const r of roads) {
      if (!ok(r.cls)) continue;
      for (let i = 0; i < r.pts.length; i += 2) {
        const d = Math.hypot((r.pts[i + 1] - origin.lng) * kx, (r.pts[i] - origin.lat) * ky);
        const b = best.get(r.name);
        if (!b || d < b.d) best.set(r.name, { lat: r.pts[i], lng: r.pts[i + 1], d, cls: r.cls });
      }
    }
    for (const [name, b] of best) add(b.lat, b.lng, name, 'road', pri[b.cls] ?? 40);
  }
  if (km <= 5) {
    if (!poisMod) loadPois();
    else {
      for (const [name, lat, lng, kind, ha] of poisMod.TW_POIS) {
        // 沒有 Wikidata 的公園（萬芳四號公園這種，v1.701）：1 km 內都寫、2 km 內寫 1 公頃以上的、再遠只寫很大的；排在大部分路名後面
        if (kind === 'lpark') {
          if (km > 2 ? ha < 20 : km > 1 ? ha < 1 : false) continue;
          add(lat, lng, name, 'poi', ha >= 10 ? 66 : ha >= 2 ? 55 : km > 1 ? 50 : 45);
          continue;
        }
        const big = kind === 'stadium' || kind === 'fun' || kind === 'gov' || ha >= 10;
        if (km > 2 && !big && ha < 20) continue;
        // 圖書館的分館（「三興分館」）單獨寫看不懂、又很多：排後面
        const branch = /(分館|圖書館|閱覽室)$/.test(name);
        add(lat, lng, name, 'poi', big ? 70 : branch ? 48 : ha >= 1 || kind === 'culture' || kind === 'school' ? 60 : 52);
      }
    }
  }
  if (km <= 1) {
    // 同一站常有好幾筆（捷運、台鐵，「台北」「臺北車站」，大站的幾筆可以離好幾百公尺）：800 m 內名字一樣的只寫一次，名字補上「站」
    const base = (n: string): string => n.replace(/台/g, '臺').replace(/(車站|站)$/, '');
    const seen: Array<{ base: string; lat: number; lng: number }> = [];
    for (const st of stations) {
      const b = base(st.name);
      if (seen.some((x) => x.base === b && haversineKm(x, st) < 0.8)) continue;
      seen.push({ base: b, lat: st.lat, lng: st.lng });
      add(st.lat, st.lng, /站$/.test(st.name) ? st.name : `${st.name}站`, 'station', 75);
    }
  }
  out.sort((a, b) => b.pri - a.pri || a.d - b.d);
  return out.slice(0, 80).map(({ x, y, text, kind }) => ({ x, y, text, kind }));
}

// ---- 中山公園（park.ts，跟汪星共用一份）：地球的雷達上第一次在公園附近才載入 ----
let parkMod: typeof import('./park') | null = null;
let parkLoading = false;
/** 中山公園大約在哪裡：只用來決定要不要載入 park.ts（畫的位置、範圍、可以放大到多近都在 park.ts） */
const PARK_NEAR = { lat: 25.0395, lng: 121.5596 };
/** 外圈幾公里內畫得出中山公園的樹冠、屋頂（park.ts 的 DETAIL_PPM：每公尺 0.09 像素） */
const PARK_TREES_KM = 1.8;

/** 地球上雷達正中間可以放大到多近：中山公園附近 0.5 公尺（park.ts 載入了才知道），其他地方 MIN_ZOOM_KM */
function earthMinKm(): number {
  return parkMod?.nearPark(origin.lat, origin.lng) ? parkMod.PARK_MIN_KM : MIN_ZOOM_KM;
}

/** 換了位置（定位、在地圖上設定、從汪星回來）不在中山公園附近了：拉遠到雷達平常的最小範圍 */
function fitEarthZoom(): void {
  if (!radar.spaceFocused && scaleKm < earthMinKm()) zoomRadar(earthMinKm() / scaleKm, true);
}

/** 照雷達正中間（拖曳時每一幀都變）畫 */
const drawPark = (km: number): string => parkMod?.earthParkSvg(origin, km) ?? '';

/** 公園可能在雷達上（約 18 km 內才畫）才載入、才畫 */
function updatePark(): void {
  if (radar.spaceFocused || scaleKm > 20 || haversineKm(origin, PARK_NEAR) > scaleKm * 1.5 + 1) {
    radar.setPark(null);
    return;
  }
  if (!parkMod) {
    if (!parkLoading) {
      parkLoading = true;
      void import('./park')
        .then((m) => {
          parkMod = m;
          updatePark();
        })
        .finally(() => {
          parkLoading = false;
        });
    }
    return;
  }
  radar.setPark(drawPark);
}

/** 在汪星上就記住中心和轉的角度（重新整理回到汪星同一個地方），不在汪星就清掉 */
function saveSpaceView(): void {
  const v = radar.spaceViewNow;
  // 你在地球：不記（重新整理回到地球）；你在汪星、鏡頭看別的星球：留著上次在汪星的看法（重新整理回到汪星）
  if (youOn !== 'woof') lsSet(LS_SPACE, null);
  else if (v.focus === 'woof') lsSet(LS_SPACE, JSON.stringify({ focus: 'woof', yaw: +v.yaw.toFixed(6), pitch: +v.pitch.toFixed(6) }));
}

/** 你在汪星時的「你的位置」：汪星轉到中山公園的發射口（火箭降落的地方） */
let woofHome: SpaceView | null = null;
async function woofHomeView(): Promise<SpaceView> {
  if (woofHome) return woofHome;
  const [sp, pk] = await Promise.all([import('./space'), import('./park')]);
  const [la, ln] = sp.toWoof(pk.HATCH_CENTER);
  woofHome = { focus: 'woof', yaw: (-ln * Math.PI) / 180, pitch: (la * Math.PI) / 180 };
  return woofHome;
}

/** 火箭飛行時拉遠到多遠（雷達外圈，公里）：約 2.7 AU，地球和汪星（離太陽 1.26 AU）一起看得到 */
const TRIP_OUT_KM = 4e8;

/** 頭尾慢、中間快（0～1） */
const easeInOut = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

/** 照時間跑 ms 毫秒，每一格畫面呼叫 each(0～1)，最後一定是 1 */
function animate(ms: number, each: (u: number) => void): Promise<void> {
  return new Promise((done) => {
    const t0 = performance.now();
    const step = (now: number): void => {
      const u = Math.min(1, (now - t0) / ms);
      each(u);
      if (u < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
}

/** 雷達範圍照時間慢慢換（對數上平均，頭尾慢）：火箭飛行的拉遠、拉近；each 是每一格先做的事（換看法） */
async function animateScale(toKm: number, ms: number, each?: (u: number) => void): Promise<void> {
  const from = scaleKm;
  await animate(ms, (u) => {
    each?.(u);
    zoomRadar((from * (toKm / from) ** easeInOut(u)) / scaleKm, false);
  });
  zoomRadar(1, true);
}

const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

/**
 * 火箭從中山公園飛到另一邊的中山公園（地球→汪星、汪星→地球），飛行約 15 秒，範圍跟出發時一樣：
 * 點火離地（1.6 秒），小火箭從地圖上的火箭接手、1 秒內移到雷達正中間，同時慢慢拉遠到看得到地球和汪星（4.4 秒）；
 * 頭轉向要去的那一顆（從汪星出發時太陽系同時轉回從正上方看，0.8 秒）、鏡頭跟著火箭從這一顆移到那一顆（3.5 秒）；
 * 中心換到那一顆（汪星轉到中山公園，回地球時雷達正中間換到發射口，手動位置）、轉回直立、慢慢拉近（5.5 秒，汪星前一半慢慢轉到中山公園），
 * 最後 1 秒小火箭移到降落開始的地方交回地圖：發射口打開、火箭降進井裡、門關上，收在那一邊。整趟不接受拖曳、縮放（radar.setTrip）
 */
async function rocketTrip(m: typeof import('./park'), from: 'earth' | 'woof'): Promise<void> {
  const to = m.departRocket();
  if (!to) return;
  tripping = true;
  lockDog(null);
  // 飛往汪星：拉近時看得到汪星的地圖；狗換到別塊草皮
  tripTo = to;
  if (to === 'woof') m.moveDogs();
  parkMod = m;
  radar.setTrip('', true);
  radar.redrawPark();
  const startKm = scaleKm;
  const startView = radar.spaceViewNow;
  const sp = spaceMod ?? (await import('./space'));
  spaceMod = sp;
  const [lat, lng] = m.HATCH_CENTER;
  const park = await woofHomeView();
  await wait(Math.max(0, m.DEPART_MS - 30));
  // 小火箭從地圖上的火箭接手（先量位置，再把地圖上的收掉）
  radar.setTrip(m.tripSvg(), true, radar.rocketAt(), m.TRIP_AT);
  await wait(30);
  radar.redrawPark();
  await animateScale(TRIP_OUT_KM, 4400);
  // 頭轉向要去的那一顆；從汪星出發時太陽系轉回從正上方看
  const focus = from === 'woof' ? 'woof' : null;
  radar.tiltTrip(sp.bodyBearing(from, to), 800);
  await animate(800, (u) => {
    if (from === 'woof') radar.setSpaceView({ focus, yaw: startView.yaw * (1 - easeInOut(u)), pitch: startView.pitch * (1 - easeInOut(u)) }, true);
  });
  // 鏡頭跟著火箭從這一顆移到那一顆
  await animate(3500, (u) => radar.setSpaceView({ focus, yaw: 0, pitch: 0, toward: to, u: easeInOut(u) }, true));
  if (to === 'woof') radar.setSpaceView({ focus: 'woof', yaw: 0, pitch: 0 }, true);
  else {
    setOrigin({ lat, lng, source: 'manual' });
    radar.resetSpace();
  }
  radar.tiltTrip(null, 700);
  // 拉近（汪星：前一半慢慢轉到中山公園）；最後 1 秒小火箭移到降落開始的地方
  window.setTimeout(() => radar.moveTrip(m.arriveAt(startKm), 1000), 4500);
  let turned = to !== 'woof';
  await animateScale(startKm, 5500, (u) => {
    if (turned) return;
    const v = easeInOut(Math.min(1, u / 0.5));
    turned = u >= 0.5;
    radar.setSpaceView({ ...park, yaw: park.yaw * v, pitch: park.pitch * v }, !turned);
  });
  m.arriveRocket(to);
  // 你到了那一邊：汪星海上的漂流瓶跟著抓（回地球清掉）
  youOn = to;
  radar.youOn = to;
  void loadWoofBottles();
  bottleWorldChanged();
  saveSpaceView();
  updateScaleChips();
  updateViewBtn();
  updateSpace();
  radar.redrawPark();
  radar.setTrip('', true);
  await wait(m.ARRIVE_MS + 50);
  radar.redrawPark();
  radar.setTrip('', false);
  tripping = false;
  tripTo = null;
}

/**
 * 在 3D 國館裡搭火箭到了另一邊（3D 自己飛、自己降落）：你換到那一邊，雷達跟著換（汪星轉到中山公園；回地球時雷達正中間換到發射口），
 * 跟雷達上搭火箭到了一樣
 */
async function landIn3D(to: 'earth' | 'woof'): Promise<void> {
  const m = await import('./park');
  parkMod = m;
  lockDog(null);
  youOn = to;
  radar.youOn = to;
  void loadWoofBottles();
  bottleWorldChanged();
  if (to === 'woof') radar.setSpaceView(await woofHomeView(), true);
  else {
    const [lat, lng] = m.HATCH_CENTER;
    setOrigin({ lat, lng, source: 'manual' });
    radar.resetSpace();
  }
  saveSpaceView();
  updateScaleChips();
  updateViewBtn();
  updateSpace();
  radar.redrawPark();
}

// ---- 太空：比「全球」再拉遠，畫地球、月球、太陽、行星（space.ts，第一次用到才載入；陸地用全世界的海岸線） ----
let spaceMod: typeof import('./space') | null = null;
let spaceLoading = false;
/** 上次給雷達的畫法（位置、陸地載入了沒、第幾個 10 分鐘），沒變就不換 */
let spaceFor = '';

function updateSpace(): void {
  // 太空：比全球再遠，或中心換到別的星球（拉近看月球時範圍會比全球小）
  if (scaleKm <= WORLD_KM && !radar.spaceFocused) return;
  if (!spaceMod) {
    if (spaceLoading) return;
    spaceLoading = true;
    void import('./space')
      .then((m) => {
        spaceMod = m;
        updateSpace();
      })
      .finally(() => {
        spaceLoading = false;
      });
    return;
  }
  // 晝夜、月球、行星位置每 10 分鐘換一次
  const slot = Math.floor(Date.now() / 600_000);
  const map = woofMap();
  const key = `${worldLoaded}|${origin.lat},${origin.lng}|${slot}|${youOn}|${map}`;
  if (key === spaceFor) return;
  spaceFor = key;
  const mod = spaceMod;
  const center = { lat: origin.lat, lng: origin.lng };
  const land = landRings;
  const when = new Date();
  const you = youOn;
  // 汪星的狗走完一段：重畫汪星（下一段）；每一格照指北針轉回來
  // 3D 國館標好的路燈、長椅…（小法會走過去聞）
  void import('./park').then((p) => {
    p.onDogMove(() => radar.redrawPark(), () => radar.headingDeg);
    p.loadSniffMarks();
  });
  radar.setSpace((km, rg, view) => mod.spaceMarkup({ center, land, when, scaleKm: km, rg, view, streets: woofStreets, you, woofMap: map, bottles: map && bottlesOn() ? woofBottleMarks(km) : undefined }), mod.bodyRadiusKm);
}

/**
 * 範圍比 16 km 大（全台、全球、縮放到更遠）畫海岸線（台灣加上全世界），1000 km 內再畫縣市交界，
 * 比這個小的不畫（只有道路）；位置變了、範圍跨過 2 的次方才重算。
 * 只換算雷達附近的點（v1.639）：範圍的 2.5 倍外面的點換成斷點，拖曳時不用每一格都算全部約 4,200 個點
 */
function updateOutline(): void {
  const kind = scaleKm > OUTLINE_KM ? 'land' : 'none';
  if (kind === 'land' && !worldLoaded && !worldLoading) {
    worldLoading = true;
    void Promise.all([import('./world'), import('./counties')])
      .then(([m, c]) => {
        worldRings = m.WORLD_RINGS.filter((r) => !inTaiwanBox(r));
        landRings = [...TAIWAN_RINGS, ...worldRings];
        countyLines = c.COUNTY_LINES;
        worldLoaded = true;
        outlineFor = '';
        updateOutline();
        updateSpace();
      })
      .finally(() => {
        worldLoading = false;
      });
  }
  // 範圍照 2 的次方分級：縮放跨級才重算（附近的範圍跟著變大）
  const tier = Math.ceil(Math.log2(Math.max(scaleKm, 1)));
  const reach = 2 ** tier * 2.5;
  // 東亞：附近碰到就載入；載入了雷達用它的海岸線，world.ts 在東亞那一塊的點不畫
  const nearEa = touchesEastAsia(reach);
  if (nearEa) loadEastAsia();
  const ea = nearEa ? eaMod : null;
  const inEa = (lat: number, lng: number): boolean => lat > EA_AREA.s && lat < EA_AREA.n && lng > EA_AREA.w && lng < EA_AREA.e;
  // 16 km 內只在中國的範圍畫虛線海岸（不在台灣本島時；其他地方用街道圖磚的實線海岸）
  const china = kind === 'none' && !!ea && !onTaiwanMain(origin);
  type Src = { ring: Array<[number, number]>; skip?: (lat: number, lng: number) => boolean };
  const sources: Src[] | null =
    kind === 'land'
      ? [
          ...TAIWAN_RINGS.map((ring) => ({ ring })),
          ...(ea ? ea.eaCoast.map((ring) => ({ ring })) : []),
          ...worldRings.map((ring) => ({ ring, skip: ea ? inEa : undefined })),
        ]
      : china
        ? ea!.eaCoast.map((ring) => ({ ring, skip: (lat: number, lng: number) => !ea!.chinaMask.contains(lat, lng) }))
        : null;
  const lines = kind === 'land' && scaleKm <= COUNTY_MAX_KM ? countyLines : [];
  const mapRings = kind === 'land' && scaleKm > MAP_OUTLINE_KM ? landRings : null;
  const key = sources ? `${kind}|${worldLoaded}|${!!ea}|${china}|${lines.length > 0}|${!!mapRings}|${tier}|${origin.lat},${origin.lng}` : '';
  if (key === outlineFor) return;
  outlineFor = key;
  // 附近的範圍（經緯度的方框）：範圍的 2.5 倍（全螢幕鋪滿時角落比外圈遠）；太大、跨過換日線就全部換算
  const dLat = reach / 111;
  const dLng = reach / (111 * Math.max(0.1, Math.cos((origin.lat * Math.PI) / 180)));
  const box = reach < 2500 && Math.abs(origin.lng) + dLng < 180 ? [origin.lat - dLat, origin.lng - dLng, origin.lat + dLat, origin.lng + dLng] : null;
  const toRadar = (ring: Array<[number, number]>, skip?: (lat: number, lng: number) => boolean): Array<{ bearing: number; distanceKm: number }> => {
    const out: Array<{ bearing: number; distanceKm: number }> = [];
    let gap = false;
    // 東亞的海岸線有些是切開的線（頭尾不同一點）：不要接成一圈
    let skipped = ring.length > 1 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]);
    for (const [lat, lng] of ring) {
      if ((box && (lat < box[0] || lat > box[2] || lng < box[1] || lng > box[3])) || skip?.(lat, lng)) {
        if (!gap && out.length > 0) out.push(FAR_POINT);
        gap = skipped = true;
        continue;
      }
      gap = false;
      out.push({ bearing: bearingDeg(origin, { lat, lng }), distanceKm: haversineKm(origin, { lat, lng }) });
    }
    // 有一段在外面（包括開頭）：最後也斷開，不要頭尾接成封閉的形狀
    if (skipped && out.length > 0 && out[out.length - 1] !== FAR_POINT) out.push(FAR_POINT);
    return out;
  };
  radarOutline = sources ? sources.map((s) => toRadar(s.ring, s.skip)).filter((r) => r.some((p) => p !== FAR_POINT)) : [];
  radar.setOutline(radarOutline, lines.map((l) => toRadar(l)).filter((r) => r.length > 1));
  map.setOutline(mapRings ?? []);
}

// ---- 車掃路線 ----
/** 回報的車掃貼文合成的路線（各站直線連起來、沒有認領人數）；官方航線的有實際路徑 */
const isReported = (r: RouteOut): boolean => r.source === 'report';
/** 回報的車掃：這一站在事件的時間裡（同一則貼文好幾天各一條路線，標題可能一樣） */
const stopMatches = (s: RouteStop, ev: EventOut): boolean => s.title === ev.title && s.at !== null && s.at >= ev.startAt && s.at <= ev.endAt;
const routeOf = (ev: EventOut): RouteOut | undefined =>
  routes.find((r) => r.postId === ev.post.id && (!isReported(r) || r.stops.some((s) => stopMatches(s, ev))));
const stopOf = (ev: EventOut): RouteStop | undefined => {
  const r = routeOf(ev);
  return r?.stops.find((s) => (isReported(r) ? stopMatches(s, ev) : s.title === ev.title));
};
/**
 * 官方車掃的一站還沒經過：預計經過的時間（起點是出發、加油點是車隊預計經過、終點是抵達），光點下寫還有多久（v1.539 使用者說內湖南港車掃一樣要顯示還有多久）。
 * 加油點當天整天都算在進行中，所以不看 phase，看這一站經過了沒
 */
const officialStopAt = (ev: EventOut, now: number): number | null => {
  const r = routeOf(ev);
  if (!r || isReported(r)) return null;
  const at = stopOf(ev)?.at ?? null;
  return at !== null && at > now ? at : null;
};
/** 回報的車掃的一站（時間是預計經過的時間，不是開始） */
const reportedStop = (ev: EventOut): RouteStop | undefined => {
  const r = routeOf(ev);
  return r && isReported(r) ? stopOf(ev) : undefined;
};
/** 遊行（同志遊行）：彩虹路線，從同一個地方出發再回來 */
const isParade = (r: RouteOut): boolean => r.style === 'rainbow';
/** 洋流車掃：台北大洋流官方的車掃（不是遊行、不是回報的），進行中畫洋流的特效 */
const isOceanRoute = (r: RouteOut): boolean => !isParade(r) && r.source !== 'report';

/** 遊行開始流出彩虹、洋流車掃湧浪的時間（Date.now() 的毫秒），雷達、地圖各記各的 */
const rainbowFlowAt = { radar: new Map<string, number>(), map: new Map<string, number>() };
const calmMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
/**
 * 遊行、洋流車掃出發了（還沒抵達）：在雷達、地圖上看到它（那個畫面開著、網頁在前景）就從出發的地方流出彩虹、湧出洋流的浪，之後每隔約 30 秒再流一次
 * （RAINBOW_EVERY_MS，雷達、地圖各算各的；從別的畫面切過來、回到網頁時已經超過 30 秒就馬上流）。
 * 出發時網頁開著就是出發那一刻（每 5 秒重算一次），出發後才打開的是一打開就流。減少動態效果時不流
 */
function rainbowFlow(r: RouteOut, now: number, where: 'radar' | 'map'): number | undefined {
  if (routeState(r, now) !== 'live' || calmMotion?.matches) return undefined;
  const seen = rainbowFlowAt[where];
  const last = seen.get(r.id);
  if ((last === undefined || Date.now() - last >= RAINBOW_EVERY_MS) && view === where && !document.hidden) seen.set(r.id, Date.now());
  return seen.get(r.id);
}
const stopLabel = (r: RouteOut, kind: RouteStop['kind']): string => ({ start: '出發', cheer: isReported(r) ? '應援點' : '加油點', end: isParade(r) ? '回到' : '抵達' })[kind];
/** 車掃的起點、終點像賽車一樣插旗；遊行插彩虹旗 */
const STOP_FLAG: Partial<Record<RouteStop['kind'], string>> = { start: '🚩', end: '🏁' };
const stopFlag = (r: RouteOut, kind: RouteStop['kind']): string | undefined => (isParade(r) ? (kind === 'cheer' ? undefined : '🏳️‍🌈') : STOP_FLAG[kind]);
/** 這一點是車掃的起點、終點：🚩、🏁（遊行 🏳️‍🌈） */
const flagOf = (ev: EventOut): string | undefined => {
  const r = routeOf(ev);
  const st = r ? stopOf(ev) : undefined;
  return r && st ? stopFlag(r, st.kind) : undefined;
};
/** 時間表、清單上的「🚩 出發」「🏁 抵達」 */
const stopLabelHtml = (r: RouteOut, kind: RouteStop['kind']): string => `${stopFlag(r, kind) ? `${stopFlag(r, kind)} ` : ''}${stopLabel(r, kind)}`;
/**
 * 官方車掃的中間點（轉彎的地方）：車掃地圖的路段名稱是「右轉 興隆路四段（直走三、二段）（2/6）」，去掉（k/n）跟前一段不一樣就是換一條路，
 * 在那一段的起點；經過的時間跟加油點一樣，照出發、抵達的時間等速沿著路線推算
 */
interface RouteTurn {
  name: string;
  lat: number;
  lng: number;
  at: number | null;
}
function routeTurns(r: RouteOut): RouteTurn[] {
  if (!isOceanRoute(r)) return [];
  const road = (name: string): string => name.replace(/（\d+\/\d+）$/, '').trim();
  const found: Array<{ name: string; lat: number; lng: number; km: number }> = [];
  let km = 0;
  let last: LatLng | null = null;
  r.segments.forEach((sg, i) => {
    if (i > 0 && sg.path.length > 0 && road(sg.from) !== road(r.segments[i - 1].from)) found.push({ name: road(sg.from), lat: sg.path[0][0], lng: sg.path[0][1], km });
    for (const [lat, lng] of sg.path) {
      if (last) km += haversineKm(last, { lat, lng });
      last = { lat, lng };
    }
  });
  const { departAt, arriveAt } = r;
  return found.map((t) => ({ name: t.name, lat: t.lat, lng: t.lng, at: departAt && arriveAt && km > 0 ? Math.round(departAt + ((arriveAt - departAt) * t.km) / km) : null }));
}
/** 「右轉 興隆路四段（直走三、二段）」分成「右轉」和路名 */
const turnParts = (name: string): { verb: string; road: string } => {
  const m = /^(右轉|左轉|迴轉|直走)\s*(.*)$/.exec(name);
  return m ? { verb: m[1], road: m[2] } : { verb: '經過', road: name };
};
const turnLabel = (t: RouteTurn): string => `${t.at ? `約 ${fmtTime(t.at)} ` : ''}${t.name}`;

/** 遊行的每一條路線：「北路線 3.6 km」 */
const paradeWays = (r: RouteOut): string => r.segments.map((s) => `${s.from} ${(s.lengthM / 1000).toFixed(1)} km`).join('、');

function routeState(r: RouteOut, now: number): RadarRoute['state'] {
  if (!r.departAt || now < r.departAt) return 'planned';
  // 回報的：最後一站經過後 15 分鐘（雷達上那一站拿掉）才算結束
  if (isReported(r) ? now >= r.showUntil : r.arriveAt && now >= r.arriveAt) return 'done';
  return 'live';
}

/** 清單上有它的事件才顯示路線（跟著關鍵字篩選走） */
const shownRoutes = (items: Item[]): RouteOut[] => routes.filter((r) => items.some((it) => routeOf(it.ev)?.id === r.id));
const routeItems = (r: RouteOut, items: Item[]): Item[] => items.filter((it) => routeOf(it.ev)?.id === r.id);
const routeKm = (r: RouteOut): number => r.segments.reduce((n, s) => n + s.lengthM, 0) / 1000;
/**
 * 車掃還沒出發：雷達、地圖只畫起點，路線和其他站出發後才畫（清單、時間表照樣列）；
 * 點了這個車掃（時間表、其中一站、「在地圖上看路線」）就先畫出來
 */
const beforeDeparture = (it: Item, now: number, focused: string | null): boolean => {
  const r = routeOf(it.ev);
  return !!r && r.id !== focused && routeState(r, now) === 'planned' && stopOf(it.ev)?.kind !== 'start';
};
/** 雷達、地圖上要畫的路線：出發後才畫，出發前點了才畫 */
const drawnRoutes = (items: Item[], now: number, focused: string | null): RouteOut[] =>
  shownRoutes(items).filter((r) => routeState(r, now) !== 'planned' || r.id === focused);
/** 出發前按「在地圖上看路線」：這條路線先畫出來，點其他地方收起 */
let routeOnMap: string | null = null;
/** 現在點開的車掃：時間表、選到的那一站、或按了「在地圖上看路線」的 */
function focusedRoute(items: Item[]): string | null {
  if (selectedRoute) return selectedRoute;
  if (routeOnMap) return routeOnMap;
  const sel = selectedId !== null ? items.find((it) => it.ev.id === selectedId) : undefined;
  return sel ? (routeOf(sel.ev)?.id ?? null) : null;
}

/** 回報的車掃：下一個還沒經過的站 */
const nextStop = (r: RouteOut, now: number): RouteStop | undefined => r.stops.find((s) => s.at !== null && s.at > now);

function untilText(unix: number, now: number): string {
  const mins = Math.max(0, Math.round((unix - now) / 60));
  return mins < 60 ? `還有 ${mins} 分鐘` : `還有 ${Math.floor(mins / 60)} 小時 ${mins % 60} 分`;
}

function routeTimeLine(r: RouteOut, items: Item[], now: number): string {
  if (isReported(r)) {
    const state = routeState(r, now);
    if (!r.departAt) return '出發時間未定';
    // 不是今天的寫日期
    const day = taipeiDay(r.departAt) === taipeiDay(now) ? '' : `${dateFmt.format(new Date(r.departAt * 1000))} `;
    if (state === 'planned') return `${day}${fmtTime(r.departAt)} 出發 · ${startsIn(r.departAt, now)}`;
    if (state === 'done') return '已結束';
    const next = nextStop(r, now);
    return next?.at ? `車掃中 · 下一站 ${next.name} 約 ${fmtTime(next.at)}` : '車掃中 · 快到最後一站了';
  }
  const end = r.stops.find((s) => s.kind === 'end');
  const endEv = end && routeItems(r, items).find((it) => it.ev.title === end.title)?.ev;
  const state = routeState(r, now);
  // 遊行：前幾天就列出來，不是今天的寫日期；回來後會場活動還在進行
  if (isParade(r) && r.departAt) {
    const day = taipeiDay(r.departAt) === taipeiDay(now) ? '' : `${dateFmt.format(new Date(r.departAt * 1000))} `;
    if (state === 'planned') return `${day}${fmtTime(r.departAt)} 出發 · ${startsIn(r.departAt, now)}`;
    if (state === 'live') return `遊行中 · 預計 ${r.arriveAt ? fmtTime(r.arriveAt) : ''} 回到${end?.name ?? ''}`;
    return endEv && endEv.endAt > now ? `遊行隊伍已回來 · 會場活動到 ${fmtTime(endEv.endAt)}` : '已結束';
  }
  if (!r.departAt) return '今天・出發時間未定';
  if (state === 'planned') return `${fmtTime(r.departAt)} 出發 · ${untilText(r.departAt, now)}`;
  if (state === 'live') return `車掃中 · 預計 ${r.arriveAt ? fmtTime(r.arriveAt) : ''} 抵達${end?.name ?? ''}`;
  return endEv && endEv.endAt > now ? `已抵達 · ${endEv.title.split('・')[0]}到 ${fmtTime(endEv.endAt)}` : '已抵達';
}

/** 固定據點的其他貼文：同一個帳號之前發的（已被新貼文取代）、別人提到這個據點的 */
function spotPostsHtml(list: RelatedPost[]): string {
  if (list.length === 0) return '';
  return `<details class="related"><summary>這個據點的其他貼文（${list.length}）</summary><ul>${list
    .map((r) => {
      const title = `${dateFmt.format(new Date(r.postedAt * 1000))} ${r.title}`;
      return `<li><span class="kind-tag">${r.role === 'previous' ? '之前的貼文' : '相關貼文'}</span>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(title)}</a>` : esc(title)}</li>`;
    })
    .join('')}</ul><p class="muted">「之前的貼文」是店家先前發的，已經以最新那則為準；「相關貼文」是別人提到這個據點的貼文，時間地點以據點的貼文為準。</p></details>`;
}

/** 講同一場官方活動的新聞與貼文，已經併進來、不另外顯示 */
function relatedHtml(list: RelatedPost[]): string {
  if (list.length === 0) return '';
  const label = (r: RelatedPost): string => (r.source === 'news' ? '新聞' : r.source === 'accupass' ? '活動通' : r.source === 'opentix' ? 'OPENTIX' : 'Threads');
  return `<details class="related"><summary>相關報導（${list.length}）</summary><ul>${list
    .map((r) => `<li><span class="kind-tag">${label(r)}</span>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>` : esc(r.title)}</li>`)
    .join('')}</ul><p class="muted">這些講的是同一場活動，時間地點以官方為準。</p></details>`;
}

/** 同一條路線（同一則官方貼文）的事件都帶同一份相關報導，取聯集 */
function routeRelated(r: RouteOut, items: Item[]): RelatedPost[] {
  const seen = new Map<string, RelatedPost>();
  for (const it of routeItems(r, items)) for (const x of it.ev.related ?? []) seen.set(x.id, x);
  return [...seen.values()];
}

/** 加油點、起點、終點在詳細資料裡的那一行 */
function stopText(stop: RouteStop, now: number): string {
  if (!stop.at) return '';
  if (stop.kind === 'start') return `${fmtTime(stop.at)} 從這裡出發`;
  if (stop.kind === 'end') return `預計 ${fmtTime(stop.at)} 抵達這裡`;
  return now < stop.at ? `車隊預計 ${fmtTime(stop.at)} 經過這裡` : `車隊預計 ${fmtTime(stop.at)} 已經過`;
}

// ---- 搜尋：在目前抓到的發放、活動（含車掃、固定據點）裡找字 ----
let searchTerms: string[] = [];
/** taipeiDay（從 1970-01-01 星期四算起的第幾天）是星期幾：0 是星期日 */
const weekdayOf = (day: number): number => (day + 4) % 7;
/** 這一則在哪幾天（taipeiDay）：開始到結束的每一天，固定據點看每一個時段；最多算 31 天；事件重抓才會換物件，跟著物件記 */
const daysOf = new WeakMap<EventOut, Set<number>>();
function itemDays(it: Item): Set<number> {
  let days = daysOf.get(it.ev);
  if (!days) {
    days = new Set<number>();
    for (const ev of it.spot ? it.spot.sessions : [it.ev]) {
      const last = taipeiDay(Math.max(ev.startAt, ev.endAt - 1));
      for (let d = taipeiDay(ev.startAt); d <= last && days.size < 31; d++) days.add(d);
    }
    daysOf.set(it.ev, days);
  }
  return days;
}

// ---- 日期：選星期幾（可以好幾個）或直接點一天（v1.613 使用者建議多一個日期的按鈕） ----
/** null 是不篩；weekdays 是星期幾（0 是星期日；一次一個，「週末」是六、日兩個）；date 是哪一天（taipeiDay） */
let dayPick: { weekdays: Set<number> } | { date: number } | null = null;
/** 選了哪一類（搜尋框下面的類型按鈕，topic-icons.ts 的 key）：雷達、地圖、清單只留這一類（v1.676） */
let typePick: string | null = null;
/** 最近一次畫面上抓到的全部（日期選單的月曆標哪幾天有東西） */
let dayFetched: Item[] = [];
const matchesDay = (it: Item): boolean => {
  if (!dayPick) return true;
  const days = itemDays(it);
  if ('date' in dayPick) return days.has(dayPick.date);
  const wd = dayPick.weekdays;
  return [...days].some((d) => wd.has(weekdayOf(d)));
};
/** 按鈕上、清單摘要寫的：「11/22(日)」「週六、日」「週末」 */
function dayPickLabel(): string {
  if (!dayPick) return '';
  if ('date' in dayPick) {
    const d = new Date(dayPick.date * 86400 * 1000);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[weekdayOf(dayPick.date)]})`;
  }
  const wd = [...dayPick.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (wd.length === 2 && dayPick.weekdays.has(0) && dayPick.weekdays.has(6)) return '週末';
  return `週${wd.map((w) => WEEKDAYS[w]).join('、')}`;
}

/** 搜尋比對用：小寫、去空白、臺台不分、周週不分 */
const foldText = (s: string): string => s.toLowerCase().replace(/\s+/g, '').replace(/臺/g, '台').replace(/周/g, '週');

/**
 * 這一則在星期幾（v1.612 使用者說搜尋也可以找星期幾）：開始到結束的每一天（最多一週），固定據點看每一個時段；
 * 每一天寫成「週六 星期六 禮拜六」，星期日多寫「星期天 禮拜天」，六日再加「週末」
 */
function weekdayWords(it: Item): string {
  const days = new Set([...itemDays(it)].map(weekdayOf));
  const words: string[] = [];
  for (const w of days) {
    const c = WEEKDAYS[w];
    words.push(`週${c}`, `星期${c}`, `禮拜${c}`);
    if (w === 0) words.push('星期天', '禮拜天');
  }
  if (days.has(0) || days.has(6)) words.push('週末');
  return words.join(' ');
}
/** 每一則可以搜尋的文字（標題、地點、物品、帳號、關鍵字、原文摘錄、補充、類型、車掃名稱、星期幾）；事件重抓才會換物件，跟著物件記 */
const searchText = new WeakMap<EventOut, string>();
function searchable(it: Item): string {
  let t = searchText.get(it.ev);
  if (t === undefined) {
    const ev = it.ev;
    t = foldText(
      [ev.title, titleOf(ev), ev.item, ev.placeText, ev.approxArea, ev.keyword, ev.post.username, ev.post.text, ev.post.supplement, kindLabel(ev), it.spot ? '固定據點' : '', routeOf(ev)?.title, tagsOf(ev).join(' '), weekdayWords(it)]
        .filter(Boolean)
        .join(' '),
    );
    searchText.set(ev, t);
  }
  return t;
}
/** 空白分開的每個字都要找得到 */
const matchesSearch = (it: Item): boolean => searchTerms.every((w) => searchable(it).includes(w));

function setSearch(q: string): void {
  const terms = q.trim().split(/\s+/).filter(Boolean).map(foldText);
  if (terms.join(' ') === searchTerms.join(' ')) return;
  searchTerms = terms;
  render();
}

function render(): void {
  // 拉遠超過全球（太空）「地圖」按鈕藏起來，拉回全球以內再出現
  viewBtn.hidden = view === 'radar' && noMapView();
  const now = nowSec();
  const fetched = computeItems(now);
  renderSearchTags(fetched);
  // 搜尋時雷達、地圖、清單、各類的數量都只算符合的
  const searched = searchTerms.length > 0 ? fetched.filter(matchesSearch) : fetched;
  // 選了星期幾、日期：只留那幾天有的（雷達、地圖、清單都是）
  const dayed = dayPick ? searched.filter(matchesDay) : searched;
  // 選了類型：只留這一類
  const all = typePick ? dayed.filter((it) => typeOf(it.ev) === typePick) : dayed;
  dayFetched = fetched;
  // 發放、活動、據點的開關是洋流的，其他模組不篩
  const byCategory = mod.current ? all.filter((it) => shown[categoryOf(it)]) : all;
  const items = onlyActive && mod.current ? byCategory.filter((it) => activeNow(it, now)) : byCategory;
  // 雷達、地圖只畫時間範圍內的；清單照樣全部列，範圍外的放最下面
  const timed = items.filter((it) => inTime(it, now));
  // 雷達、地圖上畫的：車掃還沒出發的只畫起點（點開的那條整條畫）
  const focused = focusedRoute(items);
  // 洋流總部的特效播放中（到按「關閉洋流號」為止），附近的活動光點、車掃路線先藏起來，畫面只留特效（使用者說的）；清單照樣列
  const onMap = hqVoyageAt !== null ? [] : timed;
  const drawn = onMap.filter((it) => !beforeDeparture(it, now, focused));
  updateOutline();
  updateStreets();
  updatePark();
  updateSpace();
  updateCategoryToggles(all);
  updateActiveToggle(byCategory, now);

  /** 經緯度 → 雷達上的方位、距離（洋流總部的特效用）；inView 是離正中間不到外圈的 1.5 倍（畫面附近才畫，不然幾千個元素每一格重畫會卡；畫面跟著船移動，進到畫面時已經長好的直接畫） */
  const toRadarAt = ([lat, lng]: [number, number]): { bearing: number; distanceKm: number } => ({ bearing: bearingDeg(origin, { lat, lng }), distanceKm: haversineKm(origin, { lat, lng }) });
  const inView = (p: { lat: number; lng: number }): boolean => haversineKm(origin, p) < scaleKm * 1.5;
  const anyInView = (pts: Array<[number, number]>): boolean => pts.some(([lat, lng], i) => i % 4 === 0 && inView({ lat, lng }));
  const hqEx = hqVoyageAt !== null && hqDrawing() ? hqExtras(hqVoyageAt) : { reveals: [], icons: [], seams: [] };
  // 文化網（點 —— 線 —— 面）或政策圖層的「點 —— 面」，一次只有一個
  const hqNetNow = hqVoyageAt === null ? null : hqNetAt !== null ? hqNetwork(hqNetAt) : hqLayerNetwork();
  // 稍後才開始的也畫（虛線框、淡色）
  radar.render(
    drawn.map((it) => ({
      id: it.ev.id,
      kind: it.ev.kind,
      spot: !!it.spot,
      office: !!it.spot && isOffice(it.ev),
      approx: !!it.ev.approxArea,
      // 全螢幕鋪滿時範圍外、還在畫面裡的照真的位置畫（雷達自己把畫面外的貼在邊上）
      outside: !inScope(radar.filling ? 0 : it.distanceKm),
      distanceKm: it.distanceKm,
      bearing: it.bearing,
      // 還沒出發的官方車掃路線點用「即將開始」的淡色畫；還沒開的據點跟休息中的一樣淡；其他稍後開始的（回報的車掃的站也是）畫虛線框
      phase: it.phase === 'later' ? (it.spot ? 'closed' : routeOf(it.ev) && !reportedStop(it.ev) ? 'soon' : 'later') : it.phase,
      label: titleOf(it.ev),
      flag: flagOf(it.ev),
      // 圓點裡的小圖示照活動的主題（跟地圖一樣，v1.672 全螢幕、v1.674 一般雷達也有）
      topic: topicFor(it.ev),
      // 名稱只在選取時顯示，光點一多標題會蓋成一片
      showLabel: it.ev.id === selectedId,
      selected: it.ev.id === selectedId,
      // 稍後開始的越久越淡；還沒開始的都在光點下寫還有多久
      // 回報的車掃：寫還有多久經過（不是前 10 分鐘的開始）
      ...(isUpcoming(it)
        ? { badge: startsInShort(reportedStop(it.ev)?.at ?? it.ev.startAt, now), ...(it.phase === 'later' ? { fade: clarityOf(it.ev, now) } : {}) }
        : officialStopAt(it.ev, now) !== null
          ? { badge: startsInShort(officialStopAt(it.ev, now)!, now) }
          : {}),
    })),
    drawnRoutes(onMap, now, focused).map((r): RadarRoute => {
      const toRadar = ([lat, lng]: [number, number]): { bearing: number; distanceKm: number } => ({ bearing: bearingDeg(origin, { lat, lng }), distanceKm: haversineKm(origin, { lat, lng }) });
      return {
        id: r.id,
        state: routeState(r, now),
        // 遊行：北、南兩條路線分開畫（同時從出發的地方流出彩虹）
        ...(isParade(r) ? { rainbow: true, parts: r.segments.map((sg) => sg.path.map(toRadar)), flowAt: rainbowFlow(r, now, 'radar') } : {}),
        // 洋流車掃：進行中畫洋流的特效；中間點、一直重複開的洋流號（減少動態效果時不開）
        ...(isOceanRoute(r)
          ? { ocean: true, flowAt: rainbowFlow(r, now, 'radar'), marks: routeTurns(r).map((t) => ({ ...toRadar([t.lat, t.lng]), title: turnLabel(t) })), boat: !calmMotion?.matches }
          : {}),
        points: r.segments.flatMap((sg) => sg.path).map(toRadar),
      };
    }).concat(
      // 洋流總部的特效：洋流號只開一趟到台北市政府、到了放煙火（跟車掃一樣的水）
      hqVoyageAt === null || !hqDrawing() || !hq
        ? []
        : [
            {
              id: 'hq-voyage',
              state: 'live' as const,
              river: true,
              voyage: hqVoyageAt,
              // 到終點 0.6 秒後河淡掉，政策的東西才看得清楚（使用者說「到終點把洋流路徑拿掉」）
              riverOut: hqVoyageAt + HQ_SAIL_MS + 600,
              points: hq.HQ_VOYAGE.map(toRadarAt),
              stops: hqTourStops(hqVoyageAt).filter(inView).map((st) => ({ ...st, ...toRadarAt([st.lat, st.lng]) })),
              outline: hq.CITY_HALL_OUTLINE.map(toRadarAt),
              // 水域「把水找回來」：船到那一站時老水路浮出來、注水；都市微森林「把樹種回來」：船經過砍樹的地方、要加強種樹的地方長出樹
              canals: hq.HQ_CANALS.filter((c) => anyInView(c.points)).map((c) => ({ points: c.points.map(toRadarAt), at: hqStopAt(hqVoyageAt!, c.stop), label: c.name })),
              springs: hq.HQ_SPRINGS.filter(inView).map((sp) => ({ ...toRadarAt([sp.lat, sp.lng]), at: hqStopAt(hqVoyageAt!, sp.stop), label: sp.name })),
              ponds: hq.HQ_PONDS.filter((pd) => anyInView(pd.ring)).map((pd) => ({ ring: pd.ring.map(toRadarAt), at: hqStopAt(hqVoyageAt!, pd.stop), label: pd.name })),
              plantings: HQ_TREES ? hqPlantings(hqVoyageAt).filter(inView).map((p) => ({ ...p, ...toRadarAt([p.lat, p.lng]) })) : [],
              // 水域「親水」：船沿河走時真的河亮起來；水上活動：船經過時河上出現 SUP、龍舟
              // 行道樹只畫畫面附近的街區（離正中間不到外圈的 1.5 倍；畫面跟著船移動，出現在畫面裡時已經長好的就直接畫），不然幾千棵每一格重畫會卡
              blooms: (HQ_TREES ? hq.HQ_BLOOMS : []).filter((bl) => inView({ lat: bl.center[0], lng: bl.center[1] })).map((bl) => ({ center: toRadarAt(bl.center), at: hqVoyageAt! + voyageTimeOf(bl.frac), streets: bl.streets.map((st) => ({ pts: st.pts.map(toRadarAt), mid: st.mid })) })),
              rivers: hq.HQ_RIVERS.filter((rv) => anyInView(rv.ring)).map((rv) => ({ ring: rv.ring.map(toRadarAt), at: hqStopAt(hqVoyageAt!, rv.stop) })),
              boats: hq.HQ_BOATS.filter(inView).map((b) => ({ ...toRadarAt([b.lat, b.lng]), at: hqNearestAt(hqVoyageAt!, b), kind: b.kind, heading: b.heading })),
              // 其他政見：山林徑的步道和登山中心、自行車橋、球場和運動中心、星群
              reveals: hqEx.reveals.filter((rv) => anyInView(rv.path)).map((rv) => ({ points: rv.path.map(toRadarAt), at: rv.at, kind: rv.kind, label: rv.label, color: rv.color, labelAt: rv.labelAt, hideKm: rv.hideKm })),
              icons: hqEx.icons.filter(inView).map((ic) => ({ ...ic, ...toRadarAt([ic.lat, ic.lng]) })),
              fitbuses: hqFitbuses(hqVoyageAt!)
                .filter((fb) => anyInView(fb.path))
                .map((fb) => ({ ...fb, size: hqFitSize(), points: fb.path.map(toRadarAt), stops: fb.stops.map((st) => ({ point: toRadarAt(st.at), label: st.label })) })),
              bikes: hqBikes(hqVoyageAt!)
                .filter((bk) => anyInView(bk.path))
                .map((bk) => ({ points: bk.path.map(toRadarAt), start: bk.start, lap: bk.lap, kind: bk.kind, color: bk.color, loop: bk.loop })),
              seams: hqEx.seams
                .filter((sm) => anyInView(sm.path))
                .map((sm) => ({
                  ...sm,
                  points: sm.path.map(toRadarAt),
                  stitches: sm.stitches.map((st) => ({ ...st, center: toRadarAt(st.center), along: toRadarAt(st.along) })),
                  walkers: sm.walkers.map((w) => ({ ...w, from: toRadarAt(w.from), to: toRadarAt(w.to) })),
                })),
              hits: hqHits(hqVoyageAt).filter(inView).map((h) => ({ ...h, ...toRadarAt([h.lat, h.lng]) })),
              // 綠覆率：每長回一棵樹，整個台北市再鋪一層很淡的綠
              green: { ring: hq.HQ_TAIPEI_RING.map(toRadarAt), steps: hqGreenSteps(hqVoyageAt) },
              areas: hqAreas(hqVoyageAt).filter((ar) => anyInView(ar.ring)).map((ar) => ({ ring: ar.ring.map(toRadarAt), center: toRadarAt(ar.center), at: ar.at, label: ar.label, zones: ar.zones?.map((z) => z.map(toRadarAt)), zonesAt: ar.zonesAt })),
              circles: hqCircles().filter(inView).map((c) => ({ ring: c.ring.map(toRadarAt), at: c.at })),
              nights: hqNights(hqVoyageAt).filter((nt) => nt.ring.some(([lat, lng]) => inView({ lat, lng }))).map((nt) => ({ ring: nt.ring.map(toRadarAt), at: nt.at })),
              sites: hqSites().filter((st) => inView({ lat: st.center[0], lng: st.center[1] })).map((st) => ({ rings: st.rings.map((rg) => rg.map(toRadarAt)), at: st.at })),
              focus: hqLayer !== null,
              ...(hqNetNow ? { network: { at: hqNetNow.at, noFace: hqNetNow.noFace, faceR: hqNetNow.faceR, lines: hqNetNow.lines.filter((ln) => anyInView(ln.path)).map((ln) => ({ points: ln.path.map(toRadarAt), color: ln.color })), dots: hqNetNow.dots.filter(inView).map((dt) => ({ ...toRadarAt([dt.lat, dt.lng]), color: dt.color })) } } : {}),
            },
          ],
    ),
  );
  // 被收藏了的瓶子照樣畫（淡淡的，v1.601 使用者說瓶子不用消失）
  // 附近的瓶子：地圖、按鈕的光照這個；雷達另外要拉近到 1 km 才畫（v1.670）
  const nearViews = bottles.filter((b) => bottleNear(b)).map((b) => ({ b, distanceKm: haversineKm(origin, b), bearing: bearingDeg(origin, b), state: bottleState(b) }));
  const bottleViews = zoomSees() ? nearViews : [];
  const hint = nearestHint(bottleViews);
  radar.setBottles(
    bottleViews.map((v) => ({
      id: v.b.id,
      bearing: v.bearing,
      distanceKm: v.distanceKm,
      state: v.state,
      mine: v.b.mine,
      picked: v.b.picked || !!v.b.taken,
      read: readBottles.has(v.b.id),
      selected: v.b.id === selectedBottle,
      hint: v === hint ? formatKm(v.distanceKm) : undefined,
    })),
  );
  map.setBottles(nearViews.map((v) => ({ id: v.b.id, lat: v.b.lat, lng: v.b.lng, state: v.state, mine: v.b.mine, picked: v.b.picked || !!v.b.taken, read: readBottles.has(v.b.id) })));
  updateBottleBadge(nearViews);
  syncWoofBottles();
  // 全螢幕鋪滿時你的 GPS 位置（像 Google 地圖的藍點）：拖曳移開了也畫在 GPS 的地方
  const fix = origin.source === 'gps' ? { at: origin, acc: gpsAccuracy } : lastGps ? { at: lastGps, acc: lastGpsAccuracy } : null;
  radar.setYou(fix ? { bearing: bearingDeg(origin, fix.at), distanceKm: haversineKm(origin, fix.at), accuracyKm: fix.acc ? fix.acc / 1000 : null } : null);
  radar.setLandmarks(
    (mod.current ? LANDMARKS : []).map((lm) => ({ id: lm.id, label: lm.name, bearing: bearingDeg(origin, lm), distanceKm: haversineKm(origin, lm), selected: lm.id === selectedLandmark })),
  );
  // 回報判讀完、還沒確認的位置
  const pins = shownReportPins();
  radar.setPreviews(pins.map((p) => ({ bearing: bearingDeg(origin, p), distanceKm: haversineKm(origin, p), label: p.label, glyph: p.glyph, drag: p.drag })));
  map.setPreviews(pins);
  map.setRoutes(
    drawnRoutes(onMap, now, focused).map((r): MapRoute => ({
      id: r.id,
      title: r.title,
      state: routeState(r, now),
      claimUrl: r.claimUrl,
      source: r.source,
      ...(isParade(r) ? { rainbow: true, flowAt: rainbowFlow(r, now, 'map') } : {}),
      ...(isOceanRoute(r) ? { ocean: true, flowAt: rainbowFlow(r, now, 'map'), turns: routeTurns(r).map((t) => ({ lat: t.lat, lng: t.lng, label: turnLabel(t) })), boat: !calmMotion?.matches } : {}),
      // 回報的車掃：已經經過的那段畫淡
      segments: r.segments.map((sg) => ({ ...sg, passed: !!sg.toAt && sg.toAt <= now })),
    })).concat(
      hqVoyageAt === null || !hqDrawing() || !hq
        ? []
        : [
            {
              id: 'hq-voyage',
              title: '洋流號',
              state: 'live' as const,
              claimUrl: null,
              river: true,
              voyage: hqVoyageAt,
              voyageKey: hqVoyageKey,
              // 到終點 0.6 秒後河淡掉，政策的東西才看得清楚（使用者說「到終點把洋流路徑拿掉」）
              riverOut: hqVoyageAt + HQ_SAIL_MS + 600,
              segments: [{ seq: 1, from: '洋流總部', to: '台北市政府', path: hq.HQ_VOYAGE, people: 0, target: 0 }],
              stops: hqTourStops(hqVoyageAt),
              outline: hq.CITY_HALL_OUTLINE,
              canals: hq.HQ_CANALS.map((c) => ({ path: c.points, at: hqStopAt(hqVoyageAt!, c.stop), label: c.name })),
              springs: hq.HQ_SPRINGS.map((sp) => ({ lat: sp.lat, lng: sp.lng, at: hqStopAt(hqVoyageAt!, sp.stop), label: sp.name })),
              ponds: hq.HQ_PONDS.map((pd) => ({ ring: pd.ring, at: hqStopAt(hqVoyageAt!, pd.stop), label: pd.name })),
              plantings: HQ_TREES ? hqPlantings(hqVoyageAt) : [],
              blooms: (HQ_TREES ? hq.HQ_BLOOMS : []).map((bl) => ({ center: bl.center, at: hqVoyageAt! + voyageTimeOf(bl.frac), streets: bl.streets })),
              rivers: hq.HQ_RIVERS.map((rv) => ({ ring: rv.ring, at: hqStopAt(hqVoyageAt!, rv.stop) })),
              boats: hq.HQ_BOATS.map((b) => ({ lat: b.lat, lng: b.lng, at: hqNearestAt(hqVoyageAt!, b), kind: b.kind, heading: b.heading })),
              ...hqEx,
              fitbuses: hqFitbuses(hqVoyageAt),
              bikes: hqBikes(hqVoyageAt),
              hits: hqHits(hqVoyageAt),
              green: { ring: hq.HQ_TAIPEI_RING, steps: hqGreenSteps(hqVoyageAt) },
              areas: hqAreas(hqVoyageAt),
              circles: hqCircles().map(({ lat, lng, radiusM, at }) => ({ lat, lng, radiusM, at })),
              nights: hqNights(hqVoyageAt),
              sites: hqSites().map(({ rings, at }) => ({ rings, at })),
              focus: hqLayer !== null,
              ...(hqNetNow ? { network: hqNetNow } : {}),
            },
          ],
    ),
  );
  map.render(
    drawn.map((it) => ({
      id: it.ev.id,
      kind: it.ev.kind,
      spot: !!it.spot,
      office: !!it.spot && isOffice(it.ev),
      approx: !!it.ev.approxArea,
      lat: it.ev.lat,
      lng: it.ev.lng,
      phase: it.phase,
      title: `${tagLabel(it)}｜${titleOf(it.ev)}`,
      flag: flagOf(it.ev),
      // 地圖上的小圖示照活動的主題（發放的也算一類，v1.671）
      topic: topicFor(it.ev),
      subtitle: `${placeLine(it.ev)} · ${timeLine(it, now)}`,
      selected: it.ev.id === selectedId,
      ...(isUpcoming(it) && it.phase === 'later' ? { fade: clarityOf(it.ev, now) } : {}),
    })),
  );
  renderList(items, now);
  renderDetail(items, now);
  if (detailEl.hidden) setPeek(false);

  // 新變成進行中且在雷達範圍內的事件 → 嗶聲、震動、通知。第一次載入不吵。搜尋只影響畫面，通知照樣看全部
  const notifyPool = searchTerms.length > 0 ? fetched.filter((it) => shown[categoryOf(it)] && (!onlyActive || activeNow(it, now))) : items;
  for (const it of notifyPool) {
    if (it.phase !== 'active') continue;
    const seenKey = it.spot ? `spot:${it.spot.key}` : `ev:${it.ev.id}`;
    if (seenActive.has(seenKey)) continue;
    seenActive.add(seenKey);
    // 整天的沒有「開始」的時間點，不然半夜 12 點會一起響；固定據點每天都開，不主動提醒
    if (!notifiedOnce || !notifyOn() || !inScope(it.distanceKm) || it.ev.allDay || it.spot) continue;
    beep(theme.sound);
    try {
      navigator.vibrate?.([120, 80, 160]);
    } catch {
      /* ignore */
    }
    const msg = `${titleOf(it.ev)}｜${it.ev.placeText}｜${formatKm(it.distanceKm)} ${compassLabel(it.bearing)}`;
    const head =
      it.ev.kind === 'food'
        ? ({ vendor: '附近的攤位出攤了', recommend: '附近有網友推薦的店', meetup: '附近有人揪吃飯' }[foodRole(it.ev) ?? 'recommend'] ?? '美食品味')
        : it.ev.kind === 'session'
        ? isSeek(it.ev)
          ? '附近有人找臨打'
          : '臨打開始'
        : it.ev.kind === 'job'
          ? isOffer(it.ev)
            ? '附近有人可以幫忙照顧狗狗'
            : '附近有新職缺'
          : reportedStop(it.ev)
            ? '車隊快到了'
            : it.ev.kind === 'activity'
              ? `${topicOf(it.ev) ?? '活動'}開始`
              : '開始發放';
    showBanner(bannerEl, `${head}：${msg}`, 10_000);
    systemNotify(head, msg, `ev-${it.ev.id}`);
  }
  if (lastFetchAt > 0) notifiedOnce = true;
}

const CATEGORY_NAME: Record<Category, string> = { giveaway: '發放', activity: '活動', spot: '固定據點', job: '職缺' };

/** 現在就能去：進行中、據點開放中、車掃中 */
function activeNow(it: Item, now: number): boolean {
  if (it.phase === 'active') return true;
  const r = routeOf(it.ev);
  return !!r && routeState(r, now) === 'live';
}

/** 「只看進行中」：括號寫現在有幾個（車掃一條算一個）；沒有進行中、也沒打開時不顯示 */
function updateActiveToggle(items: Item[], now: number): void {
  const seen = new Set<string>();
  let n = 0;
  for (const it of items) {
    if (!activeNow(it, now)) continue;
    const r = routeOf(it.ev);
    if (r && seen.has(r.id)) continue;
    if (r) seen.add(r.id);
    n++;
  }
  onlyGroup.hidden = !mod.current || (n === 0 && !onlyActive);
  activeToggle.textContent = `進行中（${n}）`;
  activeToggle.classList.toggle('on', onlyActive);
  activeToggle.setAttribute('aria-pressed', String(onlyActive));
}

/** 開關上寫各有幾個（車掃一條路線算一個），沒有的那一類不顯示開關；關掉的照樣列出數量 */
function updateCategoryToggles(all: Item[]): void {
  const seen = new Set<string>();
  const counts: Record<Category, number> = { giveaway: 0, activity: 0, spot: 0, job: 0 };
  for (const it of all) {
    const r = routeOf(it.ev);
    if (r && seen.has(r.id)) continue;
    if (r) seen.add(r.id);
    counts[categoryOf(it)]++;
  }
  for (const b of categoryToggles) {
    const cat = b.dataset.cat as Category;
    b.hidden = counts[cat] === 0;
    b.textContent = `${CATEGORY_NAME[cat]}（${counts[cat]}）`;
    b.classList.toggle('on', shown[cat]);
    b.setAttribute('aria-pressed', String(shown[cat]));
  }
  catGroup.hidden = !mod.current || categoryToggles.every((b) => b.hidden);
}

/** 清單上的一列：一般事件，或合成一張卡片的車掃路線 */
type Row = { it: Item; route?: undefined; phase: Phase; distanceKm: number; inScope: boolean; inTime: boolean; spot: boolean; sortAt: number } | { route: RouteOut; it?: undefined; phase: Phase; distanceKm: number; inScope: boolean; inTime: boolean; spot: false; sortAt: number };

/** 車掃卡片的狀態跟著車隊走：還沒出發是稍後／即將開始，車掃中、抵達後的活動進行中算進行中 */
function routePhase(r: RouteOut, members: Item[], now: number): Phase {
  const state = routeState(r, now);
  if (state === 'live') return 'active';
  if (state === 'done') return members.some((it) => it.phase === 'active') ? 'active' : 'later';
  return r.departAt && r.departAt - now <= SOON_SEC ? 'soon' : 'later';
}

function listRows(items: Item[], now: number): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const r = routeOf(it.ev);
    if (!r) {
      rows.push({ it, phase: it.phase, distanceKm: it.distanceKm, inScope: inScope(it.distanceKm), inTime: inTime(it, now), spot: !!it.spot, sortAt: it.ev.startAt });
      continue;
    }
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const members = routeItems(r, items);
    rows.push({ route: r, phase: routePhase(r, members, now), distanceKm: Math.min(...members.map((m) => m.distanceKm)), inScope: members.some((m) => inScope(m.distanceKm)), inTime: members.some((m) => inTime(m, now)), spot: false, sortAt: r.departAt ?? it.ev.startAt });
  }
  return rows;
}

const PHASE_TITLE: Partial<Record<Phase, string>> = { active: '進行中', soon: '即將開始', later: '稍後開始' };

/** 清單上一則一則的順序（事件 id） */
let listOrder: number[] = [];
/**
 * 活動卡片的「上一個」「下一個」照的順序：打開卡片時記下清單當時的順序，切的時候不變（雷達飛過去以後清單照距離重排，
 * 不會跟著亂跳）；關掉卡片、從清單再點一則時重新記
 */
let stepOrder: number[] | null = null;
/** 打開卡片時雷達的中心：活動卡片標題下的距離從這裡算（跟清單上寫的一樣；飛過去以後中心就是那一則，從中心算都是 0） */
let stepFrom: LatLng | null = null;
function beginSteps(): void {
  stepOrder = [...listOrder];
  stepFrom = { lat: origin.lat, lng: origin.lng };
}
function renderList(items: Item[], now: number): void {
  // 摘要和清單用同一套「列」來算：車掃路線的起點、加油點、終點合成一張卡片，只算一個
  const rows = listRows(items, now);
  const inRange = rows.filter((r) => r.inScope && r.inTime);
  // 時間範圍外（還要很久才開始）：放在範圍外前面，照開始時間排
  const laterRows = rows.filter((r) => r.inScope && !r.inTime).sort((a, b) => a.sortAt - b.sortAt || a.distanceKm - b.distanceKm);
  const outRange = rows.filter((r) => !r.inScope);
  // 羽球臨打的找臨打（需求）另外一段
  // 刊登（找臨打、網友推薦、揪團吃飯）各自另外一段，不照開始時間分
  const postingRows = new Map<string, Row[]>();
  for (const r of inRange) {
    const role = r.it ? postingRole(r.it.ev) : null;
    if (role) postingRows.set(role, [...(postingRows.get(role) ?? []), r]);
  }
  const posted = new Set([...postingRows.values()].flat());
  const singles = inRange.filter((r) => !r.spot && !posted.has(r));
  const spotsIn = inRange.filter((r) => r.spot);
  // 排序：時間照開始時間（同時間再照距離），距離由近到遠
  const near = (a: Row, b: Row): number => a.distanceKm - b.distanceKm;
  const byPhase = (ph: Phase): Row[] => singles.filter((r) => r.phase === ph).sort((a, b) => a.sortAt - b.sortAt || near(a, b));
  const byDistance = sortBy === 'distance';
  const sorted = (list: Row[]): Row[] => (byDistance ? [...list].sort(near) : list);
  const sections: Array<{ title: string; rows: Row[] }> = [
    // 照距離：進行中、即將開始、稍後開始合在一起；職缺從刊登起都算「徵才中」
    ...(byDistance
      ? [{ title: '由近到遠', rows: sorted(singles) }]
      : (['active', 'soon', 'later'] as const).map((ph) => ({ title: !mod.current && ph === 'active' ? '刊登中' : (PHASE_TITLE[ph] as string), rows: byPhase(ph) }))),
    { title: SPOT_SECTION[mod.id] ?? '固定據點', rows: sorted(spotsIn) },
    ...Object.entries(POSTING_SECTION).map(([role, title]) => ({ title, rows: sorted(postingRows.get(role) ?? []) })),
    { title: laterLabel(), rows: sorted(laterRows) },
    { title: '雷達範圍外', rows: sorted(outRange) },
  ];
  const counts = { active: byPhase('active').length, soon: byPhase('soon').length, later: byPhase('later').length };
  const none = mod.current && followed().length === 0;
  const outText = outRange.length > 0 ? `・範圍外 ${outRange.length} 個` : '';
  const spotText = spotsIn.length > 0 ? `・據點 ${spotsIn.length} 個` : '';
  const laterText = laterRows.length > 0 ? `・${timeSetting === 'now' ? '還沒開始' : laterLabel().replace('才開始', '')} ${laterRows.length} 個` : '';
  const searching = (searchTerms.length > 0 ? `搜尋「${searchInput.value.trim()}」・` : '') + (typePick ? `${typeLabel(typePick)}・` : '') + (dayPick ? `${dayPickLabel()}・` : '');
  countLabel.textContent = none
    ? '還沒追蹤關鍵字'
    : searching && rows.length === 0
      ? `${searching}找不到`
      : !mod.current
        ? `${searching}${moduleSummary(singles, spotsIn, postingRows) || mod.emptyText}${outText}`
        : singles.length === 0
          ? `${searching}${theme.emptyText}${spotText}${laterText}${outText}`
          : `${searching}${theme.summary(counts)}${spotText}${laterText}${outText}`;
  emptyEl.textContent =
    searchTerms.length > 0
      ? `目前的發放、活動裡沒有符合「${searchInput.value.trim()}」的。可以換個字，或按 ✕ 清除搜尋。`
      : typePick
        ? `目前沒有「${typeLabel(typePick)}」的發放、活動。再按一次「${typeLabel(typePick)}」清除。`
      : dayPick
        ? `${dayPickLabel()}沒有發放、活動。可以換一天，或按「日期」清除。`
      : none
        ? '目前沒有搜尋中的關鍵字。'
        : `${emptyText()}。點清單上方的「↻ 更新」看有沒有新的，或在旁邊打開自動更新。`;
  listEl.replaceChildren();
  emptyEl.hidden = items.length > 0;
  // 清單上的順序（活動卡片的上一個、下一個照這個；車掃路線的卡片不算）
  listOrder = sections.flatMap((sec) => sec.rows.flatMap((r) => (r.route ? [] : [r.it.ev.id])));
  // 排序：清單有兩則以上才顯示
  sortGroup.hidden = rows.length < 2;
  for (const b of sortChips) {
    const on = b.dataset.sort === sortBy;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  // 「日期」每個雷達都有，這一排一直顯示
  filterRow.hidden = false;
  // 每一段的標題寫上數量，跟上面的摘要對得起來
  for (const sec of sections) {
    if (sec.rows.length === 0) continue;
    const d = document.createElement('li');
    d.className = 'ev-divider';
    d.textContent = `${sec.title}（${sec.rows.length}）`;
    listEl.appendChild(d);
    for (const row of sec.rows) listEl.appendChild(row.route ? routeCard(row.route, row.phase, items, now) : itemCard(row.it, now));
  }
}

/** 清單卡片的時間：還沒開始的把「還有多久」加粗、換強調色 */
function timeLineHtml(it: Item, now: number): string {
  const text = esc(timeLine(it, now));
  if (!isUpcoming(it)) return text;
  const left = esc(startsIn(reportedStop(it.ev)?.at ?? it.ev.startAt, now));
  return text.replace(left, `<b class="countdown">${left}</b>`);
}

function itemCard(it: Item, now: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = `ev phase-${it.phase} kind-${it.ev.kind}${it.spot ? ' spot' : ''}${it.spot && isOffice(it.ev) ? ' office' : ''}${inScope(it.distanceKm) ? '' : ' out-of-range'}${it.ev.id === selectedId ? ' selected' : ''}`;
  li.dataset.id = String(it.ev.id);
  li.innerHTML = `
    <div class="ev-title"><span class="dot"></span><span class="kind-tag">${tagLabel(it)}</span>${esc(titleOf(it.ev))}${it.ev.item ? ` <span class="muted">· ${esc(it.ev.item)}</span>` : ''}${it.ev.kind === 'job' && jobRisky(it.ev) ? '<span class="risk-tag">⚠️ 注意</span>' : ''}${followed().length > 1 && it.ev.keyword ? `<span class="ev-kw">#${esc(it.ev.keyword)}</span>` : ''}</div>
    <div class="ev-meta">${esc(placeLine(it.ev))} · ${it.ev.approxArea ? '約 ' : ''}${formatKm(it.distanceKm)} ${compassLabel(it.bearing)}</div>
    <div class="ev-time">${it.spot ? `${esc(spotHours(it.spot.sessions))}・` : ''}${timeLineHtml(it, now)}</div>${tagsOf(it.ev).length > 0 ? `<div class="ev-tagline">${tagsHtml(tagsOf(it.ev))}</div>` : ''}`;
  li.addEventListener('click', () => {
    beginSteps();
    select(it.ev.id);
    if (selectedId !== it.ev.id) return;
    // 手機：清單往下縮一段，縮好（雷達變大）才照新的大小算縮放
    if (shrinkPanel()) afterPanel(() => selectedId === it.ev.id && goToItem(it));
    else goToItem(it);
  });
  return li;
}

/** 清單的高度動畫（0.25 秒）結束再做；減少動態效果時沒有動畫，最多等 0.4 秒 */
function afterPanel(fn: () => void): void {
  let done = false;
  const run = (): void => {
    if (done) return;
    done = true;
    panelEl.removeEventListener('transitionend', onEnd);
    fn();
  };
  const onEnd = (e: TransitionEvent): void => {
    if (e.target === panelEl && e.propertyName === 'max-height') run();
  };
  panelEl.addEventListener('transitionend', onEnd);
  window.setTimeout(run, 400);
}

/**
 * 點清單上的一則（或活動卡片的 ▲ ▼）：不改位置（雷達中心還是原本的），縮放到看得到這一則（使用者說的）——
 * 在外圈外面、或手機上會被下面的卡片蓋住的就拉遠，擠在正中間的就拉近，讓它落在半徑的七成（手機往下的照卡片蓋到哪算）；其他照舊。
 * 選到的那一則雷達、地圖上都有一圈亮環。地圖移到看得到；太空裡看別的星球時只選取
 */
const FIT_IN = 0.12;
function goToItem(it: Item): void {
  const { lat, lng } = it.ev;
  if (lat == null || lng == null) return;
  if (view === 'map') {
    map.panIntoView({ lat, lng }, sheetCover());
    return;
  }
  if (radar.spaceFocused) return;
  if (radar.spaceMoved) radar.resetSpace();
  // 手機的卡片從下面蓋住雷達：照卡片上緣和這一則在哪個方向，算往這個方向最多到半徑的多少看得到（光點、亮環留 24 像素）；電腦的卡片在右邊，不蓋雷達
  let [fitOut, fitAt] = [0.85, 0.7];
  if (!window.matchMedia('(min-width: 900px)').matches && !detailEl.hidden) {
    const c = radar.screenCenter();
    const rpx = radar.rangePx();
    const south = -Math.cos(((bearingDeg(origin, { lat, lng }) - radar.headingDeg) * Math.PI) / 180);
    if (south > 0 && rpx > 0) {
      fitOut = Math.min(fitOut, Math.max(0.15, (detailEl.getBoundingClientRect().top - 24 - c.y) / (rpx * south)));
      fitAt = Math.min(fitAt, fitOut * 0.85);
    }
  }
  const d = haversineKm(origin, { lat, lng });
  const target = d > scaleKm * fitOut || d < scaleKm * FIT_IN ? Math.max(d / fitAt, earthMinKm(), 0.3) : scaleKm;
  if (Math.abs(target / scaleKm - 1) > 0.02) zoomToKm(target);
}

function routeCard(r: RouteOut, phase: Phase, items: Item[], now: number): HTMLLIElement {
  const mine = routeItems(r, items);
  const nearest = [...mine].sort((a, b) => a.distanceKm - b.distanceKm)[0];
  const start = r.stops.find((s) => s.kind === 'start');
  const end = r.stops.find((s) => s.kind === 'end');
  const li = document.createElement('li');
  li.className = `ev route-card phase-${phase} kind-activity${mine.some((m) => inScope(m.distanceKm)) ? '' : ' out-of-range'}${selectedRoute === r.id ? ' selected' : ''}`;
  li.innerHTML = `
    <div class="ev-title"><span class="dot"></span><span class="kind-tag">${isParade(r) ? '遊行' : '車掃'}</span>${esc(r.title)}${isParade(r) ? '' : ` <span class="muted">· ${r.stops.length} 站</span>`}</div>
    <div class="ev-meta">${
      isParade(r)
        ? `🏳️‍🌈 ${esc(start?.name ?? '')}出發再回來 · ${esc(paradeWays(r))}`
        : `🚩 ${esc(start?.name ?? '')} → 🏁 ${esc(end?.name ?? '')}${isReported(r) ? '' : ` · 全長 ${routeKm(r).toFixed(1)} km`}`
    }${nearest ? ` · ${isReported(r) ? '離你最近' : '最近'} ${formatKm(nearest.distanceKm)}` : ''}</div>
    <div class="ev-time">${esc(routeTimeLine(r, items, now))}</div>`;
  li.addEventListener('click', () => {
    selectRoute(r.id);
    if (selectedRoute === r.id) shrinkPanel();
  });
  return li;
}

/** 車掃路線的時間表：每一站的時間、距離，點了看那一站 */
function renderRouteDetail(r: RouteOut, items: Item[], now: number): void {
  const mine = routeItems(r, items);
  // 還沒出發：平常雷達、地圖上只有起點
  const planned = routeState(r, now) === 'planned';
  // 回報的車掃：標出離你最近、還沒經過的那一站
  const nearestStop = isReported(r) ? [...mine].filter((x) => x.ev.endAt > now).sort((a, b) => a.distanceKm - b.distanceKm)[0] : undefined;
  const people = r.segments.reduce((n, s) => n + s.people, 0);
  const target = r.segments.reduce((n, s) => n + s.target, 0);
  const needy = [...r.segments].filter((sg) => crowdOf(sg.people, sg.target) === 'empty' || crowdOf(sg.people, sg.target) === 'low').length;
  const stopRows = r.stops
    .map((st, i) => {
      const it = mine.find((x) => (isReported(r) ? stopMatches(st, x.ev) : x.ev.title === st.title));
      const time = st.at ? `${st.kind === 'cheer' || (isReported(r) && st.kind === 'end') ? '約 ' : ''}${fmtTime(st.at)}` : '—';
      const passed = st.at !== null && st.at <= now && st.kind !== 'end';
      // 終點接著有活動（例如市政開講）就附上活動時間
      const extra = st.kind === 'end' && it && !isReported(r) && !it.ev.allDay && !it.ev.title.includes('抵達') ? `<small>${esc(it.ev.title.split('・')[0])} ${fmtTime(it.ev.startAt)}–${fmtTime(it.ev.endAt)}</small>` : '';
      const near = it && it === nearestStop ? '・離你最近' : '';
      // 回報的車掃：沒放上雷達的站講原因（經過了不用講）
      // 沒有確切位置的：知道在哪的人直接回報那一站的地點（管理者標好就放上雷達）
      const fix = st.lat === null && mine[0] ? `<button type="button" class="stop-fix" data-fix="${i}">我知道在哪</button>` : '';
      const why = !it && isReported(r) && !passed ? `<small>${st.lat === null ? '沒有確切位置，不在雷達上' : '不在雷達上'}</small>${fix}` : '';
      const dist = it ? `<small>${formatKm(it.distanceKm)} ${compassLabel(it.bearing)}${near}</small>` : why;
      // 回報的人地點填地址的：站名下面另外列地址
      const place = st.place ? `<small class="stop-place">${esc(shortAddress(st.place))}</small>` : '';
      const body = `<span class="stop-time">${time}</span><span class="stop-name"><b>${stopLabelHtml(r, st.kind)}</b>${esc(st.name)}${place}${extra}${dist}</span>`;
      return { at: st.at, html: `<li class="stop stop-${st.kind}${passed ? ' passed' : ''}${near ? ' nearest' : ''}">${it ? `<button type="button" data-select="${it.ev.id}">${body}</button>` : `<div>${body}</div>`}</li>` };
    });
  // 中間點（官方車掃轉彎的地方）照時間排進去；沒有時間的放在起點後面
  const turnRows = routeTurns(r).map((t) => {
    const { verb, road } = turnParts(t.name);
    const passed = t.at !== null && t.at <= now;
    const body = `<span class="stop-time">${t.at ? `約 ${fmtTime(t.at)}` : '—'}</span><span class="stop-name"><b>${verb}</b>${esc(road)}<small>${formatKm(haversineKm(origin, t))} ${compassLabel(bearingDeg(origin, t))}</small></span>`;
    return { at: t.at, html: `<li class="stop stop-turn${passed ? ' passed' : ''}"><div>${body}</div></li>` };
  });
  const rows = (
    [...stopRows, ...turnRows].every((x) => x.at !== null) ? [...stopRows, ...turnRows].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)) : [...stopRows.slice(0, 1), ...turnRows, ...stopRows.slice(1)]
  )
    .map((x) => x.html)
    .join('');
  detailEl.hidden = false;
  setDetailHtml(`route:${r.id}`, `
    <div class="sheet-head">
      <strong>${esc(r.title)}</strong>
      <button type="button" class="chip" data-act="close" aria-label="關閉">關閉</button>
    </div>
    <div class="sheet-body">
      ${
        isParade(r)
          ? `<p>${esc(routeTimeLine(r, items, now))}<br><span class="muted">${r.departAt ? `${dateFmt.format(new Date(r.departAt * 1000))}・` : ''}${r.segments.length} 條路線同時出發</span></p>
             <ul class="parade-ways">${r.segments.map((s) => `<li><b>${esc(s.from)}</b>${esc(s.to)}<small>${(s.lengthM / 1000).toFixed(1)} km</small></li>`).join('')}</ul>`
          : isReported(r)
            ? `<p>${esc(routeTimeLine(r, items, now))}<br><span class="muted">${r.departAt ? `${dateFmt.format(new Date(r.departAt * 1000))}・` : ''}共 ${r.stops.length} 站</span></p>`
            : `<p>${esc(routeTimeLine(r, items, now))}<br><span class="muted">全長 ${routeKm(r).toFixed(1)} km・沿線認領 ${people.toLocaleString()} / 目標 ${target.toLocaleString()} 人${needy > 0 ? `・還有 ${needy} 段缺人` : ''}（${fmtTime(r.updatedAt)} 更新）</span></p>`
      }
      <ol class="route-stops">${rows}</ol>
      ${planned ? `<p class="muted sheet-note">還沒出發：平常雷達和地圖上只顯示起點，點開這個${isParade(r) ? '遊行' : '車掃'}時才畫出整條路線，出發後一直顯示。</p>` : ''}
      <p class="muted sheet-note">${
        isParade(r)
          ? '時間和路線是主辦單位公布的（回到市民廣場的時間是警方預估），以現場為準。雷達和地圖上的彩虹照公布的道路畫。'
          : isReported(r)
          ? '時間是貼文寫的預計時間，僅供參考，以現場為準。雷達上每一站從預計經過前 10 分鐘顯示到經過後 15 分鐘；地圖上各站用直線連起來，不是實際走的路。'
          : '中間點、加油點的時間是用路線長度平均推算的，實際以現場為準。雷達和地圖上跑的洋流號是動畫（約 24 秒開完一趟、重複播放），不是車隊的實際位置。官方提醒：不跟車，在沿線等車隊經過；不放鞭炮。'
      }</p>
      ${isReported(r) && mine[0]?.ev.post.permalink ? `<p class="muted sheet-note">來源：<a href="${esc(mine[0].ev.post.permalink)}" target="_blank" rel="noopener">${esc(mine[0].ev.post.username ? `@${mine[0].ev.post.username} 的貼文` : '原貼文')}</a></p>` : ''}
      ${isParade(r) && mine[0]?.ev.post.permalink ? `<p class="muted sheet-note">來源：<a href="${esc(mine[0].ev.post.permalink)}" target="_blank" rel="noopener">${esc(mine[0].ev.post.username ?? '主辦單位')}官網</a></p>` : ''}
      ${relatedHtml(routeRelated(r, items))}
      <div class="sheet-actions">
        ${r.claimUrl ? `<a class="btn primary" href="${esc(r.claimUrl)}" target="_blank" rel="noopener">到車掃地圖認領路段</a>` : ''}
        ${noMapView() ? '' : '<button type="button" class="btn" data-act="route-map">在地圖上看路線</button>'}
        ${isReported(r) && mine[0] ? '<button type="button" class="btn" data-act="route-feedback">回報問題</button>' : ''}
        ${isReported(r) && myReportIds.has(r.postId) ? '<button type="button" class="btn" data-act="route-withdraw">刪除我的回報</button>' : ''}
      </div>
    </div>`);
  detailEl.querySelector('[data-act="close"]')?.addEventListener('click', () => selectRoute(null));
  for (const b of detailEl.querySelectorAll<HTMLButtonElement>('[data-select]')) {
    b.addEventListener('click', () => select(Number(b.dataset.select)));
  }
  // 車掃是整則貼文一起刪（每一站、路線），所以放在時間表，不放在個別的站
  detailEl.querySelector('[data-act="route-withdraw"]')?.addEventListener('click', async () => {
    if (await withdrawMine(r.postId)) selectRoute(null);
  });
  detailEl.querySelector('[data-act="route-feedback"]')?.addEventListener('click', () => {
    if (mine[0]) openFeedback(mine[0].ev, r);
  });
  for (const b of detailEl.querySelectorAll<HTMLButtonElement>('[data-fix]')) {
    b.addEventListener('click', () => {
      if (mine[0]) openFeedback(mine[0].ev, r, Number(b.dataset.fix));
    });
  }
  detailEl.querySelector('[data-act="route-map"]')?.addEventListener('click', () => {
    // 收起時間表，不然整條路線被蓋住；還沒出發的路線照樣畫出來（點其他地方才收起）
    selectedRoute = null;
    routeOnMap = planned ? r.id : null;
    render();
    switchView('map');
    map.focusRoute(r.id);
  });
}

function renderChooser(items: Item[], now: number): void {
  const list = (choosing ?? []).map((id) => items.find((x) => x.ev.id === id)).filter((x): x is Item => !!x);
  if (list.length === 0) {
    choosing = null;
    detailEl.hidden = true;
    return;
  }
  detailEl.hidden = false;
  setDetailHtml('chooser', `
    <div class="sheet-head">
      <strong>這裡有 ${list.length} 個</strong>
      <button type="button" class="chip" data-act="close" aria-label="關閉">關閉</button>
    </div>
    <div class="sheet-body">
      <p class="muted sheet-note">位置疊在一起，選一個看詳細資料。</p>
      <ul class="report-events">${list
        .map(
          (it) =>
            `<li><button type="button" data-select="${it.ev.id}"><b>${esc(tagLabel(it))}｜${esc(titleOf(it.ev))}</b><small>${esc(placeLine(it.ev))} · ${it.ev.approxArea ? '約 ' : ''}${formatKm(it.distanceKm)} ${compassLabel(it.bearing)}</small><small>${esc(timeLine(it, now))}</small></button></li>`,
        )
        .join('')}</ul>
    </div>`);
  detailEl.querySelector('[data-act="close"]')?.addEventListener('click', () => select(null));
  for (const b of detailEl.querySelectorAll<HTMLButtonElement>('[data-select]')) {
    b.addEventListener('click', () => select(Number(b.dataset.select)));
  }
}

/** 固定地標（洋流總部）：地址、距離、導航 */
function renderLandmarkDetail(id: string): boolean {
  const lm = LANDMARKS.find((x) => x.id === id);
  if (!lm) return false;
  detailEl.hidden = false;
  setDetailHtml(`landmark:${id}`, `
    <div class="sheet-head">
      <strong>★ ${esc(lm.name)}</strong>
      <button type="button" class="chip" data-act="close" aria-label="關閉">關閉</button>
    </div>
    <div class="sheet-body">
      <p>${esc(lm.address)}<br><span class="muted">${formatKm(haversineKm(origin, lm))} ${compassLabel(bearingDeg(origin, lm))}</span></p>
      <p>${esc(lm.about)}</p>
      <div class="sheet-actions">
        <a class="btn primary" href="https://www.google.com/maps/dir/?api=1&destination=${lm.lat},${lm.lng}&travelmode=walking" target="_blank" rel="noopener">導航</a>
        ${lm.links.map((l) => `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a>`).join('')}
        <a class="btn" href="${googleMapsUrl(lm)}" target="_blank" rel="noopener">在 Google 地圖上看</a>
      </div>
    </div>`);
  detailEl.querySelector('[data-act="close"]')?.addEventListener('click', () => selectLandmark(null));
  return true;
}

// ---- 漂流瓶 ----
/** 伺服器沒關（v1.593 起直接開放，不用再打開實驗功能） */
const bottlesOn = (): boolean => mod.current && keywordRules?.sources?.bottles?.enabled !== false;
const bottleRules = (): NonNullable<KeywordRules['sources']>['bottles'] => keywordRules?.sources?.bottles;
const pickRadiusM = (): number => bottleRules()?.pickRadiusM ?? 1000;
/** 看內容、收藏、收回的距離寫成字：1000 → 「1 km」、500 → 「500 m」 */
const reachText = (m: number = pickRadiusM()): string => (m >= 1000 ? `${+(m / 1000).toFixed(1)} km` : `${m} m`);
/** 瓶子的編號：No.000123 */
const bottleNo = (id: number): string => `No.${String(id).padStart(6, '0')}`;
const findBottle = (id: number): BottleOut | undefined => bottles.find((b) => b.id === id) ?? woofBottles.find((b) => b.id === id);
/** 雷達上拿掉這個瓶子（沉下去、收回、檢舉）；keepMine：自己丟的留著 */
function removeBottleMark(id: number, keepMine = false): void {
  const keep = (b: BottleOut): boolean => b.id !== id || (keepMine && b.mine);
  bottles = bottles.filter(keep);
  woofBottles = woofBottles.filter(keep);
}

/** 你在汪星（搭火箭過去）、雷達正中間是汪星：正中間就是你在汪星的位置（汪星沒有 GPS，拖曳就是走路）；不然是 null */
function woofHere(): LatLng | null {
  if (youOn !== 'woof' || !spaceMod) return null;
  const v = radar.spaceViewNow;
  return v.focus === 'woof' ? spaceMod.woofCenter(v) : null;
}
/** 汪星上兩點的距離（公尺）：球面上的角度一樣，照汪星的半徑換算 */
const woofDistM = (a: LatLng, b: LatLng): number => (haversineKm(a, b) / 6371) * (spaceMod?.WOOF_KM ?? 6.56) * 1000;

/** 瓶子離你多遠（公尺）：地球上的照你的位置，汪星海上的照你在汪星的位置（不在汪星是 Infinity） */
function bottleDistM(b: BottleOut): number {
  if (b.world !== 'woof') return haversineKm(origin, b) * 1000;
  const at = woofHere();
  return at ? woofDistM(at, b) : Infinity;
}
/** 瓶子在你的哪個方向 */
const bottleDir = (b: BottleOut): string => compassLabel(bearingDeg(b.world === 'woof' ? (woofHere() ?? origin) : origin, b));

/**
 * 走到 pickRadiusM 內才算 pick（打開來看、收藏）：地球上要用 GPS 定位（手動位置不算），汪星上照你在汪星的位置。
 * 瓶子遠近都直接畫出來（v1.598 使用者說不需要模糊；以前 200 m 外只是一團模糊的訊號）
 */
function bottleState(b: BottleOut): 'near' | 'pick' {
  return bottleDistM(b) <= pickRadiusM() && (b.world === 'woof' || origin.source === 'gps') ? 'pick' : 'near';
}

/** 方向提示最遠指到多遠的瓶子 */
const BOTTLE_HINT_MAX_KM = 1;

/** 漂流瓶只看得到 1 km 內的（v1.622 使用者說 5 km，v1.655 改 1 km） */
const bottleSeeKm = (): number => bottleRules()?.seeKm ?? 1;
/** 地球上從哪裡算 1 km：你的 GPS 位置（拖曳過雷達也一樣），沒有 GPS 就從雷達正中間 */
const bottleCenter = (): LatLng => (origin.source === 'gps' ? origin : (lastGps ?? origin));
/**
 * 雷達拉近到這個範圍以內才畫瓶子：汪星（v1.666 使用者說汪星的 1 km 是雷達縮放的 1 km，汪星沒有定位系統）、
 * 地球（v1.670 使用者說在 1 km 看到後拉遠也看得到）都一樣；範圍的標籤寫「1.0 km」的都算
 */
const SEE_ZOOM_KM = 1;
const zoomSees = (km = scaleKm): boolean => km < SEE_ZOOM_KM * 1.05;
/** 瓶子在不在附近：地球上離你（GPS）1 km 內；汪星海上的離你在汪星的位置（雷達正中間）1 km 內 */
function bottleNear(b: BottleOut): boolean {
  if (b.world !== 'woof') return haversineKm(bottleCenter(), b) <= bottleSeeKm();
  const here = woofHere();
  return !!here && woofDistM(here, b) <= SEE_ZOOM_KM * 1000;
}
/** 雷達上畫不畫這個瓶子：在附近，而且雷達拉近到 1 km 以內（km 是雷達現在的範圍）；地圖照地圖自己的縮放（map.ts 的 gateBottles） */
const bottleSeen = (b: BottleOut, km = scaleKm): boolean => zoomSees(km) && bottleNear(b);

/** 雷達範圍內沒有別人的瓶子時，最近的那一個（貼在外圈指方向）；太遠就不指 */
function nearestHint<V extends { b: BottleOut; distanceKm: number }>(views: V[]): V | null {
  const others = views.filter((v) => !v.b.mine);
  if (others.some((v) => v.distanceKm <= scaleKm)) return null;
  const best = others.reduce<V | null>((a, v) => (!a || v.distanceKm < a.distanceKm ? v : a), null);
  return best && best.distanceKm <= BOTTLE_HINT_MAX_KM ? best : null;
}

/** 按鈕：附近有還沒人收藏、不是自己丟的瓶子走到 1 km 內了就發光（你在汪星就看汪星海上的）；數字是今天還能丟幾個 */
function updateBottleBadge(views: Array<{ b: BottleOut; distanceKm: number }>): void {
  bottleBtn.hidden = !bottlesOn();
  const others = youOn === 'woof' ? woofBottles.filter((b) => !b.mine && !b.picked && !b.taken && bottleNear(b)) : views.filter((v) => !v.b.mine && !v.b.picked && !v.b.taken).map((v) => v.b);
  bottleBtn.classList.toggle('glow', others.some((b) => bottleState(b) === 'pick'));
  paintQuotaBadge();
}

/**
 * 按鈕上的數字＝今天還能丟幾個（v1.605 使用者說的；以前是雷達範圍內的瓶子數）：
 * 這個瀏覽器丟過瓶子就等讀到伺服器的額度才顯示（v1.608：以前重整後先顯示 3 才跳成正確的數字），沒丟過就是每天的上限；
 * 用完了（0）不顯示數字
 */
function paintQuotaBadge(): void {
  // 汪星上不能丟（v1.631）：不顯示還能丟幾個
  if (youOn === 'woof') {
    bottleBadge.hidden = true;
    bottleBtn.title = '漂流瓶：汪星上不能丟，搭火箭回地球才能丟';
    bottleBtn.setAttribute('aria-label', '漂流瓶，汪星上不能丟');
    return;
  }
  const left = myBottlesData ? myBottlesData.quota.left : lsGet(LS_BOTTLE_DROPPED) ? null : (bottleRules()?.perDay ?? 3);
  bottleBadge.hidden = !left;
  if (left) bottleBadge.textContent = String(left);
  const say = left === null ? '漂流瓶' : left === 0 ? '漂流瓶：今天的瓶子丟完了' : `漂流瓶：今天還能丟 ${left} 個`;
  bottleBtn.title = say;
  bottleBtn.setAttribute('aria-label', say.replace('：', '，'));
}

/** 汪星海上的瓶子（space.ts 畫在汪星上）：每次畫汪星都重算，拖曳走路時走到附近了沒跟著變 */
function woofBottleMarks(km = scaleKm): WoofBottleMark[] {
  return woofBottles.filter((b) => bottleSeen(b, km)).map((b) => ({ id: b.id, lat: b.lat, lng: b.lng, state: bottleState(b) === 'pick' ? 'pick' : 'near', mine: b.mine, selected: b.id === selectedBottle, taken: b.picked || !!b.taken, read: readBottles.has(b.id) }));
}
let woofMarksKey = '';
/** 汪星海上的瓶子、選取變了：重畫汪星 */
function syncWoofBottles(): void {
  const key = woofBottles.map((b) => `${b.id}${b.picked || b.taken ? 'p' : ''}${readBottles.has(b.id) ? 'r' : ''}${b.id === selectedBottle ? 's' : ''}`).join(',');
  if (key === woofMarksKey) return;
  woofMarksKey = key;
  radar.redrawSpace();
}
/** 你在汪星才抓汪星海上的瓶子（回地球就清掉） */
async function loadWoofBottles(): Promise<void> {
  if (!bottlesOn() || !woofMap()) {
    if (woofBottles.length) {
      woofBottles = [];
      render();
    }
    return;
  }
  woofBottles = withMine(await fetchWoofBottles());
  render();
}
/** 在汪星上拖曳（走路）：按鈕的光、選著的瓶子還差多遠跟著變 */
function onWoofWalk(): void {
  if (!woofBottles.length) return;
  updateBottleBadge([]);
  const b = selectedBottle !== null ? findBottle(selectedBottle) : undefined;
  if (b?.world === 'woof' && !detailEl.hidden) renderBottleDetail(b.id);
}

const stampFmt = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
/** 漂了多遠：50 m 以內算沒漂 */
const driftText = (m: number): string => (m >= 50 ? formatKm(m / 1000) : '');

const daysLeft = (until: number): string => {
  const d = Math.ceil((until - nowSec()) / 86400);
  return d <= 1 ? '今天' : `${d} 天`;
};
/** 收藏後在原地留幾小時（之後只在收藏的人那裡；v1.645） */
const KEEP_TAKEN_H = 24;
/** 被收藏的瓶子還會在原地留多久：「收藏後在原地留 24 小時（還剩 5 小時）」 */
function keepText(b: BottleOut): string {
  if (!b.takenAt) return `收藏後在原地留 ${KEEP_TAKEN_H} 小時，之後只在收藏的人的漂流瓶收藏裡`;
  const m = Math.max(1, Math.round((b.takenAt + KEEP_TAKEN_H * 3600 - nowSec()) / 60));
  return `再 ${m < 60 ? `${m} 分鐘` : `${Math.round(m / 60)} 小時`}就收進收藏的人的漂流瓶收藏，雷達上就看不到了`;
}

/** 還有多久漂到汪星（丟下後 seaHours 小時） */
function seaIn(createdAt: number): string {
  const m = Math.max(0, Math.round((createdAt + (bottleRules()?.seaHours ?? 24) * 3600 - nowSec()) / 60));
  return m < 60 ? `${Math.max(1, m)} 分鐘` : `${Math.round(m / 60)} 小時`;
}

/** 別人的瓶子丟的時間只說到小時（伺服器只給整點，v1.669 隱私評估） */
function agoCoarse(unix: number): string {
  const h = Math.floor((nowSec() - unix) / 3600);
  if (h < 1) return '1 小時內';
  return h < 24 ? `約 ${h} 小時前` : `${Math.floor(h / 24)} 天前`;
}

function ago(unix: number): string {
  const m = Math.max(0, Math.round((nowSec() - unix) / 60));
  if (m < 60) return m <= 1 ? '剛剛' : `${m} 分鐘前`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} 小時前`;
  return `${Math.floor(m / 1440)} 天前`;
}

function selectBottle(id: number | null, thrown = false): void {
  selectedBottle = selectedBottle === id ? null : id;
  justThrown = thrown ? selectedBottle : null;
  bottleMsg = '';
  openTried.clear();
  selectedId = null;
  selectedRoute = null;
  selectedLandmark = null;
  choosing = null;
  selectedGroup = [];
  if (selectedBottle !== null) {
    themeSheet.hidden = true;
    kwSheet.hidden = true;
    reportSheet.hidden = true;
    bottleSheet.hidden = true;
    // 別人丟在地球上的：還沒用 GPS 定位就先定位（打開來看、收藏要 GPS）
    const b = findBottle(selectedBottle);
    if (b && !b.mine && !b.picked && b.world !== 'woof' && origin.source !== 'gps' && youOn === 'earth' && !tripping) void locateMe();
  }
  render();
}

/** 你在哪裡（打開來看、收藏、檢舉、看照片要帶）：地球上的瓶子是 GPS 位置（手動位置不算），汪星海上的是你在汪星的位置 */
const hereFor = (b: BottleOut): BottleHere => (b.world === 'woof' ? { at: woofHere(), world: 'woof' } : { at: origin.source === 'gps' ? origin : null, world: 'earth' });

/** 這次選取已經試著打開過的瓶子（打不開就不一直重試，換一個瓶子再說） */
const openTried = new Set<number>();

/** 打開來看（不收藏）：自己丟的、收藏過的隨時看得到；別人的走到 1 km 內就看得到，收藏了也一樣 */
async function openBottle(id: number): Promise<void> {
  const b = findBottle(id);
  if (!b) return;
  const r = await readBottle(id, b.mine || b.picked ? undefined : hereFor(b));
  if (!r.ok) {
    bottleMsg = r.message;
    if (/沉下去|收藏走了/.test(r.message)) removeBottleMark(id, true);
  } else {
    bottleTexts.set(id, r.data);
    bottleMsg = '';
  }
  render();
}

/** 瓶子的狀態跟著改（雷達上、詳細資料都是） */
function markBottle(id: number, patch: Partial<BottleOut>): void {
  const up = (b: BottleOut): BottleOut => (b.id === id ? { ...b, ...patch } : b);
  bottles = bottles.map(up);
  woofBottles = woofBottles.map(up);
  const got = bottleTexts.get(id);
  if (got) bottleTexts.set(id, { ...got, bottle: { ...got.bottle, ...patch } });
}

/** 這次打開網頁自己收藏的瓶子：之後重新抓到的瓶子（可能是收藏之前就開始抓的）照樣算你收藏的 */
const collectedNow = new Set<number>();
/** 收藏中的瓶子（按鈕重畫了也不會送兩次） */
const collecting = new Set<number>();
/** 重新抓到的瓶子：自己剛收藏的照樣標成你收藏的 */
const withMine = (list: BottleOut[]): BottleOut[] => (collectedNow.size ? list.map((b) => (collectedNow.has(b.id) ? { ...b, picked: true, taken: true } : b)) : list);

/** 收藏（v1.601 使用者說「撿起來」改成「收藏」、瓶子不用消失）：一個瓶子只有第一個人收藏得到，收藏後瓶子照樣留在雷達上 */
async function collectBottle(id: number): Promise<void> {
  const b = findBottle(id);
  if (!b || collecting.has(id)) return;
  collecting.add(id);
  const r = await pickBottle(id, hereFor(b)).finally(() => collecting.delete(id));
  if (!r.ok) {
    bottleMsg = r.message;
    // 真的被別人收藏了（「晚了一步」）才標成已收藏；走不夠近、還沒定位的訊息裡也有「收藏」兩個字，不算
    // 汪星海上的被收藏了就不在海上了
    if (/晚了一步/.test(r.message)) {
      if (b.world === 'woof') {
        removeBottleMark(id);
        showBanner(bannerEl, r.message, 3000);
      } else markBottle(id, { taken: true });
    } else if (/已經沉下去/.test(r.message)) removeBottleMark(id, true);
  } else if (b.world === 'woof') {
    // 汪星海上的：一收藏就從海上消失、直接放進收藏櫃（v1.664 使用者說的）
    collectedNow.add(id);
    removeBottleMark(id);
    selectedBottle = null;
    bottleMsg = '';
    showBanner(bannerEl, '收藏了！瓶子放進選單「收藏」的櫃子裡了', 3000);
    void reloadMyBottles();
  } else {
    collectedNow.add(id);
    bottleTexts.set(id, r.data);
    markBottle(id, { picked: true, taken: true, picks: 1, takenAt: nowSec() });
    bottleMsg = '';
    showBanner(bannerEl, `收藏了！瓶子在原地留 ${KEEP_TAKEN_H} 小時，之後收進選單的「收藏」`, 3000);
    void reloadMyBottles();
  }
  render();
}

/** 貼在牛皮紙上的照片（還沒載入的，fillPhotos 去拿） */
const tapedPhoto = (id: number): string => `<figure class="taped-photo"><img data-photo="${id}" alt="瓶子裡的照片（點了放大）" /></figure>`;
/** 牛皮紙上的一段話（有照片的話貼在上面） */
const kraftNote = (text: string, no: number, photo = false): string =>
  `<div class="kraft-note"><span class="kraft-no">${bottleNo(no)}</span>${photo ? tapedPhoto(no) : ''}<p>${esc(text)}</p></div>`;

/** 牛皮紙上的照片：還沒載入的去拿（看得到內容的人才拿得到；走到附近看的人帶位置 here），拿不到就拿掉 */
function fillPhotos(root: Element, here?: BottleHere): void {
  for (const img of root.querySelectorAll<HTMLImageElement>('img[data-photo]:not([src])')) {
    void fetchBottlePhoto(Number(img.dataset.photo), here).then((u) => {
      if (u) img.src = u;
      else img.closest('figure')?.remove();
    });
  }
}

/** 點了照片：放大看 */
function showPhoto(src: string): void {
  overlay('tc-photo', `<div class="tc-box photo-box"><img class="photo-big" src="${esc(src)}" alt="瓶子裡的照片" /><button type="button" class="chip" data-close>關閉</button></div>`);
}

/** 選好的照片在瀏覽器裡縮到長邊 1280、重新存成 JPEG（GPS、相機等資訊就沒了），太大再降品質；讀不出來丟錯誤 */
async function shrinkPhoto(file: File): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const [w, h] = [Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k))];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  for (const q of [0.82, 0.7, 0.55, 0.4]) {
    const url = c.toDataURL('image/jpeg', q);
    if (url.length * 0.75 < 650_000) return url;
  }
  throw new Error('too big');
}

/** 牛皮紙上要放進瓶子的照片：有就貼上去，null 是拿掉 */
function setBottlePhoto(url: string | null): void {
  bottlePhotoData = url;
  bottlePhotoFig.hidden = !url;
  const img = bottlePhotoFig.querySelector('img')!;
  if (url) img.src = url;
  else img.removeAttribute('src');
  bottlePhotoInput.value = '';
}

/** 雷達或地圖上點了瓶子：距離；走到附近就打開來看（收藏了別人也看得到）；收藏、分享、證明、檢舉或收回 */
function renderBottleDetail(id: number): boolean {
  // b 先拿雷達上最新的（被收藏了沒）；從分享連結、收藏頁來的用打開時拿到的資料
  const got = bottleTexts.get(id);
  const b = findBottle(id) ?? got?.bottle;
  if (!b) return false;
  const woof = b.world === 'woof';
  const d = bottleDistM(b);
  const reach = pickRadiusM();
  const near = bottleState(b) === 'pick';
  const where = woof ? `汪星的海上，約 ${formatKm(d / 1000)} ${bottleDir(b)}` : `約 ${formatKm(d / 1000)} ${bottleDir(b)}`;
  // 自己丟的、收藏過的、走到附近的：打開來看（每次選取只試一次）；被收藏的也一樣（v1.646 使用者說地圖上只要標記被收藏）
  const canOpen = b.mine || b.picked || near;
  if (!got && canOpen && !openTried.has(id)) {
    openTried.add(id);
    void openBottle(id);
  }
  const lifecycle = b.taken ? keepText(b) : woof ? `漂到汪星的海上了，${daysLeft(b.expiresAt)}後沉下去` : `在附近漂，${seaIn(b.createdAt)}後漂到汪星的海上`;
  let body: string;
  if (got) {
    const status = b.mine
      ? `你${ago(b.createdAt)}丟的・${b.taken ? '已經被收藏了' : `還沒有人收藏（自己丟的不能收藏，別人走到 ${reachText(reach)} 內就看得到、收藏得到）`}・${lifecycle}`
      : b.picked
        ? `${agoCoarse(b.createdAt)}丟的・你收藏了，放在「漂流瓶收藏」`
        : b.taken
          ? `${agoCoarse(b.createdAt)}丟的・已經被別人收藏了・${lifecycle}`
          : `${agoCoarse(b.createdAt)}丟的・還沒有人收藏・${lifecycle}`;
    const showText = justThrown !== id;
    body = `${showText ? kraftNote(got.text, b.id, got.photo) : ''}<p class="muted">${esc(status)}</p>`;
    // 顯示了內容就算看過：雷達、地圖上的這個瓶子換成空瓶（這一輪已經畫好了，下一格再畫一次）
    if (showText && !readBottles.has(id)) {
      markBottleRead(id);
      requestAnimationFrame(() => render());
    }
  } else if (canOpen) {
    body = '<p class="muted">打開瓶子中…</p>';
  } else {
    const taken = b.taken ? '已經被收藏了，' : '';
    body =
      woof && youOn !== 'woof'
        ? `<p>這個瓶子漂到汪星的海上了，${taken}點中山公園的銅像搭火箭到汪星，拖曳雷達走到 ${reachText(reach)} 內就能打開來看${b.taken ? '' : '、收藏'}。</p>`
        : woof && !woofHere()
          ? `<p>這個瓶子在汪星的海上，${taken}把雷達的中心移回汪星（點汪星），拖曳走過去就能打開來看。</p>`
          : !woof && origin.source !== 'gps'
            ? `<p>瓶子在${esc(where)}，${taken}按右上角「定位」用 GPS，走到 ${reachText(reach)} 內就能打開來看${b.taken ? '' : '、收藏'}。</p>`
            : `<p>瓶子在${esc(where)}，${taken}還差約 ${Math.round(d - reach)} m。${woof ? '拖曳雷達走過去' : '走近一點'}就能打開來看${b.taken ? '' : '、收藏'}。</p>`;
  }
  const canCollect = !!got && !b.mine && !b.picked && !b.taken && near && !collecting.has(id);
  detailEl.hidden = false;
  setDetailHtml(
    `bottle:${id}`,
    `
    <div class="sheet-head">
      <strong>${b.mine ? '你丟的漂流瓶' : '漂流瓶'} <span class="bottle-no">${bottleNo(b.id)}</span></strong>
      <button type="button" class="chip" data-act="close" aria-label="關閉">關閉</button>
    </div>
    <div class="sheet-body">
      ${body}
      ${bottleMsg ? `<p class="msg error">${esc(bottleMsg)}</p>` : ''}
      <div class="sheet-actions">
        ${canCollect ? '<button type="button" class="btn primary" data-act="pick">收藏</button>' : ''}
        ${!got && !b.mine && !b.picked && !near && !woof ? `<a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}&travelmode=walking" target="_blank" rel="noopener">走過去</a>` : ''}
        ${got && (b.mine || b.picked) ? '<button type="button" class="btn" data-act="proof">瓶子證明</button>' : ''}
        ${got && !b.mine ? '<button type="button" class="btn subtle" data-act="report">檢舉</button>' : ''}
        ${b.mine && canWithdraw(b.taken ? 'picked' : 'active') ? `<button type="button" class="btn subtle" data-act="delete"${withdrawing.has(b.id) ? ' disabled' : ''}>收回</button>` : ''}
      </div>
      <p class="muted sheet-note small">${
        woof
          ? '汪星沒有 GPS：搭火箭到汪星後，雷達正中間就是你的位置，拖曳就是走路。'
          : '瓶子一丟出去就落在丟的地方 1 km 內的隨機位置，之後在這 1 km 內漂，不是丟的人站的地方。'
      }</p>
    </div>`,
    true,
  );
  fillPhotos(detailEl, b.mine || b.picked ? undefined : hereFor(b));
  detailEl.querySelector('[data-act="close"]')?.addEventListener('click', () => selectBottle(null));
  detailEl.querySelector('[data-act="pick"]')?.addEventListener('click', (e) => {
    (e.currentTarget as HTMLButtonElement).disabled = true;
    void collectBottle(id);
  });
  detailEl.querySelector('[data-act="proof"]')?.addEventListener('click', () => {
    if (got) void showProof(id, got.text);
  });
  detailEl.querySelector('[data-act="report"]')?.addEventListener('click', async (e) => {
    if (!window.confirm('這個瓶子有攻擊性內容或個人資料？檢舉後會交給管理者確認。')) return;
    (e.currentTarget as HTMLButtonElement).disabled = true;
    const r = await reportBottle(id, b.picked ? undefined : hereFor(b));
    if (!r.ok) {
      bottleMsg = r.message;
    } else {
      showBanner(bannerEl, '謝謝檢舉，這個瓶子已經藏起來，會交給管理者確認', 3000);
      if (r.data.hidden) {
        removeBottleMark(id);
        bottleTexts.delete(id);
        selectedBottle = null;
        void reloadMyBottles();
      }
    }
    render();
  });
  detailEl.querySelector('[data-act="delete"]')?.addEventListener('click', async (e) => {
    if (withdrawing.has(id) || !window.confirm(withdrawAsk(!!b.taken))) return;
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    withdrawing.add(id);
    const r = await deleteBottle(id);
    withdrawing.delete(id);
    if (!r.ok) {
      bottleMsg = r.message;
    } else {
      removeBottleMark(id);
      selectedBottle = null;
      showBanner(bannerEl, '瓶子收回了，已經銷毀', 2000);
    }
    render();
  });
  return true;
}

/**
 * 瓶子證明：編號、丟的時間、內容的指紋（SHA-256）、伺服器的簽章；按「驗證」先在這裡算一次內容的指紋，
 * 再請伺服器核對簽章：對得上就是洋流雷達發出的瓶子、內容沒被改過（瓶子沉下去、刪掉了也驗得出來）
 */
async function showProof(id: number, text: string): Promise<void> {
  // 已經開著就不再開一層（點兩下會疊兩層，按 ✕ 只關上面那層，看起來像卡住：v1.628 使用者說按 ✕ 有時候也卡住）
  if (document.querySelector('.tc-overlay.tc-proof')) return;
  // 畫面馬上出來（v1.610 使用者說點開、關閉有點慢）：編號、丟的時間、內容的指紋這裡就有，簽章等伺服器回來再補；拿過的記起來
  const createdAt = findBottle(id)?.createdAt ?? bottleTexts.get(id)?.bottle.createdAt ?? myBottlesData?.letters.find((l) => l.id === id)?.createdAt ?? null;
  const el = overlay(
    'tc-proof',
    `<div class="tc-box bottle-proof">
      <button type="button" class="proof-x" data-close aria-label="關閉">✕</button>
      <h2 class="tc-title">瓶子證明</h2>
      <dl>
        <dt>編號</dt><dd>${bottleNo(id)}</dd>
        <dt>丟的時間</dt><dd data-f="time">${createdAt ? esc(stampFmt.format(new Date(createdAt * 1000))) : '讀取中…'}</dd>
        <dt>內容的指紋（SHA-256）</dt><dd class="mono" data-f="sha">計算中…</dd>
        <dt>簽章</dt><dd class="mono" data-f="sig">讀取中…</dd>
      </dl>
      <p class="tc-note">每個瓶子的編號都不一樣。內容只要改一個字，指紋就不一樣；簽章是伺服器用只有它知道的金鑰簽的，別人做不出來。</p>
      <p class="proof-result" aria-live="polite"></p>
      <div class="sheet-actions"><button type="button" class="chip primary" data-act="verify" disabled>驗證</button></div>
    </div>`,
  );
  const field = (f: string): HTMLElement => el.querySelector<HTMLElement>(`[data-f="${f}"]`)!;
  const out = el.querySelector<HTMLElement>('.proof-result')!;
  const verifyBtn = el.querySelector<HTMLButtonElement>('[data-act="verify"]')!;
  const digestP = crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then((d) => [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join(''));
  void digestP.then((d) => (field('sha').textContent = d));
  let p = proofCache.get(id);
  if (!p) {
    // 讀太久（網路卡住）就不等了，說一聲；隨時都可以關（右上角 ✕、下面的「關閉」、點旁邊）（v1.626 使用者說讀取中也要能關，不然會卡住）
    const slow = new Promise<null>((done) => window.setTimeout(() => done(null), PROOF_WAIT_MS));
    const r = await Promise.race([fetchBottleProof(id), slow]);
    if (!el.isConnected) return;
    if (!r || !r.ok) {
      field('sig').textContent = '—';
      out.className = 'proof-result bad';
      out.textContent = r ? r.message : '簽章讀不到（網路可能太慢），可以先關掉，等一下再看';
      return;
    }
    p = r.data;
    proofCache.set(id, p);
  }
  const proof = p;
  field('time').textContent = stampFmt.format(new Date(proof.createdAt * 1000));
  field('sig').textContent = proof.sig;
  verifyBtn.disabled = false;
  verifyBtn.addEventListener('click', async () => {
    verifyBtn.disabled = true;
    out.className = 'proof-result';
    out.textContent = '驗證中…';
    const digest = await digestP;
    const v = digest === proof.sha256 ? await verifyBottleProof(proof) : null;
    verifyBtn.disabled = false;
    out.className = `proof-result ${v?.ok && v.data.valid ? 'ok' : 'bad'}`;
    out.textContent =
      digest !== proof.sha256
        ? '✗ 這封信的內容跟指紋對不上'
        : !v?.ok
          ? v?.message ?? '暫時沒辦法驗證，請稍後再試'
          : v.data.valid
            ? `✓ 是洋流雷達發出的瓶子 ${bottleNo(proof.no)}，內容沒有被改過`
            : '✗ 簽章對不上，這不是洋流雷達發出的瓶子';
  });
}

/** 簽章最多等幾毫秒 */
const PROOF_WAIT_MS = 8000;
/** 看過的瓶子證明（同一個瓶子不用再跟伺服器拿） */
const proofCache = new Map<number, BottleProof>();

/** 打開分享出去的瓶子連結（?bottle=編號）：瓶子還在（收藏了也還在）就選起來（看得到在哪、多遠），沉下去了就說一聲 */
async function openSharedBottle(id: number): Promise<void> {
  const url = new URL(location.href);
  url.searchParams.delete('bottle');
  history.replaceState(history.state, '', url);
  const r = await fetchBottleInfo(id);
  if (!r.ok) return;
  // 收藏滿 24 小時，只在收藏的人那裡（v1.645）
  if (r.data.state === 'kept') {
    showBanner(bannerEl, r.data.yours ? `漂流瓶 ${bottleNo(id)} 在你的「漂流瓶收藏」裡` : `漂流瓶 ${bottleNo(id)} 已經被收藏走了`, 4000);
    return;
  }
  if (r.data.state === 'gone') {
    showBanner(bannerEl, `漂流瓶 ${bottleNo(id)} 已經沉下去或不見了`, 4000);
    return;
  }
  // 伺服器不給編號查位置（v1.669 隱私評估）：重抓附近的瓶子，在裡面、看得到才選起來；看不到的只說一聲
  const woof = r.data.world === 'woof';
  if (woof) await loadWoofBottles();
  else await reloadBottles();
  const b = findBottle(id);
  if (!b || !bottleNear(b)) {
    showBanner(
      bannerEl,
      woof
        ? `漂流瓶 ${bottleNo(id)} 漂到汪星的海上了，搭火箭到汪星、走到附近，雷達拉近到 ${reachText(SEE_ZOOM_KM * 1000)} 才看得到`
        : `漂流瓶 ${bottleNo(id)} 在你 ${reachText(bottleSeeKm() * 1000)} 外，走近一點才看得到`,
      4000,
    );
    return;
  }
  // 雷達拉近到 1 km 才畫得出來
  if (!zoomSees()) zoomToKm(SEE_ZOOM_KM);
  selectedBottle = null;
  selectBottle(id);
}

/** 移出收藏。成功回傳 true */
async function removeLetter(id: number): Promise<boolean> {
  if (!window.confirm('移出收藏後，這個瓶子就變回還沒有人收藏，別人走到附近又可以收藏。要移出嗎？')) return false;
  const r = await uncollectLetter(id);
  if (!r.ok) {
    showBanner(bannerEl, r.message, 3000);
    return false;
  }
  // 雷達上的這個瓶子也變回還沒有人收藏；內容要走到附近再打開
  collectedNow.delete(id);
  markBottle(id, { picked: false, taken: false, picks: 0 });
  bottleTexts.delete(id);
  openTried.delete(id);
  showBanner(bannerEl, '移出收藏了，這個瓶子又可以被收藏了', 2500);
  render();
  await reloadMyBottles();
  return true;
}

/** 重新讀「我的瓶子」，畫在打開中的漂流瓶面板和收藏頁 */
async function reloadMyBottles(): Promise<void> {
  const r = await fetchMyBottles();
  if (!r.ok) return;
  myBottlesData = r.data;
  if (r.data.dropped.length > 0) lsSet(LS_BOTTLE_DROPPED, '1');
  if (!lettersPage.hidden) renderLettersPage();
  paintQuotaBadge();
  if (!bottleSheet.hidden) sceneQuota();
  updateBottleNews();
}

/** 「我丟的瓶子」只列 24 小時內丟的（v1.661 使用者說超過 24 小時不用顯示；伺服器也只回 24 小時內的，這裡擋網頁開很久的） */
const recentDropped = (): NonNullable<typeof myBottlesData>['dropped'] => (myBottlesData?.dropped ?? []).filter((b) => nowSec() - b.createdAt < 86400);

/** 自己丟的瓶子有沒有新被收藏的（上次看「我丟的瓶子」之後） */
function newlyPicked(): number {
  const seen = Number(lsGet(LS_BOTTLE_SEEN) ?? 0);
  return recentDropped().filter((b) => b.pickedAt !== null && b.pickedAt > seen).length;
}

/** 按鈕上的小紅點；這次打開網頁第一次發現時跳一次提示 */
function updateBottleNews(): void {
  const n = newlyPicked();
  bottleBtn.classList.toggle('news', n > 0);
  menuNews.letters = n > 0;
  paintMenuNews();
  if (n > 0 && !bottleNewsShown && bottleSheet.hidden) {
    bottleNewsShown = true;
    showBanner(bannerEl, `你丟的瓶子${n > 1 ? `有 ${n} 個` : ''}被收藏了！打開選單的「收藏」看看`, 4000);
  }
}

/** 丟過瓶子才去問（打開網頁、回到網頁時） */
async function checkBottleNews(): Promise<void> {
  if (!bottlesOn() || !lsGet(LS_BOTTLE_DROPPED)) return;
  await reloadMyBottles();
}

/**
 * 打開漂流瓶（v1.594 使用者說：按下去畫面中間直接出現牛皮紙和瓶子、盡量仿真，不要輸入框、不要任何提示，說明放在說明頁）：
 * 牛皮紙上直接寫，點軟木塞就捲起來裝進去丟出去；左上 📜 是漂流瓶收藏和我丟的瓶子、📷 貼一張照片
 */
function openBottleSheet(open: boolean): void {
  bottleSheet.hidden = !open;
  document.body.classList.toggle('bottle-open', open);
  if (!open) return;
  themeSheet.hidden = true;
  kwSheet.hidden = true;
  reportSheet.hidden = true;
  selectedId = null;
  selectedRoute = null;
  selectedLandmark = null;
  selectedBottle = null;
  detailEl.hidden = true;
  bottleResult.textContent = '';
  // 先直接定位（v1.600 使用者說按漂流瓶先定位）：丟瓶子、看瓶子、收藏都要 GPS；在汪星不用（汪星上拖曳就是走路）
  if (youOn === 'earth' && !tripping) void locateMe();
  renderBottleSheet();
  void reloadMyBottles();
  // 電腦上直接可以打字；手機等點了紙才跳出鍵盤（不然鍵盤蓋住瓶子）
  if (matchMedia('(pointer: fine)').matches) bottleText.focus();
}

const bottleMaxWeight = (): number => bottleRules()?.maxWeight ?? X_MAX_WEIGHT;

/** 字數超過才在紙角寫多了幾個字（比照 X：中文算 2）；寫了字、沒超過，瓶子輕輕晃（點得下去） */
function updateDropBtn(): void {
  const max = bottleMaxWeight();
  const n = xLength(bottleText.value.trim());
  const over = n > max;
  bottleCount.hidden = !over;
  bottleCount.textContent = over ? `多了 ${Math.ceil((n - max) / 2)} 字` : '';
  bottleDropEl.classList.toggle('ready', n > 0 && !over && !throwing);
  bottlePhotoBtn.hidden = !bottleRules()?.photos || youOn === 'woof';
}

function renderBottleSheet(): void {
  updateDropBtn();
  sceneQuota();
}

/**
 * 今天丟完了：不顯示紙和瓶子（v1.605 使用者說超過額度不用顯示），只寫還要多久才能再丟；左上角的收藏頁照樣進得去。
 * 丟瓶子動畫進行中（剛丟完最後一個）不動
 */
function sceneQuota(): void {
  if (throwing) return;
  const q = myBottlesData?.quota;
  // 只有在地球才能丟，汪星不能丟（v1.631 使用者說的）：跟丟完了一樣不顯示紙和瓶子；汪星海上的瓶子照樣可以收藏
  const onWoof = youOn === 'woof';
  const out = onWoof || (!!q && q.left === 0);
  bottleSheet.classList.toggle('no-throw', out);
  if (!out) {
    if (bottleResult.dataset.quota) bottleResult.textContent = '';
    delete bottleResult.dataset.quota;
    return;
  }
  if (onWoof) {
    bottleResult.textContent = '汪星上不能丟瓶子，搭火箭回地球才能丟';
    bottleResult.dataset.quota = '1';
    return;
  }
  if (!q) return;
  // 每天 00:00 恢復成 3 個（v1.621）：寫還有多久
  const mins = q.nextAt ? Math.max(1, Math.ceil((q.nextAt - nowSec()) / 60)) : null;
  const wait = mins === null ? '' : mins < 60 ? `（還有 ${mins} 分鐘）` : `（還有約 ${Math.round(mins / 60)} 小時）`;
  bottleResult.textContent = `今天的 ${q.limit} 個瓶子都丟完了，00:00 會恢復成 ${q.limit} 個${wait}`;
  bottleResult.dataset.quota = '1';
}

/** 換到地球、汪星：按鈕上的數字、開著的漂流瓶畫面跟著換（汪星不能丟） */
function bottleWorldChanged(): void {
  paintQuotaBadge();
  if (!bottleSheet.hidden) renderBottleSheet();
}

/**
 * 自己丟的瓶子收不收得回來：還在的都可以（收藏了的也一樣），隨時、不用走過去（v1.669 隱私評估：丟的人要能刪掉自己的內容；
 * 以前是 24 小時內、走到瓶子 1 km 內，v1.657 收回前先自動定位也就不用了）
 */
const canWithdraw = (status: string): boolean => status === 'active' || status === 'hidden' || status === 'picked';
/** 收回中的瓶子（送出的時候畫面重畫了，再按也不會送兩次） */
const withdrawing = new Set<number>();
const withdrawAsk = (taken: boolean): string =>
  taken ? '這個瓶子已經被收藏了，收回就銷毀，收藏的人也看不到了。要收回嗎？' : '要收回這個瓶子嗎？收回就銷毀，內容和照片都會刪掉。';

/** 收藏頁下面「我丟的瓶子」：狀態、收回 */
function paintMyBottles(): void {
  const data = myBottlesData;
  if (!data) return;
  const { quota } = data;
  const dropped = recentDropped();
  const seen = Number(lsGet(LS_BOTTLE_SEEN) ?? 0);
  const statusText = (b: (typeof dropped)[number]): string => {
    const drift = driftText(b.driftM);
    return b.status === 'picked'
      ? `被收藏了${b.pickedAt ? `（${ago(b.pickedAt)}）` : ''}${b.world === 'woof' ? '・在汪星的海上被收藏' : drift ? `・在離丟的地方 ${drift} 的地方被收藏` : ''}`
      : b.status === 'hidden'
        ? '被檢舉，暫時藏起來'
        : b.status === 'removed'
          ? '已被管理者移除'
          : b.status === 'deleted'
            ? '沒人收藏，沉下去了'
            : b.world === 'woof'
              ? `漂到汪星的海上了・${daysLeft(b.expiresAt)}後沉下去`
              : `在附近漂${drift ? `（離丟的地方 ${drift}）` : ''}・${seaIn(b.createdAt)}後漂到汪星的海上`;
  };
  lettersMine.innerHTML = dropped.length
    ? `<h3>我丟的瓶子<small class="muted">・今天還能丟 ${quota.left} 個</small></h3><ul class="spot-mine">${dropped
        .map((b) => {
          const fresh = b.pickedAt !== null && b.pickedAt > seen;
          return `<li><span class="spot-mine-body"><b class="bottle-no">${bottleNo(b.id)}</b>${b.photo ? '📷' : ''}「${esc(b.text)}」<small>${fresh ? '<b class="new-tag">新</b>' : ''}${ago(b.createdAt)}丟的・${esc(statusText(b))}</small></span>${
            canWithdraw(b.status) ? `<button type="button" class="chip spot-cancel" data-delete-bottle="${b.id}" data-taken="${b.status === 'picked' ? 1 : 0}">收回</button>` : ''
          }</li>`;
        })
        .join('')}</ul>`
    : '';
  // 看過了：之後不再提示這些
  const latest = Math.max(0, ...dropped.map((b) => b.pickedAt ?? 0));
  if (latest > seen) lsSet(LS_BOTTLE_SEEN, String(latest));
  bottleBtn.classList.remove('news');
  menuNews.letters = false;
  paintMenuNews();
}

/** 牛皮紙和瓶子那一頁：瓶子、軟木塞畫上去；點軟木塞丟出去（v1.657 使用者說點瓶子不用送出）、📷 貼照片、✕／Esc 收起來（寫的字留著）；收藏頁在選單的「收藏」 */
function wireBottleScene(): void {
  // 放到最外層，蓋過頂端列（清單面板自己是一層，裡面的東西蓋不過頂端列）
  document.body.append(bottleSheet);
  // 軟木塞小小的：外面包一個 50 px 的按鈕（手機縮小後也有 43 px），手指好點
  bottleDropEl.innerHTML = `${bottleSvg('scb')}<button type="button" class="cork-btn" aria-label="塞上軟木塞，捲起來裝進瓶子丟出去">${corkSvg('scc')}</button>`;
  bottleDropEl.querySelector('.cork-btn')!.addEventListener('click', () => void submitBottle());
  bottleSheet.addEventListener('click', (e) => {
    const t = e.target as Element;
    // 審核中：關閉按不了（CSS 也擋，這裡再擋一次鍵盤）
    if (judging) return;
    if (t.closest('[data-act="close"]')) openBottleSheet(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || document.querySelector('.tc-overlay')) return;
    if (!bottleSheet.hidden && !throwing && !judging) openBottleSheet(false);
    // 收藏頁拿出來看的信：放回瓶子
    else if (!lettersPage.hidden) closeLetter();
  });
  bottleText.addEventListener('input', () => {
    bottleResult.textContent = '';
    updateDropBtn();
  });
  const attachPhoto = async (file: File): Promise<void> => {
    bottleResult.textContent = '';
    try {
      setBottlePhoto(await shrinkPhoto(file));
    } catch {
      setBottlePhoto(null);
      bottleResult.textContent = '這張照片讀不出來，換一張試試';
    }
  };
  bottlePhotoInput.addEventListener('change', () => {
    const file = bottlePhotoInput.files?.[0];
    if (file) void attachPhoto(file);
  });
  // 直接貼上複製的圖片（v1.660 使用者說的）：跟 📷 選的一樣縮小、重新存檔、丟的時候審核；已經有照片就換掉。
  // 剪貼簿裡也有文字的（Word、Excel 複製的字會順便帶一張圖）照樣貼字，不當成照片
  document.addEventListener('paste', (e) => {
    if (bottleSheet.hidden || bottlePhotoBtn.hidden || judging || throwing || document.querySelector('.tc-overlay')) return;
    const cd = e.clipboardData;
    if (!cd || cd.getData('text/plain').trim()) return;
    const file = [...cd.items].find((it) => it.kind === 'file' && it.type.startsWith('image/'))?.getAsFile();
    if (!file) return;
    e.preventDefault();
    void attachPhoto(file);
  });
  bottlePhotoFig.querySelector('.photo-remove')?.addEventListener('click', () => setBottlePhoto(null));
  // 打開來看的信、收藏的信上的照片：點了放大
  document.addEventListener('click', (e) => {
    const img = (e.target as Element).closest<HTMLImageElement>('.kraft-note .taped-photo img[src], .letter-paper .taped-photo img[src]');
    if (img) showPhoto(img.src);
  });
}

// ---- 漂流瓶收藏（獨立一頁，網址 #letters） ----
/** 收藏頁是從網頁裡打開的（關掉時用上一頁回去）；直接開 #letters 網址進來的就只清掉網址 */
let lettersPushed = false;

function openLettersPage(open: boolean): void {
  if (open === !lettersPage.hidden) return;
  if (open) {
    if (location.hash !== '#letters') {
      history.pushState(null, '', '#letters');
      lettersPushed = true;
    }
    lettersPage.hidden = false;
    document.body.classList.add('letters-open');
    renderLettersPage();
    void reloadMyBottles();
  } else {
    lettersPage.hidden = true;
    document.body.classList.remove('letters-open');
    openLetter = null;
    if (location.hash !== '#letters') return;
    if (lettersPushed) history.back();
    else history.replaceState(null, '', location.pathname + location.search);
    lettersPushed = false;
  }
}

/** 收藏頁拿出來看的信（一次一封；重新整理、離開收藏頁就放回瓶子裡） */
let openLetter: number | null = null;

/**
 * 收藏的漂流瓶（v1.662 使用者說放一個櫃子、只顯示號碼、不用太多文字說明）：木頭櫃子一層層擺著塞好軟木塞、裝著信的瓶子，
 * 瓶子下面的層板貼編號；點瓶子才把信拿出來看（蓋在收藏頁上面，✕、點旁邊、Esc 放回瓶子）。
 * 收藏還沒滿 24 小時的瓶子還在原地，不放進櫃子（v1.653、v1.654 使用者說的）
 */
function renderLettersPage(): void {
  const data = myBottlesData;
  if (!data) {
    lettersList.innerHTML = '<p class="muted">讀取中…</p>';
    return;
  }
  const { letters } = data;
  // 汪星海上收藏的一收藏就放進來（v1.664）；地球上的在原地留 24 小時
  const keepLeft = (l: MyBottles['letters'][number]): number => (l.world === 'woof' ? 0 : l.pickedAt + KEEP_TAKEN_H * 3600 - nowSec());
  const kept = letters.filter((l) => keepLeft(l) <= 0);
  const cell = (l: MyBottles['letters'][number]): string =>
    `<li><button type="button" class="cab-bottle" data-open-letter="${l.id}" aria-label="${bottleNo(l.id)}，拿出來看">${bottleSvg('')}<span class="cab-no">${bottleNo(l.id)}</span></button></li>`;
  const open = kept.find((l) => l.id === openLetter);
  if (!open) openLetter = null;
  lettersList.innerHTML =
    `<h3>收藏的漂流瓶</h3><ul class="bottle-cabinet${kept.length ? '' : ' empty'}">${
      kept.length ? kept.map(cell).join('') : `<li class="cab-empty">${letters.length ? `收藏的瓶子 ${KEEP_TAKEN_H} 小時後放進來` : '還沒有收藏的漂流瓶'}</li>`
    }</ul>` +
    (open
      ? `<div class="letter-modal" data-letter-backdrop>
          <div class="letter-paper" role="dialog" aria-modal="true" aria-label="${bottleNo(open.id)}">
            <button type="button" class="letter-x" data-close-letter="${open.id}" aria-label="放回瓶子">✕</button>
            <span class="kraft-no">${bottleNo(open.id)}</span>
            ${open.photo ? tapedPhoto(open.id) : ''}<p class="letter-text">${esc(open.text)}</p>
            <div class="letter-acts">
              <button type="button" class="link-btn" data-proof="${open.id}">瓶子證明</button>
              <button type="button" class="link-btn" data-report="${open.id}">檢舉</button>
              <button type="button" class="link-btn" data-uncollect="${open.id}">移出收藏</button>
            </div>
          </div>
        </div>`
      : '');
  fillPhotos(lettersList);
  paintMyBottles();
}

/** 拿出來看的信放回瓶子 */
function closeLetter(): void {
  if (openLetter === null) return;
  openLetter = null;
  renderLettersPage();
}

async function onLettersClick(e: Event): Promise<void> {
  const t = e.target as Element;
  // 櫃子裡的瓶子：點了把信拿出來看；✕、點信紙旁邊放回瓶子
  const openL = t.closest<HTMLElement>('[data-open-letter]');
  if (openL) {
    openLetter = Number(openL.dataset.openLetter);
    renderLettersPage();
    return;
  }
  if (t.closest('[data-close-letter]') || t.matches('[data-letter-backdrop]')) {
    closeLetter();
    return;
  }
  const del = t.closest<HTMLButtonElement>('[data-delete-bottle]');
  if (del) {
    const id = Number(del.dataset.deleteBottle);
    if (withdrawing.has(id) || !window.confirm(withdrawAsk(del.dataset.taken === '1'))) return;
    del.disabled = true;
    withdrawing.add(id);
    const r = await deleteBottle(id);
    withdrawing.delete(id);
    if (!r.ok) {
      del.disabled = false;
      showBanner(bannerEl, r.message, 3000);
      return;
    }
    removeBottleMark(id);
    showBanner(bannerEl, '瓶子收回了，已經銷毀', 2000);
    await reloadMyBottles();
    render();
    return;
  }
  const proof = t.closest<HTMLButtonElement>('[data-proof]');
  if (proof) {
    const l = myBottlesData?.letters.find((x) => x.id === Number(proof.dataset.proof));
    if (l) void showProof(l.id, l.text);
    return;
  }
  const u = t.closest<HTMLButtonElement>('[data-uncollect]');
  const rp = t.closest<HTMLButtonElement>('[data-report]');
  const btn = u ?? rp;
  if (!btn) return;
  btn.disabled = true;
  let ok = false;
  if (u) ok = await removeLetter(Number(u.dataset.uncollect));
  else if (rp && window.confirm('這封信有攻擊性內容或個人資料？檢舉後會交給管理者確認。')) {
    const res = await reportBottle(Number(rp.dataset.report));
    showBanner(bannerEl, res.ok ? '謝謝檢舉，這封信已經藏起來，會交給管理者確認' : res.message, 3000);
    ok = res.ok;
    if (ok) await reloadMyBottles();
  }
  if (!ok) btn.disabled = false;
}

/**
 * 丟出去之前的確認：把規則一條一條講清楚（v1.620 使用者說的），按「捲起來丟出去」才丟；「再想想」或點旁邊、Esc 就不丟。
 * 規則照伺服器給的數字（漂多久、汪星留幾天、多近收藏得到、每天幾個）
 */
function confirmThrow(): Promise<boolean> {
  // 已經開著（連點瓶子兩下）就不再開一層
  if (document.querySelector('.tc-overlay.tc-rules')) return Promise.resolve(false);
  const r = bottleRules();
  const left = myBottlesData?.quota.left;
  const rules = [
    '只有在地球上才能丟，瓶子會落在你現在的位置 1 km 內的隨機位置（不會在你站的地方），之後在這 1 km 內慢慢漂。',
    `沒人收藏的 ${r?.seaHours ?? 24} 小時後漂到汪星的海上，${r?.woofDays ?? 30} 天後沉下去；被收藏的不會漂走，在原地標成已收藏 ${KEEP_TAKEN_H} 小時，之後收進收藏的人的「收藏」、裝進瓶子裡。`,
    `走到瓶子 ${reachText((r?.seeKm ?? 1) * 1000)} 內、雷達拉近到 ${reachText(SEE_ZOOM_KM * 1000)} 才看得到瓶子，打開來看內容和照片，第一個按「收藏」的人會把它收進漂流瓶收藏（收藏了別人照樣看得到）。`,
    '內容和照片請當成公開的：位置是手機送出的，有心人可以假造，不要寫、拍不想讓陌生人看到的東西。',
    '不用走過去就能收回（選單「收藏」的「我丟的瓶子」，或點雷達上自己的瓶子），收回就銷毀、收藏的人也看不到了；收回的也算今天的額度。',
    `每天可以丟 ${r?.perDay ?? 3} 個，00:00 恢復成 ${r?.perDay ?? 3} 個${left !== undefined ? `；丟了這個今天還剩 ${Math.max(0, left - 1)} 個` : ''}。`,
    '送出前會自動審核：辱罵或攻擊任何人（包括候選人、政黨）、謠言、連結、電話、帳號、個人資料都不會通過。',
  ];
  return new Promise((resolve) => {
    let ok = false;
    const el = overlay(
      'tc-rules',
      `<div class="tc-box bottle-rules">
        <h2 class="tc-title">丟出去之前</h2>
        <ul>${rules.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        <div class="sheet-actions"><button type="button" class="chip" data-close>再想想</button><button type="button" class="chip primary" data-act="throw">捲起來丟出去</button></div>
      </div>`,
      () => resolve(ok),
    );
    el.querySelector('[data-act="throw"]')?.addEventListener('click', () => {
      ok = true;
      el.querySelector<HTMLElement>('[data-close]')?.click();
    });
  });
}

/**
 * 審核中（v1.626 使用者說等待審核時要鎖住畫面或做動畫）：紙不能改、關閉／收藏頁／相機都按不了、Esc 不關；
 * 一支放大鏡在紙上來回讀，瓶子輕輕浮，下面寫「審核中…」
 */
let judging = false;
function setJudging(on: boolean): void {
  judging = on;
  bottleSheet.classList.toggle('judging', on);
  bottleDropEl.classList.toggle('busy', on);
  bottleText.readOnly = on;
  bottleResult.classList.toggle('judging-msg', on);
  bottleResult.textContent = on ? '審核中' : '';
}

/** 丟瓶子的動畫進行中（不能再按一次） */
let throwing = false;

/** 點了軟木塞：沒寫字、字太多就搖一搖（不寫提示）；錯誤（定位、審核、額度）寫在下面 */
async function submitBottle(): Promise<void> {
  if (throwing || bottleDropEl.classList.contains('busy')) return;
  const text = bottleText.value.trim();
  const say = (msg: string): void => {
    bottleResult.textContent = msg;
  };
  if (!text || xLength(text) > bottleMaxWeight()) {
    bottleDropEl.classList.remove('nope');
    void bottleDropEl.offsetWidth;
    bottleDropEl.classList.add('nope');
    return;
  }
  if (youOn === 'woof') return say('搭火箭回地球才能丟瓶子');
  if (origin.source !== 'gps') return say('要先按右上角「定位」用 GPS，瓶子會丟在你現在的位置附近');
  // 按軟木塞先確認，確認前把規則講清楚（v1.601 使用者說要再確認是否送出；v1.620 說丟出前把規則說清楚）
  if (!(await confirmThrow())) return;
  const photo = bottlePhotoData;
  say('');
  setJudging(true);
  const r = await dropBottle(text, origin, photo);
  setJudging(false);
  if (!r.ok) return say(r.message);
  bottleTexts.set(r.data.bottle.id, r.data);
  if (photo && r.data.photo) rememberBottlePhoto(r.data.bottle.id, photo);
  lsSet(LS_BOTTLE_DROPPED, '1');
  // 牛皮紙捲起來、放進瓶子、塞上軟木塞，丟到雷達上；落水後打開這個瓶子（編號、瓶子證明、收回，內容剛看過就不再顯示；v1.663 分享到 Threads 拿掉了）
  throwing = true;
  updateDropBtn();
  await throwBottleFx(text, photo, () => openBottleSheet(false));
  throwing = false;
  bottleText.value = '';
  setBottlePhoto(null);
  updateDropBtn();
  bottles = [r.data.bottle, ...bottles.filter((b) => b.id !== r.data.bottle.id)];
  void reloadMyBottles();
  selectedBottle = null;
  selectBottle(r.data.bottle.id, true);
  showBanner(bannerEl, `丟出去了！${bottleNo(r.data.bottle.id)} 會在附近漂 ${bottleRules()?.seaHours ?? 24} 小時，被收藏時會通知你`, 3500);
}

/**
 * 可愛的玻璃瓶（viewBox 0 0 100 200，瓶口在上；v1.599 使用者說瓶子畫可愛風）：圓滾滾的瓶身、粗粗的圓角外框、淡水藍色、
 * 兩道白白的反光（v1.605 使用者說瓶子裡面不要有水）；裡面一捲綁著紅蝴蝶結的牛皮紙（.scroll）、瓶口的軟木塞（.cork）先藏著，丟的時候才出現
 */
function bottleSvg(_p: string): string {
  const body = 'M37 24 L37 54 C37 70 12 74 12 100 L12 164 Q12 186 34 186 L66 186 Q88 186 88 164 L88 100 C88 74 63 70 63 54 L63 24 Z';
  return `<svg class="real-bottle" viewBox="0 0 100 200" aria-hidden="true">
    <ellipse cx="50" cy="193" rx="34" ry="5" fill="#000" opacity=".18" />
    <path d="${body}" fill="#e1f7fb" fill-opacity=".35" />
    <g class="scroll">
      <!-- 捲起來的牛皮紙（v1.648 使用者說畫像一點、不綁紅帶）：圓筒右邊暗、左邊亮，上端一圈圈的紙，外層紙邊斜斜繞過去、尾巴翹起一點 -->
      <rect x="37" y="102" width="26" height="70" rx="4" fill="#e2bb84" stroke="#8a5a2c" stroke-width="2" />
      <path d="M56 106 v62" stroke="#c4955a" stroke-width="7" />
      <path d="M42.5 106 v62" stroke="#f3dcb2" stroke-width="3" stroke-linecap="round" />
      <path d="M37 128 C45 131 55 134 63 139" fill="none" stroke="#8a5a2c" stroke-width="1.6" />
      <path d="M63 139 l4 4 l-4 1 z" fill="#e8c592" stroke="#8a5a2c" stroke-width="1.4" stroke-linejoin="round" />
      <path d="M41 150 q9 2 18 1" fill="none" stroke="#b98a52" stroke-width="1.2" opacity=".7" />
      <ellipse cx="50" cy="102" rx="13" ry="4.6" fill="#f1d7aa" stroke="#8a5a2c" stroke-width="1.8" />
      <path d="M49 102 a2.6 1.1 0 1 1 3.6 0.3 a5.4 2.1 0 1 1 -8.6 -0.3 a8.4 3.2 0 1 1 13.8 0.6" fill="none" stroke="#a57240" stroke-width="1.1" />
    </g>
    <path d="${body}" fill="none" stroke="#2f6f7c" stroke-width="3.4" stroke-linejoin="round" />
    <rect x="32" y="14" width="36" height="13" rx="6.5" fill="#e6fbfd" stroke="#2f6f7c" stroke-width="3.2" />
    <path d="M22 140 L22 106 Q22 94 30 88" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".9" />
    <circle cx="22" cy="153" r="3.2" fill="#fff" opacity=".9" />
    <path d="M43 32 v14" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".85" />
    <g class="cork">
      <rect x="37" y="1" width="26" height="24" rx="7" fill="#dca468" stroke="#7a4a22" stroke-width="2.8" />
      <path d="M42 7 h12" stroke="#f3cf9c" stroke-width="2.6" stroke-linecap="round" />
      <circle cx="44" cy="16" r="1.4" fill="#9a6232" /><circle cx="55" cy="13" r="1.2" fill="#9a6232" /><circle cx="51" cy="20" r="1.1" fill="#9a6232" />
    </g>
  </svg>`;
}

/** 可愛的軟木塞（viewBox 0 0 30 28，躺在瓶子旁邊；丟的時候飛進瓶口） */
function corkSvg(_p: string): string {
  return `<svg class="real-cork" viewBox="0 0 30 28" aria-hidden="true">
    <rect x="2" y="2" width="26" height="24" rx="7" fill="#dca468" stroke="#7a4a22" stroke-width="2.8" />
    <path d="M7 8 h12" stroke="#f3cf9c" stroke-width="2.6" stroke-linecap="round" />
    <circle cx="9" cy="17" r="1.4" fill="#9a6232" /><circle cx="20" cy="14" r="1.2" fill="#9a6232" /><circle cx="16" cy="21" r="1.1" fill="#9a6232" />
  </svg>`;
}

/** 雷達（或地圖）正中間在畫面上的哪裡：瓶子丟到這裡 */
function landingPoint(): { x: number; y: number } {
  const el = view === 'map' ? document.querySelector('#map') : document.querySelector('#radar-view .me');
  const r = el?.getBoundingClientRect();
  return r && r.width + r.height > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: innerWidth / 2, y: innerHeight / 3 };
}

/**
 * 丟瓶子的動畫（約 4 秒，可愛不可怕）：牛皮紙從下往上捲成一捲 → 捲好的紙移到瓶口、滑進瓶子 → 躺在旁邊的軟木塞跳起來塞進瓶口 →
 * 收起畫面，瓶子轉著圈拋到雷達正中間（你的位置）→ 落水，一圈圈水波，瓶子晃一晃。
 * 用蓋在上面的一份來動（原本的紙、瓶子先藏起來）。系統設定「減少動態效果」也照樣播（v1.600 使用者說電腦版沒有丟出去的動畫；
 * 這是自己按下去才播的一小段，Windows 關掉動畫效果時瀏覽器會回報減少動態）
 */
async function throwBottleFx(text: string, photo: string | null, hide: () => void): Promise<void> {
  const sheet = bottleSheet.querySelector<HTMLElement>('.kraft-sheet');
  const realBottle = bottleDropEl.querySelector('.real-bottle');
  const realCork = bottleDropEl.querySelector('.real-cork');
  if (!sheet || !realBottle || !realCork) {
    hide();
    return;
  }
  // 紙如果是斜的：用沒轉的大小、轉之前的位置（中心一樣），蓋上去的那一張也一樣斜
  const box = sheet.getBoundingClientRect();
  const [sw, sh] = [sheet.offsetWidth, sheet.offsetHeight];
  const [scx, scy] = [box.left + box.width / 2, box.top + box.height / 2];
  const from = { left: scx - sw / 2, top: scy - sh / 2, width: sw, height: sh, bottom: scy + sh / 2 };
  const t = getComputedStyle(sheet).transform;
  const tilt = t === 'none' ? '' : t;
  const br = realBottle.getBoundingClientRect();
  const cr = realCork.getBoundingClientRect();
  const k = br.width / 100;
  const fx = document.createElement('div');
  fx.className = 'bottle-fx';
  fx.setAttribute('aria-hidden', 'true');
  // 紙：跟原本一樣大、一樣的字和照片（轉正，捲起來比較好看）
  const paper = document.createElement('div');
  paper.className = 'bottle-fx-paper';
  paper.innerHTML = `<div class="kraft-bg"></div>${photo ? `<figure class="taped-photo"><img src="${esc(photo)}" alt="" /></figure>` : ''}<p>${esc(text)}</p>`;
  Object.assign(paper.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, padding: getComputedStyle(sheet).padding, transform: tilt || 'none' });
  // 捲筒：一開始在紙的最下面，細細的（直徑 ROLL0），越捲越粗（ROLL1）
  const [ROLL0, ROLL1] = [8, 24];
  const roll = document.createElement('div');
  roll.className = 'bottle-fx-roll';
  // 捲筒擺在捲完的位置（紙的最上面、粗 ROLL1），一開始用 transform 移到紙的最下面、壓細（跟紙的裁切一樣用 transform 類的動畫，才會一直貼著紙邊）
  Object.assign(roll.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${ROLL1}px`, opacity: '0', transform: tilt || 'none' });
  const bottle = document.createElement('div');
  bottle.className = 'bottle-fx-bottle';
  bottle.innerHTML = bottleSvg('fxb');
  Object.assign(bottle.style, { left: `${br.left}px`, top: `${br.top}px`, width: `${br.width}px`, height: `${br.height}px` });
  const cork = document.createElement('div');
  cork.className = 'bottle-fx-cork';
  cork.innerHTML = corkSvg('fxc');
  Object.assign(cork.style, { left: `${cr.left}px`, top: `${cr.top}px`, width: `${cr.width}px`, height: `${cr.height}px` });
  // 捲好的紙在玻璃後面（隔著玻璃看得到），軟木塞在最上面
  fx.append(paper, roll, bottle, cork);
  document.body.append(fx);
  sheet.style.visibility = 'hidden';
  bottleDropEl.style.visibility = 'hidden';
  const run = (el: Element, frames: Keyframe[], o: KeyframeAnimationOptions): Promise<unknown> => el.animate(frames, { fill: 'forwards', ...o }).finished;
  try {
    // 1. 牛皮紙從下往上捲起來（1.1 秒）：紙本身不壓扁，下面捲進去的部分不見（裁掉），捲筒沿著裁切的邊往上走、越捲越粗
    const ease = 'cubic-bezier(.45,.05,.55,.95)';
    await Promise.all([
      run(paper, [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: `inset(0 0 ${from.height - ROLL1 / 2}px 0)` }], { duration: 1100, easing: ease }),
      run(roll, [{ transform: `${tilt} translateY(${from.height - ROLL1 / 2}px) scaleY(${ROLL0 / ROLL1})`.trim() }, { transform: tilt || 'none' }], { duration: 1100, easing: ease }),
      run(roll, [{ opacity: 0 }, { opacity: 1, offset: 0.06 }, { opacity: 1 }], { duration: 1100 }),
    ]);
    paper.remove();
    // 2. 捲好的紙轉直、縮成瓶子裡那一捲的大小，移到瓶口上面（0.6 秒），再滑進瓶子（0.45 秒）
    //    位移從捲好的位置（中心 from.top + ROLL1 / 2）算；瓶口在 (50, 14)、瓶子裡那一捲的中心在 (50, 135)、長 74、粗 24（瓶子的座標）
    const [mx, cx0, cy0] = [br.left + 50 * k, from.left + from.width / 2, from.top + ROLL1 / 2];
    const shape = `rotate(90deg) scaleX(${(74 * k) / from.width}) scaleY(${(24 * k) / ROLL1})`;
    const above = br.top + 14 * k - 37 * k - 4;
    await run(roll, [{ transform: tilt || 'none' }, { transform: `translate(${mx - cx0}px, ${above - cy0}px) ${shape}` }], { duration: 600, easing: 'ease-in-out' });
    const scroll = bottle.querySelector('.scroll')!;
    await Promise.all([
      run(roll, [{ transform: `translate(${mx - cx0}px, ${above - cy0}px) ${shape}` }, { transform: `translate(${mx - cx0}px, ${br.top + 135 * k - cy0}px) ${shape}` }], { duration: 450, easing: 'ease-in' }),
      run(scroll, [{ opacity: 0 }, { opacity: 0, offset: 0.7 }, { opacity: 1 }], { duration: 450 }),
    ]);
    roll.remove();
    // 3. 軟木塞跳起來、轉正，塞進瓶口（0.5 秒），換成瓶子上的那個
    const cc = { x: cr.left + cr.width / 2, y: cr.top + cr.height / 2 };
    const neck = { x: mx, y: br.top + 13 * k };
    const [dx, dy] = [neck.x - cc.x, neck.y - cc.y];
    await run(
      cork,
      [
        { transform: 'translate(0, 0) rotate(-78deg)' },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) rotate(-200deg)`, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy - 6}px) rotate(-360deg) scale(${(26 * k) / cr.width})`, offset: 0.85 },
        { transform: `translate(${dx}px, ${dy}px) rotate(-360deg) scale(${(26 * k) / cr.width})` },
      ],
      { duration: 520, easing: 'ease-out' },
    );
    cork.remove();
    bottle.querySelector('.cork')?.setAttribute('style', 'opacity: 1');
    // 4. 收起畫面，瓶子轉著圈拋到雷達正中間（1.2 秒，拋物線）
    hide();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const to = landingPoint();
    const [bx, by] = [to.x - (br.left + br.width / 2), to.y - (br.top + br.height / 2)];
    const arc = Math.min(240, 90 + Math.hypot(bx, by) * 0.35);
    const end = 18 / br.height;
    const frames: Keyframe[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      frames.push({ transform: `translate(${(bx * t).toFixed(1)}px, ${(by * t - arc * 4 * t * (1 - t)).toFixed(1)}px) rotate(${Math.round(540 * t)}deg) scale(${(1 - (1 - end * 2.2) * t).toFixed(3)})` });
    }
    await run(bottle, frames, { duration: 1200, easing: 'cubic-bezier(.3,.1,.5,1)' });
    // 5. 落水：一圈圈水波，瓶子斜斜地晃一晃（0.9 秒）
    for (const delay of [0, 220]) {
      const ring = document.createElement('div');
      ring.className = 'bottle-fx-ripple';
      Object.assign(ring.style, { left: `${to.x}px`, top: `${to.y}px` });
      fx.append(ring);
      void run(ring, [{ transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0.9 }, { transform: 'translate(-50%, -50%) scale(1.6)', opacity: 0 }], { duration: 800, delay, easing: 'ease-out' });
    }
    const at = `translate(${bx}px, ${by}px)`;
    const sc = (end * 2.2).toFixed(3);
    await run(
      bottle,
      [
        { transform: `${at} rotate(540deg) scale(${sc})` },
        { transform: `${at} rotate(515deg) scale(${sc})`, offset: 0.35 },
        { transform: `${at} rotate(560deg) scale(${sc})`, offset: 0.7 },
        { transform: `${at} rotate(540deg) scale(${sc})`, opacity: 0 },
      ],
      { duration: 900, easing: 'ease-in-out' },
    );
  } catch (e) {
    console.warn('bottle animation failed', e);
    hide();
  } finally {
    fx.remove();
    sheet.style.visibility = '';
    bottleDropEl.style.visibility = '';
  }
}

/** 活動卡片標題下面：「還有 4 小時・1.2 km」（進行中寫「進行中」；職缺、刊登沒有開始時間，只寫距離）；距離從打開卡片時雷達的中心算。
 * 詳細資料裡不再另外寫「距離」（v1.633 使用者說標題就有） */
function headMeta(it: Item, now: number): string {
  const { ev } = it;
  const when = ev.kind === 'job' || postingRole(ev) ? '' : isUpcoming(it) ? startsIn(reportedStop(ev)?.at ?? ev.startAt, now) : it.phase === 'active' ? '進行中' : '';
  const km = haversineKm(stepFrom ?? origin, ev);
  return [when, `${ev.approxArea ? '約 ' : ''}${formatKm(km)}`].filter(Boolean).join('・');
}


/** 詳細資料上次畫的內容 */
let detailHtml = '';
/**
 * 詳細資料每 5 秒重畫一次（倒數、狀態）：同一個選取還在時，保留展開的區塊（「其他貼文」「相關報導」）和捲動位置，
 * 不然點開沒多久就自己收回去。
 * steady（活動卡片）：雷達飛過去的途中（每一格畫面都會重畫）、內容跟上次一樣時不換掉，回傳 false（呼叫的人不用再接一次按鈕）——
 * 按鈕被換掉時按下、放開不是同一顆，點了不算，「上一個」「下一個」原本要等飛完、重抓完才點得動
 */
function setDetailHtml(key: string, html: string, steady = false): boolean {
  const same = detailEl.dataset.key === key;
  if (steady && same && (flight !== null || html === detailHtml)) return false;
  detailHtml = html;
  if (!steady) detailEl.style.height = '';
  const summaryKey = (d: Element): string => (d.querySelector('summary')?.textContent ?? '').replace(/（\d+）$/, '');
  const open = same ? new Set([...detailEl.querySelectorAll('details[open]')].map(summaryKey)) : new Set<string>();
  const top = detailEl.scrollTop;
  detailEl.dataset.key = key;
  // 最上面一條把手：往下拖收起來（wireSheetDrag）
  detailEl.innerHTML = `<div class="sheet-grab" aria-hidden="true"><span></span></div>${html}`;
  if (!same) {
    // 換了一則：從最上面看起
    detailEl.scrollTop = 0;
    setPeek(false);
    return true;
  }
  for (const d of detailEl.querySelectorAll<HTMLDetailsElement>('details')) if (open.has(summaryKey(d))) d.open = true;
  // 抽屜本身會捲動：展開的區塊放回去之後再還原位置
  detailEl.scrollTop = top;
  return true;
}

/**
 * 活動卡片有 ▲ ▼ 時高度固定：切上一個、下一個都照這個高度、內容多的在卡片裡捲，▲ ▼ 才不會跟著卡片長短上下跑（連按點得到）；
 * 從清單重新點一則（stepOrder 重新記）時重量。電腦：打開時量一次（至少半個畫面高，最高照 CSS 的 max-height）；
 * 手機：卡片從下面蓋住雷達，固定 PHONE_SHEET 個畫面高（使用者要矮一點，雷達露出來多一點，選到的不用拉太遠才看得到）
 */
let stepLockPx = 0;
const PHONE_SHEET = 0.42;
function lockStepHeight(on: boolean): void {
  if (!on) {
    detailEl.style.height = '';
    return;
  }
  if (!stepLockPx) {
    detailEl.style.height = '';
    const phone = !window.matchMedia('(min-width: 900px)').matches;
    stepLockPx = Math.round(phone ? window.innerHeight * PHONE_SHEET : Math.max(detailEl.offsetHeight, window.innerHeight * 0.5));
  }
  detailEl.style.height = `${stepLockPx}px`;
}

/**
 * 詳細資料的卡片可以往下拖（從最上面的把手、標題那一列）：拖一點或往下滑一下放開，收成只露出標題的一條（看得到後面的雷達、地圖）；
 * 往下滑再用力也不會關掉（關掉是按「關閉」或點其他地方）；收起來時點標題或往上拖打開
 */
const peekPx = (): number => {
  const head = detailEl.querySelector<HTMLElement>('.sheet-head');
  return head ? head.offsetTop + head.offsetHeight + 10 : 72;
};
function setPeek(on: boolean): void {
  // 手機：卡片就是下面的清單，收起來＝清單收成只露出標題那一條（wirePanelDrag）
  if (detailInPanel()) {
    panelPeek(on, detailEl);
    return;
  }
  if (on) {
    detailEl.scrollTop = 0;
    detailEl.style.setProperty('--peek', `${peekPx()}px`);
  }
  detailEl.classList.toggle('peek', on);
}

function wireSheetDrag(): void {
  let drag: { id: number; y: number; peek: boolean; base: number; low: number; last: { y: number; t: number }; v: number } | null = null;
  let dy = 0;
  let moved = false;
  detailEl.addEventListener('pointerdown', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    // 手機的卡片在清單裡：拖的是清單（wirePanelDrag）
    if (detailInPanel()) return;
    if (!t || (e.pointerType === 'mouse' && e.button !== 0) || t.closest('button, a, input, select, textarea, label') || !t.closest('.sheet-grab, .sheet-head')) return;
    const peek = detailEl.classList.contains('peek');
    // 最低拖到收起來的位置再多一點點（放開彈回收起來的位置）
    const low = Math.max(0, detailEl.offsetHeight - peekPx());
    drag = { id: e.pointerId, y: e.clientY, peek, base: peek ? low : 0, low: low + 24, last: { y: e.clientY, t: e.timeStamp }, v: 0 };
    dy = 0;
    moved = false;
    detailEl.setPointerCapture(e.pointerId);
  });
  detailEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    dy = e.clientY - drag.y;
    if (!moved && Math.abs(dy) < 6) return;
    moved = true;
    const dt = e.timeStamp - drag.last.t;
    if (dt > 0) drag.v = (e.clientY - drag.last.y) / dt;
    drag.last = { y: e.clientY, t: e.timeStamp };
    detailEl.classList.add('dragging');
    detailEl.style.transform = `translateY(${Math.min(drag.low, Math.max(0, drag.base + dy)).toFixed(1)}px)`;
  });
  const end = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    detailEl.classList.remove('dragging');
    detailEl.style.transform = '';
    // 收起來時點一下標題：打開
    if (!moved) {
      if (d.peek && e.type === 'pointerup') setPeek(false);
      return;
    }
    // 放開前還在快速滑（像素／毫秒）
    const v = e.timeStamp - d.last.t < 80 ? d.v : 0;
    if (d.peek) setPeek(!(dy < -30 || v < -0.5));
    else if (dy > 60 || v > 0.4) setPeek(true);
  };
  detailEl.addEventListener('pointerup', end);
  detailEl.addEventListener('pointercancel', end);
}

function renderDetail(items: Item[], now: number): void {
  if (selectedBottle !== null && renderBottleDetail(selectedBottle)) return;
  selectedBottle = null;
  if (selectedLandmark && renderLandmarkDetail(selectedLandmark)) return;
  selectedLandmark = null;
  const route = selectedRoute ? routes.find((r) => r.id === selectedRoute) : undefined;
  if (route && shownRoutes(items).includes(route)) {
    renderRouteDetail(route, items, now);
    return;
  }
  selectedRoute = null;
  if (choosing) {
    renderChooser(items, now);
    return;
  }
  if (selectedId === null) {
    detailEl.hidden = true;
    stepOrder = null;
    return;
  }
  const it = items.find((x) => x.ev.id === selectedId);
  if (!it) {
    selectedId = null;
    selectedRoute = null;
    selectedLandmark = null;
    selectedBottle = null;
    detailEl.hidden = true;
    return;
  }
  const { ev } = it;
  detailEl.hidden = false;
  // 清單上的上一個、下一個（照打開卡片時清單的順序；不在清單上的不顯示）
  if (!stepOrder?.includes(ev.id)) {
    beginSteps();
    stepLockPx = 0;
  } else if (stepResort) stepOrder = [...listOrder];
  stepResort = false;
  const order = stepOrder ?? listOrder;
  const at = order.indexOf(ev.id);
  const [prevId, nextId] = at < 0 ? [undefined, undefined] : [order[at - 1], order[at + 1]];
  const stepBtns =
    at < 0 || order.length < 2
      ? ''
      : `<span class="sheet-steps"><button type="button" class="chip" data-step="${prevId ?? ''}" aria-label="上一個活動" title="上一個活動"${prevId === undefined ? ' disabled' : ''}>▲</button><button type="button" class="chip" data-step="${nextId ?? ''}" aria-label="下一個活動" title="下一個活動"${nextId === undefined ? ' disabled' : ''}>▼</button></span>`;
  const replaced = setDetailHtml(`ev:${ev.id}:${prevId ?? ''}:${nextId ?? ''}`, `
    <div class="sheet-head">
      <div class="sheet-title"><strong>${esc(titleOf(ev))}</strong><span class="sheet-meta">${esc(headMeta(it, now))}</span></div>
      ${stepBtns}
      <button type="button" class="chip" data-act="close" aria-label="關閉">關閉</button>
    </div>
    <div class="sheet-body">
      ${nearbyHtml(it, items)}
      ${routeBoxHtml(ev, items, now)}
      ${ev.kind === 'job' ? jobDetailHtml(it, now) : ev.kind === 'session' ? sessionDetailHtml(it, now) : ev.kind === 'food' ? foodDetailHtml(it, now) : `<p>類型：${it.spot ? `固定據點（${kindLabel(ev)}）` : kindLabel(ev)}<br>${ev.item ? `${ev.kind === 'activity' ? '物品' : '發放'}：${esc(ev.item)}<br>` : ''}${ev.keyword ? `關鍵字：#${esc(ev.keyword)}<br>` : ''}地點：${esc(placeOf(ev))}${ev.approxArea ? `<br><span class="approx-note">約略位置：只知道在${esc(ev.approxArea)}，地圖上是${esc(ev.approxArea)}的中心點，實際地點請看原文</span>` : ''}<br>時間：${it.spot ? esc(spotSchedule(it)) : ev.allDay ? `${dateFmt.format(new Date(ev.startAt * 1000))} ${allDayText(ev, false)}` : esc(eventTimeText(ev))}</p>`}
      ${tagsOf(ev).length > 0 ? `<p class="detail-tags">${tagsHtml(tagsOf(ev), true)}</p>` : ''}
      <blockquote class="post-excerpt" title="原文摘錄，完整內容請看原文">${esc(ev.post.source === 'news' ? ev.post.text.split('\n')[0] : ev.post.text)}</blockquote>
      ${ev.post.supplement ? `<p class="muted supplement-line">回報的人補充：${esc(ev.post.supplement)}</p>` : ''}
      <p class="muted source-line">來源：${esc(sourceLabel(ev))}</p>
      ${ev.post.source === 'note' ? '<p class="muted sheet-note small preview-warn">⚠️ 沒有原貼文，是回報的人提供的，沒有查證過；出發前可以再確認一下；不對的話按「回報問題」。</p>' : ''}
      ${routeOf(ev) ? '' : it.spot ? spotPostsHtml(ev.related ?? []) : relatedHtml(ev.related ?? [])}
      <div class="sheet-actions">
        <a class="btn primary" href="https://www.google.com/maps/dir/?api=1&destination=${ev.lat},${ev.lng}&travelmode=walking" target="_blank" rel="noopener">${ev.approxArea ? '導航到約略位置' : '導航'}</a>
        <button type="button" class="btn" data-act="center">定位到活動</button>
        ${ev.post.permalink ? `<a class="btn" href="${esc(ev.post.permalink)}" target="_blank" rel="noopener">${esc(sourceLinkText(ev))}</a>` : ''}
        ${myReportIds.has(ev.post.id) && !routeOf(ev) ? '<button type="button" class="btn" data-act="withdraw">刪除我的回報</button>' : ''}
        <button type="button" class="btn" data-act="share">分享</button>
        <button type="button" class="btn" data-act="feedback">回報問題</button>
      </div>
    </div>`, true);
  if (!replaced) return;
  lockStepHeight(stepBtns !== '');
  detailEl.querySelector('[data-act="close"]')?.addEventListener('click', () => select(null));
  for (const b of detailEl.querySelectorAll<HTMLButtonElement>('[data-select]')) {
    b.addEventListener('click', () => select(Number(b.dataset.select)));
  }
  for (const b of detailEl.querySelectorAll<HTMLButtonElement>('[data-tag]')) b.addEventListener('click', () => searchTag(b.dataset.tag ?? ''));
  // 上一個、下一個活動：選它，雷達像點清單一樣飛過去
  for (const b of detailEl.querySelectorAll<HTMLButtonElement>('[data-step]')) {
    b.addEventListener('click', () => {
      const id = Number(b.dataset.step);
      const to = items.find((x) => x.ev.id === id);
      if (!b.dataset.step || !to) return;
      select(id);
      goToItem(to);
    });
  }
  // 車掃的上一站、下一站：地圖上那一站不在畫面裡就移過去
  for (const b of detailEl.querySelectorAll<HTMLButtonElement>('[data-stop-go]')) {
    b.addEventListener('click', () => {
      const id = Number(b.dataset.stopGo);
      const to = items.find((x) => x.ev.id === id)?.ev;
      select(id);
      if (view === 'map' && to?.lat != null && to.lng != null) map.panIntoView({ lat: to.lat, lng: to.lng }, sheetCover());
    });
  }
  detailEl.querySelector('[data-act="withdraw"]')?.addEventListener('click', () => void withdrawMine(ev.post.id));
  detailEl.querySelector('[data-act="feedback"]')?.addEventListener('click', () => openFeedback(ev));
  detailEl.querySelector('[data-act="share"]')?.addEventListener('click', () => void shareEvent(ev));
  detailEl.querySelector('[data-act="center"]')?.addEventListener('click', () => centerOnEvent(ev));
  detailEl.querySelector('[data-act="route"]')?.addEventListener('click', () => {
    const r = routeOf(ev);
    if (r) selectRoute(r.id);
  });
}

/** 詳細資料卡片蓋住地圖的部分：手機蓋住下面、電腦蓋住右邊一點 */
function sheetCover(): { right: number; bottom: number } {
  return coverOf(detailEl);
}
/** 浮在地圖上的卡片蓋住地圖右邊、下面幾 px（手機放在清單卡片裡的不蓋） */
function coverOf(el: HTMLElement): { right: number; bottom: number } {
  if (el.hidden) return { right: 0, bottom: 0 };
  const m = $('#map').getBoundingClientRect();
  const d = el.getBoundingClientRect();
  const w = Math.min(m.right, d.right) - Math.max(m.left, d.left);
  const h = Math.min(m.bottom, d.bottom) - Math.max(m.top, d.top);
  if (w <= 0 || h <= 0) return { right: 0, bottom: 0 };
  return w >= m.width * 0.6 ? { right: 0, bottom: m.bottom - d.top } : { right: m.right - d.left, bottom: 0 };
}

/** 屬於車掃路線的事件：這一站的時間、切到上一站下一站，和回到整條路線時間表的按鈕 */
function routeBoxHtml(ev: EventOut, items: Item[], now: number): string {
  const r = routeOf(ev);
  const st = stopOf(ev);
  if (!r) return '';
  const line = st ? stopText(st, now) : '';
  const i = st ? r.stops.indexOf(st) : -1;
  const mine = routeItems(r, items);
  // 沒放上雷達的站（沒有確切位置、已經經過）沒有卡片：跳過，切到再前、再後面有卡片的那一站
  const near = (step: -1 | 1): { st: RouteStop; it: Item } | undefined => {
    for (let j = i + step; i >= 0 && j >= 0 && j < r.stops.length; j += step) {
      const s = r.stops[j];
      const it = mine.find((x) => x.ev.id !== ev.id && (isReported(r) ? stopMatches(s, x.ev) : x.ev.title === s.title));
      if (it) return { st: s, it };
    }
    return undefined;
  };
  const prev = near(-1);
  const next = near(1);
  const stopBtn = (n: { st: RouteStop; it: Item }, dir: 'prev' | 'next'): string => {
    const name = `${STOP_FLAG[n.st.kind] ? `${STOP_FLAG[n.st.kind]} ` : ''}${esc(n.st.name)}`;
    return `<button type="button" class="chip small stop-${dir}" data-stop-go="${n.it.ev.id}">${dir === 'prev' ? `‹ 上一站：${name}` : `下一站：${name} ›`}</button>`;
  };
  const nav = prev || next ? `<div class="stop-nav">${prev ? stopBtn(prev, 'prev') : '<span></span>'}${next ? stopBtn(next, 'next') : ''}</div>` : '';
  const pos = i >= 0 ? `<span class="muted">（第 ${i + 1} 站，共 ${r.stops.length} 站）</span>` : '';
  return `<div class="route-box"><b>${esc(r.title)}</b>${pos}${line ? `<br>${esc(line)}` : ''}${nav || '<br>'}<button type="button" class="link-btn" data-act="route">看整條路線與每站時間</button></div>`;
}

/** 雷達上跟這個疊在一起的其他光點，做成按鈕可以切過去 */
function nearbyHtml(it: Item, items: Item[]): string {
  const others = selectedGroup
    .filter((id) => id !== it.ev.id)
    .map((id) => items.find((x) => x.ev.id === id))
    .filter((x): x is Item => !!x);
  if (others.length === 0) return '';
  const btns = others.map((o) => `<button type="button" class="chip small" data-select="${o.ev.id}">${esc(titleOf(o.ev))}</button>`).join('');
  return `<div class="nearby"><span class="muted">雷達上同一點還有 ${others.length} 個：</span>${btns}</div>`;
}

/** 固定據點的完整時段，例如「每天 11:00–18:00，10/18（六）到 10/19（日）」 */
function spotSchedule(it: Item): string {
  const s = it.spot?.sessions ?? [];
  const first = s[0];
  const last = s.at(-1);
  if (!first || !last) return '';
  // 沒寫最後一天：只寫「發完為止」，不寫系統預設的最後一天（第一天也可能已經過了，不寫）
  const range = last.untilOpen
    ? openEndText(last)
    : first === last
      ? dateFmt.format(new Date(first.startAt * 1000))
      : `${dateFmt.format(new Date(first.startAt * 1000))} 到 ${dateFmt.format(new Date(last.startAt * 1000))}`;
  return `${spotHours(it.spot?.sessions ?? [it.ev])}，${range}`;
}

/** 羽球臨打的詳細資料：招臨打寫時段、費用、程度、缺幾位、用球、球團；找臨打寫程度、可以打的時間、地區 */
function sessionDetailHtml(it: Item, now: number): string {
  const { ev } = it;
  const x = sessionOf(ev);
  const line = (k: string, v: string | null | undefined): string => (v ? `${k}：${esc(v)}<br>` : '');
  const where = `地點：${esc(placeOf(ev))}${ev.approxArea ? `<br><span class="approx-note">約略位置：只知道在${esc(ev.approxArea)}</span>` : ''}`;
  const contact = x.contact ? (CONTACT_TEXT[x.contact] ?? x.contact) : null;
  if (isSeek(ev)) {
    return `<p>類型：找臨打（球友想找地方打）<br>${line('程度', x.level)}時間：${esc(seekWhen(ev))}<br>${line('聯絡方式', contact)}${where}</p>`;
  }
  const time = it.spot ? spotSchedule(it) : eventTimeText(ev);
  return `<p>類型：${it.spot ? '招臨打・每週固定場' : '招臨打'}<br>時間：${esc(time)}<br>${line('費用', x.fee ?? ev.item)}${line('程度', x.level)}${line('缺幾位', x.slots)}${line('用球', x.shuttle)}${line('球團', x.team)}${line('報名方式', contact)}${where} · ${esc(timeLine(it, now))}</p>`;
}

/** 狗狗陪伴、找工作的摘要：「2 個徵人、1 個可照顧」「2 個徵人、1 個求職」 */
function dogSummary(rows: Array<{ it?: Item }>): string {
  const offers = rows.filter((r) => r.it && isOffer(r.it.ev)).length;
  const hires = rows.length - offers;
  return [hires ? `${hires} 個徵人` : '', offers ? `${offers} 個${jobWords().offer}` : ''].filter(Boolean).join('、');
}

/** 職缺的詳細資料：薪資、工作期間、雇主、怎麼應徵、內容，加上防詐提醒 */
function jobDetailHtml(it: Item, now: number): string {
  const { ev } = it;
  const j = jobOf(ev);
  const offer = isOffer(ev);
  const w = jobWords();
  const period = jobPeriod(j);
  const who = offer ? (w.offerWho ? `提供者：${j.employer ? esc(j.employer) : '個人'}<br>` : '') : `雇主：${j.employer ? esc(j.employer) : '<span class="risk">沒寫</span>'}<br>`;
  return `${fraudBoxHtml(ev)}<p>類型：${offer ? w.offerType : w.hireType}<br>${j.pay ? `${offer ? w.offerPay : '薪資'}：${esc(j.pay)}<br>` : ''}${offer ? w.offerPeriod : '工作期間'}：${esc(offer && period === '沒寫工作期間' ? '時間可討論' : period)}<br>${who}${j.contact ? `${offer ? '聯絡方式' : '應徵方式'}：${esc(CONTACT_TEXT[j.contact] ?? j.contact)}<br>` : ''}${j.requirements ? `${offer ? w.offerNeeds : '內容'}：${esc(j.requirements)}<br>` : ''}地點：${esc(placeOf(ev))}${ev.approxArea ? `<br><span class="approx-note">約略位置：只知道在${esc(ev.approxArea)}</span>` : ''}${ev.endOpen ? '' : `<br>刊登到 ${dateFmt.format(new Date((ev.endAt - 1) * 1000))}`}</p>`;
}

/** 正在回報問題的車掃（回報的）每一站；不是車掃是 null */
let feedbackStops: RouteStop[] | null = null;

/**
 * 回報問題：疊在詳細資料上面，選類型、寫說明。
 * 回報的車掃可以選哪一站（從某一站打開時預設那一站，從時間表打開時預設整條路線），多一個「刪除這一站」
 */
/** fixStop：時間表上沒有確切位置的站按「我知道在哪」，先選好那一站、地點錯誤 */
function openFeedback(ev: EventOut, fromRoute?: RouteOut, fixStop?: number): void {
  feedbackEventId = ev.id;
  feedbackEv = ev;
  feedbackForm.reset();
  const r = fromRoute ?? routeOf(ev);
  const route = r && isReported(r) ? r : null;
  feedbackStops = route ? route.stops : null;
  const select = $<HTMLSelectElement>('#feedback-stop');
  if (route) {
    const cur = fromRoute ? undefined : stopOf(ev);
    select.innerHTML = `<option value="">整條路線</option>${route.stops
      .map((st, i) => `<option value="${i}"${st === cur ? ' selected' : ''}>${st.at ? `${fmtTime(st.at)} ` : ''}${esc(stopLabel(route, st.kind))} ${esc(st.name)}</option>`)
      .join('')}`;
  }
  $('#feedback-stop-row').hidden = !route;
  $('#feedback-remove-stop').hidden = !route;
  const fix = route && fixStop !== undefined ? route.stops[fixStop] : undefined;
  if (fix) {
    select.value = String(fixStop);
    (feedbackForm.elements.namedItem('kind') as RadioNodeList).value = 'location';
  }
  // 車掃：某一站地點錯了，請寫正確的地點（管理者照這個改那一站）
  feedbackNote.placeholder = fix
    ? `「${fix.name}」在哪裡？請寫地址或店名，也可以貼 Google 地圖的座標`
    : route
      ? '補充說明（選填）。某一站的地點錯了，請寫那一站正確的地址或店名'
      : '補充說明（選填），例如：實際在 2 號出口、15:00 才開始';
  $('#feedback-target').textContent = route ? `「${route.title}」哪裡有問題？` : `「${titleOf(ev)}」哪裡有問題？`;
  feedbackSheet.hidden = false;
  resetFeedbackPin();
  void syncFeedbackPin();
}

// ---- 回報地點錯誤：小地圖上標正確的位置（選填），灰點是現在的位置；管理者確認後才改 ----
let feedbackEv: EventOut | null = null;
let feedbackPin: LatLng | null = null;
let feedbackPicker: PinPicker | null = null;
/** 小地圖是替哪一站（或這一則）建的：換站就重建，灰點跟著換 */
let feedbackPickerFor = '';

function resetFeedbackPin(): void {
  feedbackPicker?.remove();
  feedbackPicker = null;
  feedbackPickerFor = '';
  feedbackPin = null;
  feedbackFound = '';
}

/** 選的那一站（沒選、不是車掃是 undefined） */
const feedbackStop = (): RouteStop | undefined => {
  const picked = feedbackStops ? $<HTMLSelectElement>('#feedback-stop').value : '';
  return feedbackStops && picked !== '' ? feedbackStops[Number(picked)] : undefined;
};

/** 查地點的結果（寫在小地圖上面）；換站、清除標記、自己點地圖就不顯示 */
let feedbackFound = '';

function feedbackPinState(): void {
  const st = feedbackStop();
  $('#feedback-pin-state').textContent = feedbackFound || (feedbackPin
    ? '標好了，送出後管理者確認就會改；不對可以拖紅色標記或再點一次地圖'
    : st && st.lat === null
      ? `點地圖標出「${st.name}」在哪裡，或在下面寫地址、店名`
      : '寫地址、店名按「查地點」，或直接點地圖標出正確的位置（灰點是現在的位置）；也可以只寫說明');
  $('#feedback-unpin').hidden = !feedbackPin;
}

/** 查地點：查到確切位置就標上去（再拖可以改），只查到約略位置就移過去讓人自己點；說明沒寫就帶入查的地點，管理者看得到 */
async function findFeedbackPlace(): Promise<void> {
  const input = $<HTMLInputElement>('#feedback-place');
  const btn = $<HTMLButtonElement>('#feedback-locate');
  const place = input.value.trim();
  if (place.length < 2 || feedbackEventId === null) {
    showBanner(bannerEl, '請先寫地址或店名', 2500);
    input.focus();
    return;
  }
  btn.disabled = true;
  btn.textContent = '查詢中…';
  const r = await locateFeedbackPlace(feedbackEventId, place);
  btn.disabled = false;
  btn.textContent = '查地點';
  if (!r.ok) {
    showBanner(bannerEl, r.message, 3500);
    return;
  }
  if (!feedbackPicker) {
    showBanner(bannerEl, '地圖還在載入，請再按一次', 2500);
    return;
  }
  const { found, lat, lng, name, approxArea } = r.data;
  if (!found || lat === null || lng === null) {
    feedbackFound = '查不到這個地點，請寫完整地址或店名，或直接在地圖上點';
  } else if (approxArea) {
    feedbackPicker.view({ lat, lng }, 15);
    feedbackFound = `只查到約略位置（${approxArea}），請在地圖上點出正確的位置`;
  } else {
    feedbackPin = { lat, lng };
    feedbackPicker.set(feedbackPin, 17);
    // 查到的名稱是「台北車站, 49, 忠孝西路一段, 黎明里, …, 臺灣」：只寫前三段
    feedbackFound = `查到${name ? `：${name.split(/,\s*/).slice(0, 3).join(' ')}` : ''}。不對可以拖紅色標記或點地圖`;
  }
  if (!feedbackNote.value.trim()) feedbackNote.value = place;
  feedbackPinState();
}

/** 選了「地點錯誤」才顯示小地圖；換站時重建（灰點換成那一站，標過的清掉） */
async function syncFeedbackPin(): Promise<void> {
  const kind = (feedbackForm.elements.namedItem('kind') as RadioNodeList).value;
  const box = $('#feedback-pin');
  box.hidden = kind !== 'location' || !feedbackEv;
  if (box.hidden || !feedbackEv) return;
  feedbackPinState();
  const st = feedbackStop();
  const key = `${feedbackEventId}|${st ? st.title : ''}|${st?.at ?? ''}`;
  if (key === feedbackPickerFor) return;
  resetFeedbackPin();
  feedbackPickerFor = key;
  feedbackPinState();
  const ev = feedbackEv;
  const cur = st ? (st.lat !== null && st.lng !== null ? { lat: st.lat, lng: st.lng } : null) : ev.lat !== null && ev.lng !== null && !ev.approxArea ? { lat: ev.lat, lng: ev.lng } : null;
  // 沒有確切位置的站：從這則的位置（車掃的另一站）或你的位置開始
  const center = cur ?? (ev.lat !== null && ev.lng !== null ? { lat: ev.lat, lng: ev.lng } : origin);
  const picker = await pinPicker(
    $('#feedback-map'),
    null,
    center,
    baseMap,
    (p) => {
      feedbackPin = p;
      feedbackFound = '';
      feedbackPinState();
    },
    cur ? { at: cur, title: '現在的位置' } : undefined,
  );
  // 等地圖載入時又換了站、關掉了：這張不要了
  if (feedbackPickerFor !== key) picker.remove();
  else feedbackPicker = picker;
}

async function submitFeedback(): Promise<void> {
  if (feedbackEventId === null) return;
  const kind = (feedbackForm.elements.namedItem('kind') as RadioNodeList).value as FeedbackKind | '';
  if (!kind) {
    showBanner(bannerEl, '請選擇問題類型', 3000);
    return;
  }
  const note = feedbackNote.value.trim();
  if (kind === 'other' && !note) {
    showBanner(bannerEl, '選「其他」請寫一下是什麼問題', 3000);
    feedbackNote.focus();
    return;
  }
  const picked = feedbackStops ? $<HTMLSelectElement>('#feedback-stop').value : '';
  const stop = feedbackStops && picked !== '' ? feedbackStops[Number(picked)] : undefined;
  if (kind === 'remove_stop' && !stop) {
    showBanner(bannerEl, '請選擇要刪除哪一站', 3000);
    $<HTMLSelectElement>('#feedback-stop').focus();
    return;
  }
  // 沒有確切位置的站：沒寫在哪裡、也沒在地圖上標，管理者也沒辦法放上雷達
  const locating = kind === 'location' && !!stop && stop.lat === null;
  const pin = kind === 'location' ? feedbackPin : null;
  if (locating && !note && !pin) {
    showBanner(bannerEl, `請寫「${stop.name}」在哪裡（地址或店名），或在地圖上標出來`, 3000);
    feedbackNote.focus();
    return;
  }
  feedbackSubmit.disabled = true;
  const r = await sendFeedback(feedbackEventId, kind, note, stop ? { title: stop.title, at: stop.at } : undefined, pin);
  feedbackSubmit.disabled = false;
  if (!r.ok) {
    showBanner(bannerEl, r.message, 4000);
    return;
  }
  feedbackSheet.hidden = true;
  feedbackEventId = null;
  showBanner(bannerEl, r.data.duplicate ? '你已經回報過這個問題了，謝謝' : locating ? '謝謝回報，管理者確認位置後就會放上雷達' : '謝謝回報，管理者會盡快處理', 3500);
}

/** 雷達或地圖上疊在一起的一群，詳細資料會列出同一群的其他項目 */
let selectedGroup: number[] = [];
/** 點了疊在一起的一群、還沒選是哪一個 */
let choosing: number[] | null = null;

const sameGroup = (a: number[] | null, b: number[]): boolean => !!a && [...a].sort().join() === [...b].sort().join();

function selectLandmark(id: string | null): void {
  selectedLandmark = selectedLandmark === id ? null : id;
  if (selectedLandmark === 'hq') startHqVoyage();
  selectedBottle = null;
  selectedRoute = null;
  selectedId = null;
  choosing = null;
  selectedGroup = [];
  if (selectedLandmark) {
    themeSheet.hidden = true;
    kwSheet.hidden = true;
    reportSheet.hidden = true;
    bottleSheet.hidden = true;
  }
  render();
}

/**
 * 點了洋流總部：洋流號從總部沿著真的路，像一條河流繞過整個台北市 12 個區、流到台北市政府（只開一趟；路線在 hq-voyage.ts，
 * 第一次點才載入），河跟著船長出來，經過每一區寫一下區名，終點的市政府用虛線畫出來；到了雷達（地圖）拉近市政府，放煙火（flow.ts 的 fireworksSvg）。
 * 雷達先飛到看得到整條（變成手動位置，按「定位」回來；本來就看得到整條就不動）；中途自己拖、縮放過，到了就不拉近。
 * hqVoyageAt 是出發的時間（Date.now() 的毫秒），按「關閉洋流號」才拿掉（stopHqVoyage）；你在汪星、火箭飛行中沒有
 */
let hq: typeof import('./hq-voyage') | null = null;
let hqVoyageAt: number | null = null;
let hqVoyageTimers: number[] = [];
/**
 * 洋流號的時間表（離出發多久做什麼）：加速時照剩下的時間重排（v1.528 加過暫停、繼續，v1.570 使用者說「洋流號拿掉暫停功能」）
 */
let hqEvents: Array<{ rel: number; fn: () => void; done: boolean }> = [];
/** 這一趟的代號（出發時間，加速時 hqVoyageAt 一直往前挪，這個不變：地圖照它判斷要不要整個重畫） */
let hqVoyageKey = 0;
/** 加速（v1.565 使用者說「暫停旁邊多一個加速，兩倍／四倍」）：1、2、4 倍；每一格把出發時間往前挪 (倍數 − 1) × 經過的時間 */
let hqSpeed = 1;
let hqSpeedFrame = 0;
let hqSpeedLast = 0;
let hqSpeedCss = 0;
let hqSpeedCssAt = 0;
/** 到站後河幾毫秒淡完（styles.css 的 river-out 1.5 秒） */
const HQ_RIVER_FADE_MS = 1500;
/** 到了拉近到外圈幾公里（看得到市政府的虛線外框和煙火） */
const HQ_END_KM = 0.7;
/** 一開始外圈幾公里、正中間在總部；船快出畫面（離正中間超過外圈的幾成）就把畫面移到船那裡（使用者說「一開始距離可以拉到 5 km，超過畫面再移動位置」） */
const HQ_START_KM = 5;
const HQ_FOLLOW_EDGE = 0.78;
/** 播放中使用者自己拖、縮放過（之後就不跟著船移動、到了也不拉近） */
let hqUserMoved = false;
let hqFollowTimer = 0;
/** 船現在在哪（照出發多久、路線的累計距離） */
function hqBoatNow(t0: number): LatLng | null {
  if (!hq) return null;
  const path = hq.HQ_VOYAGE;
  hqNearestAt(t0, { lat: path[0][0], lng: path[0][1] });
  const want = voyagePhase(Date.now() - t0).at * hqCum![hqCum!.length - 1];
  let i = 1;
  while (i < path.length - 1 && hqCum![i] < want) i++;
  const w = (want - hqCum![i - 1]) / (hqCum![i] - hqCum![i - 1] || 1);
  return { lat: path[i - 1][0] + (path[i][0] - path[i - 1][0]) * w, lng: path[i - 1][1] + (path[i][1] - path[i - 1][1]) * w };
}
function startHqVoyage(spinAt = Date.now()): void {
  if (youOn === 'woof' || tripping || !mod.current) return;
  // 星星先快速旋轉、縮小不見（使用者說的），洋流號才出來：點下去馬上轉，載入路線資料的時間也算在轉的時間裡
  radar.setStarSpin({ id: 'hq', at: spinAt });
  map.setStarSpin({ id: 'hq', at: spinAt });
  if (!hq) {
    void import('./hq-voyage').then((m) => {
      hq = m;
      startHqVoyage(spinAt);
    });
    return;
  }
  const { HQ_TOUR } = hq;
  const start = HQ_TOUR[0];
  const cityHall = HQ_TOUR[HQ_TOUR.length - 1];
  for (const t of hqVoyageTimers) window.clearTimeout(t);
  window.clearInterval(hqFollowTimer);
  hqUserMoved = false;
  let wait = 0;
  const started = Date.now();
  // 一開始：雷達外圈 HQ_START_KM、正中間在總部（本來就差不多就不動）；地圖拉到縮放 13、正中間在總部
  if (view === 'map') map.flyToLatLng(start, 13);
  else if (radar.spaceMoved || scaleKm > SPACE_FROM_KM || haversineKm(origin, start) > 0.3 || Math.abs(scaleKm / HQ_START_KM - 1) > 0.15) {
    if (radar.spaceMoved) radar.resetSpace();
    zoomToKm(HQ_START_KM, { lat: start.lat, lng: start.lng, source: 'manual' });
    wait = 1200;
  }
  wait = Math.max(wait, HQ_STAR_MS - (started - spinAt));
  hqVoyageAt = started + wait;
  hqVoyageKey = hqVoyageAt;
  hqSetSpeed(1);
  const t0 = hqVoyageAt;
  // 畫面不跟著船移動（v1.507 使用者說「畫面改成不要跟著洋流號移動」；以前船快出畫面就把畫面移到船那裡）
  // 時間都是離出發多久（加速時照剩下的時間重排）
  hqEvents = [
    // 星星轉完（出發前 0.2 秒）才開始畫
    { rel: -200, fn: () => render() },
    // 河淡掉（到站 0.6 秒後、1.5 秒淡完）之後重畫一次，把看不見但波光還在動的河拿掉
    // 多等 0.5 秒：剛好卡在「淡完」的邊界上時，那次重畫不會拿掉河（v1.568）
    { rel: HQ_SAIL_MS + 600 + HQ_RIVER_FADE_MS + 500, fn: () => render() },
    {
      rel: HQ_SAIL_MS,
      fn: () => {
        // 到了：拉近市政府（使用者自己動過就不拉）
        if (view === 'map') {
          if (map.userMovedAt < started + 300) map.flyToLatLng(cityHall, 17);
        } else if (!hqUserMoved) zoomToKm(HQ_END_KM, { lat: cityHall.lat, lng: cityHall.lng, source: 'manual' });
      },
    },
    // 到了、畫面停好：「看整個文化網」和政策圖層的按鈕出來（點、線都長完了）；也算「看完動畫」（中途關掉的不算，計時器被清掉了）
    {
      rel: HQ_VOYAGE_MS,
      fn: () => {
        hqNetBtn.hidden = false;
        hqLayersBox.hidden = false;
        // 加速只在洋流號跑的時候有，跑完收起來（v1.529 使用者說的）
        hqSpeedBtn.hidden = true;
        hqSetSpeed(1);
        mayorProgress('watched');
      },
    },
  ].map((e) => ({ ...e, done: false }));
  hqScheduleEvents();
  hqShowOff();
  hqNetBtn.hidden = true;
  hqLayersBox.hidden = true;
  if (!hqLayersBox.childElementCount) {
    // 手機上多一顆「政策 ▴」可以收起來（v1.537 原本預設收起，v1.543 使用者要預設展開）
    const tg = document.createElement('button');
    tg.type = 'button';
    tg.className = 'chip hq-layers-toggle';
    hqLayersBox.appendChild(tg);
    for (const ly of hq.HQ_POLICY_LAYERS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.id = ly.id;
      b.textContent = ly.label;
      hqLayersBox.appendChild(b);
    }
  }
  hqLayersBox.classList.add('open');
  hqLayersLabel('');
  hqSpeedBtn.hidden = false;
  hqPanel.hidden = false;
  render();
  // 手機：下面的卡片收成只露出標題的一條，雷達多出半個畫面（v1.537 使用者說手機縮小後特別擠）
  if (HQ_PHONE.matches && !detailEl.hidden) setPeek(true);
}
/** 照洋流號的時間表排計時器 */
function hqScheduleEvents(): void {
  for (const t of hqVoyageTimers) window.clearTimeout(t);
  hqVoyageTimers = [];
  if (hqVoyageAt === null) return;
  const t0 = hqVoyageAt;
  for (const e of hqEvents) {
    if (e.done) continue;
    hqVoyageTimers.push(
      window.setTimeout(() => {
        e.done = true;
        e.fn();
      }, Math.max(0, t0 + e.rel - Date.now())),
    );
  }
}
/** 加速中每一格：出發時間往前挪，雷達、地圖上的船、河跟著推，CSS 動畫、計時器每 0.2 秒推一次 */
function hqSpeedLoop(): void {
  hqSpeedFrame = 0;
  if (hqSpeed <= 1 || hqVoyageAt === null) return;
  const now = performance.now();
  const dt = Math.min(100, now - hqSpeedLast);
  hqSpeedLast = now;
  const d = (hqSpeed - 1) * dt;
  hqVoyageAt -= d;
  hqSpeedCss += d;
  radar.shiftClock(d);
  map.shiftClock(d);
  // CSS 動畫、計時器每 0.2 秒推一次（每一格都推太吃效能）
  if (now - hqSpeedCssAt > 200) {
    hqSpeedCssAt = now;
    radar.shiftCss(hqSpeedCss);
    map.shiftCss(hqSpeedCss);
    hqSpeedCss = 0;
    hqScheduleEvents();
  }
  hqSpeedFrame = requestAnimationFrame(hqSpeedLoop);
}
function hqSetSpeed(x: number): void {
  hqSpeed = x;
  hqSpeedBtn.textContent = x > 1 ? `⏩ ${x} 倍` : '⏩ 加速';
  hqSpeedBtn.classList.toggle('on', x > 1);
  cancelAnimationFrame(hqSpeedFrame);
  hqSpeedFrame = 0;
  if (x > 1 && hqVoyageAt !== null) {
    hqSpeedLast = hqSpeedCssAt = performance.now();
    hqSpeedFrame = requestAnimationFrame(hqSpeedLoop);
  }
}
/** 關閉洋流號（按鈕、Esc）：特效收起來、星星彈回來 */
function stopHqVoyage(): void {
  if (hqVoyageAt === null) return;
  hqSetSpeed(1);
  for (const t of hqVoyageTimers) window.clearTimeout(t);
  window.clearInterval(hqFollowTimer);
  hqVoyageAt = null;
  hqShowOff();
  hqPanel.hidden = true;
  introTip.hidden = true;
  radar.setStarSpin(null);
  map.setStarSpin(null);
  render();
}
/**
 * 收集卡 No.003「你的市長」：點洋流總部看完動畫（到站、按鈕出來）、再把上面的政策按鈕（看整個文化網、教育・午餐、通學區、親子、青年、都更、衛福）都點過，
 * 就跟伺服器領卡（findCard，跟小法一樣是瀏覽器判斷的）。進度記在這個瀏覽器（dr.mayorQuest），分好幾次看完也算
 */
const LS_MAYOR = 'dr.mayorQuest';
// v1.505 使用者說「你的市長完成條件加上這顆按鈕」：都更也要點過（六顆）
// v1.509 使用者說「青年加進去」：七顆都要點過
const MAYOR_STEPS = ['watched', 'net', 'edu', 'zone', 'family', 'youth', 'health', 'renewal'];
function mayorProgress(step: string): void {
  if (myCards().some((c) => c.card === 'mayor')) return;
  let done: string[] = [];
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LS_MAYOR) ?? '[]');
    if (Array.isArray(v)) done = v.filter((x): x is string => typeof x === 'string');
  } catch {
    // 讀不到就從頭算
  }
  if (!done.includes(step)) done.push(step);
  try {
    localStorage.setItem(LS_MAYOR, JSON.stringify(done));
  } catch {
    // 存不了也照樣算這一次
  }
  if (MAYOR_STEPS.every((x) => done.includes(x))) void findCard('mayor', '洋流總部', (msg) => showBanner(bannerEl, msg, 4000));
}
/** 右上角按鈕下面：「看整個文化網」（到了才出來）、「關閉洋流號」（播放中、播完都在，按了才收） */
const hqPanel = document.createElement('div');
hqPanel.className = 'hq-panel';
hqPanel.hidden = true;
hqPanel.innerHTML = '<button type="button" class="chip hq-net" hidden></button><div class="hq-ctl"><button type="button" class="chip hq-speed">⏩ 加速</button><button type="button" class="chip hq-close">✕ 關閉洋流號</button></div>';
// 放在右上那排按鈕（定位、地圖／雷達切換）的下面，不蓋住按鈕；全螢幕時那排按鈕往下移，這裡跟著
document.querySelector('#stage .overlay-tr')!.appendChild(hqPanel);
const hqNetBtn = hqPanel.querySelector('.hq-net') as HTMLButtonElement;
hqPanel.querySelector('.hq-close')!.addEventListener('click', stopHqVoyage);
// 加速：按一下 2 倍、再按 4 倍、再按回原本的速度（v1.565）
const hqSpeedBtn = hqPanel.querySelector('.hq-speed') as HTMLButtonElement;
hqSpeedBtn.addEventListener('click', () => hqSetSpeed(hqSpeed === 1 ? 2 : hqSpeed === 2 ? 4 : 1));
/**
 * 文化網（「點 —— 線 —— 面」的「面」，使用者選按鈕的做法）：按了拉遠看整個台北，文化徑的點一圈圈亮 → 線沿路亮 → 每條線、每個點往外暈開連成一片；
 * 老水路、登山步道、長回來的樹也一起（政策島：「水路串起都市微森林、山徑與文化徑」）。再按一次收起來
 */
const HQ_NET_SHOW = '看整個文化網';
/**
 * 手機（窄螢幕）：播放時卡片收起來（v1.537）；政策按鈕、說明卡多一顆收起來的按鈕，預設展開（v1.537 原本預設收起，v1.543 使用者要預設展開）
 */
const HQ_PHONE = window.matchMedia('(max-width: 600px)');
const HQ_MORE_BTN = '<button type="button" class="cap-more">收起 ▴</button>';
const HQ_NET_CENTER = { lat: 25.075, lng: 121.56 };
const HQ_NET_KM = 13;
let hqNetAt: number | null = null;
const hqCaption = document.createElement('div');
hqCaption.className = 'hq-net-caption';
hqCaption.hidden = true;
// 點、線、面各一段，跟著動畫一段一段出現（v1.516 使用者說「文化網的點線面介紹可以豐富一點」；內容照官網「台北文化徑×山林徑」）
const HQ_NET_CAPTION =
  '<b><span>點</span><span> —— 線</span><span> —— 面</span></b><small>多元的台北文化生態系</small>' +
  HQ_MORE_BTN +
  '<small class="net-step s1"><em>點</em>一個個文化點：城市歷史記憶（艋舺、大稻埕、城內）、產業文化遺跡（茶葉、煤礦、溫泉）、多元族群、人權記憶共 30 處，加上北劍潭、東象山、南貓空三座登山觀光中心。</small>' +
  '<small class="net-step s2"><em>線</em>延伸成「大家看得懂、走得到，也能持續經營」的文化線：6 條文化徑沿街道連起來，三條山林徑從捷運站走到登山口再上山，霧裡薛圳、大灣古河道這些老水路也串進來。</small>' +
  '<small class="net-step s3"><em>面</em>最後交織成一面文化網絡：搭配登山觀光中心、運動驛站、文化場館、步道標示和交通票券，串起文化旅遊、生態步道、地方商圈和公共服務。對外地人，是認識台北的文化地圖；對台北人，是讓日常凝聚成城市力量的文化網絡。</small>' +
  '<small class="net-src">政策島：水路串起都市微森林、山徑與文化徑</small>';
document.querySelector('#stage .overlay-tl')!.appendChild(hqCaption);
// 手機上說明卡預設展開，點「收起 ▴」只留標題
hqCaption.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest('.cap-more');
  if (!btn) return;
  const open = hqCaption.classList.toggle('open');
  btn.textContent = open ? '收起 ▴' : '說明 ▾';
});
/**
 * 到站後的政策圖層（使用者選「沿路冒出來＋到站後的政策圖層」）：教育・午餐、通學區、親子、衛福，按了拉遠看全台北那幾種地方（通學區拉近到 2.5 km 才看得到 150 公尺的圈）；
 * 跟「看整個文化網」一次只開一個，再按一次收起來
 */
let hqLayer: { id: string; at: number } | null = null;
const hqLayersBox = document.createElement('div');
hqLayersBox.className = 'hq-layers';
hqLayersBox.hidden = true;
hqPanel.insertBefore(hqLayersBox, hqPanel.querySelector('.hq-ctl'));
function hqShowOff(): void {
  hqNetAt = null;
  hqLayer = null;
  hqNetBtn.textContent = HQ_NET_SHOW;
  for (const b of hqLayersBox.children) b.classList.remove('on');
  hqCaption.hidden = true;
  hqLayersLabel('');
}
/** 手機上那顆「政策」寫現在開的是哪一個、展開（▴）還是收起來（▾） */
let hqLayerName = '';
function hqLayersLabel(name: string): void {
  hqLayerName = name;
  const tg = hqLayersBox.querySelector('.hq-layers-toggle');
  const arrow = hqLayersBox.classList.contains('open') ? '▴' : '▾';
  if (tg) tg.textContent = name ? `政策：${name} ${arrow}` : `政策 ${arrow}`;
}
/** 拉到 km、正中間在 center（飛 1.2 秒，飛到了才開始亮） */
function hqFlyTo(center: LatLng, km: number, mapZoom: number): void {
  if (view === 'map') map.flyToLatLng(center, mapZoom);
  else zoomToKm(km, { ...center, source: 'manual' });
}
hqNetBtn.addEventListener('click', () => {
  if (hqVoyageAt === null) return;
  const wasOn = hqNetAt !== null;
  hqShowOff();
  if (!wasOn) {
    mayorProgress('net');
    hqFlyTo(HQ_NET_CENTER, HQ_NET_KM, 12);
    hqNetAt = Date.now() + 1300;
    hqNetBtn.textContent = '收起文化網';
    hqCaption.innerHTML = HQ_NET_CAPTION;
    hqCaption.classList.add('open');
    hqCaption.hidden = false;
    hqCaption.classList.remove('play');
    window.setTimeout(() => hqCaption.classList.add('play'), 1300);
  }
  render();
});
hqLayersBox.addEventListener('click', (e) => {
  if ((e.target as Element).closest('.hq-layers-toggle')) {
    hqLayersBox.classList.toggle('open');
    hqLayersLabel(hqLayerName);
    return;
  }
  const btn = (e.target as Element).closest('button[data-id]') as HTMLButtonElement | null;
  if (!btn || hqVoyageAt === null || !hq) return;
  const ly = hq.HQ_POLICY_LAYERS.find((x) => x.id === btn.dataset.id);
  if (!ly) return;
  // 手機：選好了按鈕照樣展開（v1.543 使用者要預設展開），「政策」那顆寫現在開的是哪一個
  const wasOn = hqLayer?.id === ly.id;
  hqShowOff();
  if (!wasOn) {
    mayorProgress(ly.id);
    // 保持目前的位置、範圍（使用者說「點選按鈕不用縮放到全部都看得到，保持目前位置就好」）
    hqLayer = { id: ly.id, at: Date.now() + 100 };
    btn.classList.add('on');
    hqLayersLabel(ly.label);
    // 說明卡：標題、有幾處、方塊的字代表什麼、政見的細項（原本放在每個方塊上的介紹）
    const b = document.createElement('b');
    b.textContent = ly.title;
    const sm = document.createElement('small');
    sm.textContent = `${ly.note}｜${ly.legend}`;
    const intro = document.createElement('small');
    intro.className = 'intro';
    intro.textContent = ly.intro;
    const more = document.createElement('span');
    more.innerHTML = HQ_MORE_BTN;
    hqCaption.replaceChildren(b, sm, more.firstChild as Node, intro);
    hqCaption.classList.add('open');
    hqCaption.classList.add('play');
    hqCaption.hidden = false;
  }
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && hqVoyageAt !== null) stopHqVoyage();
});
/**
 * 滑鼠移過去的介紹（使用者說「我想在一些地方滑鼠一過去可以介紹」）：有 data-intro 的東西（雷達上的感應圈），
 * 滑鼠移過去就在旁邊顯示；手機沒有滑鼠，點一下顯示、點別的地方收起來。地圖用 Leaflet 自己的 tooltip
 */
const introTip = document.createElement('div');
introTip.className = 'hq-intro-tip';
introTip.hidden = true;
document.body.appendChild(introTip);
function showIntro(t: Element, x: number, y: number): void {
  const title = t.getAttribute('data-title') ?? '';
  const intro = t.getAttribute('data-intro') ?? '';
  const b = document.createElement('b');
  b.textContent = title;
  introTip.replaceChildren(b, document.createTextNode(intro));
  introTip.hidden = false;
  const w = introTip.offsetWidth;
  const h = introTip.offsetHeight;
  introTip.style.left = `${Math.max(8, Math.min(x + 14, window.innerWidth - w - 8))}px`;
  introTip.style.top = `${y + 16 + h > window.innerHeight - 8 ? Math.max(8, y - h - 12) : y + 16}px`;
}
document.addEventListener('pointerover', (e) => {
  if (e.pointerType === 'touch') return;
  const t = (e.target as Element | null)?.closest?.('[data-intro]');
  if (t) showIntro(t, e.clientX, e.clientY);
  else introTip.hidden = true;
});
document.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' || introTip.hidden) return;
  const t = (e.target as Element | null)?.closest?.('[data-intro]');
  if (t) showIntro(t, e.clientX, e.clientY);
});
document.addEventListener('click', (e) => {
  if ((e as PointerEvent).pointerType === 'mouse') return;
  const t = (e.target as Element | null)?.closest?.('[data-intro]');
  if (t) showIntro(t, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  else introTip.hidden = true;
});
/**
 * 「把樹種回來」的樹（砍樹的地方、公園、行道樹）先不畫：v1.483 使用者說「樹先不要畫，有其他想法針對把樹種回來怎麼呈現嗎」。
 * 資料（HQ_PLANTINGS、HQ_BLOOMS）和畫法（radar.ts、map.ts 的 plantings、blooms）都留著，改成 true 就回來
 */
const HQ_TREES = false;
/** 洋流號的特效要不要畫：星星還在轉的時候先不畫（地圖上幾千棵樹一次畫要 0.7 秒，會讓星星卡住），出發前 0.2 秒才畫 */
function hqDrawing(): boolean {
  return hqVoyageAt !== null && Date.now() >= hqVoyageAt - 200;
}
/** 船到某一站的時間（出發 t0 之後幾毫秒；沒有這一站就是出發時） */
function hqStopAt(t0: number, place: string): number {
  if (!hq) return t0;
  const i = hq.HQ_TOUR.findIndex((st) => st.place === place);
  return i < 0 ? t0 : t0 + voyageTimeOf(hq.HQ_TOUR_AT[i]);
}
/** 路線每一點走了幾公里（點不是等距的，不能用編號算），第一次用到才算 */
let hqCum: Float64Array | null = null;
/** 船離這個地方最近的時候（出發 t0 之後幾毫秒）：整條路線上離它最近的那一點走到幾成（照累計的距離） */
function hqNearestAt(t0: number, p: LatLng): number {
  if (!hq) return t0;
  const path = hq.HQ_VOYAGE;
  if (!hqCum) {
    hqCum = new Float64Array(path.length);
    for (let i = 1; i < path.length; i++) hqCum[i] = hqCum[i - 1] + haversineKm({ lat: path[i - 1][0], lng: path[i - 1][1] }, { lat: path[i][0], lng: path[i][1] });
  }
  // 出發後幾毫秒到最近的那一點，跟 t0 無關：每個地方算一次就記起來（以前每次重畫都把整條路線掃一遍，幾百個地方很吃 CPU）
  const key = `${p.lat},${p.lng}`;
  let off = hqNearestCache.get(key);
  if (off === undefined) {
    let [best, bi] = [Infinity, 0];
    path.forEach(([lat, lng], i) => {
      const d = haversineKm(p, { lat, lng });
      if (d < best) [best, bi] = [d, i];
    });
    off = voyageTimeOf(hqCum[bi] / hqCum[hqCum.length - 1]);
    hqNearestCache.set(key, off);
  }
  return t0 + off;
}
const hqNearestCache = new Map<string, number>();
/**
 * 種樹的地方（都市微森林「把樹種回來」）：船離它最近時長出一叢樹。砍樹的地方（cut）寫名字（「把樹種回來」那一句另外寫在第一個上面、留著，hqTourStops）；
 * 政見說要加強種樹的公園、商圈、公有建築（plant）只長樹
 */
function hqPlantings(t0: number): Array<{ lat: number; lng: number; at: number; kind: 'cut' | 'plant'; label?: string; spreadM?: number }> {
  if (!hq) return [];
  return hq.HQ_PLANTINGS.map((p) => ({ lat: p.lat, lng: p.lng, at: hqNearestAt(t0, p), kind: p.kind, spreadM: p.spreadM, ...(p.kind === 'cut' && !p.hideName ? { label: p.name } : {}) })).sort((a, b) => a.at - b.at);
}
/** 星群：一個中心四周幾顆星（照固定的亂數散開）、連成一圈的星座線 */
function hqStarPoints(st: { lat: number; lng: number; count: number; radiusM: number }): Array<[number, number]> {
  const KX = 111_320 * Math.cos((st.lat * Math.PI) / 180);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < st.count; i++) {
    const a = (i / st.count) * 2 * Math.PI + (((st.lat * 7919 + i * 977) % 1) - 0.5) * 0.6;
    const r = st.radiusM * (0.45 + ((st.lng * 6271 + i * 311) % 1) * 0.55);
    pts.push([st.lat + (Math.cos(a) * r) / 110_574, st.lng + (Math.sin(a) * r) / KX]);
  }
  return pts;
}
/** 樹樁比長樹早幾毫秒冒出來 */
const HQ_STUMP_LEAD_MS = 1500;
type HqReveal = { path: Array<[number, number]>; at: number; kind: 'trail' | 'bridge' | 'stars' | 'culture' | 'light'; label?: string; color?: string; labelAt?: number; hideKm?: number };
type HqSeam = {
  path: Array<[number, number]>;
  at: number;
  healAt: number;
  label: string;
  labelAt: number;
  stitches: Array<{ at: number; center: [number, number]; along: [number, number]; label: string; below?: boolean }>;
  walkers: Array<{ from: [number, number]; to: [number, number]; at: number; south?: boolean }>;
};
type HqIcon = { lat: number; lng: number; at: number; kind: 'hut' | 'stadium' | 'dome' | 'bigdome' | 'star' | 'regrow' | 'culture' | 'service' | 'wetland' | 'archbridge' | 'chest' | 'chestlock' | 'paw' | 'umusic' | 'uart' | 'uexhibit' | 'uyouth' | 'ushop' | 'usport' | 'ukids' | 'uanime' | 'fitbus' | SceneKind; label?: string; hideKm?: number; scale?: number; grow?: number; char?: string; color?: string; small?: boolean; focus?: boolean; hint?: { title: string; intro: string }; rot?: number; calm?: boolean };
/** 其他政見的地方：離路線多近才沿路冒出來 */
const HQ_SERVICE_NEAR_M = 300;
/** 離路線幾公尺（路線載入後不會變，記起來） */
const hqDistCache = new Map<string, number>();
function hqDistM(p: LatLng): number {
  if (!hq) return Infinity;
  const key = `${p.lat},${p.lng}`;
  let d = hqDistCache.get(key);
  if (d === undefined) {
    d = Infinity;
    const path = hq.HQ_VOYAGE;
    for (let i = 0; i < path.length; i += 2) d = Math.min(d, haversineKm(p, { lat: path[i][0], lng: path[i][1] }) * 1000);
    hqDistCache.set(key, d);
  }
  return d;
}
/** 其他政見的東西：步道（山林徑）、自行車橋、球場和運動中心、星群——線和冒出來的東西（照船到那一站或離它最近的時間） */
function hqExtras(t0: number): { reveals: HqReveal[]; icons: HqIcon[]; seams: HqSeam[] } {
  if (!hq) return { reveals: [], icons: [], seams: [] };
  const reveals: HqReveal[] = [];
  const icons: HqIcon[] = [];
  const seams: HqSeam[] = [];
  hq.HQ_TRAILS.forEach((tr, i) => {
    const at = hqStopAt(t0, tr.stop);
    reveals.push({ path: tr.pts, at, kind: 'trail' });
    icons.push({ lat: tr.head[0], lng: tr.head[1], at: at + 600, kind: 'hut', label: i === 0 ? `山林徑・${tr.name}` : tr.name });
  });
  const br = hq.HQ_BRIDGE;
  reveals.push({ path: [br.from, br.to], at: hqStopAt(t0, br.stop), kind: 'bridge', label: '自行車橋' });
  // 南港展覽館散場（v1.575 使用者說連到真的地方）：展覽館二館 → LaLaport 南港（粉紅色，縫合的顏色）、→ 中南山登山步道（步道的土色）
  const ex = hq.HQ_EXPO;
  const exAt = hqNearestAt(t0, ex) + 600;
  reveals.push({ path: ex.mall.path, at: exAt, kind: 'culture', color: '#f08a96', label: ex.mall.name, labelAt: 1, hideKm: 5 });
  reveals.push({ path: ex.trail.path, at: exAt + 400, kind: 'trail', label: ex.trail.name, hideKm: 5 });
  // 公園、運動中心、大型建築的字拉遠到 10 km 不寫（v1.531 使用者說「10km 拿掉公園、運動中心、大型建築文字」）
  // 花博旗艦運動中心：按「親子」（運動中心）時跟著亮（v1.563）
  for (const v of hq.HQ_VENUES) icons.push({ lat: v.lat, lng: v.lng, at: hqStopAt(t0, v.stop) + 400, kind: v.kind, label: v.name, hideKm: 10, scale: 1.1, focus: hqLayer?.id === 'family' && v.kind === 'dome' });
  for (const st of hq.HQ_STARS) {
    const at = hqNearestAt(t0, st);
    const pts = hqStarPoints(st);
    pts.forEach(([lat, lng], i) => icons.push({ lat, lng, at: at + i * 160, kind: 'star', scale: st.big ? 1 : 0.7 }));
    // 北士科星群的字看整個文化網時不寫（v1.533）
    if (st.big) reveals.push({ path: [...pts, pts[0]], at: at + pts.length * 160, kind: 'stars', label: st.name, hideKm: HQ_NET_LABEL_KM });
  }
  // 都市微森林「把樹種回來」（v1.484 使用者選的呈現）：有報導的砍樹地方，船快到時（1.5 秒前）才冒出樹樁，船離它最近時長回一棵大樹
  // （v1.487 使用者說「樹不用一開始砍掉，接近的時候出現再長出來」）
  for (const p of hq.HQ_PLANTINGS) {
    if (p.kind !== 'cut') continue;
    const grow = hqNearestAt(t0, p);
    icons.push({ lat: p.lat, lng: p.lng, at: grow - HQ_STUMP_LEAD_MS, grow, kind: 'regrow', label: p.hideName ? undefined : p.name, hideKm: p.name.includes('公園') ? 10 : HQ_NET_LABEL_KM, scale: 1.5 });
  }
  // 文化徑的點：船離它最近時冒出來，名字寫在下面（重疊的不寫）
  const seen = new Map<string, number>();
  for (const c of hq.HQ_CULTURE) {
    const th = hq.HQ_CULTURE_THEMES[c.theme];
    const at = hqNearestAt(t0, c);
    seen.set(c.name, at);
    // 名字有「公園」的拉遠到 10 km 不寫（v1.531 使用者說「10km 拿掉公園…文字」）
    icons.push({ lat: c.lat, lng: c.lng, at, kind: 'culture', char: c.theme, color: th.color, label: c.name, ...(c.name.includes('公園') ? { hideKm: 10 } : {}), small: true });
  }
  // 其他政見的地方（學校、圖書館、運動中心、親子館、健康服務中心）：路線 300 公尺內的，船離它最近時冒出來；
  // 政策圖層開著時，那幾種的全部都畫（離路線遠的照順序很快冒出來）
  const ly = hqLayer ? hq.HQ_POLICY_LAYERS.find((x) => x.id === hqLayer!.id) : undefined;
  let li = 0;
  for (const sv of hq.HQ_SERVICES) {
    const K = hq.HQ_SERVICE_KINDS[sv.kind];
    const near = hqDistM(sv) <= HQ_SERVICE_NEAR_M;
    if (!near && !(ly && hqLayer && ly.kinds.includes(sv.kind))) continue;
    const at = near ? hqNearestAt(t0, sv) : hqLayer!.at + Math.min(li++ * 8, 1600);
    // 介紹寫在政策圖層的說明卡（v1.496）；點方塊（滑鼠移過去）只顯示名稱（v1.500 使用者說「把點選顯示名稱加回來」），
    // 名字裡沒寫是什麼地方的（圖書館的「中山分館」）後面補上；圖層開著時那幾種放大
    const focus = !!ly && ly.kinds.includes(sv.kind);
    const title = /國小|國中|親子館|家庭教育中心|運動中心|健康服務中心|圖書館/.test(sv.name) ? sv.name : `${sv.name}（${K.name}）`;
    icons.push({ lat: sv.lat, lng: sv.lng, at, kind: 'service', char: K.char, color: K.color, scale: focus ? 1.25 : 0.85, focus, hint: { title, intro: '' } });
  }
  // 濕地風廊（水域政見）：船離它最近時冒出來，第一個寫「濕地風廊」
  hq.HQ_WETLANDS.map((w) => ({ ...w, at: hqNearestAt(t0, w) }))
    .sort((a, b) => a.at - b.at)
    // 涼風往市區（台北車站的方向）吹（v1.545）
    .forEach((w, i) => icons.push({ lat: w.lat, lng: w.lng, at: w.at, kind: 'wetland', rot: bearingDeg(w, HQ_WIND_TO), label: i === 0 ? `濕地風廊・${w.name}` : w.name, hideKm: 10, scale: 1.1, hint: { title: `${w.name}（濕地風廊）`, intro: hq!.HQ_INTROS['濕地風廊'] ?? '' } }));
  // 重建明治橋（受訪時的主張）：船離原址最近時冒出一座石拱橋
  const mj = hq.HQ_MEIJI;
  icons.push({ lat: mj.lat, lng: mj.lng, at: hqNearestAt(t0, mj), kind: 'archbridge', label: '明治橋（重建）', hideKm: 10, scale: 1.1, hint: { title: '明治橋（重建）', intro: hq.HQ_INTROS['明治橋'] ?? '' } });
  // 各區的政見開箱（使用者說不要寫「大秘寶」）：開箱地點放寶箱（開過的打開、還沒開的鎖著），船離它最近時冒出來；大巨蛋好鄰居計畫、毛孩安心養（大安森林公園寶箱旁的狗掌）
  const I = hq.HQ_INTROS;
  for (const ch of hq.HQ_CHESTS) {
    icons.push({ lat: ch.lat, lng: ch.lng, at: hqNearestAt(t0, ch), kind: ch.opened ? 'chest' : 'chestlock', label: ch.opened ? `${ch.district}政見開箱` : `${ch.district}政見開箱（${ch.date}）`, hideKm: 5, scale: 0.8 * (view === 'radar' ? hqZoomScale() : 1), hint: { title: `${ch.district}政見開箱（${ch.date} ${ch.venue}${ch.opened ? '' : '，還沒開箱'}）`, intro: ch.intro } });
  }
  icons.push({ lat: hq.HQ_DOME.lat, lng: hq.HQ_DOME.lng, at: hqNearestAt(t0, hq.HQ_DOME), kind: 'bigdome', label: hq.HQ_DOME.name, hideKm: 5, scale: 1.35, hint: { title: hq.HQ_DOME.name, intro: I['大巨蛋好鄰居計畫'] ?? '' } });
  icons.push({ lat: hq.HQ_PAW.lat, lng: hq.HQ_PAW.lng, at: hqNearestAt(t0, hq.HQ_PAW) + 400, kind: 'paw', label: hq.HQ_PAW.name, hideKm: 5, scale: 0.9, hint: { title: hq.HQ_PAW.name, intro: I['毛孩安心養'] ?? '' } });
  // 高架橋下空間：沿市民大道高架、建國高架畫一條線（船離中間最近時長出來）
  // 兩條在中間交叉（建國南北路 × 市民大道），名字和圖示都避開交叉口（v1.515 使用者說重疊了）；
  // 市民大道先「縫合」（v1.520）：出發就畫出裂縫，洋流號經過才縫（v1.521），縫完變淡，橋下空間的線才長出來。
  // v1.682「點亮市民大道」：縫的地方換成三個模擬基地，每一處縫好依序 打開（那一段亮起來）→ 跨越（人行陸橋）→ 轉化（用途的圖示）
  for (const vd of hq.HQ_VIADUCTS) {
    if (vd.name.startsWith('市民')) {
      // 船前 2 秒沿著市民大道往西開，出發就有裂縫；洋流號經過時縫
      const seam = hqSeam(vd.pts, t0 + 600, t0);
      seams.push(seam);
      hq.HQ_SEAM.stitches.forEach((base, i) => {
        const st = seam.stitches[i];
        const hint = { title: base.title, intro: I[base.intro] ?? '' };
        // 打開：那一段高架亮起來（引入天光，橋下不再是明暗的分界線）
        const lit = vd.pts.filter((q) => q[1] >= base.light[0] && q[1] <= base.light[1]);
        if (lit.length >= 2) reveals.push({ path: lit, at: st.at + 300, kind: 'light' });
        // 跨越：南北向的人行陸橋（真的位置，或基地正中間跟路垂直的示意）
        // 陸橋、廊道、用途的字很多，拉近到 2 km 以內才寫（圖示照畫）
        reveals.push({ path: base.bridge?.path ?? hqSeamCross(st.center, st.along, HQ_SEAM_BRIDGE_M), at: st.at + 900, kind: 'bridge', label: base.bridge?.label ?? base.bridgeLabel, hideKm: HQ_SEAM_LABEL_KM });
        if (base.corridor) reveals.push({ path: base.corridor.path, at: st.at + 1300, kind: 'culture', color: '#8a6fd0', label: base.corridor.label, hideKm: HQ_SEAM_LABEL_KM });
        // 轉化：報導寫到的用途（位置示意）
        base.uses.forEach((u, n) => icons.push({ lat: u.at[0], lng: u.at[1], at: st.at + 1600 + n * 250, kind: u.kind, label: u.label, hideKm: HQ_SEAM_LABEL_KM, small: true, scale: 0.85, hint: { title: `${hint.title}：${u.label}（位置示意）`, intro: hint.intro } }));
      });
      // 北流（「往南港方向可與北流結合做音樂廊道」，10/25 的說法）：全部縫好後
      icons.push({ lat: hq.HQ_SEAM.beiliu.lat, lng: hq.HQ_SEAM.beiliu.lng, at: seam.healAt + 900, kind: 'umusic', label: hq.HQ_SEAM.beiliu.name, hideKm: 10, small: true, scale: 0.85, hint: { title: '臺北流行音樂中心（北流）', intro: I['音樂廊道'] ?? '' } });
      // 橋下空間的線：縫完才長（名字寫「點亮市民大道」那邊，這條不寫）
      reveals.push({ path: vd.pts, at: seam.healAt + 300, kind: 'culture', color: '#8a6fd0' });
      continue;
    }
    const mid = vd.pts[Math.floor(vd.pts.length / 2)];
    const at = hqNearestAt(t0, { lat: mid[0], lng: mid[1] });
    reveals.push({ path: vd.pts, at, kind: 'culture', label: `橋下空間（${vd.name}）`, hideKm: 5, color: '#8a6fd0', labelAt: 0.1 });
    const uses: Array<[number, 'uyouth' | 'ushop', string]> = [[0.3, 'uyouth', '青年交流'], [0.82, 'ushop', '特色商業']];
    uses.forEach(([k, kind, name], i) => {
      const q = vd.pts[Math.floor((vd.pts.length - 1) * k)];
      icons.push({ lat: q[0], lng: q[1], at: at + 2200 + i * 250, kind, label: name, hideKm: 5, small: true, scale: 0.85, hint: { title: `橋下空間：${name}（${vd.name}）`, intro: I['橋下空間'] ?? '' } });
    });
  }
  // 文化徑的線（點 —— 線）：同一條路線的點都冒出來後，用那條路線的顏色沿街道連起來
  for (const ln of hq.HQ_CULTURE_LINES) {
    const at = Math.max(...ln.stops.map((n) => seen.get(n) ?? t0)) + 400;
    reveals.push({ path: ln.pts, at, kind: 'culture', label: ln.name, color: hq.HQ_CULTURE_THEMES[ln.theme].color });
  }
  icons.push(...hqScenes(t0));
  // 條通的巷子（v1.552）：淡淡的綠色線（步行者特區），樹沿著巷子種；拉近才畫（跟樹一樣，很密的東西電腦版 3 km）
  if (view !== 'radar' || scaleKm <= hqDenseKm()) {
    const tiaoAt = hqNearestAt(t0, HQ_TIAO_CENTER);
    hq.HQ_TIAOTONG.forEach((ln, li) => ln.ways.forEach((w) => reveals.push({ path: w.pts, at: tiaoAt + li * 350, kind: 'culture', color: '#8cc47a', hideKm: hqDenseKm() + 0.05 })));
  }
  return { reveals, icons, seams };
}
/** 濕地風廊的涼風往哪裡吹：市區（台北車站） */
const HQ_WIND_TO = { lat: 25.0478, lng: 121.517 };
/** 條通的夜色（拉近才畫，跟樹、車架一樣）：船離條通最近時慢慢暗下來 */
function hqNights(t0: number): Array<{ ring: Array<[number, number]>; at: number }> {
  if (!hq || (view === 'radar' && scaleKm > hqDenseKm())) return [];
  return [{ ring: hq.HQ_TIAO_NIGHT, at: hqNearestAt(t0, HQ_TIAO_CENTER) - 400 }];
}
/** 條通的中間（船離這裡最近時樹、車架冒出來）、夜市長協調的地方（七條通，中山北路一段 121 巷） */
const HQ_TIAO_CENTER = { lat: 25.0498, lng: 121.5249 };
const HQ_NIGHT_MAYOR = { lat: 25.05105, lng: 121.5236 };
/** 林森北路在條通這一段的經度（樹木與車架放在巷子和林森北路的交叉口：條通的熱點） */
const HQ_LINSEN_LNG = 121.5249;
/** 兩點相距幾公尺 */
const hqDistMeters = (a: [number, number], b: [number, number]): number => haversineKm({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) * 1000;
/** 沿著一條線每 stepM 公尺取一點（頭尾各留 marginM） */
function hqAlong(pts: Array<[number, number]>, stepM: number, marginM: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += hqDistMeters(pts[i - 1], pts[i]);
  let next = Math.min(marginM, total / 2);
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = hqDistMeters(pts[i - 1], pts[i]);
    while (seg > 0 && next <= walked + seg && next <= total - marginM + 0.01) {
      const f = (next - walked) / seg;
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]);
      next += stepM;
    }
    walked += seg;
  }
  return out;
}
/** 線上離 p 最近的一點、那一段的方向（往下游，度） */
function hqOnLine(pts: Array<[number, number]>, p: [number, number]): { at: [number, number]; bearing: number } {
  const kx = Math.cos((p[0] * Math.PI) / 180);
  let best = { d: Infinity, at: pts[0], bearing: 0 };
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const [dx, dy] = [(b[1] - a[1]) * kx, b[0] - a[0]];
    const len2 = dx * dx + dy * dy;
    if (!(len2 > 0)) continue;
    const t = Math.max(0, Math.min(1, (((p[1] - a[1]) * kx) * dx + (p[0] - a[0]) * dy) / len2));
    const q: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const d = hqDistMeters(q, p);
    if (d < best.d) best = { d, at: q, bearing: bearingDeg({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) };
  }
  return { at: best.at, bearing: best.bearing };
}
/**
 * 水圳淨水的蘆葦另外指定的位置（大灣古河道：v1.551 文昌街 280 巷；v1.559 那段河道只有 40 公尺、往北就轉彎，水流畫出來會超出河道，
 * 改到往西一點、沿文昌街直直約 200 公尺那段的中間，水流整段貼著小河）
 */
const HQ_CLEAN_AT: Record<string, [number, number]> = { 大灣古河道: [25.03228, 121.55578] };
/** 北士科星群的無人公車充電站（軟橋街附近）、24 小時圖書館（文林路附近）：星群圈的內側，示意 */
const HQ_NORTH_CHARGE = { lat: 25.0999, lng: 121.5152 };
const HQ_NORTH_LIBRARY = { lat: 25.1015, lng: 121.5172 };
/** 臺北市政府的 AI 支援小隊：市府大樓東南側（不擋「臺北市政府」的字、煙火） */
const HQ_AI_TEAM = { lat: 25.0369, lng: 121.5655 };
/** 通學區的斑馬線一次最多幾所在動（畫面正中間最近的） */
const HQ_WALK_ANIMATED = 10;
/** 運動驛站設在山林徑起點的捷運站 */
const HQ_HUB_STATION: Record<string, string> = { 北劍潭: '劍潭', 東象山: '象山', 南貓空: '動物園' };
/**
 * 更貼近政策的小動畫（v1.545 使用者選「1 3 4 7 8 9 10 11 13 14 15」，畫法在 hq-scenes.ts）：運動驛站、口袋公園、微型滯洪、水圳淨水沿路冒出來；
 * 通學區（小朋友過馬路）、教育・午餐（便當冒熱氣，小貨車在 hqBikes）、青年（小豬撲滿）按了政策按鈕才有。樹醫生、濕地的涼風、足球場、花博坡道畫在原本的圖示裡
 */
/**
 * 政策按鈕（右邊）對應的小場景：按了這些就跟著亮、不跟其他特效一起變淡（v1.563 使用者說「點選右邊政策按鈕的時候，相關的圖案以及動畫也跟著顯示」；
 * 接著說「動畫還是照原本距離才呈現」：一樣拉近才畫、才動）。
 * 照政見寫的關係：營養午餐的小農、親子同行卡的圖書館、青年基金的撲滿、都更和衛福都寫了「老宅延壽行動服務團」；健身小巴另外在 hqFitbuses 跟著衛福
 */
const HQ_LAYER_SCENES: Record<string, SceneKind[]> = {
  edu: ['lunch'],
  zone: ['schoolwalk'],
  family: ['library24', 'respite'],
  youth: ['piggy'],
  renewal: ['oldhouse', 'cyclerenew'],
  health: ['oldhouse'],
};
/**
 * 小場景拉近（電腦版 3 km、手機 2 km 以內，跟開始動的距離一樣）才畫：場景是固定的螢幕大小，拉遠時地圖縮小、場景不縮，
 * 房子、車子看起來變得很大（v1.555 使用者說「北士科那邊畫面一縮小，房子跟車子就變很大」）；地圖照 styles.css 的 #map.hq-far 藏起來。
 * 政策按鈕開著時，那個政策的場景標成 focus（不變淡）
 */
function hqScenes(t0: number): HqIcon[] {
  if (!hq || (view === 'radar' && scaleKm > hqMotionKm())) return [];
  const rel: readonly string[] = hqLayer ? (HQ_LAYER_SCENES[hqLayer.id] ?? []) : [];
  return hqScenesAll(t0).map((ic) => (rel.includes(ic.kind) ? { ...ic, focus: true } : ic));
}
function hqScenesAll(t0: number): HqIcon[] {
  if (!hq) return [];
  const I = hq.HQ_INTROS;
  const out: HqIcon[] = [];
  // 跟寶箱一樣拉近變大、拉遠變小（雷達照 hqZoomScale；地圖在 styles.css 照 --zoom-scale）；手機的畫面小，再小一號
  const zs = (view === 'radar' ? hqZoomScale() : 1) * (HQ_PHONE.matches ? 0.75 : 1);
  const scale = 0.9 * zs;
  for (const tr of hq.HQ_TRAILS) {
    const st = HQ_HUB_STATION[tr.name] ?? tr.name;
    out.push({ lat: tr.station[0], lng: tr.station[1], at: hqStopAt(t0, tr.stop) + 300, kind: 'sporthub', scale, hint: { title: `運動驛站（捷運${st}站旁）`, intro: I['運動驛站'] ?? '' } });
  }
  // 騎車通勤的運動驛站（松山站換上騎車的衣服、港墘站換回上班的衣服，接自行車橋）：橋畫出來後
  const bridgeAt = hqStopAt(t0, hq.HQ_BRIDGE.stop);
  for (const h of hq.HQ_BIKE_HUBS) {
    const what = h.mode === 'ride' ? '換上騎車的衣服出發' : '騎到了，沖澡換回上班的衣服';
    out.push({ lat: h.lat, lng: h.lng, at: bridgeAt + 1500, kind: h.mode === 'ride' ? 'ridehub' : 'workhub', scale, hint: { title: `運動驛站（${h.name}站旁：${what}）`, intro: `${I['驛站接自行車橋'] ?? ''}\n${I['運動驛站'] ?? ''}` } });
  }
  // 條通（v1.552；v1.553 使用者說「不要用燈籠」，改成政見講的樹木與車架）：船離條通最近時，巷子兩側一棵棵小樹從二條通長到九條通（每 70 公尺一棵，
  // 巷子南北只隔 40 公尺，太密會擠成一團）；林森北路交叉口（熱點）放腳踏車架；七條通的夜市長協調。樹、車架拉近（電腦版 3 km、手機 2 km 以內）才畫
  const tiaoAt = hqNearestAt(t0, HQ_TIAO_CENTER);
  const tiaoHint = { title: '條通：樹木與車架・步行者特區・夜市長（示意）', intro: I['條通'] ?? '' };
  if (view !== 'radar' || scaleKm <= hqDenseKm()) {
    hq.HQ_TIAOTONG.forEach((ln, li) => {
      let j = 0;
      for (const w of ln.ways) for (const q of hqAlong(w.pts, 70, 15)) out.push({ lat: q[0], lng: q[1], at: tiaoAt + li * 350 + j++ * 120, kind: 'streettree', scale: 0.6 * zs });
      // 巷口（中山北路那頭）掛一盞燈籠（v1.555 使用者說「可以放一些燈籠」）
      const mouth = ln.ways[0].pts[0];
      out.push({ lat: mouth[0], lng: mouth[1], at: tiaoAt + li * 350, kind: 'lantern', scale: 0.55 * zs });
      // 林森北路交叉口：這條巷子最靠近林森北路的那一頭
      const ends = ln.ways.flatMap((w) => [w.pts[0], w.pts[w.pts.length - 1]]);
      const hot = ends.reduce((a, b) => (Math.abs(b[1] - HQ_LINSEN_LNG) < Math.abs(a[1] - HQ_LINSEN_LNG) ? b : a));
      out.push({ lat: hot[0], lng: hot[1], at: tiaoAt + 600 + li * 120, kind: 'bikerack', scale: 0.6 * zs });
    });
    // 夜色的一角（東北）掛月亮、星星
    out.push({ lat: 25.0514, lng: 121.5277, at: tiaoAt + 300, kind: 'nightsky', scale: 0.8 * zs });
  }
  out.push({ lat: HQ_NIGHT_MAYOR.lat, lng: HQ_NIGHT_MAYOR.lng, at: tiaoAt + 1200, kind: 'nightmayor', scale, label: '條通・夜市長', hideKm: 5, hint: tiaoHint });
  // TPASS 共享機車（v1.555）：捷運南京三民站刷卡騎走、民生立體停車場停進共享機車格
  const tp = hq.HQ_TPASS;
  const tpAt = hqNearestAt(t0, tp.station) + 600;
  const tpHint = (where: string): { title: string; intro: string } => ({ title: `TPASS 共享機車（${where}，示意）`, intro: I['TPASS共享機車'] ?? '' });
  out.push({ lat: tp.station.lat, lng: tp.station.lng, at: tpAt, kind: 'tpassgo', scale, hint: tpHint(`${tp.station.name}：刷卡騎走`) });
  out.push({ lat: tp.lot.lat, lng: tp.lot.lng, at: tpAt + 600, kind: 'tpasspark', scale, hint: tpHint(`${tp.lot.name}：停進共享機車格`) });
  // 內科智慧錯峰（v1.573，港湖政見開箱）：內科瑞光路的辦公大樓，船離它最近時
  const sg = hq.HQ_STAGGER;
  out.push({ lat: sg.lat, lng: sg.lng, at: hqNearestAt(t0, sg) + 300, kind: 'stagger', scale, hint: { title: `內科智慧錯峰：選 7–8 點或 8–9 點上班，拿點數換咖啡（${sg.name}，示意）`, intro: I['內科智慧錯峰'] ?? '' } });
  // 南港展覽館散場（v1.574，港湖政見開箱）：展覽館二館，船離它最近時
  const ex = hq.HQ_EXPO;
  out.push({ lat: ex.lat, lng: ex.lng, at: hqNearestAt(t0, ex) + 300, kind: 'expo', scale, hint: { title: '南港展覽館散場：錯峰離場、看完展還有地方去（示意）', intro: I['南港展覽館散場'] ?? '' } });
  // 公車安全改革（v1.555）：市府轉運站（折返點休息、準點出發），洋流號到市政府後（v1.557 使用者說把十字路口拿掉）
  const bs = hq.HQ_BUS_SAFETY;
  const busHint = (where: string): { title: string; intro: string } => ({ title: `公車安全改革（${where}，示意）`, intro: I['公車安全改革'] ?? '' });
  out.push({ lat: bs.terminal.lat, lng: bs.terminal.lng, at: t0 + HQ_SAIL_MS + 1600, kind: 'busterminal', scale, hint: busHint(`${bs.terminal.name}：折返點休息、準點出發`) });
  // 每週免費臨托（v1.650）：萬華親子館（親子館裡離航線最近、附近沒有別的小場景的），船離它最近時；按「親子」時跟著亮
  const rs = hq.HQ_SERVICES.find((sv) => sv.name === '萬華親子館');
  if (rs) out.push({ lat: rs.lat, lng: rs.lng, at: hqNearestAt(t0, rs) + 300, kind: 'respite', scale, hint: { title: '每週免費臨托：家長也能喘口氣（萬華親子館，示意）', intro: I['臨托'] ?? '' } });
  // 循環都更（v1.566）：萬華，船離它最近時；按「都更」時跟著亮
  const cr = hq.HQ_CYCLE_RENEW;
  out.push({ lat: cr.lat, lng: cr.lng, at: hqNearestAt(t0, cr) + 300, kind: 'cyclerenew', scale, hint: { title: `循環都更：先換屋、再都更（${cr.name}，示意）`, intro: I['循環都更'] ?? '' } });
  // 老宅延壽：萬華、大同各一棟老公寓，船離它最近時；按「都更」時也亮著
  for (const h of hq.HQ_OLD_HOUSES) out.push({ lat: h.lat, lng: h.lng, at: hqNearestAt(t0, h) + 300, kind: 'oldhouse', scale, hint: { title: `老宅延壽（${h.district}・${h.name}，示意）`, intro: I['老宅延壽'] ?? '' } });
  for (const p of hq.HQ_POCKETPARKS) out.push({ lat: p.lat, lng: p.lng, at: hqNearestAt(t0, p) + 300, kind: 'pocketpark', scale, hint: { title: `口袋公園（示意：${p.name}）`, intro: I['口袋公園'] ?? '' } });
  for (const d of hq.HQ_DETENTION) out.push({ lat: d.lat, lng: d.lng, at: hqNearestAt(t0, d) + 300, kind: 'detention', scale, hint: { title: `微型社區滯洪（${d.name}）`, intro: I['微型社區滯洪'] ?? '' } });
  // 水圳淨水：水路四成的地方（水注滿 3 秒後），照那一段水流的方向；大灣古河道那一點在光復南路上，搬到往北一點、河道轉進的文昌街 280 巷
  // （v1.548 使用者說不要畫在大馬路上；v1.551 說要在河上面）
  // 蘆葦旁的水流沿著小河畫（v1.559 使用者說「大灣古河道蘆葦旁邊的河流要沿著小河畫」）：對齊到最近的那一段河道上、照那一段的方向
  for (const c of hq.HQ_CANALS) {
    const want = HQ_CLEAN_AT[c.name] ?? c.points[Math.floor(c.points.length * 0.4)];
    const { at: p, bearing } = hqOnLine(c.points, want);
    out.push({ lat: p[0], lng: p[1], at: hqStopAt(t0, c.stop) + 3000, kind: 'cleanwater', scale, rot: bearing, hint: { title: `${c.name}：植生淨水（示意）`, intro: I['水圳淨水'] ?? '' } });
  }
  // 北士科星群（v1.553）：無人公車充電站（雙站合一）、24 小時圖書館（數位圖書館），星星升起時一起冒出來（星群圈內側，不擋星星）
  const north = hq.HQ_STARS.find((st) => st.big);
  if (north) {
    const nAt = hqNearestAt(t0, north) + 1400;
    out.push({ lat: HQ_NORTH_CHARGE.lat, lng: HQ_NORTH_CHARGE.lng, at: nAt, kind: 'buscharge', scale, hint: { title: '北士科：無人公車充電站（雙站合一，示意）', intro: `${I['數位孿生說明'] ?? ''}\n${I['北士科充電站'] ?? ''}` } });
    out.push({ lat: HQ_NORTH_LIBRARY.lat, lng: HQ_NORTH_LIBRARY.lng, at: nAt + 400, kind: 'library24', scale, hint: { title: '北士科：24 小時圖書館（數位圖書館，示意）', intro: `${I['數位孿生說明'] ?? ''}\n${I['北士科圖書館'] ?? ''}` } });
  }
  // 臺北市政府的 AI 支援小隊：洋流號到市政府後（v1.548 使用者說「台北市政府的 AI 小隊畫出來」）
  out.push({ lat: HQ_AI_TEAM.lat, lng: HQ_AI_TEAM.lng, at: t0 + HQ_SAIL_MS + 1200, kind: 'aiteam', scale, hint: { title: '臺北市政府：AI 支援小隊', intro: I['AI支援小隊'] ?? '' } });
  if (!hqLayer) return out;
  const at0 = hqLayer.at;
  if (hqLayer.id === 'zone') {
    // 通學區：每所國小南邊 150 公尺（圈的邊上）畫斑馬線，示意；畫小一點，不要蓋到學校；很密，電腦版 3 km 以內才畫
    if (view === 'radar' && scaleKm > hqDenseKm()) return out;
    // 只有雷達正中間最近的 HQ_WALK_ANIMATED 所在動，其他的停著（v1.568 效能：畫面附近三十幾所同時在動很吃效能；地圖在 map.ts 照地圖正中間挑）
    const schools = hq.HQ_SERVICES.filter((sv) => sv.kind === '小');
    const near = new Set(view === 'radar' ? [...schools].sort((a, b) => haversineKm(origin, a) - haversineKm(origin, b)).slice(0, HQ_WALK_ANIMATED) : schools);
    schools.forEach((sv, i) => {
      const q = destination(sv, 180, 0.15);
      out.push({ lat: q.lat, lng: q.lng, at: at0 + Math.min(i * 8, 1600) + 500, kind: 'schoolwalk', focus: true, scale: 0.4 * zs, ...(near.has(sv) ? {} : { calm: true }) });
    });
  } else if (hqLayer.id === 'edu') {
    for (const tk of hq.HQ_FARM_TRUCKS) {
      const sv = hq.HQ_SERVICES.find((x) => x.name === tk.school);
      if (sv) out.push({ lat: sv.lat, lng: sv.lng, at: at0 + 800, kind: 'lunch', focus: true, scale: zs, hint: { title: `在地小農進校園（${tk.farm} → ${tk.school}，示意）`, intro: I['在地小農'] ?? '' } });
    }
  } else if (hqLayer.id === 'youth') {
    hq.HQ_SERVICES.filter((sv) => sv.kind === '大').forEach((sv, i) => out.push({ lat: sv.lat, lng: sv.lng, at: at0 + Math.min(i * 8, 1600) + 300, kind: 'piggy', focus: true, scale: zs }));
  }
  return out;
}
/**
 * 騎自行車的人（v1.529）：迎風—港墘自行車橋上兩台（橋畫好後）、河濱自行車道（大佳河濱、大稻埕）各兩台（船經過時），一去一回、錯開半趟；
 * 一趟的時間照長度（每公尺 14 毫秒、最少 8 秒）
 */
function hqBikes(t0: number): Array<{ path: Array<[number, number]>; start: number; lap: number; kind?: 'bike' | 'hiker' | 'pet' | 'truck' | 'walker' | 'patrol' | 'scooter'; loop?: boolean; color?: string }> {
  if (!hq) return [];
  const br = hq.HQ_BRIDGE;
  const lapOf = (m: number): number => Math.max(8000, m * 14);
  const bridgeAt = hqStopAt(t0, br.stop) + 2600;
  const out: ReturnType<typeof hqBikes> = [
    { path: [br.from, br.to] as Array<[number, number]>, start: bridgeAt, lap: 8000 },
    { path: [br.to, br.from] as Array<[number, number]>, start: bridgeAt + 4000, lap: 8000 },
  ];
  for (const bk of hq.HQ_BIKES) {
    const mid = bk.path[Math.floor(bk.path.length / 2)];
    const at = hqNearestAt(t0, { lat: mid[0], lng: mid[1] }) + 500;
    const lap = lapOf(bk.lengthM);
    out.push({ path: bk.path, start: at, lap }, { path: [...bk.path].reverse(), start: at + lap / 2, lap });
  }
  const lenM = (pts: Array<[number, number]>): number => pts.reduce((t, q, i) => (i ? t + haversineKm({ lat: pts[i - 1][0], lng: pts[i - 1][1] }, { lat: q[0], lng: q[1] }) * 1000 : 0), 0);
  // 登山客（山林徑，v1.531 使用者說「山林徑可以畫登山人」）：每條步道三個人往上走、錯開；步道畫好後出發，走得慢（每公尺 30 毫秒）
  for (const tr of hq.HQ_TRAILS) {
    const at = hqStopAt(t0, tr.stop) + 2600;
    const lap = Math.max(14000, lenM(tr.pts) * 30);
    for (let k = 0; k < 3; k++) out.push({ path: tr.pts, start: at + (k * lap) / 3, lap, kind: 'hiker' as const });
  }
  // 大安森林公園裡牽狗散步的人（v1.533 使用者說「畫人跟毛孩在大安森林公園裡面玩」）：慢跑道兩組（反方向）、主步道一組，一直繞圈；船經過時出現
  const P = hq.HQ_PARKPLAY;
  const parkAt = hqNearestAt(t0, hq.HQ_PAW) + 600;
  const [jog, main] = P.loops;
  const jogLap = Math.max(30000, jog.lengthM * 28);
  const mainLap = Math.max(18000, main.lengthM * 28);
  out.push(
    { path: jog.path, start: parkAt, lap: jogLap, kind: 'pet', loop: true, color: '#e05a5a' },
    { path: [...jog.path].reverse(), start: parkAt - jogLap / 3, lap: jogLap, kind: 'pet', loop: true, color: '#3a6fd8' },
    { path: main.path, start: parkAt - mainLap / 2, lap: mainLap, kind: 'pet', loop: true, color: '#f2b544' },
  );
  // 騎車通勤（v1.552 使用者說「自行車可以從松山站出發，沿著河濱，過自行車橋」）：松山站 → 基隆河左岸自行車道 → 自行車橋 → 港墘站，兩台錯開半趟
  const cm = hq.HQ_COMMUTE;
  const cmLap = lapOf(cm.lengthM);
  out.push({ path: cm.path, start: bridgeAt + 3000, lap: cmLap }, { path: cm.path, start: bridgeAt + 3000 + cmLap / 2, lap: cmLap });
  // 條通（v1.552）：巷子裡散步的人（走得慢，每公尺 30 毫秒）、巡邏的夜市長（六條通，整條來回）
  const tiaoAt = hqNearestAt(t0, HQ_TIAO_CENTER) + 900;
  const walkColors = ['#e05a5a', '#3a6fd8', '#2f9e6a', '#f2b544', '#8a6fd0'];
  hq.HQ_TIAOTONG.flatMap((ln) => ln.ways)
    .filter((w) => w.pts.length > 1 && lenM(w.pts) > 200)
    .filter((_, i) => i % 2 === 0)
    .forEach((w, i) => {
      const lap = Math.max(9000, lenM(w.pts) * 30);
      out.push({ path: i % 2 ? [...w.pts].reverse() : w.pts, start: tiaoAt + i * 700, lap, kind: 'walker', color: walkColors[i % walkColors.length] });
    });
  const six = hq.HQ_TIAOTONG.find((ln) => ln.name === '六條通');
  if (six) {
    const whole = six.ways.flatMap((w) => w.pts);
    const lap = Math.max(14000, lenM(whole) * 36);
    out.push({ path: [...whole, ...[...whole].reverse()], start: tiaoAt + 400, lap: lap * 2, kind: 'patrol', loop: true });
  }
  // 南港展覽館散場（v1.575）：看完展的人走到 LaLaport 南港、爬上中南山（線長完才出發，走得慢，每公尺 30 毫秒）
  const ex = hq.HQ_EXPO;
  const exAt = hqNearestAt(t0, ex) + 3200;
  const mallLap = Math.max(12000, ex.mall.lengthM * 30);
  const hikeLap = Math.max(14000, ex.trail.lengthM * 30);
  out.push(
    { path: ex.mall.path, start: exAt, lap: mallLap, kind: 'walker', color: '#3a6fd8' },
    { path: ex.mall.path, start: exAt + mallLap / 2, lap: mallLap, kind: 'walker', color: '#2f9e6a' },
    { path: ex.trail.path, start: exAt + 400, lap: hikeLap, kind: 'hiker' },
    { path: ex.trail.path, start: exAt + 400 + hikeLap / 2, lap: hikeLap, kind: 'hiker' },
  );
  // TPASS 共享機車（v1.555）：從捷運南京三民站騎到民生立體停車場（機車比腳踏車快，每公尺 6 毫秒）
  const tp = hq.HQ_TPASS;
  out.push({ path: tp.path, start: hqNearestAt(t0, tp.station) + 2400, lap: Math.max(7000, tp.lengthM * 6), kind: 'scooter' });
  // 在地小農進校園（「教育・午餐」按鈕開著，v1.545）：小貨車從農地開到學校，開車的速度跟健身小巴一樣（每公尺 5 毫秒）
  if (hqLayer?.id === 'edu') for (const tk of hq.HQ_FARM_TRUCKS) out.push({ path: tk.path, start: hqLayer.at + 600, lap: Math.max(9000, tk.lengthM * FITBUS_MS_PER_M), kind: 'truck' });
  return out;
}
/**
 * 健身小巴（v1.525）：萬華繞一圈（龍山寺前 → 南機場社區 → 青年公園，示意）；洋流號經過龍山寺時路線畫出來，2.4 秒後小巴出發，一直繞；
 * 健身小巴分在運動政策，目的是長者健康，所以衛福按鈕亮著時一起亮（使用者問「健身小巴應該算衛福的政策？」）
 */
/** 拉近變大、拉遠變小（雷達）：外圈 5 km 原來的大小，0.45～1.6 倍（v1.536 使用者說「寶箱、巴士也是拉近變大、拉遠變小」；縫線也是同一個比例） */
const hqZoomScale = (): number => Math.min(1.6, Math.max(0.45, Math.sqrt(5 / scaleKm)));
/** 健身小巴在雷達上的大小：跟著縮放（hqZoomScale）；看整個文化網時最小（v1.528 使用者說主軸還是以文化網為主） */
// 小台一點（v1.538 使用者說「健身小巴可以小台一點」）：跟縫線一樣是七成
const hqFitSize = (): number => (hqNetAt !== null ? 0.35 : 0.7 * hqZoomScale());
type HqFitbus = { path: Array<[number, number]>; start: number; lineAt: number; stopAt: number[]; stops: Array<{ at: [number, number]; label: string }>; focus: boolean; dim: boolean; intro: string; driveMs: number };
function hqFitbuses(t0: number): HqFitbus[] {
  if (!hq) return [];
  const F = hq.HQ_FITBUS;
  const focus = hqLayer?.id === 'health';
  const dim = hqNetAt !== null;
  const lineAt = hqNearestAt(t0, F.stops[0]);
  // 開車的時間照路線長度（每公尺 FITBUS_MS_PER_M 毫秒，v1.540 使用者說「開慢一點」）
  const driveOf = (pts: Array<[number, number]>): number => Math.max(12000, pts.reduce((t, q, i) => (i ? t + haversineKm({ lat: pts[i - 1][0], lng: pts[i - 1][1] }, { lat: q[0], lng: q[1] }) * 1000 : 0), 0) * FITBUS_MS_PER_M);
  const out: HqFitbus[] = [{ path: F.path, start: lineAt + 2400, lineAt, stopAt: F.stopAt, stops: F.stops.map((st) => ({ at: [st.lat, st.lng] as [number, number], label: st.name })), focus, dim, intro: '健身小巴', driveMs: driveOf(F.path) }];
  // 河濱、山林徑來回開：路線接上倒回來那一段，兩頭各停一下
  for (const sh of F.shuttles) {
    const a = sh.path[0];
    const b = sh.path[sh.path.length - 1];
    const at = hqNearestAt(t0, { lat: a[0], lng: a[1] });
    const path = [...sh.path, ...sh.path.slice(0, -1).reverse()];
    out.push({ path, start: at + 1500, lineAt: at, stopAt: [0, 0.5], stops: [{ at: a, label: sh.from }, { at: b, label: sh.to }], focus, dim, intro: '健身小巴結合', driveMs: driveOf(path) });
  }
  return out;
}
/** 縫合市民大道：洋流號經過後，從船最靠近的那一處開始，往兩邊每 0.9 秒縫一處；縫完 0.9 秒整條變淡 */
const SEAM_STEP_MS = 900;
/** 縫好後的人流：橫跨市民大道往南北各延伸幾公尺、往北往南兩條相隔幾公尺 */
const SEAM_CROSS_M = 380;
const SEAM_LANE_M = 22;
/** 點亮市民大道的陸橋、廊道、用途：雷達拉近到幾公里以內才寫字（三個基地擠在 2.5 km 裡，字很多） */
const HQ_SEAM_LABEL_KM = 2;
/** 示意的人行陸橋：跨過市民大道往南北各幾公尺 */
const HQ_SEAM_BRIDGE_M = 75;
/** 在 center 跟路（往 along 的方向）垂直、往南北各 m 公尺的兩點（南、北） */
function hqSeamCross(center: [number, number], along: [number, number], m: number): [[number, number], [number, number]] {
  const kx = Math.cos((center[0] * Math.PI) / 180);
  const [dx, dy] = [(along[1] - center[1]) * 111320 * kx, (along[0] - center[0]) * 111320];
  const len = Math.hypot(dx, dy) || 1;
  let [px, py] = [-dy / len, dx / len];
  if (py < 0) [px, py] = [-px, -py];
  const toLL = (x: number, y: number): [number, number] => [center[0] + y / 111320, center[1] + x / (111320 * kx)];
  return [toLL(-px * m, -py * m), toLL(px * m, py * m)];
}
/**
 * 縫合市民大道：出發就畫出裂縫（at），縫線放在離基地最近的高架那一點，方向用旁邊那一點算；
 * 洋流號最靠近哪一處就在那時從那裡縫，再照離它遠近往兩邊縫（v1.521 使用者說「一直到洋流號經過才出現縫合的效果」）；
 * 縫好後兩邊開始互通（v1.526）：每一處橫跨市民大道兩條小點流，一條往北、一條往南
 */
function hqSeam(pts: Array<[number, number]>, at: number, t0: number): HqSeam {
  const S = hq!.HQ_SEAM;
  const idx = S.stitches.map((st) => {
    let j = 0;
    let best = Infinity;
    const [la, ln] = st.near;
    pts.forEach((q, n) => {
      const d = (q[0] - la) ** 2 + ((q[1] - ln) * 0.9) ** 2;
      if (d < best) [best, j] = [d, n];
    });
    return j;
  });
  const ll = (j: number): LatLng => ({ lat: pts[j][0], lng: pts[j][1] });
  const first = idx.reduce((b, j) => (hqDistM(ll(j)) < hqDistM(ll(b)) ? j : b));
  const start = hqNearestAt(t0, ll(first));
  const order = [...idx].sort((a, b) => Math.abs(a - first) - Math.abs(b - first));
  const stitches = idx.map((j, i) => ({
    at: start + order.indexOf(j) * SEAM_STEP_MS,
    center: pts[j],
    along: pts[j === pts.length - 1 ? j - 1 : j + 1],
    label: S.stitches[i].label,
    // 中間那一處（市民八德）的名字寫在下面，三個名字才不會連在一起
    below: i === 1,
  }));
  const walkers = stitches.flatMap((st) => {
    const kx = Math.cos((st.center[0] * Math.PI) / 180);
    const toM = (q: [number, number]): [number, number] => [(q[1] - st.center[1]) * 111320 * kx, (q[0] - st.center[0]) * 111320];
    const toLL = ([x, y]: [number, number]): [number, number] => [st.center[0] + y / 111320, st.center[1] + x / (111320 * kx)];
    const [south, north] = hqSeamCross(st.center, st.along, SEAM_CROSS_M);
    const [sx, sy] = toM(south);
    const [nx, ny] = toM(north);
    const len = Math.hypot(nx - sx, ny - sy) || 1;
    const [ox, oy] = [((ny - sy) / len) * SEAM_LANE_M, (-(nx - sx) / len) * SEAM_LANE_M];
    return [
      { from: toLL([sx + ox, sy + oy]), to: toLL([nx + ox, ny + oy]), at: st.at + 1200 },
      { from: toLL([nx - ox, ny - oy]), to: toLL([sx - ox, sy - oy]), at: st.at + 1500, south: true },
    ];
  });
  return { path: pts, at, healAt: Math.max(...stitches.map((st) => st.at)) + 900, label: '城市縫合・點亮市民大道', labelAt: 0.06, stitches, walkers };
}
/** 一塊地方（社子島）：船快到那一站前 6 秒淡入、留著；名字寫在中間（範圍的平均點） */
function hqAreas(t0: number): Array<{ ring: Array<[number, number]>; center: [number, number]; at: number; label: string; zones?: Array<Array<[number, number]>>; zonesAt?: number }> {
  if (!hq) return [];
  return hq.HQ_AREAS.map((ar) => {
    const n = ar.ring.length;
    const center: [number, number] = [ar.ring.reduce((t, q) => t + q[0], 0) / n, ar.ring.reduce((t, q) => t + q[1], 0) / n];
    // 分區：船到島頭時從西往東一區一區亮
    return { ring: ar.ring, center, at: hqStopAt(t0, ar.stop) - 6000, label: ar.name, zones: ar.zones, zonesAt: hqStopAt(t0, ar.stop) + 200 };
  });
}
/** 都更（政策圖層）：核定滿 5 年未開工的基地範圍 */
function hqSites(): Array<{ rings: Array<Array<[number, number]>>; at: number; center: [number, number] }> {
  if (!hq || hqLayer?.id !== 'renewal') return [];
  const at0 = hqLayer.at;
  return hq.HQ_RENEWAL.map((rn, i) => ({ rings: rn.rings, center: rn.center, at: at0 + Math.min(i * 15, 1000) }));
}
/** 通學區（政策圖層）：每所國小四周 150 公尺的圈（雷達用 20 邊形） */
function hqCircles(): Array<{ lat: number; lng: number; radiusM: number; at: number; ring: Array<[number, number]> }> {
  if (!hq || !hqLayer) return [];
  const ly = hq.HQ_POLICY_LAYERS.find((x) => x.id === hqLayer!.id);
  if (!ly?.zone) return [];
  const at0 = hqLayer.at;
  return hq.HQ_SERVICES.filter((sv) => sv.kind === '小').map((sv, i) => ({
    lat: sv.lat,
    lng: sv.lng,
    radiusM: 150,
    at: at0 + Math.min(i * 8, 1600),
    ring: Array.from({ length: 20 }, (_, j): [number, number] => {
      const q = destination(sv, j * 18, 0.15);
      return [q.lat, q.lng];
    }),
  }));
}
/** 綠覆率：每長回一棵樹（時間）就再鋪一層 */
function hqGreenSteps(t0: number): number[] {
  return hqExtras(t0).icons.filter((ic) => ic.kind === 'regrow').map((ic) => (ic.grow ?? t0) + 600);
}
/** 文化網：文化徑的線（主題色）、登山步道（土色）、老水路（藍）；點是文化徑的點、長回來的樹、登山中心、湧泉、水塘 */
function hqNetwork(at: number): { at: number; lines: Array<{ path: Array<[number, number]>; color: string }>; dots: Array<{ lat: number; lng: number; color: string }>; noFace?: boolean; faceR?: number } {
  if (!hq) return { at, lines: [], dots: [] };
  const T = hq.HQ_CULTURE_THEMES;
  const lines = [
    ...hq.HQ_CULTURE_LINES.map((ln) => ({ path: ln.pts, color: T[ln.theme].color })),
    ...hq.HQ_TRAILS.map((tr) => ({ path: tr.pts, color: '#8a5a24' })),
    ...hq.HQ_CANALS.map((c) => ({ path: c.points, color: '#2b8fd6' })),
  ];
  const dots = [
    ...hq.HQ_CULTURE.map((c) => ({ lat: c.lat, lng: c.lng, color: T[c.theme].color })),
    ...hq.HQ_PLANTINGS.filter((p) => p.kind === 'cut').map((p) => ({ lat: p.lat, lng: p.lng, color: '#3f8f2f' })),
    ...hq.HQ_TRAILS.map((tr) => ({ lat: tr.head[0], lng: tr.head[1], color: '#8a5a24' })),
    ...hq.HQ_SPRINGS.map((sp) => ({ lat: sp.lat, lng: sp.lng, color: '#2b8fd6' })),
    ...hq.HQ_PONDS.map((pd) => ({ lat: pd.ring[0][0], lng: pd.ring[0][1], color: '#2b8fd6' })),
  ];
  return { at, lines, dots };
}
/**
 * 政策圖層的「點 —— 面」（使用者說「點到也可以做類似文化網點線面那種特效」）：那幾種地方一個個點亮，再往外暈開連成一片（服務涵蓋到哪裡）；
 * 這些地方之間沒有路線可以連，所以沒有「線」。通學區已經畫了真的 150 公尺圈，只點亮、不暈開
 */
function hqLayerNetwork(): { at: number; lines: Array<{ path: Array<[number, number]>; color: string }>; dots: Array<{ lat: number; lng: number; color: string }>; noFace?: boolean; faceR?: number } | null {
  if (!hq || !hqLayer) return null;
  const ly = hq.HQ_POLICY_LAYERS.find((x) => x.id === hqLayer!.id);
  if (!ly) return null;
  if (ly.id === 'renewal') return { at: hqLayer.at, lines: [], dots: hq.HQ_RENEWAL.map((rn) => ({ lat: rn.center[0], lng: rn.center[1], color: '#d64545' })), noFace: true };
  const dots = hq.HQ_SERVICES.filter((sv) => ly.kinds.includes(sv.kind)).map((sv) => ({ lat: sv.lat, lng: sv.lng, color: hq!.HQ_SERVICE_KINDS[sv.kind].color }));
  return { at: hqLayer.at, lines: [], dots, noFace: !!ly.zone, faceR: ly.faceR };
}
/** 報導的出處（介紹裡寫） */
const hqOutlet = (url?: string): string => (!url ? '' : url.includes('mirrordaily') ? '鏡報' : url.includes('newtalk') ? '新頭殼' : url.includes('pts.org') ? '公視' : url.includes('udn.com') ? '聯合報' : '');
/** 滑鼠移過去的介紹：哪裡、什麼時候開始感應（東西出現了才感應）、標題、內容 */
function hqHits(t0: number): Array<{ lat: number; lng: number; at: number; title: string; intro: string; dy?: number; r?: number }> {
  if (!hq) return [];
  const I = hq.HQ_INTROS;
  const hits: ReturnType<typeof hqHits> = [];
  const ex = hqExtras(t0);
  // 健身小巴的三站（示意）
  for (const fb of hqFitbuses(t0)) for (const st of fb.stops) hits.push({ lat: st.at[0], lng: st.at[1], at: fb.lineAt + 1200, title: `健身小巴：${st.label}（示意）`, intro: I[fb.intro] ?? '', dy: -8, r: 14 });
  // 縫合市民大道：縫線的地方、「縫合市民大道」那幾個字
  for (const sm of ex.seams) {
    const S = hq.HQ_SEAM;
    // 裂縫出來就可以看介紹
    sm.stitches.forEach((st, i) => hits.push({ lat: st.center[0], lng: st.center[1], at: sm.at + 1400, title: S.stitches[i].title, intro: I[S.stitches[i].intro] ?? '', r: 13 }));
    const lp = sm.path[Math.floor((sm.path.length - 1) * sm.labelAt)];
    hits.push({ lat: lp[0], lng: lp[1], at: sm.healAt, title: '城市縫合－點亮市民大道', intro: I['縫合市民大道'] ?? '', dy: 10, r: 14 });
  }
  for (const ic of ex.icons) {
    if (ic.hint) {
      hits.push({ lat: ic.lat, lng: ic.lng, at: ic.at, title: ic.hint.title, intro: ic.hint.intro, r: 9 });
      continue;
    }
    if (ic.kind === 'regrow') {
      const p = hq.HQ_PLANTINGS.find((x) => x.lat === ic.lat && x.lng === ic.lng);
      if (!p) continue;
      const outlet = hqOutlet(p.source);
      hits.push({ lat: ic.lat, lng: ic.lng, at: ic.grow ?? ic.at, title: p.hideName ? '南港的老樹' : p.name, intro: `${p.why}${outlet ? `（${outlet}報導）` : ''}。\n綠覆率：${I['綠覆率'] ?? ''}\n都市微森林：把樹種回來；移除路樹前，市府、居民、樹木專家、保險業者、都計或樹管委員至少五方一起討論。\n都市林治理：${I['都市林治理'] ?? ''}\n${I['路樹數位雙生說明'] ?? ''}\n樹醫生：${I['樹醫生'] ?? ''}`, dy: 14, r: 16 });
    } else if (ic.kind === 'culture') {
      const c = hq.HQ_CULTURE.find((x) => x.lat === ic.lat && x.lng === ic.lng);
      if (!c) continue;
      const th = hq.HQ_CULTURE_THEMES[c.theme];
      hits.push({ lat: c.lat, lng: c.lng, at: ic.at, title: c.name, intro: `文化徑「${th.name}」：${th.intro}${c.note ?? ''}`, r: 9 });
    } else if (ic.kind === 'hut') {
      const tr = hq.HQ_TRAILS.find((x) => x.head[0] === ic.lat && x.head[1] === ic.lng);
      if (tr) hits.push({ lat: ic.lat, lng: ic.lng, at: ic.at, title: `${tr.name}登山觀光中心`, intro: I[tr.name] ?? '', dy: 3, r: 14 });
    } else if (ic.kind === 'stadium' || ic.kind === 'dome') {
      const v = hq.HQ_VENUES.find((x) => x.lat === ic.lat && x.lng === ic.lng);
      if (v) hits.push({ lat: v.lat, lng: v.lng, at: ic.at, title: v.name, intro: I[v.name] ?? '', r: 16 });
    }
  }
  const big = hq.HQ_STARS.find((st) => st.big);
  if (big) hits.push({ lat: big.lat, lng: big.lng, at: hqNearestAt(t0, big), title: '北士科星群計畫・台北研究院', intro: I['北士科星群'] ?? '', r: 22 });
  const br = hq.HQ_BRIDGE;
  hits.push({ lat: (br.from[0] + br.to[0]) / 2, lng: (br.from[1] + br.to[1]) / 2, at: hqStopAt(t0, br.stop), title: br.name, intro: I[br.name] ?? '', r: 12 });
  for (const c of hq.HQ_CANALS) {
    const mid = c.points[Math.floor(c.points.length / 2)];
    hits.push({ lat: mid[0], lng: mid[1], at: hqStopAt(t0, c.stop), title: c.name, intro: I[c.name] ?? '', r: 16 });
  }
  for (const sp of hq.HQ_SPRINGS) hits.push({ lat: sp.lat, lng: sp.lng, at: hqStopAt(t0, sp.stop), title: `${sp.name}（湧泉）`, intro: I[sp.name] ?? '', r: 14 });
  for (const pd of hq.HQ_PONDS) {
    const n = pd.ring.length;
    const lat = pd.ring.reduce((t, q) => t + q[0], 0) / n;
    const lng = pd.ring.reduce((t, q) => t + q[1], 0) / n;
    hits.push({ lat, lng, at: hqStopAt(t0, pd.stop), title: pd.name, intro: I[pd.name] ?? '', r: 16 });
  }
  if (hqLayer?.id === 'renewal') {
    for (const rn of hq.HQ_RENEWAL) hits.push({ lat: rn.center[0], lng: rn.center[1], at: hqLayer.at, title: rn.name, intro: `${rn.approved} 核定${rn.blic ? '，已拿到建照' : ''}；都市更新審議平台上沒有開工紀錄（2026-11-05 查）。`, r: 10 });
  }
  const cityHall = hq.HQ_TOUR[hq.HQ_TOUR.length - 1];
  hits.push({ lat: cityHall.lat, lng: cityHall.lng, at: t0 + HQ_SAIL_MS, title: '臺北市政府（公務員減壓）', intro: I['臺北市政府'] ?? '', r: 18 });
  for (const ar of hqAreas(t0)) hits.push({ lat: ar.center[0], lng: ar.center[1], at: ar.at, title: `${ar.label}`, intro: I[ar.label] ?? '', r: 26 });
  for (const b of hq.HQ_BOATS) hits.push({ lat: b.lat, lng: b.lng, at: hqNearestAt(t0, b), title: `水上活動（${b.kind === 'sup' ? 'SUP' : '龍舟'}）`, intro: I['水上活動'] ?? '', r: 12 });
  return hits;
}
/**
 * 經過的區名（每一區寫第一次經過的那一站；總部那一站有星星不用寫）、終點一直寫著「臺北市政府」；
 * 「把樹種回來」寫在第一個砍樹的地方上面（地名的上面一行），出現後留著（使用者說出現文字後可以留在上面）
 */
function hqTourStops(t0: number): Array<{ lat: number; lng: number; label: string; at: number; keep?: boolean; stay?: boolean; dy?: number; hideKm?: number }> {
  if (!hq) return [];
  const { HQ_TOUR, HQ_TOUR_AT } = hq;
  const seen = new Set([HQ_TOUR[0].district]);
  const end = HQ_TOUR[HQ_TOUR.length - 1];
  const firstCut = hqPlantings(t0).find((p) => p.kind === 'cut');
  // 「水上活動」寫在最早出現的那艘船上面，出現後留著
  const firstBoat = hq.HQ_BOATS.map((b) => ({ ...b, at: hqNearestAt(t0, b) })).sort((a, b) => a.at - b.at)[0];
  const firstCulture = hq.HQ_CULTURE.map((c) => ({ ...c, at: hqNearestAt(t0, c) })).sort((a, b) => a.at - b.at)[0];
  // 「把水找回來」寫在最早找回來的那一條老水路（或湧泉、水塘）上面，出現後留著；各自的名字另外寫
  const waters = [
    ...hq.HQ_CANALS.map((c) => ({ at: hqStopAt(t0, c.stop), lat: c.points[Math.floor(c.points.length / 2)][0], lng: c.points[Math.floor(c.points.length / 2)][1] })),
    ...hq.HQ_SPRINGS.map((sp) => ({ at: hqStopAt(t0, sp.stop), lat: sp.lat, lng: sp.lng })),
    ...hq.HQ_PONDS.map((pd) => ({ at: hqStopAt(t0, pd.stop), lat: pd.ring[0][0], lng: pd.ring[0][1] })),
  ].sort((a, b) => a.at - b.at)[0];
  return [
    ...(waters ? [{ lat: waters.lat, lng: waters.lng, label: '把水找回來', at: waters.at + 1400, stay: true, dy: -36 }] : []),
    ...(firstCut ? [{ lat: firstCut.lat, lng: firstCut.lng, label: '把樹種回來', at: firstCut.at + 300, stay: true, dy: HQ_TREES ? -36 : -58, hideKm: HQ_NET_LABEL_KM }] : []),
    ...(firstCulture ? [{ lat: firstCulture.lat, lng: firstCulture.lng, label: '文化徑', at: firstCulture.at + 300, stay: true, dy: -14 }] : []),
    ...(firstBoat ? [{ lat: firstBoat.lat, lng: firstBoat.lng, label: '水上活動', at: firstBoat.at + 600, stay: true, dy: -26 }] : []),
    ...HQ_TOUR.flatMap((st, i) => {
      if (seen.has(st.district)) return [];
      seen.add(st.district);
      return [{ lat: st.lat, lng: st.lng, label: st.district, at: t0 + voyageTimeOf(HQ_TOUR_AT[i]) }];
    }),
    { lat: end.lat, lng: end.lng, label: end.place, at: t0, keep: true },
  ];
}

function selectRoute(id: string | null): void {
  routeOnMap = null;
  selectedRoute = selectedRoute === id ? null : id;
  selectedLandmark = null;
  selectedBottle = null;
  selectedId = null;
  choosing = null;
  selectedGroup = [];
  if (selectedRoute) {
    themeSheet.hidden = true;
    kwSheet.hidden = true;
    reportSheet.hidden = true;
    bottleSheet.hidden = true;
  }
  render();
}

function select(id: number | null, group: number[] = []): void {
  feedbackSheet.hidden = true;
  routeOnMap = null;
  selectedRoute = null;
  selectedLandmark = null;
  selectedBottle = null;
  if (group.length > 1) {
    // 疊在一起的先列出來讓人選；同一群再點一次就收起
    choosing = sameGroup(choosing, group) ? null : group;
    selectedGroup = group;
    selectedId = null;
    if (choosing) {
      themeSheet.hidden = true;
      kwSheet.hidden = true;
      reportSheet.hidden = true;
      bottleSheet.hidden = true;
    }
    render();
    return;
  }
  choosing = null;
  // 從同一群切換到另一個時保留整群，其他情況（點清單）就清掉
  selectedGroup = id !== null && selectedGroup.includes(id) ? selectedGroup : [];
  selectedId = selectedId !== id ? id : null;
  if (selectedId !== null) {
    themeSheet.hidden = true;
    kwSheet.hidden = true;
    reportSheet.hidden = true;
    bottleSheet.hidden = true;
  }
  render();
}

/**
 * 從「我的回報」的「看」或剛回報完的結果點進來：被「顯示」「只看進行中」或時間範圍藏起來的，自動調整到看得到，再選取。
 * 剛放上雷達的可能還沒抓到，先重抓一次。固定據點用任一個時段的 id 都找得到那個據點。
 * center：雷達中心飛到那一點，範圍不變（v1.644 使用者說回報後點「看」要把畫面移到那個點；推播通知點進來的照舊只選取）
 */
/**
 * 活動卡片的「定位到活動」（v1.689 使用者說點了直接定位過去）：像「定位」一樣移過去當中間、範圍拉到外圈 2 km（本來就比較近的不動）。
 * 雷達只能以你的位置為中心，所以你的位置移過去（跟拖曳雷達一樣變手動位置，按「定位」回來）；地圖只移地圖，藍點「我的位置」不動
 */
function centerOnEvent(ev: EventOut): void {
  if (ev.lat == null || ev.lng == null) return;
  const km = locateKm(earthMinKm());
  if (view === 'map') {
    map.focusOn({ lat: ev.lat, lng: ev.lng }, km, sheetCover());
    return;
  }
  if (radar.spaceFocused) return;
  if (radar.spaceMoved) radar.resetSpace();
  zoomToKm(km, { lat: ev.lat, lng: ev.lng, source: 'manual' });
}

/** 選到這一則（找不到：結束了、下架了、在別的模組也沒有，回傳 false） */
async function reveal(id: number, center = false): Promise<boolean> {
  const find = (now: number): Item | undefined => computeItems(now).find((x) => x.ev.id === id || x.spot?.sessions.some((s) => s.id === id));
  themeSheet.hidden = true;
  kwSheet.hidden = true;
  reportSheet.hidden = true;
  bottleSheet.hidden = true;
  if (!find(nowSec())) await refresh();
  // 在別的模組找不到（例如點了洋流的推播通知）：切回洋流再找
  if (!find(nowSec()) && !mod.current) {
    switchModule('current', false);
    await refresh();
  }
  const now = nowSec();
  const it = find(now);
  // 搜尋中、這一則不符合：清掉搜尋才看得到
  if (it && searchTerms.length > 0 && !matchesSearch(it)) {
    searchInput.value = '';
    searchClear.hidden = true;
    searchTerms = [];
  }
  if (it) {
    // 這一類被關掉了：打開
    const cat = categoryOf(it);
    if (!shown[cat]) {
      shown[cat] = true;
      lsSet(CATEGORY_LS[cat], '1');
    }
    // 只看進行中、但這個現在還沒開始：關掉只看進行中
    if (onlyActive && !activeNow(it, now)) {
      onlyActive = false;
      lsSet(LS_ONLY_ACTIVE, '0');
    }
    // 時間範圍外（還要很久才開始）的雷達不畫：改成「全部」
    if (!inTime(it, now)) setTime('all');
  }
  const target = it?.ev.id ?? id;
  // select 再點同一個會取消選取，這裡一定要選上
  if (selectedId === target) render();
  else select(target);
  const at = it?.ev;
  if (center && at && at.lat != null && at.lng != null && !radar.spaceFocused) {
    if (radar.spaceMoved) radar.resetSpace();
    zoomToKm(scaleKm, { lat: at.lat, lng: at.lng, source: 'manual' });
  }
  return !!it;
}

/**
 * 分享這一則（v1.688 使用者說的）：連結是 current-radar.pages.dev/e/編號（網站自己做 LINE、Threads 的預覽卡片，網址不出現後端的位址），
 * 手機叫出系統的分享選單，電腦（或不支援分享的）複製連結
 */
const SHARE_ORIGIN = 'https://current-radar.pages.dev';
async function shareEvent(ev: EventOut): Promise<void> {
  const url = `${SHARE_ORIGIN}/e/${ev.id}`;
  const title = titleOf(ev);
  const text = `${title}\n${ev.allDay ? `${dateFmt.format(new Date(ev.startAt * 1000))} ${allDayText(ev, false)}` : eventTimeText(ev)}・${placeLine(ev)}`;
  const phone = window.matchMedia('(pointer: coarse)').matches;
  if (phone && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (e) {
      // 自己按取消：不用再複製
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showBanner(bannerEl, `已複製活動連結：${url}`, 4000);
  } catch {
    showBanner(bannerEl, `活動連結：${url}`, 10_000);
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** 拖曳雷達：開始拖之前的位置（放開時跟它比有沒有移動，決定要不要重抓） */
let panFrom: Origin | null = null;
let panFrame = 0;

/**
 * 在雷達上拖曳＝移動你的位置（變成手動位置）。拖的時候只重畫雷達、清單，範圍維持原本的公里數；
 * 放開才存下來、重抓附近的資料（全台的範圍也這時照新位置重算）
 */
function panRadar(bearing: number, km: number, done: boolean): void {
  // 「定位」飛到一半就拖：先到目的地，從那裡開始拖；洋流總部的特效播放中自己拖了就不再跟著船
  if (flight) landFlight();
  if (hqVoyageAt !== null && km > 0) hqUserMoved = true;
  if (!panFrom) panFrom = origin;
  if (km > 0) {
    const p = destination(origin, bearing, km);
    origin = { lat: Math.max(-85, Math.min(85, p.lat)), lng: p.lng, source: 'manual' };
  }
  if (done) {
    const end = origin;
    origin = panFrom;
    panFrom = null;
    if (end !== origin) setOrigin(end);
    return;
  }
  if (!panFrame) {
    panFrame = requestAnimationFrame(() => {
      panFrame = 0;
      render();
    });
  }
}

/** 最新的 GPS 位置（手動位置時也一直更新） */
let lastGps: Origin | null = null;
let lastGpsAccuracy: number | null = null;

/** 上次知道的位置（最後一次的 GPS 或移動前的位置），連同 GPS 誤差；存在瀏覽器，重新開頁面也記得 */
interface Home {
  lat: number;
  lng: number;
  source: 'gps' | 'default';
  accuracy: number | null;
}

function loadHome(): Home | null {
  const raw = lsGet(LS_HOME);
  if (!raw) return null;
  try {
    const h = JSON.parse(raw) as Home;
    if ((h.source === 'gps' || h.source === 'default') && Number.isFinite(h.lat) && Number.isFinite(h.lng)) return h;
  } catch {
    /* ignore */
  }
  return null;
}

let home: Home | null = loadHome();

/**
 * 「定位」（v1.468 起「回到我的位置」拿掉，統一用「定位」）：你在汪星就回到汪星的發射口（範圍拉到外圈 LOCATE_KM，本來就比較近的不動）；
 * 在地球照 locateMe（先馬上飛回我的位置，再重新抓一次 GPS）。火箭飛行中沒有反應
 */
function locate(): void {
  if (tripping) return;
  lockDog(null);
  // 你在汪星：回到汪星的發射口（點別的星球只是看過去，坐火箭回來才回到地球）
  if (youOn === 'woof') {
    void woofHomeView().then((v) => {
      radar.setSpaceView(v);
      zoomToKm(locateKm(0));
    });
    return;
  }
  void locateMe();
}

// ---- 汪星的狗：點了出現「鎖定」，按了雷達正中間跟著牠（鏡頭慢慢追上），再按、自己拖曳、換星球、定位、搭火箭、切到地圖就解除 ----

function updateDogLockBtn(): void {
  dogLockBtn.hidden = !(dogLocked || dogOffer) || view !== 'radar';
  dogLockBtn.textContent = dogLocked ? '解除鎖定' : '鎖定';
  dogLockBtn.classList.toggle('on', !!dogLocked);
  dogLockBtn.setAttribute('aria-pressed', String(!!dogLocked));
}

/** 點了狗：出現「鎖定」（已經鎖定就維持） */
function offerDogLock(id: string): void {
  if (dogLocked) return;
  dogOffer = id;
  window.clearTimeout(dogOfferTimer);
  dogOfferTimer = window.setTimeout(() => {
    dogOffer = null;
    updateDogLockBtn();
  }, 10_000);
  updateDogLockBtn();
}

/** 鎖定這隻狗（null 是解除：記住現在的看法） */
function lockDog(id: string | null): void {
  const was = dogLocked;
  dogLocked = id;
  dogOffer = null;
  window.clearTimeout(dogOfferTimer);
  updateDogLockBtn();
  if (id && !dogFollow) dogFollow = requestAnimationFrame(followDog);
  if (!id && was) {
    saveSpaceView();
    updateViewBtn();
  }
}

/** 每一格把汪星轉到狗在的地方（每一格追上剩下的 2 成：一開始慢慢移過去，之後緊跟著） */
function followDog(): void {
  dogFollow = 0;
  if (!dogLocked || !spaceMod || !parkMod || tripping) return;
  const at = parkMod.dogAt(dogLocked);
  if (!at || radar.spaceFocusKey !== 'woof') {
    lockDog(null);
    return;
  }
  const [la, ln] = spaceMod.toWoof(at);
  const v = radar.spaceViewNow;
  const [yaw, pitch] = [(-ln * Math.PI) / 180, (la * Math.PI) / 180];
  const k = Math.hypot(yaw - v.yaw, pitch - v.pitch) < 1e-9 ? 1 : 0.2;
  radar.followSpace({ focus: 'woof', yaw: v.yaw + (yaw - v.yaw) * k, pitch: v.pitch + (pitch - v.pitch) * k });
  dogFollow = requestAnimationFrame(followDog);
}

/**
 * 雷達上不提供地圖（地圖是地球的）：在汪星上（你在汪星，或鏡頭轉到汪星），
 * 或拉遠超過全球（太空：看整顆地球、太陽系，或中心換到別的星球）
 */
function noMapView(): boolean {
  return youOn === 'woof' || radar.spaceFocused || scaleKm > SPACE_FROM_KM;
}

/** 在汪星上、超過全球「地圖」按鈕藏起來 */
function updateViewBtn(): void {
  viewBtn.hidden = view === 'radar' && noMapView();
}

function setOrigin(o: Origin): void {
  const moved = haversineKm(origin, o) > 0.2;
  // 記住不是手動的位置：之後拖曳、在地圖上設定，「定位」可以直接回來
  // （預設位置不蓋掉上次的 GPS 位置）
  if (o.source === 'gps' || (o.source === 'default' && home?.source !== 'gps')) {
    home = { lat: o.lat, lng: o.lng, source: o.source, accuracy: o.source === 'gps' ? gpsAccuracy : null };
    lsSet(LS_HOME, JSON.stringify(home));
  }
  origin = o;
  if (o.source === 'manual') lsSet(LS_ORIGIN, JSON.stringify(o));
  map.setOrigin(o, moved, o.source === 'gps' ? gpsAccuracy : null);
  originLabel.textContent = o.source === 'gps' ? 'GPS 定位' : o.source === 'manual' ? '手動位置' : '預設：台北車站';
  updateViewBtn();
  if (isAutoScale(scaleSetting) && scaleKmFor(scaleSetting) !== scaleKm) {
    scaleKm = scaleKmFor(scaleSetting);
    radar.setScale(scaleKm);
  }
  // 先用手上的資料照新位置畫（跟拖曳時一樣），不用等重抓回來；移動了再去抓新位置附近的
  render();
  if (moved) void refresh();
  if (pushOn() && o.source !== 'default' && (!pushSyncedAt || haversineKm(pushSyncedAt, o) > PUSH_RESYNC_KM)) void syncPush(false);
}

/** 每次重抓加一；切換模組時，舊模組還沒回來的結果不要蓋掉新的 */
let fetchSeq = 0;

/**
 * 只重抓看得到的漂流瓶（v1.655 使用者說定位後要重新整理看得到的漂流瓶）：照現在的 GPS 位置抓看得到範圍（1 km）內的；
 * 「定位」成功後不管移動多少都抓一次（位置差不到 200 m 時 setOrigin 不會整個重抓）
 */
let bottleSeq = 0;
async function reloadBottles(): Promise<void> {
  if (!bottlesOn()) return;
  const seq = ++bottleSeq;
  const got = await fetchBottles(bottleCenter(), bottleSeeKm());
  if (seq !== bottleSeq) return;
  bottles = withMine(got);
  render();
}

async function refresh(): Promise<void> {
  const seq = ++fetchSeq;
  const forModule = mod;
  // 搜尋關鍵字、車掃路線、漂流瓶都是洋流才有
  const kws = forModule.current ? followed() : [];
  // 漂流瓶跟關鍵字無關，一起抓
  const bottleReq = bottlesOn() ? fetchBottles(bottleCenter(), bottleSeeKm()) : Promise.resolve([] as BottleOut[]);
  // 這次抓的時候之後又只重抓了漂流瓶（定位後）：瓶子用那一次的，不要被這次（舊位置）蓋掉
  const bseq = bottleSeq;
  const freshBottles = (got: BottleOut[]): BottleOut[] => (bottleSeq === bseq ? withMine(got) : bottles);
  void loadWoofBottles();
  if (forModule.current && kws.length === 0) {
    events = [];
    bottles = freshBottles(await bottleReq);
    lastFetchAt = nowSec();
    updatedLabel.textContent = `↻ 更新 ${fmtTime(lastFetchAt)}`;
    render();
    return;
  }
  try {
    const radius = fetchRadiusKm(scaleKm);
    const got = await Promise.all([fetchEvents(origin, radius, kws, forModule.id), forModule.current ? currentRoutes() : Promise.resolve([] as RouteOut[]), bottleReq]);
    if (seq !== fetchSeq) return;
    [events, routes] = got;
    bottles = freshBottles(got[2]);
    // 車掃剛放上雷達：路線還在快取裡沒有這條，每一站會各自畫出來；有這種點就馬上重抓路線（同一則只重抓一次）
    const missing = forModule.current ? [...new Set(events.filter((ev) => ev.route && !routes.some((r) => r.postId === ev.post.id)).map((ev) => ev.post.id))] : [];
    if (missing.some((id) => !routesRefetched.has(id))) {
      for (const id of missing) routesRefetched.add(id);
      routesAt = 0;
      routes = await currentRoutes();
      if (seq !== fetchSeq) return;
    }
    lastFetchRadius = radius;
    lastFetchAt = nowSec();
    updatedLabel.textContent = `↻ 更新 ${fmtTime(lastFetchAt)}`;
  } catch (e) {
    updatedLabel.textContent = '↻ 連線失敗，點這裡重試';
    console.warn(e);
  }
  render();
}

function switchView(v: 'radar' | 'map'): void {
  // 在汪星上、超過全球（太空）不切到地圖
  if (v === 'map' && noMapView()) return;
  // 雷達藏起來前先量外圈多大，地圖照同樣的比例
  const rangePx = radar.rangePx();
  const from = view;
  view = v;
  $('#radar-view').hidden = v !== 'radar';
  $('#map-view').hidden = v !== 'map';
  if (v !== 'radar') lockDog(null);
  updateViewBtn();
  $('#stage').dataset.view = v;
  viewBtn.textContent = v === 'radar' ? '地圖' : '雷達';
  $('#scale-chips').hidden = v !== 'radar';
  baseChipsEl.hidden = v !== 'map';
  compassBtn.hidden = v !== 'radar' || !compassSupported();
  if (v === 'map') map.showRange(scaleKm, rangePx);
  // 切回雷達：雷達範圍改成地圖目前的比例（接近某個按鈕的範圍就對齊那個按鈕）
  const kmPerPx = map.kmPerPx();
  const px = radar.rangePx();
  if (v === 'radar' && from === 'map' && kmPerPx && px > 0) zoomRadar((kmPerPx * px) / scaleKm, true);
  // 切到地圖：遊行進行中第一次在地圖上看到就流出彩虹（不用等下一次每 5 秒的重算）
  if (v === 'map') render();
}

/** 要抓多遠的：範圍超過 600 km 就抓全世界 */
const fetchRadiusKm = (km: number): number => (km > FETCH_RADIUS_KM ? WORLD_KM : FETCH_RADIUS_KM);

/** 你在汪星（搭火箭過去，坐火箭回來為止） */
const onWoof = (): boolean => youOn === 'woof';
/**
 * 汪星上的範圍按鈕：汪星半徑只有約 6.6 km、陸地（台北）幾乎包住整顆，地球的 20 km、全台、全球都比整顆大，
 * 換成 1、2、3、5 km 和全球（整顆汪星剛好填滿雷達）
 */
const WOOF_CHIPS: Record<string, { km: number | 'all'; text: string; title: string }> = {
  '1': { km: 1, text: '1 km', title: '' },
  '5': { km: 2, text: '2 km', title: '' },
  '20': { km: 3, text: '3 km', title: '' },
  taiwan: { km: 5, text: '5 km', title: '' },
  world: { km: 'all', text: '全球', title: '整顆汪星' },
};
/** 汪星的半徑（space.ts 的 WOOF_KM；還沒載入先用差不多的） */
const woofKm = (): number => spaceMod?.WOOF_KM ?? 6.56;

/** 進出汪星：範圍按鈕換成汪星的（或換回地球的）；換了而且不是剛開頁面，原本按著的按鈕不再亮（範圍不變） */
let chipsOnWoof = false;
let booted = false;
function updateScaleChips(): void {
  const w = onWoof();
  if (w === chipsOnWoof) return;
  chipsOnWoof = w;
  for (const b of scaleChips) {
    const t = w ? WOOF_CHIPS[b.dataset.scale ?? ''] : earthChips.get(b);
    if (!t) continue;
    b.textContent = t.text;
    b.title = t.title;
  }
  if (!booted || scaleSetting === 'custom') return;
  customKm = scaleKm;
  scaleSetting = 'custom';
  lsSet(LS_SCALE, 'custom');
  lsSet(LS_SCALE_KM, String(Number(customKm.toPrecision(3))));
  for (const b of scaleChips) {
    b.classList.remove('on');
    b.setAttribute('aria-checked', 'false');
  }
}

function scaleKmFor(setting: ScaleSetting): number {
  // 汪星上的範圍按鈕
  const wc = onWoof() ? WOOF_CHIPS[setting] : undefined;
  if (wc) return wc.km === 'all' ? woofKm() : wc.km;
  // 中心在別的星球（汪星）：範圍照存的，最近多少由 zoomRadar 照那顆星球管
  if (setting === 'custom') return Math.min(radar.spaceFocused ? customKm : Math.max(customKm, earthMinKm()), SPACE_MAX_KM);
  if (setting === 'taiwan') return taiwanRadiusKm(origin);
  if (setting === 'world') return WORLD_KM;
  return Number(setting);
}

function setBase(b: BaseMap): void {
  baseMap = b;
  lsSet(LS_BASE, b);
  map.setBase(b);
  for (const c of baseChips) {
    const on = c.dataset.base === b;
    c.classList.toggle('on', on);
    c.setAttribute('aria-checked', String(on));
  }
}

let zoomFrame = 0;

/**
 * 「定位」：範圍慢慢縮放到外圈 km 公里、中心同時慢慢移到 to（像 Google 地圖飛過去；頭尾慢，縮放照倍數取對數走、
 * 位置照經緯度內插，差越多、移越遠走越久，ZOOM_TO_MS 之間；移的時候只重畫，到了才 setOrigin：存下來、重抓一次）。
 * 不在雷達畫面（地圖）時直接換（減少動態效果的也照樣飛）；飛到一半自己捏合、滾滾輪、拖曳：位置直接到 to、範圍停在那裡；
 * 飛的時候新的 GPS 位置來了就改飛到那裡（flight.to）
 */
const ZOOM_TO_MS: [number, number] = [500, 1600];
let flight: { frame: number; from: Origin; to: Origin | null } | null = null;
function zoomToKm(km: number, to: Origin | null = null): void {
  landFlight();
  const total = Math.log(km / scaleKm);
  const from = origin;
  const dist = to ? haversineKm(from, to) : 0;
  // 減少動態效果的電腦也照樣飛過去（使用者要看得到移動、縮放）
  if (view !== 'radar' || (Math.abs(total) < 0.01 && dist < 0.001)) {
    if (to) setOrigin(to);
    zoomRadar(km / scaleKm, true);
    return;
  }
  // 移了幾個雷達半徑（照比較近的範圍算）
  const radii = dist / Math.min(scaleKm, km);
  const ms = Math.min(ZOOM_TO_MS[1], Math.max(ZOOM_TO_MS[0], 500 + 120 * Math.abs(total) + 250 * Math.min(radii, 4)));
  const t0 = performance.now();
  let went = 0;
  const f: NonNullable<typeof flight> = { frame: 0, from, to };
  flight = f;
  const step = (now: number): void => {
    const k = Math.min(1, (now - t0) / ms);
    const eased = easeInOut(k);
    if (f.to) origin = { lat: from.lat + (f.to.lat - from.lat) * eased, lng: from.lng + (f.to.lng - from.lng) * eased, source: 'manual' };
    // 縮放（每一格畫面重畫一次，移動也跟著畫）
    zoomRadar(Math.exp(total * (eased - went)), false);
    went = eased;
    if (k < 1) {
      f.frame = requestAnimationFrame(step);
      return;
    }
    flight = null;
    if (f.to) {
      origin = from;
      setOrigin(f.to);
    }
    zoomRadar(1, true);
  };
  f.frame = requestAnimationFrame(step);
}
/** 飛到一半被打斷（自己縮放、拖曳、又按了一次）：位置直接到目的地，範圍停在那裡 */
function landFlight(): void {
  const f = flight;
  if (!f) return;
  cancelAnimationFrame(f.frame);
  flight = null;
  if (f.to) {
    origin = f.from;
    setOrigin(f.to);
  }
  zoomRadar(1, true);
}

/** 雙指縮放、滾輪：連續調整範圍；放開時接近某個按鈕的範圍（差 6% 以內）就對齊那個按鈕 */
/** gesture：雙指、滾輪（太空裡幅度加大）；從地圖切回來是直接換成地圖的比例，不加大 */
function zoomRadar(factor: number, done: boolean, gesture = false): void {
  // 自己縮放：「定位」飛到一半，位置直接到、範圍停在這裡；洋流總部的特效播放中就不再跟著船
  if (gesture && flight) landFlight();
  if (gesture && hqVoyageAt !== null) hqUserMoved = true;
  // 太空（比全球再遠）一次縮放的幅度大一點：從全球到整個太陽系差了幾十萬倍；太陽系外面再大一點（到仙女座星系又差了上億倍）
  const f = gesture && (scaleKm > WORLD_KM || (scaleKm >= WORLD_KM && factor > 1)) ? factor ** (scaleKm >= DEEP_FROM_KM ? 4 : 2) : factor;
  // 太空裡中心換到別的星球（月球、木星…）：最多放大到剛好看得到整顆，汪星可以放大到 1 km，中山公園附近到 0.5 公尺；
  // 地球上雷達正中間在中山公園附近也是 0.5 公尺（放大到比限制還近之後拖離公園：不再放大，可以拉遠）
  const focus = radar.spaceFocusKey;
  const minKm = focus && spaceMod ? spaceMod.focusMinKm(focus, radar.spaceViewNow, woofMap()) : earthMinKm();
  customKm = Math.min(Math.max(scaleKm * f, Math.min(minKm, scaleKm)), SPACE_MAX_KM);
  if (done) {
    // 中心換到別的星球時不對齊按鈕（按鈕的範圍是以你為中心的）
    const near = radar.spaceFocused ? undefined : SCALE_SETTINGS.find((st) => Math.abs(scaleKmFor(st) / customKm - 1) < 0.06);
    if (near) {
      setScale(near);
      return;
    }
    // 有效數字三位（中山公園附近放大到公尺、公分，小數兩位會存成 0）
    lsSet(LS_SCALE_KM, String(Number(customKm.toPrecision(3))));
    if (fetchRadiusKm(customKm) !== lastFetchRadius) void refresh();
  }
  if (scaleSetting !== 'custom' || done) {
    scaleSetting = 'custom';
    lsSet(LS_SCALE, 'custom');
    for (const b of scaleChips) {
      b.classList.remove('on');
      b.setAttribute('aria-checked', 'false');
    }
  }
  scaleKm = customKm;
  radar.setScale(scaleKm);
  // 清單、摘要跟著範圍變，一個畫面更新一次就好
  if (!zoomFrame) {
    zoomFrame = requestAnimationFrame(() => {
      zoomFrame = 0;
      render();
    });
  }
}

function setTime(setting: TimeSetting): void {
  timeSetting = setting;
  lsSet(LS_TIME, setting);
  for (const b of timeChips) {
    const on = b.dataset.time === setting;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
    if (on) timeToggle.lastElementChild!.textContent = b.textContent;
  }
  // 選了「全部」以外的（有篩掉東西）：收起來的那顆亮著提醒
  timeToggle.classList.toggle('on', setting !== 'all');
  timeToggle.setAttribute('aria-label', `時間範圍：${timeToggle.textContent ?? ''}，點了選別的`);
  setTimeOpen(false);
  render();
}

/** 日期選單：最多看 21 天（資料只到 21 天） */
const DATE_SPAN = 21;

/** 選了星期幾、日期：按鈕寫選了什麼、亮起來；時間範圍改成「全部」（不然選明天卻只看 3 小時內的會什麼都沒有） */
function setDayPick(p: typeof dayPick): void {
  dayPick = p && 'weekdays' in p && p.weekdays.size === 0 ? null : p;
  dateToggle.lastElementChild!.textContent = dayPick ? dayPickLabel() : '全部';
  dateToggle.classList.toggle('on', !!dayPick);
  dateToggle.setAttribute('aria-label', dayPick ? `日期：${dayPickLabel()}，點了換別天` : '選星期幾或日期');
  if (dayPick && timeSetting !== 'all') setTime('all');
  if (!datePanel.hidden) renderDatePanel();
  render();
}

/** 日期選單：一排星期幾（可以好幾個，加一顆「週末」），下面是未來 21 天的月曆（有東西的那天下面一個小點） */
function renderDatePanel(): void {
  const wd = dayPick && 'weekdays' in dayPick ? dayPick.weekdays : new Set<number>();
  const order = [1, 2, 3, 4, 5, 6, 0];
  datePanel.querySelector('.date-week')!.innerHTML =
    order.map((w) => `<button type="button" class="chip${wd.has(w) ? ' on' : ''}" data-wd="${w}" aria-pressed="${wd.has(w)}">${WEEKDAYS[w]}</button>`).join('') +
    `<button type="button" class="chip${wd.size === 2 && wd.has(0) && wd.has(6) ? ' on' : ''}" data-wd="weekend">週末</button>`;
  const today = taipeiDay(nowSec());
  const busy = new Set<number>();
  for (const it of dayFetched) for (const d of itemDays(it)) busy.add(d);
  const picked = dayPick && 'date' in dayPick ? dayPick.date : null;
  // 星期一開頭；今天之前那幾格空著
  const lead = (weekdayOf(today) + 6) % 7;
  let cells = '<span class="date-head">一</span><span class="date-head">二</span><span class="date-head">三</span><span class="date-head">四</span><span class="date-head">五</span><span class="date-head">六</span><span class="date-head">日</span>';
  cells += '<span></span>'.repeat(lead);
  for (let d = today; d < today + DATE_SPAN; d++) {
    const date = new Date(d * 86400 * 1000);
    const md = date.getUTCDate() === 1 || d === today ? `${date.getUTCMonth() + 1}/${date.getUTCDate()}` : String(date.getUTCDate());
    cells += `<button type="button" class="date-day${d === picked ? ' on' : ''}${busy.has(d) ? ' busy' : ''}${d === today ? ' today' : ''}" data-day="${d}" aria-pressed="${d === picked}" aria-label="${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日（${WEEKDAYS[weekdayOf(d)]}）${d === today ? '，今天' : ''}${busy.has(d) ? '，有活動' : ''}">${md}</button>`;
  }
  datePanel.querySelector('.date-cal')!.innerHTML = cells;
}

/**
 * 日期選單開關：選單放在最外層（清單面板會裁掉超出去的），打開時照「日期」按鈕的位置擺：
 * 下面放得下就往下，放不下就往上（手機上清單在下半部），左右不超出畫面
 */
function setDateOpen(open: boolean): void {
  datePanel.hidden = !open;
  dateToggle.setAttribute('aria-expanded', String(open));
  if (!open) return;
  setTimeOpen(false);
  renderDatePanel();
  const r = dateToggle.getBoundingClientRect();
  const w = datePanel.offsetWidth;
  const h = datePanel.offsetHeight;
  const left = Math.max(12, Math.min(r.left - 40, innerWidth - w - 12));
  const top = r.bottom + 6 + h <= innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
  Object.assign(datePanel.style, { left: `${left}px`, top: `${top}px` });
}

/** 時間範圍平常收起來（不太會用到）：只顯示現在選的那顆，點了展開五個，選好、點其他地方就收起來 */
function setTimeOpen(open: boolean): void {
  timeChipsEl.hidden = !open;
  timeToggle.hidden = open;
  timeToggle.setAttribute('aria-expanded', String(open));
}

function setScale(setting: ScaleSetting): void {
  scaleSetting = setting;
  scaleKm = scaleKmFor(setting);
  // 切到全球（或從全球切回來）：抓的範圍不一樣，重抓
  if (fetchRadiusKm(scaleKm) !== lastFetchRadius) void refresh();
  lsSet(LS_SCALE, setting);
  radar.setScale(scaleKm);
  for (const b of scaleChips) {
    const on = b.dataset.scale === setting;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  render();
}

function geoErrorText(e: GeolocationPositionError): string {
  if (e.code === e.PERMISSION_DENIED) return '定位權限被拒絕。請到瀏覽器的網站設定，允許這個網站使用位置，再按一次「定位」。';
  if (e.code === e.TIMEOUT) return '定位逾時，請到戶外或開啟 Wi-Fi 後再試一次。';
  return '目前無法取得位置，請稍後再試，或在雷達上拖曳到你的位置。';
}

/** 按「定位」，雷達、地圖的範圍拉到外圈幾公里（本來就比較近的維持原本的，不拉遠；min 是最近可以到多近） */
const LOCATE_KM = 2;
const locateKm = (min: number): number => Math.max(min, Math.min(scaleKm, LOCATE_KM));

/**
 * 「定位」按鈕：清掉手動位置，先馬上飛回我的位置（上次知道的 GPS 位置，不用等；沒有 GPS、移到了手動位置就回到移動之前的位置），範圍拉到外圈 LOCATE_KM（本來就比較近的不動）
 * （太空裡、轉過視角的先拉回地球）；再重新抓一次 GPS，抓到了移到新的位置（範圍不再動，等的時候自己縮放的照舊）。
 * 不知道上次的位置（電腦常常還沒有 GPS）：等抓到了才飛過去（移動、縮放一起，不會先縮放、再一下跳過去）
 * 抓到 GPS 回 true（新的位置在 lastGps），抓不到、不支援回 false
 */
function locateMe(): Promise<boolean> {
  const known = lastGps ? { ...lastGps, accuracy: lastGpsAccuracy } : home?.source === 'gps' ? home : null;
  // 沒有 GPS 但移到了手動位置：先回到移動之前的位置（以前「回到我的位置」做的，例如電腦沒有 GPS 時的預設位置）
  const back = known ?? (origin.source === 'manual' ? home : null);
  if (back) {
    lsSet(LS_ORIGIN, null);
    gpsAccuracy = known ? known.accuracy : null;
  }
  if (radar.spaceMoved) radar.resetSpace();
  // 知道上次的位置：馬上飛過去（移動、縮放一起）；不知道（電腦常常還沒有 GPS）：等抓到再一起飛過去
  if (back) {
    const km = locateKm(earthMinKm());
    zoomToKm(km, { lat: back.lat, lng: back.lng, source: known ? 'gps' : back.source });
    if (view === 'map') {
      map.setOrigin(origin, true, gpsAccuracy);
      map.showRange(km, 0);
    }
  }
  if (!('geolocation' in navigator)) {
    showBanner(bannerEl, '此瀏覽器不支援定位，可以在雷達上拖曳到你的位置。', 4000);
    return Promise.resolve(false);
  }
  locateBtn.classList.add('on');
  locateBtn.textContent = '定位中…';
  return new Promise((done) => navigator.geolocation.getCurrentPosition(
    (pos) => {
      locateBtn.classList.remove('on');
      locateBtn.textContent = '定位';
      lsSet(LS_ORIGIN, null);
      gpsAccuracy = pos.coords.accuracy;
      lastGps = { lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps' };
      lastGpsAccuracy = pos.coords.accuracy;
      // 還在飛過去：改飛到新的位置；一開始不知道位置：現在才飛過去（移動、縮放一起）；不然直接移過去（只差一點點）
      if (flight?.to) flight.to = lastGps;
      else if (!known) {
        const km = locateKm(earthMinKm());
        zoomToKm(km, lastGps);
        if (view === 'map') {
          map.setOrigin(origin, true, gpsAccuracy);
          map.showRange(km, 0);
        }
      } else {
        setOrigin(lastGps);
        map.setOrigin(origin, true, gpsAccuracy);
      }
      showBanner(bannerEl, `已定位，誤差約 ${Math.round(pos.coords.accuracy)} 公尺`, 2000);
      // 照新的 GPS 位置重抓看得到的漂流瓶（v1.655）
      void reloadBottles();
      done(true);
    },
    (e) => {
      locateBtn.classList.remove('on');
      locateBtn.textContent = '定位';
      showBanner(bannerEl, geoErrorText(e), 5000);
      done(false);
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 },
  ));
}

function startGeolocation(): void {
  if (!('geolocation' in navigator)) {
    showBanner(bannerEl, '此瀏覽器不支援定位，以台北車站為中心');
    return;
  }
  navigator.geolocation.watchPosition(
    (pos) => {
      // 手動位置時也記著最新的 GPS 位置，「定位」可以馬上回來
      lastGps = { lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps' };
      lastGpsAccuracy = pos.coords.accuracy;
      if (origin.source === 'manual') {
        // 手動位置時也存下來：下次開頁面還沒定位到，「定位」也能馬上回到這裡
        home = { ...lastGps, source: 'gps', accuracy: lastGpsAccuracy };
        lsSet(LS_HOME, JSON.stringify(home));
        return;
      }
      gpsAccuracy = pos.coords.accuracy;
      setOrigin(lastGps);
    },
    () => {
      if (origin.source === 'default') showBanner(bannerEl, '還沒取得位置，先以台北車站為中心。按右上「定位」可重試。', 3500);
    },
    { enableHighAccuracy: true, maximumAge: 15_000, timeout: 15_000 },
  );
}

async function toggleCompass(): Promise<void> {
  if (stopCompass) {
    stopCompass();
    stopCompass = null;
    radar.setHeading(null);
    compassBtn.classList.remove('on');
    return;
  }
  const stop = await startCompass((h) => radar.setHeading(h));
  if (!stop) {
    showBanner(bannerEl, '沒有取得方向感測權限，雷達維持北在上', 2500);
    return;
  }
  stopCompass = stop;
  compassBtn.classList.add('on');
  showBanner(bannerEl, '指北針已開啟', 1500);
}

/** 空白時的說法：洋流照主題，其他模組用自己的 */
const emptyText = (): string => (mod.current ? theme.emptyText : mod.emptyText);

const moduleSheet = $('#module-sheet');
const moduleList = $('#module-list');
const reportIntro = $('#report-intro');
const CURRENT_REPORT_INTRO = reportIntro.textContent ?? '';

/** 模組的文字、標題、只有洋流才有的東西（地標、車掃、漂流瓶、類型開關） */
function applyModule(): void {
  document.documentElement.dataset.module = mod.id;
  document.title = mod.current ? theme.name : mod.name;
  brandText.textContent = mod.current ? theme.name : mod.short;
  searchInput.placeholder = mod.searchPlaceholder;
  reportIntro.textContent = mod.current ? CURRENT_REPORT_INTRO : mod.reportIntro;
  // 活動通、OPENTIX 的活動頁只有洋流雷達收；其他雷達只收 Threads 貼文
  $('#report-title').textContent = mod.current ? '回報活動' : '回報貼文';
  reportInput.placeholder = mod.current ? 'Threads、活動通或 OPENTIX 的連結' : 'Threads 貼文的連結';
  reportInput.setAttribute('aria-label', mod.current ? 'Threads 貼文、活動通或 OPENTIX 活動頁的連結' : 'Threads 貼文的連結');
  map.setLandmarksVisible(mod.current);
  if (!mod.current) bottleBtn.hidden = true;
  applyReportsOpen();
  renderReportTips();
  renderModuleList();
}

/** 切換模組：清掉上一個模組的資料、選取、搜尋，重抓（fetch = false 時呼叫的人自己抓） */
function switchModule(id: ModuleId, fetch = true): void {
  moduleSheet.hidden = true;
  if (id === mod.id) return;
  mod = getModule(id);
  lsSet(LS_MODULE, mod.id);
  events = [];
  routes = [];
  bottles = [];
  woofBottles = [];
  selectedId = null;
  selectedRoute = null;
  selectedLandmark = null;
  selectedBottle = null;
  choosing = null;
  // 換模組後第一次抓到的不算「新開始」，不要一次響一堆
  seenActive.clear();
  notifiedOnce = false;
  searchInput.value = '';
  searchClear.hidden = true;
  searchTerms = [];
  typePick = null;
  applyModule();
  render();
  if (fetch) void refresh();
}

/**
 * 從 Threads 分享進來、還沒選要回報到哪個雷達的連結（v1.618 使用者說分享進來先選雷達再送出）：
 * 有值時「切換雷達」那一頁改成「這則要回報到哪個雷達？」，只列收回報的雷達，選了就切過去、填好連結送出
 */
let pendingShare: string | null = null;

/**
 * 切換雷達那一頁：每個雷達附近有幾筆（還沒結束的；範圍、關鍵字跟抓資料一樣），有一筆以上才寫（v1.681 使用者說的）。
 * 打開時才抓別的雷達的，同一個地方 2 分鐘內不重抓；現在這個雷達用已經抓到的
 */
let moduleCounts: { at: number; key: string; counts: Map<string, number> } | null = null;
async function loadModuleCounts(): Promise<boolean> {
  const radius = fetchRadiusKm(scaleKm);
  const key = `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)},${radius}`;
  const now = nowSec();
  if (moduleCounts && moduleCounts.key === key && now - moduleCounts.at < 120) return false;
  const counts = new Map<string, number>();
  const live = (evs: EventOut[]): number => new Set(evs.filter((ev) => ev.endAt > now).map((ev) => ev.id)).size;
  await Promise.all(
    MODULES.map(async (m) => {
      const kws = m.current ? followed() : [];
      if (m.current && kws.length === 0) return;
      try {
        counts.set(m.id, live(m.id === mod.id ? events : await fetchEvents(origin, radius, kws, m.id)));
      } catch {
        /* 抓不到就不寫 */
      }
    }),
  );
  moduleCounts = { at: now, key, counts };
  return true;
}

function renderModuleList(): void {
  moduleList.replaceChildren();
  const sharing = pendingShare !== null;
  $('#module-title').textContent = sharing ? '這則要回報到哪個雷達？' : '切換雷達';
  $('#module-note').textContent = sharing ? '選一個雷達，會切過去、用那個雷達的方式判讀這則貼文。' : '同一個雷達、地圖、清單、回報，換不同主題的資料。';
  for (const m of MODULES) {
    // 分享進來選雷達：回報暫停的雷達不列
    if (sharing && reportModules && !reportModules.includes(m.id)) continue;
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `theme-item module-item${m.id === mod.id ? ' on' : ''}`;
    const n = moduleCounts?.counts.get(m.id) ?? 0;
    b.innerHTML = `<span class="emoji" aria-hidden="true">${m.emoji}</span><span><b>${esc(m.name)}</b><small>${esc(m.tagline)}</small></span>${n > 0 ? `<span class="mod-count">${n} 筆</span>` : ''}${m.id === mod.id ? '<span class="check">✓</span>' : ''}`;
    b.addEventListener('click', () => {
      const link = pendingShare;
      pendingShare = null;
      switchModule(m.id);
      moduleSheet.hidden = true;
      if (link) sendSharedLink(link);
    });
    li.appendChild(b);
    moduleList.appendChild(li);
  }
}

function openModuleSheet(open: boolean): void {
  moduleSheet.hidden = !open;
  // 分享進來沒選雷達就關掉：這則不送
  if (!open) {
    pendingShare = null;
    return;
  }
  themeSheet.hidden = true;
  kwSheet.hidden = true;
  reportSheet.hidden = true;
  bottleSheet.hidden = true;
  feedbackSheet.hidden = true;
  renderModuleList();
  // 各雷達有幾筆：抓好再畫一次
  void loadModuleCounts().then((changed) => {
    if (changed && !moduleSheet.hidden) renderModuleList();
  });
}

function applyTheme(t: Theme): void {
  theme = t;
  document.documentElement.dataset.theme = t.id;
  document.title = mod.current ? t.name : mod.name;
  map.setDark(t.id === 'dragon' || t.id === 'neon');
  // 標題列放不下長名稱：其他模組用短名稱（跟「洋流雷達」一樣 4 個字）
  brandText.textContent = mod.current ? t.name : mod.short;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.themeColor);
  radar.setStyle({ sweep: t.sweep, blip: t.blip, rose: t.rose });
  emptyEl.textContent = `${emptyText()}。點清單上方的「↻ 更新」看有沒有新的，或在旁邊打開自動更新。`;
  lsSet(LS_THEME, t.id);
  renderThemeList();
  render();
}

function renderThemeList(): void {
  themeList.replaceChildren();
  for (const t of THEMES) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `theme-item${t.id === theme.id ? ' on' : ''}`;
    b.innerHTML = `<span class="swatch">${t.swatch.map((c) => `<i style="background:${c}"></i>`).join('')}</span><span><b>${esc(t.name)}</b><small>${esc(t.tagline)}</small></span>${t.id === theme.id ? '<span class="check">✓</span>' : ''}`;
    b.addEventListener('click', () => {
      applyTheme(t);
      beep(t.sound);
    });
    li.appendChild(b);
    themeList.appendChild(li);
  }
}

function openThemeSheet(open: boolean): void {
  themeSheet.hidden = !open;
  if (open) {
    kwSheet.hidden = true;
    reportSheet.hidden = true;
    bottleSheet.hidden = true;
    selectedId = null;
    selectedRoute = null;
    selectedLandmark = null;
    selectedBottle = null;
    detailEl.hidden = true;
  }
}

function loadIdList(key: string): number[] {
  try {
    const arr = JSON.parse(lsGet(key) ?? '[]') as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is number => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

function loadFollowed(): string[] | null {
  const raw = lsGet(LS_KEYWORDS);
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

/** 沒自己選過就追蹤所有預設關鍵字 */
function followed(): string[] {
  if (!canEditKeywords) return available.map((k) => k.term);
  return savedFollowed ?? available.filter((k) => k.pinned).map((k) => k.term);
}

function setFollowed(next: string[]): void {
  savedFollowed = next;
  lsSet(LS_KEYWORDS, JSON.stringify(next));
  renderKeywords();
  void refresh();
}

function renderKeywords(): void {
  const f = followed();
  kwTitle.textContent = canEditKeywords ? '追蹤關鍵字' : '搜尋中的關鍵字';
  kwIntro.textContent = canEditKeywords
    ? '點一下切換追蹤。雷達只顯示你追蹤的關鍵字找到的發放。'
    : '系統會用這些關鍵字定時搜尋 Threads 與新聞，再加上官方行程，目前不開放修改。';
  kwForm.hidden = !canEditKeywords;
  kwShareNote.hidden = !canEditKeywords;
  renderRules();
  // 搜尋中的關鍵字移到說明頁（說明頁從 /api/keywords 讀），這裡的面板從說明頁的連結（?open=keywords）打開
  kwList.replaceChildren();
  const activeTerms = new Set(available.map((k) => k.term));
  const all: Array<{ term: string; pinned: boolean; stale: boolean }> = [
    ...available.map((k) => ({ term: k.term, pinned: k.pinned, stale: false })),
    ...f.filter((t) => !activeTerms.has(t)).map((t) => ({ term: t, pinned: false, stale: true })),
  ];
  for (const k of all) {
    const b = document.createElement('button');
    b.type = 'button';
    const on = f.includes(k.term);
    b.className = `chip kw-chip${on ? ' on' : ''}${canEditKeywords ? '' : ' static'}`;
    if (!canEditKeywords) b.disabled = true;
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = `${esc(k.term)}${k.pinned ? '<span class="pin">預設</span>' : ''}${k.stale ? '<span class="pin">已停止，點一下重新搜尋</span>' : ''}`;
    b.addEventListener('click', () => {
      if (k.stale) {
        void submitKeyword(k.term);
        return;
      }
      setFollowed(on ? f.filter((t) => t !== k.term) : [...f, k.term]);
    });
    kwList.appendChild(b);
  }
}

const HELP_ISSUE_URL = `https://github.com/u8906250/dragonRadar/issues/new?title=${encodeURIComponent('協助 Threads 搜尋：願意提供已驗證的商家')}`;

/** 「時間地點怎麼判讀」說明，數值來自後端，跟實際規則一致 */
function renderRules(): void {
  const r = keywordRules;
  if (!r) {
    kwRulesEl.replaceChildren();
    return;
  }
  const hours = r.defaultDurationMin % 60 === 0 ? `${r.defaultDurationMin / 60} 小時` : `${r.defaultDurationMin} 分鐘`;
  const f = followed();
  const kw = f.includes('洋流飄帶') ? '洋流飄帶' : (f[0] ?? '洋流飄帶');
  const src = r.sources;
  const threadsLine =
    src?.threads === 'approved'
      ? `<li><b>Threads</b>：每 ${r.intervalMin} 分鐘用上面的關鍵字搜尋最新的公開貼文。</li>`
      : `<li><b>Threads</b>：<span class="pending-tag">等待 Meta 審核</span> 審核通過後，就會每 ${r.intervalMin} 分鐘用上面的關鍵字搜尋 Threads 上所有人的公開貼文。目前只搜得到測試帳號自己的貼文。<br>Meta 規定 App 要掛在<b>已完成商家驗證</b>的單位底下才能送審。如果你的團隊、公司或人民團體已經在 Meta 完成商家驗證、願意讓這個 App 掛在名下，歡迎到 <a href="${HELP_ISSUE_URL}" target="_blank" rel="noopener">GitHub Issues</a> 留言，我們再跟你聯絡細節。</li>`;
  kwRulesEl.innerHTML = `
    <h3>資料來源</h3>
    <ul>
      ${src ? `<li><b>官方行程</b>：<a href="${esc(src.official.url)}" target="_blank" rel="noopener">${esc(src.official.name)}</a>，${src.official.mapUrl ? `與<a href="${esc(src.official.mapUrl)}" target="_blank" rel="noopener">${esc(src.official.mapName ?? '車掃地圖')}</a>` : ''}，每 ${src.official.intervalMin} 分鐘更新車掃日期、路線、出發與抵達時間、各路段認領人數。起點在出發後保留 15 分鐘；加油點當天整天顯示（車掃出發前算還沒開始），到車隊預計經過後 15 分鐘（預計時間用路線長度平均推算）；終點從抵達開始，接著有活動（例如市政開講）就到活動結束，否則保留 1 小時。沒公布時間的當成整天，當天都算進行中。新聞或 Threads 講的是同一場車掃（同一天、提到車掃，提到同一區或路線上的地點，或在路線 1.5 km 內）就併進官方那一場，列在「相關報導」，不另外顯示。</li>
      <li><b>新聞</b>：${src.news.names.map(esc).join('、')}的 RSS，每 ${src.news.intervalMin} 分鐘讀一次，標題或摘要有關鍵字的報導才判讀。只顯示標題與原文連結。</li>` : ''}
      ${threadsLine}
      ${src?.link ? `<li><b>大家回報</b>：任何人都可以按「＋回報」貼上 Threads 貼文連結（${src.link.maxAgeDays} 天內的公開貼文），系統讀取貼文後用同樣的規則判讀；也可以貼 ACCUPASS 活動通、OPENTIX 的活動頁，時間、地點照活動頁寫的。</li>` : ''}
    </ul>
    <h3>多久找一次</h3>
    <ul>
      <li>Threads 每 ${r.intervalMin} 分鐘、新聞每 30 分鐘、官方行程每小時。</li>
      <li>收${esc(r.region)}的發放和活動。雷達預設看方圓 50 km，拉遠到「全台」看全台灣與離島。</li>
    </ul>
    <h3>找哪些東西</h3>
    <ul>
      <li><b>發放</b>：在某時某地免費發飄帶、貼紙、文宣、飲料等，雷達上是<span class="ex">橘色</span>光點。</li>
      <li><b>活動</b>：可以到場參加的車掃、掃街、市場開講、造勢晚會、見面會、座談等，雷達上是<span class="ex">另一個顏色</span>的光點。</li>
      <li>活動現場也有發放東西的，算成一筆發放。</li>
      <li><b>固定據點</b>：店家、服務處等連續好幾天在固定時段都能去領或參加的，標成「據點」，雷達上是<span class="ex">菱形</span>光點，休息時間變淡。沒寫最後一天的寫「發完為止」，不預設哪天結束，一直顯示到原貼文刪除、作者說發完或管理者下架。可以用清單上方的「固定據點」開關隱藏。</li>
    </ul>
    <h3>時間地點怎麼判讀</h3>
    <ol>
      <li>貼文要同時寫出<b>時間</b>和<b>地點</b>，缺一個就不會出現在雷達上。</li>
      <li>時間可以寫 <span class="ex">10/18 15:00</span>、<span class="ex">今天下午三點</span>、<span class="ex">明晚 7 點</span>、<span class="ex">週六 14:00–16:00</span>。「今天、明天、週六」以發文時間換算，時區是台灣時間。</li>
      <li>沒寫結束時間，或寫「發完為止」：發放寫「發完為止」，活動只寫幾點開始，不猜幾點結束。為了不讓舊的一直留在雷達上，單次的開始 ${hours}後會自動下架；固定據點沒寫最後一天的寫「發完為止」，不預設哪天結束。</li>
      <li>一則貼文有多個地點或時段（例如行程表、車掃停靠點），會拆成多筆。</li>
      <li>只查得到鄉鎮區、查不到確切地點的（例如新聞只寫「虎尾競選總部」），會定位在該鄉鎮區的中心並標成「約略位置」，雷達和地圖上是空心光點，請以原文為準。只知道縣市的不會放上雷達。</li>
      <li>地點寫越具體越好，例如 <span class="ex">捷運市政府站 2號出口</span>、<span class="ex">板橋車站北一門</span>、<span class="ex">松山文創園區</span>。找不到出口時會退到車站位置。</li>
      <li>只收 ${r.maxFutureDays} 天內的發放和活動；已經結束的不會出現。</li>
      <li>新聞報導、活動回顧、徵求、詢問、線上抽獎、直播、販售都不算，系統會略過。判讀信心低於 ${Math.round(r.minConfidence * 100)}% 的也會略過。</li>
    </ol>
    <h3>什麼時候消失</h3>
    <ul>
      <li>到了結束時間自動消失。</li>
      <li>原作者回覆或再發文提到「${r.endedWords.slice(0, 6).map(esc).join('」「')}」等字眼，也會提早消失。</li>
      ${src?.link ? `<li>大家回報的貼文每 ${src.link.recheckMin} 分鐘重讀一次：原貼文刪除或改成「發完了」就下架，改了時間地點就重新判讀。</li>
` : ''}
    </ul>
    <h3>貼文範例</h3>
    <div class="example">${esc(`#${kw}\n明天 10/18 下午 3 點在捷運市政府站 2號出口發放${kw}，限量 100 份，發完為止！`)}</div>
    <p class="example-out">會判讀成：發放，開始 10/18 15:00、結束 ${esc(fmtClock(15 * 60 + r.defaultDurationMin))}、地點「台北市 捷運市政府站 2號出口」。</p>
    <div class="example">${esc(`#${kw}\n週六 10/19 晚上 7 點，大龍峒保安宮市政開講，歡迎鄉親一起來！`)}</div>
    <p class="example-out">會判讀成：活動，開始 10/19 19:00、地點「台北市 大龍峒保安宮」。</p>
    <p class="legal-links"><a href="${mod.helpPage}" target="_blank" rel="noopener">使用說明</a> · <a href="privacy.html" target="_blank" rel="noopener">隱私權政策</a> · <a href="terms.html" target="_blank" rel="noopener">服務條款</a> · <a href="data-deletion.html" target="_blank" rel="noopener">資料刪除</a></p>`;
}

function fmtClock(totalMin: number): string {
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `10/18 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function sourceLabel(ev: EventOut): string {
  if (ev.post.source === 'site') return `${ev.post.username ?? '主辦單位'}（主辦單位公告）`;
  if (ev.post.source === 'news') return `新聞・${ev.post.username ?? ''}`;
  if (ev.post.source === 'official') return '台北大洋流官網「未來航線」';
  if (ev.post.source === 'note') return '大家回報（沒有原貼文，未查證）';
  if (ev.post.source === 'accupass') return 'ACCUPASS 活動通（大家回報）';
  if (ev.post.source === 'opentix') return 'OPENTIX 兩廳院文化生活（大家回報）';
  const who = `Threads${ev.post.username ? `・@${ev.post.username}` : ''}`;
  return ev.post.source === 'link' ? `${who}（大家回報）` : ev.post.source === 'spot' ? `${who}（大家回報・已審核）` : who;
}

function sourceLinkText(ev: EventOut): string {
  if (ev.post.source === 'site') return '看主辦單位公告';
  if (ev.post.source === 'news') return '看新聞原文';
  if (ev.post.source === 'official') return '看官方航線';
  if (ev.post.source === 'accupass' || ev.post.source === 'opentix') return '看活動頁';
  return '在 Threads 查看';
}

/** 地點文字；約略位置會註明 */
/**
 * 顯示用的標題：固定據點用店家名稱（從地點拆出來），拆不出來才用判讀的標題。
 * 判讀的標題在店名前面多寫了是誰的（「陳致中前鎮服務處發飄帶」、地點只寫「前鎮服務處」），名稱就連前面的一起用
 */
function titleOf(ev: EventOut): string {
  // 管理者改過的標題照用
  if (ev.manualTitle) return ev.title;
  // 官方車掃的起點：直接寫路線的標題（v1.680 使用者說點起點直接顯示「台北大洋流航向士林 × 北投！」），地點寫在下面那一行；
  // 路線靠事件原本的標題對應各站，所以只換顯示的
  const r = routeOf(ev);
  if (r && !isReported(r) && stopOf(ev)?.kind === 'start') return r.title;
  const name = ev.spot ? splitPlace(ev.placeText).name : null;
  if (!name) return ev.title;
  const at = ev.title.indexOf(name);
  return at > 0 ? ev.title.slice(0, at + name.length) : name;
}

/** 地點文字：據點的標題已經是店名，這裡只寫地址；不寫郵遞區號和里 */
function placeOf(ev: EventOut): string {
  const p = ev.spot ? splitPlace(ev.placeText) : null;
  return shortAddress(p?.name ? p.address : ev.placeText);
}

function placeLine(ev: EventOut): string {
  return ev.approxArea ? `${placeOf(ev)}（約略位置：${ev.approxArea}）` : placeOf(ev);
}

function kindLabel(ev: EventOut): string {
  if (ev.kind === 'session') return isSeek(ev) ? '找臨打' : '招臨打';
  if (ev.kind === 'food') return { vendor: '出攤', recommend: '推薦', meetup: '揪團' }[foodRole(ev) ?? 'recommend'] ?? '推薦';
  return ev.kind === 'job' ? (isOffer(ev) ? jobWords().offer : '徵人') : ev.kind === 'activity' ? (topicOf(ev) ?? '活動') : '發放';
}

/**
 * 活動的主題（AI 照貼文內容判斷的「遊行」「講座」「市集」，存在 extra.topic）；舊資料、判讀不出來的是 null。
 * 只收文字、數字（伺服器已經拿掉符號），標籤有些地方直接放進 HTML
 */
function topicOf(ev: { extra?: Record<string, unknown> | null }): string | null {
  const t = ev.extra?.topic;
  return typeof t === 'string' && /^[\p{L}\p{N}]{1,8}$/u.test(t) ? t : null;
}

/**
 * 回報時抽的關鍵字（伺服器存在 extra.tags：貼文寫到的常見詞、AI 抽的、hashtag）；舊資料沒有的，照貼文找常見詞、hashtag。
 * 只收文字、數字，最多 8 個
 */
const COMMON_TAGS = ['洋流', '飄帶', '彩虹', '徽章', '貼紙', '小物', '扇子', '手環', '旗子', '帽子', '車掃', '掃街', '開講', '市集', '遊行', '講座', '造勢', '應援', '同志', '淨灘', '志工', '發放'];
const tagCache = new WeakMap<object, string[]>();
function tagsOf(ev: { extra?: Record<string, unknown> | null; post?: { text: string; supplement?: string | null } }): string[] {
  const had = tagCache.get(ev);
  if (had) return had;
  const ok = (t: unknown): t is string => typeof t === 'string' && /^[\p{L}\p{N}]{2,10}$/u.test(t);
  let tags = Array.isArray(ev.extra?.tags) ? (ev.extra.tags as unknown[]).filter(ok) : [];
  if (tags.length === 0 && ev.post) {
    const text = `${ev.post.text}\n${ev.post.supplement ?? ''}`;
    const body = text.replace(/\s+/g, '').replace(/漂帶/g, '飄帶');
    // 常見詞是洋流的；其他雷達的舊資料只照 hashtag
    tags = mod.current ? COMMON_TAGS.filter((t) => body.includes(t)) : [];
    for (const m of text.matchAll(/#([\p{L}\p{N}]{2,10})/gu)) if (!tags.includes(m[1])) tags.push(m[1]);
  }
  tags = tags.slice(0, 8);
  tagCache.set(ev, tags);
  return tags;
}
/** 關鍵字標籤（#洋流 #飄帶）；asButtons 是點了就搜尋 */
const tagsHtml = (tags: string[], asButtons = false): string =>
  tags.length === 0 ? '' : `<span class="ev-tags">${tags.map((t) => (asButtons ? `<button type="button" class="tag" data-tag="${esc(t)}">#${esc(t)}</button>` : `<span class="tag">#${esc(t)}</span>`)).join('')}</span>`;
/** 點關鍵字：搜尋它（同一個再點一次就清掉） */
function searchTag(tag: string): void {
  const same = searchInput.value.trim() === tag;
  searchInput.value = same ? '' : tag;
  searchClear.hidden = searchInput.value === '';
  setSearch(searchInput.value);
}
/** 目前抓到、還沒結束的發放、活動裡每個關鍵字用了幾次（renderSearchTags 算的）：搜尋框下面、補充資料的常見關鍵字照這個排，用得多的在前面 */
let tagUse = new Map<string, number>();
const commonRank = (t: string): number => (COMMON_TAGS.includes(t) ? COMMON_TAGS.indexOf(t) : COMMON_TAGS.length);
const byTagUse = (a: string, b: string): number => (tagUse.get(b) ?? 0) - (tagUse.get(a) ?? 0) || commonRank(a) - commonRank(b);
/**
 * 活動是哪一類（topic-icons.ts：發放、造勢、講座…），雷達、地圖的小圖示和類型按鈕都照這個：活動照 AI 判讀的主題，發放的算「發放」
 */
function topicFor(ev: EventOut): string | null {
  return ev.kind === 'activity' ? topicOf(ev) : ev.kind === 'giveaway' ? '發放' : null;
}
function typeOf(ev: EventOut): string | null {
  return topicGlyph(topicFor(ev));
}
function typeLabel(key: string): string {
  return TOPIC_TYPES.find((t) => t.key === key)?.label ?? key;
}
/** 點類型按鈕：只看這一類（雷達、地圖、清單），再點一次清掉 */
function pickType(key: string): void {
  typePick = typePick === key ? null : key;
  render();
}

/**
 * 搜尋框下面的關鍵字（每個雷達都有，例如找工作的 #發文宣）：目前抓到的刊登、活動裡實際用到的，用得多的在前面（最多 8 個）；
 * 最前面是活動類型的按鈕（有小圖示，目前抓到的有這一類才放；v1.676 使用者說提供這些活動類型快速搜尋）；都沒有就不顯示
 */
function renderSearchTags(items: Item[]): void {
  const box = $<HTMLElement>('#search-tags');
  const count = new Map<string, number>();
  for (const it of items) for (const t of tagsOf(it.ev)) count.set(t, (count.get(t) ?? 0) + 1);
  tagUse = count;
  const top = [...count.keys()].sort(byTagUse).slice(0, 8);
  const has = new Set(items.map((it) => typeOf(it.ev)));
  const types = TOPIC_TYPES.filter((t) => has.has(t.key) || t.key === typePick);
  if (top.length === 0 && types.length === 0) {
    box.hidden = true;
    return;
  }
  const now = searchInput.value.trim();
  const html =
    types.map((t) => `<button type="button" class="chip small type-chip${t.key === typePick ? ' on' : ''}" data-type="${t.key}" aria-pressed="${t.key === typePick}">${topicChipSvg(t.key)}${t.label}</button>`).join('') +
    (types.length && top.length ? '<span class="tags-sep" aria-hidden="true"></span>' : '') +
    top.map((t) => `<button type="button" class="chip small${t === now ? ' on' : ''}" data-tag="${esc(t)}" aria-pressed="${t === now}">#${esc(t)}</button>`).join('');
  if (box.dataset.html !== html) {
    box.innerHTML = html;
    box.dataset.html = html;
  }
  box.hidden = false;
}

/** 服務處、競選總部（候選人、議員、政黨的）：固定據點用房子圖示、標「服務處」，跟店家、餐廳分開 */
const OFFICE_RE = /服務處|服務中心|競選總部|競選辦公室|總部|黨部|辦事處/;
function isOffice(ev: EventOut): boolean {
  return OFFICE_RE.test(`${ev.title} ${ev.placeText}`);
}

/** 清單與地圖上的標籤：固定據點另外標「據點」，服務處標「服務處」 */
function tagLabel(it: Item): string {
  if (it.ev.kind === 'session') return it.spot ? '固定場' : kindLabel(it.ev);
  if (it.ev.kind === 'food') return it.spot ? '固定攤' : kindLabel(it.ev);
  return it.spot ? (isOffice(it.ev) ? '服務處' : '據點') : kindLabel(it.ev);
}

function setKwMsg(text: string, error = false): void {
  kwMsg.textContent = text;
  kwMsg.classList.toggle('kw-msg-error', error);
}

async function loadKeywords(): Promise<void> {
  try {
    const r = await fetchKeywords();
    available = r.keywords;
    canEditKeywords = r.userAdd === true;
    keywordRules = r.rules ?? null;
    kwMaxEl.textContent = String(r.max);
  } catch (e) {
    console.warn(e);
  }
  renderKeywords();
}

async function submitKeyword(raw: string): Promise<void> {
  const term = raw.normalize('NFKC').replace(/\s+/g, ' ').trim().replace(/^#+/, '').trim();
  const len = [...term].length;
  if (len < 2 || len > 20 || KEYWORD_RE_INVALID.test(term)) {
    setKwMsg('關鍵字需為 2 到 20 個字，不能含 % _ < > 等符號', true);
    return;
  }
  kwAddBtn.disabled = true;
  setKwMsg('加入中…');
  const r = await addKeyword(term);
  kwAddBtn.disabled = false;
  if (!r.ok) {
    setKwMsg(r.message, true);
    return;
  }
  available = r.keywords;
  kwInput.value = '';
  const f = followed();
  setFollowed(f.includes(r.keyword.term) ? f : [...f, r.keyword.term]);
  setKwMsg(
    r.status === 'exists'
      ? `「${r.keyword.term}」已經在搜尋了，已幫你追蹤`
      : `已開始搜尋「${r.keyword.term}」，約一分鐘後會出現結果`,
  );
  if (r.status !== 'exists') window.setTimeout(() => void refresh(), 45_000);
}

function openKwSheet(open: boolean): void {
  kwSheet.hidden = !open;
  if (open) {
    themeSheet.hidden = true;
    reportSheet.hidden = true;
    bottleSheet.hidden = true;
    selectedId = null;
    selectedRoute = null;
    selectedLandmark = null;
    selectedBottle = null;
    detailEl.hidden = true;
    setKwMsg('');
    void loadKeywords();
  }
}

/**
 * 回報功能開著嗎：伺服器的 /api/health 說這個模組鎖住（改版中）就不打開回報畫面。
 * reportModules 是收回報的模組；舊版伺服器沒給，照 reports 開關
 */
let reportsOpen = true;
let reportsAll = true;
let reportModules: string[] | null = null;
const REPORTS_LOCKED_TEXT = '回報功能改版中，暫時關閉';

function applyReportsOpen(): void {
  const open = reportModules ? reportModules.includes(mod.id) : reportsAll;
  reportsOpen = open;
  reportBtn.textContent = open ? '＋回報' : '回報暫停';
  reportBtn.classList.toggle('locked', !open);
  reportBtn.setAttribute('aria-label', open ? '回報活動' : REPORTS_LOCKED_TEXT);
  if (!open) reportSheet.hidden = true;
}

function openReportSheet(open: boolean): void {
  if (open && !reportsOpen) {
    showBanner(bannerEl, REPORTS_LOCKED_TEXT, 3000);
    return;
  }
  reportSheet.hidden = !open;
  if (!open) return;
  // 每次打開都先收起來
  myReportsExpanded = false;
  void loadMyReports();
  themeSheet.hidden = true;
  kwSheet.hidden = true;
  bottleSheet.hidden = true;
  selectedId = null;
  selectedRoute = null;
  selectedLandmark = null;
  selectedBottle = null;
  detailEl.hidden = true;
  renderReportTips();
}

function renderReportTips(): void {
  const l = keywordRules?.sources?.link;
  const share = '在 Threads 貼文按「分享」→「複製連結」，再貼到上面。Android 把洋流雷達加到主畫面後，也可以直接分享到洋流雷達。';
  if (!mod.current) {
    reportTips.innerHTML = [share, ...mod.reportTips].map((t) => `<li>${esc(t)}</li>`).join('');
    return;
  }
  const tips = [
    share,
    '放上雷達的回報，滿 5 則拿到「古錐媽的肉乾」收集卡，每 5 則一枚順幣；每天最多算 20 則，超過的一樣會放上雷達，只是不算進收集。',
    `只收${l ? ` ${l.maxAgeDays} 天內` : ''}的公開貼文。每一場活動都要讀得到做什麼、在哪裡、哪天幾點開始，缺一個就不會放上雷達。`,
    '結束時間可以不寫：沒寫的只寫幾點開始，雷達上顯示到開始後兩小時。',
    'ACCUPASS 活動通、OPENTIX：貼活動頁的網址（accupass.com/event/…、opentix.life/event/…）就好，時間、地點照活動頁寫的；OPENTIX 的巡演每個地點各一場，好幾天的展覽每天各算一場（最多 6 天），線上、取消的場次不收。活動頁刪除或標成取消，雷達會自動下架。',
    '貼文寫了車掃、掃街、車隊，或騎車（順騎、單車）、健走，同一天又列了好幾站的，會合成一條路線：每一站從預計經過前 10 分鐘顯示到經過後 15 分鐘。各站沒寫時間、只寫出發時間的，照順序和距離推算（騎車時速 12 公里、健走 4 公里，每站停 10 分鐘），時間表寫「約」。只定位到鄉鎮區的站，要在雷達上標出位置才會放上雷達。',
    '貼文沒寫或判讀錯的，可以在判讀結果按「補充資料」直接改活動內容、時間、地點，位置不對可以在地圖上標。連續好幾天的活動每天各算一場（最多 6 場）。貼文最好寫出門牌地址，定位才準。',
    `原貼文刪除或改成「結束了」，雷達${l ? ` ${l.recheckMin} 分鐘內` : ''}會自動下架。`,
  ];
  reportTips.innerHTML = tips.map((t) => `<li>${esc(t)}</li>`).join('');
}

const OUTCOME_TEXT: Record<SubmitResult['outcome'], string> = {
  preview: '判讀結果如下，請確認一次：',
  added: '已加入雷達：',
  duplicate: '雷達上已經有這一場了：',
  attached: '雷達上已經有這個據點，這則已附在它的詳細資料（相關貼文）：',
  no_place: '看得出是活動，但貼文沒寫具體地點（或查不到），所以還沒放上雷達。知道在哪裡的話，可以在下面補充地點再判讀一次。',
  not_listed: '判讀不到完整的活動內容、地點、開始時間，或是已經結束、超過 21 天後才開始，所以沒有放上雷達。',
  not_event: '這則看起來不是活動。貼文要寫出做什麼、在哪裡、什麼時候舉辦，雷達才會收。',
  failed: '判讀暫時失敗，請稍後再貼一次。',
};

function setReportMsg(html: string): void {
  reportResult.innerHTML = html;
  reportSheet.classList.remove('looking');
  markCard = null;
  markStart = null;
  // 換了訊息（確認了、不對、補充後重新判讀）：判讀結果的位置跟著拿掉，新的判讀結果再標
  if (reportPins.length > 0) {
    reportPins = [];
    render();
  }
}

/**
 * 回報判讀完、還沒確認的位置：雷達、地圖上畫虛線圈＋名稱（v1.683 使用者說判讀到定位直接反映到雷達上）。
 * 回報畫面開著才畫（關掉就不畫、再打開判讀結果還在就照樣畫）；確認了換成真的光點
 */
interface ReportPin {
  lat: number;
  lng: number;
  label: string;
  glyph: string | null;
  /** 地圖上可以拖（補充資料表單有這個位置的那一場） */
  drag?: boolean;
}
let reportPins: ReportPin[] = [];
/** 確認用的代碼（拖了位置重新預覽用） */
let pinConfirm: { postId: string; token: string } | null = null;
const shownReportPins = (): ReportPin[] => (reportSheet.hidden ? [] : markCard ? markPins(markCard) : reportPins);

/**
 * 補充資料的「查地點」「在雷達上標位置」直接用主畫面（v1.697 使用者說的，以前是表單裡的小地圖；v1.699 起用雷達，不切到地圖）：
 * 標的是哪一場（markCard），雷達、地圖上只畫這一場的標記（可以拖、點一下空白處也會移過去），標好的位置記在那一場（送出「用這些資料預覽」才用）。
 * 換了判讀結果、回上一步、刪掉這一場、關掉回報就不標了
 */
let markCard: HTMLElement | null = null;
/** 這一場還沒有位置時，標記先放在哪（打開時地圖的正中間） */
let markStart: LatLng | null = null;
/** 這一場現在的位置：標的、依地點查到的（地點沒改）、都沒有就先放的地方 */
function markAt(card: HTMLElement): LatLng | null {
  const pin = editPins.get(card);
  if (!pin) return null;
  const place = card.querySelector<HTMLInputElement>('[name="place"]')?.value.trim() ?? '';
  return pin.pinned ?? (pin.found && place === pin.foundPlace ? pin.found : null) ?? markStart;
}
function markPins(card: HTMLElement): ReportPin[] {
  const at = markAt(card);
  if (!at) return [];
  const val = (n: string): string => card.querySelector<HTMLInputElement>(`[name="${n}"]`)?.value.trim() ?? '';
  const label = val('title') || card.querySelector('.edit-no')?.textContent || '活動';
  return [{ lat: at.lat, lng: at.lng, label: [...label].length > 16 ? `${[...label].slice(0, 15).join('')}…` : label, glyph: topicGlyph(val('topic') || null), drag: true }];
}
/** 拖到、點到的地方就是這一場的位置 */
function placeMark(p: LatLng): void {
  const card = markCard;
  const pin = card ? editPins.get(card) : null;
  if (!card || !pin) return;
  pin.pinned = { lat: p.lat, lng: p.lng };
  updatePinState(card);
  render();
}
/**
 * 開始在雷達上標這一場（v1.699 使用者說直接用雷達的地圖，不用切到地圖；在地圖模式就標在地圖上）：移過去；
 * 手機把回報收成一條（雷達變大），按「回到補充資料」回來
 */
function markOnMap(card: HTMLElement): void {
  if (view === 'radar' && radar.spaceFocused) {
    showBanner(bannerEl, '回到地球才能在雷達上標位置', 3000);
    return;
  }
  markCard = card;
  markStart = markAt(card) ? null : view === 'map' ? (map.center() ?? { lat: origin.lat, lng: origin.lng }) : { lat: origin.lat, lng: origin.lng };
  updatePinState(card);
  render();
  const at = markAt(card);
  if (at) flyToPins([{ lat: at.lat, lng: at.lng, label: '', glyph: null }]);
  if (reportSheet.parentElement === panelEl) {
    reportSheet.classList.add('looking');
    setReportPeek(true, '回到補充資料');
  }
}
function stopMark(): void {
  if (!markCard) return;
  const card = markCard;
  markCard = null;
  markStart = null;
  if (card.isConnected) updatePinState(card);
  render();
}

/** 判讀結果裡定位到的：每一場、車掃每一站（同一個位置只標一次，名稱寫第一場的） */
function previewPins(items: PreviewItem[], routes: RoutePreview[]): ReportPin[] {
  const pins = new Map<string, ReportPin>();
  const add = (lat: number | null, lng: number | null, label: string, glyph: string | null): void => {
    if (lat === null || lng === null) return;
    const k = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (!pins.has(k)) pins.set(k, { lat, lng, label: [...label].length > 16 ? `${[...label].slice(0, 15).join('')}…` : label, glyph });
  };
  for (const p of items) add(p.lat, p.lng, p.title, topicGlyph(p.kind === 'activity' ? topicOf(p) : p.kind === 'giveaway' ? '發放' : null));
  for (const rt of routes) for (const st of rt.stops) if (st.status === 'listed') add(st.lat, st.lng, st.name, 'rally');
  return [...pins.values()];
}

/**
 * 雷達（地圖）移到判讀出來的位置：一個地方就照它當中間、拉近到 3 km 內（看得到街道）；
 * 好幾個地方、30 km 內的全部框進來，更遠的只看第一個。太空、汪星上不動
 */
function flyToPins(pins: ReportPin[]): void {
  if (pins.length === 0 || radar.spaceFocused) return;
  if (radar.spaceMoved) radar.resetSpace();
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  const mid = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
  const spread = Math.max(...pins.map((p) => haversineKm(mid, p)));
  const one = spread < 0.8 || spread > 30;
  const to = spread > 30 ? pins[0] : mid;
  // 地圖：只移地圖、拉近到看得清街道、房子（拖了位置重新預覽時，都還在畫面裡就不動）；你的位置（藍點）不動
  if (view === 'map') {
    const shown = spread > 30 ? [pins[0]] : pins;
    const cover = coverOf(reportSheet);
    if (!map.pinsInView(shown, cover)) map.showPins(shown, cover);
    return;
  }
  // 雷達：已經拉近、位置都在畫面裡（拖了位置重新預覽）就不動，不然標記又跳回正中間
  if (scaleKm <= 3 && pins.every((p) => haversineKm(origin, p) < scaleKm * 0.75)) return;
  zoomToKm(one ? Math.min(Math.max(scaleKm, 1), 3) : spread * 1.35, { lat: to.lat, lng: to.lng, source: 'manual' });
}

/** 「在雷達上看」：移過去（雷達或地圖，看現在是哪個），回報畫面蓋住正中間（手機）就收到只剩標題那一條，按「回到判讀結果」再打開 */
function lookAtPin(lat: number, lng: number): void {
  flyToPins([{ lat, lng, label: '', glyph: null }]);
  // 手機的回報在清單那張卡片裡（雷達被擠小）：收成只露出標題那一條，雷達變大
  if (reportSheet.parentElement === panelEl) {
    reportSheet.classList.add('looking');
    setReportPeek(true);
    return;
  }
  const box = (view === 'radar' ? $('#radar-view') : $('#map')).getBoundingClientRect();
  const sheet = reportSheet.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  if (cx > sheet.left && cx < sheet.right && cy + 40 > sheet.top) setReportPeek(true);
}

/** 補充資料表單裡位置是這個點的那幾場（同一個地方好幾天的一起） */
function editCardsAt(p: { lat: number; lng: number }): HTMLElement[] {
  const form = reportResult.querySelector<HTMLFormElement>('.edit-form');
  if (!form) return [];
  return [...form.querySelectorAll<HTMLElement>('.edit-item')].filter((card) => {
    const pin = editPins.get(card);
    const at = pin?.pinned ?? pin?.found;
    return !!at && Math.abs(at.lat - p.lat) < 1e-5 && Math.abs(at.lng - p.lng) < 1e-5;
  });
}

/**
 * 在地圖上把判讀結果的位置拖到別的地方：補充資料表單那幾場改成標在這裡，直接重新預覽（跟按「用這些資料預覽」一樣，不問 AI）。
 * 失敗、判讀中就放回原本的位置
 */
async function movePin(i: number, to: LatLng): Promise<void> {
  const pin = reportPins[i];
  const c = pinConfirm;
  const form = reportResult.querySelector<HTMLFormElement>('.edit-form');
  const cards = pin ? editCardsAt(pin) : [];
  const putBack = (): void => {
    map.setPreviews([]);
    render();
  };
  if (!pin || !c || !form || cards.length === 0 || reportBusy) {
    putBack();
    return;
  }
  const before = cards.map((card) => editPins.get(card)?.pinned ?? null);
  for (const card of cards) {
    const ep = editPins.get(card);
    if (ep) ep.pinned = { lat: to.lat, lng: to.lng };
    updatePinState(card);
  }
  const read = readEditForm(form);
  if (typeof read === 'string') {
    cards.forEach((card, k) => {
      const ep = editPins.get(card);
      if (ep) ep.pinned = before[k];
      updatePinState(card);
    });
    showBanner(bannerEl, read, 3000);
    putBack();
    return;
  }
  // 拖好的位置先留在那裡，等新的預覽回來
  reportPins = reportPins.map((p, k) => (k === i ? { ...p, lat: to.lat, lng: to.lng } : p));
  render();
  const looking = reportSheet.classList.contains('looking');
  setReportBusy(true, '更新位置中…');
  const res = await editReport(c, read).finally(() => setReportBusy(false));
  if (!res.ok) {
    showBanner(bannerEl, res.message, 3500);
    return;
  }
  if (res.data.outcome === 'preview') renderPreview(res.data);
  else await showReportResult(res.data);
  if (looking) reportSheet.classList.add('looking');
}

/** label：收起來時標題列上按鈕寫什麼（「回到判讀結果」「回到補充資料」） */
function setReportPeek(on: boolean, label = '回到判讀結果'): void {
  if (on) {
    const b = reportSheet.querySelector('.report-unpeek');
    if (b) b.textContent = label;
  }
  if (!on) reportSheet.classList.remove('looking');
  // 手機的回報在清單那張卡片裡：收起來＝清單收成只露出標題那一條
  if (reportSheet.parentElement === panelEl) {
    panelPeek(on, reportSheet);
    return;
  }
  if (on) reportSheet.scrollTop = 0;
  reportSheet.classList.toggle('peek', on);
}

/**
 * 判讀中鎖住輸入框和按鈕，免得改到網址或重複送出：判讀結果裡的按鈕、欄位、標位置的小地圖都鎖住，
 * 按下去的那個按鈕（trigger）改寫成進行中的字，失敗時換回來
 */
let reportBusy = false;
function setReportBusy(busy: boolean, label = '判讀中…', trigger?: Element | null): void {
  reportBusy = busy;
  reportInput.disabled = busy;
  reportSubmit.disabled = busy;
  reportPaste.disabled = busy;
  reportSubmit.textContent = busy ? label : '送出';
  reportResult.classList.toggle('busy', busy);
  for (const b of reportResult.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement | HTMLInputElement>('button, textarea, input')) b.disabled = busy;
  if (busy && trigger instanceof HTMLButtonElement) {
    trigger.dataset.idle = trigger.textContent ?? '';
    trigger.textContent = label;
  }
  if (!busy) {
    for (const b of reportSheet.querySelectorAll<HTMLButtonElement>('[data-idle]')) {
      b.textContent = b.dataset.idle ?? '';
      delete b.dataset.idle;
    }
  }
}

/** 預覽上的時間：固定據點寫每天幾點、從哪天起排幾天；一般的寫哪天幾點到幾點 */
function previewWhen(p: PreviewItem): string {
  if (p.kind === 'job') return `${isOffer(p) ? jobWords().offer : '工作'} ${jobPeriod(jobOf(p))}`;
  if (isSeek(p) || foodRole(p) === 'meetup') return seekWhen(p);
  if (foodRole(p) === 'recommend') return `網友推薦${foodOf(p).hours ? `・營業 ${foodOf(p).hours}` : ''}`;
  const day = (t: number): string => dateFmt.format(new Date(t * 1000));
  // 一天好幾個時段：「12:00–13:30、18:00–20:30」；沒寫結束的只寫開始，最後寫「發完為止」（活動不寫）
  const open = openEndTail(p);
  const slotText = (s: { startAt: number; endAt: number; endOpen?: boolean }): string => (s.endOpen ? `${fmtTime(s.startAt)} 開始` : `${fmtTime(s.startAt)}–${fmtTime(s.endAt)}`);
  const slots = p.slots && p.slots.length > 1 ? `${p.slots.map(slotText).join('、')}${p.slots.some((s) => s.endOpen) ? openEndTail({ kind: p.kind, spot: p.spot }) : ''}` : null;
  if (p.spot) {
    const hours = p.allDay ? '整天' : slots ?? (p.endOpen ? `${fmtTime(p.startAt)} 開始${open}` : `${fmtTime(p.startAt)}–${fmtTime(p.endAt)}`);
    // 沒寫最後一天：不寫系統排到哪天，只寫「發完為止」
    const range = p.untilOpen ? `${day(p.startAt)} 起${open}` : p.days > 1 ? `${day(p.startAt)} 到 ${day(p.lastStartAt)}，共 ${p.days} 天` : day(p.startAt);
    return `${weeklyText(p.weekdays) ?? '每天'} ${hours}・${range}`;
  }
  if (p.allDay) return `${day(p.startAt)} 整天`;
  if (slots) return `${day(p.startAt)} ${slots}`;
  // 國外的：寫當地時間
  const tz = localTz(p);
  return `${fmtDateTz(p.startAt, tz)} ${fmtTimeTz(p.startAt, tz)}${p.endOpen ? ` 開始${open}` : `–${fmtTimeTz(p.endAt, tz)}`}${tz ? '（當地時間）' : ''}`;
}

/** 在 Google 地圖上標出這個座標（新分頁；手機會開 Google 地圖 App） */
function googleMapsUrl(p: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
}

/** 預覽上的定位：精確、約略（只到鄉鎮區）、找不到；有座標就附「在地圖上看」 */
const lookBtn = (lat: number, lng: number): string => `<button type="button" class="link-btn" data-look="${lat},${lng}">在雷達上看</button>`;

function previewWhere(p: PreviewItem): string {
  if (p.lat === null || p.lng === null) return '<span class="preview-warn">找不到地點，確認了也不會出現在雷達上</span>';
  const link = `${lookBtn(p.lat, p.lng)}・<a href="${googleMapsUrl({ lat: p.lat, lng: p.lng })}" target="_blank" rel="noopener">在 Google 地圖上看</a>`;
  return p.approxArea ? `<span class="preview-warn">只定位到${esc(p.approxArea)}（約略位置）</span>・${link}` : `已定位・${link}`;
}

/** 補充資料的表單：貼文沒寫地點或時間時，回報的人補上再判讀一次 */
function supplementFormHtml(current: string, hidden: boolean): string {
  const example = mod.current ? '例如「10/26 14:00–17:00」「地點：厝邊咖啡，台北市萬華區○○路○號」' : '例如「地點：厝邊咖啡，台北市萬華區○○路○號」「每週二、四 14:00–18:00」';
  return `<form class="preview-more"${hidden ? ' hidden' : ''}>
      <textarea rows="2" maxlength="200" placeholder="${example}" aria-label="補充地點或時間">${esc(current)}</textarea>
      <div class="sheet-actions"><button type="submit" class="btn primary">補充後再判讀</button>${hidden ? '<button type="button" class="btn" data-act="less">回上一步</button>' : ''}</div>
      <p class="muted sheet-note small">補充的內容會跟原貼文一起判讀，放上雷達後會寫明「回報的人補充」。請只寫你確定的資訊。</p>
    </form>`;
}

function wireSupplement(c: { postId: string; token: string }, actions: HTMLElement | null): void {
  const form = reportResult.querySelector<HTMLFormElement>('.preview-more');
  if (!form) return;
  reportResult.querySelector('[data-act="more"]')?.addEventListener('click', () => {
    form.hidden = false;
    if (actions) actions.hidden = true;
    form.querySelector('textarea')?.focus();
  });
  form.querySelector('[data-act="less"]')?.addEventListener('click', () => {
    form.hidden = true;
    if (actions) actions.hidden = false;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (reportBusy) return;
    const note = form.querySelector('textarea')?.value.trim() ?? '';
    if (note.length < 2) {
      showBanner(bannerEl, '請寫要補充的地點或時間', 2500);
      return;
    }
    setReportBusy(true, '重新判讀中…', form.querySelector('[type="submit"]'));
    const res = await supplementReport(c, note).finally(() => setReportBusy(false));
    if (!res.ok) {
      showBanner(bannerEl, res.message, 3500);
      return;
    }
    if (res.data.outcome === 'preview') renderPreview(res.data);
    else await showReportResult(res.data);
  });
}

const TPE_OFFSET_SEC = 8 * 3600;
const pad2 = (n: number): string => String(n).padStart(2, '0');
/** unix 秒 → 表單用的日期「2026-10-26」、時間「18:00」：活動當地的時間（國外的照 tz，其他台北） */
function wallInput(t: number, tz: string | null): { date: string; time: string } {
  if (tz) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const p = Object.fromEntries(fmt.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  }
  const d = new Date((t + TPE_OFFSET_SEC) * 1000);
  return { date: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`, time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` };
}
/** 表單的日期、時間 → unix 秒，先照台北時間換；國外的活動填的是當地時間，伺服器看地點再換（送出時帶 localTimes） */
function tpeUnix(date: string, time: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})/.exec(time);
  if (!d || !t) return null;
  return Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2])) / 1000 - TPE_OFFSET_SEC;
}

// 車掃的站最多 20 個（跟判讀一樣）
const MAX_EDIT_ITEMS = 20;
/** 一場活動最長多久（跟 worker 的 MAX_EDIT_SPAN_SEC 一樣，v1.567 起 3 天） */
const MAX_EDIT_SPAN_SEC = 3 * 86400;

/** 補充資料表單的一場：判讀出來的位置、回報的人標的位置、小地圖 */
interface EditPin {
  /** 判讀時或按「查地點」依地點查到的位置（地點文字改了就不算） */
  found: LatLng | null;
  foundPlace: string;
  approxArea: string | null;
  /** 按「查地點」查到的地名；查不到是 null（missed 是查不到的那段地點） */
  foundName: string | null;
  missed: string | null;
  /** 回報的人在地圖上標的（主畫面的地圖，v1.697） */
  pinned: LatLng | null;
}
const editPins = new Map<HTMLElement, EditPin>();

/** 洋流的補充資料：每一場直接改標題、時間、地點，位置不對可以在地圖上標 */
function editCardHtml(it: EditItem | null): string {
  const tz = it ? localTz(it) : null;
  const start = it?.startAt ? wallInput(it.startAt, tz) : null;
  const endWall = it?.endAt ? wallInput(it.endAt, tz) : null;
  const end = endWall?.time ?? '';
  // 跨天的（兩天的市集、跨夜到隔天早上的）結束日期跟開始不同才填；同一天、只跨過午夜到隔天清晨的留空（照舊自動算隔天）
  const overnight = !!(it?.startAt && it.endAt && it.endAt - it.startAt < 86400 && endWall && start && endWall.time <= start.time);
  const endDate = endWall && start && endWall.date !== start.date && !overnight ? endWall.date : '';
  return `<fieldset class="edit-item">
      <legend><span class="edit-no"></span><button type="button" class="chip" data-act="drop">不要這場</button></legend>
      <div class="edit-what">
        <label>主題<input name="topic" maxlength="6" value="${esc(it?.topic ?? '')}" placeholder="例如：遊行"></label>
        <label>活動內容<input name="title" maxlength="60" value="${esc(it?.title ?? '')}" placeholder="例如：景華公園表演同樂會"></label>
      </div>
      <div class="edit-row">
        <label>日期<input type="date" name="date" value="${start?.date ?? ''}"></label>
        <label>開始<input type="time" name="start" value="${it?.dateOnly ? '' : (start?.time ?? '')}"></label>
        <label>結束<input type="time" name="end" value="${end}"></label>
        <label class="edit-enddate">結束日期<small>（跨好幾天才填，最多 3 天）</small><input type="date" name="enddate" value="${endDate}"></label>
      </div>
      <small class="muted">結束可以不填：只寫幾點開始，雷達上顯示到開始後兩小時。國外的活動填當地時間。</small>
      <label>地點<input name="place" maxlength="80" value="${esc(it?.place ?? '')}" placeholder="店名或地址，例如：厝邊咖啡 台北市萬華區○○路○號"></label>
      <div class="edit-pin"><small class="edit-pin-state"></small><button type="button" class="chip" data-act="locate">查地點</button><button type="button" class="chip" data-act="pin">在雷達上標位置</button><button type="button" class="chip" data-act="unpin" hidden>不用標的位置</button></div>
      <div class="edit-tags">
        <span class="edit-tags-label">關鍵字<small>（讓人搜尋得到，按 × 拿掉）</small></span>
        <div class="edit-tag-list"></div>
        <input name="tag" maxlength="12" autocomplete="off" enterkeyhint="done" placeholder="加關鍵字，打完按 Enter，例如：彩虹">
        <div class="edit-tag-common"></div>
      </div>
    </fieldset>`;
}

/** 補充資料每一場的關鍵字（不含 #） */
const editTags = new Map<HTMLElement, string[]>();
const MAX_EDIT_TAGS = 8;
/** 填的關鍵字：拿掉 #、符號、空白；2～10 個字、不是只有數字 */
function cleanEditTag(v: string): string | null {
  const t = v.replace(/^#+/, '').replace(/[\s\p{P}\p{S}\p{Extended_Pictographic}\uFE0F]/gu, '').replace(/^漂帶$/, '飄帶');
  return [...t].length >= 2 && [...t].length <= 10 && !/^\d+$/.test(t) ? t : null;
}
const BAD_TAG = '關鍵字要 2～10 個字（中文、英文或數字）';

/** 關鍵字欄：已經有的（按了拿掉）、常見的（按了加上；目前活動用得多的在前面） */
function renderEditTags(card: HTMLElement): void {
  const tags = editTags.get(card) ?? [];
  const list = card.querySelector<HTMLElement>('.edit-tag-list');
  const common = card.querySelector<HTMLElement>('.edit-tag-common');
  const input = card.querySelector<HTMLInputElement>('[name="tag"]');
  const full = tags.length >= MAX_EDIT_TAGS;
  if (list) list.innerHTML = tags.map((t) => `<button type="button" class="chip on" data-del="${esc(t)}" aria-label="拿掉 #${esc(t)}">#${esc(t)} <span aria-hidden="true">×</span></button>`).join('');
  if (common) {
    // 常見的加上目前活動裡兩場以上用到的，用得多的在前面
    const used = [...tagUse].filter(([t, n]) => n >= 2 && cleanEditTag(t) === t).map(([t]) => t);
    const offer = [...new Set([...COMMON_TAGS, ...used])].sort(byTagUse);
    common.innerHTML = offer.filter((t) => !tags.includes(t)).map((t) => `<button type="button" class="chip" data-add="${esc(t)}" aria-label="加上 #${esc(t)}">＋${esc(t)}</button>`).join('');
    common.hidden = full;
  }
  if (input) {
    input.disabled = full;
    input.placeholder = full ? `最多 ${MAX_EDIT_TAGS} 個，要加請先拿掉一個` : '加關鍵字，打完按 Enter，例如：彩虹';
  }
}

/** 加一個關鍵字；看不懂的回傳 false */
function addEditTag(card: HTMLElement, v: string): boolean {
  const t = cleanEditTag(v);
  if (!t) return false;
  const tags = editTags.get(card) ?? [];
  if (!tags.includes(t) && tags.length < MAX_EDIT_TAGS) editTags.set(card, [...tags, t]);
  renderEditTags(card);
  return true;
}

function wireEditTags(card: HTMLElement, tags: string[]): void {
  editTags.set(card, tags.slice(0, MAX_EDIT_TAGS));
  renderEditTags(card);
  const box = card.querySelector<HTMLElement>('.edit-tags');
  const input = card.querySelector<HTMLInputElement>('[name="tag"]');
  box?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-del], [data-add]');
    if (!b) return;
    if (b.dataset.del !== undefined) {
      editTags.set(card, (editTags.get(card) ?? []).filter((t) => t !== b.dataset.del));
      renderEditTags(card);
      input?.focus();
    } else if (b.dataset.add) addEditTag(card, b.dataset.add);
  });
  // 打完按 Enter（不要送出表單）；打了空白、逗號也算打完一個
  const take = (all: boolean): void => {
    if (!input) return;
    const parts = input.value.split(/[\s,，、]+|(?=#)/);
    const rest = all ? '' : (parts.pop() ?? '');
    const bad = parts.filter((p) => p.replace(/#/g, '') !== '' && !addEditTag(card, p));
    input.value = bad.length > 0 ? `${bad.join(' ')} ${rest}`.trim() : rest;
    if (bad.length > 0) showBanner(bannerEl, BAD_TAG, 2500);
  };
  input?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    take(true);
  });
  input?.addEventListener('input', (e) => {
    // 注音、拼音還在選字時不切
    if (!(e as InputEvent).isComposing && /[\s,，、]|.#/.test(input.value)) take(false);
  });
}

function editFormHtml(items: EditItem[], hidden: boolean): string {
  const list = items.length > 0 ? items.slice(0, MAX_EDIT_ITEMS) : [null];
  return `<form class="preview-more edit-form"${hidden ? ' hidden' : ''} novalidate>
      <p class="muted sheet-note">直接改每一場的主題、活動內容、時間、地點、關鍵字；位置不對可以按「在雷達上標位置」，在雷達上拖標記或點一下。</p>
      <div class="edit-items">${list.map(editCardHtml).join('')}</div>
      <button type="button" class="btn" data-act="add">再加一場</button>
      <div class="sheet-actions"><button type="submit" class="btn primary">用這些資料預覽</button>${hidden ? '<button type="button" class="btn" data-act="less">回上一步</button>' : ''}</div>
      <p class="muted sheet-note small">改過的地方放上雷達後會寫明是回報的人改的。請只填你確定的資訊。</p>
    </form>`;
}

/** 標位置的說明：用標的、用依地點查到的、還是送出後再查 */
function updatePinState(card: HTMLElement): void {
  const pin = editPins.get(card);
  if (!pin) return;
  const place = card.querySelector<HTMLInputElement>('[name="place"]')?.value.trim() ?? '';
  const found = pin.found && place === pin.foundPlace;
  const missed = !pin.pinned && !found && pin.missed === place;
  // 國外的完整地址很長：「12901, Alcosta Boulevard, San Ramon, Contra Costa County, California, …」留前四段
  const name = pin.foundName?.split(/,\s*/).slice(0, 4).join(', ');
  const state = card.querySelector<HTMLElement>('.edit-pin-state');
  if (state) {
    state.textContent = pin.pinned
      ? '📍 用你在雷達上標的位置'
      : markCard === card && !found
        ? '在雷達上拖動標記，或點一下要的位置'
      : found
        ? pin.approxArea
          ? `只定位到${pin.approxArea}（約略位置），可以在雷達上標出正確位置`
          : name
            ? `📍 查到：${name}（不一定準確），位置不對可以拖標記或點雷達`
            : '已依地點定位（不一定準確），位置不對可以在地圖上標'
        : missed
          ? '查不到這個地點。可以寫完整一點：台灣的寫縣市、路名、門牌；國外的寫門牌、街道、城市、州和國家（例如「12901 Alcosta Blvd, San Ramon, CA 94583, USA」），或在地圖上標'
          : '可以按「查地點」先在地圖上看位置；不查的話送出後依地點查';
    state.classList.toggle('preview-warn', !pin.pinned && ((!!found && !!pin.approxArea) || missed));
  }
  const unpin = card.querySelector<HTMLElement>('[data-act="unpin"]');
  if (unpin) unpin.hidden = !pin.pinned;
}

function wireEditCard(c: { postId: string; token: string }, card: HTMLElement, it: EditItem | null, form: HTMLFormElement): void {
  const found = it && it.lat !== null && it.lng !== null ? { lat: it.lat, lng: it.lng } : null;
  const pin: EditPin = { found, foundPlace: it?.place ?? '', approxArea: it?.approxArea ?? null, foundName: null, missed: null, pinned: null };
  editPins.set(card, pin);
  // 關鍵字：判讀出來的；再加一場的先帶上一場的
  const prev = card.previousElementSibling instanceof HTMLElement && card.previousElementSibling.matches('.edit-item') ? card.previousElementSibling : null;
  wireEditTags(card, it ? (it.tags ?? []) : prev ? (editTags.get(prev) ?? []) : []);
  const placeInput = card.querySelector<HTMLInputElement>('[name="place"]');
  placeInput?.addEventListener('input', () => {
    updatePinState(card);
    if (markCard === card) render();
  });
  // 在主畫面的地圖上標（v1.697）：從標的位置、查到的位置開始，都沒有就從地圖現在的正中間
  card.querySelector('[data-act="pin"]')?.addEventListener('click', () => markOnMap(card));
  // 查地點：查法跟送出後一樣，查到的標在主畫面的地圖上（之前在地圖上標的不算了），位置不對再拖
  const locateBtn = card.querySelector<HTMLButtonElement>('[data-act="locate"]');
  locateBtn?.addEventListener('click', async () => {
    const place = placeInput?.value.trim() ?? '';
    if (place.length < 2) {
      showBanner(bannerEl, '請先填地點', 2500);
      placeInput?.focus();
      return;
    }
    locateBtn.disabled = true;
    locateBtn.textContent = '查詢中…';
    const res = await locatePlace(c, place).finally(() => {
      locateBtn.disabled = false;
      locateBtn.textContent = '查地點';
    });
    if (!res.ok) {
      showBanner(bannerEl, res.message, 3500);
      return;
    }
    const r = res.data;
    const hit = r.found && r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null;
    pin.foundPlace = place;
    pin.found = hit;
    pin.approxArea = hit ? r.approxArea : null;
    pin.foundName = hit ? r.name : null;
    pin.missed = hit ? null : place;
    // 查了新的地點：之前在地圖上標的不算
    pin.pinned = null;
    updatePinState(card);
    if (!hit) return;
    markOnMap(card);
  });
  card.querySelector('[data-act="unpin"]')?.addEventListener('click', () => {
    pin.pinned = null;
    updatePinState(card);
    if (markCard === card) render();
  });
  card.querySelector('[data-act="drop"]')?.addEventListener('click', () => {
    if (markCard === card) stopMark();
    editPins.delete(card);
    editTags.delete(card);
    card.remove();
    renumberEdit(form);
  });
  updatePinState(card);
}

/** 第幾場、只剩一場時不能刪、最多幾場 */
function renumberEdit(form: HTMLFormElement): void {
  const cards = [...form.querySelectorAll<HTMLElement>('.edit-item')];
  cards.forEach((c, i) => {
    const no = c.querySelector('.edit-no');
    if (no) no.textContent = cards.length > 1 ? `第 ${i + 1} 場` : '活動';
    const drop = c.querySelector<HTMLElement>('[data-act="drop"]');
    if (drop) drop.hidden = cards.length <= 1;
  });
  const add = form.querySelector<HTMLElement>('[data-act="add"]');
  if (add) add.hidden = cards.length >= MAX_EDIT_ITEMS;
}

/** 讀表單：缺的直接講是第幾場缺什麼 */
function readEditForm(form: HTMLFormElement): EditInput[] | string {
  const cards = [...form.querySelectorAll<HTMLElement>('.edit-item')];
  const out: EditInput[] = [];
  for (const [i, card] of cards.entries()) {
    const at = cards.length > 1 ? `第 ${i + 1} 場：` : '';
    const val = (name: string): string => card.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value.trim() ?? '';
    const title = val('title');
    const topic = val('topic') || null;
    const place = val('place');
    if (!title) return `${at}請填活動內容`;
    if (!val('date') || !val('start')) return `${at}請填哪天幾點開始`;
    if (!place) return `${at}請填地點`;
    const startAt = tpeUnix(val('date'), val('start'));
    if (startAt === null) return `${at}日期或時間看不懂，請重新選`;
    // 跨好幾天的（v1.567 使用者說「活動持續三天以內」都要收）：照填的結束日期；沒填結束日期、結束比開始早：跨過午夜，是隔天
    const endDate = val('enddate');
    if (endDate && !val('end')) return `${at}填了結束日期，也請填幾點結束`;
    let endAt = val('end') ? tpeUnix(endDate || val('date'), val('end')) : null;
    if (endAt !== null && !endDate && endAt <= startAt) endAt += 86400;
    if (endAt !== null && endAt <= startAt) return `${at}結束要在開始之後`;
    if (endAt !== null && endAt - startAt > MAX_EDIT_SPAN_SEC) return `${at}一場活動最長 3 天，再長的請分成幾場`;
    const pinned = editPins.get(card)?.pinned ?? null;
    // 關鍵字欄打了還沒按 Enter 的也算
    const typed = val('tag').split(/[\s,，、]+|(?=#)/).filter((p) => p.replace(/#/g, '') !== '');
    const tags = [...(editTags.get(card) ?? [])];
    for (const p of typed) {
      const t = cleanEditTag(p);
      if (!t) return `${at}${BAD_TAG}`;
      if (!tags.includes(t) && tags.length < MAX_EDIT_TAGS) tags.push(t);
    }
    out.push({ title, topic, tags, startAt, endAt, place, lat: pinned?.lat ?? null, lng: pinned?.lng ?? null });
  }
  return out.length > 0 ? out : '至少要填一場活動';
}

function wireEdit(c: { postId: string; token: string }, items: EditItem[], actions: HTMLElement | null): void {
  const form = reportResult.querySelector<HTMLFormElement>('.edit-form');
  if (!form) return;
  // 換了一個表單：之前那張表單在地圖上標的不再標
  markCard = null;
  markStart = null;
  editPins.clear();
  editTags.clear();
  const list = form.querySelector<HTMLElement>('.edit-items');
  [...form.querySelectorAll<HTMLElement>('.edit-item')].forEach((card, i) => wireEditCard(c, card, items[i] ?? null, form));
  renumberEdit(form);
  // 再加一場：內容先複製上一場的（v1.697 使用者說的；常常只差日期），日期欄先選好，改不一樣的就好
  form.querySelector('[data-act="add"]')?.addEventListener('click', () => {
    if (!list) return;
    const last = [...list.querySelectorAll<HTMLElement>('.edit-item')].at(-1) ?? null;
    list.insertAdjacentHTML('beforeend', editCardHtml(null));
    const card = list.lastElementChild as HTMLElement;
    if (last) {
      for (const name of ['topic', 'title', 'date', 'start', 'enddate', 'end', 'place']) {
        const from = last.querySelector<HTMLInputElement>(`[name="${name}"]`);
        const to = card.querySelector<HTMLInputElement>(`[name="${name}"]`);
        if (from && to) to.value = from.value;
      }
    }
    wireEditCard(c, card, null, form);
    // 位置也一樣（查到的、標的）
    const lp = last ? editPins.get(last) : undefined;
    const np = editPins.get(card);
    if (lp && np) {
      Object.assign(np, { found: lp.found, foundPlace: lp.foundPlace, approxArea: lp.approxArea, foundName: lp.foundName, missed: lp.missed, pinned: lp.pinned });
      updatePinState(card);
    }
    renumberEdit(form);
    const date = card.querySelector<HTMLInputElement>('[name="date"]');
    (last && date ? date : card.querySelector<HTMLInputElement>('[name="title"]'))?.focus();
  });
  reportResult.querySelector('[data-act="more"]')?.addEventListener('click', () => {
    form.hidden = false;
    if (actions) actions.hidden = true;
    form.querySelector<HTMLInputElement>('input')?.focus();
  });
  form.querySelector('[data-act="less"]')?.addEventListener('click', () => {
    form.hidden = true;
    if (actions) actions.hidden = false;
    stopMark();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // 欄位裡按 Enter 也會送出：送出中不再送
    if (reportBusy) return;
    const read = readEditForm(form);
    if (typeof read === 'string') {
      showBanner(bannerEl, read, 3000);
      return;
    }
    setReportBusy(true, '更新預覽中…', form.querySelector('[type="submit"]'));
    const res = await editReport(c, read).finally(() => setReportBusy(false));
    if (!res.ok) {
      showBanner(bannerEl, res.message, 3500);
      return;
    }
    if (res.data.outcome === 'preview') renderPreview(res.data);
    else await showReportResult(res.data);
  });
}

/**
 * 卡片（點光點、清單跳出來的詳細資料、車掃時間表、主題、類別、關鍵字）點其他地方就關閉。
 * 一則的詳細資料只收起卡片，雷達、地圖、清單上照樣選著（按卡片的「關閉」才取消選取）。
 * 點的是按鈕、連結、欄位、雷達光點、地圖標記、清單的一列（會自己打開別的）或卡片裡面不關；
 * 拖動（移動雷達、地圖）不算點。回報、漂流瓶有打字的內容，不跟著關
 */
const KEEP_OPEN = 'button, a, input, select, textarea, label, .sheet, .blip, .landmark, .bottle, .space-hit, .leaflet-marker-icon, .leaflet-interactive, .leaflet-popup, .leaflet-control, #event-list li';
function wireTapOutside(): void {
  let down: { x: number; y: number } | null = null;
  document.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }), true);
  // 在 capture 階段判斷：點清單、光點會馬上重畫，等冒泡上來時點的那個元素已經不在畫面上
  document.addEventListener(
    'click',
    (e) => {
      const moved = !!down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10;
      down = null;
      const t = e.target instanceof Element ? e.target : null;
      if (moved || !t || t.closest(KEEP_OPEN)) return;
      // 詳細資料跟按「關閉」一樣：收起來、取消選取（雷達、地圖、清單上不再標著）
      for (const sheet of [detailEl, themeSheet, moduleSheet, kwSheet]) {
        if (!sheet.hidden) sheet.querySelector<HTMLButtonElement>('[data-act="close"]')?.click();
      }
      // 車掃出發前按「在地圖上看路線」畫出來的路線：點其他地方收起，回到只顯示起點
      if (routeOnMap) {
        routeOnMap = null;
        render();
      }
    },
    true,
  );
}

/** 雷達上已經有這個據點時，確認後會怎樣 */
function updateNote(u: NonNullable<PreviewItem['update']>): string {
  return u.mode === 'replace'
    ? `雷達上已經有「${u.title}」，這則是同一個帳號的新貼文：確認後據點改成以這則為準，舊貼文留在詳細資料。`
    : `雷達上已經有「${u.title}」：確認後這則附在它的詳細資料（相關貼文），據點的內容不變。`;
}

/** 預覽上的一條車掃路線：每一站的預計時間、會不會放上雷達 */
function routePreviewHtml(rt: RoutePreview): string {
  const first = rt.stops[0];
  const last = rt.stops[rt.stops.length - 1];
  if (!first || !last) return '';
  const listed = rt.stops.filter((st) => st.status === 'listed').length;
  const label: Record<RoutePreview['stops'][number]['kind'], string> = { start: '出發', cheer: '應援點', end: '抵達' };
  const rows = rt.stops
    .map((st) => {
      const status =
        st.status === 'listed'
          ? st.lat !== null && st.lng !== null
            ? `已定位・${lookBtn(st.lat, st.lng)}・<a href="${googleMapsUrl({ lat: st.lat, lng: st.lng })}" target="_blank" rel="noopener">在 Google 地圖上看</a>`
            : '已定位'
          : st.status === 'approximate'
            ? `<span class="preview-warn">只定位到${esc(st.area ?? '鄉鎮區')}（約略位置），不會放上雷達；可以按「補充資料」在雷達上標出位置</span>`
            : st.status === 'unlocated'
              ? st.sameAs
                ? `<span class="preview-warn">跟「${esc(st.sameAs)}」定位在同一個地方，可能查錯了，不會放上雷達；可以按「補充資料」在雷達上標出位置</span>`
                : '<span class="preview-warn">地圖上查不到，不會放上雷達；可以按「補充資料」補上地址或在地圖上標</span>'
              : '車隊已經經過';
      return `<li class="stop stop-${st.kind}${st.status === 'passed' ? ' passed' : ''}"><div><span class="stop-time">${st.kind === 'start' ? '' : '約 '}${fmtTime(st.at)}</span><span class="stop-name"><b>${label[st.kind]}</b>${esc(st.name)}${st.place ? `<small class="stop-place">${esc(shortAddress(st.place))}</small>` : ''}<small>${status}</small></span></div></li>`;
    })
    .join('');
  return `<li>
      <b>車掃｜${esc(rt.title)}</b>
      <small>時間：${esc(dateFmt.format(new Date(first.at * 1000)))} ${fmtTime(first.at)} 出發，約 ${fmtTime(last.at)} 到最後一站・共 ${rt.stops.length} 站，${listed} 站會放上雷達</small>
      <ol class="route-stops">${rows}</ol>
      <small>雷達上每一站從預計經過前 10 分鐘顯示到經過後 15 分鐘；地圖上各站用直線連起來，不是實際走的路。</small>
    </li>`;
}

/** 判讀完先給回報的人看：對了才放上雷達，不對就不放並記下哪裡錯 */
function renderPreview(r: SubmitResult): void {
  const items = r.preview ?? [];
  const c = r.confirm;
  if (!c) return;
  const dups = r.events.length
    ? `<p class="muted sheet-note">雷達上已經有的：${r.events.map((ev) => esc(titleOf(ev))).join('、')}（不會重複放）</p>`
    : '';
  setReportMsg(`<p class="msg">${OUTCOME_TEXT.preview}對的話才會放上雷達。</p>
    <ul class="report-preview">${(r.routes ?? []).map(routePreviewHtml).join('')}${items
      .map(
        (p) => `<li>
          <b>${p.kind === 'food' ? ({ vendor: '出攤', recommend: '推薦', meetup: '揪團' }[foodRole(p) ?? 'recommend'] ?? '推薦') : p.kind === 'session' ? (isSeek(p) ? '找臨打' : '招臨打') : p.kind === 'job' ? (isOffer(p) ? jobWords().offer : '徵人') : p.kind === 'activity' ? esc(topicOf(p) ?? '活動') : '發放'}${p.spot ? (p.kind === 'session' ? '・每週固定場' : p.kind === 'food' ? '・每週固定擺攤' : '・固定據點') : ''}｜${esc(p.title)}</b>
          ${p.kind === 'job' && (jobOf(p).risks ?? []).some((r) => r !== 'no_employer') ? `<small class="preview-warn">⚠️ ${esc((jobOf(p).risks ?? []).map((r) => JOB_RISK_TEXT[r]).filter(Boolean).join('；'))}</small>` : ''}
          ${p.item ? `<small>${esc(p.item)}</small>` : ''}
          ${tagsOf(p).length > 0 ? `<small>關鍵字：${tagsHtml(tagsOf(p))}</small>` : ''}
          <small>時間：${esc(previewWhen(p))}</small>
          <small>地點：${esc(shortAddress(p.placeText.replace(/\s*\n\s*/g, ' ')))}</small>
          <small>${previewWhere(p)}</small>
          ${p.profileHint ? `<small class="preview-warn">📍 貼文沒寫地點，這是從 ${esc(p.profileHint)} 的帳號名稱、簡介推的，請確認是不是這裡。</small>` : ''}
          ${p.update ? `<small class="preview-warn">${esc(updateNote(p.update))}</small>` : ''}
        </li>`,
      )
      .join('')}</ul>
    ${items.some((p) => p.lat !== null && p.lng !== null) ? `<p class="muted sheet-note small">📍 位置可能不準，${mod.current ? '不對就把虛線圈拖到正確的地方' : '不對請按「補充資料」補上地址'}</p>` : ''}
    ${dups}${r.failures?.length ? `<p class="muted sheet-note">${r.failures.length > 1 ? `下面 ${r.failures.length} 場` : '下面這場'}不會放上雷達${canFixByNote(r.failures) ? '，知道的話可以按「補充資料」補上' : ''}：</p>${failuresHtml(r.failures)}` : ''}
    <div class="sheet-actions">
      <button type="button" class="btn primary" data-act="confirm">${items.length > 0 && items.every((p) => p.update?.mode === 'attach') ? '對，附在這個據點' : '對，放上雷達'}</button>
      <button type="button" class="btn" data-act="more">補充資料</button>
      <button type="button" class="btn" data-act="wrong">不對</button>
    </div>
    ${mod.current ? editFormHtml(r.edit ?? [], true) : supplementFormHtml(r.supplement ?? '', true)}
    <form class="preview-wrong" hidden>
      <textarea rows="2" maxlength="300" placeholder="哪裡判斷錯了？（選填，例如「地點是文化路 140 號」「只有 10/21 一天」）" aria-label="哪裡判斷錯了"></textarea>
      <div class="sheet-actions"><button type="submit" class="btn primary">送出，不放上雷達</button><button type="button" class="btn" data-act="back">回上一步</button></div>
    </form>`);
  for (const b of reportResult.querySelectorAll<HTMLButtonElement>('[data-look]')) {
    b.addEventListener('click', () => {
      const [lat, lng] = (b.dataset.look ?? '').split(',').map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lng)) lookAtPin(lat, lng);
    });
  }
  const wrongForm = reportResult.querySelector<HTMLFormElement>('.preview-wrong');
  const actions = reportResult.querySelector<HTMLElement>('.sheet-actions');
  reportResult.querySelector('[data-act="confirm"]')?.addEventListener('click', async (e) => {
    if (reportBusy) return;
    setReportBusy(true, '放上雷達中…', e.currentTarget as Element);
    const res = await confirmReport(c).finally(() => setReportBusy(false));
    if (!res.ok) {
      showBanner(bannerEl, res.message, 3500);
      return;
    }
    await showReportResult(res.data);
    void loadMyReports();
    // 回報累計：滿 5 則拿到古錐媽的肉乾卡、每 5 則一枚順幣
    void gotReward(res.data.reward, (msg) => showBanner(bannerEl, msg, 4500));
  });
  if (mod.current) wireEdit(c, r.edit ?? [], actions);
  else wireSupplement(c, actions);
  // 定位到的直接標在雷達、地圖上（v1.683），移過去；洋流的活動可以直接拖到正確的位置（v1.686；v1.699 起在雷達上拖，不切到地圖）
  reportPins = previewPins(items, r.routes ?? []).map((p) => ({ ...p, drag: editCardsAt(p).length > 0 }));
  pinConfirm = c;
  render();
  flyToPins(reportPins);
  reportResult.querySelector('[data-act="wrong"]')?.addEventListener('click', () => {
    if (!wrongForm || !actions) return;
    wrongForm.hidden = false;
    actions.hidden = true;
    wrongForm.querySelector('textarea')?.focus();
  });
  wrongForm?.querySelector('[data-act="back"]')?.addEventListener('click', () => {
    wrongForm.hidden = true;
    if (actions) actions.hidden = false;
  });
  wrongForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (reportBusy) return;
    const note = wrongForm.querySelector('textarea')?.value ?? '';
    setReportBusy(true, '送出中…', wrongForm.querySelector('[type="submit"]'));
    const res = await rejectReport(c, note).finally(() => setReportBusy(false));
    setReportMsg(
      res.ok
        ? '<p class="msg">收到，這則不會放上雷達。你寫的會交給管理者看，修正後再放上去。</p>'
        : `<p class="msg error">${esc(res.message)}</p>`,
    );
    if (res.ok) reportInput.value = '';
  });
}

async function submitReport(): Promise<void> {
  if (reportBusy || !reportsOpen) return;
  const url = reportInput.value.trim();
  if (!url) {
    setReportMsg('<p class="msg error">請先貼上 Threads 貼文，或活動通、OPENTIX 活動頁的連結</p>');
    return;
  }
  setReportBusy(true);
  setReportMsg('<p class="msg busy">讀取貼文並判讀中，約需 10 秒</p>');
  const r = await submitLink(url, mod.id).finally(() => setReportBusy(false));
  if (!r.ok) {
    setReportMsg(`<p class="msg error">${esc(r.message)}</p>`);
    return;
  }
  lsSet(LS_REPORTED, '1');
  void loadMyReports();
  if (r.data.outcome === 'preview') {
    renderPreview(r.data);
    return;
  }
  await showReportResult(r.data);
}

/** 結果清單：固定據點的每個時段、同一天同地點的好幾個時段合成一列，不然一個據點會列出一整排 */
function resultGroups(list: EventOut[]): EventOut[][] {
  const groups = new Map<string, EventOut[]>();
  for (const ev of [...list].sort((a, b) => a.startAt - b.startAt)) {
    const k = ev.spot ? `spot|${spotKey(ev)}` : `${ev.post.id}|${ev.placeText}|${taipeiDay(ev.startAt)}`;
    groups.set(k, [...(groups.get(k) ?? []), ev]);
  }
  return [...groups.values()];
}

const ACTIVITY_PART_TEXT: Record<'content' | 'place' | 'start', string> = { content: '活動內容', place: '地點', start: '開始時間（哪天幾點）' };

/** 洋流的活動缺哪些（「地點、結束時間」） */
const missingText = (parts: Array<keyof typeof ACTIVITY_PART_TEXT>): string => parts.map((p) => ACTIVITY_PART_TEXT[p]).join('、');

/** 沒放上雷達的一場為什麼：缺什麼、哪裡不對，一句一句講清楚 */
function failureReason(f: FailedItem): string {
  const tz = f.tz && f.tz !== 'Asia/Taipei' ? f.tz : null;
  const local = tz ? '（當地時間）' : '';
  const at = (t: number): string => `${fmtDateTz(t, tz)} ${fmtTimeTz(t, tz)}${local}`;
  if (f.reason === 'incomplete') {
    return (f.missing ?? [])
      .map((p) =>
        p === 'content'
          ? '看不出要做什麼（沒有活動內容）'
          : p === 'place'
            ? f.selfPlace
              ? `地點只寫了「${f.selfPlace}」，沒寫店名或地址`
              : '沒寫在哪裡（沒有地點）'
            : f.dateOnly
              ? `只寫了日期（${fmtDateTz(f.dateOnly, tz)}），沒寫幾點開始`
              : '沒寫哪天幾點開始',
      )
      .join('；');
  }
  if (f.reason === 'approximate') return `只定位到${f.area ?? '鄉鎮區'}（約略位置），請在雷達上標出位置`;
  if (f.reason === 'unlocated') return `地點「${f.place ?? ''}」在地圖上查不到，請補上完整地址或店名，或在雷達上標出位置`;
  if (f.reason === 'already_over') {
    if (!f.startAt) return '時間已經過了';
    return f.endOpen
      ? `${at(f.startAt)} 開始、沒寫結束時間，當成開始後兩小時結束，已經過了`
      : `${at(f.startAt)} 開始${f.endAt ? `、${fmtTimeTz(f.endAt, tz)} 結束` : ''}，已經過了`;
  }
  if (f.reason === 'too_far_in_future') {
    const from = f.reportFrom ? `，${dateFmt.format(new Date(f.reportFrom * 1000))} 之後再貼一次就能放上去` : '';
    return `${f.startAt ? `${at(f.startAt)} 才開始` : '太久以後才開始'}，雷達只收 21 天內開始的${from}`;
  }
  return 'AI 不太確定這是可以到場參加的活動，或是內容、時間、地點讀得不確定';
}

/** 沒放上雷達的每一場：標題（沒有就寫第幾場）、地點、原因 */
function failuresHtml(fails: FailedItem[]): string {
  const name = (f: FailedItem, i: number): string => f.title ?? (fails.length > 1 ? `第 ${i + 1} 場` : '這場活動');
  return `<ul class="report-preview">${fails
    .map(
      (f, i) =>
        `<li><b>${esc(name(f, i))}</b>${f.place && f.reason !== 'unlocated' ? `<small>地點：${esc(shortAddress(f.place))}</small>` : ''}<small class="preview-warn">${esc(failureReason(f))}</small></li>`,
    )
    .join('')}</ul>`;
}

/** 缺資料、地點查不到的可以補充：講一下要補什麼 */
const canFixByNote = (fails: FailedItem[]): boolean => fails.some((f) => f.reason === 'incomplete' || f.reason === 'unlocated' || f.reason === 'approximate');

/** 沒放上雷達、原因確定時直接講：「這場是 10/20（二）19:00 開始的，已經結束了」 */
function notListedText(w: NonNullable<SubmitResult['why']>): string | null {
  const tz = w.tz && w.tz !== 'Asia/Taipei' ? w.tz : null;
  const local = tz ? '（當地時間）' : '';
  if (w.reason === 'incomplete' && w.missing?.length) {
    return `判讀不到${missingText(w.missing)}，所以沒有放上雷達。活動要有內容、地點和開始時間才收；知道的話可以在下面補上。`;
  }
  if (w.reason === 'no_start_time') return '判讀不出時間（貼文沒寫哪天或幾點），所以沒有放上雷達。知道時間的話，可以在下面補充再判讀一次。';
  // 其他雷達只收單次的（v1.617）
  if (w.reason === 'long_term') return '這是每週固定、長期的，或沒寫哪天，雷達只收單次的（寫了哪天幾點），所以沒有放上雷達。知道是哪一天的話，可以在下面補充再判讀一次。';
  if (w.reason === 'already_over') {
    return w.startAt ? `這場是 ${fmtDateTz(w.startAt, tz)} ${fmtTimeTz(w.startAt, tz)}${local} 開始的，已經結束了，所以沒有放上雷達。` : '這則的時段都已經結束了，所以沒有放上雷達。';
  }
  if (w.reason === 'too_far_in_future' && w.startAt) {
    const from = w.reportFrom ? `，${dateFmt.format(new Date(w.reportFrom * 1000))} 之後再貼一次就能放上去` : '';
    return `這場 ${fmtDateTz(w.startAt, tz)}${local} 才開始，雷達只收 21 天內開始的${from}。`;
  }
  return null;
}

/** 判讀或確認後的結果：放上雷達的、重複的，點了跳到那一場 */
async function showReportResult(data: SubmitResult): Promise<void> {
  const { outcome, events: found, existed } = data;
  // 自己剛加入雷達的會出現在下面的「我的回報」，不再列一次；別人之前回報過的、附在據點的不在我的回報裡，照樣列
  const inMine = outcome === 'added' && !existed;
  // 洋流的活動：每一場沒放上雷達的原因（缺什麼、地點查不到、時間不對）
  const fails = data.failures ?? [];
  const noneListed = outcome === 'not_listed' || outcome === 'no_place';
  const head = inMine
    ? '已加入雷達，可以在下面「我的回報」按「看」。'
    : existed && (outcome === 'added' || outcome === 'duplicate' || outcome === 'attached')
      ? '這則之前已經有人回報，已在雷達上：'
      : noneListed && fails.length > 0
        ? fails.length > 1
          ? `這則判讀出 ${fails.length} 場活動，都沒有放上雷達：`
          : '這則沒有放上雷達：'
        : (outcome === 'not_listed' && data.why && notListedText(data.why)) || (outcome === 'not_event' ? mod.notEventText : outcome === 'no_place' ? mod.noPlaceText : OUTCOME_TEXT[outcome]);
  const failHtml =
    fails.length > 0
      ? `${noneListed ? '' : '<p class="muted sheet-note">另外這些沒有放上雷達：</p>'}${failuresHtml(fails)}${
          canFixByNote(fails) ? '<p class="muted sheet-note">活動要有內容、地點和開始時間才收（結束時間可以不寫）；知道的話可以在下面補上。</p>' : ''
        }`
      : '';
  // 判讀成不是活動：附上 AI 的理由，判斷錯了可以補充
  const noteHtml =
    outcome === 'not_event' && data.note
      ? `<p class="muted sheet-note">AI 的判斷：${esc(data.note)}。如果判斷錯了，可以在下面直接填活動內容、時間和地點。</p>`
      : '';
  const list = (inMine ? [] : resultGroups(found))
    .map((g) => {
      const ev = g[0];
      const day = (t: number): string => dateFmt.format(new Date(t * 1000));
      const last = g[g.length - 1];
      const when = ev.spot
        ? `${spotHours(g)}・${day(ev.startAt)}${taipeiDay(last.startAt) !== taipeiDay(ev.startAt) ? ` 到 ${day(last.startAt)}` : ''}${last.untilOpen ? openEndTail(last) : ''}`
        : ev.allDay
          ? `${day(ev.startAt)} ${allDayText(ev, false)}`
          : `${fmtDateTz(ev.startAt, localTz(ev))} ${g.map((x) => fmtTimeTz(x.startAt, localTz(ev))).join('、')}${localTz(ev) ? '（當地時間）' : ''}`;
      return `<li><button type="button" data-id="${ev.id}"><b>${kindLabel(ev)}${ev.spot ? '・固定據點' : ''}｜${esc(titleOf(ev))}</b><small>${esc(placeLine(ev))} · ${esc(when)}</small></button></li>`;
    })
    .join('');
  // 還沒放上雷達（找不到地點、判讀不出時間）：可以補充資料再判讀一次
  const canSupplement = !!data.confirm && (outcome === 'no_place' || outcome === 'not_listed' || outcome === 'not_event');
  setReportMsg(
    `<p class="msg">${esc(head)}</p>${list ? `<ul class="report-events">${list}</ul>` : ''}${failHtml}${noteHtml}${
      !canSupplement
        ? ''
        : mod.current
          ? editFormHtml(data.edit ?? [], false)
          : `${data.supplement ? `<p class="muted sheet-note">你補充的：${esc(data.supplement)}</p>` : ''}${supplementFormHtml(data.supplement ?? '', false)}`
    }`,
  );
  if (canSupplement && data.confirm) {
    if (mod.current) wireEdit(data.confirm, data.edit ?? [], null);
    else wireSupplement(data.confirm, null);
  }
  for (const b of reportResult.querySelectorAll<HTMLButtonElement>('[data-id]')) {
    b.addEventListener('click', () => {
      reportSheet.hidden = true;
      bottleSheet.hidden = true;
      selectedId = null;
      void reveal(Number(b.dataset.id), true);
    });
  }
  if (found.length > 0) {
    reportInput.value = '';
    await refresh();
  }
}

const MY_REPORT_STATE: Record<MyReport['state'], string> = {
  on_radar: '在雷達上',
  attached: '附在雷達上的據點',
  not_listed: '不在雷達上（已結束）',
};

/** 我的回報：30 天內用這個瀏覽器回報、已經放上雷達的，可以看、開原文、刪除 */
async function loadMyReports(): Promise<void> {
  const r = await fetchMyReports();
  if (!r.ok) return;
  myReports = r.data.reports;
  myReportIds.clear();
  for (const x of myReports) myReportIds.add(x.postId);
  renderMyReports();
}

/** 我的回報超過幾筆就收起來，只列最新的幾筆 */
const MY_REPORTS_FOLDED = 3;
let myReportsExpanded = false;

function renderMyReports(): void {
  myReportsEl.hidden = myReports.length === 0;
  const folded = !myReportsExpanded && myReports.length > MY_REPORTS_FOLDED;
  myReportList.innerHTML = (folded ? myReports.slice(0, MY_REPORTS_FOLDED) : myReports)
    .map(
      (x) => `<li>
        <div><b>${esc(x.title || '（沒有內容）')}</b><small>${MY_REPORT_STATE[x.state]}${x.events > 1 ? `・${x.events} 場` : ''}・${dateFmt.format(new Date(x.reportedAt * 1000))} 回報${x.username ? `・@${esc(x.username)}` : ''}${x.module && x.module !== mod.id ? `・${esc(getModule(x.module).short)}` : ''}</small></div>
        <div class="my-report-acts">${x.eventId ? `<button type="button" class="chip" data-show="${x.eventId}">看</button>` : ''}${x.permalink ? `<a class="chip" href="${esc(x.permalink)}" target="_blank" rel="noopener">原文</a>` : ''}<button type="button" class="chip" data-withdraw="${esc(x.postId)}">刪除</button></div>
      </li>`,
    )
    .join('');
  myReportsMore.hidden = myReports.length <= MY_REPORTS_FOLDED;
  myReportsMore.textContent = folded ? `顯示全部（${myReports.length} 則）` : '收起';
  myReportsMore.setAttribute('aria-expanded', String(!folded));
}

/** 刪除自己的回報：雷達上這則的發放、活動一起拿掉 */
/** 刪除自己的回報（車掃是整條路線、每一站一起）；有刪掉回傳 true */
async function withdrawMine(postId: string): Promise<boolean> {
  const x = myReports.find((r) => r.postId === postId);
  const shown = !x || x.state === 'on_radar' || x.state === 'attached';
  const what = routes.some((r) => r.postId === postId) ? '這條車掃的每一站和路線' : '雷達上這則的發放、活動';
  if (!window.confirm(shown ? `要刪除這則回報嗎？${what}會一起拿掉，其他人也看不到了。` : '要刪除這則回報嗎？')) return false;
  const r = await withdrawReport(postId);
  if (!r.ok) {
    showBanner(bannerEl, r.message, 3500);
    return false;
  }
  showBanner(bannerEl, '已刪除這則回報', 2500);
  await loadMyReports();
  await refresh();
  return true;
}

/** 清單最下面的版號：網站（建置時的提交）與伺服器（部署時的提交）分開寫，看得出哪邊已經更新 */
function showVersion(server: string | null): void {
  const v = __APP_VERSION__;
  const web = `${v.version}${v.date ? `（${v.date}${v.sha ? `・${v.sha}` : ''}）` : ''}`;
  $('#app-version').textContent = `洋流雷達 ${web}${server && server !== v.version ? `・伺服器 ${server}` : ''}`;
}

/** 從 Threads App 分享過來（PWA share target）或網址帶 ?url= */
/** 分享進來的連結：打開回報、填好、送出（判讀照現在的雷達） */
function sendSharedLink(link: string): void {
  openReportSheet(true);
  reportInput.value = link;
  void submitReport();
}

function takeSharedLink(params: URLSearchParams): string | null {
  const text = [params.get('url'), params.get('text'), params.get('title')].filter(Boolean).join(' ');
  return /threads\.(com|net)\/|accupass\.com\/(event|go)\/|opentix\.life\/event\//i.test(text) ? text : null;
}

function notifyOn(): boolean {
  const v = lsGet(LS_NOTIFY);
  return v === null ? notificationState() === 'granted' : v === 'on';
}

function updateNotifyBtn(): void {
  const on = notifyOn();
  notifyBtn.classList.toggle('on', on);
  notifyBtn.setAttribute('aria-pressed', String(on));
  notifyBtn.title = !on ? '開啟聲音與通知' : notificationState() === 'granted' ? '通知已開啟，再按一次關閉' : '音效提醒已開啟（系統通知被封鎖），再按一次關閉';
}

const pushOn = (): boolean => lsGet(LS_PUSH) === 'on';
/** 上次送給伺服器的推播位置；離這裡超過 PUSH_RESYNC_KM 才再送 */
let pushSyncedAt: LatLng | null = null;
const PUSH_RESYNC_KM = 0.3;

/**
 * 手機推播：訂閱（create）或確認還在，把約略位置送給伺服器。
 * 還沒有位置（預設的台北車站）不送，等 GPS 或在雷達上拖曳（手動位置）後 setOrigin 會再送。
 */
async function syncPush(create: boolean): Promise<'ok' | 'unsupported' | 'no-location' | 'failed'> {
  if (!pushSupported() || Notification.permission !== 'granted') return 'unsupported';
  if (origin.source === 'default') return 'no-location';
  const key = await fetchPushKey();
  if (!key) return 'failed';
  try {
    const sub = await pushSubscription(key, create || pushOn());
    if (!sub) return 'failed';
    const at = { lat: origin.lat, lng: origin.lng };
    const r = await savePushSubscription(sub, at);
    if (!r.ok) return 'failed';
    pushSyncedAt = at;
    return 'ok';
  } catch {
    return 'failed';
  }
}

async function stopPush(): Promise<void> {
  lsSet(LS_PUSH, 'off');
  pushSyncedAt = null;
  // 管理頁開了回報通知：同一個瀏覽器只有一個推播訂閱，不能取消，只從附近通知的名單拿掉
  if (lsGet(LS_ADMIN_PUSH) === 'on') {
    const sub = await fetchPushKey().then((key) => (key ? pushSubscription(key, false) : null)).catch(() => null);
    if (sub) await deletePushSubscription(sub.endpoint);
    return;
  }
  const endpoint = await unsubscribePush();
  if (endpoint) await deletePushSubscription(endpoint);
}

/** 通知按鈕：開著就關掉，關著就打開（第一次會問瀏覽器要通知權限，能收手機推播的也一起訂閱） */
async function toggleNotify(): Promise<void> {
  if (notifyOn()) {
    lsSet(LS_NOTIFY, 'off');
    updateNotifyBtn();
    showBanner(bannerEl, '通知已關閉，發放或活動開始時不會再響或跳通知');
    void stopPush();
    return;
  }
  unlockAudio();
  lsSet(LS_NOTIFY, 'on');
  lsSet(LS_PUSH_HINT, '1');
  const ok = await ensureNotificationPermission();
  updateNotifyBtn();
  beep(theme.sound);
  if (!ok) {
    showBanner(bannerEl, '已開啟音效提醒；系統通知未取得權限。再按一次「通知」可以關掉', 6000);
    return;
  }
  const push = await syncPush(true);
  if (push === 'ok' || push === 'no-location') lsSet(LS_PUSH, 'on');
  const msg =
    push === 'ok'
      ? '通知已開啟：附近 1 公里內開始發放、活動開始時，網頁關掉也會通知你（深夜 23:00–8:00 不通知）'
      : push === 'no-location'
        ? '通知已開啟。開 GPS 或在雷達上拖曳到你的位置後，網頁關掉也會通知你附近 1 公里內開始的發放、活動'
        : push === 'failed'
          ? '通知已開啟（網頁開著時提醒）；網頁關掉後的通知暫時開不了，晚點關掉「通知」再打開試試'
          : iosNeedsHomeScreen()
            ? '通知已開啟（網頁開著時提醒）。iPhone 要先「分享 → 加入主畫面」，從主畫面打開再開通知，網頁關掉也收得到'
            : '通知已開啟，網頁開著時發放或活動開始會提醒你。這個瀏覽器收不到網頁關掉後的通知';
  showBanner(bannerEl, msg, 8000);
}

type PanelState = 'collapsed' | 'default' | 'expanded';
const PANEL_ORDER: PanelState[] = ['collapsed', 'default', 'expanded'];
/**
 * 手機點清單上的一則：清單往下縮一段（展開 → 預設 → 收合；卡片從下面蓋住清單，雷達露出來多一點）。
 * 有縮回傳 true；已經收合、電腦版回傳 false（wirePanelDrag 接上）
 */
let shrinkPanel = (): boolean => false;
/** 手機放在清單卡片裡的詳細資料、回報收起來（只露出標題）或打開（wirePanelDrag 接上） */
let panelPeek = (_on: boolean, _of: HTMLElement): void => {};
/** 詳細資料放在下面清單那張卡片裡（手機） */
const detailInPanel = (): boolean => detailEl.parentElement === panelEl;

/**
 * 下方清單三段高度：collapsed 只留橫條與摘要、default 預設、expanded 展開。
 * 抓橫條或標題列拖拉，放開時停在最接近的一段；拉的方向明確時至少移動一段。
 * 輕點橫條：收合 → 預設 → 展開 → 預設。展開時清單捲到頂再往下滑也會往下一段。
 * 桌機版清單在側欄，不啟用。
 */
function wirePanelDrag(): void {
  const handle = $('#panel-toggle');
  const head = panelEl.querySelector('.panel-head') as HTMLElement;
  const desktop = window.matchMedia('(min-width: 900px)');
  const THRESHOLD = 30;
  let state: PanelState = 'default';
  let startY = 0;
  let startH = 0;
  let dragging = false;
  let moved = false;

  /**
   * 手機點開活動（詳細資料）、回報、回報問題直接用清單這張卡片，不另外疊一張上去（v1.684、v1.685 使用者說的）：
   * 打開時清單的內容先藏起來、卡片換成那一個（預設高度），關掉換回清單、高度和捲到哪都照打開前的。
   * 同時開著好幾個時照這個順序顯示前面的（回報問題是從活動卡片按的，關掉回到活動卡片）
   */
  const phone = window.matchMedia('(max-width: 899px)');
  const cards = [feedbackSheet, reportSheet, detailEl];
  const homes = cards.map((c) => ({ c, parent: c.parentElement as HTMLElement, next: c.nextSibling }));
  /** 現在卡片裡顯示的那一個；null 是清單 */
  let card: HTMLElement | null = null;
  let listState: PanelState = 'default';
  let listScroll = 0;

  /** 卡片收起來時露出多高：把手＋標題那一列 */
  const cardPeekPx = (): number => {
    const c = card ?? detailEl;
    const head = c.querySelector<HTMLElement>('.sheet-head');
    const headBottom = head ? head.getBoundingClientRect().bottom - c.getBoundingClientRect().top + c.scrollTop : 60;
    return Math.round(handle.offsetHeight + headBottom + 8);
  };
  const heights = (): Record<PanelState, number> => {
    const vh = window.innerHeight;
    const pad = parseFloat(getComputedStyle(panelEl).paddingBottom) || 0;
    if (card) {
      const locked = parseFloat(card.style.height) || 0;
      return {
        collapsed: cardPeekPx() + pad,
        default: Math.min(vh * 0.6, handle.offsetHeight + (locked || card.scrollHeight) + pad),
        expanded: vh * 0.8,
      };
    }
    return {
      collapsed: handle.offsetHeight + head.offsetHeight + pad + 4,
      default: vh * 0.36,
      expanded: vh * 0.8,
    };
  };

  const setState = (s: PanelState): void => {
    if (s === 'collapsed' && card) {
      card.scrollTop = 0;
      panelEl.style.setProperty('--card-peek', `${cardPeekPx()}px`);
    }
    state = s;
    panelEl.classList.toggle('expanded', s === 'expanded');
    panelEl.classList.toggle('collapsed', s === 'collapsed');
    handle.setAttribute('aria-label', s === 'collapsed' ? '展開清單' : s === 'expanded' ? '縮小清單' : '展開或收合清單');
  };
  shrinkPanel = (): boolean => {
    if (desktop.matches) return false;
    // 卡片就是清單：打開時換成詳細資料的高度，高度變好（雷達跟著變大小）才算縮放
    if (detailInPanel()) return true;
    if (state === 'collapsed') return false;
    setState(PANEL_ORDER[PANEL_ORDER.indexOf(state) - 1]);
    return true;
  };
  // 清單高度變了，地圖要重算尺寸（雷達是 SVG 會自己縮放）
  panelEl.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'max-height' && view === 'map') map.invalidate();
  });

  const syncCard = (): void => {
    const now = cards.find((c) => c.parentElement === panelEl && !c.hidden) ?? null;
    if (now === card) return;
    const was = card;
    card = now;
    panelEl.classList.toggle('card-on', !!now);
    if (!now) {
      setState(listState);
      listEl.scrollTop = listScroll;
      return;
    }
    if (!was) {
      listState = state;
      listScroll = listEl.scrollTop;
    }
    setState('default');
  };
  // 照 cards 的順序排在把手後面（styles.css 只顯示第一個開著的）
  const placeCards = (): void => {
    for (const h of [...homes].reverse()) {
      if (phone.matches) panelEl.insertBefore(h.c, handle.nextSibling);
      else h.parent.insertBefore(h.c, h.next);
      h.c.classList.remove('peek');
    }
    syncCard();
  };
  phone.addEventListener('change', placeCards);
  placeCards();
  const watch = new MutationObserver(syncCard);
  for (const c of cards) watch.observe(c, { attributes: true, attributeFilter: ['hidden'] });
  /** of：要收起來的是哪一張（卡片裡現在顯示的是別張就不動） */
  panelPeek = (on: boolean, of: HTMLElement): void => {
    syncCard();
    if (card !== of) return;
    if (on) setState('collapsed');
    else if (state === 'collapsed') setState('default');
  };

  const start = (e: PointerEvent): void => {
    if (desktop.matches || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // 卡片的標題那一列也拖得動（按鈕、連結不算）
    if (cards.includes(e.currentTarget as HTMLElement)) {
      const t = e.target instanceof Element ? e.target : null;
      if (e.currentTarget !== card || !t?.closest('.sheet-head') || t.closest('button, a, input, select, textarea, label')) return;
    }
    dragging = true;
    moved = false;
    startY = e.clientY;
    startH = panelEl.getBoundingClientRect().height;
    panelEl.style.transition = 'none';
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent): void => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 6) moved = true;
    if (!moved) return;
    const h = heights();
    panelEl.style.maxHeight = `${Math.min(h.expanded, Math.max(h.collapsed, startH - dy))}px`;
  };
  const end = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    const finalH = panelEl.getBoundingClientRect().height;
    panelEl.style.transition = '';
    panelEl.style.maxHeight = '';
    const dy = e.clientY - startY;
    if (!moved) {
      // 只有輕點橫條才切換，點標題列不切換（上面有其他按鈕）；卡片收起來時點標題打開
      if (e.currentTarget === handle) setState(state === 'collapsed' ? 'default' : state === 'default' ? 'expanded' : 'default');
      else if (e.currentTarget === card && state === 'collapsed') setState('default');
      return;
    }
    const h = heights();
    // 停在最接近的一段；方向明確但還停在原段時，往拉的方向移一段
    let target = PANEL_ORDER.reduce((best, s) => (Math.abs(h[s] - finalH) < Math.abs(h[best] - finalH) ? s : best), state);
    if (target === state && Math.abs(dy) > THRESHOLD) {
      const i = PANEL_ORDER.indexOf(state) + (dy < 0 ? 1 : -1);
      target = PANEL_ORDER[Math.max(0, Math.min(PANEL_ORDER.length - 1, i))];
    }
    setState(target);
  };
  for (const el of [handle, head, ...cards]) {
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // 清單已經捲到最上面還往下滑 → 往下一段
  let listStartY: number | null = null;
  listEl.addEventListener(
    'touchstart',
    (e) => {
      listStartY = state !== 'collapsed' && listEl.scrollTop <= 0 ? e.touches[0].clientY : null;
    },
    { passive: true },
  );
  listEl.addEventListener(
    'touchend',
    (e) => {
      if (listStartY === null) return;
      const dy = e.changedTouches[0].clientY - listStartY;
      listStartY = null;
      if (dy > 60 && listEl.scrollTop <= 0) setState(state === 'expanded' ? 'default' : 'collapsed');
    },
    { passive: true },
  );
  // 卡片（活動、回報、回報問題）也一樣：捲到最上面還往下滑 → 往下一段（以前會變成瀏覽器的重新整理）；欄位、小地圖上滑不算，標題那一列是拖曳（上面接好了）
  let cardStartY: number | null = null;
  for (const c of cards) {
    c.addEventListener(
      'touchstart',
      (e) => {
        const t = e.target instanceof Element ? e.target : null;
        cardStartY = c === card && state !== 'collapsed' && c.scrollTop <= 0 && !t?.closest('input, textarea, select, .leaflet-container, .sheet-head') ? e.touches[0].clientY : null;
      },
      { passive: true },
    );
    c.addEventListener(
      'touchend',
      (e) => {
        if (cardStartY === null) return;
        const dy = e.changedTouches[0].clientY - cardStartY;
        cardStartY = null;
        if (dy > 60 && c.scrollTop <= 0) setState(state === 'expanded' ? 'default' : 'collapsed');
      },
      { passive: true },
    );
  }
}

/**
 * 全螢幕（像 Google 地圖）：地圖、雷達鋪滿，標題列收成浮動按鈕；雷達的地圖也鋪滿整個長方形（不裁成圓、沒有外框，radar.setFill），
 * 只留地圖和光點（距離圈、掃描線不畫，看比例尺）。再按一次回到原本的樣子；瀏覽器記住開著還是關著。
 * 電腦全螢幕時「清單」收起右邊的清單（也記住）。不是瀏覽器的全螢幕（網址列不會不見，重新整理也不能自己再開）
 */
function wireFullScreen(): void {
  const fullBtn = $<HTMLButtonElement>('#full-btn');
  const listBtn = $<HTMLButtonElement>('#list-btn');
  const moreBtn = $<HTMLButtonElement>('#more-btn');
  const controls = moreBtn.parentElement as HTMLElement;
  const setMore = (open: boolean): void => {
    controls.classList.toggle('open', open);
    moreBtn.setAttribute('aria-expanded', String(open));
  };
  // 版面變了：地圖重算尺寸（雷達、清單自己會跟著）
  const relayout = (): void => {
    requestAnimationFrame(() => {
      if (view === 'map') map.invalidate();
    });
  };
  const setFull = (on: boolean, initial = false): void => {
    appEl.classList.toggle('full', on);
    // 雷達的地圖也鋪滿整個長方形（不裁成圓）；重畫（道路抓到畫面的角，範圍外的光點照真的位置畫）。剛打開網頁時之後會載入、畫第一次
    radar.setFill(on);
    if (!initial) render();
    fullBtn.setAttribute('aria-pressed', String(on));
    fullBtn.title = on ? '離開全螢幕' : '全螢幕';
    fullBtn.setAttribute('aria-label', fullBtn.title);
    setMore(false);
    relayout();
  };
  const setListOff = (off: boolean): void => {
    appEl.classList.toggle('list-off', off);
    listBtn.setAttribute('aria-pressed', String(!off));
    listBtn.title = off ? '打開清單' : '收起清單';
    relayout();
  };
  setFull(lsGet(LS_FULL) === '1', true);
  setListOff(lsGet(LS_LIST_OFF) === '1');
  fullBtn.addEventListener('click', () => {
    const on = !appEl.classList.contains('full');
    lsSet(LS_FULL, on ? '1' : null);
    setFull(on);
  });
  listBtn.addEventListener('click', () => {
    const off = !appEl.classList.contains('list-off');
    lsSet(LS_LIST_OFF, off ? '1' : null);
    setListOff(off);
  });
  moreBtn.addEventListener('click', () => setMore(!controls.classList.contains('open')));
  // 點了裡面的按鈕、點其他地方、按 Esc 就收起來
  $('#controls-more').addEventListener('click', () => setMore(false));
  document.addEventListener('pointerdown', (e) => {
    if (controls.classList.contains('open') && !controls.contains(e.target as Node)) setMore(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setMore(false);
  });
}

function wireControls(): void {
  // 按範圍按鈕：太空裡轉過的視角、換過的中心都回到你；你在汪星就回到汪星（鏡頭在汪星上就留在原地），用汪星的範圍
  for (const b of scaleChips) {
    b.addEventListener('click', () => {
      if (tripping) return;
      const st = (b.dataset.scale as ScaleSetting) ?? 'custom';
      if (!onWoof()) {
        radar.resetSpace();
        setScale(st);
      } else if (radar.spaceFocusKey === 'woof') setScale(st);
      else
        void woofHomeView().then((v) => {
          radar.setSpaceView(v);
          setScale(st);
        });
    });
  }
  viewBtn.addEventListener('click', () => switchView(view === 'radar' ? 'map' : 'radar'));
  locateBtn.addEventListener('click', locate);
  dogLockBtn.addEventListener('click', () => lockDog(dogLocked ? null : dogOffer));
  for (const b of baseChips) b.addEventListener('click', () => setBase(b.dataset.base as BaseMap));
  compassBtn.addEventListener('click', () => void toggleCompass());
  notifyBtn.addEventListener('click', () => void toggleNotify());
  themeBtn.addEventListener('click', () => {
    unlockAudio();
    openThemeSheet(themeSheet.hidden);
  });
  themeSheet.querySelector('[data-act="close"]')?.addEventListener('click', () => openThemeSheet(false));
  // 點標題重新整理，點旁邊的箭頭才切換雷達
  $('#brand-btn').addEventListener('click', () => location.reload());
  $('#module-btn').addEventListener('click', () => openModuleSheet(moduleSheet.hidden));
  moduleSheet.querySelector('[data-act="close"]')?.addEventListener('click', () => openModuleSheet(false));
  // 搜尋：打字就篩（停一下再篩，免得每個字都重畫），清除鈕、Enter 收起鍵盤
  let searchTimer = 0;
  searchInput.addEventListener('input', () => {
    searchClear.hidden = searchInput.value === '';
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => setSearch(searchInput.value), 150);
  });
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    setSearch(searchInput.value);
    searchInput.blur();
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.hidden = true;
    setSearch('');
    searchInput.focus();
  });
  // 常見關鍵字：點了搜尋（再點一次清掉）
  $('#search-tags').addEventListener('click', (e) => {
    const ty = (e.target as Element).closest<HTMLButtonElement>('[data-type]');
    if (ty) return pickType(ty.dataset.type ?? '');
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-tag]');
    if (b) searchTag(b.dataset.tag ?? '');
  });
  kwSheet.querySelector('[data-act="close"]')?.addEventListener('click', () => openKwSheet(false));
  feedbackSheet.querySelector('[data-act="close"]')?.addEventListener('click', () => {
    feedbackSheet.hidden = true;
  });
  feedbackForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitFeedback();
  });
  // 換類型、換站：地點錯誤才顯示小地圖，換站重建
  feedbackForm.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.matches('input[name="kind"], #feedback-stop')) void syncFeedbackPin();
  });
  $('#feedback-unpin').addEventListener('click', () => {
    feedbackPicker?.set(null);
    feedbackPin = null;
    feedbackFound = '';
    feedbackPinState();
  });
  $('#feedback-locate').addEventListener('click', () => void findFeedbackPlace());
  // 地點欄按 Enter 是查地點，不是送出回報
  $('#feedback-place').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    void findFeedbackPlace();
  });
  // 管理頁的入口：版本字樣連點 5 下（加入主畫面的 App 沒有網址列），存過管理 token 的直接顯示連結
  let taps: number[] = [];
  $('#app-version').addEventListener('click', () => {
    const t = Date.now();
    taps = [...taps.filter((x) => t - x < 2000), t];
    if (taps.length >= 5) location.href = 'admin.html';
  });
  $('#admin-link').hidden = !lsGet(LS_ADMIN_TOKEN);
  // 卡冊（尋找小法）：在選單裡（主題、通知旁邊），一開始就在，讓人知道可以去收集
  $('#cards-btn').addEventListener('click', () => openAlbum());
  // 道具欄：跟卡冊分開，也在選單裡（之後會有更多道具）
  $('#items-btn').addEventListener('click', () => openItems());
  // 願望（v1.636 從道具欄獨立出來）：許願、我的願望
  $('#wishes-btn').addEventListener('click', () => openWishes());
  // 收藏（v1.645 從漂流瓶畫面搬到選單）：漂流瓶收藏、我丟的瓶子
  lettersBtn.addEventListener('click', () => {
    openBottleSheet(false);
    openLettersPage(true);
  });
  // 許願有新進度（管理者審核了、上線了）：「願望」按鈕亮小紅點，收進「⋯」時「⋯」也亮；許過願的瀏覽器開網頁時問一次
  onWishNews((n) => {
    menuNews.wish = n > 0;
    paintMenuNews();
  });
  checkWishNews();
  // 換裝置搬過來了（cards.ts）：漂流瓶收藏、雷達上的瓶子（哪些是你收藏的）重新抓
  window.addEventListener('dr:transferred', () => {
    void reloadMyBottles();
    void refresh();
  });
  // 說明：使用說明（照目前的雷達）、換裝置（引繼碼）
  $('#help-btn').addEventListener('click', () => openHelp(mod.helpPage));
  // 3D 的中山公園（大家都進得來；存了管理 token 的才能標記路燈、長椅）
  $('#park3d-btn').addEventListener('click', () => {
    const token = lsGet(LS_ADMIN_TOKEN) ?? undefined;
    const btn = $<HTMLButtonElement>('#park3d-btn');
    btn.disabled = true;
    void import('./park3d')
      .then((m) =>
        m.openPark3D({
          token,
          world: radar.spaceFocused && radar.spaceFocusKey === 'woof' ? 'woof' : 'earth',
          onExit: () => (btn.disabled = false),
          onWorld: (to) => void landIn3D(to),
          onPetDog: (id) => void import('./park').then((p) => foundDog(p, id)),
        }),
      )
      .catch(() => {
        btn.disabled = false;
        showBanner(bannerEl, '3D 國館載入失敗，請再試一次');
      });
  });
  kwForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitKeyword(kwInput.value);
  });
  reportBtn.addEventListener('click', () => openReportSheet(reportSheet.hidden));
  // 只看進行中跟發放、活動、據點開關各自獨立，一起用
  activeToggle.addEventListener('click', () => {
    onlyActive = !onlyActive;
    lsSet(LS_ONLY_ACTIVE, onlyActive ? '1' : '0');
    render();
  });
  for (const b of categoryToggles) {
    b.addEventListener('click', () => {
      const cat = b.dataset.cat as Category;
      shown[cat] = !shown[cat];
      lsSet(CATEGORY_LS[cat], shown[cat] ? '1' : '0');
      render();
    });
  }
  for (const b of sortChips) b.addEventListener('click', () => setSort(b.dataset.sort === 'distance' ? 'distance' : 'time'));
  for (const b of timeChips) b.addEventListener('click', () => setTime((b.dataset.time as TimeSetting) ?? 'all'));
  timeToggle.addEventListener('click', () => {
    setTimeOpen(true);
    timeChips.find((b) => b.classList.contains('on'))?.focus();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!timeChipsEl.hidden && !(e.target instanceof Element && e.target.closest('#time-chips'))) setTimeOpen(false);
    if (!datePanel.hidden && !(e.target instanceof Element && e.target.closest('#date-panel, #date-toggle'))) setDateOpen(false);
  }, true);
  document.body.append(datePanel);
  dateToggle.addEventListener('click', () => setDateOpen(datePanel.hidden));
  window.addEventListener('resize', () => setDateOpen(false));
  /** 選好之後：電腦版不收起來，可以繼續點（v1.632 使用者說的；剛點的那顆重畫後還是有焦點）；手機選好就收起來（選單會蓋住清單） */
  const datePicked = (sel: string): void => {
    if (matchMedia('(pointer: coarse)').matches) return setDateOpen(false);
    datePanel.querySelector<HTMLButtonElement>(sel)?.focus();
  };
  datePanel.addEventListener('click', (e) => {
    const t = e.target as Element;
    const w = t.closest<HTMLButtonElement>('[data-wd]')?.dataset.wd;
    const day = t.closest<HTMLButtonElement>('[data-day]')?.dataset.day;
    if (w !== undefined) {
      // 星期幾一次選一個（v1.615 使用者說不用疊加）：點別天就換過去，再點同一個是取消；「週末」＝六、日
      const cur = dayPick && 'weekdays' in dayPick ? dayPick.weekdays : new Set<number>();
      const want = w === 'weekend' ? [0, 6] : [Number(w)];
      const same = cur.size === want.length && want.every((x) => cur.has(x));
      setDayPick(same ? null : { weekdays: new Set(want) });
      datePicked(`[data-wd="${w}"]`);
    } else if (day !== undefined) {
      // 直接點一天（再點一次同一天是取消）
      const d = Number(day);
      setDayPick(dayPick && 'date' in dayPick && dayPick.date === d ? null : { date: d });
      datePicked(`[data-day="${day}"]`);
    } else if (t.closest('[data-act="clear"]')) {
      setDayPick(null);
      datePicked('[data-act="clear"]');
    } else if (t.closest('[data-act="done"]')) setDateOpen(false);
  });
  reportSheet.querySelector('[data-act="close"]')?.addEventListener('click', () => openReportSheet(false));
  // 收起來時點標題那一條（或「回到判讀結果」）再打開
  reportSheet.addEventListener('click', (e) => {
    const t = e.target as Element;
    const peeked = reportSheet.classList.contains('peek') || (reportSheet.parentElement === panelEl && panelEl.classList.contains('collapsed'));
    if (!peeked || !t.closest('.sheet-head') || t.closest('[data-act="close"]')) return;
    setReportPeek(false);
  });
  // 回報畫面關掉（各種地方都會關）：收起的狀態、雷達上判讀結果的位置跟著拿掉，再打開時判讀結果還在就再畫
  new MutationObserver(() => {
    if (reportSheet.hidden) setReportPeek(false);
    if (reportPins.length > 0) render();
  }).observe(reportSheet, { attributes: true, attributeFilter: ['hidden'] });
  myReportsMore.addEventListener('click', () => {
    myReportsExpanded = !myReportsExpanded;
    renderMyReports();
  });
  myReportList.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button');
    if (b?.dataset.withdraw) void withdrawMine(b.dataset.withdraw);
    else if (b?.dataset.show) {
      // 回報在別的模組：先切過去再看
      const x = myReports.find((r) => String(r.eventId) === b.dataset.show);
      if (x?.module && x.module !== mod.id) switchModule(x.module as ModuleId);
      void reveal(Number(b.dataset.show), true);
    }
  });
  reportForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitReport();
  });
  bottleBtn.addEventListener('click', () => openBottleSheet(bottleSheet.hidden));
  wireTapOutside();
  wireSheetDrag();
  wireBottleScene();
  lettersPage.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-act="back"]')) openLettersPage(false);
    else void onLettersClick(e);
  });
  window.addEventListener('popstate', () => {
    if (location.hash === '#letters') openLettersPage(true);
    else if (!lettersPage.hidden) {
      lettersPushed = false;
      lettersPage.hidden = true;
      document.body.classList.remove('letters-open');
    }
  });
  if (navigator.clipboard && 'readText' in navigator.clipboard) {
    reportPaste.hidden = false;
    reportPaste.addEventListener('click', async () => {
      try {
        reportInput.value = (await navigator.clipboard.readText()).trim();
      } catch {
        reportInput.focus();
      }
    });
  }
  wirePanelDrag();
  // 手動更新、自動更新的間隔
  updatedLabel.addEventListener('click', () => {
    updatedLabel.disabled = true;
    void checkBottleNews();
    void refresh().finally(() => {
      updatedLabel.disabled = false;
      showBanner(bannerEl, '已更新', 1200);
    });
  });
  pollSelect.addEventListener('change', () => setPoll(Number(pollSelect.value)));
  setPoll(pollSec);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && nowSec() - lastFetchAt > STALE_ON_SHOW_SEC) {
      void refresh();
      void checkBottleNews();
    }
  });
}

async function boot(): Promise<void> {
  // 以前的實驗功能開關（v1.593 起漂流瓶直接開放）
  lsSet('dr.lab.bottles', null);
  wireControls();
  wireFullScreen();
  updateNotifyBtn();
  // 點手機推播的通知、網頁已經開著：選到那一則
  await registerServiceWorker((id) => void reveal(id));
  lsSet(LS_MODULE, mod.id);
  applyTheme(theme);
  applyModule();
  setBase(baseMap);
  switchView('radar');
  setTime(timeSetting);
  // 上次在汪星：先換到汪星再套範圍（太空的畫法 render 時才載入）；你在汪星但沒存看法：換到汪星的發射口
  updateScaleChips();
  if (savedWoof) radar.setSpaceView(savedWoof);
  setScale(scaleSetting);
  booted = true;
  if (youOn === 'woof')
    void woofHomeView().then((v) => {
      if (!savedWoof && radar.spaceFocusKey !== 'woof') radar.setSpaceView(v);
      updateViewBtn();
    });
  setOrigin(origin);
  startGeolocation();
  showVersion(null);
  try {
    const h = await fetchHealth();
    showVersion(h.version ?? null);
    reportsAll = h.reports !== false;
    reportModules = h.reportModules ?? null;
    applyReportsOpen();
    modeBadge.textContent = h.mode === 'mock' ? '示範資料' : h.mode === 'unconfigured' ? '未連線 Threads' : '即時';
    modeBadge.classList.toggle('mock', h.mode !== 'live');
    modeBadge.hidden = false;
  } catch {
    modeBadge.textContent = '離線';
    modeBadge.hidden = false;
  }
  await loadKeywords();
  await refresh();
  void checkBottleNews();
  if (location.hash === '#letters' && bottlesOn()) openLettersPage(true);
  // 分享到 Threads 的漂流瓶連結：?bottle=編號
  const sharedBottle = Number(new URLSearchParams(location.search).get('bottle'));
  if (sharedBottle > 0 && bottlesOn()) void openSharedBottle(sharedBottle);
  const params = new URLSearchParams(location.search);
  const openParam = params.get('open');
  if (openParam === 'theme') openThemeSheet(true);
  if (openParam === 'keywords') openKwSheet(true);
  if (openParam === 'report') openReportSheet(true);
  const shared = takeSharedLink(params);
  if (shared) {
    // 分享進來的網址用過就清掉，重新整理才不會再送一次
    history.replaceState(null, '', location.pathname);
    // 活動通、OPENTIX 的活動頁只有洋流雷達收：直接切到洋流送出；Threads 貼文先選要回報到哪個雷達
    if (/accupass\.com\/(event|go)\/|opentix\.life\/event\//i.test(shared) && !/threads\.(com|net)\//i.test(shared)) {
      switchModule('current');
      sendSharedLink(shared);
    } else {
      pendingShare = shared;
      openModuleSheet(true);
    }
  }
  const baseParam = new URLSearchParams(location.search).get('base');
  if (baseParam && (BASES as string[]).includes(baseParam)) setBase(baseParam as BaseMap);
  if (new URLSearchParams(location.search).get('view') === 'map') switchView('map');
  const scaleParam = new URLSearchParams(location.search).get('scale');
  if (scaleParam && (SCALE_SETTINGS as string[]).includes(scaleParam)) setScale(scaleParam as ScaleSetting);
  if (lsGet(LS_REPORTED)) void loadMyReports();
  // 點推播通知、分享的連結打開的：?event=123（其他雷達再帶 &module=）選到那一則、移過去；結束、下架了說一聲
  const eventParam = Number(params.get('event'));
  if (eventParam) {
    history.replaceState(null, '', location.pathname);
    void reveal(eventParam, true).then((found) => {
      if (!found) showBanner(bannerEl, '這個活動已經結束或下架了', 5000);
    });
  }
  // 開著手機推播：確認訂閱還在、更新位置（30 天沒打開，伺服器會刪掉訂閱）
  if (notifyOn() && pushOn()) void syncPush(true);
  // 之前就開了通知的人：提示一次現在網頁關掉也能收
  else if (notifyOn() && !lsGet(LS_PUSH_HINT) && pushSupported() && notificationState() === 'granted') {
    lsSet(LS_PUSH_HINT, '1');
    showBanner(bannerEl, '新功能：網頁關掉也能收到附近 1 公里的發放、活動通知。按「通知」關掉再打開一次就能啟用', 10_000);
  }
  window.setInterval(render, TICK_MS);
}

void boot();
