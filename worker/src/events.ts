import type { Env } from './env';
import { fetchThreadsProfile, profileCandidates, profileHintText, type ThreadsProfile } from './sources/profile';
import { ACTIVITY_SPEC, applySupplementDate, reconcileRouteStops, closedWeekdays, slotWeekdays, dropBroughtItem, dropSelfPlace, extractFromPost, localizeTimes, missingActivityParts, openWeekdaysFromText, splitDropTimes, splitMultiDay, splitWeekdayWeekend, spotHoursFromText, startNowForDeadline, guessedMidnight, localToUnix, regionTimeZone, timeZoneOf, untilInText, weekdaysInText, type ActivityPart, type EventKind, type ExtractedEvent } from './extract';
import { cityOfHouse, geocodeAddress, parseTwAddress, type TwAddress } from './address';
import { SESSION_SPEC } from './badminton';
import { FOOD_SPEC } from './food';
import { JOB_SPEC, jobRisks } from './jobs';
import { DEFAULT_MODULE, moduleOf, type ModuleId } from './modules';
import { adminArea, cityLevel, cityOfDistrict, cityOfRoad, countryOfPlace, geocode, geocodeFirst, geocodeStreet, geocodeWorld, isAreaOnly, placeCandidates, regionOfPlace, type GeoPoint } from './geocode';
import { listActiveKeywords, type KeywordRow } from './keywords';
import { parseThreadsTimestamp, type ThreadsClient } from './threads';
import { nowSec, parseIsoToUnix } from './util';

export type EventStatus = 'upcoming' | 'active' | 'ended' | 'unlocated';

export interface PostRow {
  id: string;
  username: string | null;
  text: string;
  permalink: string | null;
  posted_at: number;
  keyword: string | null;
  source: string;
  fetched_at: number;
  processed_at: number | null;
  extraction: string | null;
  /** 回報的人補充的地點或時間，判讀時接在貼文後面 */
  supplement?: string | null;
  /** 使用者回報的確認狀態：null（排程搜尋到的、舊資料）、pending、confirmed、rejected、withdrawn（回報的人刪除了） */
  confirm_state?: 'pending' | 'confirmed' | 'rejected' | 'withdrawn' | null;
  confirm_plan?: string | null;
  confirm_note?: string | null;
  /** 哪個模組：current 洋流、dog 狗狗陪伴 */
  module?: string;
}

export interface EventRow {
  id: number;
  post_id: string;
  kind: EventKind;
  title: string;
  item: string | null;
  start_at: number;
  end_at: number;
  place_text: string;
  place_query: string | null;
  lat: number | null;
  lng: number | null;
  status: EventStatus;
  confidence: number | null;
  ended_reason: string | null;
  all_day?: number;
  end_open?: number;
  until_open?: number;
  spot?: number;
  approx_area?: string | null;
  weekdays?: string | null;
  /** 國外活動的當地時區（IANA）；台灣是 null */
  tz?: string | null;
  /** 管理者直接改的標題 */
  title_manual?: number;
  /** 模組自己的欄位（JSON） */
  extra?: string | null;
  last_checked_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface EventOut {
  id: number;
  kind: EventKind;
  title: string;
  item: string | null;
  startAt: number;
  endAt: number;
  placeText: string;
  lat: number;
  lng: number;
  status: 'upcoming' | 'active';
  confidence: number | null;
  keyword: string | null;
  /** 只有日期、沒有公布時間 */
  allDay: boolean;
  /** 貼文沒寫結束時間（畫面寫「發完為止」）；endAt 只是系統自動下架的時間 */
  endOpen: boolean;
  /** 固定據點沒寫最後一天（畫面寫「發完為止」） */
  untilOpen: boolean;
  /** 有幾個人回報已發完／已結束 */
  endedReports: number;
  /** 固定據點的其中一天（同一則貼文、同一地點的每天各一筆） */
  spot: boolean;
  /** 找不到精確地點、只定位到鄉鎮區中心時的區域名稱，例如「雲林縣虎尾鎮」 */
  approxArea: string | null;
  /** 固定據點每週幾開（1 = 週一 … 7 = 週日），每天則 null */
  weekdays: number[] | null;
  /** 國外活動的當地時區（IANA），畫面用當地時間顯示；台灣是 null */
  tz: string | null;
  /** 管理者直接改過標題：畫面就用 title，不從地點拆店名 */
  manualTitle: boolean;
  /** 模組自己的欄位，例如職缺的工作期間、薪資、防詐提醒 */
  extra: Record<string, unknown> | null;
  /** 固定據點才有：第一個時段開始的時間，還沒到就是「還沒開始」（不是休息中） */
  firstStartAt?: number;
  /** 官方行程才有：併進來的新聞、Threads 貼文（相關報導） */
  related?: RelatedPost[];
  /** 這則貼文有車掃路線（這一點可能是路線上的一站）：網頁沒有這條路線就重抓路線，免得每一站都畫出來 */
  route?: true;
  post: {
    id: string;
    source: string;
    username: string | null;
    permalink: string | null;
    postedAt: number;
    text: string;
    /** 回報的人補充的地點或時間 */
    supplement?: string | null;
  };
}

export interface RelatedPost {
  id: string;
  source: string;
  title: string;
  url: string | null;
  postedAt: number;
  /** 固定據點才有：previous 同一個帳號之前的貼文（已被取代），related 別人提到這個據點的貼文 */
  role?: 'previous' | 'related';
}

export const DEFAULT_DURATION_SEC = 2 * 3600;
/** 洋流的活動：寫了哪天幾點開始、沒寫幾點結束的（畫面只寫幾點開始），雷達上從開始排這麼久 */
export const OPEN_END_SEC = 2 * 3600;
export const MAX_FUTURE_SEC = 21 * 86400;
const LOOKBACK_SEC = 24 * 3600;
export const MIN_CONFIDENCE = 0.5;
/**
 * 固定據點沒寫最後一天（發完為止）：先排到這麼多天後，之後每天往後補（extendOpenSpots），
 * 不預設最後一天；貼文刪了、作者說發完、管理者下架才停
 */
export const SPOT_AHEAD_DAYS = 14;
/** 隱私權政策：貼文最多留 30 天，沒寫最後一天的據點最多排到發文後這麼多天 */
export const SPOT_MAX_DAYS = 30;
const DAY_SEC = 86400;
const TAIPEI_OFFSET_SEC = 8 * 3600;
const DUP_WINDOW_SEC = 30 * 60;
const DUP_DEG = 0.0014; // 約 150 m
const RECHECK_INTERVAL_SEC = 600;
const RECHECK_BATCH = 20;

export const ENDED_WORDS = [
  '發完', '送完', '領完', '完售', '售完', '收攤', '撤收', '沒了', '沒有了', '已結束', '結束了', '結束囉', '活動結束', '提前結束',
  // 職缺（狗狗陪伴）：作者改成徵到了（「額滿為止」這種原本就會寫的不算，所以不收單獨的「額滿」）
  '已徵到', '徵到了', '已找到', '找到了', '已額滿', '已錄取', '停止招募', '暫停招募', '已截止', '徵才結束',
  // 臨打（羽球臨打）：滿了、取消了
  '名額已滿', '已滿員', '滿員了', '人數已滿', '臨打取消', '今日取消', '今天取消', '本週取消', '場地取消',
  // 等一下吃什麼：今天不出攤、揪滿了（「收攤」「售完」上面已經有）
  '今日不出攤', '今天不出攤', '今日休息', '今天休息', '臨時休息', '已滿團', '揪滿了', '揪到了',
];
const ENDED_RE = new RegExp(ENDED_WORDS.join('|'));

/** 作者後續貼文或回覆是否宣告發完 */
export function detectEnded(text: string): boolean {
  return ENDED_RE.test(text);
}

export interface NewPost {
  id: string;
  username: string | null;
  text: string;
  permalink: string | null;
  posted_at: number;
  keyword: string | null;
  source: 'threads' | 'manual' | 'news' | 'official' | 'link' | 'spot';
  /** 哪個模組，沒給就是洋流 */
  module?: ModuleId;
}

/** 寫入貼文，回傳是否為新貼文 */
export async function storePost(env: Env, p: NewPost, now = nowSec()): Promise<boolean> {
  const r = await env.DB.prepare(
    'INSERT OR IGNORE INTO posts (id, username, text, permalink, posted_at, keyword, source, fetched_at, module) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(p.id, p.username, p.text, p.permalink, p.posted_at, p.keyword, p.source, now, p.module ?? DEFAULT_MODULE)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function getPost(env: Env, id: string): Promise<PostRow | null> {
  return env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<PostRow>();
}

export interface ProcessResult {
  /** 這則貼文建立的事件（一則貼文可以有多個地點或時段） */
  events: EventRow[];
  /** 每一筆的處理結果，例如 active、upcoming、no_place、duplicate_of_3 */
  reasons: string[];
}

/** 建立的事件裡有幾個找得到位置 */
export const locatedCount = (r: ProcessResult): number => r.events.filter((e) => e.status !== 'unlocated').length;

/** 台灣時間當天 00:00 的 unix 秒 */
export function taipeiDayStart(unix: number): number {
  return Math.floor((unix + TAIPEI_OFFSET_SEC) / DAY_SEC) * DAY_SEC - TAIPEI_OFFSET_SEC;
}

export interface Session {
  start: number;
  end: number;
  allDay: boolean;
  /** 每天幾點結束沒寫，end 是預設的 */
  endOpen: boolean;
  /** 最後一天沒寫，天數是預設的 */
  untilOpen: boolean;
}

/**
 * 固定據點展開成每天一個時段：從 start_at 那天到 until（沒寫就先排 SPOT_AHEAD_DAYS 天，之後每天往後補），
 * 每天用第一天的開放時段；沒寫幾點（00:00 開始、沒有結束）就是整天。
 */
export function spotSessions(ex: Pick<ExtractedEvent, 'start_at' | 'end_at' | 'until' | 'weekdays'>, postedAt: number, now: number): Session[] {
  const start = parseIsoToUnix(ex.start_at) ?? taipeiDayStart(postedAt);
  const end = parseIsoToUnix(ex.end_at);
  const firstDay = taipeiDayStart(start);
  const open = start - firstDay;
  const allDay = open === 0 && end === null;
  // 沒寫幾點結束（「每日上午 11:00 起」）：開到當天結束，不猜幾點收（畫面寫「11:00 開始」）
  let close = allDay || end === null ? DAY_SEC : end - taipeiDayStart(end);
  if (close <= open) close = Math.min(DAY_SEC, open + DEFAULT_DURATION_SEC);

  // 最後一天：until，其次是模型把多天合成一段時 end_at 的那天，都沒有就預設天數
  // 固定據點是連續多天：最後一天不晚於第一天（模型把「10/16 起」寫成 until 10/16）就當作沒寫
  const untilRaw = ex.until ? parseIsoToUnix(`${ex.until}T00:00:00+08:00`) : null;
  const untilAt = untilRaw !== null && untilRaw > firstDay ? untilRaw : null;
  const multiDayEnd = end !== null && taipeiDayStart(end) > firstDay;
  const untilOpen = untilAt === null && !multiDayEnd;
  // 沒寫最後一天：先排 SPOT_AHEAD_DAYS 天（畫面寫「發完為止」），之後每天由 extendOpenSpots 往後補
  let lastDay = untilAt ?? (multiDayEnd ? taipeiDayStart(end) : spotHorizon(now, postedAt));
  if (!untilOpen) lastDay = Math.min(lastDay, firstDay + (SPOT_AHEAD_DAYS - 1) * DAY_SEC);
  lastDay = Math.min(lastDay, taipeiDayStart(now + MAX_FUTURE_SEC));

  const out: Session[] = [];
  // 每週幾才開：其他天跳過（taipeiDay 換成星期：1 = 週一 … 7 = 週日）
  const weekdays = ex.weekdays && ex.weekdays.length > 0 ? new Set(ex.weekdays) : null;
  for (let day = firstDay; day <= lastDay; day += DAY_SEC) {
    if (weekdays && !weekdays.has(((new Date((day + TAIPEI_OFFSET_SEC) * 1000).getUTCDay() + 6) % 7) + 1)) continue;
    const s = { start: day + open, end: day + close, allDay, endOpen: !allDay && end === null, untilOpen };
    if (s.end > now) out.push(s);
  }
  return out;
}

/** 沒寫最後一天的據點排到哪一天：今天起 SPOT_AHEAD_DAYS 天，但不超過發文後 SPOT_MAX_DAYS 天 */
function spotHorizon(now: number, postedAt: number): number {
  return Math.min(taipeiDayStart(now) + (SPOT_AHEAD_DAYS - 1) * DAY_SEC, taipeiDayStart(postedAt) + (SPOT_MAX_DAYS - 1) * DAY_SEC);
}

/**
 * 沒寫最後一天的固定據點（發完為止）每天往後補時段，一直排到 SPOT_AHEAD_DAYS 天後，不預設最後一天。
 * 同一則貼文、同一個地點、每天同一個時間算一串；這串最後一個時段已經結束（貼文刪了、作者說發完、管理者下架）就不補。
 * 回傳補了幾個時段。
 */
export async function extendOpenSpots(env: Env, now: number): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.post_id, e.place_text, e.start_at, e.end_at, e.status, e.weekdays, p.posted_at
       FROM events e JOIN posts p ON p.id = e.post_id
      WHERE e.spot = 1 AND e.until_open = 1 AND e.end_at > ?`,
  )
    .bind(now - DAY_SEC)
    .all<{ id: number; post_id: string; place_text: string; start_at: number; end_at: number; status: string; weekdays: string | null; posted_at: number }>();
  // 每一串：最後一個時段排到哪天（包括公休、被回報發完而結束的），和用來複製的還沒結束的時段
  const series = new Map<string, { lastStart: number; tpl: (typeof results)[number] | null }>();
  for (const r of results) {
    const k = `${r.post_id}|${r.place_text}|${(r.start_at + TAIPEI_OFFSET_SEC) % DAY_SEC}`;
    const cur = series.get(k) ?? { lastStart: 0, tpl: null };
    cur.lastStart = Math.max(cur.lastStart, r.start_at);
    if ((r.status === 'upcoming' || r.status === 'active') && (!cur.tpl || r.start_at > cur.tpl.start_at)) cur.tpl = r;
    series.set(k, cur);
  }
  const inserts = [];
  for (const { lastStart, tpl } of series.values()) {
    if (!tpl) continue;
    const horizon = spotHorizon(now, tpl.posted_at);
    const weekdays = tpl.weekdays ? new Set(tpl.weekdays.split(',').map(Number)) : null;
    const open = tpl.start_at - taipeiDayStart(tpl.start_at);
    for (let day = taipeiDayStart(lastStart) + DAY_SEC; day <= horizon; day += DAY_SEC) {
      if (weekdays && !weekdays.has(((new Date((day + TAIPEI_OFFSET_SEC) * 1000).getUTCDay() + 6) % 7) + 1)) continue;
      const start = day + open;
      inserts.push(
        env.DB.prepare(
          `INSERT INTO events (post_id, kind, title, item, start_at, end_at, place_text, place_query, lat, lng, status, confidence, all_day, spot, approx_area, end_open, until_open, weekdays, tz, title_manual, created_at, updated_at)
           SELECT post_id, kind, title, item, ?, ?, place_text, place_query, lat, lng, 'upcoming', confidence, all_day, spot, approx_area, end_open, until_open, weekdays, tz, title_manual, ?, ? FROM events WHERE id = ?`,
        ).bind(start, start + (tpl.end_at - tpl.start_at), now, now, tpl.id),
      );
    }
  }
  for (let i = 0; i < inserts.length; i += 50) await env.DB.batch(inserts.slice(i, i + 50));
  return inserts.length;
}

/** 門牌查詢（含很慢的 Overpass）一則貼文最多花這麼久，超過就只用 Photon，免得回報的人等太久 */
export const ADDRESS_BUDGET_MS = 25_000;

/** 寫了「市」「縣」的縣市名 */
const CITY_WORD_RE = /(?:台|臺)?(?:北|新北|桃園|中|南|高雄|基隆|新竹|嘉義)市|(?:新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|連江)縣/;

/** 有寫門牌的地點：門牌加上縣市（地點欄沒寫縣市時，從另一欄補）；縣市不確定就不查，免得查到別縣市同名的路 */
export function addressOf(placeQuery: string, placeText: string | null): { address: TwAddress; text: string; area: string | null; city?: string } | null {
  const sources = [placeQuery, placeText ?? ''];
  const parsed = sources.map((s) => parseTwAddress(s));
  // 縣市：門牌自己帶的優先，其次是另一欄的「台南市」「新北市」（不寫市、縣的不算，新竹、嘉義分不出來）
  const cityWord = sources.map((s) => CITY_WORD_RE.exec(s)?.[0]).find(Boolean);
  // 有縣市的優先，其次有區的（「新市國小活動中心 淡水區…」空白拿掉後「心淡水區」認不出區，另一欄「中心-淡水區」認得出來）
  const a = parsed.find((x) => x?.city) ?? parsed.find((x) => x?.district) ?? parsed.find(Boolean);
  if (!a) return null;
  const city = a.city ?? (cityWord ? cityWord.replace(/^台/, '臺').replace(/^(北|中|南)市$/, '臺$1市') : null);
  if (!city) return { address: a, text: '', area: null };
  return addressWithCity(a, city);
}

/**
 * 「永順街31巷口」：巷子是從大路的同一個號碼旁邊轉進去的，巷口就當成「永順街31號」查門牌；
 * 回傳當成門牌的文字（前面的縣市、區照原文）和那條巷子（門牌查不到時先退到巷子）
 */
export function laneMouth(s: string | null | undefined): { asAddress: string; lane: string } | null {
  const m = /^(.*?)([^\s\d區縣鄉鎮里村鄰巷弄號（）()「」、,，:：]{1,5}?(?:路|街|大道)(?:[一二三四五六七八九十]段)?)\s*(\d+)\s*巷\s*口/.exec(s ?? '');
  return m ? { asAddress: `${m[1]}${m[2]}${m[3]}號`, lane: `${m[2]}${m[3]}巷` } : null;
}

/** 門牌加上縣市：查詢字串、約略位置用的區 */
export function addressWithCity(a: TwAddress, city: string): { address: TwAddress; text: string; area: string | null; city: string } {
  return { address: a, text: `${city}${a.district ?? ''}${a.street}${a.raw}號`, area: a.district ? `${city}${a.district}` : null, city };
}

/**
 * 定位一個地點。貼文有寫門牌就只用門牌查：查不到退到鄉鎮區中心當作約略位置，
 * 不拿店名或「XX服務處」去猜（會查到同名的別的機構，例如「佳里服務處」查到家扶中心的佳里服務處）。
 * 沒有門牌才照舊用地名查。
 */
export async function locatePlaceForEvent(
  env: Env,
  placeQuery: string,
  placeText: string | null,
  deadline: number,
  /** 國外的活動：國家代碼（ISO 兩碼），只在那個國家查 */
  country?: string | null,
): Promise<{ point: GeoPoint | null; approxArea: string | null }> {
  if (country) {
    const hit = await geocodeWorld(env, placeQuery, placeText, country);
    return { point: hit?.point ?? null, approxArea: hit?.approxArea ?? null };
  }
  // 沒有門牌但寫了「N巷口」：當成大路的 N 號查
  const lane = addressOf(placeQuery, placeText) ? null : (laneMouth(placeQuery) ?? laneMouth(placeText));
  let addr = lane ? addressOf(lane.asAddress, placeText) : addressOf(placeQuery, placeText);
  // 只寫了區沒寫縣市（「淡水區中山北路二段200號」）：全台只有一個同名區的，補上縣市再查
  if (addr && !addr.city && addr.address.district) {
    const city = await cityOfDistrict(env, addr.address.district).catch(() => null);
    if (city) addr = addressWithCity(addr.address, city);
  }
  if (addr) {
    let hit = addr.text ? await geocodeAddress(env, addr.text, undefined, { overpass: Date.now() < deadline }) : null;
    // 地點原文沒寫縣市（模型自己補的「新北市」「新竹縣」，或根本沒有）：門牌在那個縣市查不到時，全台只有一個縣市有這個門牌就改用那個縣市
    const guessed = !CITY_WORD_RE.test(placeText ?? '');
    if (!hit && guessed) {
      const city = await cityOfHouse(env, addr.address).catch(() => null);
      if (city && city !== addr.city) {
        addr = addressWithCity(addr.address, city);
        hit = await geocodeAddress(env, addr.text, undefined, { overpass: Date.now() < deadline });
      }
    }
    // 門牌查不到：先退到那條路（巷口的先退到那條巷子；同一個縣市、鄉鎮區），再退到鄉鎮區中心，都標成約略位置
    const street = lane ? `${addr.address.street}${lane.lane.replace(/^.*?(\d+巷)$/, '$1')}` : addr.address.street;
    let road = !hit && addr.city ? await geocodeStreet(env, addr.city, addr.address.district, street) : null;
    // 縣市是猜的、那個縣市又沒有這條路：全台只有一個縣市有這條路就改用那個縣市
    if (!hit && !road && guessed) {
      const city = await cityOfRoad(env, addr.address.street).catch(() => null);
      if (city && city !== addr.city) {
        addr = addressWithCity(addr.address, city);
        hit = await geocodeAddress(env, addr.text, undefined, { overpass: Date.now() < deadline });
        road = hit ? null : await geocodeStreet(env, city, addr.address.district, street);
      }
    }
    if (hit) return { point: { lat: hit.lat, lng: hit.lng, displayName: addr.text }, approxArea: null };
    if (road) return { point: road.point, approxArea: road.area };
    const area = addr.area ?? adminArea(placeQuery, placeText);
    const p = area ? await geocode(env, area) : null;
    return { point: p, approxArea: p ? area : null };
  }
  // 只寫了行政區（「中正萬華區」）不拿去查，不然會對到某個區的中心、看起來像精確地點
  const vague = isAreaOnly(placeQuery) && isAreaOnly(placeText ?? placeQuery);
  let point = vague ? null : await geocodeFirst(env, placeCandidates(placeQuery, placeText));
  // 精確地點查不到時退到鄉鎮區中心，標成約略位置
  const area = point ? null : adminArea(placeQuery, placeText);
  if (area) point = await geocode(env, area);
  return { point, approxArea: area && point ? area : null };
}

/** 約略位置有多準：精確 2、退到路 1、退到鄉鎮區 0 */
export function approxRank(approxArea: string | null): number {
  if (!approxArea) return 2;
  return /(?:路|街|大道|段|巷|弄)$/.test(approxArea) ? 1 : 0;
}

/** 重查約略位置：每次排程最多查幾個地址、同一個地址隔多久再查 */
const RELOCATE_PER_RUN = 3;
const RELOCATE_EVERY_SEC = 3 * 3600;

/**
 * 有寫門牌卻只定位到路或鄉鎮區的事件（當時 Overpass 不通、OSM 沒有那個門牌）定時重查，
 * 查到更準的位置（門牌，或從鄉鎮區變成路）就把同一則貼文、同一個地點還沒結束的時段都改過去。
 * 門牌查不到會快取一天（geocodeAddress），所以 OSM 沒有的門牌一天只真的查一次。
 */
export async function relocateApprox(env: Env, now: number): Promise<{ checked: number; improved: number }> {
  const { results } = await env.DB.prepare(
    `SELECT post_id, place_query, place_text, MAX(approx_area) AS approx_area FROM events
      WHERE status IN ('upcoming', 'active') AND approx_area IS NOT NULL AND lat IS NOT NULL
        AND (locate_checked_at IS NULL OR locate_checked_at < ?)
      GROUP BY post_id, place_query, place_text ORDER BY MIN(start_at) LIMIT 20`,
  )
    .bind(now - RELOCATE_EVERY_SEC)
    .all<{ post_id: string; place_query: string; place_text: string; approx_area: string }>();
  let checked = 0;
  let improved = 0;
  for (const r of results) {
    // 沒有門牌的重查也不會更準，一樣記下查過了，隔幾小時才會再挑到
    const hasAddress = !!addressOf(r.place_query, r.place_text)?.text || !!(laneMouth(r.place_query) ?? laneMouth(r.place_text));
    if (hasAddress && checked >= RELOCATE_PER_RUN) break;
    const same = "post_id = ? AND place_query IS ? AND place_text IS ? AND status IN ('upcoming', 'active')";
    if (hasAddress) {
      checked++;
      const loc = await locatePlaceForEvent(env, r.place_query, r.place_text, Date.now() + ADDRESS_BUDGET_MS);
      if (loc.point && approxRank(loc.approxArea) > approxRank(r.approx_area)) {
        await env.DB.prepare(`UPDATE events SET lat = ?, lng = ?, approx_area = ?, updated_at = ? WHERE ${same}`)
          .bind(loc.point.lat, loc.point.lng, loc.approxArea, now, r.post_id, r.place_query, r.place_text)
          .run();
        improved++;
      }
    }
    await env.DB.prepare(`UPDATE events SET locate_checked_at = ? WHERE ${same}`).bind(now, r.post_id, r.place_query, r.place_text).run();
  }
  return { checked, improved };
}

/** 一筆準備寫進 events 的資料：使用者回報時先給他看，確認了才寫 */
export interface PlannedEvent {
  kind: EventKind;
  title: string;
  item: string | null;
  start_at: number;
  end_at: number;
  place_text: string;
  place_query: string;
  lat: number | null;
  lng: number | null;
  confidence: number;
  all_day: boolean;
  spot: boolean;
  approx_area: string | null;
  end_open: boolean;
  until_open: boolean;
  /** 固定據點每週幾開（1–7），每天則 null */
  weekdays?: number[] | null;
  /** 國外活動的當地時區（IANA）；台灣是 null */
  tz?: string | null;
  /** 模組自己的欄位（JSON 字串） */
  extra?: string | null;
}

/**
 * 雷達上已經有同一個固定據點（同地點、還沒結束）時的處理：
 * replace 同一個帳號的新貼文，據點改成以新貼文為準；attach 別人的貼文，只附在據點的詳細資料。
 */
export interface SpotMerge {
  mode: 'replace' | 'attach';
  /** 雷達上那個據點的貼文、地點文字、其中一筆事件（點了跳過去） */
  postId: string;
  placeText: string;
  eventId: number;
  title: string;
}

/**
 * 洋流的活動沒放上雷達：哪一場（標題、地點）、為什麼，回報結果一場一場講清楚。
 * incomplete 缺內容、地點或開始時間；unlocated 地點查不到；already_over、too_far_in_future 時間不對；low_confidence 不確定是不是活動
 */
export interface FailedItem {
  title: string | null;
  place: string | null;
  reason: 'incomplete' | 'unlocated' | 'approximate' | 'already_over' | 'too_far_in_future' | 'low_confidence';
  missing?: ActivityPart[];
  /** reason = 'approximate'（車掃的站只定位到鄉鎮區、路）：定位到哪裡 */
  area?: string;
  /** reason = 'unlocated'（車掃的站）：跟另一站定位在同一點，可能查錯了 */
  sameAs?: string;
  /** 地點只寫了「本店」這類說法 */
  selfPlace?: string;
  /** 只寫了日期沒寫幾點：那天（00:00） */
  dateOnly?: number;
  startAt?: number;
  endAt?: number;
  /** 沒寫結束時間（發完為止） */
  endOpen?: boolean;
  tz?: string | null;
  /** 太久以後才開始的：這天之後再貼就收得到 */
  reportFrom?: number;
  /** 地圖上的位置（回報的人標的，或車掃的站的約略位置），修改資料時帶回表單 */
  lat?: number;
  lng?: number;
}

/** 車掃路線上的一站：確認放上雷達時寫進 routes（commitPlan） */
export interface RouteStopPlan {
  /** 哪一天的路線（YYYY-MM-DD，台北時間） */
  key: string;
  /** 整條路線的名稱 */
  title: string;
  seq: number;
  kind: 'start' | 'cheer' | 'end';
  /** 時間表上的站名 */
  name: string;
  /** 這一站的地點（地址），跟站名不一樣時才有 */
  place?: string;
  /** 這一站的事件標題（前端靠它對應到路線上的站） */
  stopTitle: string;
  /** 預計經過的時間 */
  at: number;
  /** 確切位置；只定位到鄉鎮區、查不到的是 null（不畫進路線） */
  lat: number | null;
  lng: number | null;
  /** 查地圖用的（有門牌的，沒有確切位置時排程會再查：relocateRouteStops） */
  query?: string;
}

/** 判讀出來的一筆：plan 是可以寫進雷達的資料；沒有 plan 時 reason 寫原因（no_place、duplicate_of_3…）。group 是貼文裡第幾個地點或時段 */
export interface PlanItem {
  group: number;
  plan: PlannedEvent | null;
  reason: string;
  /** 洋流的活動沒放上雷達的詳細原因 */
  fail?: FailedItem;
  merge?: SpotMerge;
  /** 地點是從這些帳號（「@luguocafe」）的名稱、簡介推的，回報的人要確認 */
  profileHint?: string;
  /** 車掃、掃街、車隊路線上的一站 */
  route?: RouteStopPlan;
  /** 已經結束、太久以後才開始的：那一場的時間（回報結果直接講原因用）；國外的附當地時區 */
  start?: number;
  end?: number;
  tz?: string | null;
}

/** 同一場可能被多篇貼文找到：同類型、同地點（約 150 m 內）、開始時間差 30 分鐘內就視為重複。excludePost 的事件不算（要被取代的據點） */
async function findDuplicate(env: Env, kind: EventKind, start: number, lat: number, lng: number, excludePost?: string): Promise<number | null> {
  const dup = await env.DB.prepare(
    `SELECT id FROM events WHERE status IN ('upcoming', 'active') AND kind = ?
       AND ABS(start_at - ?) <= ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? AND post_id != ? LIMIT 1`,
  )
    .bind(kind, start, DUP_WINDOW_SEC, lat - DUP_DEG, lat + DUP_DEG, lng - DUP_DEG, lng + DUP_DEG, excludePost ?? '')
    .first<{ id: number }>();
  return dup?.id ?? null;
}

/** 雷達上同地點（約 150 m 內）、還沒結束的固定據點，不算這則貼文自己的 */
async function findSpotAt(env: Env, kind: EventKind, lat: number, lng: number, ownPostId: string): Promise<{ id: number; post_id: string; place_text: string; title: string; username: string | null } | null> {
  return env.DB.prepare(
    `SELECT e.id, e.post_id, e.place_text, e.title, p.username FROM events e JOIN posts p ON p.id = e.post_id
      WHERE e.spot = 1 AND e.status IN ('upcoming', 'active') AND e.kind = ? AND e.merged_into IS NULL
        AND e.lat BETWEEN ? AND ? AND e.lng BETWEEN ? AND ? AND e.post_id != ?
      ORDER BY e.start_at LIMIT 1`,
  )
    .bind(kind, lat - DUP_DEG, lat + DUP_DEG, lng - DUP_DEG, lng + DUP_DEG, ownPostId)
    .first();
}

/** 同一個帳號才取代（大小寫不分）；沒有帳號的一律只附上去 */
export function spotMergeMode(newUser: string | null | undefined, oldUser: string | null | undefined): 'replace' | 'attach' {
  return newUser && oldUser && newUser.toLowerCase() === oldUser.toLowerCase() ? 'replace' : 'attach';
}

async function planEvent(
  env: Env,
  ex: ExtractedEvent,
  now: number,
  deadline: number,
  session?: Session,
  located?: { point: GeoPoint | null; approxArea: string | null },
  excludePost?: string,
  openEndSec = DEFAULT_DURATION_SEC,
): Promise<{ plan: PlannedEvent | null; reason: string; start?: number; end?: number; tz?: string | null }> {
  if (ex.confidence < MIN_CONFIDENCE) return { plan: null, reason: 'low_confidence' };
  const start = session ? session.start : parseIsoToUnix(ex.start_at);
  if (start === null) return { plan: null, reason: 'no_start_time' };
  // 沒寫結束時間：從開始排 openEndSec（畫面寫「發完為止」，不寫幾點結束）
  let end = session ? session.end : (parseIsoToUnix(ex.end_at) ?? start + openEndSec);
  if (end <= start) end = start + openEndSec;
  const when = { start, end, tz: ex.country ? timeZoneOf(ex) : null };
  if (end <= now) return { plan: null, reason: 'already_over', ...when };
  if (start > now + MAX_FUTURE_SEC) return { plan: null, reason: 'too_far_in_future', ...when };

  const placeQuery = ex.place_query ?? ex.place_text;
  const placeText = ex.place_text ?? ex.place_query;
  if (!placeQuery || !placeText) return { plan: null, reason: 'no_place' };

  const { point, approxArea } = located ?? (await locatePlaceForEvent(env, placeQuery, ex.place_text, deadline, ex.country));
  if (point && !approxArea) {
    const dup = await findDuplicate(env, ex.kind, start, point.lat, point.lng, excludePost);
    if (dup !== null) return { plan: null, reason: `duplicate_of_${dup}` };
  }
  return {
    plan: {
      kind: ex.kind,
      title: ex.title,
      item: ex.item,
      start_at: start,
      end_at: end,
      place_text: placeText,
      place_query: placeQuery,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      confidence: ex.confidence,
      all_day: !!session?.allDay,
      spot: !!session,
      approx_area: approxArea,
      end_open: session ? session.endOpen : !parseIsoToUnix(ex.end_at),
      until_open: !!session?.untilOpen,
      weekdays: session ? (ex.weekdays ?? null) : null,
      tz: ex.country ? timeZoneOf(ex) : null,
      // 模組自己的欄位（臨打的費用、程度、缺幾位…）
      extra: ex.extra ? JSON.stringify(ex.extra) : null,
    },
    reason: 'planned',
  };
}

/** 把判讀好的一筆寫進 events；寫之前再看一次有沒有結束、有沒有別人先放上同一場 */
/** routeStop：車掃路線上的一站 */
export async function insertPlanned(env: Env, postId: string, p: PlannedEvent, now: number, routeStop = false): Promise<{ event: EventRow | null; reason: string }> {
  if (p.end_at <= now) return { event: null, reason: 'already_over' };
  if (p.lat !== null && p.lng !== null && !p.approx_area) {
    // 車掃的站只比別的貼文和同一站：同一則的各站時間常常一樣、又離不到 150 m（莒光路、西藏路），不然後面那站會被當成重複
    const dup = routeStop
      ? ((await findDuplicate(env, p.kind, p.start_at, p.lat, p.lng, postId)) ??
        (
          await env.DB.prepare("SELECT id FROM events WHERE post_id = ? AND title = ? AND status IN ('upcoming', 'active') AND ABS(start_at - ?) <= ? LIMIT 1")
            .bind(postId, p.title, p.start_at, DUP_WINDOW_SEC)
            .first<{ id: number }>()
        )?.id ??
        null)
      : await findDuplicate(env, p.kind, p.start_at, p.lat, p.lng);
    if (dup !== null) return { event: null, reason: `duplicate_of_${dup}` };
  }
  const status: EventStatus = p.lat === null ? 'unlocated' : p.start_at <= now ? 'active' : 'upcoming';
  const event = await env.DB.prepare(
    `INSERT INTO events (post_id, kind, title, item, start_at, end_at, place_text, place_query, lat, lng, status, confidence, all_day, spot, approx_area, end_open, until_open, weekdays, tz, extra, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(
      postId,
      p.kind,
      p.title,
      p.item,
      p.start_at,
      p.end_at,
      p.place_text,
      p.place_query,
      p.lat,
      p.lng,
      status,
      p.confidence,
      p.all_day ? 1 : 0,
      p.spot ? 1 : 0,
      p.approx_area,
      p.end_open ? 1 : 0,
      p.until_open ? 1 : 0,
      p.weekdays?.length ? p.weekdays.join(',') : null,
      p.tz ?? null,
      p.extra ?? null,
      now,
      now,
    )
    .first<EventRow>();
  return { event, reason: status };
}

/** 對單一貼文跑 LLM 抽取、定位，列出每個地點或時段要建的事件（還沒寫進雷達）；early 是整則貼文就不行的原因 */
export async function planPost(env: Env, post: PostRow, now = nowSec()): Promise<PlanResult> {
  const first = await planPostWith(env, post, now, null);
  // 使用者貼連結回報的、找不到地點：看發文的店家帳號、標記的店家帳號的名稱和簡介，再判讀一次。
  // 店家貼文只寫「在櫃檯出示船員證」、沒寫地址時，模型常直接說不是活動，這種也試
  const noPlace = first.early ? first.early === 'not_event' || first.early === 'no_events' : lacksPlace(first.items);
  if (post.source !== 'link' || !noPlace) return first;
  const accounts = profileCandidates(post.text, post.username);
  if (accounts.length === 0) return first;
  const profiles = (await Promise.all(accounts.map((u) => fetchThreadsProfile(u)))).filter((p): p is ThreadsProfile => !!p);
  const hint = profileHintText(profiles);
  if (!hint) return first;
  const second = await planPostWith(env, post, now, hint);
  if (!profilePlanBetter(first.items, second.items)) return first;
  const from = profiles.filter((p) => p.name || p.bio).map((p) => `@${p.username}`).join('、');
  return { ...second, items: second.items.map((it) => (it.plan && it.plan.lat !== null ? { ...it, profileHint: from } : it)) };
}

const located = (items: PlanItem[]): number => items.filter((it) => it.plan && it.plan.lat !== null).length;
/** 有地點的筆數：放得上雷達的，或沒放上但地點有寫、也不是查不到的（例如只缺時間） */
const withPlace = (items: PlanItem[]): number => items.filter((it) => (it.plan ? it.plan.lat !== null : !!it.fail?.place && !noPlaceReason(it.reason))).length;
/**
 * 讀了帳號簡介的判讀比較好才用：放得上雷達的多；一樣多時，有地點的多
 * （簡介寫了地址、貼文只缺時間：回報的人在表單補上時間就好，不要退回「不是活動」）
 */
export function profilePlanBetter(first: PlanItem[], second: PlanItem[]): boolean {
  return (located(second) - located(first) || withPlace(second) - withPlace(first)) > 0;
}
/** 這一筆沒有地點：沒寫、或查不到（洋流的活動缺地點記成 incomplete:place…、查不到記成 unlocated） */
const noPlaceReason = (reason: string): boolean => reason === 'no_place' || reason === 'unlocated' || /^incomplete:(?:.*,)?place\b/.test(reason);
/** 判讀得出來，但地點都找不到（沒寫地點、或查不到） */
const lacksPlace = (items: PlanItem[]): boolean =>
  items.length > 0 && located(items) === 0 && items.some((it) => (it.plan ? it.plan.lat === null : noPlaceReason(it.reason)));

/** 一則貼文的判讀結果：early 是整則就不行的原因；note 是模型說不是活動的理由 */
export interface PlanResult {
  items: PlanItem[];
  early: string | null;
  note?: string | null;
}

async function planPostWith(env: Env, post: PostRow, now: number, profileHint: string | null): Promise<PlanResult> {
  const base = post.supplement ? `${post.text}\n\n【回報的人補充】${post.supplement}` : post.text;
  const text = profileHint ? `${base}\n\n【帳號簡介】${profileHint}` : base;
  const module = moduleOf(post.module);
  // 使用者貼連結回報的，主要模型說不是活動時再問備用模型（只多等一下，量不大）
  // 洋流改版後只判斷活動（不再分發放、固定據點）
  const spec = module === 'dog' ? JOB_SPEC : module === 'badminton' ? SESSION_SPEC : module === 'food' ? FOOD_SPEC : ACTIVITY_SPEC;
  const { extraction, raw, garbled } = await extractFromPost(env, text, post.posted_at, now, { secondOpinion: post.source === 'link', spec });
  await env.DB.prepare('UPDATE posts SET processed_at = ?, extraction = ? WHERE id = ?').bind(now, raw, post.id).run();

  if (garbled) return { items: [], early: 'garbled' };
  if (!extraction) return { items: [], early: 'extraction_failed' };
  if (!extraction.is_event) return { items: [], early: 'not_event', note: extraction.reason ?? null };
  if (extraction.events.length === 0) return { items: [], early: 'no_events' };
  if (module === 'dog') return { items: await planJobs(env, post, extraction.events, now), early: null };
  if (module === 'current') return { items: await planActivities(env, post, extraction.events, text, now, extraction.route_title ?? null), early: null };
  // 模型常把付款的 Line Pay 當成用 LINE 聯絡：貼文只有 Line Pay 的不算
  if (!/(?:line|賴)(?!\s*pay)/i.test(text)) for (const e of extraction.events) if (e.extra?.contact === 'line') e.extra.contact = null;
  // 刊登（找臨打、網友推薦、揪團吃飯）不是場次：從發文起顯示一段時間；招臨打、出攤照場次排
  const postings = extraction.events.filter((e) => POSTING_DAYS[String(e.extra?.role)] !== undefined);
  if (postings.length > 0) extraction.events = extraction.events.filter((e) => POSTING_DAYS[String(e.extra?.role)] === undefined);

  const items: PlanItem[] = [];
  if (postings.length > 0) items.push(...(await planPostings(env, post, postings, now, extraction.events.length)));
  const deadline = Date.now() + ADDRESS_BUDGET_MS;
  // 「13:00｜10 個、15:00｜10 個」被合成一段的，拆回每個時間點各一筆
  extraction.events = splitDropTimes(extraction.events, text);
  // 「平日 0930-2030 假日 1000-1800」只給一筆的，拆成平日、假日兩筆
  extraction.events = extraction.events.flatMap((ex) => splitWeekdayWeekend(ex, spotScope(text, ex, extraction.events) ?? ''));
  for (const [group, ex] of extraction.events.entries()) {
    // 國外的活動：時間換成當地時區的時間點、地點在那個國家查；固定據點的每天時段是照台灣時間排的，國外的先當單次
    if (ex.country) {
      localizeTimes(ex);
      ex.spot = false;
      dropBroughtItem(ex, text);
      items.push({ group, ...(await planEvent(env, ex, now, deadline)) });
      continue;
    }
    // 貼文沒寫哪天、補充寫了：用補充的日期（模型有時會忽略補充）
    applySupplementDate(ex, post.supplement, post.text, post.posted_at);
    // 跨好幾天、每天固定時段的（市集、展覽）：模型常讀成連續好幾天，改成每天一個時段
    splitMultiDay(ex, text);
    // 「帶自己的飄帶來幫你編」不是發放
    dropBroughtItem(ex, text);
    // 只寫「本店」沒寫店名：當成沒寫地點，讓回報的人補充
    dropSelfPlace(ex);
    if (!ex.spot) {
      // 「今天14:45前我都在」：從現在開始，不用模型猜的開始時間
      startNowForDeadline(ex, text, now);
      items.push({ group, ...(await planEvent(env, ex, now, deadline)) });
      continue;
    }
    // 模型自己編的每週幾不算；貼文寫的「每週二、四」「週一公休」「上班日」照貼文（模型常漏掉或算錯）。
    // 只看這個地點的那一段，免得套到別的地點；平日、假日分兩筆的照模型
    ex.weekdays = weekdaysInText(ex.weekdays, text);
    const scope = spotScope(text, ex, extraction.events);
    const open = scope ? openWeekdaysFromText(scope) : undefined;
    // 時段自己寫了星期幾（「平日晚上 18:30–21:00」）：照那個時段的
    const own = scope ? slotWeekdays(scope, ex.start_at) : undefined;
    if (own) ex.weekdays = own;
    else if (open !== undefined && !(ex.weekdays && /平日|假日|週末|周末/.test(scope ?? ''))) ex.weekdays = open;
    if (ex.weekdays && scope) {
      // 再扣掉公休日（「週一、二公休 平日12-21 假日11-20」的平日是週三到五）
      const closed = closedWeekdays(scope) ?? [];
      const left = ex.weekdays.filter((d) => !closed.includes(d));
      if (left.length > 0) ex.weekdays = left;
    }
    // 時段照貼文校正：開始時間是貼文某段的開始就用那段的結束；貼文沒寫的開始時間換成貼文寫的；
    // 還是沒結束就找「下午7點30結束」
    const slots = extraction.events.filter((e) => e.spot && (e.place_query ?? e.place_text) === (ex.place_query ?? ex.place_text)).length;
    spotHoursFromText(ex, scope ?? text, { endPhrase: !!scope, single: !!scope && slots === 1 });
    // 最後一天要是貼文（或補充）寫的，模型自己猜的不算
    ex.until = untilInText(ex.until, text);
    const sessions = spotSessions(ex, post.posted_at, now);
    if (sessions.length === 0) items.push({ group, plan: null, reason: 'already_over' });
    // 每天一個時段，地點都一樣：只定位一次
    const placeQuery = ex.place_query ?? ex.place_text;
    const located = sessions.length > 0 && placeQuery ? await locatePlaceForEvent(env, placeQuery, ex.place_text ?? ex.place_query, deadline) : undefined;
    // 雷達上已經有這個據點：同一個帳號的新貼文取代它，別人的貼文附上去；舊據點的時段不算重複
    const old = located?.point && !located.approxArea ? await findSpotAt(env, ex.kind, located.point.lat, located.point.lng, post.id) : null;
    const merge: SpotMerge | undefined = old
      ? { mode: spotMergeMode(post.username, old.username), postId: old.post_id, placeText: old.place_text, eventId: old.id, title: old.title }
      : undefined;
    for (const session of sessions) items.push({ group, ...(await planEvent(env, ex, now, deadline, session, located, old?.post_id)), ...(merge ? { merge } : {}) });
  }
  return { items, early: null };
}

/**
 * 洋流（改版後）：只收活動，每一場都要判讀出活動內容、地點、哪天幾點開始才算成功。
 * 沒寫幾點結束的也收（畫面只寫幾點開始，不寫「發完為止」：活動不一定是發東西），雷達上從開始排 OPEN_END_SEC。
 * 缺的記成 incomplete:place,start（照 內容、地點、開始 的順序，回報的人可以補充再判讀），
 * 寫了地點、地圖上查不到記成 unlocated。不再推算固定據點。
 */
async function planActivities(env: Env, post: PostRow, extracted: ExtractedEvent[], text: string, now: number, routeTitle: string | null): Promise<PlanItem[]> {
  const deadline = Date.now() + ADDRESS_BUDGET_MS;
  const items: PlanItem[] = [];
  // 車掃的站：照貼文一行一站的清單補上模型漏掉的、改正套錯的地名
  const events = reconcileRouteStops(extracted, text);
  for (const [group, ex] of events.entries()) {
    // 國外的：時間換成當地時區的時間點；台灣的貼文沒寫哪天、補充寫了，用補充的日期（模型有時會忽略補充）
    if (ex.country) localizeTimes(ex);
    else {
      applySupplementDate(ex, post.supplement, post.text, post.posted_at);
      // 「今天14:45前我都在」：從現在到 14:45（不然 14:45 會被當成開始、再往後排）
      startNowForDeadline(ex, text, now);
    }
    // 只寫「本店」沒寫店名：當成沒寫地點（記下原本寫的，回報結果講「只寫了本店」）
    const rawPlace = ex.place_text ?? ex.place_query;
    const selfPlace = dropSelfPlace(ex) ? rawPlace : null;
    const missing = missingActivityParts(ex);
    const start = parseIsoToUnix(ex.start_at);
    const end = parseIsoToUnix(ex.end_at);
    const tz = ex.country ? timeZoneOf(ex) : null;
    // 只寫日期沒寫幾點：模型常填 00:00，當成沒寫開始時間
    const dateOnly = start !== null && guessedMidnight(start, tz, text);
    if (dateOnly) missing.push('start');
    // 跨過午夜、模型把結束寫成同一天（22:00–02:00）：結束是隔天；差更多的是讀錯，當成沒寫結束
    if (start !== null && end !== null && end <= start) ex.end_at = end + DAY_SEC > start ? new Date((end + DAY_SEC) * 1000).toISOString() : null;
    const which = { title: ex.title.trim() || null, place: ex.place_text ?? ex.place_query ?? selfPlace ?? null };
    if (missing.length > 0) {
      // 讀得到的時間也帶著，回報的人修改資料時不用重填
      const fixedEnd = parseIsoToUnix(ex.end_at);
      const when = start !== null && !dateOnly ? { startAt: start, ...(fixedEnd !== null ? { endAt: fixedEnd } : {}), endOpen: fixedEnd === null, tz } : {};
      const fail: FailedItem = { ...which, reason: 'incomplete', missing, ...(selfPlace ? { selfPlace } : {}), ...(dateOnly && start !== null ? { dateOnly: start, tz } : {}), ...when };
      items.push({ group, plan: null, reason: `incomplete:${missing.join(',')}`, fail });
      continue;
    }
    const r = await planEvent(env, ex, now, deadline, undefined, undefined, undefined, OPEN_END_SEC);
    if (r.plan && r.plan.lat === null) {
      items.push({ group, plan: null, reason: 'unlocated', fail: { ...which, reason: 'unlocated', ...planWhen(r.plan) } });
      continue;
    }
    const fail = r.plan ? undefined : failOf(r, which, ex.end_at === null);
    items.push({ group, ...r, ...(fail ? { fail } : {}) });
  }
  return markRoutes(items, text, routeTitle, now);
}

/** 地點查不到的那一場的時間（回報的人修改資料時不用重填） */
const planWhen = (p: PlannedEvent): Pick<FailedItem, 'startAt' | 'endAt' | 'endOpen' | 'tz'> => ({ startAt: p.start_at, endAt: p.end_at, endOpen: p.end_open, tz: p.tz ?? null });

/** 回報的人自己填的一場（洋流的活動）：時間是 unix 秒，結束 null 是沒寫結束；lat、lng 是在地圖上標的位置，沒標就照地點查 */
export interface ManualActivity {
  title: string;
  startAt: number;
  endAt: number | null;
  place: string;
  lat: number | null;
  lng: number | null;
}

/**
 * 回報的人填的地點（修改表單）：最後寫了國名、或有美國的州加郵遞區號的，只在那個國家查，順便帶出當地時區；
 * 其他照台灣的查法（門牌查不到退到路、鄉鎮區）
 */
export async function locateTypedPlace(
  env: Env,
  place: string,
  deadline: number,
): Promise<{ point: GeoPoint | null; approxArea: string | null; country: string | null; tz: string | null }> {
  const country = countryOfPlace(place);
  if (!country) return { ...(await locatePlaceForEvent(env, place, place, deadline)), country: null, tz: null };
  const hit = await geocodeWorld(env, place, place, country);
  const tz = timeZoneOf({ country, timezone: regionTimeZone(regionOfPlace(place) ?? hit?.region) });
  return { point: hit?.point ?? null, approxArea: hit?.approxArea ?? null, country, tz };
}

/** 回報的人填的地點的當地時區：國外才有；地址沒寫州就用查到的州（查過的有快取） */
export async function typedPlaceTimeZone(env: Env, place: string): Promise<string | null> {
  const country = countryOfPlace(place);
  if (!country) return null;
  const region = regionOfPlace(place) ?? (await geocodeWorld(env, place, place, country))?.region;
  return timeZoneOf({ country, timezone: regionTimeZone(region) });
}

/**
 * 修改表單的時間是活動當地的時間（網頁先照台北時間換成秒送來）：國外的地點換成當地時間的時間點，台灣的不動。
 * 一場一場來（Nominatim 每秒最多一次）
 */
export async function atLocalTimes(env: Env, acts: ManualActivity[]): Promise<ManualActivity[]> {
  const out: ManualActivity[] = [];
  for (const a of acts) {
    const tz = await typedPlaceTimeZone(env, a.place);
    const shift = (t: number): number => (tz ? (localToUnix(new Date((t + 8 * 3600) * 1000).toISOString().slice(0, 19), tz) ?? t) : t);
    out.push({ ...a, startAt: shift(a.startAt), endAt: a.endAt === null ? null : shift(a.endAt) });
  }
  return out;
}

/**
 * 回報的人直接修改的活動：不再問 AI，照填的資料排（有標位置就用標的，沒標照地點查），
 * 一樣檢查時間（已經過了、太久以後）和雷達上有沒有同一場
 */
export async function planManual(env: Env, acts: ManualActivity[], now: number, text = '', routeTitle: string | null = null): Promise<PlanItem[]> {
  const deadline = Date.now() + ADDRESS_BUDGET_MS;
  const items: PlanItem[] = [];
  for (const [group, a] of acts.entries()) {
    const iso = (t: number): string => new Date(t * 1000).toISOString();
    const pin = a.lat !== null && a.lng !== null ? { lat: a.lat, lng: a.lng } : null;
    // 有標位置就不用查；國家、時區還是看填的地點
    const found = pin
      ? { point: { ...pin, displayName: a.place }, approxArea: null, country: countryOfPlace(a.place), tz: await typedPlaceTimeZone(env, a.place) }
      : await locateTypedPlace(env, a.place, deadline);
    const ex: ExtractedEvent = {
      kind: 'activity',
      title: a.title,
      item: null,
      start_at: iso(a.startAt),
      end_at: a.endAt === null ? null : iso(a.endAt),
      place_text: a.place,
      place_query: a.place,
      confidence: 1,
      spot: false,
      until: null,
      // 時間是表單送來的時間點，不用換算，時區只用來顯示當地時間
      country: found.country,
      timezone: found.tz,
    };
    const located = { point: found.point, approxArea: found.approxArea };
    const r = await planEvent(env, ex, now, deadline, undefined, located, undefined, OPEN_END_SEC);
    const which = { title: a.title, place: a.place };
    if (r.plan && r.plan.lat === null) {
      items.push({ group, plan: null, reason: 'unlocated', fail: { ...which, reason: 'unlocated', ...planWhen(r.plan) } });
      continue;
    }
    const fail = r.plan ? undefined : failOf(r, which, a.endAt === null);
    items.push({ group, ...r, ...(fail ? { fail: { ...fail, ...(pin ?? {}) } } : {}) });
  }
  // 車掃：回報的人填的標題照用，不改成「路線名稱・站名」
  return markRoutes(items, text, routeTitle, now, false);
}

/** 車掃、掃街、車隊：貼文有這些字、同一天讀出好幾站的，合成一條路線 */
export const ROUTE_RE = /車掃|掃街|車隊/;
/** 車掃的每一站：預計經過前 10 分鐘到經過後 15 分鐘算「經過中」 */
export const ROUTE_LEAD_SEC = 10 * 60;
export const ROUTE_KEEP_SEC = 15 * 60;

/** 台北時間的日期「2026-10-27」 */
const taipeiDate = (unix: number): string => new Date((unix + 8 * 3600) * 1000).toISOString().slice(0, 10);

/**
 * 貼文寫了車掃、掃街、車隊，同一天又有兩站以上（有時間、有地點）：合成一條路線（PlanItem.route）。
 * 每一站的事件改成預計經過前 ROUTE_LEAD_SEC 到經過後 ROUTE_KEEP_SEC（不是一般活動的兩小時），標題改成「路線名稱・站名」；
 * 只定位到鄉鎮區、路的站不放上雷達（記成 approximate，路線上也不畫），回報的人在地圖上標出位置才放；
 * 已經經過的站留在時間表上。一站都放不上雷達的就不算路線，照一般活動。
 * retitle = false：回報的人自己填的標題照用
 */
export function markRoutes(items: PlanItem[], text: string, routeTitle: string | null, now: number, retitle = true): PlanItem[] {
  const kw = ROUTE_RE.exec(text)?.[0];
  if (!kw) return items;
  // name 是這一站的地點（place_text）
  const stops: Array<{ it: PlanItem; at: number; name: string }> = [];
  for (const it of items) {
    const p = it.plan;
    const f = it.fail;
    // 國外的不算（時間是當地的）
    if (p && !p.spot && !p.tz) stops.push({ it, at: p.start_at, name: p.place_text });
    else if (!p && f && (f.reason === 'unlocated' || f.reason === 'already_over') && f.startAt !== undefined && f.place && !f.tz) stops.push({ it, at: f.startAt, name: f.place });
  }
  const days = new Map<string, typeof stops>();
  for (const st of stops) days.set(taipeiDate(st.at), [...(days.get(taipeiDate(st.at)) ?? []), st]);
  const title = routeTitle?.trim() || `${kw}路線`;
  for (const [key, list] of days) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.at - b.at);
    // 兩個不同的站定位在同一點（40 m 內）：其中一站多半查錯了（模型把別站的地名套過來）。
    // 查詢沒寫到自己站名的那站不放上雷達，請回報的人標位置；分不出來就算後面那站
    const core = (name: string): string => [...name].slice(-3).join('');
    for (const [i, a] of list.entries()) {
      for (const b of list.slice(i + 1)) {
        const pa = a.it.plan;
        const pb = b.it.plan;
        if (!pa || !pb || pa.lat === null || pa.lng === null || pb.lat === null || pb.lng === null || pa.approx_area || pb.approx_area || a.name === b.name) continue;
        if (distM({ lat: pa.lat, lng: pa.lng }, { lat: pb.lat, lng: pb.lng }) > 40) continue;
        const aOk = pa.place_query.includes(core(a.name));
        const bOk = pb.place_query.includes(core(b.name));
        const [bad, good] = aOk && !bOk ? [b, a] : !aOk && bOk ? [a, b] : [b, a];
        const title = bad === a ? pa.title : pb.title;
        bad.it.plan = null;
        bad.it.reason = 'unlocated';
        bad.it.fail = { title, place: bad.name, reason: 'unlocated', sameAs: good.name, startAt: bad.at, endOpen: true };
      }
    }
    // 至少一站放得上雷達（有確切位置、還沒經過）
    if (!list.some((st) => st.it.plan && st.it.plan.lat !== null && !st.it.plan.approx_area && st.at + ROUTE_KEEP_SEC > now)) continue;
    list.forEach((st, i) => {
      const { it, at, name } = st;
      const p = it.plan;
      const own = p?.title ?? it.fail?.title ?? null;
      const stopTitle = retitle || !own ? `${title}・${name}` : own;
      // 時間表寫站名：回報的人自己填的標題「路線名稱・蘇巧慧鶯歌服務處」取站名，地點填地址時另外列
      const stopName = retitle ? name : stopNameOf(stopTitle, title, name);
      const query = p?.place_query ?? name;
      const route: RouteStopPlan = {
        key,
        title,
        seq: i + 1,
        kind: i === 0 ? 'start' : i === list.length - 1 ? 'end' : 'cheer',
        name: stopName,
        ...(stopName !== name ? { place: name } : {}),
        stopTitle,
        at,
        lat: null,
        lng: null,
        ...(query !== name ? { query } : {}),
      };
      it.route = route;
      if (p && p.approx_area) {
        // 只定位到鄉鎮區、路：不放上雷達，請回報的人標位置（帶著約略位置，地圖從那裡開始）
        it.plan = null;
        it.reason = 'approximate';
        it.fail = { title: stopTitle, place: name, reason: 'approximate', area: p.approx_area, startAt: at, endOpen: true, ...(p.lat !== null && p.lng !== null ? { lat: p.lat, lng: p.lng } : {}) };
        return;
      }
      if (p && p.lat !== null && p.lng !== null) {
        route.lat = p.lat;
        route.lng = p.lng;
        if (at + ROUTE_KEEP_SEC <= now) {
          // 車隊已經經過：留在時間表上，不放上雷達
          it.plan = null;
          it.reason = 'already_over';
          return;
        }
        Object.assign(p, { title: stopTitle, start_at: at - ROUTE_LEAD_SEC, end_at: at + ROUTE_KEEP_SEC, end_open: false });
        return;
      }
      if (it.fail) it.fail = { ...it.fail, title: stopTitle };
    });
  }
  return items;
}

/**
 * 時間表上的站名：標題「路線名稱・站名」（或「…・站名」）取「・」後面；標題就是路線名稱、取不出來的用地點
 */
export function stopNameOf(stopTitle: string, routeTitle: string, place: string): string {
  const rest = stopTitle.startsWith(`${routeTitle}・`) ? stopTitle.slice(routeTitle.length + 1) : stopTitle.includes('・') ? stopTitle.slice(stopTitle.lastIndexOf('・') + 1) : stopTitle === routeTitle ? '' : stopTitle;
  return rest.trim() || place;
}

/** routes.stops 存的一站 */
interface StoredRouteStop {
  kind: 'start' | 'cheer' | 'end';
  title: string;
  /** 站名 */
  name: string;
  /** 地點（地址），跟站名不一樣時才有 */
  place?: string;
  lat: number | null;
  lng: number | null;
  at: number | null;
  query?: string;
  /** 排程上次重查位置的時間 */
  checkedAt?: number;
}

/** 路線上的一站：標題一樣、預計經過時間在 window 裡（null 就只看標題） */
type StopWindow = { from: number; to: number } | null;
const isStop = (st: { title: string; at: number | null }, title: string, win: StopWindow): boolean =>
  st.title === title && (win === null || (st.at !== null && st.at >= win.from && st.at <= win.to));

/** 路線拿掉一站：其他站照順序，第一站改成出發、最後一站改成抵達；沒有這一站回傳 null */
export function withoutStop<T extends { kind: 'start' | 'cheer' | 'end'; title: string; at: number | null }>(stops: T[], title: string, win: StopWindow): T[] | null {
  const keep = stops.filter((st) => !isStop(st, title, win));
  if (keep.length === stops.length) return null;
  return keep.map((st, i) => ({ ...st, kind: i === 0 ? 'start' : i === keep.length - 1 ? 'end' : 'cheer' }));
}

/** 回報的車掃路線上的一站（問題回報指定哪一站時用） */
export async function findRouteStop(env: Env, postId: string, title: string, at: number | null): Promise<StoredRouteStop | null> {
  const { results } = await env.DB.prepare('SELECT stops FROM routes WHERE post_id = ?').bind(postId).all<{ stops: string }>();
  for (const r of results) {
    const st = (JSON.parse(r.stops) as StoredRouteStop[]).find((s) => isStop(s, title, at === null ? null : { from: at, to: at }));
    if (st) return st;
  }
  return null;
}

/**
 * 從回報的車掃路線拿掉一站：時間表、路線的連線、出發和抵達時間跟著改（一站都不剩就刪掉路線），
 * 雷達上那一站的點也下架。回傳下架幾個點、拿掉幾站
 */
export async function removeRouteStop(env: Env, postId: string, title: string, win: StopWindow, now: number): Promise<{ events: number; stops: number }> {
  const { results } = await env.DB.prepare('SELECT id, stops FROM routes WHERE post_id = ?').bind(postId).all<{ id: string; stops: string }>();
  const stmts: D1PreparedStatement[] = [];
  let stops = 0;
  for (const r of results) {
    const list = JSON.parse(r.stops) as StoredRouteStop[];
    const keep = withoutStop(list, title, win);
    if (!keep) continue;
    stops += list.length - keep.length;
    if (keep.length === 0) {
      stmts.push(env.DB.prepare('DELETE FROM routes WHERE id = ?').bind(r.id));
      continue;
    }
    const first = keep[0];
    const last = keep[keep.length - 1];
    stmts.push(
      env.DB.prepare('UPDATE routes SET stops = ?, segments = ?, depart_at = ?, arrive_at = ?, show_until = ?, updated_at = ? WHERE id = ?').bind(
        JSON.stringify(keep),
        JSON.stringify(routeSegments(keep)),
        first.at,
        last.at,
        (last.at ?? now) + ROUTE_KEEP_SEC,
        now,
        r.id,
      ),
    );
  }
  if (stmts.length > 0) await env.DB.batch(stmts);
  // 雷達上那一站的點：同一則貼文、同一個標題、預計經過時間在那一場裡
  const ev = await env.DB.prepare(
    `UPDATE events SET status = 'ended', ended_reason = 'feedback', updated_at = ?
      WHERE post_id = ? AND title = ? AND status IN ('upcoming', 'active', 'unlocated')${win ? ' AND start_at <= ? AND end_at >= ?' : ''}`,
  )
    .bind(now, postId, title, ...(win ? [win.to, win.from] : []))
    .run();
  return { events: ev.meta.changes ?? 0, stops };
}

/**
 * 改回報的車掃路線上一站的位置（管理者處理「地點錯誤」）：時間表、路線的連線跟著改；
 * 雷達上那一站的點改位置，原本不在雷達上（只有約略位置、查不到）的、車隊還沒經過的，放上雷達。
 * placeText 是新的地點文字（貼座標的是 null，地點文字不變）。回傳改了幾站
 */
export async function setRouteStopPlace(
  env: Env,
  postId: string,
  title: string,
  at: number | null,
  point: { lat: number; lng: number },
  placeText: string | null,
  now: number,
): Promise<number> {
  const { results } = await env.DB.prepare('SELECT id, stops FROM routes WHERE post_id = ?').bind(postId).all<{ id: string; stops: string }>();
  const win = at === null ? null : { from: at, to: at };
  let changed = 0;
  let stop: StoredRouteStop | null = null;
  for (const r of results) {
    const list = JSON.parse(r.stops) as StoredRouteStop[];
    const st = list.find((s) => isStop(s, title, win));
    if (!st) continue;
    st.lat = point.lat;
    st.lng = point.lng;
    if (placeText) st.place = placeText;
    stop = st;
    changed++;
    await env.DB.prepare('UPDATE routes SET stops = ?, segments = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(list), JSON.stringify(routeSegments(list)), now, r.id).run();
  }
  if (!stop) return 0;
  const place = placeText ?? stop.place ?? stop.name;
  const live = "status IN ('upcoming', 'active', 'unlocated')";
  const ev = await env.DB.prepare(
    `UPDATE events SET lat = ?, lng = ?, place_text = ?, place_query = ?, approx_area = NULL, status = CASE WHEN start_at <= ? THEN 'active' ELSE 'upcoming' END, updated_at = ?
      WHERE post_id = ? AND title = ? AND ${live}${stop.at !== null ? ' AND start_at <= ? AND end_at >= ?' : ''}`,
  )
    .bind(point.lat, point.lng, place, place, now, now, postId, title, ...(stop.at !== null ? [stop.at, stop.at] : []))
    .run();
  // 原本沒放上雷達的站：車隊還沒經過就放上去（預計經過前 10 分到後 15 分）
  if ((ev.meta.changes ?? 0) === 0 && stop.at !== null && stop.at + ROUTE_KEEP_SEC > now) {
    await insertPlanned(
      env,
      postId,
      { kind: 'activity', title, item: null, start_at: stop.at - ROUTE_LEAD_SEC, end_at: stop.at + ROUTE_KEEP_SEC, place_text: place, place_query: place, lat: point.lat, lng: point.lng, confidence: 1, all_day: false, spot: false, approx_area: null, end_open: false, until_open: false, tz: null, extra: null },
      now,
      true,
    );
  }
  return changed;
}

/** 有確切位置的站照順序用直線連起來（不知道實際走哪些路），沒有認領人數 */
function routeSegments(stops: Array<{ name: string; lat: number | null; lng: number | null; at: number | null }>) {
  const pts = stops.filter((st): st is typeof st & { lat: number; lng: number } => st.lat !== null && st.lng !== null);
  return pts.slice(1).map((b, i) => {
    const a = pts[i];
    return { seq: i + 1, from: a.name, to: b.name, path: [[a.lat, a.lng], [b.lat, b.lng]], lengthM: Math.round(distM(a, b)), people: 0, target: 0, toAt: b.at };
  });
}

/** 車掃路線上沒有確切位置、寫了門牌的站：每次排程最多查幾站、同一站隔多久再查 */
const ROUTE_RELOCATE_PER_RUN = 3;
const ROUTE_RELOCATE_EVERY_SEC = 20 * 60;

/**
 * 回報的車掃路線上，寫了門牌卻沒有確切位置的站（判讀、修改當時門牌查詢失敗或逾時，只退到路、鄉鎮區）定時重查：
 * 查到確切位置就放上雷達（預計經過前 10 分到後 15 分），路線補上這一站、重新連線。
 * 車隊已經經過的、雷達上這則貼文已經沒有東西的（下架、刪除）不查；沒寫門牌的（只有店名）重查也一樣，要回報的人標位置。
 * 有確切位置、還沒經過，卻從來沒放上雷達的站（以前同一則的站離不到 150 m 被當成重複）也在這裡補放上去
 */
export async function relocateRouteStops(env: Env, now: number): Promise<{ checked: number; located: number; restored: number }> {
  const { results } = await env.DB.prepare(
    `SELECT id, post_id, stops FROM routes WHERE id LIKE 'link-%' AND show_until > ?
       AND EXISTS (SELECT 1 FROM events e WHERE e.post_id = routes.post_id AND e.status IN ('upcoming', 'active'))`,
  )
    .bind(now)
    .all<{ id: string; post_id: string; stops: string }>();
  let checked = 0;
  let located = 0;
  let restored = 0;
  for (const r of results) {
    const stops = JSON.parse(r.stops) as StoredRouteStop[];
    let changed = false;
    // 這則貼文每一站的點（不管狀態：已經下架、回報發完的不再放回去）
    const { results: evs } = await env.DB.prepare('SELECT title, start_at, end_at FROM events WHERE post_id = ?').bind(r.post_id).all<{ title: string; start_at: number; end_at: number }>();
    for (const st of stops) {
      if (st.at === null || st.at + ROUTE_KEEP_SEC <= now) continue;
      // 有確切位置、還沒經過，雷達上卻從來沒有這一站（以前同一則離太近的站被當成重複）：補放上去
      if (st.lat !== null && st.lng !== null) {
        const at = st.at;
        if (evs.some((e) => e.title === st.title && e.start_at <= at && e.end_at >= at)) continue;
        const place = st.place ?? st.name;
        const ins = await insertPlanned(
          env,
          r.post_id,
          { kind: 'activity', title: st.title, item: null, start_at: at - ROUTE_LEAD_SEC, end_at: at + ROUTE_KEEP_SEC, place_text: place, place_query: st.query ?? place, lat: st.lat, lng: st.lng, confidence: 1, all_day: false, spot: false, approx_area: null, end_open: false, until_open: false, tz: null, extra: null },
          now,
          true,
        );
        if (ins.event) restored++;
        continue;
      }
      if (checked >= ROUTE_RELOCATE_PER_RUN) continue;
      const place = st.place ?? st.name;
      if (!addressOf(st.query ?? place, place) || (st.checkedAt ?? 0) > now - ROUTE_RELOCATE_EVERY_SEC) continue;
      checked++;
      st.checkedAt = now;
      changed = true;
      const loc = await locatePlaceForEvent(env, st.query ?? place, place, Date.now() + ADDRESS_BUDGET_MS);
      if (!loc.point || loc.approxArea) continue;
      st.lat = loc.point.lat;
      st.lng = loc.point.lng;
      located++;
      // 雷達上已經有同一場（別人回報的）就不另外放，路線照樣連過去
      await insertPlanned(
        env,
        r.post_id,
        { kind: 'activity', title: st.title, item: null, start_at: st.at - ROUTE_LEAD_SEC, end_at: st.at + ROUTE_KEEP_SEC, place_text: place, place_query: st.query ?? place, lat: st.lat, lng: st.lng, confidence: 1, all_day: false, spot: false, approx_area: null, end_open: false, until_open: false, tz: null, extra: null },
        now,
        true,
      );
    }
    if (changed) {
      await env.DB.prepare('UPDATE routes SET stops = ?, segments = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(stops), JSON.stringify(routeSegments(stops)), now, r.id).run();
    }
  }
  return { checked, located, restored };
}

/** 兩點的直線距離（公尺） */
function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * 回報的車掃路線寫進 routes（id 是「貼文 id-日期」）：每一站的預計時間，有確切位置的站照順序用直線連起來
 * （不知道實際走哪些路），沒有認領人數。同一則貼文舊的路線先刪掉
 */
async function saveRoutes(env: Env, postId: string, items: PlanItem[], now: number): Promise<void> {
  const byKey = new Map<string, RouteStopPlan[]>();
  for (const it of items) if (it.route) byKey.set(it.route.key, [...(byKey.get(it.route.key) ?? []), it.route]);
  if (byKey.size === 0) return;
  const stmts = [env.DB.prepare('DELETE FROM routes WHERE post_id = ?').bind(postId)];
  for (const [key, list] of byKey) {
    const stops = [...list].sort((a, b) => a.seq - b.seq);
    const segments = routeSegments(stops);
    const first = stops[0];
    const last = stops[stops.length - 1];
    stmts.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO routes (id, post_id, title, day_start, depart_at, arrive_at, show_until, claim_url, stops, segments, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      ).bind(
        `${postId}-${key}`,
        postId,
        first.title,
        Math.floor(Date.parse(`${key}T00:00:00+08:00`) / 1000),
        first.at,
        last.at,
        last.at + ROUTE_KEEP_SEC,
        JSON.stringify(stops.map((st): StoredRouteStop => ({ kind: st.kind, title: st.stopTitle, name: st.name, ...(st.place ? { place: st.place } : {}), lat: st.lat, lng: st.lng, at: st.at, ...(st.query ? { query: st.query } : {}) }))),
        JSON.stringify(segments),
        now,
      ),
    );
  }
  await env.DB.batch(stmts);
}

/** planEvent 沒排上去的原因換成回報結果用的說明；重複的不算（回報結果會列出雷達上的那一場） */
function failOf(r: { reason: string; start?: number; end?: number; tz?: string | null }, which: Pick<FailedItem, 'title' | 'place'>, endOpen: boolean): FailedItem | undefined {
  if (r.reason === 'low_confidence') return { ...which, reason: 'low_confidence' };
  if (r.reason !== 'already_over' && r.reason !== 'too_far_in_future') return undefined;
  return {
    ...which,
    reason: r.reason,
    startAt: r.start,
    endAt: r.end,
    endOpen,
    tz: r.tz ?? null,
    ...(r.reason === 'too_far_in_future' && r.start !== undefined ? { reportFrom: r.start - MAX_FUTURE_SEC } : {}),
  };
}

/**
 * 固定據點自己的那段文字：只有一個固定據點（可以有好幾個時段）就是整則貼文加補充；
 * 好幾個地點時，從這個地點在貼文出現的地方，到下一個別的地點為止。找不到回傳 null。
 */
export function spotScope(text: string, ex: Pick<ExtractedEvent, 'place_text' | 'place_query'>, all: Array<Pick<ExtractedEvent, 'spot' | 'place_text' | 'place_query'>>): string | null {
  const key = (e: Pick<ExtractedEvent, 'place_text' | 'place_query'>): string | null => e.place_query ?? e.place_text;
  const others = [...new Set(all.filter((e) => e.spot && key(e) !== key(ex)).map((e) => e.place_text).filter((p): p is string => !!p))];
  if (others.length === 0) return text;
  const at = ex.place_text ? text.indexOf(ex.place_text) : -1;
  if (at < 0) return null;
  const next = others.map((p) => text.indexOf(p, at + 1)).filter((i) => i > at);
  return text.slice(at, next.length > 0 ? Math.min(...next) : undefined);
}

/**
 * 用目前的判讀與定位規則重跑一則貼文：還沒結束的舊事件先刪掉；管理者重跑就是確認過了
 * （之後有人再貼這則，不會再要人確認、重複放一次）
 */
export async function reprocessPost(env: Env, id: string, now: number): Promise<ProcessResult> {
  const post = await getPost(env, id);
  if (!post) throw new Error('post not found');
  if (post.source === 'official') throw new Error('官方航線由同步程式產生，不能重新判讀');
  // 新聞判讀後只留標題加摘要，重跑會因為內容不完整而判讀錯
  if (post.source === 'news') throw new Error('新聞只保存標題與摘要，不能重新判讀');
  // 管理者改過的標題：重新判讀後，同一個地點的照樣用
  const { results: manual } = await env.DB.prepare(
    "SELECT DISTINCT place_text, title FROM events WHERE post_id = ? AND title_manual = 1 AND status IN ('upcoming', 'active', 'unlocated')",
  )
    .bind(id)
    .all<{ place_text: string; title: string }>();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM ended_reports WHERE event_id IN (SELECT id FROM events WHERE post_id = ? AND status IN ('upcoming', 'active', 'unlocated'))").bind(id),
    env.DB.prepare("DELETE FROM events WHERE post_id = ? AND status IN ('upcoming', 'active', 'unlocated')").bind(id),
  ]);
  const result = await processPost(env, post, now);
  if (manual.length > 0) {
    await env.DB.batch(
      manual.map((m) =>
        env.DB.prepare("UPDATE events SET title = ?, title_manual = 1 WHERE post_id = ? AND place_text = ? AND status IN ('upcoming', 'active', 'unlocated')").bind(m.title, id, m.place_text),
      ),
    );
  }
  await env.DB.prepare("UPDATE posts SET confirm_state = 'confirmed', confirm_plan = NULL WHERE id = ? AND confirm_state IS NOT NULL").bind(id).run();
  return result;
}

/** 管理者直接改標題：同一則貼文、同一個地點還沒結束的（固定據點的每天時段）都改，回傳改了幾筆 */
export async function setManualTitle(env: Env, eventId: number, title: string, now: number): Promise<number> {
  const ev = await env.DB.prepare('SELECT post_id, place_text FROM events WHERE id = ?').bind(eventId).first<{ post_id: string; place_text: string }>();
  if (!ev) return 0;
  const r = await env.DB.prepare(
    "UPDATE events SET title = ?, title_manual = 1, updated_at = ? WHERE post_id = ? AND place_text = ? AND status IN ('upcoming', 'active', 'unlocated')",
  )
    .bind(title, now, ev.post_id, ev.place_text)
    .run();
  return r.meta.changes ?? 0;
}

/**
 * 從雷達下架：scope = 'post' 整則貼文的；'event' 只有這一則（固定據點連同同一個地點的每天時段）。回傳下架幾筆
 */
export async function takeDown(env: Env, eventId: number, scope: 'event' | 'post', reason: string, now: number): Promise<number> {
  const ev = await env.DB.prepare('SELECT id, post_id, title, place_text, spot, start_at, end_at FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ id: number; post_id: string; title: string; place_text: string; spot: number; start_at: number; end_at: number }>();
  if (!ev) return 0;
  // 車掃的一站：時間表、路線也拿掉這一站
  if (scope === 'event' && !ev.spot) {
    const r = await removeRouteStop(env, ev.post_id, ev.title, { from: ev.start_at, to: ev.end_at }, now);
    if (r.stops > 0) return r.events;
  }
  const live = "status IN ('upcoming', 'active', 'unlocated')";
  const r =
    scope === 'post'
      ? await env.DB.prepare(`UPDATE events SET status = 'ended', ended_reason = ?, updated_at = ? WHERE post_id = ? AND ${live}`).bind(reason, now, ev.post_id).run()
      : ev.spot
        ? await env.DB.prepare(`UPDATE events SET status = 'ended', ended_reason = ?, updated_at = ? WHERE post_id = ? AND place_text = ? AND ${live}`).bind(reason, now, ev.post_id, ev.place_text).run()
        : await env.DB.prepare(`UPDATE events SET status = 'ended', ended_reason = ?, updated_at = ? WHERE id = ? AND ${live}`).bind(reason, now, ev.id).run();
  return r.meta.changes ?? 0;
}

/** 職缺沒寫工作期間時，在雷達上留幾天；有寫也最多留到發文後幾天（貼文最多存 30 天） */
const JOB_DEFAULT_DAYS = 14;
const JOB_MAX_DAYS = 30;

/** 「2026-11-30」台北時間那天 00:00 */
const taipeiDayOf = (d: string | null): number | null => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T00:00:00+08:00`) / 1000 : null);

/**
 * 狗狗陪伴：每個工作地點一筆。從發文開始就算「徵才中」，到工作期間最後一天結束（沒寫就留 JOB_DEFAULT_DAYS 天），
 * 工作期間、每天時段、薪資、雇主、怎麼應徵、防詐提醒放在 extra
 */
async function planJobs(env: Env, post: PostRow, jobs: ExtractedEvent[], now: number): Promise<PlanItem[]> {
  const items: PlanItem[] = [];
  const deadline = Date.now() + ADDRESS_BUDGET_MS;
  for (const [group, ex] of jobs.entries()) {
    if (ex.confidence < MIN_CONFIDENCE) {
      items.push({ group, plan: null, reason: 'low_confidence' });
      continue;
    }
    const job = ex.job ?? { role: 'hire' as const, work_from: null, work_to: null, slots: [], pay: null, employer: null, contact: null, requirements: null };
    const start = Math.min(post.posted_at, now);
    const lastDay = taipeiDayOf(job.work_to) ?? taipeiDayOf(job.work_from);
    const end = Math.min(lastDay !== null ? lastDay + DAY_SEC : post.posted_at + JOB_DEFAULT_DAYS * DAY_SEC, post.posted_at + JOB_MAX_DAYS * DAY_SEC);
    if (end <= now) {
      items.push({ group, plan: null, reason: 'already_over', start, end });
      continue;
    }
    const placeQuery = ex.place_query ?? ex.place_text;
    const placeText = ex.place_text ?? ex.place_query;
    if (!placeQuery || !placeText) {
      items.push({ group, plan: null, reason: 'no_place' });
      continue;
    }
    const { point, approxArea } = await locateOrCity(env, placeQuery, placeText, ex.place_text, deadline);
    items.push({
      group,
      reason: 'planned',
      plan: {
        kind: 'job',
        title: ex.title,
        item: job.pay,
        start_at: start,
        end_at: end,
        place_text: placeText,
        place_query: placeQuery,
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        confidence: ex.confidence,
        all_day: false,
        spot: false,
        approx_area: approxArea,
        end_open: lastDay === null,
        until_open: false,
        weekdays: null,
        tz: null,
        extra: JSON.stringify({ ...job, risks: jobRisks(job, post.text) }),
      },
    });
  }
  return items;
}

/** 定位；只寫到縣市（「台中市區」）的刊登常這樣寫：放在縣市中心、標成約略位置 */
async function locateOrCity(env: Env, placeQuery: string, placeText: string, rawText: string | null, deadline: number): Promise<{ point: GeoPoint | null; approxArea: string | null }> {
  const loc = await locatePlaceForEvent(env, placeQuery, rawText, deadline);
  if (loc.point) return loc;
  const city = cityLevel(placeQuery) ?? cityLevel(placeText);
  const p = city ? await geocode(env, city) : null;
  return p && city ? { point: p, approxArea: city } : loc;
}

/**
 * 刊登（不是場次）的角色，沒寫確切時間時在雷達上留幾天：
 * 找臨打（羽球臨打）7 天、網友推薦（等一下吃什麼）14 天、揪團吃飯 3 天
 */
const POSTING_DAYS: Record<string, number> = { seek: 7, recommend: 14, meetup: 3 };

/**
 * 刊登（找臨打、網友推薦、揪團吃飯）：從發文開始就算刊登中；寫了約的時段（想打、約吃飯）就到那個時段結束，
 * 沒寫留 POSTING_DAYS 天。約的時段放在 extra 的 play_at、play_end
 */
async function planPostings(env: Env, post: PostRow, list: ExtractedEvent[], now: number, groupFrom: number): Promise<PlanItem[]> {
  const items: PlanItem[] = [];
  const deadline = Date.now() + ADDRESS_BUDGET_MS;
  for (const [i, ex] of list.entries()) {
    const group = groupFrom + i;
    if (ex.confidence < MIN_CONFIDENCE) {
      items.push({ group, plan: null, reason: 'low_confidence' });
      continue;
    }
    const playAt = parseIsoToUnix(ex.start_at);
    const playEnd = playAt !== null ? (parseIsoToUnix(ex.end_at) ?? playAt + 3 * 3600) : null;
    const start = Math.min(post.posted_at, now);
    const end = playEnd ?? post.posted_at + (POSTING_DAYS[String(ex.extra?.role)] ?? 7) * DAY_SEC;
    if (end <= now) {
      items.push({ group, plan: null, reason: 'already_over', start: playAt ?? start, end });
      continue;
    }
    const placeQuery = ex.place_query ?? ex.place_text;
    const placeText = ex.place_text ?? ex.place_query;
    if (!placeQuery || !placeText) {
      items.push({ group, plan: null, reason: 'no_place' });
      continue;
    }
    const { point, approxArea } = await locateOrCity(env, placeQuery, placeText, ex.place_text, deadline);
    items.push({
      group,
      reason: 'planned',
      plan: {
        kind: ex.kind,
        title: ex.title,
        // 找臨打的卡片寫程度，其他寫吃什麼
        item: ex.kind === 'session' ? ((ex.extra?.level as string | null | undefined) ?? null) : ex.item,
        start_at: start,
        end_at: end,
        place_text: placeText,
        place_query: placeQuery,
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        confidence: ex.confidence,
        all_day: false,
        spot: false,
        approx_area: approxArea,
        end_open: playEnd === null,
        until_open: false,
        weekdays: null,
        tz: null,
        extra: JSON.stringify({ ...ex.extra, play_at: playAt, play_end: playAt !== null ? playEnd : null }),
      },
    });
  }
  return items;
}

/** extra 欄位（JSON）讀出來；壞掉的當沒有 */
function parseExtra(v: string | null | undefined): Record<string, unknown> | null {
  if (!v) return null;
  try {
    const o = JSON.parse(v) as unknown;
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 把判讀好的寫進雷達，回傳跟 processPost 一樣的結果 */
export async function commitPlan(env: Env, postId: string, items: PlanItem[], now: number): Promise<ProcessResult> {
  const out: ProcessResult = { events: [], reasons: [] };
  const replaced = new Set<string>();
  for (const it of items) {
    // 別人的貼文：不另外放，附在雷達上那個據點
    if (it.merge?.mode === 'attach') {
      await env.DB.prepare("UPDATE posts SET linked_to = ?, link_role = 'related' WHERE id = ?").bind(it.merge.postId, postId).run();
      out.reasons.push(`attached_to_${it.merge.eventId}`);
      continue;
    }
    if (!it.plan) {
      out.reasons.push(it.reason);
      continue;
    }
    // 同一個帳號的新貼文：舊據點還沒開完的時段下架，舊貼文（和附在它上面的）改掛到新貼文
    if (it.merge?.mode === 'replace' && it.plan.end_at > now && !replaced.has(it.merge.postId)) {
      replaced.add(it.merge.postId);
      const m = it.merge;
      await env.DB.batch([
        env.DB.prepare("UPDATE events SET status = 'ended', ended_reason = 'replaced', updated_at = ? WHERE post_id = ? AND place_text = ? AND status IN ('upcoming', 'active')").bind(now, m.postId, m.placeText),
        env.DB.prepare('UPDATE posts SET linked_to = ? WHERE linked_to = ?').bind(postId, m.postId),
        env.DB.prepare("UPDATE posts SET linked_to = ?, link_role = 'previous' WHERE id = ?").bind(postId, m.postId),
      ]);
    }
    const r = await insertPlanned(env, postId, it.plan, now, !!it.route);
    if (r.event) out.events.push(r.event);
    out.reasons.push(r.reason);
  }
  // 車掃、掃街、車隊：路線（每一站的時間、連線）另外存，雷達和地圖畫成路線
  if (out.events.length > 0) await saveRoutes(env, postId, items, now);
  return out;
}

/** 對單一貼文跑 LLM 抽取，每個地點或時段各建一個事件（排程搜尋到的貼文、回報的貼文內容改了，直接寫進雷達） */
export async function processPost(env: Env, post: PostRow, now = nowSec()): Promise<ProcessResult> {
  const { items, early } = await planPost(env, post, now);
  if (early) return { events: [], reasons: [early] };
  return commitPlan(env, post.id, items, now);
}

export interface IngestResult {
  keyword: string;
  fetched: number;
  created: number;
  errors: string[];
}

export async function ingestKeyword(env: Env, client: ThreadsClient, kw: KeywordRow, now = nowSec()): Promise<IngestResult> {
  const since = kw.last_since ?? now - LOOKBACK_SEC;
  const posts = await client.keywordSearch({ q: kw.term, since, searchType: 'RECENT', limit: 100 });
  const result: IngestResult = { keyword: kw.term, fetched: posts.length, created: 0, errors: [] };
  let maxTs = since;

  for (const p of posts) {
    let postedAt = now;
    try {
      postedAt = parseThreadsTimestamp(p.timestamp);
    } catch {
      /* 時間壞掉就當作現在 */
    }
    maxTs = Math.max(maxTs, postedAt);
    const inserted = await storePost(
      env,
      { id: p.id, username: p.username ?? null, text: p.text, permalink: p.permalink ?? null, posted_at: postedAt, keyword: kw.term, source: 'threads' },
      now,
    );
    if (!inserted) continue;
    const row = await getPost(env, p.id);
    if (!row) continue;
    try {
      const r = await processPost(env, row, now);
      result.created += locatedCount(r);
    } catch (e) {
      result.errors.push(`${p.id}: ${String(e)}`);
    }
  }

  // 留 5 分鐘重疊避免漏掉邊界貼文，重複的貼文靠 INSERT OR IGNORE 擋掉
  await env.DB.prepare('UPDATE keywords SET last_since = ? WHERE id = ?').bind(Math.max(since, maxTs - 300), kw.id).run();
  return result;
}

export interface BacklogResult {
  processed: number;
  created: number;
  errors: string[];
}

/** 重新處理之前沒成功抽取的貼文（例如 Workers AI 暫時出錯），只看最近 24 小時發的或收到的 */
export async function processBacklog(env: Env, now = nowSec(), limit = 20): Promise<BacklogResult> {
  // 使用者回報、還在等他確認的不自動判讀（他重貼一次就會再判讀）
  const rows = await env.DB.prepare(
    "SELECT * FROM posts WHERE processed_at IS NULL AND (confirm_state IS NULL OR confirm_state = 'confirmed') AND (posted_at > ? OR fetched_at > ?) ORDER BY posted_at ASC LIMIT ?",
  )
    .bind(now - LOOKBACK_SEC, now - LOOKBACK_SEC, limit)
    .all<PostRow>();
  const out: BacklogResult = { processed: 0, created: 0, errors: [] };
  for (const post of rows.results) {
    try {
      const r = await processPost(env, post, now);
      out.processed++;
      out.created += locatedCount(r);
    } catch (e) {
      out.errors.push(`${post.id}: ${String(e)}`);
    }
  }
  return out;
}

export async function ingestAll(env: Env, client: ThreadsClient, now = nowSec()): Promise<IngestResult[]> {
  const out: IngestResult[] = [];
  for (const kw of await listActiveKeywords(env, now)) {
    try {
      out.push(await ingestKeyword(env, client, kw, now));
    } catch (e) {
      out.push({ keyword: kw.term, fetched: 0, created: 0, errors: [String(e)] });
    }
  }
  return out;
}

export interface LifecycleResult {
  promoted: number;
  expired: number;
  checked: number;
  endedByAuthor: number;
}

interface RecheckRow {
  id: number;
  post_id: string;
  username: string | null;
  keyword: string | null;
  posted_at: number;
  source: string;
}

/** 推進事件狀態：到時間就 active、過期就 ended、作者說發完也 ended */
export async function updateLifecycle(env: Env, client: ThreadsClient, now = nowSec()): Promise<LifecycleResult> {
  const promoted = await env.DB.prepare("UPDATE events SET status = 'active', updated_at = ? WHERE status = 'upcoming' AND start_at <= ?")
    .bind(now, now)
    .run();
  const expired = await env.DB.prepare(
    "UPDATE events SET status = 'ended', ended_reason = 'expired', updated_at = ? WHERE status IN ('upcoming', 'active', 'unlocated') AND end_at <= ?",
  )
    .bind(now, now)
    .run();

  const rows = await env.DB.prepare(
    `SELECT e.id, e.post_id, p.username, p.keyword, p.posted_at, p.source
     FROM events e JOIN posts p ON p.id = e.post_id
     WHERE e.status = 'active' AND (e.last_checked_at IS NULL OR e.last_checked_at <= ?)
     ORDER BY e.last_checked_at ASC LIMIT ?`,
  )
    .bind(now - RECHECK_INTERVAL_SEC, RECHECK_BATCH)
    .all<RecheckRow>();

  let endedByAuthor = 0;
  for (const r of rows.results) {
    const texts: string[] = [];
    if (r.source === 'threads') {
      try {
        const reps = await client.replies(r.post_id);
        texts.push(...reps.filter((x) => !r.username || x.username === r.username).map((x) => x.text));
      } catch (e) {
        console.warn(`replies failed for ${r.post_id}: ${String(e)}`);
      }
      if (r.username && r.keyword) {
        try {
          const follow = await client.keywordSearch({ q: r.keyword, authorUsername: r.username, since: r.posted_at + 1, searchType: 'RECENT', limit: 10 });
          texts.push(...follow.map((x) => x.text));
        } catch (e) {
          console.warn(`follow-up search failed for ${r.post_id}: ${String(e)}`);
        }
      }
    }
    if (texts.some(detectEnded)) {
      await env.DB.prepare("UPDATE events SET status = 'ended', ended_reason = 'author', last_checked_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, r.id)
        .run();
      endedByAuthor++;
    } else {
      await env.DB.prepare('UPDATE events SET last_checked_at = ?, updated_at = ? WHERE id = ?').bind(now, now, r.id).run();
    }
  }

  return { promoted: promoted.meta.changes ?? 0, expired: expired.meta.changes ?? 0, checked: rows.results.length, endedByAuthor };
}

export interface ListQuery {
  lat?: number;
  lng?: number;
  radiusKm: number;
  now: number;
  horizonSec: number;
  /** 只回傳這些關鍵字的事件；貼文是用該關鍵字搜到的，或內文含有該關鍵字 */
  keywords?: string[];
  /** 哪個模組的，沒給就是洋流 */
  module?: ModuleId;
}

type JoinedRow = EventRow & { username: string | null; permalink: string | null; text: string; supplement?: string | null; posted_at: number; keyword: string | null; source: string; ended_reports: number | null; has_route?: number | null };

const JOINED_SELECT = `SELECT e.*, p.username, p.permalink, p.text, p.supplement, p.posted_at, p.keyword, p.source,
    (SELECT COUNT(*) FROM ended_reports r WHERE r.event_id = e.id) AS ended_reports,
    (SELECT 1 FROM routes rt WHERE rt.post_id = e.post_id LIMIT 1) AS has_route
  FROM events e JOIN posts p ON p.id = e.post_id`;

export function toEventOut(r: JoinedRow, now: number): EventOut {
  return {
    id: r.id,
    kind: r.kind ?? 'giveaway',
    title: r.title,
    item: r.item,
    startAt: r.start_at,
    endAt: r.end_at,
    placeText: r.place_text,
    lat: r.lat as number,
    lng: r.lng as number,
    status: r.start_at <= now ? 'active' : 'upcoming',
    confidence: r.confidence,
    keyword: r.keyword,
    allDay: r.all_day === 1,
    endOpen: r.end_open === 1,
    untilOpen: r.until_open === 1,
    endedReports: r.ended_reports ?? 0,
    spot: r.spot === 1,
    approxArea: r.approx_area ?? null,
    weekdays: r.weekdays ? r.weekdays.split(',').map(Number) : null,
    tz: r.tz ?? null,
    manualTitle: r.title_manual === 1,
    extra: parseExtra(r.extra),
    // 只給摘錄（著作權：只做必要的引用），完整內容請人看原文
    post: { id: r.post_id, source: r.source, username: r.username, permalink: r.permalink, postedAt: r.posted_at, text: postExcerpt(r.text, r.source), supplement: r.supplement ?? null },
    ...(r.has_route ? { route: true as const } : {}),
  };
}

/** 寫時間、日期、地點的行（摘錄優先留這些） */
const TIME_PLACE_RE = /\d{1,2}\s*[:：]\s*\d{2}|\d{1,2}\s*(?:\/|月)\s*\d{1,2}|📍|⏰|🕐|🕑|🕒|🕓|🕔|🕕|地點|地址|時間|日期|今天|明天|後天|今日|明日|每天|每日|週[一二三四五六日]|周[一二三四五六日]|星期|[路街巷弄]|\d+號|站/;
/** 寫發什麼、怎麼領的行（時間地點不夠時補） */
const GIVE_LINE_RE = /發放|領取|索取|免費|限量|數量/;
/** 詳細資料引用原文的上限（字），最後一行可以超出一點，不從中間截斷 */
const EXCERPT_MAX = 90;
const EXCERPT_SLACK = 20;

/**
 * 詳細資料上引用的原文：只留寫時間、地點的幾行（不夠再補寫發什麼的），約 90 字，省略的地方寫「…」，
 * 完整內容請人看原文（著作權：只做必要的引用）。新聞只留標題。給 API 的就是摘錄，不回傳全文。
 */
export function postExcerpt(text: string, source: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (source === 'news') return [...(lines[0] ?? '')].slice(0, EXCERPT_MAX).join('');
  const len = (l: string): number => [...l].length;
  const strong = lines.filter((l) => TIME_PLACE_RE.test(l));
  const strongLen = strong.reduce((n, l) => n + len(l), 0);
  // 時間地點的行不多時，補上寫發什麼、怎麼領的行；照原文順序
  const keep = new Set(strongLen >= EXCERPT_MAX / 2 ? strong : lines.filter((l) => TIME_PLACE_RE.test(l) || GIVE_LINE_RE.test(l)));
  const pick = keep.size > 0 ? lines.filter((l) => keep.has(l)) : lines.slice(0, 1);
  const out: string[] = [];
  let used = 0;
  for (const l of pick) {
    if (used + len(l) <= EXCERPT_MAX + EXCERPT_SLACK) {
      out.push(l);
      used += len(l);
    } else if (out.length === 0) {
      out.push(`${[...l].slice(0, EXCERPT_MAX).join('')}…`);
      used = EXCERPT_MAX;
    }
    if (used >= EXCERPT_MAX) break;
  }
  const whole = out.join('\n');
  return out.length < lines.length || whole !== lines.join('\n') ? `${whole}\n…` : whole;
}

/**
 * 一次最多回傳幾筆：固定據點每天一筆，20 個據點排 21 天就 400 多筆，200 筆時比較晚開始的活動會被擠掉。
 * 回應有壓縮，1000 筆大約 50 KB
 */
const LIST_LIMIT = 1000;

/**
 * 經度範圍的條件：超過 ±180 要繞回去（「全球」時從台北往東 199 度就是加州的 −122 度）；
 * 寬到繞一圈以上就不限經度（回傳 null）
 */
export function lngRange(lng: number, dLng: number): { sql: string; binds: number[] } | null {
  const lo = lng - dLng;
  const hi = lng + dLng;
  if (hi - lo >= 360) return null;
  if (lo < -180) return { sql: '(e.lng >= ? OR e.lng <= ?)', binds: [lo + 360, hi] };
  if (hi > 180) return { sql: '(e.lng >= ? OR e.lng <= ?)', binds: [lo, hi - 360] };
  return { sql: 'e.lng BETWEEN ? AND ?', binds: [lo, hi] };
}

/** 經度在不在範圍內（跨過 ±180 度的也算），跟 lngRange 一樣 */
export function inLngRange(x: number, lng: number, dLng: number): boolean {
  const lo = lng - dLng;
  const hi = lng + dLng;
  if (hi - lo >= 360) return true;
  if (lo < -180) return x >= lo + 360 || x <= hi;
  if (hi > 180) return x >= lo || x <= hi - 360;
  return x >= lo && x <= hi;
}

/**
 * 一個模組還沒結束的事件（不分位置、關鍵字），連同固定據點的第一天、相關貼文，暫存在這個 isolate：
 * 每個開著的網頁每分鐘重抓一次，每次都查 D1 要讀上千列（免費方案每天 500 萬列）。
 * 事件有新增或更新（最大的 id、updated_at 變了）、或超過 SNAPSHOT_TTL_MS 才重讀，平常每次只讀幾列
 */
interface ModuleSnapshot {
  version: string;
  at: number;
  /** 讀的時候的 now；之後的請求照自己的 now 再篩 */
  now: number;
  rows: JoinedRow[];
  first: Map<string, number>;
  related: Map<string, RelatedPost[]>;
  linked: Map<string, RelatedPost[]>;
}
const SNAPSHOT_TTL_MS = 5 * 60_000;
const snapshots = new Map<string, ModuleSnapshot>();

/** 有寫入（回報、確認、管理者修改）的請求之後清掉，下一次重讀 */
export function clearEventSnapshots(): void {
  snapshots.clear();
}

async function eventsVersion(env: Env): Promise<string> {
  const v = await env.DB.prepare('SELECT (SELECT MAX(id) FROM events) AS id, (SELECT MAX(updated_at) FROM events) AS u').first<{ id: number | null; u: number | null }>();
  return `${v?.id ?? 0}|${v?.u ?? 0}`;
}

async function moduleSnapshot(env: Env, module: ModuleId, now: number): Promise<ModuleSnapshot> {
  const version = await eventsVersion(env);
  const cached = snapshots.get(module);
  if (cached && cached.version === version && Date.now() - cached.at < SNAPSHOT_TTL_MS) return cached;
  // 併進官方車掃的不單獨列，改放在官方那一場的相關報導
  const r = await env.DB.prepare(
    `${JOINED_SELECT}
    WHERE e.status IN ('upcoming', 'active') AND e.end_at > ? AND e.start_at <= ? AND e.lat IS NOT NULL AND e.lng IS NOT NULL AND e.merged_into IS NULL AND p.module = ?
    ORDER BY e.start_at ASC LIMIT ${SNAPSHOT_LIMIT}`,
  )
    .bind(now, now + MAX_FUTURE_SEC, module)
    .all<JoinedRow>();
  const rows = r.results;
  const spotPairs = [...new Map(rows.filter((x) => x.spot).map((x) => [`${x.post_id}|${x.place_text}`, x])).values()];
  const official = [...new Set(rows.filter((x) => x.source === 'official').map((x) => x.post_id))];
  const spotPosts = [...new Set(spotPairs.map((x) => x.post_id))];
  const snap: ModuleSnapshot = {
    version,
    at: Date.now(),
    now,
    rows,
    first: await firstStarts(env, spotPairs),
    related: official.length > 0 ? await relatedPosts(env, official) : new Map(),
    linked: spotPosts.length > 0 ? await linkedPosts(env, spotPosts) : new Map(),
  };
  snapshots.set(module, snap);
  return snap;
}

/** 前端用：附近、還沒結束、horizon 內會開始的事件 */
export async function listEvents(env: Env, q: ListQuery): Promise<EventOut[]> {
  const module = q.module ?? DEFAULT_MODULE;
  const snap = await moduleSnapshot(env, module, q.now);
  const box =
    q.lat !== undefined && q.lng !== undefined
      ? { lat: q.lat, lng: q.lng, dLat: q.radiusKm / 111, dLng: q.radiusKm / (111 * Math.max(0.2, Math.cos((q.lat * Math.PI) / 180))) }
      : null;
  // 關鍵字是洋流的（Threads 搜尋用），其他模組不篩；使用者主動回報的貼文、審核通過的固定據點不一定有寫關鍵字，一律顯示
  const kws = q.keywords && q.keywords.length > 0 && module === DEFAULT_MODULE ? q.keywords.map((k) => k.toLowerCase()) : null;
  const rows = snap.rows
    .filter((r) => r.end_at > q.now && r.start_at <= q.now + q.horizonSec)
    .filter((r) => !box || (Math.abs((r.lat ?? 0) - box.lat) <= box.dLat && inLngRange(r.lng ?? 0, box.lng, box.dLng)))
    .filter((r) => !kws || r.source === 'link' || r.source === 'spot' || kws.some((k) => r.keyword?.toLowerCase() === k || r.text.toLowerCase().includes(k)))
    .slice(0, LIST_LIMIT);
  const out = rows.map((row) => toEventOut(row, q.now));
  for (const e of out) {
    if (e.spot) e.firstStartAt = snap.first.get(`${e.post.id}|${e.placeText}`) ?? e.startAt;
    if (e.post.source === 'official' && snap.related.has(e.post.id)) e.related = snap.related.get(e.post.id);
    if (e.spot && snap.linked.has(e.post.id)) e.related = snap.linked.get(e.post.id);
  }
  return out;
}

/** 暫存的時候多抓一些（不分位置），每個人再照自己的範圍篩到 LIST_LIMIT */
const SNAPSHOT_LIMIT = 3000;

/**
 * 固定據點第一個時段的開始時間：已經過去的時段不在清單裡，要另外查（同一則貼文、同一地點）。
 * 每個地點各查一次 MIN（用 post_id、place_text、start_at 的索引，只讀一列），不用把每個據點所有時段都讀過
 */
async function firstStarts(env: Env, pairs: Array<{ post_id: string; place_text: string }>): Promise<Map<string, number>> {
  const first = new Map<string, number>();
  for (let i = 0; i < pairs.length; i += 50) {
    const chunk = pairs.slice(i, i + 50);
    const rs = await env.DB.batch(
      chunk.map((x) => env.DB.prepare('SELECT MIN(start_at) AS first FROM events WHERE post_id = ? AND place_text = ? AND spot = 1').bind(x.post_id, x.place_text)),
    );
    chunk.forEach((x, j) => {
      const v = (rs[j].results[0] as { first: number | null } | undefined)?.first;
      if (v) first.set(`${x.post_id}|${x.place_text}`, v);
    });
  }
  return first;
}

/** 固定據點的其他貼文：同一個帳號之前的（已被取代）、別人提到這個據點的，新的在前 */
async function linkedPosts(env: Env, spotPostIds: string[]): Promise<Map<string, RelatedPost[]>> {
  const r = await env.DB.prepare(
    `SELECT id, source, username, permalink, text, posted_at, linked_to, link_role FROM posts
      WHERE linked_to IN (${spotPostIds.map(() => '?').join(',')}) ORDER BY posted_at DESC`,
  )
    .bind(...spotPostIds)
    .all<{ id: string; source: string; username: string | null; permalink: string | null; text: string; posted_at: number; linked_to: string; link_role: string | null }>();
  const map = new Map<string, RelatedPost[]>();
  for (const row of r.results) {
    const first = row.text.split('\n')[0].trim();
    const role = row.link_role === 'previous' ? 'previous' : 'related';
    map.set(row.linked_to, [...(map.get(row.linked_to) ?? []), { id: row.id, source: row.source, title: `@${row.username ?? ''}：${first.slice(0, 40)}`, url: row.permalink, postedAt: row.posted_at, role }]);
  }
  return map;
}

/** 併進各官方貼文的新聞、Threads 貼文，同一則貼文只列一次 */
async function relatedPosts(env: Env, officialIds: string[]): Promise<Map<string, RelatedPost[]>> {
  const r = await env.DB.prepare(
    `SELECT DISTINCT e.merged_into, p.id, p.source, p.username, p.permalink, p.text, p.posted_at
       FROM events e JOIN posts p ON p.id = e.post_id
      WHERE e.merged_into IN (${officialIds.map(() => '?').join(',')})
      ORDER BY p.posted_at DESC`,
  )
    .bind(...officialIds)
    .all<{ merged_into: string; id: string; source: string; username: string | null; permalink: string | null; text: string; posted_at: number }>();
  const map = new Map<string, RelatedPost[]>();
  for (const row of r.results) {
    const list = map.get(row.merged_into) ?? [];
    if (list.some((x) => x.id === row.id)) continue;
    // 新聞用標題（第一行），貼文用作者加開頭幾個字
    const first = row.text.split('\n')[0].trim();
    const title = row.source === 'news' ? first : `@${row.username ?? ''}：${first.slice(0, 40)}`;
    list.push({ id: row.id, source: row.source, title, url: row.permalink, postedAt: row.posted_at });
    map.set(row.merged_into, list);
  }
  return map;
}

export async function getEvent(env: Env, id: number, now: number): Promise<EventOut | null> {
  const row = await env.DB.prepare(`${JOINED_SELECT} WHERE e.id = ? AND e.lat IS NOT NULL`)
    .bind(id)
    .first<JoinedRow>();
  return row ? toEventOut(row, now) : null;
}
