export type SweepStyle = 'wedge' | 'ripple' | 'needle';
export type BlipStyle = 'dot' | 'buoy' | 'x' | 'neon';
export type SoundStyle = 'beep' | 'sonar' | 'wood' | 'synth';

/** 雷達範圍內的單次發放與活動（不含固定據點） */
export interface SummaryCounts {
  /** 已經開始、還沒結束 */
  active: number;
  /** 30 分鐘內開始 */
  soon: number;
  /** 今天，但沒公布幾點（例如官方加油點） */
  today: number;
  /** 更晚才開始 */
  later: number;
}

export interface Theme {
  id: string;
  /** 顯示名稱，也會當作頁面標題 */
  name: string;
  tagline: string;
  sweep: SweepStyle;
  blip: BlipStyle;
  /** 是否顯示 N/E/S/W 羅盤字 */
  rose: boolean;
  sound: SoundStyle;
  /** 瀏覽器狀態列顏色 */
  themeColor: string;
  swatch: [string, string, string];
  emptyText: string;
  summary(c: SummaryCounts): string;
}

/** 進行中一定列出（0 也列），其他有才列 */
function parts(c: SummaryCounts, unit: string): string {
  const seg = [`${c.active} ${unit}進行中`];
  if (c.soon > 0) seg.push(`${c.soon} ${unit}即將開始`);
  if (c.today > 0) seg.push(`${c.today} ${unit}今天（時間未公布）`);
  if (c.later > 0) seg.push(`${c.later} ${unit}稍後開始`);
  return seg.join('、');
}

export const THEMES: Theme[] = [
  {
    id: 'current',
    name: '洋流雷達',
    tagline: '台北大洋流船艙裡的羅盤',
    sweep: 'ripple',
    blip: 'buoy',
    rose: true,
    sound: 'sonar',
    themeColor: '#ea611d',
    swatch: ['#ea611d', '#f4efe6', '#15171c'],
    emptyText: '附近還沒漂來發放或活動',
    summary: (c) => `漂來 ${parts(c, '個')}`,
  },
  {
    id: 'dragon',
    name: '龍珠雷達',
    tagline: '綠色螢幕、黃色光點',
    sweep: 'wedge',
    blip: 'dot',
    rose: false,
    sound: 'beep',
    themeColor: '#06281a',
    swatch: ['#052016', '#3cff8a', '#ffd43b'],
    emptyText: '附近沒有發放或活動',
    summary: (c) => parts(c, '個'),
  },
  {
    id: 'treasure',
    name: '尋寶地圖',
    tagline: '羊皮紙與墨水羅盤，太陽下好讀',
    sweep: 'needle',
    blip: 'x',
    rose: true,
    sound: 'wood',
    themeColor: '#efe3c6',
    swatch: ['#e9dcc0', '#5b3a1e', '#b8322a'],
    emptyText: '附近沒有寶藏',
    summary: (c) => parts(c, '處'),
  },
  {
    id: 'neon',
    name: '夜市霓虹',
    tagline: '黑夜裡的霓虹招牌',
    sweep: 'wedge',
    blip: 'neon',
    rose: false,
    sound: 'synth',
    themeColor: '#140b1f',
    swatch: ['#0b0612', '#ff3fa4', '#2ef2ff'],
    emptyText: '附近沒有攤位',
    summary: (c) => parts(c, '攤'),
  },
];

export const DEFAULT_THEME_ID = 'current';

export function getTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? (THEMES.find((t) => t.id === DEFAULT_THEME_ID) as Theme);
}
