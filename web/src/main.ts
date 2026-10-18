import './styles.css';
import { addKeyword, fetchEvents, fetchHealth, fetchKeywords, reportEnded, submitLink } from './api';
import { compassSupported, startCompass } from './compass';
import { bearingDeg, compassLabel, formatKm, haversineKm, shuangbeiRadiusKm, taiwanRadiusKm, type LatLng } from './geo';
import { MapView, type BaseMap } from './map';
import { beep, ensureNotificationPermission, notificationState, showBanner, systemNotify, unlockAudio } from './notify';
import { Radar } from './radar';
import { DEFAULT_THEME_ID, getTheme, THEMES, type Theme } from './themes';
import type { EventOut, Item, KeywordInfo, KeywordRules, Origin, Phase, SubmitResult } from './types';

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
const filterRow = $('#filter-row');
const spotToggle = $<HTMLButtonElement>('#spot-toggle');
const baseChipsEl = $('#base-chips');
const baseChips = Array.from(document.querySelectorAll<HTMLButtonElement>('#base-chips [data-base]'));
let baseMap: BaseMap = (BASES as string[]).includes(lsGet(LS_BASE) ?? '') ? (lsGet(LS_BASE) as BaseMap) : 'nlsc';
/** 最近一次 GPS 的誤差（公尺），手動或預設位置時為 null */
let gpsAccuracy: number | null = null;
const scaleChips = Array.from(document.querySelectorAll<HTMLButtonElement>('#scale-chips [data-scale]'));

const radar = new Radar($('#radar-view'), select, (factor, done) => zoomRadar(factor, done));
const map = new MapView(
  $('#map'),
  origin,
  {
    onSelect: select,
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

/** 固定據點的開放時段，例如「每天 11:00–18:00」 */
function spotHours(ev: EventOut): string {
  return ev.allDay ? '每天整天' : `每天 ${fmtTime(ev.startAt)}–${fmtTime(ev.endAt)}`;
}

function spotUntil(it: Item, now: number): string {
  const last = it.spot?.sessions.at(-1);
  if (!last) return '';
  return taipeiDay(last.startAt) === taipeiDay(now) ? '今天最後一天' : `到 ${dateFmt.format(new Date(last.startAt * 1000))}`;
}

function spotLine(it: Item, now: number): string {
  const { ev } = it;
  const until = spotUntil(it, now);
  if (ev.startAt <= now && now < ev.endAt) {
    return ev.allDay ? `開放中・${until}` : `營業中・今天到 ${fmtTime(ev.endAt)}・${until}`;
  }
  const next = ev.allDay ? `${dayWord(ev.startAt, now)}開放` : `${dayWord(ev.startAt, now)} ${fmtTime(ev.startAt)} 開始`;
  return `休息中・${next}・${until}`;
}

/** 沒有開始時間的：整天，或知道最晚到幾點（例如加油點到車隊靠港為止） */
function allDayText(ev: EventOut, today: boolean): string {
  if (ev.endAt - ev.startAt >= 86400 - 60) return today ? '今天整天' : '整天';
  return `${today ? '今天' : ''}到 ${fmtTime(ev.endAt)}`;
}

function timeLine(it: Item, now: number): string {
  if (it.spot) return spotLine(it, now);
  const { ev } = it;
  if (ev.allDay) {
    const today = ev.startAt <= now && now < ev.endAt;
    return today ? `進行中 · ${allDayText(ev, true)}` : `${dateFmt.format(new Date(ev.startAt * 1000))} ${allDayText(ev, false)}`;
  }
  if (it.phase === 'active') {
    const left = Math.max(0, Math.round((ev.endAt - now) / 60));
    return `進行中 · 約 ${left} 分鐘後結束`;
  }
  const mins = Math.round((ev.startAt - now) / 60);
  if (mins < 60) return `${fmtTime(ev.startAt)} 開始 · 還有 ${mins} 分鐘`;
  if (mins < 24 * 60) return `${fmtTime(ev.startAt)} 開始 · 還有 ${Math.floor(mins / 60)} 小時 ${mins % 60} 分`;
  return `${new Date(ev.startAt * 1000).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' })} ${fmtTime(ev.startAt)} 開始`;
}

function render(): void {
  const now = nowSec();
  const all = computeItems(now);
  const spotTotal = all.filter((it) => it.spot).length;
  const items = showSpots ? all : all.filter((it) => !it.spot);
  const visible = items.filter((it) => it.phase !== 'later');
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
      phase: it.phase,
      label: it.ev.title,
      // 據點整天都開著，標籤只在選取時顯示，免得蓋掉單次的發放
      showLabel: (it.phase === 'active' && !it.spot) || it.ev.id === selectedId,
      selected: it.ev.id === selectedId,
    })),
  );
  map.render(
    items.map((it) => ({
      id: it.ev.id,
      kind: it.ev.kind,
      spot: !!it.spot,
      approx: !!it.ev.approxArea,
      lat: it.ev.lat,
      lng: it.ev.lng,
      phase: it.phase,
      title: `${tagLabel(it)}｜${it.ev.title}`,
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
    // 整天的沒有「開始」的時間點，不然半夜 12 點會一起響
    if (!notifiedOnce || it.distanceKm > scaleKm || it.ev.allDay) continue;
    beep(theme.sound);
    try {
      navigator.vibrate?.([120, 80, 160]);
    } catch {
      /* ignore */
    }
    const msg = `${it.ev.title}｜${it.ev.placeText}｜${formatKm(it.distanceKm)} ${compassLabel(it.bearing)}`;
    const head = it.spot ? '據點開放中' : it.ev.kind === 'activity' ? '活動開始' : '開始發放';
    showBanner(bannerEl, `${head}：${msg}`, 10_000);
    systemNotify(head, msg);
  }
  if (lastFetchAt > 0) notifiedOnce = true;
}

function renderList(items: Item[], now: number): void {
  const inRange = items.filter((it) => it.distanceKm <= scaleKm);
  const outRange = items.filter((it) => it.distanceKm > scaleKm);
  // 摘要只算單次的發放和活動，固定據點另外列
  const singles = inRange.filter((it) => !it.spot);
  const counts = {
    active: singles.filter((it) => it.phase === 'active').length,
    soon: singles.filter((it) => it.phase === 'soon').length,
    later: singles.filter((it) => it.phase === 'later').length,
  };
  const spotsIn = inRange.length - singles.length;
  const none = followed().length === 0;
  const outText = outRange.length > 0 ? `・範圍外 ${outRange.length} 個` : '';
  const spotText = spotsIn > 0 ? `・據點 ${spotsIn} 個` : '';
  countLabel.textContent = none
    ? '還沒追蹤關鍵字'
    : singles.length === 0
      ? `${theme.emptyText}${spotText}${outText}`
      : `${theme.summary(counts)}${spotText}${outText}`;
  emptyEl.textContent = none ? (canEditKeywords ? '點下方「追蹤」選擇或新增關鍵字，雷達就會開始找發放和活動。' : '目前沒有搜尋中的關鍵字。') : `${theme.emptyText}。雷達每分鐘更新，有新的會提醒你。`;
  listEl.replaceChildren();
  emptyEl.hidden = items.length > 0;
  const rows: Array<Item | 'divider'> = [...inRange, ...(outRange.length > 0 ? (['divider'] as const) : []), ...outRange];
  for (const it of rows) {
    if (it === 'divider') {
      const d = document.createElement('li');
      d.className = 'ev-divider';
      d.textContent = `雷達範圍外（${outRange.length}）`;
      listEl.appendChild(d);
      continue;
    }
    const li = document.createElement('li');
    li.className = `ev phase-${it.phase} kind-${it.ev.kind}${it.spot ? ' spot' : ''}${it.distanceKm > scaleKm ? ' out-of-range' : ''}${it.ev.id === selectedId ? ' selected' : ''}`;
    li.dataset.id = String(it.ev.id);
    li.innerHTML = `
      <div class="ev-title"><span class="dot"></span><span class="kind-tag">${tagLabel(it)}</span>${esc(it.ev.title)}${it.ev.item ? ` <span class="muted">· ${esc(it.ev.item)}</span>` : ''}${followed().length > 1 && it.ev.keyword ? `<span class="ev-kw">#${esc(it.ev.keyword)}</span>` : ''}</div>
      <div class="ev-meta">${esc(placeLine(it.ev))} · ${it.ev.approxArea ? '約 ' : ''}${formatKm(it.distanceKm)} ${compassLabel(it.bearing)}</div>
      <div class="ev-time">${it.spot ? `${esc(spotHours(it.ev))}・` : ''}${esc(timeLine(it, now))}</div>`;
    li.addEventListener('click', () => select(it.ev.id));
    listEl.appendChild(li);
  }
}

function renderChooser(items: Item[], now: number): void {
  const list = (choosing ?? []).map((id) => items.find((x) => x.ev.id === id)).filter((x): x is Item => !!x);
  if (list.length === 0) {
    choosing = null;
    detailEl.hidden = true;
    return;
  }
  detailEl.hidden = false;
  detailEl.innerHTML = `
    <div class="sheet-head">
      <strong>這裡有 ${list.length} 個</strong>
      <button type="button" class="chip" data-act="close" aria-label="關閉">關閉</button>
    </div>
    <div class="sheet-body">
      <p class="muted sheet-note">位置疊在一起，選一個看詳細資料。</p>
      <ul class="report-events">${list
        .map(
          (it) =>
            `<li><button type="button" data-select="${it.ev.id}"><b>${esc(tagLabel(it))}｜${esc(it.ev.title)}</b><small>${esc(placeLine(it.ev))} · ${it.ev.approxArea ? '約 ' : ''}${formatKm(it.distanceKm)} ${compassLabel(it.bearing)}</small><small>${esc(timeLine(it, now))}</small></button></li>`,
        )
        .join('')}</ul>
    </div>`;
  detailEl.querySelector('[data-act="close"]')?.addEventListener('click', () => select(null));
  for (const b of detailEl.querySelectorAll<HTMLButtonElement>('[data-select]')) {
    b.addEventListener('click', () => select(Number(b.dataset.select)));
  }
}

function renderDetail(items: Item[], now: number): void {
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
    detailEl.hidden = true;
    return;
  }
  const { ev } = it;
  detailEl.hidden = false;
  detailEl.innerHTML = `
    <div class="sheet-head">
      <strong>${esc(ev.title)}</strong>
      <button type="button" class="chip" data-act="close" aria-label="關閉">關閉</button>
    </div>
    <div class="sheet-body">
      ${nearbyHtml(it, items)}
      <p>類型：${it.spot ? `固定據點（${kindLabel(ev)}）` : kindLabel(ev)}<br>${ev.item ? `發放：${esc(ev.item)}<br>` : ''}${ev.keyword ? `關鍵字：#${esc(ev.keyword)}<br>` : ''}地點：${esc(ev.placeText)}${ev.approxArea ? `<br><span class="approx-note">約略位置：只知道在${esc(ev.approxArea)}，地圖上是${esc(ev.approxArea)}的中心點，實際地點請看原文</span>` : ''}<br>時間：${it.spot ? esc(spotSchedule(it)) : ev.allDay ? `${dateFmt.format(new Date(ev.startAt * 1000))} ${allDayText(ev, false)}` : `${fmtTime(ev.startAt)} – ${fmtTime(ev.endAt)}`}<br>距離：${ev.approxArea ? '約 ' : ''}${formatKm(it.distanceKm)}，${compassLabel(it.bearing)}方 · ${esc(timeLine(it, now))}</p>
      <blockquote>${esc(ev.post.source === 'news' ? ev.post.text.split('\n')[0] : ev.post.text.slice(0, 300))}</blockquote>
      <p class="muted source-line">來源：${esc(sourceLabel(ev))}</p>
      <div class="sheet-actions">
        <a class="btn primary" href="https://www.google.com/maps/dir/?api=1&destination=${ev.lat},${ev.lng}&travelmode=walking" target="_blank" rel="noopener">${ev.approxArea ? '導航到約略位置' : '導航'}</a>
        ${ev.post.permalink ? `<a class="btn" href="${esc(ev.post.permalink)}" target="_blank" rel="noopener">${esc(sourceLinkText(ev))}</a>` : ''}
        <button type="button" class="btn" data-act="map">在地圖上看</button>
        ${canReportEnded(ev, now) ? `<button type="button" class="btn" data-act="ended"${endedReported.has(ev.id) ? ' disabled' : ''}>${endedReported.has(ev.id) ? '已回報' : `回報${it.spot ? '今天' : ''}${ev.kind === 'activity' ? '已結束' : '已發完'}`}</button>` : ''}
      </div>
      ${ev.endedReports ? `<p class="muted ended-note">已有 ${ev.endedReports} 人回報${ev.kind === 'activity' ? '已結束' : '已發完'}${neededText()}</p>` : ''}
    </div>`;
  detailEl.querySelector('[data-act="close"]')?.addEventListener('click', () => select(null));
  for (const b of detailEl.querySelectorAll<HTMLButtonElement>('[data-select]')) {
    b.addEventListener('click', () => select(Number(b.dataset.select)));
  }
  detailEl.querySelector('[data-act="map"]')?.addEventListener('click', () => {
    switchView('map');
    map.focus(ev.id);
  });
  detailEl.querySelector('[data-act="ended"]')?.addEventListener('click', (e) => void sendEnded(ev, e.currentTarget as HTMLButtonElement));
}

/** 雷達上跟這個疊在一起的其他光點，做成按鈕可以切過去 */
function nearbyHtml(it: Item, items: Item[]): string {
  const others = selectedGroup
    .filter((id) => id !== it.ev.id)
    .map((id) => items.find((x) => x.ev.id === id))
    .filter((x): x is Item => !!x);
  if (others.length === 0) return '';
  const btns = others.map((o) => `<button type="button" class="chip small" data-select="${o.ev.id}">${esc(o.ev.title)}</button>`).join('');
  return `<div class="nearby"><span class="muted">雷達上同一點還有 ${others.length} 個：</span>${btns}</div>`;
}

/** 固定據點的完整時段，例如「每天 11:00–18:00，10/18（六）到 10/19（日）」 */
function spotSchedule(it: Item): string {
  const s = it.spot?.sessions ?? [];
  const first = s[0];
  const last = s.at(-1);
  if (!first || !last) return '';
  const range = first === last ? dateFmt.format(new Date(first.startAt * 1000)) : `${dateFmt.format(new Date(first.startAt * 1000))} 到 ${dateFmt.format(new Date(last.startAt * 1000))}`;
  return `${spotHours(it.ev)}，${range}`;
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
    showBanner(bannerEl, `謝謝回報，「${ev.title}」已從雷達下架`, 3000);
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

function select(id: number | null, group: number[] = []): void {
  if (group.length > 1) {
    // 疊在一起的先列出來讓人選；同一群再點一次就收起
    choosing = sameGroup(choosing, group) ? null : group;
    selectedGroup = group;
    selectedId = null;
    if (choosing) {
      themeSheet.hidden = true;
      kwSheet.hidden = true;
      reportSheet.hidden = true;
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
  if (kws.length === 0) {
    events = [];
    render();
    return;
  }
  try {
    events = await fetchEvents(origin, FETCH_RADIUS_KM, kws);
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
  view = v;
  $('#radar-view').hidden = v !== 'radar';
  $('#map-view').hidden = v !== 'map';
  viewBtn.textContent = v === 'radar' ? '地圖' : '雷達';
  pickBtn.hidden = v !== 'map';
  $('#scale-chips').hidden = v !== 'radar';
  baseChipsEl.hidden = v !== 'map';
  compassBtn.hidden = v !== 'radar' || !compassSupported();
  if (v === 'map') map.showRange(scaleKm, rangePx);
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
    selectedId = null;
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
      : `<li><b>Threads</b>：<span class="pending-tag">等待 Meta 審核</span> 審核通過後，就會每 ${r.intervalMin} 分鐘用上面的關鍵字搜尋 Threads 上所有人的公開貼文。目前只搜得到測試帳號自己的貼文。</li>`;
  kwRulesEl.innerHTML = `
    <h3>資料來源</h3>
    <ul>
      ${src ? `<li><b>官方行程</b>：<a href="${esc(src.official.url)}" target="_blank" rel="noopener">${esc(src.official.name)}</a>，每 ${src.official.intervalMin} 分鐘更新車掃日期、終點與加油點。官網公布車隊抵達終點（靠港）的時間時，終點從那時開始、保留 1 小時，加油點到靠港時間為止；沒公布時間的當成整天，當天都算進行中。</li>
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
      <li><b>固定據點</b>：店家、服務處等連續好幾天在固定時段都能去領或參加的，標成「據點」，雷達上是<span class="ex">菱形</span>光點，休息時間變淡。沒寫最後一天的，保留 ${r.spotDefaultDays ?? 7} 天。可以用清單上方的「顯示固定據點」開關隱藏。</li>
    </ul>
    <h3>時間地點怎麼判讀</h3>
    <ol>
      <li>貼文要同時寫出<b>時間</b>和<b>地點</b>，缺一個就不會出現在雷達上。</li>
      <li>時間可以寫 <span class="ex">10/18 15:00</span>、<span class="ex">今天下午三點</span>、<span class="ex">明晚 7 點</span>、<span class="ex">週六 14:00–16:00</span>。「今天、明天、週六」以發文時間換算，時區是台灣時間。</li>
      <li>沒寫結束時間，或寫「發完為止」，會預設開始後 ${hours}結束。</li>
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
  return ev.post.source === 'link' ? `${who}（大家回報）` : who;
}

function sourceLinkText(ev: EventOut): string {
  if (ev.post.source === 'news') return '看新聞原文';
  if (ev.post.source === 'official') return '看官方航線';
  return '在 Threads 查看';
}

/** 地點文字；約略位置會註明 */
function placeLine(ev: EventOut): string {
  return ev.approxArea ? `${ev.placeText}（約略位置：${ev.approxArea}）` : ev.placeText;
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
    selectedId = null;
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
  selectedId = null;
  detailEl.hidden = true;
  renderReportTips();
}

function renderReportTips(): void {
  const l = keywordRules?.sources?.link;
  const tips = [
    '在 Threads 貼文按「分享」→「複製連結」，再貼到上面。Android 把洋流雷達加到主畫面後，也可以直接分享到洋流雷達。',
    `只收${l ? ` ${l.maxAgeDays} 天內` : ''}的公開貼文，貼文要寫出時間和地點。`,
    `原貼文刪除或改成「發完了」，雷達${l ? ` ${l.recheckMin} 分鐘內` : ''}會自動下架。`,
  ];
  reportTips.innerHTML = tips.map((t) => `<li>${esc(t)}</li>`).join('');
}

const OUTCOME_TEXT: Record<SubmitResult['outcome'], string> = {
  added: '已加入雷達：',
  duplicate: '雷達上已經有這一場了：',
  no_place: '看得出是發放或活動，但找不到地點。地點要寫具體一點（例如「捷運市政府站 2號出口」）才能定位。',
  not_listed: '判讀不出時間，或是已經結束、超過 14 天後才開始，所以沒有放上雷達。',
  not_event: '這則看起來不是發放或活動。貼文要寫出在哪裡、什麼時候發放或舉辦，雷達才會收。',
  failed: '判讀暫時失敗，系統稍後會自動再試一次。',
};

function setReportMsg(html: string): void {
  reportResult.innerHTML = html;
}

async function submitReport(): Promise<void> {
  const url = reportInput.value.trim();
  if (!url) {
    setReportMsg('<p class="msg error">請先貼上 Threads 貼文連結</p>');
    return;
  }
  reportSubmit.disabled = true;
  setReportMsg('<p class="msg busy">讀取貼文並判讀中，約需 10 秒</p>');
  const r = await submitLink(url);
  reportSubmit.disabled = false;
  if (!r.ok) {
    setReportMsg(`<p class="msg error">${esc(r.message)}</p>`);
    return;
  }
  const { outcome, events: found, existed } = r.data;
  const head = existed && (outcome === 'added' || outcome === 'duplicate') ? '這則之前已經有人回報，已在雷達上：' : OUTCOME_TEXT[outcome];
  const list = found
    .map((ev) => {
      const when = ev.allDay ? `${dateFmt.format(new Date(ev.startAt * 1000))} ${allDayText(ev, false)}` : `${dateFmt.format(new Date(ev.startAt * 1000))} ${fmtTime(ev.startAt)}`;
      return `<li><button type="button" data-id="${ev.id}"><b>${kindLabel(ev)}｜${esc(ev.title)}</b><small>${esc(ev.placeText)} · ${esc(when)}</small></button></li>`;
    })
    .join('');
  setReportMsg(`<p class="msg">${esc(head)}</p>${list ? `<ul class="report-events">${list}</ul>` : ''}`);
  for (const b of reportResult.querySelectorAll<HTMLButtonElement>('[data-id]')) {
    b.addEventListener('click', () => {
      reportSheet.hidden = true;
      selectedId = null;
      select(Number(b.dataset.id));
    });
  }
  if (found.length > 0) {
    reportInput.value = '';
    await refresh();
  }
}

/** 從 Threads App 分享過來（PWA share target）或網址帶 ?url= */
function takeSharedLink(params: URLSearchParams): string | null {
  const text = [params.get('url'), params.get('text'), params.get('title')].filter(Boolean).join(' ');
  return /threads\.(com|net)\//i.test(text) ? text : null;
}

function updateNotifyBtn(): void {
  const s = notificationState();
  notifyBtn.classList.toggle('on', s === 'granted');
  notifyBtn.title = s === 'granted' ? '通知已開啟' : s === 'denied' ? '通知被封鎖，仍有音效' : '開啟聲音與通知';
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
  notifyBtn.addEventListener('click', async () => {
    unlockAudio();
    const ok = await ensureNotificationPermission();
    updateNotifyBtn();
    showBanner(bannerEl, ok ? '通知已開啟，發放或活動開始時會提醒你' : '已開啟音效提醒；系統通知未取得權限');
    beep(theme.sound);
  });
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
    if (document.visibilityState === 'visible' && nowSec() - lastFetchAt > 30) void refresh();
  });
}

async function boot(): Promise<void> {
  wireControls();
  updateNotifyBtn();
  applyTheme(theme);
  setBase(baseMap);
  switchView('radar');
  setScale(scaleSetting);
  setOrigin(origin);
  startGeolocation();
  try {
    const h = await fetchHealth();
    modeBadge.textContent = h.mode === 'mock' ? '示範資料' : h.mode === 'unconfigured' ? '未連線 Threads' : '即時';
    modeBadge.classList.toggle('mock', h.mode !== 'live');
    modeBadge.hidden = false;
  } catch {
    modeBadge.textContent = '離線';
    modeBadge.hidden = false;
  }
  await loadKeywords();
  await refresh();
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
