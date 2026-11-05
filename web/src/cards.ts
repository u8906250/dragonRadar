/**
 * 收集卡（尋找小法）：卡冊、拿到卡時翻開的畫面；道具欄（選單裡的「道具」，跟卡冊分開，之後會有更多道具）；
 * 選單的「說明」（使用說明、換裝置的引繼碼）。
 * 卡片的內容寫在這裡（照片在 public/cards/），拿到的卡、道具存在伺服器（裝置代碼，worker/src/cards.ts），
 * 這個瀏覽器另外記一份（dr.cards、dr.items）：點小法時拿過的就不再問伺服器
 */
import { claimCard, fetchMyCards, makeTransferCode, redeemTransferCode, type CardClaim, type ItemCount } from './api';

export interface CardDef {
  /** 跟伺服器的 CARDS 一樣 */
  id: string;
  no: number;
  name: string;
  img: string;
  /** 卡片上的介紹 */
  about: string;
  /** 還沒拿到時卡冊裡的提示（只給一點點）：一句一條，「提示 1」「提示 2」… */
  hints: string[];
  /** 卡片右上角（哪一系列） */
  series: string;
  /** 卡片下面：怎麼拿到的、第幾位 */
  found: (c: CardClaim) => string;
  serial: (c: CardClaim) => string;
  /** 拿到時翻開的標題 */
  got: string;
  /** 照片的出處、授權（寫在卡片介紹下面的小字） */
  credit?: string;
}

const BASE = import.meta.env.BASE_URL;
export const CARD_DEFS: CardDef[] = [
  {
    id: 'xiaofa',
    no: 1,
    name: '小法',
    img: `${BASE}cards/xiaofa.webp`,
    about: '白色馬爾濟斯。個性活潑，喜歡探險，常在碑林出現。',
    hints: ['國館的小法', '來汪星找我'],
    series: '汪星・中山公園',
    found: (c) => `在${c.place}找到`,
    serial: (c) => `第 ${c.serial} 位找到小法的人`,
    got: '找到小法了！',
  },
  {
    id: 'jerky',
    no: 2,
    name: '古錐媽的肉乾',
    img: `${BASE}cards/jerky.webp`,
    about: '挑食狗也無法抗拒的限量手工雞肉乾，狗友一致好評推薦，只送不賣。',
    hints: ['多貼一些活動'],
    series: '古錐媽',
    found: () => '貼了 5 個活動',
    serial: (c) => `第 ${c.serial} 位拿到的人`,
    got: '拿到古錐媽的肉乾了！',
  },
  {
    id: 'mayor',
    no: 3,
    name: '你的市長',
    img: `${BASE}cards/mayor.webp`,
    // 使用者給的個性特質整理的精華（熱血中二、反差學霸、同理與回饋、堅韌踏實）
    about: '你的市長沈伯洋。骨子裡帶點中二的熱血，最愛《新世紀福音戰士》；愛玩卻是跨領域學霸，以榜首考上台大法研所刑法組。輔導過中輟生（還學塔羅牌拉近距離），相信「最短的捷徑是繞遠路」。',
    hints: ['洋流總部看完政策'],
    series: '洋流總部',
    found: () => '看完洋流總部的政策',
    serial: (c) => `第 ${c.serial} 位看完的人`,
    got: '你的市長沈伯洋！',
    // 照片從官網政策專區（公務員政策的代表圖）裁出來，政策專區圖文採用 CC BY 4.0，要標出處、授權、有修改
    credit: '照片：沈伯洋台北市長競選官網政策專區（puma.taipei），CC BY 4.0，經裁切',
  },
];

/** 道具（用法之後再設計）：跟卡片分開，道具欄只寫名字、有幾個，不寫說明；圖在 public/items/ */
export interface ItemDef {
  id: string;
  name: string;
  img: string;
  unit: string;
}
/** 古錐媽的肉乾（No.002 卡）給的道具：袋子裝的五條雞肉乾 */
export const ITEM_DEFS: ItemDef[] = [{ id: 'jerky', name: '五條雞肉乾', img: `${BASE}items/jerky.webp`, unit: '包' }];

const LS_CARDS = 'dr.cards';
const LS_ITEMS = 'dr.items';
const isClaim = (v: unknown): v is CardClaim => {
  const c = v as CardClaim;
  return !!c && typeof c.card === 'string' && typeof c.place === 'string' && Number.isFinite(c.at) && Number.isFinite(c.serial);
};

/** 這個瀏覽器拿到的卡 */
export function myCards(): CardClaim[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LS_CARDS) ?? '[]');
    return Array.isArray(v) ? v.filter(isClaim) : [];
  } catch {
    return [];
  }
}

function saveCards(list: CardClaim[]): void {
  try {
    localStorage.setItem(LS_CARDS, JSON.stringify(list));
  } catch {
    // 不能存：這次開著的期間還是看得到（卡在伺服器）
  }
}

/** 這個瀏覽器的道具（伺服器的一份副本，打開卡冊、道具欄時再對一次） */
export function myItems(): ItemCount[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LS_ITEMS) ?? '[]');
    return Array.isArray(v) ? v.filter((x: ItemCount) => !!x && typeof x.item === 'string' && Number.isFinite(x.count) && x.count > 0) : [];
  } catch {
    return [];
  }
}

function saveItems(list: ItemCount[]): void {
  try {
    localStorage.setItem(LS_ITEMS, JSON.stringify(list));
  } catch {
    // 不能存：打開卡冊、道具欄時再跟伺服器拿
  }
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const noText = (d: CardDef): string => `No.${String(d.no).padStart(3, '0')}`;
const dateText = (t: number): string => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(t * 1000));
const PAW =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="43" rx="14" ry="12"/><ellipse cx="13" cy="27" rx="6" ry="8" transform="rotate(-20 13 27)"/><ellipse cx="25" cy="15" rx="6" ry="8.5" transform="rotate(-6 25 15)"/><ellipse cx="39" cy="15" rx="6" ry="8.5" transform="rotate(6 39 15)"/><ellipse cx="51" cy="27" rx="6" ry="8" transform="rotate(20 51 27)"/></svg>';

function frontHtml(d: CardDef, c: CardClaim): string {
  return `<div class="tc-face tc-front">
      <div class="tc-top"><span>${noText(d)}</span><span>${esc(d.series)}</span></div>
      <div class="tc-photo"><img src="${d.img}" alt="${esc(d.name)}的照片" draggable="false"></div>
      <div class="tc-name">${esc(d.name)}</div>
      <p class="tc-about">${esc(d.about)}</p>
      ${d.credit ? `<p class="tc-credit">${esc(d.credit)}</p>` : ''}
      <div class="tc-meta"><span>${esc(d.found(c))}</span><span>${dateText(c.at)}</span></div>
      <div class="tc-serial">${esc(d.serial(c))}</div>
    </div>`;
}

/** 卡片背面；還沒拿到的在卡冊裡畫背面加一個問號和提示 */
function backHtml(d: CardDef, missing = false): string {
  return `<div class="tc-face tc-back">
      <div class="tc-paw">${PAW}</div>
      <div class="tc-back-title">${missing ? '？？？' : '尋找小法'}</div>
      <div class="tc-back-no">${noText(d)}</div>
      ${missing ? `<div class="tc-back-hints">${d.hints.map((h, i) => `<div class="tc-back-hint">提示 ${i + 1}：${esc(h)}</div>`).join('')}</div>` : ''}
    </div>`;
}

/** 蓋在畫面上的一層（3D 國館上面也看得到）：點外面、按 Esc、按「關閉」收起來 */
function overlay(cls: string, html: string): HTMLElement {
  const back = document.activeElement as HTMLElement | null;
  const el = document.createElement('div');
  el.className = `tc-overlay ${cls}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = html;
  const close = (): void => {
    el.remove();
    document.removeEventListener('keydown', onKey);
    back?.focus?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === el || t.closest('[data-close]')) close();
  });
  document.body.append(el);
  el.querySelector<HTMLElement>('[data-close]')?.focus();
  return el;
}

/** 拿到卡：卡片背面朝上出現，翻過來；extra 是一起拿到的道具（寫在下面） */
function showReveal(d: CardDef, c: CardClaim, extra = ''): void {
  const el = overlay(
    'tc-reveal',
    `<div class="tc-box">
      <h2 class="tc-title">${esc(d.got)}</h2>
      <div class="tc-flip"><div class="tc-inner">${frontHtml(d, c)}${backHtml(d)}</div></div>
      <p class="tc-note">收進卡冊了，選單裡的「卡冊」隨時看得到。${extra ? `<br>${esc(extra)}` : ''}</p>
      <button type="button" class="chip primary" data-close>好</button>
    </div>`,
  );
  window.setTimeout(() => el.querySelector('.tc-flip')?.classList.add('open'), 450);
}

let claiming = false;
/** 在 3D 國館點到小法（雷達上點到不算）：還沒有這張卡就跟伺服器拿，翻開給你看；拿過的不做什麼 */
export async function findCard(id: string, place: string, onError: (msg: string) => void): Promise<void> {
  const d = CARD_DEFS.find((x) => x.id === id);
  if (!d || claiming || myCards().some((c) => c.card === id)) return;
  claiming = true;
  try {
    const r = await claimCard(id, place);
    if (!r.ok) {
      onError(`卡片暫時拿不到：${r.message}`);
      return;
    }
    saveCards([...myCards().filter((c) => c.card !== id), r.data.claim]);
    // 照片先載好，翻過來時才看得到
    const img = new Image();
    img.src = d.img;
    await Promise.race([img.decode().catch(() => undefined), new Promise((ok) => window.setTimeout(ok, 1500))]);
    showReveal(d, r.data.claim);
  } finally {
    claiming = false;
  }
}

/** 道具這次拿到幾個的說法：「一包古錐媽的肉乾」 */
const itemText = (it: ItemCount): string => {
  const d = ITEM_DEFS.find((x) => x.id === it.item);
  return d ? `${it.count === 1 ? '一' : it.count}${d.unit}${d.name}` : '';
};

/**
 * 回報確認、放上雷達後（main.ts）：伺服器說拿到肉乾卡就翻開給你看，拿到道具寫在下面（沒有卡時另外跳一則訊息）；
 * 今天算滿了也跳訊息。notify 是 main.ts 的橫幅
 */
export async function gotReward(r: { card?: CardClaim; items: ItemCount[]; capped?: boolean } | undefined, notify: (msg: string) => void): Promise<void> {
  if (!r) return;
  if (r.capped) {
    notify('今天的回報已經算滿 20 則，明天再貼的才會算進收集');
    return;
  }
  if (r.items.length > 0) {
    const have = myItems();
    for (const it of r.items) {
      const cur = have.find((x) => x.item === it.item);
      if (cur) cur.count += it.count;
      else have.push({ ...it });
    }
    saveItems(have);
  }
  const got = r.items.map(itemText).filter(Boolean).join('、');
  const d = r.card ? CARD_DEFS.find((x) => x.id === r.card!.card) : undefined;
  if (d && r.card) {
    saveCards([...myCards().filter((c) => c.card !== d.id), r.card]);
    const img = new Image();
    img.src = d.img;
    await Promise.race([img.decode().catch(() => undefined), new Promise((ok) => window.setTimeout(ok, 1500))]);
    showReveal(d, r.card, got ? `還拿到${got}，放在選單裡的「道具」。` : '');
  } else if (got) notify(`拿到${got}！放在選單裡的「道具」`);
}

/**
 * 卡冊：拿到的卡、還沒拿到的（背面加問號和一點點提示）。打開時再跟伺服器對一次（syncMine）；
 * 換裝置（引繼碼）在選單的「說明」裡（openHelp）
 */
export function openAlbum(): void {
  const list = (): string => {
    const mine = myCards();
    const got = CARD_DEFS.filter((d) => mine.some((c) => c.card === d.id)).length;
    const slots = CARD_DEFS.map((d) => {
      const c = mine.find((x) => x.card === d.id);
      return `<div class="tc-slot${c ? '' : ' missing'}"><div class="tc-card">${c ? frontHtml(d, c) : backHtml(d, true)}</div></div>`;
    });
    return `<div class="tc-head"><h2>卡冊</h2><span class="tc-count">已收集 ${got} / ${CARD_DEFS.length}</span><button type="button" class="chip" data-close>關閉</button></div>
      <div class="tc-list">${slots.join('')}</div>`;
  };
  const el = overlay('tc-album', `<div class="tc-box"><div class="tc-main">${list()}</div></div>`);
  syncMine(el, () => {
    const main = el.querySelector('.tc-main');
    if (main) main.innerHTML = list();
  });
}

/**
 * 選單的「說明」：使用說明（照目前的雷達，helpPage）和「換裝置」（引繼碼，卡冊和道具一起搬；v1.467 起從卡冊搬過來，原本叫「換手機」）
 */
export function openHelp(helpPage: string): void {
  const el = overlay(
    'tc-help',
    `<div class="tc-box">
      <div class="tc-head"><h2>說明</h2><button type="button" class="chip" data-close>關閉</button></div>
      <div class="tc-help-row"><a class="chip" href="${esc(helpPage)}">使用說明</a><span>怎麼回報活動、卡冊的小趣味</span></div>
      <div class="tc-help-row"><button type="button" class="chip" data-move aria-expanded="false" aria-controls="tc-move-box">換裝置</button><span>可轉移卡冊及道具</span></div>
      <div class="tc-move-box" id="tc-move-box" hidden>
        <p><b>舊裝置</b>：產生引繼碼，24 小時內在新裝置輸入，卡冊和道具會搬過去（這台就沒有了）。</p>
        <button type="button" class="chip" data-make>產生引繼碼</button>
        <div class="tc-code" hidden><span class="tc-code-text"></span><button type="button" class="chip" data-copy>複製</button><small class="tc-code-until"></small></div>
        <p><b>新裝置</b>：輸入舊裝置產生的引繼碼。</p>
        <form class="tc-redeem" novalidate><input name="code" maxlength="12" placeholder="例如 KX7P-4M2Q" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="引繼碼"><button type="submit" class="chip primary">搬過來</button></form>
        <p class="tc-move-msg" role="status"></p>
      </div>
    </div>`,
  );
  const msg = (text: string, bad = false): void => {
    const m = el.querySelector<HTMLElement>('.tc-move-msg');
    if (!m) return;
    m.textContent = text;
    m.classList.toggle('bad', bad);
  };
  const box = el.querySelector<HTMLElement>('.tc-move-box')!;
  el.querySelector<HTMLButtonElement>('[data-move]')?.addEventListener('click', (e) => {
    box.hidden = !box.hidden;
    (e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(!box.hidden));
  });
  // 舊裝置：產生引繼碼
  const make = el.querySelector<HTMLButtonElement>('[data-make]')!;
  make.addEventListener('click', async () => {
    make.disabled = true;
    msg('');
    const r = await makeTransferCode();
    make.disabled = false;
    if (!r.ok) return msg(r.message, true);
    const code = el.querySelector<HTMLElement>('.tc-code')!;
    code.hidden = false;
    code.querySelector('.tc-code-text')!.textContent = r.data.code;
    const until = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(r.data.expiresAt * 1000));
    code.querySelector('.tc-code-until')!.textContent = `${until} 前有效，用過一次就失效；再按一次產生新的，舊的就不能用了`;
    make.textContent = '重新產生';
  });
  el.querySelector('[data-copy]')?.addEventListener('click', () => {
    const t = el.querySelector('.tc-code-text')?.textContent ?? '';
    void navigator.clipboard?.writeText(t).then(
      () => msg('已複製引繼碼'),
      () => msg('複製不了，請自己記下來', true),
    );
  });
  // 新裝置：輸入引繼碼
  const form = el.querySelector<HTMLFormElement>('.tc-redeem')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector<HTMLInputElement>('input')!;
    const btn = form.querySelector<HTMLButtonElement>('button')!;
    if (!input.value.trim()) return msg('請輸入引繼碼', true);
    btn.disabled = true;
    msg('搬過來中…');
    const r = await redeemTransferCode(input.value);
    btn.disabled = false;
    if (!r.ok) return msg(r.message, true);
    const cards = r.data.cards.filter(isClaim);
    saveCards(cards);
    if (r.data.items) saveItems(r.data.items);
    input.value = '';
    const items = myItems().reduce((n, x) => n + x.count, 0);
    msg(`搬好了，這台現在有 ${cards.length} 張卡、${items} 個道具`);
  });
}

/**
 * 打開卡冊、道具欄時再跟伺服器對一次（這個瀏覽器的紀錄被清掉、伺服器還有的補回來；搬到別台的拿掉），不一樣就重畫
 */
function syncMine(el: HTMLElement, redraw: () => void): void {
  void fetchMyCards().then((r) => {
    if (!r.ok || !el.isConnected) return;
    const local = myCards();
    const localItems = myItems();
    const items = r.data.items ?? localItems;
    const sameCards = r.data.cards.length === local.length && r.data.cards.every((c) => local.some((x) => x.card === c.card && x.serial === c.serial));
    const sameItems = items.length === localItems.length && items.every((i) => localItems.some((x) => x.item === i.item && x.count === i.count));
    if (sameCards && sameItems) return;
    saveCards(r.data.cards.filter(isClaim));
    saveItems(items);
    redraw();
  });
}

/** 道具欄（選單裡的「道具」）：像遊戲的背包一格一格排（跟卡片長得不一樣），圖、右下角有幾個、下面名字（用法之後再設計）；沒有寫「還沒有道具」 */
export function openItems(): void {
  const list = (): string => {
    const have = myItems().filter((x) => ITEM_DEFS.some((d) => d.id === x.item));
    const cells = have.map((x) => {
      const d = ITEM_DEFS.find((y) => y.id === x.item)!;
      return `<li class="tc-item"><span class="tc-item-icon"><img src="${d.img}" alt="" draggable="false"><span class="tc-item-count" aria-label="${x.count} ${esc(d.unit)}">×${x.count}</span></span><span class="tc-item-name">${esc(d.name)}</span></li>`;
    });
    return `<div class="tc-head"><h2>道具</h2><button type="button" class="chip" data-close>關閉</button></div>
      ${cells.length ? `<ul class="tc-items">${cells.join('')}</ul>` : '<p class="tc-items-empty">還沒有道具</p>'}`;
  };
  const el = overlay('tc-bag', `<div class="tc-box"><div class="tc-main">${list()}</div></div>`);
  syncMine(el, () => {
    const main = el.querySelector('.tc-main');
    if (main) main.innerHTML = list();
  });
}
