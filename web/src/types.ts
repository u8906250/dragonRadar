export interface EventOut {
  id: number;
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
  post: {
    id: string;
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

/** active 進行中；soon 即將開始，顯示淡光點；later 不顯示 */
export type Phase = 'active' | 'soon' | 'later';

export interface Item {
  ev: EventOut;
  distanceKm: number;
  bearing: number;
  phase: Phase;
}

export type { BlipStyle, SweepStyle } from './themes';

export interface KeywordRules {
  intervalMin: number;
  defaultDurationMin: number;
  maxFutureDays: number;
  minConfidence: number;
  endedWords: string[];
  region: string;
  timezone: string;
}

export interface KeywordInfo {
  term: string;
  pinned: boolean;
}
