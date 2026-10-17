import type { KeywordSearchOptions, ThreadsClient, ThreadsPost } from './threads';
import { nowSec } from './util';

interface Sample {
  offsetMin: number;
  place: string;
  item: string;
  extra?: string;
}

const SAMPLES: Sample[] = [
  { offsetMin: 0, place: '捷運中山站 4號出口', item: '飲料', extra: '現在開始發，發完為止' },
  { offsetMin: 15, place: '台北車站東三門', item: '貼紙' },
  { offsetMin: 45, place: '捷運市政府站 2號出口', item: '洋流飄帶', extra: '限量 100 份' },
  { offsetMin: 75, place: '西門町 捷運西門站 6號出口', item: '周邊小物' },
  { offsetMin: 5, place: '捷運大安站 6號出口', item: '徽章' },
  { offsetMin: 30, place: '捷運南港展覽館站', item: '手搖飲' },
  { offsetMin: 50, place: '捷運公館站 1號出口', item: '明信片' },
  { offsetMin: 20, place: '松山文創園區', item: '帆布袋' },
];

function hashStr(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h;
}

function hhmm(unix: number): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(unix * 1000));
}

function iso(unix: number): string {
  return new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, '+0000');
}

/**
 * 示範用的 Threads client。每小時產生一組假貼文，時間落在該小時內，
 * 讓前端在沒有 Threads token 的情況下也看得到雷達光點。
 */
export class MockThreadsClient implements ThreadsClient {
  readonly mode = 'mock' as const;

  constructor(private readonly now: number = nowSec()) {}

  async keywordSearch(o: KeywordSearchOptions): Promise<ThreadsPost[]> {
    if (o.authorUsername) return [];
    const bucket = Math.floor(this.now / 3600);
    const hourStart = bucket * 3600;
    const h = hashStr(o.q);
    const picks = [0, 1, 2, 3].map((k) => SAMPLES[(h + k * 3) % SAMPLES.length]);
    return picks.map((s, i) => {
      const start = hourStart + s.offsetMin * 60;
      const text = `今天 ${hhmm(start)} 在${s.place}發放${s.item}${s.extra ? '，' + s.extra : ''}，來的朋友記得說暗號！#${o.q}`;
      return {
        id: `mock-${h.toString(36)}-${bucket}-${i}`,
        text,
        username: 'demo_giver',
        permalink: `https://www.threads.net/@demo_giver/post/mock-${h.toString(36)}-${bucket}-${i}`,
        timestamp: iso(Math.min(this.now, start) - 20 * 60),
        media_type: 'TEXT_POST',
      };
    });
  }

  async replies(): Promise<ThreadsPost[]> {
    return [];
  }

  async refreshToken(): Promise<null> {
    return null;
  }
}
