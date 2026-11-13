/**
 * 統計頁（stats.html，管理者）和雷達統計（numbers.html，大家都看得到）共用的圖：
 * 每張圖都只有一組數字、同一個顏色（styles 在 public/stats.css）；橫的長條數字寫在尾端，直的長條滑過去（或鍵盤選到）看數字，下面也有表格。
 * 名稱是大家回報來的文字（帳號、主題、關鍵字）：一律用 textContent 放進去，不當 HTML
 */
import { TOPIC_TYPES, topicChipSvg, topicGlyph } from './topic-icons';

export interface Count {
  name: string;
  count: number;
}

export const nf = new Intl.NumberFormat('zh-TW');
export const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
const $ = <T extends HTMLElement = HTMLElement>(s: string): T => document.querySelector(s) as T;

/** 建一個元素：text 用 textContent（大家回報來的字不當 HTML） */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---- 圖 ----

export function card(title: string, note?: string): HTMLElement {
  const c = h('section', 'card');
  c.append(h('h2', undefined, title));
  if (note) c.append(h('p', 'meta', note));
  return c;
}

export function tile(label: string, value: number, sub?: string): HTMLElement {
  const t = h('div', 'tile');
  t.append(h('div', 'label', label), h('div', 'value', nf.format(value)));
  if (sub) t.append(h('div', 'sub', sub));
  return t;
}

/**
 * 橫的長條：最長的那條佔滿，數字寫在尾端；name 可以加一個小圖示（icon 是程式自己的 SVG）、下面一行小字（note）。
 * stack：手機上名稱一行、長條一行（帳號名稱很長）
 */
export function hbars(rows: Array<{ name: string; count: number; note?: string; icon?: string; href?: string }>, empty = '沒有資料', stack = false): HTMLElement {
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
export const hideTip = (): void => {
  tipEl().hidden = true;
};

/**
 * 直的長條：每一根滑過去、用鍵盤選到都顯示數字（數字在前、名稱在後），左上角寫最多的是多少；
 * x 軸只寫幾個（every），下面的表格列全部
 */
export function columns(values: number[], names: string[], tipOf: (i: number) => [string, string], every: number, xName: (i: number) => string, tableHead: [string, string]): HTMLElement {
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

/** 主題照地圖小圖示的類型加總（分不出來的算「其他」），多的在前 */
export function topicTypeRows(topics: Count[]): Array<{ name: string; count: number; icon: string }> {
  const byType = new Map<string, number>();
  for (const x of topics) {
    const k = topicGlyph(x.name) ?? 'other';
    byType.set(k, (byType.get(k) ?? 0) + x.count);
  }
  return [...TOPIC_TYPES.map((ty) => ({ name: ty.label, count: byType.get(ty.key) ?? 0, icon: topicChipSvg(ty.key) })), { name: '其他', count: byType.get('other') ?? 0, icon: '' }]
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** 台灣時間的「11/13」 */
export const monthDay = (d: string): string => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
