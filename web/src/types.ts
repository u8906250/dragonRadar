/** giveaway 發放、activity 活動（洋流）；job 職缺（狗狗陪伴） */
export type EventKind = 'giveaway' | 'activity' | 'job';

export interface RelatedPost {
  id: string;
  /** news、threads、link */
  source: string;
  title: string;
  url: string | null;
  postedAt: number;
  /** 固定據點才有：previous 同一個帳號之前的貼文（已被取代），related 別人提到這個據點的貼文 */
  role?: 'previous' | 'related';
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
  allDay?: boolean;
  /** 貼文沒寫結束時間：畫面寫「發完為止」，endAt 只是系統自動下架的時間 */
  endOpen?: boolean;
  /** 固定據點沒寫最後一天：畫面寫「發完為止」 */
  untilOpen?: boolean;
  /** 有幾個人回報已發完／已結束 */
  endedReports?: number;
  /** 固定據點的其中一天 */
  spot?: boolean;
  /** 只定位到鄉鎮區中心時的區域名稱，例如「雲林縣虎尾鎮」 */
  approxArea?: string | null;
  /** 固定據點每週幾開（1 = 週一 … 7 = 週日），每天則 null */
  weekdays?: number[] | null;
  /** 國外活動的當地時區（IANA），時間用當地時間顯示；台灣是 null */
  tz?: string | null;
  /** 管理者直接改過標題：顯示就用 title */
  manualTitle?: boolean;
  /** 模組自己的欄位，例如職缺的工作期間、薪資、防詐提醒 */
  extra?: Record<string, unknown> | null;
  /** 固定據點第一個時段開始的時間，還沒到就是「還沒開始」 */
  firstStartAt?: number;
  /** 官方行程才有：講同一場活動、已併進來的新聞與貼文 */
  related?: RelatedPost[];
  post: {
    id: string;
    /** threads、news、official、manual、link（使用者貼的連結） */
    source?: string;
    username: string | null;
    permalink: string | null;
    postedAt: number;
    text: string;
    /** 回報的人補充的地點或時間（不是原貼文寫的） */
    supplement?: string | null;
  };
}

/** 車掃路線上的一站；title 跟對應事件的標題一樣 */
export interface RouteStop {
  kind: 'start' | 'cheer' | 'end';
  title: string;
  name: string;
  lat: number | null;
  lng: number | null;
  /** 出發／預計經過／抵達時間 */
  at: number | null;
}

export interface RouteSegment {
  seq: number;
  from: string;
  to: string;
  path: Array<[number, number]>;
  lengthM: number;
  people: number;
  target: number;
}

/** 車掃路線（來自大洋流車掃地圖） */
export interface RouteOut {
  id: string;
  /** 事件掛在哪則官方貼文下，用來找出屬於這條路線的事件 */
  postId: string;
  title: string;
  departAt: number | null;
  arriveAt: number | null;
  showUntil: number;
  claimUrl: string | null;
  stops: RouteStop[];
  segments: RouteSegment[];
  updatedAt: number;
}

/** 漂流瓶：撿起來之前看不到內容 */
export interface BottleOut {
  id: number;
  lat: number;
  lng: number;
  createdAt: number;
  expiresAt: number;
  /** 自己丟的 */
  mine: boolean;
  /** 自己撿過了 */
  picked: boolean;
  /** 被撿起來的次數 */
  picks: number;
}

export interface PickedBottle {
  bottle: BottleOut;
  text: string;
}

export interface MyBottles {
  /** 今天的額度：基本幾個、撿到幾個多幾個 */
  quota: { used: number; bonus: number; limit: number; left: number };
  /** driftM：從丟下的地方漂了幾公尺 */
  dropped: Array<{ id: number; text: string; createdAt: number; expiresAt: number; picks: number; pickedAt: number | null; status: 'active' | 'picked' | 'hidden' | 'deleted' | 'removed'; driftM: number }>;
  /** 撿到、還沒回收的瓶子 */
  picked: Array<{ id: number; text: string; createdAt: number; pickedAt: number; driftM: number; collected: boolean }>;
  /** 收藏的信（瓶子回收了也還在） */
  letters: Array<{ id: number; text: string; createdAt: number; pickedAt: number; collectedAt: number; driftM: number }>;
}

export interface Origin {
  lat: number;
  lng: number;
  source: 'gps' | 'manual' | 'default';
}

/** active 進行中；soon 即將開始，顯示淡光點；later 不顯示；closed 固定據點休息中，顯示淡光點 */
export type Phase = 'active' | 'soon' | 'later' | 'closed';

/** 固定據點：同一則貼文、同一地點的每天時段合成一筆 */
export interface SpotInfo {
  key: string;
  /** 還沒結束的時段，依時間排序 */
  sessions: EventOut[];
}

export interface Item {
  /** 固定據點時是目前或下一個時段 */
  ev: EventOut;
  distanceKm: number;
  bearing: number;
  phase: Phase;
  spot?: SpotInfo;
}

export type { BlipStyle, SweepStyle } from './themes';

export interface KeywordRules {
  kinds?: Record<EventKind, string>;
  sources?: {
    threads: 'review' | 'approved';
    official: { name: string; url: string; mapName?: string; mapUrl?: string; intervalMin: number };
    news: { names: string[]; intervalMin: number };
    link?: { maxAgeDays: number; recheckMin: number; endedReportsNeeded: number };
    spot?: { maxAgeDays: number; autoReview?: boolean };
    bottles?: { enabled: boolean; maxWeight?: number; maxChars: number; pickRadiusM: number; ttlDays: number; perDay?: number; driftHours?: number };
  };
  intervalMin: number;
  defaultDurationMin: number;
  maxFutureDays: number;
  /** 沒寫最後一天的固定據點最多排到發文後幾天（隱私權政策：貼文最多留 30 天） */
  spotMaxDays?: number;
  minConfidence: number;
  endedWords: string[];
  region: string;
  timezone: string;
}

export interface KeywordInfo {
  term: string;
  pinned: boolean;
}

export type LinkOutcome = 'preview' | 'added' | 'duplicate' | 'attached' | 'no_place' | 'not_listed' | 'not_event' | 'failed';

/** 判讀結果的預覽：一個地點或時段（固定據點的好幾天合成一筆） */
export interface PreviewItem {
  kind: EventKind;
  /** 模組自己的欄位，例如職缺的工作期間、薪資、防詐提醒 */
  extra?: Record<string, unknown> | null;
  title: string;
  item: string | null;
  placeText: string;
  /** null：找不到地點 */
  lat: number | null;
  lng: number | null;
  /** 只定位到鄉鎮區 */
  approxArea: string | null;
  /** 固定據點每週幾開（1 = 週一 … 7 = 週日），每天則 null */
  weekdays?: number[] | null;
  /** 國外活動的當地時區（IANA）；台灣是 null */
  tz?: string | null;
  spot: boolean;
  startAt: number;
  endAt: number;
  allDay: boolean;
  endOpen: boolean;
  untilOpen: boolean;
  days: number;
  lastStartAt: number;
  /** 雷達上已經有這個據點：replace 同一個帳號，確認後以這則為準；attach 別人發的，確認後只附上去 */
  update?: { mode: 'replace' | 'attach'; title: string };
  /** 同一個地點一天有好幾個時段：每個時段的開始、結束時間 */
  slots?: Array<{ startAt: number; endAt: number; endOpen?: boolean }>;
}

/** 我的回報（用同一個瀏覽器回報、確認放上雷達、30 天內的）：on_radar 在雷達上、attached 附在別的據點、not_listed 已結束或沒放上 */
export interface MyReport {
  postId: string;
  permalink: string;
  username: string | null;
  title: string;
  state: 'on_radar' | 'attached' | 'not_listed';
  events: number;
  eventId: number | null;
  reportedAt: number;
  /** 回報在哪個模組 */
  module?: string;
}

export interface SubmitResult {
  existed: boolean;
  outcome: LinkOutcome;
  reasons: string[];
  events: EventOut[];
  permalink: string;
  /** outcome = 'preview'：判讀結果，確認了才放上雷達 */
  preview?: PreviewItem[];
  /** 還沒放上雷達的回報：確認、說判讀錯了、補充資料都用這組代碼 */
  confirm?: { postId: string; token: string };
  /** 回報的人補充過的資料 */
  supplement?: string | null;
  /** outcome = 'not_listed' 而且原因確定時：直接講是哪個原因 */
  why?: {
    reason: 'already_over' | 'too_far_in_future' | 'no_start_time';
    startAt?: number;
    endAt?: number;
    /** 國外活動的當地時區 */
    tz?: string | null;
    /** 太久以後才開始的：這天之後再貼就收得到 */
    reportFrom?: number;
  };
}

export interface EndedReportResult {
  count: number;
  needed: number;
  ended: boolean;
}
