import './styles.css';
import { addKeyword, collectLetter, deletePushSubscription, sendFeedback, type FeedbackKind, fetchPushKey, savePushSubscription, confirmReport, editReport, locatePlace, rejectReport, supplementReport, deleteBottle, dropBottle, recycleBottle, fetchBottles, fetchEvents, fetchHealth, fetchKeywords, fetchMyBottles, fetchMyReports, fetchRoutes, pickBottle, reportBottle, reportEnded, submitLink, withdrawReport } from './api';
import { compassSupported, startCompass } from './compass';
import { bearingDeg, compassLabel, destination, formatKm, haversineKm, taiwanRadiusKm, type LatLng } from './geo';
import { inShuangbei, SHUANGBEI_RINGS, shuangbeiRadiusKm } from './shuangbei';
import { TAIWAN_RINGS } from './taiwan';
import { LANDMARKS } from './landmarks';
import { getModule, JOB_RISK_TEXT, JOB_SAFETY_TIPS, MEETUP_SAFETY_TIPS, MODULES, OFFER_SAFETY_TIPS, type ModuleDef, type ModuleId } from './modules';
import { X_MAX_WEIGHT, xLength } from './xcount';
import { shortAddress, splitPlace } from './place';
import { crowdOf, MapView, pinPicker, type BaseMap, type PinPicker } from './map';
import { beep, ensureNotificationPermission, iosNeedsHomeScreen, notificationState, pushSubscription, pushSupported, registerServiceWorker, showBanner, systemNotify, unlockAudio, unsubscribePush } from './notify';
import { Radar, type RadarRoute, type RadarStreets } from './radar';
import { DEFAULT_THEME_ID, getTheme, THEMES, type Theme } from './themes';
import type { BottleOut, EventOut, Item, KeywordInfo, KeywordRules, MyBottles, MyReport, Origin, Phase, PickedBottle, RelatedPost, RouteOut, PreviewItem, RouteStop, RoutePreview, SubmitResult, FailedItem, EditItem, EditInput } from './types';

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
const LS_ORIGIN = 'dr.origin';
/** 移動成手動位置之前的位置（「回到我的位置」還沒收到 GPS 時直接回這裡，不用等重新定位） */
const LS_HOME = 'dr.home';
const LS_THEME = 'dr.theme';
const LS_BASE = 'dr.base';
const BASES: BaseMap[] = ['nlsc', 'osm'];
const LS_KEYWORDS = 'dr.keywords';
const LS_ENDED = 'dr.endedReported';
/** 這個瀏覽器回報過貼文：開頁面時才去拿「我的回報」，沒回報過的不用多一次請求 */
const LS_REPORTED = 'dr.reported';
const LS_SPOTS = 'dr.showSpots';
const LS_GIVEAWAYS = 'dr.showGiveaways';
const LS_ACTIVITIES = 'dr.showActivities';
const LS_ONLY_ACTIVE = 'dr.onlyActive';
const LS_TIME = 'dr.timeRange';
/** 丟過瓶子（才需要去問有沒有被撿走）、看過的最後一次「被撿走」時間 */
const LS_BOTTLE_DROPPED = 'dr.bottleDropped';
const LS_BOTTLE_SEEN = 'dr.bottleSeen';
/** 開始提醒（音效、震動、橫幅、系統通知）的開關：on／off；沒設過時，瀏覽器已允許通知就算開 */
const LS_NOTIFY = 'dr.notify';
/** 手機推播（網頁關掉也收得到）開著：'on' */
const LS_PUSH = 'dr.push';
/** 之前就開了通知的人，提示過一次可以開手機推播 */
const LS_PUSH_HINT = 'dr.pushHint';
/** 管理頁（admin.html）存的：管理 token、這支手機有沒有開回報通知 */
const LS_ADMIN_TOKEN = 'dr.adminToken';
const LS_ADMIN_PUSH = 'dr.adminPush';
/** 實驗功能：漂流瓶預設不顯示，在說明頁「實驗功能」或網址 ?lab=bottles 打開（?lab=off 關掉） */
const LS_LAB_BOTTLES = 'dr.lab.bottles';
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
let selectedBottle: number | null = null;
/** 撿起來（或自己丟）的瓶子內容 */
const bottleTexts = new Map<number, PickedBottle>();
/** 漂流瓶詳細資料上的訊息（撿不到的原因、檢舉結果） */
let bottleMsg = '';
/** 最近一次讀到的「我的瓶子」：丟的、撿到的、收藏的信 */
let myBottlesData: MyBottles | null = null;
/** 這次打開網頁已經提示過「瓶子被撿走了」 */
let bottleNewsShown = false;
type ScaleSetting = '1' | '5' | '20' | 'region' | 'taiwan' | 'world' | 'custom';
/** 下方按鈕的範圍；custom 是雙指縮放或滾輪調出來的 */
const SCALE_SETTINGS: ScaleSetting[] = ['1', '5', '20', 'region', 'taiwan', 'world'];
const isAutoScale = (s: ScaleSetting): boolean => s === 'region' || s === 'taiwan' || s === 'world';
/** 「全球」的範圍：半個地球（地球另一面最遠約 20,000 km） */
const WORLD_KM = 20040;
const MIN_ZOOM_KM = 0.5;
let customKm = Number(lsGet(LS_SCALE_KM)) || 10;
let scaleSetting: ScaleSetting = ([...SCALE_SETTINGS, 'custom'] as string[]).includes(lsGet(LS_SCALE) ?? '') ? (lsGet(LS_SCALE) as ScaleSetting) : 'region';
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

// ---- 職缺（狗狗陪伴）----
interface JobExtra {
  /** hire 徵人；offer 可照顧（個人說可以幫忙照顧） */
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

// ---- 等一下吃什麼：出攤（店家發布）照時間排；網友推薦、揪團吃飯是刊登 ----
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

/** 等一下吃什麼的詳細資料：出攤寫時間、攤名、賣什麼、價位；推薦寫店名、推薦什麼、營業時間；揪團寫時間、缺幾人、怎麼報名，加上安全提醒 */
function foodDetailHtml(it: Item, now: number): string {
  const { ev } = it;
  const x = foodOf(ev);
  const role = foodRole(ev);
  const line = (k: string, v: string | null | undefined): string => (v ? `${k}：${esc(v)}<br>` : '');
  const where = `地點：${esc(placeOf(ev))}${ev.approxArea ? `<br><span class="approx-note">約略位置：只知道在${esc(ev.approxArea)}</span>` : ''}<br>距離：${ev.approxArea ? '約 ' : ''}${formatKm(it.distanceKm)}，${compassLabel(it.bearing)}方`;
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
/** 職缺的防詐提醒：這則的可疑之處，加上每則都提醒的（可照顧的是給飼主的安全提醒） */
function fraudBoxHtml(ev: { extra?: Record<string, unknown> | null }): string {
  const risks = (jobOf(ev).risks ?? []).map((r) => JOB_RISK_TEXT[r]).filter(Boolean);
  const offer = isOffer(ev);
  return `<div class="fraud-box"><b>⚠️ ${offer ? '把狗狗交給別人前' : '防詐提醒'}</b>${risks.length ? `<ul>${risks.map((r) => `<li class="risk">${esc(r)}</li>`).join('')}</ul>` : ''}<ul>${(offer ? OFFER_SAFETY_TIPS : JOB_SAFETY_TIPS).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
}
/**
 * 只看進行中：跟發放、活動、據點開關一起用，有打開的那幾類裡，只留現在就能去的
 * （進行中的發放、活動，開放中的據點，車掃中）
 */
let onlyActive = lsGet(LS_ONLY_ACTIVE) === '1';
/** 時間範圍（跟距離範圍對應）：雷達、地圖只畫這段時間內會開始的，進行中、開放中的一定畫 */
type TimeSetting = 'now' | '3h' | '24h' | '3d' | 'all';
const TIME_SEC: Record<TimeSetting, number> = { now: 0, '3h': 3 * 3600, '24h': 24 * 3600, '3d': 3 * 86400, all: Infinity };
let timeSetting: TimeSetting = (lsGet(LS_TIME) ?? '') in TIME_SEC ? (lsGet(LS_TIME) as TimeSetting) : 'all';
/** 這台裝置已經回報過「已發完」的事件 */
const endedReported = new Set<number>(loadIdList(LS_ENDED));
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
const useGpsBtn = $<HTMLButtonElement>('#use-gps');
const homeBtn = $<HTMLButtonElement>('#home-btn');
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
const pickBtn = $<HTMLButtonElement>('#pick-origin');
const viewBtn = $<HTMLButtonElement>('#view-btn');
const compassBtn = $<HTMLButtonElement>('#compass-btn');
const panelEl = $('#panel');
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
const bottleForm = $<HTMLFormElement>('#bottle-form');
const bottleText = $<HTMLTextAreaElement>('#bottle-text');
const bottleCount = $('#bottle-count');
const bottleQuota = $('#bottle-quota');
const bottleDropBtn = $<HTMLButtonElement>('#bottle-drop');
const bottleResult = $('#bottle-result');
const bottleNear = $('#bottle-near');
const bottleMine = $('#bottle-mine');
const bottleTips = $('#bottle-tips');
const lettersPage = $('#letters-page');
const lettersPicked = $('#letters-picked');
const lettersList = $('#letters-list');
const filterRow = $('#filter-row');
const categoryToggles = Array.from(document.querySelectorAll<HTMLButtonElement>('#filter-row [data-cat]'));
const activeToggle = $<HTMLButtonElement>('#active-toggle');
const onlyGroup = $('#only-group');
const timeChips = Array.from(document.querySelectorAll<HTMLButtonElement>('#time-chips [data-time]'));
const baseChipsEl = $('#base-chips');
const baseChips = Array.from(document.querySelectorAll<HTMLButtonElement>('#base-chips [data-base]'));
let baseMap: BaseMap = (BASES as string[]).includes(lsGet(LS_BASE) ?? '') ? (lsGet(LS_BASE) as BaseMap) : 'nlsc';
/** 最近一次 GPS 的誤差（公尺），手動或預設位置時為 null */
let gpsAccuracy: number | null = null;
const scaleChips = Array.from(document.querySelectorAll<HTMLButtonElement>('#scale-chips [data-scale]'));

const radar = new Radar(
  $('#radar-view'),
  select,
  (factor, done) => zoomRadar(factor, done),
  (id) => selectLandmark(id),
  (id) => selectBottle(id),
  (bearing, km, done) => panRadar(bearing, km, done),
);
const map = new MapView(
  $('#map'),
  origin,
  {
    onSelect: select,
    onBottle: (id) => selectBottle(id),
    onPickOrigin: (p) => {
      gpsAccuracy = null;
      setOrigin({ ...p, source: 'manual' });
      map.setPickMode(false);
      pickBtn.classList.remove('on');
      showBanner(bannerEl, '已設定為手動位置');
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
  if (!tz) return `${span(null)}${open}`;
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
    return isOffer(it.ev) ? `可照顧 ${period === '沒寫工作期間' ? '時間可討論' : period}` : `工作 ${period}`;
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
  const mins = Math.round((ev.startAt - now) / 60);
  // 國外的：一律寫當地日期（台灣的「今天」不一定是當地的今天）
  const tz = localTz(ev);
  if (tz) return `當地 ${fmtDateTz(ev.startAt, tz)} ${fmtTimeTz(ev.startAt, tz)} 開始 · ${startsIn(ev.startAt, now)}`;
  const day = mins < 24 * 60 ? '' : `${new Date(ev.startAt * 1000).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' })} `;
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

/** 雷達光點下方的短版：「25分」「5小時」「2天」 */
function startsInShort(startAt: number, now: number): string {
  const mins = Math.max(0, Math.round((startAt - now) / 60));
  if (mins < 60) return `${mins}分`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}小時` : `${Math.floor(h / 24)}天`;
}

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
const scopeCache = new Map<string, boolean>();

/** 在不在雷達範圍內：距離在範圍內（「全球」都算）；選「雙北」時還要在台北市或新北市裡（基隆、桃園、宜蘭不算） */
function inScope(ev: EventOut, distanceKm: number): boolean {
  if (distanceKm > scaleKm) return false;
  if (scaleSetting !== 'region') return true;
  const key = `${ev.lat},${ev.lng}`;
  let v = scopeCache.get(key);
  if (v === undefined) {
    v = inShuangbei(ev);
    scopeCache.set(key, v);
  }
  return v;
}

const outLabel = (): string => (scaleSetting === 'region' ? '雙北以外' : '雷達範圍外');

let outlineFor = '';
let radarOutline: Array<Array<{ bearing: number; distanceKm: number }>> = [];

/** 範圍比雙北大時畫的海岸線：台灣用詳細的，加上全世界的（約 30 KB，第一次用到才載入；世界資料裡的台灣只有幾個點，換掉） */
let landRings: Array<Array<[number, number]>> = TAIWAN_RINGS;
let worldLoaded = false;
let worldLoading = false;
const inTaiwanBox = (ring: Array<[number, number]>): boolean => ring.every(([lat, lng]) => lat > 21 && lat < 26.5 && lng > 118 && lng < 123);

/** 雙北的半徑（能涵蓋整個雙北）只跟位置有關，拖曳時每一幀都要用，記住上一次的 */
let sbRadius = { key: '', km: 0 };
function shuangbeiKm(): number {
  const key = `${origin.lat},${origin.lng}`;
  if (sbRadius.key !== key) sbRadius = { key, km: shuangbeiRadiusKm(origin) };
  return sbRadius.km;
}

// ---- 街道：放大到 2 km 內畫（streets.ts，OpenFreeMap 的向量圖磚，第一次用到才載入） ----
const STREET_KM = 2;
let streetsMod: typeof import('./streets') | null = null;
let streetsLoading = false;
/** 上次畫的位置、範圍、抓到第幾張圖磚，沒變就不重算 */
let streetsFor = '';
let streetTiles = 0;

/** 範圍內的街道換成相對於圓心的公里數（範圍小，用平面近似就夠準，拖曳時每一幀都要算） */
function updateStreets(): void {
  const show = scaleKm <= STREET_KM;
  $('#radar-attrib').hidden = !show;
  if (!show) {
    if (streetsFor) radar.setStreets(null);
    streetsFor = '';
    return;
  }
  if (!streetsMod) {
    if (streetsLoading) return;
    streetsLoading = true;
    void import('./streets')
      .then((m) => {
        streetsMod = m;
        updateStreets();
      })
      .finally(() => {
        streetsLoading = false;
      });
    return;
  }
  const key = `${origin.lat},${origin.lng}|${scaleKm}|${streetTiles}`;
  if (key === streetsFor) return;
  streetsFor = key;
  const reach = scaleKm * 1.05;
  const lines = streetsMod.streetsAround(origin.lat, origin.lng, reach, () => {
    streetTiles++;
    updateStreets();
  });
  const kx = 111.32 * Math.cos((origin.lat * Math.PI) / 180);
  const ky = 110.574;
  const box = [origin.lat - reach / ky, origin.lng - reach / kx, origin.lat + reach / ky, origin.lng + reach / kx];
  const out: RadarStreets = { major: [], minor: [] };
  for (const l of lines) {
    if (l.box[0] > box[2] || l.box[2] < box[0] || l.box[1] > box[3] || l.box[3] < box[1]) continue;
    const xy = new Float64Array(l.pts.length);
    for (let i = 0; i < l.pts.length; i += 2) {
      xy[i] = (l.pts[i + 1] - origin.lng) * kx;
      xy[i + 1] = (l.pts[i] - origin.lat) * ky;
    }
    out[l.cls].push(xy);
  }
  radar.setStreets(out);
}

/**
 * 「雙北」畫雙北的縣市界；範圍比雙北大（全台、全球、縮放到更遠）一律畫海岸線（台灣加上全世界），
 * 比雙北小的不畫；位置變了才重算
 */
function updateOutline(): void {
  const kind = scaleSetting === 'region' ? 'region' : scaleKm > shuangbeiKm() ? 'land' : 'none';
  if (kind === 'land' && !worldLoaded && !worldLoading) {
    worldLoading = true;
    void import('./world')
      .then((m) => {
        landRings = [...TAIWAN_RINGS, ...m.WORLD_RINGS.filter((r) => !inTaiwanBox(r))];
        worldLoaded = true;
        outlineFor = '';
        updateOutline();
      })
      .finally(() => {
        worldLoading = false;
      });
  }
  const rings = kind === 'region' ? SHUANGBEI_RINGS : kind === 'land' ? landRings : null;
  const key = rings ? `${kind}|${worldLoaded}|${origin.lat},${origin.lng}` : '';
  if (key === outlineFor) return;
  outlineFor = key;
  radarOutline = rings ? rings.map((ring) => ring.map(([lat, lng]) => ({ bearing: bearingDeg(origin, { lat, lng }), distanceKm: haversineKm(origin, { lat, lng }) }))) : [];
  radar.setOutline(radarOutline);
  map.setOutline(rings ?? []);
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
/** 回報的車掃的一站（時間是預計經過的時間，不是開始） */
const reportedStop = (ev: EventOut): RouteStop | undefined => {
  const r = routeOf(ev);
  return r && isReported(r) ? stopOf(ev) : undefined;
};
const stopLabel = (r: RouteOut, kind: RouteStop['kind']): string => ({ start: '出發', cheer: isReported(r) ? '應援點' : '加油點', end: '抵達' })[kind];

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
  const label = (r: RelatedPost): string => (r.source === 'news' ? '新聞' : 'Threads');
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
/** 搜尋比對用：小寫、去空白、臺台不分 */
const foldText = (s: string): string => s.toLowerCase().replace(/\s+/g, '').replace(/臺/g, '台');
/** 每一則可以搜尋的文字（標題、地點、物品、帳號、關鍵字、原文摘錄、補充、類型、車掃名稱）；事件重抓才會換物件，跟著物件記 */
const searchText = new WeakMap<EventOut, string>();
function searchable(it: Item): string {
  let t = searchText.get(it.ev);
  if (t === undefined) {
    const ev = it.ev;
    t = foldText(
      [ev.title, titleOf(ev), ev.item, ev.placeText, ev.approxArea, ev.keyword, ev.post.username, ev.post.text, ev.post.supplement, kindLabel(ev), it.spot ? '固定據點' : '', routeOf(ev)?.title]
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
  const now = nowSec();
  const fetched = computeItems(now);
  // 搜尋時雷達、地圖、清單、各類的數量都只算符合的
  const all = searchTerms.length > 0 ? fetched.filter(matchesSearch) : fetched;
  // 發放、活動、據點的開關是洋流的，其他模組不篩
  const byCategory = mod.current ? all.filter((it) => shown[categoryOf(it)]) : all;
  const items = onlyActive && mod.current ? byCategory.filter((it) => activeNow(it, now)) : byCategory;
  // 雷達、地圖只畫時間範圍內的；清單照樣全部列，範圍外的放最下面
  const timed = items.filter((it) => inTime(it, now));
  // 雷達、地圖上畫的：車掃還沒出發的只畫起點（點開的那條整條畫）
  const focused = focusedRoute(items);
  const drawn = timed.filter((it) => !beforeDeparture(it, now, focused));
  updateOutline();
  updateStreets();
  updateCategoryToggles(all);
  updateActiveToggle(byCategory, now);

  // 稍後才開始的也畫（虛線框、淡色）；「雙北」時雙北以外的也畫，跟超出範圍的一樣畫小、畫淡
  radar.render(
    drawn.map((it) => ({
      id: it.ev.id,
      kind: it.ev.kind,
      spot: !!it.spot,
      office: !!it.spot && isOffice(it.ev),
      approx: !!it.ev.approxArea,
      outside: !inScope(it.ev, it.distanceKm),
      distanceKm: it.distanceKm,
      bearing: it.bearing,
      // 還沒出發的官方車掃路線點用「即將開始」的淡色畫；還沒開的據點跟休息中的一樣淡；其他稍後開始的（回報的車掃的站也是）畫虛線框
      phase: it.phase === 'later' ? (it.spot ? 'closed' : routeOf(it.ev) && !reportedStop(it.ev) ? 'soon' : 'later') : it.phase,
      label: titleOf(it.ev),
      // 名稱只在選取時顯示，光點一多標題會蓋成一片
      showLabel: it.ev.id === selectedId,
      selected: it.ev.id === selectedId,
      // 稍後開始的越久越淡；還沒開始的都在光點下寫還有多久
      // 回報的車掃：寫還有多久經過（不是前 10 分鐘的開始）
      ...(isUpcoming(it) ? { badge: startsInShort(reportedStop(it.ev)?.at ?? it.ev.startAt, now), ...(it.phase === 'later' ? { fade: clarityOf(it.ev, now) } : {}) } : {}),
    })),
    drawnRoutes(timed, now, focused).map((r) => ({
      id: r.id,
      state: routeState(r, now),
      points: r.segments.flatMap((sg) => sg.path).map(([lat, lng]) => ({ bearing: bearingDeg(origin, { lat, lng }), distanceKm: haversineKm(origin, { lat, lng }) })),
    })),
  );
  // 撿走的瓶子不畫（伺服器也不會回傳，這裡再擋一次）
  const bottleViews = bottles.filter((b) => !b.picked).map((b) => ({ b, distanceKm: haversineKm(origin, b), bearing: bearingDeg(origin, b), state: bottleState(b) }));
  const hint = nearestHint(bottleViews);
  radar.setBottles(
    bottleViews.map((v) => ({
      id: v.b.id,
      bearing: v.bearing,
      distanceKm: v.distanceKm,
      state: v.state,
      mine: v.b.mine,
      picked: v.b.picked,
      selected: v.b.id === selectedBottle,
      hint: v === hint ? formatKm(v.distanceKm) : undefined,
    })),
  );
  map.setBottles(bottleViews.map((v) => ({ id: v.b.id, lat: v.b.lat, lng: v.b.lng, state: v.state, mine: v.b.mine, picked: v.b.picked })));
  updateBottleBadge(bottleViews);
  radar.setLandmarks(
    (mod.current ? LANDMARKS : []).map((lm) => ({ id: lm.id, label: lm.name, bearing: bearingDeg(origin, lm), distanceKm: haversineKm(origin, lm), selected: lm.id === selectedLandmark })),
  );
  map.setRoutes(
    drawnRoutes(timed, now, focused).map((r) => ({
      id: r.id,
      title: r.title,
      state: routeState(r, now),
      claimUrl: r.claimUrl,
      source: r.source,
      // 回報的車掃：已經經過的那段畫淡
      segments: r.segments.map((sg) => ({ ...sg, passed: !!sg.toAt && sg.toAt <= now })),
    })),
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
      subtitle: `${placeLine(it.ev)} · ${timeLine(it, now)}`,
      selected: it.ev.id === selectedId,
      ...(isUpcoming(it) && it.phase === 'later' ? { fade: clarityOf(it.ev, now) } : {}),
    })),
  );
  renderList(items, now);
  renderDetail(items, now);

  // 新變成進行中且在雷達範圍內的事件 → 嗶聲、震動、通知。第一次載入不吵。搜尋只影響畫面，通知照樣看全部
  const notifyPool = searchTerms.length > 0 ? fetched.filter((it) => shown[categoryOf(it)] && (!onlyActive || activeNow(it, now))) : items;
  for (const it of notifyPool) {
    if (it.phase !== 'active') continue;
    const seenKey = it.spot ? `spot:${it.spot.key}` : `ev:${it.ev.id}`;
    if (seenActive.has(seenKey)) continue;
    seenActive.add(seenKey);
    // 整天的沒有「開始」的時間點，不然半夜 12 點會一起響；固定據點每天都開，不主動提醒
    if (!notifiedOnce || !notifyOn() || !inScope(it.ev, it.distanceKm) || it.ev.allDay || it.spot) continue;
    beep(theme.sound);
    try {
      navigator.vibrate?.([120, 80, 160]);
    } catch {
      /* ignore */
    }
    const msg = `${titleOf(it.ev)}｜${it.ev.placeText}｜${formatKm(it.distanceKm)} ${compassLabel(it.bearing)}`;
    const head =
      it.ev.kind === 'food'
        ? ({ vendor: '附近的攤位出攤了', recommend: '附近有網友推薦的店', meetup: '附近有人揪吃飯' }[foodRole(it.ev) ?? 'recommend'] ?? '等一下吃什麼')
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
              ? '活動開始'
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
  if (!onlyGroup.hidden) filterRow.hidden = false;
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
  filterRow.hidden = !mod.current || categoryToggles.every((b) => b.hidden);
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
      rows.push({ it, phase: it.phase, distanceKm: it.distanceKm, inScope: inScope(it.ev, it.distanceKm), inTime: inTime(it, now), spot: !!it.spot, sortAt: it.ev.startAt });
      continue;
    }
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const members = routeItems(r, items);
    rows.push({ route: r, phase: routePhase(r, members, now), distanceKm: Math.min(...members.map((m) => m.distanceKm)), inScope: members.some((m) => inScope(m.ev, m.distanceKm)), inTime: members.some((m) => inTime(m, now)), spot: false, sortAt: r.departAt ?? it.ev.startAt });
  }
  return rows;
}

const PHASE_TITLE: Partial<Record<Phase, string>> = { active: '進行中', soon: '即將開始', later: '稍後開始' };

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
  const byPhase = (ph: Phase): Row[] =>
    singles
      .filter((r) => r.phase === ph)
      // 進行中照距離，還沒開始的照開始時間
      .sort((a, b) => (ph === 'active' ? a.distanceKm - b.distanceKm : a.sortAt - b.sortAt || a.distanceKm - b.distanceKm));
  const sections: Array<{ title: string; rows: Row[] }> = [
    // 職缺從刊登起都算「徵才中」
    ...(['active', 'soon', 'later'] as const).map((ph) => ({ title: !mod.current && ph === 'active' ? '刊登中' : (PHASE_TITLE[ph] as string), rows: byPhase(ph) })),
    { title: SPOT_SECTION[mod.id] ?? '固定據點', rows: spotsIn },
    ...Object.entries(POSTING_SECTION).map(([role, title]) => ({ title, rows: postingRows.get(role) ?? [] })),
    { title: laterLabel(), rows: laterRows },
    { title: outLabel(), rows: outRange },
  ];
  const counts = { active: byPhase('active').length, soon: byPhase('soon').length, later: byPhase('later').length };
  const none = mod.current && followed().length === 0;
  const outText = outRange.length > 0 ? `・${scaleSetting === 'region' ? '雙北以外' : '範圍外'} ${outRange.length} 個` : '';
  const spotText = spotsIn.length > 0 ? `・據點 ${spotsIn.length} 個` : '';
  const laterText = laterRows.length > 0 ? `・${timeSetting === 'now' ? '還沒開始' : laterLabel().replace('才開始', '')} ${laterRows.length} 個` : '';
  const searching = searchTerms.length > 0 ? `搜尋「${searchInput.value.trim()}」・` : '';
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
      : none
        ? '目前沒有搜尋中的關鍵字。'
        : `${emptyText()}。點清單上方的「↻ 更新」看有沒有新的，或在旁邊打開自動更新。`;
  listEl.replaceChildren();
  emptyEl.hidden = items.length > 0;
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
  li.className = `ev phase-${it.phase} kind-${it.ev.kind}${it.spot ? ' spot' : ''}${it.spot && isOffice(it.ev) ? ' office' : ''}${inScope(it.ev, it.distanceKm) ? '' : ' out-of-range'}${it.ev.id === selectedId ? ' selected' : ''}`;
  li.dataset.id = String(it.ev.id);
  li.innerHTML = `
    <div class="ev-title"><span class="dot"></span><span class="kind-tag">${tagLabel(it)}</span>${esc(titleOf(it.ev))}${it.ev.item ? ` <span class="muted">· ${esc(it.ev.item)}</span>` : ''}${it.ev.kind === 'job' && jobRisky(it.ev) ? '<span class="risk-tag">⚠️ 注意</span>' : ''}${followed().length > 1 && it.ev.keyword ? `<span class="ev-kw">#${esc(it.ev.keyword)}</span>` : ''}</div>
    <div class="ev-meta">${esc(placeLine(it.ev))} · ${it.ev.approxArea ? '約 ' : ''}${formatKm(it.distanceKm)} ${compassLabel(it.bearing)}</div>
    <div class="ev-time">${it.spot ? `${esc(spotHours(it.spot.sessions))}・` : ''}${timeLineHtml(it, now)}</div>`;
  li.addEventListener('click', () => select(it.ev.id));
  return li;
}

function routeCard(r: RouteOut, phase: Phase, items: Item[], now: number): HTMLLIElement {
  const mine = routeItems(r, items);
  const nearest = [...mine].sort((a, b) => a.distanceKm - b.distanceKm)[0];
  const start = r.stops.find((s) => s.kind === 'start');
  const end = r.stops.find((s) => s.kind === 'end');
  const li = document.createElement('li');
  li.className = `ev route-card phase-${phase} kind-activity${mine.some((m) => inScope(m.ev, m.distanceKm)) ? '' : ' out-of-range'}${selectedRoute === r.id ? ' selected' : ''}`;
  li.innerHTML = `
    <div class="ev-title"><span class="dot"></span><span class="kind-tag">車掃</span>${esc(r.title)} <span class="muted">· ${r.stops.length} 站</span></div>
    <div class="ev-meta">${esc(start?.name ?? '')} → ${esc(end?.name ?? '')}${isReported(r) ? '' : ` · 全長 ${routeKm(r).toFixed(1)} km`}${nearest ? ` · ${isReported(r) ? '離你最近' : '最近'} ${formatKm(nearest.distanceKm)}` : ''}</div>
    <div class="ev-time">${esc(routeTimeLine(r, items, now))}</div>`;
  li.addEventListener('click', () => selectRoute(r.id));
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
  const rows = r.stops
    .map((st) => {
      const it = mine.find((x) => (isReported(r) ? stopMatches(st, x.ev) : x.ev.title === st.title));
      const time = st.at ? `${st.kind === 'cheer' || (isReported(r) && st.kind === 'end') ? '約 ' : ''}${fmtTime(st.at)}` : '—';
      const passed = st.at !== null && st.at <= now && st.kind !== 'end';
      // 終點接著有活動（例如市政開講）就附上活動時間
      const extra = st.kind === 'end' && it && !isReported(r) && !it.ev.allDay && !it.ev.title.includes('抵達') ? `<small>${esc(it.ev.title.split('・')[0])} ${fmtTime(it.ev.startAt)}–${fmtTime(it.ev.endAt)}</small>` : '';
      const near = it && it === nearestStop ? '・離你最近' : '';
      // 回報的車掃：沒放上雷達的站講原因（經過了不用講）
      const why = !it && isReported(r) && !passed ? `<small>${st.lat === null ? '沒有確切位置，不在雷達上' : '不在雷達上'}</small>` : '';
      const dist = it ? `<small>${formatKm(it.distanceKm)} ${compassLabel(it.bearing)}${near}</small>` : why;
      // 回報的人地點填地址的：站名下面另外列地址
      const place = st.place ? `<small class="stop-place">${esc(shortAddress(st.place))}</small>` : '';
      const body = `<span class="stop-time">${time}</span><span class="stop-name"><b>${stopLabel(r, st.kind)}</b>${esc(st.name)}${place}${extra}${dist}</span>`;
      return `<li class="stop stop-${st.kind}${passed ? ' passed' : ''}${near ? ' nearest' : ''}">${it ? `<button type="button" data-select="${it.ev.id}">${body}</button>` : `<div>${body}</div>`}</li>`;
    })
    .join('');
  detailEl.hidden = false;
  setDetailHtml(`route:${r.id}`, `
    <div class="sheet-head">
      <strong>${esc(r.title)}</strong>
      <button type="button" class="chip" data-act="close" aria-label="關閉">關閉</button>
    </div>
    <div class="sheet-body">
      ${
        isReported(r)
          ? `<p>${esc(routeTimeLine(r, items, now))}<br><span class="muted">${r.departAt ? `${dateFmt.format(new Date(r.departAt * 1000))}・` : ''}共 ${r.stops.length} 站</span></p>`
          : `<p>${esc(routeTimeLine(r, items, now))}<br><span class="muted">全長 ${routeKm(r).toFixed(1)} km・沿線認領 ${people.toLocaleString()} / 目標 ${target.toLocaleString()} 人${needy > 0 ? `・還有 ${needy} 段缺人` : ''}（${fmtTime(r.updatedAt)} 更新）</span></p>`
      }
      <ol class="route-stops">${rows}</ol>
      ${planned ? '<p class="muted sheet-note">還沒出發：平常雷達和地圖上只顯示起點，點開這個車掃時才畫出整條路線，出發後一直顯示。</p>' : ''}
      <p class="muted sheet-note">${
        isReported(r)
          ? '時間是貼文寫的預計時間，僅供參考，以現場為準。雷達上每一站從預計經過前 10 分鐘顯示到經過後 15 分鐘；地圖上各站用直線連起來，不是實際走的路。'
          : '加油點的時間是用路線長度平均推算的，實際以現場為準。官方提醒：不跟車，在沿線等車隊經過；不放鞭炮。'
      }</p>
      ${isReported(r) && mine[0]?.ev.post.permalink ? `<p class="muted sheet-note">來源：<a href="${esc(mine[0].ev.post.permalink)}" target="_blank" rel="noopener">${esc(mine[0].ev.post.username ? `@${mine[0].ev.post.username} 的貼文` : '原貼文')}</a></p>` : ''}
      ${relatedHtml(routeRelated(r, items))}
      <div class="sheet-actions">
        ${r.claimUrl ? `<a class="btn primary" href="${esc(r.claimUrl)}" target="_blank" rel="noopener">到車掃地圖認領路段</a>` : ''}
        <button type="button" class="btn" data-act="route-map">在地圖上看路線</button>
      </div>
    </div>`);
  detailEl.querySelector('[data-act="close"]')?.addEventListener('click', () => selectRoute(null));
  for (const b of detailEl.querySelectorAll<HTMLButtonElement>('[data-select]')) {
    b.addEventListener('click', () => select(Number(b.dataset.select)));
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
        <a class="btn" href="${esc(lm.url)}" target="_blank" rel="noopener">${esc(lm.urlName)}</a>
        <a class="btn" href="${googleMapsUrl(lm)}" target="_blank" rel="noopener">在 Google 地圖上看</a>
      </div>
    </div>`);
  detailEl.querySelector('[data-act="close"]')?.addEventListener('click', () => selectLandmark(null));
  return true;
}

// ---- 漂流瓶 ----
/** 200 m 內看得到瓶子的樣子，更遠只是一團訊號 */
const BOTTLE_NEAR_M = 200;
/** 伺服器沒關、而且這個瀏覽器打開了實驗功能 */
const bottlesOn = (): boolean => mod.current && keywordRules?.sources?.bottles?.enabled !== false && lsGet(LS_LAB_BOTTLES) === '1';
const pickRadiusM = (): number => keywordRules?.sources?.bottles?.pickRadiusM ?? 60;
const bottleDistM = (b: BottleOut): number => haversineKm(origin, b) * 1000;

/** 用 GPS 定位而且走到撿得起來的距離才算 pick；手動位置不能撿 */
function bottleState(b: BottleOut): 'far' | 'near' | 'pick' {
  const d = bottleDistM(b);
  if (origin.source === 'gps' && d <= pickRadiusM()) return 'pick';
  return d <= BOTTLE_NEAR_M ? 'near' : 'far';
}

/** 方向提示最遠指到多遠的瓶子 */
const BOTTLE_HINT_MAX_KM = 50;

/** 雷達範圍內沒有別人的瓶子時，最近的那一個（貼在外圈指方向）；太遠就不指 */
function nearestHint<V extends { b: BottleOut; distanceKm: number }>(views: V[]): V | null {
  const others = views.filter((v) => !v.b.mine);
  if (others.some((v) => v.distanceKm <= scaleKm)) return null;
  const best = others.reduce<V | null>((a, v) => (!a || v.distanceKm < a.distanceKm ? v : a), null);
  return best && best.distanceKm <= BOTTLE_HINT_MAX_KM ? best : null;
}

/** 按鈕上的數字：雷達範圍內還沒撿過、不是自己丟的瓶子 */
function updateBottleBadge(views: Array<{ b: BottleOut; distanceKm: number; state: string }>): void {
  bottleBtn.hidden = !bottlesOn();
  const n = views.filter((v) => !v.b.mine && !v.b.picked && v.distanceKm <= scaleKm).length;
  const canPick = views.some((v) => v.state === 'pick' && !v.b.mine && !v.b.picked);
  bottleBadge.hidden = n === 0;
  bottleBadge.textContent = String(n);
  bottleBtn.classList.toggle('glow', canPick);
}

const dayFmt = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' });
const fmtDay = (unix: number): string => dayFmt.format(new Date(unix * 1000));
/** 漂了多遠：50 m 以內算沒漂 */
const driftText = (m: number): string => (m >= 50 ? formatKm(m / 1000) : '');

const daysLeft = (until: number): string => {
  const d = Math.ceil((until - nowSec()) / 86400);
  return d <= 1 ? '今天' : `${d} 天`;
};

function ago(unix: number): string {
  const m = Math.max(0, Math.round((nowSec() - unix) / 60));
  if (m < 60) return m <= 1 ? '剛剛' : `${m} 分鐘前`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} 小時前`;
  return `${Math.floor(m / 1440)} 天前`;
}

function selectBottle(id: number | null): void {
  selectedBottle = selectedBottle === id ? null : id;
  bottleMsg = '';
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
    // 自己丟的、撿過的直接讀內容
    const b = bottles.find((x) => x.id === selectedBottle);
    if (b && (b.mine || b.picked) && !bottleTexts.has(b.id)) void loadBottle(b.id, null);
  }
  render();
}

async function loadBottle(id: number, at: Origin | null): Promise<void> {
  const r = await pickBottle(id, at);
  if (!r.ok) {
    bottleMsg = r.message;
    // 被別人撿走了：雷達上也拿掉
    if (/撿走|漂走/.test(r.message)) bottles = bottles.filter((b) => b.id !== id || b.mine);
  } else {
    bottleTexts.set(id, r.data);
    // 撿走的瓶子從雷達上消失（內容留在詳細資料和「我撿到的」）；自己丟的照樣留著
    const fresh = !r.data.bottle.mine && bottles.some((b) => b.id === id && !b.picked);
    bottles = bottles.filter((b) => b.id !== id || b.mine);
    bottleMsg = '';
    if (fresh) showBanner(bannerEl, '撿到瓶子了！喜歡這封信可以收藏，回收瓶子就能多丟一個', 3500);
  }
  render();
}

/** 雷達或地圖上點了瓶子：距離、撿起來、內容、檢舉或收回 */
function renderBottleDetail(id: number): boolean {
  const got = bottleTexts.get(id);
  // 撿走後雷達上已經沒有這個瓶子，詳細資料用撿到時拿到的資料
  const b = bottles.find((x) => x.id === id) ?? got?.bottle;
  if (!b) return false;
  const d = bottleDistM(b);
  const reach = pickRadiusM();
  const where = `約 ${formatKm(d / 1000)} ${compassLabel(bearingDeg(origin, b))}`;
  let body: string;
  if (got) {
    body = `<blockquote class="bottle-note">${esc(got.text)}</blockquote>
      <p class="muted">${b.mine ? `你${ago(b.createdAt)}丟的・還沒被撿走・${daysLeft(b.expiresAt)}後漂走` : `${ago(b.createdAt)}丟的・你撿到了，雷達上不會再出現。撿到的瓶子都在「瓶中信收藏」`}</p>`;
  } else if (b.mine || b.picked) {
    body = '<p class="muted">打開瓶子中…</p>';
  } else if (origin.source !== 'gps') {
    body = `<p>瓶子在${esc(where)}。按右上角「定位」用 GPS，走到 ${reach} m 內就能撿起來。</p>`;
  } else if (d > reach) {
    body = `<p>瓶子在${esc(where)}，還差約 ${Math.round(d - reach)} m。走近一點就能撿起來，越近雷達上越清楚。</p>`;
  } else {
    body = '<p>瓶子就在你旁邊！</p>';
  }
  const canPick = !got && !b.mine && !b.picked && origin.source === 'gps' && d <= reach;
  detailEl.hidden = false;
  setDetailHtml(`bottle:${id}`, `
    <div class="sheet-head">
      <strong>${b.mine ? '你丟的漂流瓶' : '漂流瓶'}</strong>
      <button type="button" class="chip" data-act="close" aria-label="關閉">關閉</button>
    </div>
    <div class="sheet-body">
      ${body}
      ${bottleMsg ? `<p class="msg error">${esc(bottleMsg)}</p>` : ''}
      <div class="sheet-actions">
        ${canPick ? '<button type="button" class="btn primary" data-act="pick">撿起來</button>' : ''}
        ${!got && !b.mine && !canPick ? `<a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}&travelmode=walking" target="_blank" rel="noopener">走過去</a>` : ''}
        ${got && !b.mine ? `<button type="button" class="btn primary" data-act="collect">${isCollected(id) ? '已收藏' : '收藏這封信'}</button><button type="button" class="btn" data-act="recycle">回收瓶子</button><button type="button" class="btn" data-act="report">檢舉</button>` : ''}
        ${b.mine ? '<button type="button" class="btn" data-act="delete">收回</button>' : ''}
      </div>
      <p class="muted sheet-note small">瓶子的位置在丟的時候就隨機漂開約 100 m，之後還會順著洋流漂，不是丟的人站的地方。</p>
    </div>`);
  detailEl.querySelector('[data-act="close"]')?.addEventListener('click', () => selectBottle(null));
  detailEl.querySelector('[data-act="pick"]')?.addEventListener('click', (e) => {
    (e.currentTarget as HTMLButtonElement).disabled = true;
    void loadBottle(id, origin);
  });
  detailEl.querySelector('[data-act="collect"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    if (await toggleCollect(id, !isCollected(id))) render();
    else btn.disabled = false;
  });
  detailEl.querySelector('[data-act="recycle"]')?.addEventListener('click', async (e) => {
    if (!(await recycle(id))) return;
    (e.currentTarget as HTMLButtonElement | null)?.setAttribute('disabled', '');
    selectedBottle = null;
    render();
  });
  detailEl.querySelector('[data-act="report"]')?.addEventListener('click', async (e) => {
    if (!window.confirm('這個瓶子有攻擊性內容、廣告或個人資料？檢舉後會交給管理者確認。')) return;
    (e.currentTarget as HTMLButtonElement).disabled = true;
    const r = await reportBottle(id);
    if (!r.ok) {
      bottleMsg = r.message;
    } else {
      showBanner(bannerEl, '謝謝檢舉，這個瓶子已經藏起來，會交給管理者確認', 3000);
      if (r.data.hidden) {
        bottles = bottles.filter((x) => x.id !== id);
        selectedBottle = null;
      }
    }
    render();
  });
  detailEl.querySelector('[data-act="delete"]')?.addEventListener('click', async (e) => {
    if (!window.confirm('要收回這個瓶子嗎？收回後就沒有人撿得到了。')) return;
    (e.currentTarget as HTMLButtonElement).disabled = true;
    const r = await deleteBottle(id);
    if (!r.ok) {
      bottleMsg = r.message;
    } else {
      bottles = bottles.filter((x) => x.id !== id);
      selectedBottle = null;
      showBanner(bannerEl, '瓶子收回了', 2000);
    }
    render();
  });
  return true;
}

const isCollected = (id: number): boolean => !!myBottlesData?.letters.some((l) => l.id === id);

/** 收藏或移出收藏。成功回傳 true */
async function toggleCollect(id: number, on: boolean): Promise<boolean> {
  const inPicked = !!myBottlesData?.picked.some((p) => p.id === id) || bottleTexts.has(id);
  if (!on && !inPicked && !window.confirm('這個瓶子已經回收了，移出收藏後就看不到這封信了。要移出嗎？')) return false;
  const r = await collectLetter(id, on);
  if (!r.ok) {
    showBanner(bannerEl, r.message, 3000);
    return false;
  }
  showBanner(bannerEl, on ? '收藏好了！在「瓶中信收藏」可以看到' : '移出收藏了', 2500);
  await reloadMyBottles();
  return true;
}

/** 回收撿到的瓶子：今天多一個額度；沒收藏的信就看不到了。成功回傳 true */
async function recycle(id: number): Promise<boolean> {
  const ask = isCollected(id)
    ? '回收瓶子，今天可以多丟一個；信還留在收藏裡。要回收嗎？'
    : '回收後就看不到這封信了（想留著可以先按「收藏」）。今天可以多丟一個，要回收嗎？';
  if (!window.confirm(ask)) return false;
  const r = await recycleBottle(id);
  if (!r.ok) {
    showBanner(bannerEl, r.message, 3000);
    return false;
  }
  bottleTexts.delete(id);
  showBanner(bannerEl, `回收了！今天還能丟 ${r.data.quota.left} 個`, 3000);
  await reloadMyBottles();
  if (!bottleSheet.hidden) renderBottleSheet();
  return true;
}

/** 重新讀「我的瓶子」，畫在打開中的漂流瓶面板和收藏頁 */
async function reloadMyBottles(): Promise<void> {
  const r = await fetchMyBottles();
  if (!r.ok) return;
  myBottlesData = r.data;
  if (r.data.dropped.length > 0) lsSet(LS_BOTTLE_DROPPED, '1');
  if (!bottleSheet.hidden) paintMyBottles();
  if (!lettersPage.hidden) renderLettersPage();
  updateBottleNews();
}

/** 自己丟的瓶子有沒有新被撿走的（上次看「我丟的瓶子」之後） */
function newlyPicked(): number {
  const seen = Number(lsGet(LS_BOTTLE_SEEN) ?? 0);
  return myBottlesData?.dropped.filter((b) => b.pickedAt !== null && b.pickedAt > seen).length ?? 0;
}

/** 按鈕上的小紅點；這次打開網頁第一次發現時跳一次提示 */
function updateBottleNews(): void {
  const n = newlyPicked();
  bottleBtn.classList.toggle('news', n > 0);
  if (n > 0 && !bottleNewsShown && bottleSheet.hidden) {
    bottleNewsShown = true;
    showBanner(bannerEl, `你丟的瓶子${n > 1 ? `有 ${n} 個` : ''}被撿走了！打開「漂流瓶」看看`, 4000);
  }
}

/** 丟過瓶子才去問（打開網頁、回到網頁時） */
async function checkBottleNews(): Promise<void> {
  if (!bottlesOn() || !lsGet(LS_BOTTLE_DROPPED)) return;
  await reloadMyBottles();
}

function openBottleSheet(open: boolean): void {
  bottleSheet.hidden = !open;
  if (!open) return;
  themeSheet.hidden = true;
  kwSheet.hidden = true;
  reportSheet.hidden = true;
  selectedId = null;
  selectedRoute = null;
  selectedLandmark = null;
  selectedBottle = null;
  detailEl.hidden = true;
  renderBottleSheet();
  if (myBottlesData) paintMyBottles();
  void reloadMyBottles();
}

const bottleMaxWeight = (): number => keywordRules?.sources?.bottles?.maxWeight ?? X_MAX_WEIGHT;

/** 字數（比照 X：中文算 2、英數算 1）；超過回傳 true */
function updateBottleCount(): boolean {
  const max = bottleMaxWeight();
  const n = xLength(bottleText.value.trim());
  bottleCount.textContent = `${n} / ${max}`;
  bottleCount.classList.toggle('over', n > max);
  return n > max;
}

/** 丟瓶子的表單（要 GPS）、附近的瓶子、使用規則 */
function renderBottleSheet(): void {
  const rules = keywordRules?.sources?.bottles;
  bottleText.maxLength = bottleMaxWeight();
  const over = updateBottleCount();
  const gps = origin.source === 'gps';
  bottleDropBtn.disabled = !gps || over;
  bottleDropBtn.textContent = gps ? '丟出去' : '要先定位';
  bottleTips.innerHTML = [
    `字數比照 X：中文、全形字、表情符號算 2，英數算 1，最多 ${bottleMaxWeight()}（中文 ${bottleMaxWeight() / 2} 字）。`,
    '打氣、心情、抱怨、今天看到的事都可以。辱罵或攻擊任何人（包括其他候選人、政黨）、謠言、廣告、連結、電話、帳號、個人資料都不會通過，丟出去前會先自動審核。',
    `瓶子會丟在你目前 GPS 位置附近，隨機漂開約 100 m。沒人撿的話，每 ${rules?.driftHours ?? 3} 小時會順著洋流往附近熱鬧的地方（發放、活動、據點、洋流總部）漂一段，${rules?.ttlDays ?? 7} 天後漂走。`,
    `每天可以丟 ${rules?.perDay ?? 3} 個。撿到的瓶子在「瓶中信收藏」：喜歡的信可以收藏，回收瓶子就多一個額度；兩個都可以做。`,
    `別人要走到 ${rules?.pickRadiusM ?? 60} m 內才撿得起來；遠的瓶子在雷達上只是一團模糊的訊號，走近才變清楚。每個瓶子只能被一個人撿走，撿走就從雷達上消失。`,
    '撿到不適合的內容可以檢舉，檢舉後就藏起來交給管理者確認。不用登入：你丟的、撿到的瓶子記在這個瀏覽器裡，清除瀏覽器資料就看不到了。',
  ]
    .map((t) => `<li>${esc(t)}</li>`)
    .join('');
  const near = bottles
    .filter((b) => !b.mine && !b.picked)
    .map((b) => ({ b, d: bottleDistM(b) }))
    .sort((a, c) => a.d - c.d)
    .slice(0, 8);
  bottleNear.innerHTML = near.length
    ? `<h3 class="spot-mine-title">附近的瓶子</h3><ul class="report-events">${near
        .map(({ b, d }) => {
          const st = bottleState(b) === 'pick' ? '撿得到了！' : `還差約 ${formatKm(Math.max(0, d - pickRadiusM()) / 1000)}`;
          return `<li><button type="button" data-bottle="${b.id}"><b>漂流瓶・約 ${esc(formatKm(d / 1000))} ${esc(compassLabel(bearingDeg(origin, b)))}</b><small>${esc(st)}・${ago(b.createdAt)}丟的</small></button></li>`;
        })
        .join('')}</ul>`
    : '<p class="muted sheet-note">還沒有別人的瓶子，丟第一個吧！</p>';
}

/** 漂流瓶面板裡的額度、我丟的瓶子、收藏頁入口 */
function paintMyBottles(): void {
  const data = myBottlesData;
  if (!data) return;
  const { dropped, picked, letters, quota } = data;
  bottleQuota.textContent = `・今天還能丟 ${quota.left} 個${quota.bonus > 0 ? `（回收 ${quota.bonus} 個，多 ${quota.bonus} 個）` : ''}`;
  const seen = Number(lsGet(LS_BOTTLE_SEEN) ?? 0);
  const statusText = (b: (typeof dropped)[number]): string => {
    const drift = driftText(b.driftM);
    return b.status === 'picked'
      ? `被撿走了${b.pickedAt ? `（${ago(b.pickedAt)}）` : ''}${drift ? `・漂了 ${drift} 才被撿到` : ''}`
      : b.status === 'hidden'
        ? '被檢舉，暫時藏起來'
        : b.status === 'removed'
          ? '已被管理者移除'
          : b.status === 'deleted'
            ? '沒人撿，已經漂走'
            : `還沒被撿走${drift ? `・已經漂了 ${drift}` : ''}・${daysLeft(b.expiresAt)}後漂走`;
  };
  bottleMine.innerHTML =
    `<button type="button" class="btn letters-open" data-act="letters">瓶中信收藏<small>撿到 ${picked.length} 個・收藏 ${letters.length} 封</small></button>` +
    (dropped.length
      ? `<h3 class="spot-mine-title">我丟的瓶子</h3><ul class="spot-mine">${dropped
          .map((b) => {
            const fresh = b.pickedAt !== null && b.pickedAt > seen;
            return `<li><span class="spot-mine-body">「${esc(b.text)}」<small>${fresh ? '<b class="new-tag">新</b>' : ''}${ago(b.createdAt)}丟的・${esc(statusText(b))}</small></span>${
              b.status === 'active' || b.status === 'hidden' ? `<button type="button" class="chip spot-cancel" data-delete-bottle="${b.id}">收回</button>` : ''
            }</li>`;
          })
          .join('')}</ul>`
      : '');
  // 看過了：之後不再提示這些
  const latest = Math.max(0, ...dropped.map((b) => b.pickedAt ?? 0));
  if (latest > seen) lsSet(LS_BOTTLE_SEEN, String(latest));
  bottleBtn.classList.remove('news');
}

// ---- 瓶中信收藏（獨立一頁，網址 #letters） ----
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
    if (location.hash !== '#letters') return;
    if (lettersPushed) history.back();
    else history.replaceState(null, '', location.pathname + location.search);
    lettersPushed = false;
  }
}

function renderLettersPage(): void {
  const data = myBottlesData;
  if (!data) {
    lettersPicked.innerHTML = '<p class="muted">讀取中…</p>';
    lettersList.innerHTML = '';
    return;
  }
  const { picked, letters } = data;
  const meta = (b: { createdAt: number; pickedAt: number; driftM: number }): string => {
    const drift = driftText(b.driftM);
    return `${fmtDay(b.pickedAt)} 撿到・${ago(b.createdAt)}丟的${drift ? `・漂了 ${drift} 才到你手上` : ''}`;
  };
  lettersPicked.innerHTML = picked.length
    ? `<h3>撿到的瓶子（${picked.length}）</h3>
      <p class="muted small">喜歡的信可以收藏；回收瓶子今天就能多丟一個。兩個都可以做，收藏的信回收後還在。</p>
      <ul class="letter-cards">${picked
        .map(
          (b) => `<li class="letter-card">
            <blockquote class="bottle-note">${esc(b.text)}</blockquote>
            <small class="muted">${esc(meta(b))}</small>
            <div class="sheet-actions">
              <button type="button" class="btn${b.collected ? '' : ' primary'}" data-collect="${b.id}" data-on="${b.collected ? '0' : '1'}">${b.collected ? '已收藏' : '收藏這封信'}</button>
              <button type="button" class="btn" data-recycle="${b.id}">回收瓶子</button>
              <button type="button" class="btn subtle" data-report="${b.id}">檢舉</button>
            </div>
          </li>`,
        )
        .join('')}</ul>`
    : '<h3>撿到的瓶子</h3><p class="muted">沒有還沒回收的瓶子。到雷達上找找看，走到瓶子旁邊就撿得起來。</p>';
  lettersList.innerHTML = letters.length
    ? `<h3>收藏的信（${letters.length}）</h3><ul class="letter-grid">${letters
        .map(
          (l) => `<li class="letter-paper">
            <p class="letter-text">${esc(l.text)}</p>
            <small class="muted">${esc(meta(l))}</small>
            <button type="button" class="link-btn" data-collect="${l.id}" data-on="0">移出收藏</button>
          </li>`,
        )
        .join('')}</ul>`
    : '<h3>收藏的信</h3><p class="muted">還沒有收藏的信。撿到喜歡的瓶子，按「收藏這封信」就會留在這裡。</p>';
}

async function onLettersClick(e: Event): Promise<void> {
  const t = e.target as Element;
  const c = t.closest<HTMLButtonElement>('[data-collect]');
  const r = t.closest<HTMLButtonElement>('[data-recycle]');
  const rp = t.closest<HTMLButtonElement>('[data-report]');
  const btn = c ?? r ?? rp;
  if (!btn) return;
  btn.disabled = true;
  let ok = false;
  if (c) ok = await toggleCollect(Number(c.dataset.collect), c.dataset.on === '1');
  else if (r) ok = await recycle(Number(r.dataset.recycle));
  else if (rp && window.confirm('這封信有攻擊性內容、廣告或個人資料？檢舉後會交給管理者確認。')) {
    const res = await reportBottle(Number(rp.dataset.report));
    showBanner(bannerEl, res.ok ? '謝謝檢舉，這封信已經藏起來，會交給管理者確認' : res.message, 3000);
    ok = res.ok;
    if (ok) await reloadMyBottles();
  }
  if (!ok) btn.disabled = false;
}

async function submitBottle(): Promise<void> {
  const text = bottleText.value.trim();
  if (!text) {
    bottleResult.innerHTML = '<p class="msg error">寫一句話再丟吧</p>';
    return;
  }
  if (xLength(text) > bottleMaxWeight()) {
    bottleResult.innerHTML = '<p class="msg error">太長了：字數比照 X，中文最多 140 字、英文最多 280 字</p>';
    return;
  }
  if (origin.source !== 'gps') {
    bottleResult.innerHTML = '<p class="msg error">要先按右上角「定位」用 GPS，瓶子會丟在你現在的位置附近</p>';
    return;
  }
  bottleDropBtn.disabled = true;
  bottleResult.innerHTML = '<p class="msg busy">審核內容中</p>';
  const r = await dropBottle(text, origin);
  bottleDropBtn.disabled = false;
  if (!r.ok) {
    bottleResult.innerHTML = `<p class="msg error">${esc(r.message)}</p>`;
    return;
  }
  bottleTexts.set(r.data.bottle.id, r.data);
  bottles = [r.data.bottle, ...bottles.filter((b) => b.id !== r.data.bottle.id)];
  bottleText.value = '';
  lsSet(LS_BOTTLE_DROPPED, '1');
  bottleResult.innerHTML = `<p class="msg">丟出去了！瓶子會順著洋流漂 ${keywordRules?.sources?.bottles?.ttlDays ?? 7} 天，被撿走時這裡會通知你。</p>`;
  renderBottleSheet();
  void reloadMyBottles();
  render();
}

/**
 * 詳細資料每 5 秒重畫一次（倒數、狀態）：同一個選取還在時，保留展開的區塊（「其他貼文」「相關報導」）和捲動位置，
 * 不然點開沒多久就自己收回去
 */
function setDetailHtml(key: string, html: string): void {
  const same = detailEl.dataset.key === key;
  const summaryKey = (d: Element): string => (d.querySelector('summary')?.textContent ?? '').replace(/（\d+）$/, '');
  const open = same ? new Set([...detailEl.querySelectorAll('details[open]')].map(summaryKey)) : new Set<string>();
  const top = detailEl.scrollTop;
  detailEl.dataset.key = key;
  detailEl.innerHTML = html;
  if (!same) return;
  for (const d of detailEl.querySelectorAll<HTMLDetailsElement>('details')) if (open.has(summaryKey(d))) d.open = true;
  // 抽屜本身會捲動：展開的區塊放回去之後再還原位置
  detailEl.scrollTop = top;
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
  setDetailHtml(`ev:${ev.id}`, `
    <div class="sheet-head">
      <strong>${esc(titleOf(ev))}</strong>
      <button type="button" class="chip" data-act="close" aria-label="關閉">關閉</button>
    </div>
    <div class="sheet-body">
      ${nearbyHtml(it, items)}
      ${routeBoxHtml(ev, now)}
      ${ev.kind === 'job' ? jobDetailHtml(it, now) : ev.kind === 'session' ? sessionDetailHtml(it, now) : ev.kind === 'food' ? foodDetailHtml(it, now) : `<p>類型：${it.spot ? `固定據點（${kindLabel(ev)}）` : kindLabel(ev)}<br>${ev.item ? `${ev.kind === 'activity' ? '物品' : '發放'}：${esc(ev.item)}<br>` : ''}${ev.keyword ? `關鍵字：#${esc(ev.keyword)}<br>` : ''}地點：${esc(placeOf(ev))}${ev.approxArea ? `<br><span class="approx-note">約略位置：只知道在${esc(ev.approxArea)}，地圖上是${esc(ev.approxArea)}的中心點，實際地點請看原文</span>` : ''}<br>時間：${it.spot ? esc(spotSchedule(it)) : ev.allDay ? `${dateFmt.format(new Date(ev.startAt * 1000))} ${allDayText(ev, false)}` : esc(eventTimeText(ev))}<br>距離：${ev.approxArea ? '約 ' : ''}${formatKm(it.distanceKm)}，${compassLabel(it.bearing)}方 · ${esc(timeLine(it, now))}</p>`}
      <blockquote class="post-excerpt" title="原文摘錄，完整內容請看原文">${esc(ev.post.source === 'news' ? ev.post.text.split('\n')[0] : ev.post.text)}</blockquote>
      ${ev.post.supplement ? `<p class="muted supplement-line">回報的人補充：${esc(ev.post.supplement)}</p>` : ''}
      <p class="muted source-line">來源：${esc(sourceLabel(ev))}</p>
      ${routeOf(ev) ? '' : it.spot ? spotPostsHtml(ev.related ?? []) : relatedHtml(ev.related ?? [])}
      <div class="sheet-actions">
        <a class="btn primary" href="https://www.google.com/maps/dir/?api=1&destination=${ev.lat},${ev.lng}&travelmode=walking" target="_blank" rel="noopener">${ev.approxArea ? '導航到約略位置' : '導航'}</a>
        ${ev.post.permalink ? `<a class="btn" href="${esc(ev.post.permalink)}" target="_blank" rel="noopener">${esc(sourceLinkText(ev))}</a>` : ''}
        <a class="btn" href="${googleMapsUrl(ev)}" target="_blank" rel="noopener">在 Google 地圖上看</a>
        ${canReportEnded(ev, now) ? `<button type="button" class="btn" data-act="ended"${endedReported.has(ev.id) ? ' disabled' : ''}>${endedReported.has(ev.id) ? '已回報' : `回報${it.spot ? '今天' : ''}${endedWord(ev)}`}</button>` : ''}
        ${myReportIds.has(ev.post.id) ? '<button type="button" class="btn" data-act="withdraw">刪除我的回報</button>' : ''}
        <button type="button" class="btn" data-act="feedback">回報問題</button>
      </div>
      ${ev.endedReports ? `<p class="muted ended-note">已有 ${ev.endedReports} 人回報${endedWord(ev)}${neededText()}</p>` : ''}
    </div>`);
  detailEl.querySelector('[data-act="close"]')?.addEventListener('click', () => select(null));
  for (const b of detailEl.querySelectorAll<HTMLButtonElement>('[data-select]')) {
    b.addEventListener('click', () => select(Number(b.dataset.select)));
  }
  detailEl.querySelector('[data-act="ended"]')?.addEventListener('click', (e) => void sendEnded(ev, e.currentTarget as HTMLButtonElement));
  detailEl.querySelector('[data-act="withdraw"]')?.addEventListener('click', () => void withdrawMine(ev.post.id));
  detailEl.querySelector('[data-act="feedback"]')?.addEventListener('click', () => openFeedback(ev));
  detailEl.querySelector('[data-act="route"]')?.addEventListener('click', () => {
    const r = routeOf(ev);
    if (r) selectRoute(r.id);
  });
}

/** 屬於車掃路線的事件：這一站的時間，和回到整條路線時間表的按鈕 */
function routeBoxHtml(ev: EventOut, now: number): string {
  const r = routeOf(ev);
  const st = stopOf(ev);
  if (!r) return '';
  const line = st ? stopText(st, now) : '';
  return `<div class="route-box"><b>${esc(r.title)}</b>${line ? `：${esc(line)}` : ''}<br><button type="button" class="link-btn" data-act="route">看整條路線與每站時間</button></div>`;
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

/** 官方行程以官網為準；還沒開始的也不能回報 */
/** 「回報已發完」的說法：活動「已結束」、徵人「已徵到」、可照顧「已不提供」 */
const endedWord = (ev: EventOut): string =>
  ev.kind === 'food'
    ? ({ vendor: '已收攤', recommend: '已歇業', meetup: '已揪滿' }[foodRole(ev) ?? 'recommend'] ?? '已結束')
    : ev.kind === 'session' ? (isSeek(ev) ? '已找到' : '已額滿') : ev.kind === 'job' ? (isOffer(ev) ? '已不提供' : '已徵到') : ev.kind === 'activity' ? '已結束' : '已發完';

/** 羽球臨打的詳細資料：招臨打寫時段、費用、程度、缺幾位、用球、球團；找臨打寫程度、可以打的時間、地區 */
function sessionDetailHtml(it: Item, now: number): string {
  const { ev } = it;
  const x = sessionOf(ev);
  const line = (k: string, v: string | null | undefined): string => (v ? `${k}：${esc(v)}<br>` : '');
  const where = `地點：${esc(placeOf(ev))}${ev.approxArea ? `<br><span class="approx-note">約略位置：只知道在${esc(ev.approxArea)}</span>` : ''}<br>距離：${ev.approxArea ? '約 ' : ''}${formatKm(it.distanceKm)}，${compassLabel(it.bearing)}方`;
  const contact = x.contact ? (CONTACT_TEXT[x.contact] ?? x.contact) : null;
  if (isSeek(ev)) {
    return `<p>類型：找臨打（球友想找地方打）<br>${line('程度', x.level)}時間：${esc(seekWhen(ev))}<br>${line('聯絡方式', contact)}${where}</p>`;
  }
  const time = it.spot ? spotSchedule(it) : eventTimeText(ev);
  return `<p>類型：${it.spot ? '招臨打・每週固定場' : '招臨打'}<br>時間：${esc(time)}<br>${line('費用', x.fee ?? ev.item)}${line('程度', x.level)}${line('缺幾位', x.slots)}${line('用球', x.shuttle)}${line('球團', x.team)}${line('報名方式', contact)}${where} · ${esc(timeLine(it, now))}</p>`;
}

/** 狗狗陪伴的摘要：「2 個徵人、1 個可照顧」 */
function dogSummary(rows: Array<{ it?: Item }>): string {
  const offers = rows.filter((r) => r.it && isOffer(r.it.ev)).length;
  const hires = rows.length - offers;
  return [hires ? `${hires} 個徵人` : '', offers ? `${offers} 個可照顧` : ''].filter(Boolean).join('、');
}

/** 職缺的詳細資料：薪資、工作期間、雇主、怎麼應徵、內容，加上防詐提醒 */
function jobDetailHtml(it: Item, now: number): string {
  const { ev } = it;
  const j = jobOf(ev);
  const offer = isOffer(ev);
  const period = jobPeriod(j);
  const who = offer ? `提供者：${j.employer ? esc(j.employer) : '個人'}<br>` : `雇主：${j.employer ? esc(j.employer) : '<span class="risk">沒寫</span>'}<br>`;
  return `${fraudBoxHtml(ev)}<p>類型：${offer ? '可照顧（有人可以幫忙照顧狗狗）' : '徵人（找人照顧狗狗）'}<br>${j.pay ? `${offer ? '費用' : '薪資'}：${esc(j.pay)}<br>` : ''}${offer ? '可照顧期間' : '工作期間'}：${esc(offer && period === '沒寫工作期間' ? '時間可討論' : period)}<br>${who}${j.contact ? `${offer ? '聯絡方式' : '應徵方式'}：${esc(CONTACT_TEXT[j.contact] ?? j.contact)}<br>` : ''}${j.requirements ? `${offer ? '條件' : '內容'}：${esc(j.requirements)}<br>` : ''}地點：${esc(placeOf(ev))}${ev.approxArea ? `<br><span class="approx-note">約略位置：只知道在${esc(ev.approxArea)}</span>` : ''}<br>距離：${ev.approxArea ? '約 ' : ''}${formatKm(it.distanceKm)}，${compassLabel(it.bearing)}方${ev.endOpen ? '' : ` · 刊登到 ${dateFmt.format(new Date((ev.endAt - 1) * 1000))}`}${now ? '' : ''}</p>`;
}

function canReportEnded(ev: EventOut, now: number): boolean {
  return ev.post.source !== 'official' && ev.startAt <= now;
}

function neededText(): string {
  const n = keywordRules?.sources?.link?.endedReportsNeeded;
  return n ? `，${n} 人回報就會下架` : '';
}

/** 回報問題：疊在詳細資料上面，選類型、寫說明 */
function openFeedback(ev: EventOut): void {
  feedbackEventId = ev.id;
  feedbackForm.reset();
  $('#feedback-target').textContent = `「${titleOf(ev)}」哪裡有問題？`;
  feedbackSheet.hidden = false;
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
  feedbackSubmit.disabled = true;
  const r = await sendFeedback(feedbackEventId, kind, note);
  feedbackSubmit.disabled = false;
  if (!r.ok) {
    showBanner(bannerEl, r.message, 4000);
    return;
  }
  feedbackSheet.hidden = true;
  feedbackEventId = null;
  showBanner(bannerEl, r.data.duplicate ? '你已經回報過這個問題了，謝謝' : '謝謝回報，管理者會盡快處理', 3500);
}

async function sendEnded(ev: EventOut, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  const r = await reportEnded(ev.id);
  if (!r.ok) {
    btn.disabled = false;
    showBanner(bannerEl, r.message, 3500);
    return;
  }
  endedReported.add(ev.id);
  lsSet(LS_ENDED, JSON.stringify([...endedReported].slice(-200)));
  if (r.data.ended) {
    showBanner(bannerEl, `謝謝回報，「${titleOf(ev)}」已從雷達下架`, 3000);
    selectedId = null;
    await refresh();
  } else {
    ev.endedReports = r.data.count;
    showBanner(bannerEl, `謝謝回報，再 ${r.data.needed - r.data.count} 人回報就會下架`, 3000);
    render();
  }
}

/** 雷達或地圖上疊在一起的一群，詳細資料會列出同一群的其他項目 */
let selectedGroup: number[] = [];
/** 點了疊在一起的一群、還沒選是哪一個 */
let choosing: number[] | null = null;

const sameGroup = (a: number[] | null, b: number[]): boolean => !!a && [...a].sort().join() === [...b].sort().join();

function selectLandmark(id: string | null): void {
  selectedLandmark = selectedLandmark === id ? null : id;
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
  selectedId = selectedId === id ? null : id;
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
 */
async function reveal(id: number): Promise<void> {
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
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** 拖曳雷達：開始拖之前的位置（放開時跟它比有沒有移動，決定要不要重抓） */
let panFrom: Origin | null = null;
let panFrame = 0;

/**
 * 在雷達上拖曳＝移動你的位置（變成手動位置）。拖的時候只重畫雷達、清單，範圍維持原本的公里數；
 * 放開才存下來、重抓附近的資料（雙北、全台的範圍也這時照新位置重算）
 */
function panRadar(bearing: number, km: number, done: boolean): void {
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
 * 「回到我的位置」：有 GPS 位置就馬上回去；還沒收到 GPS（剛開頁面）就先回到上次知道的位置
 * （最後一次的 GPS 或移動前的位置），不用等重新定位，之後 GPS 回來照常更新。都沒有才重新定位
 */
function goHome(): void {
  const to: Home | null = lastGps ? { ...lastGps, source: 'gps', accuracy: lastGpsAccuracy } : home;
  if (!to) {
    locateMe();
    return;
  }
  lsSet(LS_ORIGIN, null);
  gpsAccuracy = to.source === 'gps' ? to.accuracy : null;
  setOrigin({ lat: to.lat, lng: to.lng, source: to.source });
  map.setOrigin(origin, true, gpsAccuracy);
}

/** 「回到我的位置」：手動位置（拖曳雷達、在地圖上設定）時，雷達上才出現 */
function updateHomeBtn(): void {
  homeBtn.hidden = origin.source !== 'manual' || view !== 'radar';
}

function setOrigin(o: Origin): void {
  const moved = haversineKm(origin, o) > 0.2;
  // 記住不是手動的位置：之後拖曳、在地圖上設定，「回到我的位置」可以直接回來
  // （預設位置不蓋掉上次的 GPS 位置）
  if (o.source === 'gps' || (o.source === 'default' && home?.source !== 'gps')) {
    home = { lat: o.lat, lng: o.lng, source: o.source, accuracy: o.source === 'gps' ? gpsAccuracy : null };
    lsSet(LS_HOME, JSON.stringify(home));
  }
  origin = o;
  if (o.source === 'manual') lsSet(LS_ORIGIN, JSON.stringify(o));
  map.setOrigin(o, moved, o.source === 'gps' ? gpsAccuracy : null);
  originLabel.textContent = o.source === 'gps' ? 'GPS 定位' : o.source === 'manual' ? '手動位置' : '預設：台北車站';
  useGpsBtn.hidden = o.source !== 'manual';
  updateHomeBtn();
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

async function refresh(): Promise<void> {
  const seq = ++fetchSeq;
  const forModule = mod;
  // 搜尋關鍵字、車掃路線、漂流瓶都是洋流才有
  const kws = forModule.current ? followed() : [];
  // 漂流瓶跟關鍵字無關，一起抓
  const bottleReq = bottlesOn() ? fetchBottles(origin, FETCH_RADIUS_KM) : Promise.resolve([] as BottleOut[]);
  if (forModule.current && kws.length === 0) {
    events = [];
    bottles = await bottleReq;
    lastFetchAt = nowSec();
    updatedLabel.textContent = `↻ 更新 ${fmtTime(lastFetchAt)}`;
    render();
    return;
  }
  try {
    const radius = fetchRadiusKm(scaleKm);
    const got = await Promise.all([fetchEvents(origin, radius, kws, forModule.id), forModule.current ? currentRoutes() : Promise.resolve([] as RouteOut[]), bottleReq]);
    if (seq !== fetchSeq) return;
    [events, routes, bottles] = got;
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
  // 雷達藏起來前先量外圈多大，地圖照同樣的比例
  const rangePx = radar.rangePx();
  const from = view;
  view = v;
  $('#radar-view').hidden = v !== 'radar';
  $('#map-view').hidden = v !== 'map';
  updateHomeBtn();
  $('#stage').dataset.view = v;
  viewBtn.textContent = v === 'radar' ? '地圖' : '雷達';
  pickBtn.hidden = v !== 'map';
  $('#scale-chips').hidden = v !== 'radar';
  baseChipsEl.hidden = v !== 'map';
  compassBtn.hidden = v !== 'radar' || !compassSupported();
  if (v === 'map') map.showRange(scaleKm, rangePx);
  // 切回雷達：雷達範圍改成地圖目前的比例（接近某個按鈕的範圍就對齊那個按鈕）
  const kmPerPx = map.kmPerPx();
  const px = radar.rangePx();
  if (v === 'radar' && from === 'map' && kmPerPx && px > 0) zoomRadar((kmPerPx * px) / scaleKm, true);
}

/** 要抓多遠的：範圍超過 600 km 就抓全世界 */
const fetchRadiusKm = (km: number): number => (km > FETCH_RADIUS_KM ? WORLD_KM : FETCH_RADIUS_KM);

function scaleKmFor(setting: ScaleSetting): number {
  if (setting === 'custom') return Math.min(Math.max(customKm, MIN_ZOOM_KM), WORLD_KM);
  if (setting === 'region') return shuangbeiRadiusKm(origin);
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

/** 雙指縮放、滾輪：連續調整範圍；放開時接近某個按鈕的範圍（差 6% 以內）就對齊那個按鈕 */
function zoomRadar(factor: number, done: boolean): void {
  customKm = Math.min(Math.max(scaleKm * factor, MIN_ZOOM_KM), WORLD_KM);
  if (done) {
    const near = SCALE_SETTINGS.find((st) => Math.abs(scaleKmFor(st) / customKm - 1) < 0.06);
    if (near) {
      setScale(near);
      return;
    }
    lsSet(LS_SCALE_KM, customKm.toFixed(2));
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
  }
  render();
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
  return '目前無法取得位置，請稍後再試，或切到地圖用「設定位置」手動選。';
}

/** 「定位」按鈕：清掉手動位置，重新抓一次 GPS 並移到我的位置 */
function locateMe(): void {
  if (!('geolocation' in navigator)) {
    showBanner(bannerEl, '此瀏覽器不支援定位，可切到地圖用「設定位置」手動選。', 4000);
    return;
  }
  locateBtn.classList.add('on');
  locateBtn.textContent = '定位中…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locateBtn.classList.remove('on');
      locateBtn.textContent = '定位';
      lsSet(LS_ORIGIN, null);
      gpsAccuracy = pos.coords.accuracy;
      setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps' });
      map.setOrigin(origin, true, gpsAccuracy);
      showBanner(bannerEl, `已定位，誤差約 ${Math.round(pos.coords.accuracy)} 公尺`, 2000);
    },
    (e) => {
      locateBtn.classList.remove('on');
      locateBtn.textContent = '定位';
      showBanner(bannerEl, geoErrorText(e), 5000);
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 },
  );
}

function startGeolocation(): void {
  if (!('geolocation' in navigator)) {
    showBanner(bannerEl, '此瀏覽器不支援定位，以台北車站為中心');
    return;
  }
  navigator.geolocation.watchPosition(
    (pos) => {
      // 手動位置時也記著最新的 GPS 位置，「回到我的位置」可以馬上回來
      lastGps = { lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps' };
      lastGpsAccuracy = pos.coords.accuracy;
      if (origin.source === 'manual') {
        // 手動位置時也存下來：下次開頁面還沒定位到，「回到我的位置」也能馬上回到這裡
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
  // 說明照目前的雷達打開
  $<HTMLAnchorElement>('#help-btn').href = mod.helpPage;
  reportIntro.textContent = mod.current ? CURRENT_REPORT_INTRO : mod.reportIntro;
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
  applyModule();
  render();
  if (fetch) void refresh();
}

function renderModuleList(): void {
  moduleList.replaceChildren();
  for (const m of MODULES) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `theme-item module-item${m.id === mod.id ? ' on' : ''}`;
    b.innerHTML = `<span class="emoji" aria-hidden="true">${m.emoji}</span><span><b>${esc(m.name)}</b><small>${esc(m.tagline)}</small></span>${m.id === mod.id ? '<span class="check">✓</span>' : ''}`;
    b.addEventListener('click', () => switchModule(m.id));
    li.appendChild(b);
    moduleList.appendChild(li);
  }
}

function openModuleSheet(open: boolean): void {
  moduleSheet.hidden = !open;
  if (!open) return;
  themeSheet.hidden = true;
  kwSheet.hidden = true;
  reportSheet.hidden = true;
  bottleSheet.hidden = true;
  feedbackSheet.hidden = true;
  renderModuleList();
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
      ${src?.link ? `<li><b>大家回報</b>：任何人都可以按「＋回報」貼上 Threads 貼文連結（${src.link.maxAgeDays} 天內的公開貼文），系統讀取貼文後用同樣的規則判讀。</li>` : ''}
    </ul>
    <h3>多久找一次</h3>
    <ul>
      <li>Threads 每 ${r.intervalMin} 分鐘、新聞每 30 分鐘、官方行程每小時。</li>
      <li>收${esc(r.region)}的發放和活動。雷達選「雙北」看台北市加新北市，選「全台」看全台灣與離島。</li>
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
      <li>開始後，${src.link.endedReportsNeeded} 個人在詳細資料按「回報已發完」也會提早下架（官方行程除外）。</li>` : ''}
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
  if (ev.post.source === 'news') return `新聞・${ev.post.username ?? ''}`;
  if (ev.post.source === 'official') return '台北大洋流官網「未來航線」';
  const who = `Threads${ev.post.username ? `・@${ev.post.username}` : ''}`;
  return ev.post.source === 'link' ? `${who}（大家回報）` : ev.post.source === 'spot' ? `${who}（大家回報・已審核）` : who;
}

function sourceLinkText(ev: EventOut): string {
  if (ev.post.source === 'news') return '看新聞原文';
  if (ev.post.source === 'official') return '看官方航線';
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
  return ev.kind === 'job' ? (isOffer(ev) ? '可照顧' : '徵人') : ev.kind === 'activity' ? '活動' : '發放';
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
  reportBtn.setAttribute('aria-label', open ? '回報 Threads 貼文' : REPORTS_LOCKED_TEXT);
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
    `只收${l ? ` ${l.maxAgeDays} 天內` : ''}的公開貼文。每一場活動都要讀得到做什麼、在哪裡、哪天幾點開始，缺一個就不會放上雷達。`,
    '結束時間可以不寫：沒寫的只寫幾點開始，雷達上顯示到開始後兩小時。',
    '貼文寫了車掃、掃街或車隊，同一天又列了好幾站的，會合成一條路線：每一站從預計經過前 10 分鐘顯示到經過後 15 分鐘。只定位到鄉鎮區的站，要在地圖上標出位置才會放上雷達。',
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
    for (const b of reportResult.querySelectorAll<HTMLButtonElement>('[data-idle]')) {
      b.textContent = b.dataset.idle ?? '';
      delete b.dataset.idle;
    }
  }
}

/** 預覽上的時間：固定據點寫每天幾點、從哪天起排幾天；一般的寫哪天幾點到幾點 */
function previewWhen(p: PreviewItem): string {
  if (p.kind === 'job') return `${isOffer(p) ? '可照顧' : '工作'} ${jobPeriod(jobOf(p))}`;
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
function previewWhere(p: PreviewItem): string {
  if (p.lat === null || p.lng === null) return '<span class="preview-warn">找不到地點，確認了也不會出現在雷達上</span>';
  const link = `<a href="${googleMapsUrl({ lat: p.lat, lng: p.lng })}" target="_blank" rel="noopener">在 Google 地圖上看</a>`;
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

/** 補充資料表單的一場：判讀出來的位置、回報的人標的位置、小地圖 */
interface EditPin {
  /** 判讀時或按「查地點」依地點查到的位置（地點文字改了就不算） */
  found: LatLng | null;
  foundPlace: string;
  approxArea: string | null;
  /** 按「查地點」查到的地名；查不到是 null（missed 是查不到的那段地點） */
  foundName: string | null;
  missed: string | null;
  /** 回報的人在地圖上標的 */
  pinned: LatLng | null;
  picker: PinPicker | null;
}
const editPins = new Map<HTMLElement, EditPin>();

/** 洋流的補充資料：每一場直接改標題、時間、地點，位置不對可以在地圖上標 */
function editCardHtml(it: EditItem | null): string {
  const tz = it ? localTz(it) : null;
  const start = it?.startAt ? wallInput(it.startAt, tz) : null;
  const end = it?.endAt ? wallInput(it.endAt, tz).time : '';
  return `<fieldset class="edit-item">
      <legend><span class="edit-no"></span><button type="button" class="chip" data-act="drop">不要這場</button></legend>
      <label>活動內容<input name="title" maxlength="60" value="${esc(it?.title ?? '')}" placeholder="例如：發飄帶、景華公園表演同樂會"></label>
      <div class="edit-row">
        <label>日期<input type="date" name="date" value="${start?.date ?? ''}"></label>
        <label>開始<input type="time" name="start" value="${it?.dateOnly ? '' : (start?.time ?? '')}"></label>
        <label>結束<input type="time" name="end" value="${end}"></label>
      </div>
      <small class="muted">結束可以不填：只寫幾點開始，雷達上顯示到開始後兩小時。國外的活動填當地時間。</small>
      <label>地點<input name="place" maxlength="80" value="${esc(it?.place ?? '')}" placeholder="店名或地址，例如：厝邊咖啡 台北市萬華區○○路○號"></label>
      <div class="edit-pin"><small class="edit-pin-state"></small><button type="button" class="chip" data-act="locate">查地點</button><button type="button" class="chip" data-act="pin">在地圖上標位置</button><button type="button" class="chip" data-act="unpin" hidden>不用標的位置</button></div>
      <div class="edit-map" hidden></div>
    </fieldset>`;
}

function editFormHtml(items: EditItem[], hidden: boolean): string {
  const list = items.length > 0 ? items.slice(0, MAX_EDIT_ITEMS) : [null];
  return `<form class="preview-more edit-form"${hidden ? ' hidden' : ''} novalidate>
      <p class="muted sheet-note">直接改每一場的活動內容、時間、地點；位置不對可以按「在地圖上標位置」，點地圖或拖標記。</p>
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
      ? '📍 用你在地圖上標的位置'
      : found
        ? pin.approxArea
          ? `只定位到${pin.approxArea}（約略位置），可以在地圖上標出正確位置`
          : name
            ? `📍 查到：${name}。位置不對可以拖標記或點地圖`
            : '已依地點定位，位置不對可以在地圖上標'
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
  const pin: EditPin = { found, foundPlace: it?.place ?? '', approxArea: it?.approxArea ?? null, foundName: null, missed: null, pinned: null, picker: null };
  editPins.set(card, pin);
  const mapEl = card.querySelector<HTMLElement>('.edit-map');
  const pinBtn = card.querySelector<HTMLButtonElement>('[data-act="pin"]');
  const placeInput = card.querySelector<HTMLInputElement>('[name="place"]');
  placeInput?.addEventListener('input', () => updatePinState(card));
  // 打開小地圖（第一次才建）：從標的位置、查到的位置開始，都沒有就從使用者的位置
  const openMap = async (): Promise<void> => {
    if (!mapEl || !pinBtn) return;
    mapEl.hidden = false;
    pinBtn.textContent = '收起地圖';
    if (pin.picker) return;
    const place = placeInput?.value.trim() ?? '';
    const start = pin.pinned ?? (pin.found && place === pin.foundPlace ? pin.found : null);
    pin.picker = await pinPicker(mapEl, start, origin, baseMap, (p) => {
      pin.pinned = p;
      updatePinState(card);
    });
  };
  pinBtn?.addEventListener('click', async () => {
    if (!mapEl) return;
    if (!mapEl.hidden) {
      mapEl.hidden = true;
      pinBtn.textContent = '在地圖上標位置';
      return;
    }
    await openMap();
  });
  // 查地點：查法跟送出後一樣，查到的標在小地圖上（之前在地圖上標的不算了），位置不對再拖
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
    await openMap();
    pin.picker?.set(hit, r.approxArea ? 14 : 17);
  });
  card.querySelector('[data-act="unpin"]')?.addEventListener('click', () => {
    pin.pinned = null;
    const place = card.querySelector<HTMLInputElement>('[name="place"]')?.value.trim() ?? '';
    pin.picker?.set(pin.found && place === pin.foundPlace ? pin.found : null);
    updatePinState(card);
  });
  card.querySelector('[data-act="drop"]')?.addEventListener('click', () => {
    pin.picker?.remove();
    editPins.delete(card);
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
    const place = val('place');
    if (!title) return `${at}請填活動內容`;
    if (!val('date') || !val('start')) return `${at}請填哪天幾點開始`;
    if (!place) return `${at}請填地點`;
    const startAt = tpeUnix(val('date'), val('start'));
    if (startAt === null) return `${at}日期或時間看不懂，請重新選`;
    let endAt = val('end') ? tpeUnix(val('date'), val('end')) : null;
    // 結束比開始早：跨過午夜，是隔天
    if (endAt !== null && endAt <= startAt) endAt += 86400;
    const pinned = editPins.get(card)?.pinned ?? null;
    out.push({ title, startAt, endAt, place, lat: pinned?.lat ?? null, lng: pinned?.lng ?? null });
  }
  return out.length > 0 ? out : '至少要填一場活動';
}

function wireEdit(c: { postId: string; token: string }, items: EditItem[], actions: HTMLElement | null): void {
  const form = reportResult.querySelector<HTMLFormElement>('.edit-form');
  if (!form) return;
  // 換了一個表單：舊的小地圖拿掉
  for (const pin of editPins.values()) pin.picker?.remove();
  editPins.clear();
  const list = form.querySelector<HTMLElement>('.edit-items');
  [...form.querySelectorAll<HTMLElement>('.edit-item')].forEach((card, i) => wireEditCard(c, card, items[i] ?? null, form));
  renumberEdit(form);
  form.querySelector('[data-act="add"]')?.addEventListener('click', () => {
    if (!list) return;
    list.insertAdjacentHTML('beforeend', editCardHtml(null));
    const card = list.lastElementChild as HTMLElement;
    wireEditCard(c, card, null, form);
    renumberEdit(form);
    card.querySelector<HTMLInputElement>('[name="title"]')?.focus();
  });
  reportResult.querySelector('[data-act="more"]')?.addEventListener('click', () => {
    form.hidden = false;
    if (actions) actions.hidden = true;
    form.querySelector<HTMLInputElement>('input')?.focus();
  });
  form.querySelector('[data-act="less"]')?.addEventListener('click', () => {
    form.hidden = true;
    if (actions) actions.hidden = false;
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
 * 點的是按鈕、連結、欄位、雷達光點、地圖標記、清單的一列（會自己打開別的）或卡片裡面不關；
 * 拖動（移動雷達、地圖）不算點。回報、漂流瓶有打字的內容，不跟著關
 */
const KEEP_OPEN = 'button, a, input, select, textarea, label, .sheet, .blip, .landmark, .bottle, .leaflet-marker-icon, .leaflet-interactive, .leaflet-popup, .leaflet-control, #event-list li';
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
            ? `已定位・<a href="${googleMapsUrl({ lat: st.lat, lng: st.lng })}" target="_blank" rel="noopener">在 Google 地圖上看</a>`
            : '已定位'
          : st.status === 'approximate'
            ? `<span class="preview-warn">只定位到${esc(st.area ?? '鄉鎮區')}（約略位置），不會放上雷達；可以按「補充資料」在地圖上標出位置</span>`
            : st.status === 'unlocated'
              ? st.sameAs
                ? `<span class="preview-warn">跟「${esc(st.sameAs)}」定位在同一個地方，可能查錯了，不會放上雷達；可以按「補充資料」在地圖上標出位置</span>`
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
          <b>${p.kind === 'food' ? ({ vendor: '出攤', recommend: '推薦', meetup: '揪團' }[foodRole(p) ?? 'recommend'] ?? '推薦') : p.kind === 'session' ? (isSeek(p) ? '找臨打' : '招臨打') : p.kind === 'job' ? (isOffer(p) ? '可照顧' : '徵人') : p.kind === 'activity' ? '活動' : '發放'}${p.spot ? (p.kind === 'session' ? '・每週固定場' : p.kind === 'food' ? '・每週固定擺攤' : '・固定據點') : ''}｜${esc(p.title)}</b>
          ${p.kind === 'job' && (jobOf(p).risks ?? []).some((r) => r !== 'no_employer') ? `<small class="preview-warn">⚠️ ${esc((jobOf(p).risks ?? []).map((r) => JOB_RISK_TEXT[r]).filter(Boolean).join('；'))}</small>` : ''}
          ${p.item ? `<small>${esc(p.item)}</small>` : ''}
          <small>時間：${esc(previewWhen(p))}</small>
          <small>地點：${esc(shortAddress(p.placeText.replace(/\s*\n\s*/g, ' ')))}</small>
          <small>${previewWhere(p)}</small>
          ${p.profileHint ? `<small class="preview-warn">📍 貼文沒寫地點，這是從 ${esc(p.profileHint)} 的帳號名稱、簡介推的，請確認是不是這裡。</small>` : ''}
          ${p.update ? `<small class="preview-warn">${esc(updateNote(p.update))}</small>` : ''}
        </li>`,
      )
      .join('')}</ul>
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
  });
  if (mod.current) wireEdit(c, r.edit ?? [], actions);
  else wireSupplement(c, actions);
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
    setReportMsg('<p class="msg error">請先貼上 Threads 貼文連結</p>');
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
  if (f.reason === 'approximate') return `只定位到${f.area ?? '鄉鎮區'}（約略位置），請在地圖上標出位置`;
  if (f.reason === 'unlocated') return `地點「${f.place ?? ''}」在地圖上查不到，請補上完整地址或店名，或在地圖上標出位置`;
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
      void reveal(Number(b.dataset.id));
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
async function withdrawMine(postId: string): Promise<void> {
  const x = myReports.find((r) => r.postId === postId);
  const shown = !x || x.state === 'on_radar' || x.state === 'attached';
  if (!window.confirm(shown ? '要刪除這則回報嗎？雷達上這則的發放、活動會一起拿掉，其他人也看不到了。' : '要刪除這則回報嗎？')) return;
  const r = await withdrawReport(postId);
  if (!r.ok) {
    showBanner(bannerEl, r.message, 3500);
    return;
  }
  showBanner(bannerEl, '已刪除這則回報', 2500);
  await loadMyReports();
  await refresh();
}

/** 清單最下面的版號：網站（建置時的提交）與伺服器（部署時的提交）分開寫，看得出哪邊已經更新 */
function showVersion(server: string | null): void {
  const v = __APP_VERSION__;
  const web = `${v.version}${v.date ? `（${v.date}${v.sha ? `・${v.sha}` : ''}）` : ''}`;
  $('#app-version').textContent = `洋流雷達 ${web}${server && server !== v.version ? `・伺服器 ${server}` : ''}`;
}

/** 從 Threads App 分享過來（PWA share target）或網址帶 ?url= */
function takeSharedLink(params: URLSearchParams): string | null {
  const text = [params.get('url'), params.get('text'), params.get('title')].filter(Boolean).join(' ');
  return /threads\.(com|net)\//i.test(text) ? text : null;
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
 * 還沒有位置（預設的台北車站）不送，等 GPS 或手動設定位置後 setOrigin 會再送。
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
        ? '通知已開啟。開 GPS 或在地圖上設定位置後，網頁關掉也會通知你附近 1 公里內開始的發放、活動'
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

  const heights = (): Record<PanelState, number> => {
    const vh = window.innerHeight;
    const pad = parseFloat(getComputedStyle(panelEl).paddingBottom) || 0;
    return {
      collapsed: handle.offsetHeight + head.offsetHeight + pad + 4,
      default: vh * 0.36,
      expanded: vh * 0.8,
    };
  };

  const setState = (s: PanelState): void => {
    state = s;
    panelEl.classList.toggle('expanded', s === 'expanded');
    panelEl.classList.toggle('collapsed', s === 'collapsed');
    handle.setAttribute('aria-label', s === 'collapsed' ? '展開清單' : s === 'expanded' ? '縮小清單' : '展開或收合清單');
  };
  // 清單高度變了，地圖要重算尺寸（雷達是 SVG 會自己縮放）
  panelEl.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'max-height' && view === 'map') map.invalidate();
  });

  const start = (e: PointerEvent): void => {
    if (desktop.matches || (e.pointerType === 'mouse' && e.button !== 0)) return;
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
      // 只有輕點橫條才切換，點標題列不切換（上面有其他按鈕）
      if (e.currentTarget === handle) setState(state === 'collapsed' ? 'default' : state === 'default' ? 'expanded' : 'default');
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
  for (const el of [handle, head]) {
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
}

function wireControls(): void {
  for (const b of scaleChips) b.addEventListener('click', () => setScale((b.dataset.scale as ScaleSetting) ?? 'region'));
  viewBtn.addEventListener('click', () => switchView(view === 'radar' ? 'map' : 'radar'));
  locateBtn.addEventListener('click', locateMe);
  homeBtn.addEventListener('click', goHome);
  for (const b of baseChips) b.addEventListener('click', () => setBase(b.dataset.base as BaseMap));
  compassBtn.addEventListener('click', () => void toggleCompass());
  notifyBtn.addEventListener('click', () => void toggleNotify());
  themeBtn.addEventListener('click', () => {
    unlockAudio();
    openThemeSheet(themeSheet.hidden);
  });
  themeSheet.querySelector('[data-act="close"]')?.addEventListener('click', () => openThemeSheet(false));
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
  kwSheet.querySelector('[data-act="close"]')?.addEventListener('click', () => openKwSheet(false));
  feedbackSheet.querySelector('[data-act="close"]')?.addEventListener('click', () => {
    feedbackSheet.hidden = true;
  });
  feedbackForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitFeedback();
  });
  // 管理頁的入口：版本字樣連點 5 下（加入主畫面的 App 沒有網址列），存過管理 token 的直接顯示連結
  let taps: number[] = [];
  $('#app-version').addEventListener('click', () => {
    const t = Date.now();
    taps = [...taps.filter((x) => t - x < 2000), t];
    if (taps.length >= 5) location.href = 'admin.html';
  });
  $('#admin-link').hidden = !lsGet(LS_ADMIN_TOKEN);
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
  for (const b of timeChips) b.addEventListener('click', () => setTime((b.dataset.time as TimeSetting) ?? 'all'));
  reportSheet.querySelector('[data-act="close"]')?.addEventListener('click', () => openReportSheet(false));
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
      void reveal(Number(b.dataset.show));
    }
  });
  reportForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitReport();
  });
  bottleBtn.addEventListener('click', () => openBottleSheet(bottleSheet.hidden));
  bottleSheet.querySelector('[data-act="close"]')?.addEventListener('click', () => openBottleSheet(false));
  wireTapOutside();
  bottleText.addEventListener('input', () => {
    const over = updateBottleCount();
    bottleDropBtn.disabled = origin.source !== 'gps' || over;
  });
  bottleForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitBottle();
  });
  bottleNear.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-bottle]');
    if (b?.dataset.bottle) selectBottle(Number(b.dataset.bottle));
  });
  bottleMine.addEventListener('click', async (e) => {
    if ((e.target as Element).closest('[data-act="letters"]')) {
      openLettersPage(true);
      return;
    }
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-delete-bottle]');
    if (!b?.dataset.deleteBottle || !window.confirm('要收回這個瓶子嗎？收回後就沒有人撿得到了。')) return;
    b.disabled = true;
    const id = Number(b.dataset.deleteBottle);
    const r = await deleteBottle(id);
    if (r.ok) bottles = bottles.filter((x) => x.id !== id);
    bottleResult.innerHTML = r.ok ? '<p class="msg">瓶子收回了。</p>' : `<p class="msg error">${esc(r.message)}</p>`;
    renderBottleSheet();
    void reloadMyBottles();
    render();
  });
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
  pickBtn.addEventListener('click', () => {
    const on = !pickBtn.classList.contains('on');
    pickBtn.classList.toggle('on', on);
    map.setPickMode(on);
    if (on) showBanner(bannerEl, '點地圖任一處設定你的位置');
  });
  useGpsBtn.addEventListener('click', () => {
    lsSet(LS_ORIGIN, null);
    setOrigin(DEFAULT_ORIGIN);
    startGeolocation();
  });
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
  const lab = new URLSearchParams(location.search).get('lab');
  if (lab === 'bottles') lsSet(LS_LAB_BOTTLES, '1');
  if (lab === 'off') lsSet(LS_LAB_BOTTLES, null);
  wireControls();
  updateNotifyBtn();
  // 點手機推播的通知、網頁已經開著：選到那一則
  await registerServiceWorker((id) => void reveal(id));
  lsSet(LS_MODULE, mod.id);
  applyTheme(theme);
  applyModule();
  setBase(baseMap);
  switchView('radar');
  setTime(timeSetting);
  setScale(scaleSetting);
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
  const params = new URLSearchParams(location.search);
  const openParam = params.get('open');
  if (openParam === 'theme') openThemeSheet(true);
  if (openParam === 'keywords') openKwSheet(true);
  if (openParam === 'report') openReportSheet(true);
  const shared = takeSharedLink(params);
  if (shared) {
    // 分享進來的網址用過就清掉，重新整理才不會再送一次
    history.replaceState(null, '', location.pathname);
    openReportSheet(true);
    reportInput.value = shared;
    void submitReport();
  }
  const baseParam = new URLSearchParams(location.search).get('base');
  if (baseParam && (BASES as string[]).includes(baseParam)) setBase(baseParam as BaseMap);
  if (new URLSearchParams(location.search).get('view') === 'map') switchView('map');
  const scaleParam = new URLSearchParams(location.search).get('scale');
  if (scaleParam && (SCALE_SETTINGS as string[]).includes(scaleParam)) setScale(scaleParam as ScaleSetting);
  if (lsGet(LS_REPORTED)) void loadMyReports();
  // 點推播通知打開的：?event=123 選到那一則
  const eventParam = Number(params.get('event'));
  if (eventParam) {
    history.replaceState(null, '', location.pathname);
    void reveal(eventParam);
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
