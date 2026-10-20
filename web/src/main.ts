import './styles.css';
import { addKeyword, collectLetter, confirmReport, rejectReport, supplementReport, deleteBottle, dropBottle, recycleBottle, fetchBottles, fetchEvents, fetchHealth, fetchKeywords, fetchMyBottles, fetchRoutes, pickBottle, reportBottle, reportEnded, submitLink } from './api';
import { compassSupported, startCompass } from './compass';
import { bearingDeg, compassLabel, formatKm, haversineKm, taiwanRadiusKm, type LatLng } from './geo';
import { inShuangbei, SHUANGBEI_RINGS, shuangbeiRadiusKm } from './shuangbei';
import { LANDMARKS } from './landmarks';
import { X_MAX_WEIGHT, xLength } from './xcount';
import { splitPlace } from './place';
import { crowdOf, MapView, type BaseMap } from './map';
import { beep, ensureNotificationPermission, notificationState, showBanner, systemNotify, unlockAudio } from './notify';
import { Radar, type RadarRoute } from './radar';
import { DEFAULT_THEME_ID, getTheme, THEMES, type Theme } from './themes';
import type { BottleOut, EventOut, Item, KeywordInfo, KeywordRules, MyBottles, Origin, Phase, PickedBottle, RelatedPost, RouteOut, PreviewItem, RouteStop, SubmitResult } from './types';

const DEFAULT_ORIGIN: Origin = { lat: 25.0478, lng: 121.517, source: 'default' }; // 台北車站
const SOON_SEC = 30 * 60;
/** 後端查詢半徑：至少 80 km，選大範圍時跟著放大，才不會漏掉邊緣的發放 */
/** 永遠抓全台（含離島）的資料，清單分「範圍內」與「雷達範圍外」 */
const FETCH_RADIUS_KM = 600;
const POLL_MS = 60_000;
const TICK_MS = 5_000;
const LS_SCALE = 'dr.scale';
/** 雙指縮放後的自訂範圍（公里） */
const LS_SCALE_KM = 'dr.scaleKm';
const LS_ORIGIN = 'dr.origin';
const LS_THEME = 'dr.theme';
const LS_BASE = 'dr.base';
const BASES: BaseMap[] = ['nlsc', 'osm'];
const LS_KEYWORDS = 'dr.keywords';
const LS_ENDED = 'dr.endedReported';
const LS_SPOTS = 'dr.showSpots';
/** 丟過瓶子（才需要去問有沒有被撿走）、看過的最後一次「被撿走」時間 */
const LS_BOTTLE_DROPPED = 'dr.bottleDropped';
const LS_BOTTLE_SEEN = 'dr.bottleSeen';
/** 開始提醒（音效、震動、橫幅、系統通知）的開關：on／off；沒設過時，瀏覽器已允許通知就算開 */
const LS_NOTIFY = 'dr.notify';
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
type ScaleSetting = '1' | '5' | '20' | 'region' | 'taiwan' | 'custom';
/** 下方按鈕的範圍；custom 是雙指縮放或滾輪調出來的 */
const SCALE_SETTINGS: ScaleSetting[] = ['1', '5', '20', 'region', 'taiwan'];
const isAutoScale = (s: ScaleSetting): boolean => s === 'region' || s === 'taiwan';
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
let showSpots = lsGet(LS_SPOTS) !== '0';
/** 這台裝置已經回報過「已發完」的事件 */
const endedReported = new Set<number>(loadIdList(LS_ENDED));

// ---- elements ----
const bannerEl = $('#banner');
const listEl = $<HTMLUListElement>('#event-list');
const emptyEl = $('#empty-hint');
const detailEl = $('#detail');
const countLabel = $('#count-label');
const originLabel = $('#origin-label');
const useGpsBtn = $<HTMLButtonElement>('#use-gps');
const updatedLabel = $('#updated-label');
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
const kwBtn = $<HTMLButtonElement>('#kw-btn');
const kwSummary = $('#kw-summary');
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
const bottleBtn = $<HTMLButtonElement>('#bottle-btn');
const bottleBadge = $('#bottle-badge');
const bottleSheet = $('#bottle-sheet');
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
const spotToggle = $<HTMLButtonElement>('#spot-toggle');
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

/** 貼文沒寫結束時間時的說法：不自己猜時間 */
const openEndText = (ev: EventOut): string => (ev.kind === 'activity' ? '沒寫結束時間' : '發完為止');

/** 每週幾：[2, 4] →「每週二、四」，沒有就是 null */
function weeklyText(days: number[] | null | undefined): string | null {
  return days?.length ? `每週${days.map((d) => '一二三四五六日'[d - 1]).join('、')}` : null;
}

/** 固定據點的開放時段，例如「每天 11:00–18:00」「每週二、四 14:00–18:00」「每天 11:00–14:00、17:00–19:00」；沒寫幾點結束就只寫開始 */
function spotHours(sessions: EventOut[]): string {
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
    // 沒寫幾點結束：不寫「今天到幾點」
    return ev.endOpen ? `營業中・${until}` : `營業中・今天到 ${fmtTime(ev.endAt)}・${until}`;
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
  if (it.spot) return spotLine(it, now);
  const { ev } = it;
  if (ev.allDay) {
    const today = ev.startAt <= now && now < ev.endAt;
    const stop = stopOf(ev);
    if (today && stop?.kind === 'cheer' && stop.at) return now < stop.at ? `${it.phase === 'active' ? '進行中 · ' : ''}車隊預計 ${fmtTime(stop.at)} 經過` : `車隊預計 ${fmtTime(stop.at)} 已經過`;
    return today ? `進行中 · ${allDayText(ev, true)}` : `${dateFmt.format(new Date(ev.startAt * 1000))} ${allDayText(ev, false)}`;
  }
  if (it.phase === 'active') {
    if (ev.endOpen) return `進行中 · ${openEndText(ev)}`;
    const left = Math.max(0, Math.round((ev.endAt - now) / 60));
    return `進行中 · 約 ${left} 分鐘後結束`;
  }
  const mins = Math.round((ev.startAt - now) / 60);
  if (mins < 60) return `${fmtTime(ev.startAt)} 開始 · 還有 ${mins} 分鐘`;
  if (mins < 24 * 60) return `${fmtTime(ev.startAt)} 開始 · 還有 ${Math.floor(mins / 60)} 小時 ${mins % 60} 分`;
  return `${new Date(ev.startAt * 1000).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' })} ${fmtTime(ev.startAt)} 開始`;
}

// ---- 雷達範圍 ----
const scopeCache = new Map<string, boolean>();

/** 在不在雷達範圍內：距離在範圍內；選「雙北」時還要在台北市或新北市裡（基隆、桃園、宜蘭不算） */
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

/** 「雙北」時雷達上畫縣市界；位置變了才重算 */
function updateOutline(): void {
  const key = scaleSetting === 'region' ? `${origin.lat},${origin.lng}` : '';
  if (key === outlineFor) return;
  outlineFor = key;
  radarOutline = key ? SHUANGBEI_RINGS.map((ring) => ring.map(([lat, lng]) => ({ bearing: bearingDeg(origin, { lat, lng }), distanceKm: haversineKm(origin, { lat, lng }) }))) : [];
  radar.setOutline(radarOutline);
  map.setOutline(key ? SHUANGBEI_RINGS : []);
}

// ---- 車掃路線 ----
const routeOf = (ev: EventOut): RouteOut | undefined => routes.find((r) => r.postId === ev.post.id);
const stopOf = (ev: EventOut): RouteStop | undefined => routeOf(ev)?.stops.find((s) => s.title === ev.title);
const STOP_LABEL: Record<RouteStop['kind'], string> = { start: '出發', cheer: '加油點', end: '抵達' };

function routeState(r: RouteOut, now: number): RadarRoute['state'] {
  if (!r.departAt || now < r.departAt) return 'planned';
  if (r.arriveAt && now >= r.arriveAt) return 'done';
  return 'live';
}

/** 清單上有它的事件才顯示路線（跟著關鍵字篩選走） */
const shownRoutes = (items: Item[]): RouteOut[] => routes.filter((r) => items.some((it) => it.ev.post.id === r.postId));
const routeItems = (r: RouteOut, items: Item[]): Item[] => items.filter((it) => it.ev.post.id === r.postId);
const routeKm = (r: RouteOut): number => r.segments.reduce((n, s) => n + s.lengthM, 0) / 1000;

function untilText(unix: number, now: number): string {
  const mins = Math.max(0, Math.round((unix - now) / 60));
  return mins < 60 ? `還有 ${mins} 分鐘` : `還有 ${Math.floor(mins / 60)} 小時 ${mins % 60} 分`;
}

function routeTimeLine(r: RouteOut, items: Item[], now: number): string {
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

function render(): void {
  const now = nowSec();
  const all = computeItems(now);
  const spotTotal = all.filter((it) => it.spot).length;
  const items = showSpots ? all : all.filter((it) => !it.spot);
  // 車掃路線上的點出發前也畫（淡色），看得到路線經過哪裡；固定據點還沒開始也畫（淡色），跟清單一致；「雙北」時雙北以外的不畫
  const visible = items.filter((it) => (it.phase !== 'later' || routeOf(it.ev) || it.spot) && (scaleSetting !== 'region' || inScope(it.ev, it.distanceKm)));
  updateOutline();
  filterRow.hidden = spotTotal === 0;
  spotToggle.textContent = `${showSpots ? '✓ ' : ''}顯示固定據點（${spotTotal}）`;
  spotToggle.classList.toggle('on', showSpots);
  spotToggle.setAttribute('aria-pressed', String(showSpots));

  radar.render(
    visible.map((it) => ({
      id: it.ev.id,
      kind: it.ev.kind,
      spot: !!it.spot,
      approx: !!it.ev.approxArea,
      distanceKm: it.distanceKm,
      bearing: it.bearing,
      // 還沒出發的車掃路線點用「即將開始」的淡色畫；還沒開的據點跟休息中的一樣淡
      phase: it.phase === 'later' ? (it.spot ? 'closed' : 'soon') : it.phase,
      label: titleOf(it.ev),
      // 據點整天都開著，標籤只在選取時顯示，免得蓋掉單次的發放
      showLabel: (it.phase === 'active' && !it.spot) || it.ev.id === selectedId,
      selected: it.ev.id === selectedId,
    })),
    shownRoutes(items).map((r) => ({
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
    LANDMARKS.map((lm) => ({ id: lm.id, label: lm.name, bearing: bearingDeg(origin, lm), distanceKm: haversineKm(origin, lm), selected: lm.id === selectedLandmark })),
  );
  map.setRoutes(shownRoutes(items).map((r) => ({ id: r.id, title: r.title, state: routeState(r, now), claimUrl: r.claimUrl, segments: r.segments })));
  map.render(
    items.map((it) => ({
      id: it.ev.id,
      kind: it.ev.kind,
      spot: !!it.spot,
      approx: !!it.ev.approxArea,
      lat: it.ev.lat,
      lng: it.ev.lng,
      phase: it.phase,
      title: `${tagLabel(it)}｜${titleOf(it.ev)}`,
      subtitle: `${placeLine(it.ev)} · ${timeLine(it, now)}`,
      selected: it.ev.id === selectedId,
    })),
  );
  renderList(items, now);
  renderDetail(items, now);

  // 新變成進行中且在雷達範圍內的事件 → 嗶聲、震動、通知。第一次載入不吵。
  for (const it of items) {
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
    const head = it.ev.kind === 'activity' ? '活動開始' : '開始發放';
    showBanner(bannerEl, `${head}：${msg}`, 10_000);
    systemNotify(head, msg);
  }
  if (lastFetchAt > 0) notifiedOnce = true;
}

/** 清單上的一列：一般事件，或合成一張卡片的車掃路線 */
type Row = { it: Item; route?: undefined; phase: Phase; distanceKm: number; inScope: boolean; spot: boolean; sortAt: number } | { route: RouteOut; it?: undefined; phase: Phase; distanceKm: number; inScope: boolean; spot: false; sortAt: number };

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
      rows.push({ it, phase: it.phase, distanceKm: it.distanceKm, inScope: inScope(it.ev, it.distanceKm), spot: !!it.spot, sortAt: it.ev.startAt });
      continue;
    }
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const members = routeItems(r, items);
    rows.push({ route: r, phase: routePhase(r, members, now), distanceKm: Math.min(...members.map((m) => m.distanceKm)), inScope: members.some((m) => inScope(m.ev, m.distanceKm)), spot: false, sortAt: r.departAt ?? it.ev.startAt });
  }
  return rows;
}

const PHASE_TITLE: Partial<Record<Phase, string>> = { active: '進行中', soon: '即將開始', later: '稍後開始' };

function renderList(items: Item[], now: number): void {
  // 摘要和清單用同一套「列」來算：車掃路線的起點、加油點、終點合成一張卡片，只算一個
  const rows = listRows(items, now);
  const inRange = rows.filter((r) => r.inScope);
  const outRange = rows.filter((r) => !r.inScope);
  const singles = inRange.filter((r) => !r.spot);
  const spotsIn = inRange.filter((r) => r.spot);
  const byPhase = (ph: Phase): Row[] =>
    singles
      .filter((r) => r.phase === ph)
      // 進行中照距離，還沒開始的照開始時間
      .sort((a, b) => (ph === 'active' ? a.distanceKm - b.distanceKm : a.sortAt - b.sortAt || a.distanceKm - b.distanceKm));
  const sections: Array<{ title: string; rows: Row[] }> = [
    ...(['active', 'soon', 'later'] as const).map((ph) => ({ title: PHASE_TITLE[ph] as string, rows: byPhase(ph) })),
    { title: '固定據點', rows: spotsIn },
    { title: outLabel(), rows: outRange },
  ];
  const counts = { active: byPhase('active').length, soon: byPhase('soon').length, later: byPhase('later').length };
  const none = followed().length === 0;
  const outText = outRange.length > 0 ? `・${scaleSetting === 'region' ? '雙北以外' : '範圍外'} ${outRange.length} 個` : '';
  const spotText = spotsIn.length > 0 ? `・據點 ${spotsIn.length} 個` : '';
  countLabel.textContent = none
    ? '還沒追蹤關鍵字'
    : singles.length === 0
      ? `${theme.emptyText}${spotText}${outText}`
      : `${theme.summary(counts)}${spotText}${outText}`;
  emptyEl.textContent = none ? (canEditKeywords ? '點下方「追蹤」選擇或新增關鍵字，雷達就會開始找發放和活動。' : '目前沒有搜尋中的關鍵字。') : `${theme.emptyText}。雷達每分鐘更新，有新的會提醒你。`;
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

function itemCard(it: Item, now: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = `ev phase-${it.phase} kind-${it.ev.kind}${it.spot ? ' spot' : ''}${inScope(it.ev, it.distanceKm) ? '' : ' out-of-range'}${it.ev.id === selectedId ? ' selected' : ''}`;
  li.dataset.id = String(it.ev.id);
  li.innerHTML = `
    <div class="ev-title"><span class="dot"></span><span class="kind-tag">${tagLabel(it)}</span>${esc(titleOf(it.ev))}${it.ev.item ? ` <span class="muted">· ${esc(it.ev.item)}</span>` : ''}${followed().length > 1 && it.ev.keyword ? `<span class="ev-kw">#${esc(it.ev.keyword)}</span>` : ''}</div>
    <div class="ev-meta">${esc(placeLine(it.ev))} · ${it.ev.approxArea ? '約 ' : ''}${formatKm(it.distanceKm)} ${compassLabel(it.bearing)}</div>
    <div class="ev-time">${it.spot ? `${esc(spotHours(it.spot.sessions))}・` : ''}${esc(timeLine(it, now))}</div>`;
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
    <div class="ev-meta">${esc(start?.name ?? '')} → ${esc(end?.name ?? '')} · 全長 ${routeKm(r).toFixed(1)} km${nearest ? ` · 最近 ${formatKm(nearest.distanceKm)}` : ''}</div>
    <div class="ev-time">${esc(routeTimeLine(r, items, now))}</div>`;
  li.addEventListener('click', () => selectRoute(r.id));
  return li;
}

/** 車掃路線的時間表：每一站的時間、距離，點了看那一站 */
function renderRouteDetail(r: RouteOut, items: Item[], now: number): void {
  const mine = routeItems(r, items);
  const people = r.segments.reduce((n, s) => n + s.people, 0);
  const target = r.segments.reduce((n, s) => n + s.target, 0);
  const needy = [...r.segments].filter((sg) => crowdOf(sg.people, sg.target) === 'empty' || crowdOf(sg.people, sg.target) === 'low').length;
  const rows = r.stops
    .map((st) => {
      const it = mine.find((x) => x.ev.title === st.title);
      const time = st.at ? `${st.kind === 'cheer' ? '約 ' : ''}${fmtTime(st.at)}` : '—';
      const passed = st.at !== null && st.at <= now && st.kind !== 'end';
      // 終點接著有活動（例如市政開講）就附上活動時間
      const extra = st.kind === 'end' && it && !it.ev.allDay && !it.ev.title.includes('抵達') ? `<small>${esc(it.ev.title.split('・')[0])} ${fmtTime(it.ev.startAt)}–${fmtTime(it.ev.endAt)}</small>` : '';
      const dist = it ? `<small>${formatKm(it.distanceKm)} ${compassLabel(it.bearing)}</small>` : '';
      const body = `<span class="stop-time">${time}</span><span class="stop-name"><b>${STOP_LABEL[st.kind]}</b>${esc(st.name)}${extra}${dist}</span>`;
      return `<li class="stop stop-${st.kind}${passed ? ' passed' : ''}">${it ? `<button type="button" data-select="${it.ev.id}">${body}</button>` : `<div>${body}</div>`}</li>`;
    })
    .join('');
  detailEl.hidden = false;
  setDetailHtml(`route:${r.id}`, `
    <div class="sheet-head">
      <strong>${esc(r.title)}</strong>
      <button type="button" class="chip" data-act="close" aria-label="關閉">關閉</button>
    </div>
    <div class="sheet-body">
      <p>${esc(routeTimeLine(r, items, now))}<br><span class="muted">全長 ${routeKm(r).toFixed(1)} km・沿線認領 ${people.toLocaleString()} / 目標 ${target.toLocaleString()} 人${needy > 0 ? `・還有 ${needy} 段缺人` : ''}（${fmtTime(r.updatedAt)} 更新）</span></p>
      <ol class="route-stops">${rows}</ol>
      <p class="muted sheet-note">加油點的時間是用路線長度平均推算的，實際以現場為準。官方提醒：不跟車，在沿線等車隊經過；不放鞭炮。</p>
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
    // 收起時間表，不然整條路線被蓋住
    selectedRoute = null;
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
        <button type="button" class="btn" data-act="map">在地圖上看</button>
      </div>
    </div>`);
  detailEl.querySelector('[data-act="close"]')?.addEventListener('click', () => selectLandmark(null));
  detailEl.querySelector('[data-act="map"]')?.addEventListener('click', () => {
    selectedLandmark = null;
    render();
    switchView('map');
    map.focusLatLng(lm);
  });
  return true;
}

// ---- 漂流瓶 ----
/** 200 m 內看得到瓶子的樣子，更遠只是一團訊號 */
const BOTTLE_NEAR_M = 200;
/** 伺服器沒關、而且這個瀏覽器打開了實驗功能 */
const bottlesOn = (): boolean => keywordRules?.sources?.bottles?.enabled !== false && lsGet(LS_LAB_BOTTLES) === '1';
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
      <p>類型：${it.spot ? `固定據點（${kindLabel(ev)}）` : kindLabel(ev)}<br>${ev.item ? `發放：${esc(ev.item)}<br>` : ''}${ev.keyword ? `關鍵字：#${esc(ev.keyword)}<br>` : ''}地點：${esc(placeOf(ev))}${ev.approxArea ? `<br><span class="approx-note">約略位置：只知道在${esc(ev.approxArea)}，地圖上是${esc(ev.approxArea)}的中心點，實際地點請看原文</span>` : ''}<br>時間：${it.spot ? esc(spotSchedule(it)) : ev.allDay ? `${dateFmt.format(new Date(ev.startAt * 1000))} ${allDayText(ev, false)}` : ev.endOpen ? `${fmtTime(ev.startAt)} 開始，${openEndText(ev)}` : `${fmtTime(ev.startAt)} – ${fmtTime(ev.endAt)}`}<br>距離：${ev.approxArea ? '約 ' : ''}${formatKm(it.distanceKm)}，${compassLabel(it.bearing)}方 · ${esc(timeLine(it, now))}</p>
      <blockquote>${esc(ev.post.source === 'news' ? ev.post.text.split('\n')[0] : ev.post.text.slice(0, 300))}</blockquote>
      ${ev.post.supplement ? `<p class="muted supplement-line">回報的人補充：${esc(ev.post.supplement)}</p>` : ''}
      <p class="muted source-line">來源：${esc(sourceLabel(ev))}</p>
      ${routeOf(ev) ? '' : it.spot ? spotPostsHtml(ev.related ?? []) : relatedHtml(ev.related ?? [])}
      <div class="sheet-actions">
        <a class="btn primary" href="https://www.google.com/maps/dir/?api=1&destination=${ev.lat},${ev.lng}&travelmode=walking" target="_blank" rel="noopener">${ev.approxArea ? '導航到約略位置' : '導航'}</a>
        ${ev.post.permalink ? `<a class="btn" href="${esc(ev.post.permalink)}" target="_blank" rel="noopener">${esc(sourceLinkText(ev))}</a>` : ''}
        <button type="button" class="btn" data-act="map">在地圖上看</button>
        ${canReportEnded(ev, now) ? `<button type="button" class="btn" data-act="ended"${endedReported.has(ev.id) ? ' disabled' : ''}>${endedReported.has(ev.id) ? '已回報' : `回報${it.spot ? '今天' : ''}${ev.kind === 'activity' ? '已結束' : '已發完'}`}</button>` : ''}
      </div>
      ${ev.endedReports ? `<p class="muted ended-note">已有 ${ev.endedReports} 人回報${ev.kind === 'activity' ? '已結束' : '已發完'}${neededText()}</p>` : ''}
    </div>`);
  detailEl.querySelector('[data-act="close"]')?.addEventListener('click', () => select(null));
  for (const b of detailEl.querySelectorAll<HTMLButtonElement>('[data-select]')) {
    b.addEventListener('click', () => select(Number(b.dataset.select)));
  }
  detailEl.querySelector('[data-act="map"]')?.addEventListener('click', () => {
    switchView('map');
    map.focus(ev.id);
  });
  detailEl.querySelector('[data-act="ended"]')?.addEventListener('click', (e) => void sendEnded(ev, e.currentTarget as HTMLButtonElement));
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
function canReportEnded(ev: EventOut, now: number): boolean {
  return ev.post.source !== 'official' && ev.startAt <= now;
}

function neededText(): string {
  const n = keywordRules?.sources?.link?.endedReportsNeeded;
  return n ? `，${n} 人回報就會下架` : '';
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

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function setOrigin(o: Origin): void {
  const moved = haversineKm(origin, o) > 0.2;
  origin = o;
  if (o.source === 'manual') lsSet(LS_ORIGIN, JSON.stringify(o));
  map.setOrigin(o, moved, o.source === 'gps' ? gpsAccuracy : null);
  originLabel.textContent = o.source === 'gps' ? 'GPS 定位' : o.source === 'manual' ? '手動位置' : '預設：台北車站';
  useGpsBtn.hidden = o.source !== 'manual';
  if (isAutoScale(scaleSetting) && scaleKmFor(scaleSetting) !== scaleKm) {
    scaleKm = scaleKmFor(scaleSetting);
    radar.setScale(scaleKm);
  }
  if (moved) void refresh();
  else render();
}

async function refresh(): Promise<void> {
  const kws = followed();
  // 漂流瓶跟關鍵字無關，一起抓
  const bottleReq = bottlesOn() ? fetchBottles(origin, FETCH_RADIUS_KM) : Promise.resolve([] as BottleOut[]);
  if (kws.length === 0) {
    events = [];
    bottles = await bottleReq;
    render();
    return;
  }
  try {
    [events, routes, bottles] = await Promise.all([fetchEvents(origin, FETCH_RADIUS_KM, kws), fetchRoutes(), bottleReq]);
    lastFetchAt = nowSec();
    updatedLabel.textContent = `更新 ${fmtTime(lastFetchAt)}`;
  } catch (e) {
    updatedLabel.textContent = '連線失敗';
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

function scaleKmFor(setting: ScaleSetting): number {
  if (setting === 'custom') return Math.min(Math.max(customKm, MIN_ZOOM_KM), taiwanRadiusKm(origin));
  if (setting === 'region') return shuangbeiRadiusKm(origin);
  if (setting === 'taiwan') return taiwanRadiusKm(origin);
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
  const max = taiwanRadiusKm(origin);
  customKm = Math.min(Math.max(scaleKm * factor, MIN_ZOOM_KM), max);
  if (done) {
    const near = SCALE_SETTINGS.find((st) => Math.abs(scaleKmFor(st) / customKm - 1) < 0.06);
    if (near) {
      setScale(near);
      return;
    }
    lsSet(LS_SCALE_KM, customKm.toFixed(2));
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

function setScale(setting: ScaleSetting): void {
  scaleSetting = setting;
  scaleKm = scaleKmFor(setting);
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
      if (origin.source === 'manual') return;
      gpsAccuracy = pos.coords.accuracy;
      setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps' });
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

function applyTheme(t: Theme): void {
  theme = t;
  document.documentElement.dataset.theme = t.id;
  document.title = t.name;
  map.setDark(t.id === 'dragon' || t.id === 'neon');
  brandText.textContent = t.name;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.themeColor);
  radar.setStyle({ sweep: t.sweep, blip: t.blip, rose: t.rose });
  emptyEl.textContent = `${t.emptyText}。雷達每分鐘更新，有新的會提醒你。`;
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
  kwBtn.setAttribute('aria-label', canEditKeywords ? '管理追蹤的關鍵字' : '查看搜尋中的關鍵字與判讀規則');
  (kwBtn.querySelector('.kw-edit') as HTMLElement).textContent = canEditKeywords ? '編輯' : '說明';
  kwTitle.textContent = canEditKeywords ? '追蹤關鍵字' : '搜尋中的關鍵字';
  kwIntro.textContent = canEditKeywords
    ? '點一下切換追蹤。雷達只顯示你追蹤的關鍵字找到的發放。'
    : '系統會用這些關鍵字定時搜尋 Threads 與新聞，再加上官方行程，目前不開放修改。';
  kwForm.hidden = !canEditKeywords;
  kwShareNote.hidden = !canEditKeywords;
  renderRules();
  (kwBtn.querySelector('.kw-label') as HTMLElement).textContent = canEditKeywords ? '追蹤' : '搜尋中';
  kwSummary.replaceChildren();
  if (f.length === 0) {
    const s = document.createElement('span');
    s.className = 'kw-tag more';
    s.textContent = '尚未選擇';
    kwSummary.appendChild(s);
  } else {
    const shown = canEditKeywords ? 2 : 3;
    for (const t of f.slice(0, shown)) {
      const s = document.createElement('span');
      s.className = 'kw-tag';
      s.textContent = t;
      kwSummary.appendChild(s);
    }
    if (f.length > shown) {
      const s = document.createElement('span');
      s.className = 'kw-tag more';
      s.textContent = `+${f.length - shown}`;
      kwSummary.appendChild(s);
    }
  }

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
      <li><b>固定據點</b>：店家、服務處等連續好幾天在固定時段都能去領或參加的，標成「據點」，雷達上是<span class="ex">菱形</span>光點，休息時間變淡。沒寫最後一天的寫「發完為止」，${r.spotDefaultDays ?? 7} 天後自動下架。可以用清單上方的「顯示固定據點」開關隱藏。</li>
    </ul>
    <h3>時間地點怎麼判讀</h3>
    <ol>
      <li>貼文要同時寫出<b>時間</b>和<b>地點</b>，缺一個就不會出現在雷達上。</li>
      <li>時間可以寫 <span class="ex">10/18 15:00</span>、<span class="ex">今天下午三點</span>、<span class="ex">明晚 7 點</span>、<span class="ex">週六 14:00–16:00</span>。「今天、明天、週六」以發文時間換算，時區是台灣時間。</li>
      <li>沒寫結束時間，或寫「發完為止」：畫面上寫「發完為止」（活動寫「沒寫結束時間」），不猜幾點結束。為了不讓舊的一直留在雷達上，開始 ${hours}後會自動下架；固定據點沒寫最後一天的，${r.spotDefaultDays ?? 7} 天後下架。</li>
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
    <p class="legal-links"><a href="help.html" target="_blank" rel="noopener">使用說明</a> · <a href="privacy.html" target="_blank" rel="noopener">隱私權政策</a> · <a href="terms.html" target="_blank" rel="noopener">服務條款</a> · <a href="data-deletion.html" target="_blank" rel="noopener">資料刪除</a></p>`;
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
/** 顯示用的標題：固定據點用店家名稱（從地點拆出來），拆不出來才用判讀的標題 */
function titleOf(ev: EventOut): string {
  return (ev.spot && splitPlace(ev.placeText).name) || ev.title;
}

/** 地點文字：據點的標題已經是店名，這裡只寫地址 */
function placeOf(ev: EventOut): string {
  const p = ev.spot ? splitPlace(ev.placeText) : null;
  return p?.name ? p.address : ev.placeText;
}

function placeLine(ev: EventOut): string {
  return ev.approxArea ? `${placeOf(ev)}（約略位置：${ev.approxArea}）` : placeOf(ev);
}

function kindLabel(ev: EventOut): string {
  return ev.kind === 'activity' ? '活動' : '發放';
}

/** 清單與地圖上的標籤：固定據點另外標「據點」 */
function tagLabel(it: Item): string {
  return it.spot ? '據點' : kindLabel(it.ev);
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

function openReportSheet(open: boolean): void {
  reportSheet.hidden = !open;
  if (!open) return;
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
  const tips = [
    '在 Threads 貼文按「分享」→「複製連結」，再貼到上面。Android 把洋流雷達加到主畫面後，也可以直接分享到洋流雷達。',
    `只收${l ? ` ${l.maxAgeDays} 天內` : ''}的公開貼文，貼文要寫出時間和地點。`,
    `原貼文刪除或改成「發完了」，雷達${l ? ` ${l.recheckMin} 分鐘內` : ''}會自動下架。`,
    '店家、服務處連續好幾天都能去領的（例如「明天起到服務處領取」），一樣貼連結，會自動判斷成固定據點，每天開放的時段都標上雷達。貼文最好寫出門牌地址，定位才準。',
  ];
  reportTips.innerHTML = tips.map((t) => `<li>${esc(t)}</li>`).join('');
}

const OUTCOME_TEXT: Record<SubmitResult['outcome'], string> = {
  preview: '判讀結果如下，請確認一次：',
  added: '已加入雷達：',
  duplicate: '雷達上已經有這一場了：',
  attached: '雷達上已經有這個據點，這則已附在它的詳細資料（相關貼文）：',
  no_place: '看得出是發放或活動，但貼文沒寫具體地點（或查不到），所以還沒放上雷達。知道在哪裡的話，可以在下面補充地點再判讀一次。',
  not_listed: '判讀不出時間，或是已經結束、超過 14 天後才開始，所以沒有放上雷達。',
  not_event: '這則看起來不是發放或活動。貼文要寫出在哪裡、什麼時候發放或舉辦，雷達才會收。',
  failed: '判讀暫時失敗，請稍後再貼一次。',
};

function setReportMsg(html: string): void {
  reportResult.innerHTML = html;
}

/** 判讀中鎖住輸入框和按鈕，免得改到網址或重複送出 */
let reportBusy = false;
function setReportBusy(busy: boolean, label = '判讀中…'): void {
  reportBusy = busy;
  reportInput.disabled = busy;
  reportSubmit.disabled = busy;
  reportPaste.disabled = busy;
  reportSubmit.textContent = busy ? label : '送出';
  for (const b of reportResult.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button, textarea')) b.disabled = busy;
}

/** 預覽上的時間：固定據點寫每天幾點、從哪天起排幾天；一般的寫哪天幾點到幾點 */
function previewWhen(p: PreviewItem): string {
  const day = (t: number): string => dateFmt.format(new Date(t * 1000));
  // 一天好幾個時段：「12:00–13:30、18:00–20:30」
  const slots = p.slots && p.slots.length > 1 ? p.slots.map((s) => `${fmtTime(s.startAt)}–${fmtTime(s.endAt)}`).join('、') : null;
  if (p.spot) {
    const hours = p.allDay ? '整天' : slots ?? (p.endOpen ? `${fmtTime(p.startAt)} 起（開到當天結束）` : `${fmtTime(p.startAt)}–${fmtTime(p.endAt)}`);
    const range = p.days > 1 ? `${day(p.startAt)} 到 ${day(p.lastStartAt)}，共 ${p.days} 天` : day(p.startAt);
    return `${weeklyText(p.weekdays) ?? '每天'} ${hours}・${range}${p.untilOpen ? '（貼文沒寫最後一天，先排這幾天，發完為止）' : ''}`;
  }
  if (p.allDay) return `${day(p.startAt)} 整天`;
  if (slots) return `${day(p.startAt)} ${slots}`;
  return `${day(p.startAt)} ${fmtTime(p.startAt)}${p.endOpen ? ' 開始（沒寫結束時間）' : `–${fmtTime(p.endAt)}`}`;
}

/** 預覽上的定位：精確、約略（只到鄉鎮區）、找不到；有座標就附「在地圖上看」 */
function previewWhere(p: PreviewItem): string {
  if (p.lat === null || p.lng === null) return '<span class="preview-warn">找不到地點，確認了也不會出現在雷達上</span>';
  const link = `<a href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}" target="_blank" rel="noopener">在地圖上看</a>`;
  return p.approxArea ? `<span class="preview-warn">只定位到${esc(p.approxArea)}（約略位置）</span>・${link}` : `已定位・${link}`;
}

/** 補充資料的表單：貼文沒寫地點或時間時，回報的人補上再判讀一次 */
function supplementFormHtml(current: string, hidden: boolean): string {
  return `<form class="preview-more"${hidden ? ' hidden' : ''}>
      <textarea rows="2" maxlength="200" placeholder="例如「地點：厝邊咖啡，台北市萬華區○○路○號」「每週二、四 14:00–18:00」" aria-label="補充地點或時間">${esc(current)}</textarea>
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
    const note = form.querySelector('textarea')?.value.trim() ?? '';
    if (note.length < 2) {
      showBanner(bannerEl, '請寫要補充的地點或時間', 2500);
      return;
    }
    setReportBusy(true, '重新判讀中…');
    const res = await supplementReport(c, note).finally(() => setReportBusy(false));
    if (!res.ok) {
      showBanner(bannerEl, res.message, 3500);
      return;
    }
    if (res.data.outcome === 'preview') renderPreview(res.data);
    else await showReportResult(res.data);
  });
}

/** 雷達上已經有這個據點時，確認後會怎樣 */
function updateNote(u: NonNullable<PreviewItem['update']>): string {
  return u.mode === 'replace'
    ? `雷達上已經有「${u.title}」，這則是同一個帳號的新貼文：確認後據點改成以這則為準，舊貼文留在詳細資料。`
    : `雷達上已經有「${u.title}」：確認後這則附在它的詳細資料（相關貼文），據點的內容不變。`;
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
    <ul class="report-preview">${items
      .map(
        (p) => `<li>
          <b>${p.kind === 'activity' ? '活動' : '發放'}${p.spot ? '・固定據點' : ''}｜${esc(p.title)}</b>
          ${p.item ? `<small>${esc(p.item)}</small>` : ''}
          <small>時間：${esc(previewWhen(p))}</small>
          <small>地點：${esc(p.placeText.replace(/\s*\n\s*/g, ' '))}</small>
          <small>${previewWhere(p)}</small>
          ${p.update ? `<small class="preview-warn">${esc(updateNote(p.update))}</small>` : ''}
        </li>`,
      )
      .join('')}</ul>
    ${dups}
    <div class="sheet-actions">
      <button type="button" class="btn primary" data-act="confirm">${items.length > 0 && items.every((p) => p.update?.mode === 'attach') ? '對，附在這個據點' : '對，放上雷達'}</button>
      <button type="button" class="btn" data-act="more">補充資料</button>
      <button type="button" class="btn" data-act="wrong">不對</button>
    </div>
    ${supplementFormHtml(r.supplement ?? '', true)}
    <form class="preview-wrong" hidden>
      <textarea rows="2" maxlength="300" placeholder="哪裡判斷錯了？（選填，例如「地點是文化路 140 號」「只有 10/21 一天」）" aria-label="哪裡判斷錯了"></textarea>
      <div class="sheet-actions"><button type="submit" class="btn primary">送出，不放上雷達</button><button type="button" class="btn" data-act="back">回上一步</button></div>
    </form>`);
  const wrongForm = reportResult.querySelector<HTMLFormElement>('.preview-wrong');
  const actions = reportResult.querySelector<HTMLElement>('.sheet-actions');
  reportResult.querySelector('[data-act="confirm"]')?.addEventListener('click', async () => {
    setReportBusy(true, '放上雷達中…');
    const res = await confirmReport(c).finally(() => setReportBusy(false));
    if (!res.ok) {
      showBanner(bannerEl, res.message, 3500);
      return;
    }
    await showReportResult(res.data);
  });
  wireSupplement(c, actions);
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
    const note = wrongForm.querySelector('textarea')?.value ?? '';
    setReportBusy(true, '送出中…');
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
  if (reportBusy) return;
  const url = reportInput.value.trim();
  if (!url) {
    setReportMsg('<p class="msg error">請先貼上 Threads 貼文連結</p>');
    return;
  }
  setReportBusy(true);
  setReportMsg('<p class="msg busy">讀取貼文並判讀中，約需 10 秒</p>');
  const r = await submitLink(url).finally(() => setReportBusy(false));
  if (!r.ok) {
    setReportMsg(`<p class="msg error">${esc(r.message)}</p>`);
    return;
  }
  if (r.data.outcome === 'preview') {
    renderPreview(r.data);
    return;
  }
  await showReportResult(r.data);
}

/** 判讀或確認後的結果：放上雷達的、重複的，點了跳到那一場 */
async function showReportResult(data: SubmitResult): Promise<void> {
  const { outcome, events: found, existed } = data;
  const head = existed && (outcome === 'added' || outcome === 'duplicate' || outcome === 'attached') ? '這則之前已經有人回報，已在雷達上：' : OUTCOME_TEXT[outcome];
  const list = found
    .map((ev) => {
      const when = ev.allDay ? `${dateFmt.format(new Date(ev.startAt * 1000))} ${allDayText(ev, false)}` : `${dateFmt.format(new Date(ev.startAt * 1000))} ${fmtTime(ev.startAt)}`;
      return `<li><button type="button" data-id="${ev.id}"><b>${kindLabel(ev)}｜${esc(titleOf(ev))}</b><small>${esc(placeLine(ev))} · ${esc(when)}</small></button></li>`;
    })
    .join('');
  // 還沒放上雷達（找不到地點、判讀不出時間）：可以補充資料再判讀一次
  const canSupplement = !!data.confirm && (outcome === 'no_place' || outcome === 'not_listed' || outcome === 'not_event');
  setReportMsg(
    `<p class="msg">${esc(head)}</p>${list ? `<ul class="report-events">${list}</ul>` : ''}${
      canSupplement ? `${data.supplement ? `<p class="muted sheet-note">你補充的：${esc(data.supplement)}</p>` : ''}${supplementFormHtml(data.supplement ?? '', false)}` : ''
    }`,
  );
  if (canSupplement && data.confirm) wireSupplement(data.confirm, null);
  for (const b of reportResult.querySelectorAll<HTMLButtonElement>('[data-id]')) {
    b.addEventListener('click', () => {
      reportSheet.hidden = true;
      bottleSheet.hidden = true;
      selectedId = null;
      select(Number(b.dataset.id));
    });
  }
  if (found.length > 0) {
    reportInput.value = '';
    await refresh();
  }
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

/** 通知按鈕：開著就關掉，關著就打開（第一次會問瀏覽器要通知權限） */
async function toggleNotify(): Promise<void> {
  if (notifyOn()) {
    lsSet(LS_NOTIFY, 'off');
    updateNotifyBtn();
    showBanner(bannerEl, '通知已關閉，發放或活動開始時不會再響或跳通知');
    return;
  }
  unlockAudio();
  lsSet(LS_NOTIFY, 'on');
  const ok = await ensureNotificationPermission();
  updateNotifyBtn();
  showBanner(bannerEl, ok ? '通知已開啟，發放或活動開始時會提醒你。再按一次「通知」可以關掉' : '已開啟音效提醒；系統通知未取得權限。再按一次「通知」可以關掉');
  beep(theme.sound);
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
  for (const b of baseChips) b.addEventListener('click', () => setBase(b.dataset.base as BaseMap));
  compassBtn.addEventListener('click', () => void toggleCompass());
  notifyBtn.addEventListener('click', () => void toggleNotify());
  themeBtn.addEventListener('click', () => {
    unlockAudio();
    openThemeSheet(themeSheet.hidden);
  });
  themeSheet.querySelector('[data-act="close"]')?.addEventListener('click', () => openThemeSheet(false));
  kwBtn.addEventListener('click', () => openKwSheet(kwSheet.hidden));
  kwSheet.querySelector('[data-act="close"]')?.addEventListener('click', () => openKwSheet(false));
  kwForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitKeyword(kwInput.value);
  });
  reportBtn.addEventListener('click', () => openReportSheet(reportSheet.hidden));
  spotToggle.addEventListener('click', () => {
    showSpots = !showSpots;
    lsSet(LS_SPOTS, showSpots ? '1' : '0');
    render();
  });
  reportSheet.querySelector('[data-act="close"]')?.addEventListener('click', () => openReportSheet(false));
  reportForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitReport();
  });
  bottleBtn.addEventListener('click', () => openBottleSheet(bottleSheet.hidden));
  bottleSheet.querySelector('[data-act="close"]')?.addEventListener('click', () => openBottleSheet(false));
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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && nowSec() - lastFetchAt > 30) {
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
  applyTheme(theme);
  setBase(baseMap);
  switchView('radar');
  setScale(scaleSetting);
  setOrigin(origin);
  startGeolocation();
  showVersion(null);
  try {
    const h = await fetchHealth();
    showVersion(h.version ?? null);
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
  window.setInterval(render, TICK_MS);
  window.setInterval(() => void refresh(), POLL_MS);
}

void boot();
