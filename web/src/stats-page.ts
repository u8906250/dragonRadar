/**
 * 統計頁（stats.html，v1.693 使用者說統計分享的 Threads 帳號、關鍵字、主題，其他我想）：
 * 跟 /api/admin/stats 拿最近幾天的數字畫成長條。只有拿管理 token 的人看得到（跟回報管理頁共用 token）。
 * 每張圖都只有一組數字，用同一個顏色；數字寫在長條尾端，直的長條滑過去（或用鍵盤選到）看數字，下面也有表格。
 * 帳號、主題、關鍵字是大家回報來的文字：一律用 textContent 放進去，不當 HTML
 */
import { TW_TOWNS } from './places-tw';
import { TOPIC_TYPES, topicChipSvg, topicGlyph } from './topic-icons';

interface Count {
  name: string;
  count: number;
}
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
const nf = new Intl.NumberFormat('zh-TW');

/** 建一個元素：text 用 textContent（大家回報來的字不當 HTML） */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

async function api(path: string): Promise<Stats> {
  const r = await fetch(API + path, { headers: { authorization: `Bearer ${ls.get(LS_TOKEN) || ''}` } });
  const j = (await r.json().catch(() => ({}))) as Stats & { error?: string };
  if (r.status === 401) throw Object.assign(new Error('token 不對'), { auth: true });
  if (!r.ok) throw new Error(j.error || `錯誤 ${r.status}`);
  return j;
}

// ---- 圖 ----

function card(title: string, note?: string): HTMLElement {
  const c = h('section', 'card');
  c.append(h('h2', undefined, title));
  if (note) c.append(h('p', 'meta', note));
  return c;
}

function tile(label: string, value: number, sub?: string): HTMLElement {
  const t = h('div', 'tile');
  t.append(h('div', 'label', label), h('div', 'value', nf.format(value)));
  if (sub) t.append(h('div', 'sub', sub));
  return t;
}

/**
 * 橫的長條：最長的那條佔滿，數字寫在尾端；name 可以加一個小圖示（icon 是程式自己的 SVG）、下面一行小字（note）。
 * stack：手機上名稱一行、長條一行（帳號名稱很長）
 */
function hbars(rows: Array<{ name: string; count: number; note?: string; icon?: string; href?: string }>, empty = '沒有資料', stack = false): HTMLElement {
  if (rows.length === 0 || rows.every((r) => r.count === 0)) return h('p', 'empty', empty);
  const max = Math.max(...rows.map((r) => r.count), 1);
  const ol = h('ol', stack ? 'hbars stack' : 'hbars');
  for (const r of rows) {
    const li = h('li');
    const name = h('span', 'name');
    if (r.icon) name.insertAdjacentHTML('afterbegin', r.icon);
    if (r.href) {
      const a = h('a', undefined, r.name);
      a.href = r.href;
      a.target = '_blank';
      a.rel = 'noopener';
      name.append(a);
    } else name.append(document.createTextNode(r.name));
    name.title = r.name;
    const cell = h('span', 'name-cell');
    cell.append(name);
    if (r.note) cell.append(h('small', 'note', r.note));
    const bar = h('span', 'bar');
    const fill = h('span', 'fill');
    fill.style.width = `${Math.max(0.5, (r.count / max) * 85)}%`;
    bar.append(fill, h('span', 'num', nf.format(r.count)));
    li.append(cell, bar);
    ol.append(li);
  }
  return ol;
}

const tipEl = (): HTMLElement => $('#tip');
function showTip(target: HTMLElement, lines: [string, string]): void {
  const tip = tipEl();
  tip.replaceChildren(h('b', undefined, lines[0]), h('br'), document.createTextNode(lines[1]));
  tip.hidden = false;
  const r = target.getBoundingClientRect();
  const w = tip.offsetWidth;
  tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2))}px`;
  tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`;
}
const hideTip = (): void => {
  tipEl().hidden = true;
};

/**
 * 直的長條：每一根滑過去、用鍵盤選到都顯示數字（數字在前、名稱在後），左上角寫最多的是多少；
 * x 軸只寫幾個（every），下面的表格列全部
 */
function columns(values: number[], names: string[], tipOf: (i: number) => [string, string], every: number, xName: (i: number) => string, tableHead: [string, string]): HTMLElement {
  const wrap = h('div');
  const max = Math.max(...values, 0);
  const cols = h('div', 'cols');
  cols.setAttribute('role', 'list');
  cols.append(h('span', 'max', max > 0 ? `最多 ${nf.format(max)}` : '沒有資料'));
  values.forEach((v, i) => {
    const col = h('div', 'col');
    col.tabIndex = 0;
    col.setAttribute('role', 'listitem');
    col.setAttribute('aria-label', `${names[i]}：${v}`);
    const bar = h('span');
    bar.style.height = max > 0 ? `${(v / max) * 100}%` : '0';
    col.append(bar);
    const show = (): void => showTip(col, tipOf(i));
    col.addEventListener('pointerenter', show);
    col.addEventListener('focus', show);
    col.addEventListener('pointerleave', hideTip);
    col.addEventListener('blur', hideTip);
    cols.append(col);
  });
  const xl = h('div', 'xlabels');
  values.forEach((_, i) => xl.append(h('span', undefined, i % every === 0 ? xName(i) : '')));
  const details = h('details', 'table');
  details.append(h('summary', undefined, '看數字'));
  const table = h('table');
  const head = h('tr');
  head.append(h('th', undefined, tableHead[0]), h('th', undefined, tableHead[1]));
  table.append(head);
  values.forEach((v, i) => {
    const tr = h('tr');
    tr.append(h('td', undefined, names[i]), h('td', undefined, nf.format(v)));
    table.append(tr);
  });
  details.append(table);
  wrap.append(cols, xl, details);
  return wrap;
}

// ---- 活動在哪裡：照最近的鄉鎮市區（places-tw.ts 的點）算在哪個縣市、區；離最近的點超過 40 公里當成國外 ----

function whereOf(lat: number, lng: number): { county: string; town: string } | null {
  const kx = Math.cos((lat * Math.PI) / 180);
  let best: (typeof TW_TOWNS)[number] | null = null;
  let bd = Infinity;
  for (const t of TW_TOWNS) {
    const d = (t[1] - lat) ** 2 + ((t[2] - lng) * kx) ** 2;
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  if (!best || Math.sqrt(bd) * 111 > 40) return null;
  return { county: best[3], town: best[0] };
}

const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

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
  const md = (d: string): string => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
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
  const byType = new Map<string, number>();
  for (const x of s.topics) {
    const k = topicGlyph(x.name) ?? 'other';
    byType.set(k, (byType.get(k) ?? 0) + x.count);
  }
  const typeRows = [...TOPIC_TYPES.map((ty) => ({ name: ty.label, count: byType.get(ty.key) ?? 0, icon: topicChipSvg(ty.key) })), { name: '其他', count: byType.get('other') ?? 0, icon: '' }]
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
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
    const tk = `${w.town}（${w.county}）`;
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
