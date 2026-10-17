export type SweepStyle = 'wedge' | 'ripple' | 'needle';
export type BlipStyle = 'dot' | 'buoy' | 'x' | 'neon';
export type SoundStyle = 'beep' | 'sonar' | 'wood' | 'synth';

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
  summary(active: number, soon: number, total: number): string;
}

function parts(active: number, soon: number, total: number, unit: string): string {
  const seg: string[] = [];
  if (active > 0) seg.push(`${active} ${unit}進行中`);
  if (soon > 0) seg.push(`${soon} ${unit}即將開始`);
  if (seg.length === 0) seg.push(`${total} ${unit}稍後開始`);
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
    emptyText: '附近還沒漂來發放',
    summary: (a, s, t) => `漂來 ${parts(a, s, t, '個')}`,
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
    emptyText: '附近沒有發放',
    summary: (a, s, t) => parts(a, s, t, '個'),
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
    summary: (a, s, t) => parts(a, s, t, '處'),
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
    summary: (a, s, t) => parts(a, s, t, '攤'),
  },
];

export const DEFAULT_THEME_ID = 'current';

export function getTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? (THEMES.find((t) => t.id === DEFAULT_THEME_ID) as Theme);
}
