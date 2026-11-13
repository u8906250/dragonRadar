/**
 * 統計頁（stats.html，v1.693 使用者說統計分享的 Threads 帳號、關鍵字、主題，其他我想）：
 * 跟 /api/admin/stats 拿最近幾天的數字畫成長條。只有拿管理 token 的人看得到（跟回報管理頁共用 token）。
 * 每張圖都只有一組數字，用同一個顏色；數字寫在長條尾端，直的長條滑過去（或用鍵盤選到）看數字，下面也有表格。
 * 帳號、主題、關鍵字是大家回報來的文字：一律用 textContent 放進去，不當 HTML
 */
import { card, columns, hbars, h, hideTip, monthDay, nf, tile, topicTypeRows, WEEKDAYS, type Count } from './stats-ui';
import { whereOf } from './where';

interface Stats {
  days: number;
  totals: { submits: number; supplements: number; posts: number; confirmed: number; events: number; reporters: number; accounts: number; feedback: number };
  daily: Array<{ day: string; submits: number; posts: number; confirmed: number }>;
  outcomes: { confirmed: number; rejected: number; withdrawn: number; open: number };
  accounts: Array<{ username: string; posts: number; confirmed: number; events: number }>;
  topics: Count[];
  tags: Count[];
  modules: Count[];
  sources: Count[];
  weekdays: number[];
  hours: number[];
  places: Array<[number, number]>;
  reporterBuckets: { one: number; few: number; some: number; many: number };
  feedbackKinds: Count[];
  bottles: { thrown: number; picks: number };
  pushSubscribers: number;
}

const PROD_API = 'https://dragon-radar.happybadminton.workers.dev';
const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
// 不接受網址參數指定 API：不然有人做一個連結就能把 token 送到別的網站（跟回報管理頁一樣）
const API = local ? 'http://localhost:8787' : PROD_API;
const LS_TOKEN = 'dr.adminToken';
const ls = {
  get: (k: string): string | null => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null): void => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* 無痕模式 */
    }
  },
};
const $ = <T extends HTMLElement = HTMLElement>(s: string): T => document.querySelector(s) as T;


async function api(path: string): Promise<Stats> {
  const r = await fetch(API + path, { headers: { authorization: `Bearer ${ls.get(LS_TOKEN) || ''}` } });
  const j = (await r.json().catch(() => ({}))) as Stats & { error?: string };
  if (r.status === 401) throw Object.assign(new Error('token 不對'), { auth: true });
  if (!r.ok) throw new Error(j.error || `錯誤 ${r.status}`);
  return j;
}

function render(s: Stats): void {
  const root = $('#stats');
  root.replaceChildren();
  const t = s.totals;

  // 總覽
  const tiles = h('div', 'tiles');
  tiles.append(
    tile('回報的貼文', t.posts, `送出 ${nf.format(t.submits)} 次（補充再判讀 ${nf.format(t.supplements)} 次）`),
    tile('放上雷達', t.confirmed, `${nf.format(t.events)} 場活動`),
    tile('回報的人', t.reporters, '照裝置算'),
    tile('Threads 帳號', t.accounts, '被回報的貼文來自幾個帳號'),
    tile('回報問題', t.feedback),
    tile('開了通知', s.pushSubscribers, '全部，不限天數'),
  );
  root.append(tiles);

  // 每天
  const daily = card('每天回報的貼文', '照回報那天（台灣時間）算；滑過長條看當天送出幾次、幾則放上雷達。');
  const md = monthDay;
  daily.append(
    columns(
      s.daily.map((d) => d.posts),
      s.daily.map((d) => md(d.day)),
      (i) => {
        const d = s.daily[i];
        return [`${nf.format(d.posts)} 則貼文`, `${md(d.day)}・放上雷達 ${nf.format(d.confirmed)} 則・送出 ${nf.format(d.submits)} 次`];
      },
      s.days > 14 ? 5 : s.days > 7 ? 2 : 1,
      (i) => md(s.daily[i].day),
      ['日期', '回報的貼文'],
    ),
  );
  root.append(daily);

  // 結果
  const out = card('回報的貼文後來怎麼了', '「還沒確認或沒放上」是判讀完沒按確認、缺時間地點、已經結束、不是活動等。');
  out.append(
    hbars([
      { name: '放上雷達', count: s.outcomes.confirmed },
      { name: '還沒確認或沒放上', count: s.outcomes.open },
      { name: '說判讀不對', count: s.outcomes.rejected },
      { name: '自己刪掉', count: s.outcomes.withdrawn },
    ]),
  );
  root.append(out);

  // 帳號
  const acc = card('Threads 帳號', '被回報最多的帳號（最多 30 個）：長條是回報幾則貼文，帳號下面寫放上雷達幾則、幾場活動。點帳號開 Threads。');
  acc.append(
    hbars(
      s.accounts.map((a) => ({
        name: `@${a.username}`,
        count: a.posts,
        note: `放上雷達 ${a.confirmed} 則・${a.events} 場活動`,
        href: `https://www.threads.com/@${encodeURIComponent(a.username)}`,
      })),
      '沒有資料',
      true,
    ),
  );
  root.append(acc);

  // 主題
  const topic = card('主題', '一則貼文同一個主題算一次。類型跟地圖上的小圖示一樣分；分不出來的算「其他」。');
  const typeRows = topicTypeRows(s.topics);
  const two = h('div', 'two');
  const left = h('div');
  left.append(h('h3', undefined, '類型'), hbars(typeRows));
  const right = h('div');
  right.append(h('h3', undefined, 'AI 判讀的主題'), hbars(s.topics));
  two.append(left, right);
  topic.append(two);
  root.append(topic);

  // 關鍵字
  const tags = card('關鍵字', '一則貼文同一個關鍵字算一次（最多 30 個）。');
  tags.append(hbars(s.tags));
  root.append(tags);

  // 在哪裡
  const where = card('活動在哪裡', '一則貼文同一個地點算一次；照最近的鄉鎮市區中心估算，邊界附近可能算到隔壁區。');
  const county = new Map<string, number>();
  const town = new Map<string, number>();
  let abroad = 0;
  for (const [lat, lng] of s.places) {
    const w = whereOf(lat, lng);
    if (!w) {
      abroad++;
      continue;
    }
    county.set(w.county, (county.get(w.county) ?? 0) + 1);
    const tk = `${w.county}${w.town}`;
    town.set(tk, (town.get(tk) ?? 0) + 1);
  }
  const sorted = (m: Map<string, number>, n: number): Count[] =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, count]) => ({ name, count }));
  const two2 = h('div', 'two');
  const l2 = h('div');
  l2.append(h('h3', undefined, '縣市'), hbars([...sorted(county, 22), ...(abroad ? [{ name: '國外', count: abroad }] : [])]));
  const r2 = h('div');
  r2.append(h('h3', undefined, '鄉鎮市區（最多 15 個）'), hbars(sorted(town, 15)));
  two2.append(l2, r2);
  where.append(two2);
  root.append(where);

  // 什麼時候
  const when = card('活動什麼時候開始', '放上雷達的每一場（連續好幾天的每天一場），照活動當地的時間。');
  when.append(
    h('h3', undefined, '星期幾'),
    columns(s.weekdays, WEEKDAYS, (i) => [`${nf.format(s.weekdays[i])} 場`, WEEKDAYS[i]], 1, (i) => WEEKDAYS[i].slice(1), ['星期', '場數']),
    h('h3', undefined, '幾點開始'),
    columns(s.hours, s.hours.map((_, i) => `${i} 點`), (i) => [`${nf.format(s.hours[i])} 場`, `${i}:00–${i}:59 開始`], 3, (i) => String(i), ['時段', '場數']),
  );
  root.append(when);

  // 雷達、來源
  const src = card('各雷達、來源', '回報的貼文數。');
  const two3 = h('div', 'two');
  const l3 = h('div');
  l3.append(h('h3', undefined, '雷達'), hbars(s.modules));
  const r3 = h('div');
  r3.append(h('h3', undefined, '來源'), hbars(s.sources));
  two3.append(l3, r3);
  src.append(two3);
  root.append(src);

  // 回報的人
  const people = card('回報的人放上雷達幾則', '只算人數，不記是誰。');
  const b = s.reporterBuckets;
  people.append(
    hbars([
      { name: '1 則', count: b.one },
      { name: '2–4 則', count: b.few },
      { name: '5–9 則', count: b.some },
      { name: '10 則以上', count: b.many },
    ]),
  );
  root.append(people);

  // 其他
  const other = card('其他');
  other.append(h('h3', undefined, '回報問題'), hbars(s.feedbackKinds, '沒有人回報問題'));
  const bt = h('div', 'tiles');
  bt.append(tile('丟出的漂流瓶', s.bottles.thrown), tile('瓶子被收藏', s.bottles.picks, '次'));
  other.append(h('h3', undefined, '漂流瓶'), bt);
  root.append(other);
}

// ---- 登入、範圍 ----

let days = 30;
async function load(): Promise<void> {
  const root = $('#stats');
  root.classList.add('loading');
  $('#msg').textContent = '';
  try {
    const s = await api(`/api/admin/stats?days=${days}`);
    $('#login').hidden = true;
    $('#panel').hidden = false;
    render(s);
  } catch (e) {
    if ((e as { auth?: boolean }).auth) {
      $('#panel').hidden = true;
      $('#login').hidden = false;
      $('#login-msg').textContent = ls.get(LS_TOKEN) ? 'token 不對，請重新輸入' : '';
    } else $('#msg').textContent = (e as Error).message;
  } finally {
    root.classList.remove('loading');
  }
}

$('#login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $<HTMLInputElement>('#token').value.trim();
  if (!v) return;
  ls.set(LS_TOKEN, v);
  $<HTMLInputElement>('#token').value = '';
  void load();
});
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-days]')) {
  btn.addEventListener('click', () => {
    days = Number(btn.dataset.days);
    for (const x of document.querySelectorAll<HTMLButtonElement>('[data-days]')) x.setAttribute('aria-pressed', String(x === btn));
    void load();
  });
}
$('#reload').addEventListener('click', () => void load());
window.addEventListener('scroll', hideTip, { passive: true });
if (ls.get(LS_TOKEN)) void load();
else $('#login').hidden = false;
