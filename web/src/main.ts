import './styles.css';
import { addKeyword, fetchEvents, fetchHealth, fetchKeywords } from './api';
import { compassSupported, startCompass } from './compass';
import { bearingDeg, compassLabel, formatKm, haversineKm, type LatLng } from './geo';
import { MapView } from './map';
import { beep, ensureNotificationPermission, notificationState, showBanner, systemNotify, unlockAudio } from './notify';
import { Radar } from './radar';
import { DEFAULT_THEME_ID, getTheme, THEMES, type Theme } from './themes';
import type { EventOut, Item, KeywordInfo, Origin, Phase } from './types';

const DEFAULT_ORIGIN: Origin = { lat: 25.0478, lng: 121.517, source: 'default' }; // 台北車站
const SOON_SEC = 30 * 60;
const FETCH_RADIUS_KM = 50;
const POLL_MS = 60_000;
const TICK_MS = 5_000;
const LS_SCALE = 'dr.scale';
const LS_ORIGIN = 'dr.origin';
const LS_THEME = 'dr.theme';
const LS_KEYWORDS = 'dr.keywords';
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
let scaleKm = Number(lsGet(LS_SCALE) ?? 5) || 5;
let view: 'radar' | 'map' = 'radar';
let selectedId: number | null = null;
let lastFetchAt = 0;
let notifiedOnce = false;
let stopCompass: (() => void) | null = null;
let available: KeywordInfo[] = [];
/** 後端開放使用者自訂關鍵字時才顯示編輯功能 */
let canEditKeywords = false;
let savedFollowed: string[] | null = loadFollowed();
let theme: Theme = getTheme(new URLSearchParams(location.search).get('theme') ?? lsGet(LS_THEME) ?? DEFAULT_THEME_ID);
const seenActive = new Set<number>();

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
const scaleChips = Array.from(document.querySelectorAll<HTMLButtonElement>('#scale-chips [data-scale]'));

const radar = new Radar($('#radar-view'), select);
const map = new MapView($('#map'), origin, {
  onSelect: select,
  onPickOrigin: (p) => {
    setOrigin({ ...p, source: 'manual' });
    map.setPickMode(false);
    pickBtn.classList.remove('on');
    showBanner(bannerEl, '已設定為手動位置');
  },
});

// ---- logic ----
function phaseOf(ev: EventOut, now: number): Phase {
  if (ev.startAt <= now && now < ev.endAt) return 'active';
  if (ev.startAt > now && ev.startAt - now <= SOON_SEC) return 'soon';
  return 'later';
}

function computeItems(now: number): Item[] {
  const me: LatLng = { lat: origin.lat, lng: origin.lng };
  return events
    .filter((ev) => ev.endAt > now)
    .map((ev) => ({ ev, distanceKm: haversineKm(me, ev), bearing: bearingDeg(me, ev), phase: phaseOf(ev, now) }))
    .sort((a, b) => (a.phase === b.phase ? a.distanceKm - b.distanceKm : a.phase === 'active' ? -1 : b.phase === 'active' ? 1 : a.ev.startAt - b.ev.startAt));
}

function timeLine(it: Item, now: number): string {
  const { ev } = it;
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
  const items = computeItems(now);
  const visible = items.filter((it) => it.phase !== 'later');

  radar.render(
    visible.map((it) => ({
      id: it.ev.id,
      distanceKm: it.distanceKm,
      bearing: it.bearing,
      phase: it.phase,
      label: it.ev.title,
      showLabel: it.phase === 'active' || it.ev.id === selectedId,
      selected: it.ev.id === selectedId,
    })),
  );
  map.render(
    items.map((it) => ({
      id: it.ev.id,
      lat: it.ev.lat,
      lng: it.ev.lng,
      phase: it.phase,
      title: it.ev.title,
      subtitle: `${it.ev.placeText} · ${timeLine(it, now)}`,
      selected: it.ev.id === selectedId,
    })),
  );
  renderList(items, now);
  renderDetail(items, now);

  // 新變成進行中且在雷達範圍內的事件 → 嗶聲、震動、通知。第一次載入不吵。
  for (const it of items) {
    if (it.phase !== 'active') continue;
    if (seenActive.has(it.ev.id)) continue;
    seenActive.add(it.ev.id);
    if (!notifiedOnce || it.distanceKm > scaleKm) continue;
    beep(theme.sound);
    try {
      navigator.vibrate?.([120, 80, 160]);
    } catch {
      /* ignore */
    }
    const msg = `${it.ev.title}｜${it.ev.placeText}｜${formatKm(it.distanceKm)} ${compassLabel(it.bearing)}`;
    showBanner(bannerEl, `開始發放：${msg}`, 12_000);
    systemNotify('發放開始', msg);
  }
  if (lastFetchAt > 0) notifiedOnce = true;
}

function renderList(items: Item[], now: number): void {
  const active = items.filter((it) => it.phase === 'active').length;
  const soon = items.filter((it) => it.phase === 'soon').length;
  const none = followed().length === 0;
  countLabel.textContent = none ? '還沒追蹤關鍵字' : items.length === 0 ? theme.emptyText : theme.summary(active, soon, items.length);
  emptyEl.textContent = none ? (canEditKeywords ? '點下方「追蹤」選擇或新增關鍵字，雷達就會開始找發放。' : '目前沒有搜尋中的關鍵字。') : `${theme.emptyText}。雷達每分鐘更新，有新的會提醒你。`;
  listEl.replaceChildren();
  emptyEl.hidden = items.length > 0;
  for (const it of items) {
    const li = document.createElement('li');
    li.className = `ev phase-${it.phase}${it.ev.id === selectedId ? ' selected' : ''}`;
    li.dataset.id = String(it.ev.id);
    li.innerHTML = `
      <div class="ev-title"><span class="dot"></span>${esc(it.ev.title)}${it.ev.item ? ` <span class="muted">· ${esc(it.ev.item)}</span>` : ''}${followed().length > 1 && it.ev.keyword ? `<span class="ev-kw">#${esc(it.ev.keyword)}</span>` : ''}</div>
      <div class="ev-meta">${esc(it.ev.placeText)} · ${formatKm(it.distanceKm)} ${compassLabel(it.bearing)}</div>
      <div class="ev-time">${esc(timeLine(it, now))}</div>`;
    li.addEventListener('click', () => select(it.ev.id));
    listEl.appendChild(li);
  }
}

function renderDetail(items: Item[], now: number): void {
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
      <p>${ev.item ? `發放：${esc(ev.item)}<br>` : ''}${ev.keyword ? `關鍵字：#${esc(ev.keyword)}<br>` : ''}地點：${esc(ev.placeText)}<br>時間：${fmtTime(ev.startAt)} – ${fmtTime(ev.endAt)}<br>距離：${formatKm(it.distanceKm)}，${compassLabel(it.bearing)}方 · ${esc(timeLine(it, now))}</p>
      <blockquote>${esc(ev.post.text).slice(0, 300)}</blockquote>
      <div class="sheet-actions">
        <a class="btn primary" href="https://www.google.com/maps/dir/?api=1&destination=${ev.lat},${ev.lng}&travelmode=walking" target="_blank" rel="noopener">導航</a>
        ${ev.post.permalink ? `<a class="btn" href="${esc(ev.post.permalink)}" target="_blank" rel="noopener">在 Threads 查看</a>` : ''}
        <button type="button" class="btn" data-act="map">在地圖上看</button>
      </div>
    </div>`;
  detailEl.querySelector('[data-act="close"]')?.addEventListener('click', () => select(null));
  detailEl.querySelector('[data-act="map"]')?.addEventListener('click', () => {
    switchView('map');
    map.focus(ev.id);
  });
}

function select(id: number | null): void {
  selectedId = selectedId === id ? null : id;
  if (selectedId !== null) {
    themeSheet.hidden = true;
    kwSheet.hidden = true;
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
  map.setOrigin(o, moved);
  originLabel.textContent = o.source === 'gps' ? 'GPS 定位' : o.source === 'manual' ? '手動位置' : '預設：台北車站';
  useGpsBtn.hidden = o.source !== 'manual';
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
  view = v;
  $('#radar-view').hidden = v !== 'radar';
  $('#map-view').hidden = v !== 'map';
  viewBtn.textContent = v === 'radar' ? '地圖' : '雷達';
  pickBtn.hidden = v !== 'map';
  $('#scale-chips').hidden = v !== 'radar';
  compassBtn.hidden = v !== 'radar' || !compassSupported();
  if (v === 'map') map.invalidate();
}

function setScale(km: number): void {
  scaleKm = km;
  lsSet(LS_SCALE, String(km));
  radar.setScale(km);
  for (const b of scaleChips) {
    const on = Number(b.dataset.scale) === km;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  render();
}

function startGeolocation(): void {
  if (!('geolocation' in navigator)) {
    showBanner(bannerEl, '此瀏覽器不支援定位，以台北車站為中心');
    return;
  }
  navigator.geolocation.watchPosition(
    (pos) => {
      if (origin.source === 'manual') return;
      setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps' });
    },
    () => {
      if (origin.source === 'default') showBanner(bannerEl, '定位失敗，以台北車站為中心。可切到地圖手動設定位置。');
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
    showBanner(bannerEl, '沒有取得方向感測權限，雷達維持北在上');
    return;
  }
  stopCompass = stop;
  compassBtn.classList.add('on');
  showBanner(bannerEl, '指北針已開啟，雷達上方就是你面對的方向', 5000);
}

function applyTheme(t: Theme): void {
  theme = t;
  document.documentElement.dataset.theme = t.id;
  document.title = t.name;
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
    selectedId = null;
    detailEl.hidden = true;
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
  kwBtn.classList.toggle('readonly', !canEditKeywords);
  kwBtn.setAttribute('aria-label', canEditKeywords ? '管理追蹤的關鍵字' : '目前搜尋的關鍵字');
  (kwBtn.querySelector('.kw-edit') as HTMLElement).hidden = !canEditKeywords;
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
    b.className = `chip kw-chip${on ? ' on' : ''}`;
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

function setKwMsg(text: string, error = false): void {
  kwMsg.textContent = text;
  kwMsg.classList.toggle('kw-msg-error', error);
}

async function loadKeywords(): Promise<void> {
  try {
    const r = await fetchKeywords();
    available = r.keywords;
    canEditKeywords = r.userAdd === true;
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
  if (open && !canEditKeywords) return;
  kwSheet.hidden = !open;
  if (open) {
    themeSheet.hidden = true;
    selectedId = null;
    detailEl.hidden = true;
    setKwMsg('');
    void loadKeywords();
  }
}

function updateNotifyBtn(): void {
  const s = notificationState();
  notifyBtn.classList.toggle('on', s === 'granted');
  notifyBtn.title = s === 'granted' ? '通知已開啟' : s === 'denied' ? '通知被封鎖，仍有音效' : '開啟聲音與通知';
}

function wireControls(): void {
  for (const b of scaleChips) b.addEventListener('click', () => setScale(Number(b.dataset.scale) || 5));
  viewBtn.addEventListener('click', () => switchView(view === 'radar' ? 'map' : 'radar'));
  compassBtn.addEventListener('click', () => void toggleCompass());
  notifyBtn.addEventListener('click', async () => {
    unlockAudio();
    const ok = await ensureNotificationPermission();
    updateNotifyBtn();
    showBanner(bannerEl, ok ? '通知已開啟，開始發放時會提醒你' : '已開啟音效提醒；系統通知未取得權限');
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
  $('#panel-toggle').addEventListener('click', () => panelEl.classList.toggle('expanded'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && nowSec() - lastFetchAt > 30) void refresh();
  });
}

async function boot(): Promise<void> {
  wireControls();
  updateNotifyBtn();
  applyTheme(theme);
  switchView('radar');
  setScale(scaleKm);
  setOrigin(origin);
  startGeolocation();
  try {
    const h = await fetchHealth();
    modeBadge.textContent = h.mode === 'mock' ? '示範資料' : '即時';
    modeBadge.classList.toggle('mock', h.mode === 'mock');
    modeBadge.hidden = false;
  } catch {
    modeBadge.textContent = '離線';
    modeBadge.hidden = false;
  }
  await loadKeywords();
  await refresh();
  const openParam = new URLSearchParams(location.search).get('open');
  if (openParam === 'theme') openThemeSheet(true);
  if (openParam === 'keywords') openKwSheet(true);
  if (new URLSearchParams(location.search).get('view') === 'map') switchView('map');
  window.setInterval(render, TICK_MS);
  window.setInterval(() => void refresh(), POLL_MS);
}

void boot();
