export type EventKind = 'giveaway' | 'activity';

export interface RelatedPost {
  id: string;
  /** news、threads、link */
  source: string;
  title: string;
  url: string | null;
  postedAt: number;
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
  /** 有幾個人回報已發完／已結束 */
  endedReports?: number;
  /** 固定據點的其中一天 */
  spot?: boolean;
  /** 只定位到鄉鎮區中心時的區域名稱，例如「雲林縣虎尾鎮」 */
  approxArea?: string | null;
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
    spot?: { maxAgeDays: number };
  };
  intervalMin: number;
  defaultDurationMin: number;
  maxFutureDays: number;
  spotDefaultDays?: number;
  minConfidence: number;
  endedWords: string[];
  region: string;
  timezone: string;
}

export interface KeywordInfo {
  term: string;
  pinned: boolean;
}

export type LinkOutcome = 'added' | 'duplicate' | 'no_place' | 'not_listed' | 'not_event' | 'failed';

export interface SubmitResult {
  existed: boolean;
  outcome: LinkOutcome;
  reasons: string[];
  events: EventOut[];
  permalink: string;
}

/** 回報固定據點的審核進度 */
export interface SpotRequestStatus {
  key: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null;
  place: string;
  permalink: string | null;
  createdAt: number;
  reviewedAt: number | null;
  existed: boolean;
}

export interface EndedReportResult {
  count: number;
  needed: number;
  ended: boolean;
}
