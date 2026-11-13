/**
 * 雷達統計（numbers.html，大家都看得到；v1.694 使用者問有沒有可以公開的統計）：跟 /api/stats 拿最近 30 天加總的數字畫成長條。
 * 只有每天幾場、主題類型、縣市和鄉鎮市區、星期幾、幾點、各雷達、漂流瓶；帳號、關鍵字、是誰回報的不放（那些在管理者的統計頁）
 */
import { card, columns, h, hbars, hideTip, monthDay, nf, tile, topicTypeRows, WEEKDAYS, type Count } from './stats-ui';

interface PublicStats {
  days: number;
  updatedAt: number;
  totals: { events: number; posts: number; reporters: number };
  daily: Array<{ day: string; events: number }>;
  topics: Count[];
  counties: Count[];
  towns: Count[];
  abroad: number;
  weekdays: number[];
  hours: number[];
  modules: Count[];
  bottles: { thrown: number; picks: number };
}

const PROD_API = 'https://dragon-radar.happybadminton.workers.dev';
const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const API = local ? 'http://localhost:8787' : PROD_API;
const $ = (s: string): HTMLElement => document.querySelector(s) as HTMLElement;
const timeFmt = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function render(s: PublicStats): void {
  const root = $('#stats');
  root.replaceChildren();
  $('#intro').textContent = `最近 ${s.days} 天大家回報、放上雷達的活動。只算數字，不記是誰回報的；每小時更新一次（這次是 ${timeFmt.format(new Date(s.updatedAt * 1000))}）。`;

  const tiles = h('div', 'tiles');
  tiles.append(
    tile('放上雷達的活動', s.totals.events, '場（連續好幾天的每天一場）'),
    tile('放上雷達的回報', s.totals.posts, '則貼文、活動頁'),
    tile('參與回報的人', s.totals.reporters),
    tile('丟出的漂流瓶', s.bottles.thrown, `被收藏 ${nf.format(s.bottles.picks)} 次`),
  );
  root.append(tiles);

  const daily = card('每天有幾場活動', '照活動那天（台灣時間）算；滑過長條看當天幾場。');
  daily.append(
    columns(
      s.daily.map((d) => d.events),
      s.daily.map((d) => monthDay(d.day)),
      (i) => [`${nf.format(s.daily[i].events)} 場`, monthDay(s.daily[i].day)],
      5,
      (i) => monthDay(s.daily[i].day),
      ['日期', '場數'],
    ),
  );
  root.append(daily);

  const topic = card('什麼樣的活動', '照地圖上的小圖示分類；一則貼文同一類算一次，分不出來的算「其他」。');
  topic.append(hbars(topicTypeRows(s.topics)));
  root.append(topic);

  const where = card('在哪裡', '一則貼文同一個地點算一次；照最近的鄉鎮市區中心估算，邊界附近可能算到隔壁區。');
  const two = h('div', 'two');
  const l = h('div');
  l.append(h('h3', undefined, '縣市'), hbars([...s.counties, ...(s.abroad ? [{ name: '國外', count: s.abroad }] : [])]));
  const r = h('div');
  r.append(h('h3', undefined, '最多活動的鄉鎮市區'), hbars(s.towns));
  two.append(l, r);
  where.append(two);
  root.append(where);

  const when = card('什麼時候', '每一場活動開始的時間，照活動當地的時間。');
  when.append(
    h('h3', undefined, '星期幾'),
    columns(s.weekdays, WEEKDAYS, (i) => [`${nf.format(s.weekdays[i])} 場`, WEEKDAYS[i]], 1, (i) => WEEKDAYS[i].slice(1), ['星期', '場數']),
    h('h3', undefined, '幾點開始'),
    columns(s.hours, s.hours.map((_, i) => `${i} 點`), (i) => [`${nf.format(s.hours[i])} 場`, `${i}:00–${i}:59 開始`], 3, (i) => String(i), ['時段', '場數']),
  );
  root.append(when);

  const mods = card('各雷達', '放上雷達的回報（則）。');
  mods.append(hbars(s.modules));
  root.append(mods);
}

async function load(): Promise<void> {
  try {
    const r = await fetch(`${API}/api/stats`);
    if (!r.ok) throw new Error(`錯誤 ${r.status}`);
    render((await r.json()) as PublicStats);
    $('#msg').hidden = true;
  } catch (e) {
    $('#msg').textContent = `讀不到統計，請稍後再試（${(e as Error).message}）`;
    $('#msg').classList.add('err');
  }
}

window.addEventListener('scroll', hideTip, { passive: true });
void load();
