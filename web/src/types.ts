export type EventKind = 'giveaway' | 'activity';

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
    official: { name: string; url: string; intervalMin: number };
    news: { names: string[]; intervalMin: number };
    link?: { maxAgeDays: number; recheckMin: number; endedReportsNeeded: number };
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

export interface EndedReportResult {
  count: number;
  needed: number;
  ended: boolean;
}
