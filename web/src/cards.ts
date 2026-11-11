/**
 * 收集卡（尋找小法）：卡冊、拿到卡時翻開的畫面；道具欄（選單裡的「道具」，跟卡冊分開，之後會有更多道具）；
 * 回報滿 5 則給一枚順幣（v1.579 起；以前是自己選一包肉乾或一枚順幣，openPick 留著給還沒選完的）；
 * 選單的「說明」（使用說明、換裝置的引繼碼）；
 * 許願（v1.569，順幣的用途）：投 5 枚順幣送一個想法，管理者審核，通過才做；「我的願望」看進度、調整（openWishForm、openMyWishes）。
 * 卡片的內容寫在這裡（照片在 public/cards/），拿到的卡、道具存在伺服器（裝置代碼，worker/src/cards.ts），
 * 這個瀏覽器另外記一份（dr.cards、dr.items、dr.picks）：點小法時拿過的就不再問伺服器
 */
import { claimCard, fetchMyCards, fetchMyWishes, makeTransferCode, markWishesSeen, pickReward, redeemTransferCode, sendTweak, sendWish, withdrawWish, type CardClaim, type ItemCount, type MyWishes, type Wish, type WishStatus, type WishTweak } from './api';

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
    // 使用者給的個性特質的精華；卡片固定大小，字多照片就被擠小（v1.508 使用者說照片被擠壓），所以只留兩行左右
    about: '你的市長沈伯洋。中二熱血的動漫迷、跨領域學霸，相信「最短的捷徑是繞遠路」。',
    hints: ['洋流總部看完政策'],
    series: '洋流總部',
    found: () => '看完洋流總部的政策',
    serial: (c) => `第 ${c.serial} 位看完的人`,
    got: '你的市長沈伯洋！',
    // 照片從官網政策專區（公務員政策的代表圖）裁出來，政策專區圖文採用 CC BY 4.0，要標出處、授權、有修改
    credit: '照片：沈伯洋競選官網政策專區・CC BY 4.0・經裁切',
  },
];

/** 道具（用法之後再設計）：跟卡片分開，道具欄只寫名字、有幾個，不寫說明；圖在 public/items/ */
export interface ItemDef {
  id: string;
  name: string;
  img: string;
  unit: string;
}
/**
 * 古錐媽的肉乾（No.002 卡）給的道具：袋子裝的五條雞肉乾；
 * 順幣：金幣中間一個「順」、下面一道橘色的小浪（順著洋流），圖是 SVG 畫好轉成 webp 的（v1.542）
 */
export const ITEM_DEFS: ItemDef[] = [
  { id: 'jerky', name: '五條雞肉乾', img: `${BASE}items/jerky.webp`, unit: '包' },
  { id: 'coin', name: '順幣', img: `${BASE}items/coin.webp`, unit: '枚' },
];
/** 回報滿 5 則的獎勵可以選哪些（跟伺服器的 PICKABLE 一樣）：選項上寫的名字、一句話 */
const PICK_OPTS: Array<{ id: string; label: string; sub: string }> = [
  { id: 'jerky', label: '一包古錐媽的肉乾', sub: '五條手工雞肉乾' },
  { id: 'coin', label: '一枚順幣', sub: '順著洋流的金幣' },
];

const LS_CARDS = 'dr.cards';
const LS_ITEMS = 'dr.items';
const LS_PICKS = 'dr.picks';
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

/** 還沒選的獎勵有幾份（伺服器的一份副本） */
export function myPicks(): number {
  try {
    const n = Number(localStorage.getItem(LS_PICKS) ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function savePicks(n: number): void {
  try {
    if (n > 0) localStorage.setItem(LS_PICKS, String(n));
    else localStorage.removeItem(LS_PICKS);
  } catch {
    // 不能存：打開道具欄時再跟伺服器拿
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

/** 蓋在畫面上的一層（3D 國館上面也看得到）：點外面、按 Esc、按「關閉」收起來；收起來後 onClose */
/**
 * sticky：只有按「關閉」才收起來，點旁邊、按 Esc 都不關（許願、調整要打字，v1.581 使用者說「點選旁邊不要關掉，避免不小心關掉」）
 */
export function overlay(cls: string, html: string, onClose?: () => void, sticky = false): HTMLElement {
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
    onClose?.();
  };
  // 疊了兩層（道具欄上面打開選獎勵）：Esc 只收最上面那層
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !sticky && el === [...document.querySelectorAll('.tc-overlay')].pop()) close();
  };
  document.addEventListener('keydown', onKey);
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if ((t === el && !sticky) || t.closest('[data-close]')) close();
  });
  document.body.append(el);
  el.querySelector<HTMLElement>('[data-close]')?.focus();
  return el;
}

/** 拿到卡：卡片背面朝上出現，翻過來；extra 是一起拿到的道具（寫在下面）；按「好」收起來後 onClose（接著選獎勵） */
function showReveal(d: CardDef, c: CardClaim, extra = '', onClose?: () => void, ok = '好'): void {
  const el = overlay(
    'tc-reveal',
    `<div class="tc-box">
      <h2 class="tc-title">${esc(d.got)}</h2>
      <div class="tc-flip"><div class="tc-inner">${frontHtml(d, c)}${backHtml(d)}</div></div>
      <p class="tc-note">收進卡冊了，選單裡的「卡冊」隨時看得到。${extra ? `<br>${esc(extra)}` : ''}</p>
      <button type="button" class="chip primary" data-close>${esc(ok)}</button>
    </div>`,
    onClose,
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
 * 滿 5 則的順幣寫在卡片下面（沒有卡時跳訊息）；舊的「選獎勵」（picks）伺服器已經不給了。今天算滿了也跳訊息。notify 是 main.ts 的橫幅
 */
export async function gotReward(r: { card?: CardClaim; items: ItemCount[]; picks?: number; capped?: boolean } | undefined, notify: (msg: string) => void): Promise<void> {
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
  const picks = r.picks ?? 0;
  if (picks > 0) savePicks(myPicks() + picks);
  const got = r.items.map(itemText).filter(Boolean).join('、');
  const d = r.card ? CARD_DEFS.find((x) => x.id === r.card!.card) : undefined;
  if (d && r.card) {
    saveCards([...myCards().filter((c) => c.card !== d.id), r.card]);
    const img = new Image();
    img.src = d.img;
    await Promise.race([img.decode().catch(() => undefined), new Promise((ok) => window.setTimeout(ok, 1500))]);
    const extra = [got ? `還拿到${got}，放在選單裡的「道具」。` : '', picks > 0 ? '還有一份獎勵可以選：一包肉乾或一枚順幣。' : ''].join('');
    showReveal(d, r.card, extra, picks > 0 ? () => openPick() : undefined, picks > 0 ? '選獎勵' : '好');
  } else {
    if (got) notify(`拿到${got}！放在選單裡的「道具」`);
    if (picks > 0) openPick();
  }
}

/** 選獎勵畫面裡的兩個選項（肉乾、順幣） */
const pickHtml = (n: number, fresh: boolean): string => `<div class="tc-box tc-pick-box">
      <h2 class="tc-title">${fresh ? '貼滿 5 個活動了！' : `還有 ${n} 份獎勵可以選`}</h2>
      <p class="tc-note">${fresh ? '選一份獎勵帶走：' : '每份選一個：'}</p>
      <div class="tc-pick-opts">${PICK_OPTS.map((o) => {
        const d = ITEM_DEFS.find((x) => x.id === o.id)!;
        return `<button type="button" class="tc-pick-opt" data-pick="${o.id}"><span class="tc-item-icon"><img src="${d.img}" alt="" draggable="false"></span><b>${esc(o.label)}</b><small>${esc(o.sub)}</small></button>`;
      }).join('')}</div>
      <p class="tc-pick-msg" role="status"></p>
      <button type="button" class="chip" data-close>之後再選</button>
      <p class="tc-note tc-pick-later">沒選的留在選單裡的「道具」，隨時可以回來選。</p>
    </div>`;

/** 選完了：選到的道具跳一下 */
const pickedHtml = (id: string, left: number): string => {
  const d = ITEM_DEFS.find((x) => x.id === id)!;
  const o = PICK_OPTS.find((x) => x.id === id)!;
  return `<div class="tc-box tc-pick-box">
      <h2 class="tc-title">拿到${esc(o.label)}了！</h2>
      <span class="tc-item-icon tc-picked"><img src="${d.img}" alt="${esc(d.name)}" draggable="false"></span>
      <p class="tc-note">放在選單裡的「道具」。${left > 0 ? `<br>還有 ${left} 份獎勵可以選。` : ''}</p>
      <div class="tc-pick-btns">${left > 0 ? '<button type="button" class="chip primary" data-again>再選一份</button><button type="button" class="chip" data-close>之後再選</button>' : '<button type="button" class="chip primary" data-close>好</button>'}</div>
    </div>`;
};

let pickOpen = false;
/**
 * 選獎勵（回報滿 5 則給一份）：一包古錐媽的肉乾或一枚順幣，選了就改不了；按「之後再選」收起來、留在道具欄。
 * fresh：剛拿到時（標題寫「貼滿 5 個活動了！」），從道具欄打開的寫還有幾份；onClose 收起來後（道具欄重畫）
 */
export function openPick(fresh = true, onClose?: () => void): void {
  if (pickOpen || myPicks() <= 0) return;
  pickOpen = true;
  const el = overlay('tc-pick', pickHtml(myPicks(), fresh), () => {
    pickOpen = false;
    onClose?.();
  });
  let busy = false;
  el.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-again]')) {
      el.innerHTML = pickHtml(myPicks(), false);
      el.querySelector<HTMLElement>('[data-pick]')?.focus();
      return;
    }
    const btn = t.closest<HTMLButtonElement>('[data-pick]');
    if (!btn || busy) return;
    busy = true;
    el.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => (b.disabled = true));
    const msg = el.querySelector<HTMLElement>('.tc-pick-msg');
    if (msg) msg.textContent = '';
    const id = btn.dataset.pick!;
    const r = await pickReward(id);
    busy = false;
    if (!r.ok) {
      el.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => (b.disabled = false));
      if (msg) msg.textContent = r.message;
      // 伺服器說沒有可以選的了（別的分頁選過）：再對一次
      void fetchMyCards().then((m) => {
        if (m.ok) savePicks(m.data.picks ?? 0);
      });
      return;
    }
    saveItems(r.data.items);
    savePicks(r.data.picks);
    el.innerHTML = pickedHtml(id, r.data.picks);
    el.querySelector<HTMLElement>('[data-again], [data-close]')?.focus();
  });
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
 * 選單的「說明」：使用說明（照目前的雷達，helpPage）和「換裝置」（引繼碼，卡冊、道具、瓶中信收藏一起搬；v1.467 起從卡冊搬過來，原本叫「換手機」；v1.634 加瓶中信收藏）
 */
export function openHelp(helpPage: string): void {
  const el = overlay(
    'tc-help',
    `<div class="tc-box">
      <div class="tc-head"><h2>說明</h2><button type="button" class="chip" data-close>關閉</button></div>
      <div class="tc-help-row"><a class="chip" href="${esc(helpPage)}">使用說明</a><span>怎麼回報活動、卡冊的小趣味</span></div>
      <div class="tc-help-row"><button type="button" class="chip" data-move aria-expanded="false" aria-controls="tc-move-box">換裝置</button><span>可轉移卡冊、道具及收藏的漂流瓶</span></div>
      <div class="tc-move-box" id="tc-move-box" hidden>
        <p><b>舊裝置</b>：產生引繼碼，24 小時內在新裝置輸入，卡冊、道具和瓶中信收藏（收藏的漂流瓶）會搬過去（這台就沒有了）。</p>
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
    if (r.data.picks !== undefined) savePicks(r.data.picks);
    input.value = '';
    const items = myItems().reduce((n, x) => n + x.count, 0);
    // 瓶中信收藏在漂流瓶那邊（main.ts）：叫它重新抓
    window.dispatchEvent(new CustomEvent('dr:transferred'));
    msg(`搬好了，這台現在有 ${cards.length} 張卡、${items} 個道具${r.data.letters !== undefined ? `、${r.data.letters} 封瓶中信` : ''}`);
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
    const picks = r.data.picks ?? myPicks();
    const sameCards = r.data.cards.length === local.length && r.data.cards.every((c) => local.some((x) => x.card === c.card && x.serial === c.serial));
    const sameItems = items.length === localItems.length && items.every((i) => localItems.some((x) => x.item === i.item && x.count === i.count));
    if (sameCards && sameItems && picks === myPicks()) return;
    saveCards(r.data.cards.filter(isClaim));
    saveItems(items);
    savePicks(picks);
    redraw();
  });
}

/**
 * 道具欄（選單裡的「道具」）：像遊戲的背包一格一格排（跟卡片長得不一樣），圖、右下角有幾個、下面名字（用法之後再設計）；沒有寫「還沒有道具」。
 * 還有沒選的獎勵寫在最上面，按「選獎勵」打開 openPick
 */
export function openItems(): void {
  const list = (): string => {
    const picks = myPicks();
    const pickRow = picks > 0 ? `<div class="tc-pick-row"><span>還有 <b>${picks}</b> 份獎勵可以選（肉乾或順幣）</span><button type="button" class="chip primary" data-open-pick>選獎勵</button></div>` : '';
    const have = myItems().filter((x) => ITEM_DEFS.some((d) => d.id === x.item));
    const cells = have.map((x) => {
      const d = ITEM_DEFS.find((y) => y.id === x.item)!;
      return `<li class="tc-item"><span class="tc-item-icon"><img src="${d.img}" alt="" draggable="false"><span class="tc-item-count" aria-label="${x.count} ${esc(d.unit)}">×${x.count}</span></span><span class="tc-item-name">${esc(d.name)}</span></li>`;
    });
    return `<div class="tc-head"><h2>道具</h2><button type="button" class="chip" data-close>關閉</button></div>
      ${pickRow}
      ${cells.length ? `<ul class="tc-items">${cells.join('')}</ul>` : picks > 0 ? '' : '<p class="tc-items-empty">還沒有道具</p>'}
      ${wishRow()}`;
  };
  const el = overlay('tc-bag', `<div class="tc-box"><div class="tc-main">${list()}</div></div>`);
  const redraw = (): void => {
    const main = el.querySelector('.tc-main');
    if (main && el.isConnected) main.innerHTML = list();
  };
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-open-pick]')) openPick(false, redraw);
    if (t.closest('[data-open-wish]')) openWishForm(redraw);
    if (t.closest('[data-my-wishes]')) openMyWishes(redraw);
  });
  syncMine(el, redraw);
  void fetchMyWishes().then((r) => {
    if (!r.ok) return;
    gotWishes(r.data);
    redraw();
  });
}

// ---- 許願（v1.569）：投 5 枚順幣送一個想法（不分類型），管理者審核，通過才由維護者用 AI 做出來；上線後 3 次免費調整，之後每次 1 枚 ----

/** 許願要幾枚順幣（跟伺服器的 WISH_COST 一樣） */
const WISH_COST = 5;
const WISH_MAX = 5000;
const TWEAK_MAX = 2000;
/** 許過願的瀏覽器：開網頁時才問伺服器有沒有新進度（沒許過的不多打一次） */
const LS_WISHED = 'dr.wished';
/** 還沒送出的願望（關掉再打開還在） */
const LS_WISH_DRAFT = 'dr.wishDraft';
const WISH_STATUS_TEXT: Record<WishStatus, string> = { pending: '審核中', approved: '已通過', building: '製作中', live: '已上線', rejected: '不通過', dropped: '做不出來', withdrawn: '已撤回' };
const REFUNDED: readonly WishStatus[] = ['rejected', 'dropped', 'withdrawn'];
/** 許願的靈感（表單上點一下帶進去，說明頁 help.html 也列了一樣的）：讓人知道可以許什麼願 */
const WISH_IDEAS: Array<{ label: string; text: string }> = [
  { label: '一顆新星球', text: '除了汪星，再開一顆「喵星」：有自己的地形、居民和收集卡。' },
  { label: '城市冒險', text: '沿著大稻埕、萬華的老街設計一場尋寶遊戲：每一站解一個謎，集滿拿一張隱藏卡。' },
  { label: '留下回憶', text: '把我和狗狗以前散步的路線畫在汪星上，牠會一直在那條路上走（照片放在下面的參考連結）。' },
  { label: '小博物館', text: '在 3D 國館旁邊蓋一間小館，放大家家裡的老照片和故事。' },
  { label: '一起種樹', text: '全台北的人一起在雷達上種樹，種滿一區就開出一朵大花。' },
  { label: '社區雷達', text: '做一個我們社區專屬的雷達：里民活動、二手交換、走失寵物都放上去。' },
  { label: '認領一塊地', text: '我想在汪星認領一小塊草地，種一棵寫著我家狗狗名字的樹。' },
  { label: '一段 prompt', text: '「把汪星變成晚上，螢火蟲跟著手指飛。」' },
];

let wishState: MyWishes | null = null;
const wishNews: Array<(unseen: number) => void> = [];

/** 有新進度還沒看（main.ts 用來在道具按鈕亮小紅點） */
export function onWishNews(fn: (unseen: number) => void): void {
  wishNews.push(fn);
}

/** 開網頁時：許過願的才問伺服器有沒有新進度 */
export function checkWishNews(): void {
  try {
    if (localStorage.getItem(LS_WISHED) !== '1') return;
  } catch {
    return;
  }
  void fetchMyWishes().then((r) => {
    if (r.ok) gotWishes(r.data);
  });
}

/** 伺服器給的願望、順幣：記下來、小紅點、道具欄的順幣跟著改（暫扣、退回） */
function gotWishes(d: MyWishes): void {
  wishState = d;
  if (d.wishes.length) {
    try {
      localStorage.setItem(LS_WISHED, '1');
    } catch {
      // 不能存：下次開網頁不會亮小紅點，打開道具欄還是看得到
    }
  }
  const unseen = d.unseen ?? 0;
  for (const fn of wishNews) fn(unseen);
  const list = myItems();
  const i = list.findIndex((x) => x.item === 'coin');
  if (i >= 0 && d.coins > 0) list[i] = { item: 'coin', count: d.coins };
  else if (i >= 0) list.splice(i, 1);
  else if (d.coins > 0) list.push({ item: 'coin', count: d.coins });
  saveItems(list);
}

const coinsNow = (): number => myItems().find((x) => x.item === 'coin')?.count ?? 0;

/** 道具欄下面的許願區：順幣夠才能按；許過的有「我的願望」（有新進度亮小紅點） */
function wishRow(): string {
  const n = coinsNow();
  const ws = wishState?.wishes ?? [];
  const news = wishState?.unseen ?? 0;
  return `<section class="tc-wish-row">
      <p><b>許願</b>投 ${WISH_COST} 枚順幣，寫下你希望留下什麼在洋流雷達，審核通過就用 AI 做出來。</p>
      <p class="tc-wish-eg">例如：再開一顆喵星、一場老街尋寶冒險、把和狗狗散步的路線留在汪星、全台北一起種樹……</p>
      <div class="tc-wish-btns">
        <button type="button" class="chip primary" data-open-wish${n < WISH_COST ? ' disabled' : ''}>投 ${WISH_COST} 枚順幣許願</button>
        ${ws.length ? `<button type="button" class="chip${news ? ' has-news' : ''}" data-my-wishes>我的願望（${ws.length}）</button>` : ''}
      </div>
      ${n < WISH_COST ? `<small>還差 ${WISH_COST - n} 枚順幣。每回報 5 則活動放上雷達，可以選一枚順幣。</small>` : ''}
    </section>`;
}

interface WishDraft {
  body: string;
  nickname: string;
  links: string;
}
function loadDraft(): WishDraft {
  try {
    const v = JSON.parse(localStorage.getItem(LS_WISH_DRAFT) ?? '{}') as Partial<WishDraft>;
    return { body: String(v.body ?? ''), nickname: String(v.nickname ?? ''), links: String(v.links ?? '') };
  } catch {
    return { body: '', nickname: '', links: '' };
  }
}
function saveDraft(d: WishDraft | null): void {
  try {
    if (d && (d.body || d.nickname || d.links)) localStorage.setItem(LS_WISH_DRAFT, JSON.stringify(d));
    else localStorage.removeItem(LS_WISH_DRAFT);
  } catch {
    // 不能存草稿：關掉就沒了
  }
}

/** 許願的表單（疊在道具欄上面）：想法、暱稱、參考連結、規範；送出後順幣先暫扣 */
export function openWishForm(onDone?: () => void): void {
  const d = loadDraft();
  const el = overlay(
    'tc-wishform',
    `<div class="tc-box tc-form-box">
      <div class="tc-head"><h2>許願</h2><button type="button" class="chip" data-close>關閉</button></div>
      <form class="tc-wish-form" novalidate>
        <label class="tc-field"><span>你的想法</span>
          <textarea name="body" rows="8" maxlength="${WISH_MAX}" placeholder="你希望留下什麼在洋流雷達？小到一句話、一段 prompt，大到一份完整企劃、一整顆星球，天馬行空都可以">${esc(d.body)}</textarea>
          <small class="tc-len"></small></label>
        <div class="tc-ideas"><span>想不到嗎？點一個靈感：</span>${WISH_IDEAS.map((x, i) => `<button type="button" class="tc-idea" data-idea="${i}">${esc(x.label)}</button>`).join('')}</div>
        <label class="tc-field"><span>暱稱（選填）</span>
          <input name="nickname" maxlength="20" autocomplete="nickname" value="${esc(d.nickname)}">
          <small>上線後寫在說明的「實現的願望」：點子來自 ○○，不填就不署名</small></label>
        <label class="tc-field"><span>參考連結（選填）</span>
          <textarea name="links" rows="2" placeholder="一行一個，最多 3 個；要附圖請貼圖片的連結">${esc(d.links)}</textarea></label>
        <div class="tc-rules"><b>許願規範</b><ul>
          <li>不放別人的個資（電話、地址、身分證字號…）。</li>
          <li>不攻擊、抹黑特定人士或政黨。</li>
          <li>不用沒有授權的圖片、文字。</li>
          <li>內容只有管理者看得到。通過後可能調整做法才上線，完成時間不一定。</li>
          <li>不通過、做不出來或自己撤回，${WISH_COST} 枚順幣全部退回。</li>
          <li>上線後有 3 次免費調整，之後每次 1 枚順幣。</li>
        </ul></div>
        <label class="tc-agree"><input type="checkbox" name="agree"> 我看過規範了</label>
        <button type="submit" class="chip primary">投 ${WISH_COST} 枚順幣許願</button>
        <p class="tc-move-msg" role="status"></p>
      </form>
    </div>`,
    onDone,
    true,
  );
  const form = el.querySelector<HTMLFormElement>('.tc-wish-form')!;
  const field = (n: string): HTMLInputElement => form.elements.namedItem(n) as HTMLInputElement;
  const msg = (text: string, bad = false): void => {
    const m = form.querySelector<HTMLElement>('.tc-move-msg')!;
    m.textContent = text;
    m.classList.toggle('bad', bad);
  };
  const len = (): void => {
    form.querySelector('.tc-len')!.textContent = `${field('body').value.trim().length} / ${WISH_MAX}`;
  };
  len();
  form.addEventListener('input', () => {
    len();
    saveDraft({ body: field('body').value, nickname: field('nickname').value, links: field('links').value });
  });
  // 靈感：空的（或還是別的靈感）就換成這個，自己寫了字的接在後面，接著自己改
  form.querySelector('.tc-ideas')?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-idea]');
    const idea = b ? WISH_IDEAS[Number(b.dataset.idea)] : undefined;
    if (!idea) return;
    const ta = field('body');
    const cur = ta.value.trim();
    ta.value = !cur || WISH_IDEAS.some((x) => x.text === cur) ? idea.text : `${cur}\n\n${idea.text}`;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = field('body').value.trim();
    if (body.length < 5) return msg('想法至少寫 5 個字', true);
    if (!field('agree').checked) return msg('請先看過並勾選許願規範', true);
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    btn.disabled = true;
    msg('送出中…');
    const r = await sendWish({ body, nickname: field('nickname').value, links: field('links').value, agree: true });
    btn.disabled = false;
    if (!r.ok) return msg(r.message, true);
    saveDraft(null);
    gotWishes(r.data);
    const box = el.querySelector('.tc-box')!;
    box.classList.remove('tc-form-box');
    box.innerHTML = `<h2 class="tc-title">願望送出了</h2>
      <img class="tc-picked" src="${ITEM_DEFS.find((x) => x.id === 'coin')!.img}" alt="">
      <p class="tc-note">第 ${r.data.id} 號願望。${WISH_COST} 枚順幣先暫扣，審核通過才正式扣掉；不通過會全部退回。<br>進度在「道具 → 我的願望」看得到，有新進度時道具按鈕會亮小紅點。</p>
      <button type="button" class="chip primary" data-close>好</button>`;
    el.querySelector<HTMLElement>('[data-close]')?.focus();
  });
  field('body').focus();
}

/** 管理者的回覆：網址變成連結（回覆是管理者寫的，先跳脫再換） */
const replyHtml = (s: string): string => esc(s).replace(/https?:\/\/[^\s<，。、；！？）」』]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
const shortUrl = (u: string): string => u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48);

/** 這一筆的順幣：暫扣、已退回、用了幾枚；免費的調整寫「免費調整」 */
const coinNote = (w: WishTweak, tweak: boolean): string =>
  !w.cost ? (tweak ? '免費調整' : '') : REFUNDED.includes(w.status) ? `${w.cost} 枚順幣已退回` : w.status === 'pending' ? `${w.cost} 枚順幣暫扣中` : `用了 ${w.cost} 枚順幣`;

function entryHtml(w: WishTweak, label: string, tweak: boolean): string {
  const note = coinNote(w, tweak);
  return `<div class="tc-wish-top">${w.seen ? '' : '<span class="tc-new">新</span>'}<span>${esc(label)}・${dateText(w.createdAt)}</span><span class="tc-st st-${w.status}">${WISH_STATUS_TEXT[w.status] ?? esc(w.status)}</span></div>
    <p class="tc-wish-body" title="點一下看全部">${esc(w.body)}</p>
    ${w.reply ? `<p class="tc-wish-reply"><b>回覆</b>${replyHtml(w.reply)}</p>` : ''}
    ${note ? `<small class="tc-wish-coin">${note}</small>` : ''}`;
}

/** 我的願望（疊在道具欄上面）：每個願望的進度、回覆、調整；審核中的可以撤回，上線的可以調整 */
export function openMyWishes(onChange?: () => void): void {
  let tweakOpen: number | null = null;
  let busy = false;
  const list = (): string => {
    const ws = wishState?.wishes ?? [];
    const coins = coinsNow();
    const items = ws.map((w: Wish) => {
      let acts = '';
      if (w.status === 'pending') acts = `<button type="button" class="chip" data-withdraw="${w.id}">撤回（退回 ${w.cost} 枚順幣）</button>`;
      else if (w.status === 'live') {
        if (w.tweaking) acts = '<small>調整處理中，做好後可以再調整</small>';
        else if (tweakOpen === w.id)
          acts = `<form class="tc-tweak-form" data-tweak="${w.id}" novalidate>
              <textarea name="body" rows="4" maxlength="${TWEAK_MAX}" placeholder="想改哪裡？寫得越清楚越好"></textarea>
              <div class="tc-wish-acts"><button type="submit" class="chip primary">${w.tweakCost ? `送出（${w.tweakCost} 枚順幣）` : '送出（免費）'}</button><button type="button" class="chip" data-tweak-cancel>取消</button></div>
            </form>`;
        else {
          const short = w.tweakCost > coins;
          acts = `<button type="button" class="chip" data-tweak-open="${w.id}"${short ? ' disabled' : ''}>我想調整（${w.freeLeft ? `剩 ${w.freeLeft} 次免費` : `每次 ${w.tweakCost} 枚順幣`}）</button>${short ? '<small>順幣不夠</small>' : ''}`;
        }
      }
      const tweaks = w.tweaks.length
        ? `<ol class="tc-tweaks">${w.tweaks.map((t, i) => `<li>${entryHtml(t, `調整 ${i + 1}`, true)}${t.status === 'pending' ? `<div class="tc-wish-acts"><button type="button" class="chip" data-withdraw="${t.id}">撤回</button></div>` : ''}</li>`).join('')}</ol>`
        : '';
      return `<li class="tc-wish-item">
          ${entryHtml(w, `第 ${w.id} 號`, false)}
          ${w.links.length ? `<p class="tc-wish-links">${w.links.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(shortUrl(u))}</a>`).join('')}</p>` : ''}
          ${w.nickname ? `<small>署名：${esc(w.nickname)}</small>` : ''}
          ${tweaks}
          ${acts ? `<div class="tc-wish-acts">${acts}</div>` : ''}
        </li>`;
    });
    return `<div class="tc-head"><h2>我的願望</h2><button type="button" class="chip" data-close>關閉</button></div>
      <p class="tc-wish-coins">現在有 <b>${coins}</b> 枚順幣</p>
      ${items.length ? `<ul class="tc-wishes">${items.join('')}</ul>` : '<p class="tc-items-empty">還沒有許過願</p>'}
      <p class="tc-move-msg" role="status"></p>`;
  };
  // 調整也要打字：一樣只有按「關閉」才收起來
  const el = overlay('tc-mywish', `<div class="tc-box tc-form-box"><div class="tc-main">${list()}</div></div>`, onChange, true);
  const redraw = (): void => {
    const main = el.querySelector('.tc-main');
    if (main && el.isConnected) main.innerHTML = list();
  };
  const msg = (text: string, bad = false): void => {
    const m = el.querySelector<HTMLElement>('.tc-main > .tc-move-msg');
    if (!m) return;
    m.textContent = text;
    m.classList.toggle('bad', bad);
  };
  el.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const body = t.closest('.tc-wish-body');
    if (body) return void body.classList.toggle('full');
    const open = t.closest<HTMLElement>('[data-tweak-open]');
    if (open) {
      tweakOpen = Number(open.dataset.tweakOpen);
      redraw();
      el.querySelector<HTMLTextAreaElement>('.tc-tweak-form textarea')?.focus();
      return;
    }
    if (t.closest('[data-tweak-cancel]')) {
      tweakOpen = null;
      return redraw();
    }
    const wd = t.closest<HTMLButtonElement>('[data-withdraw]');
    if (wd && !busy) {
      if (!confirm('撤回這一筆？順幣會退回。')) return;
      busy = true;
      wd.disabled = true;
      const r = await withdrawWish(Number(wd.dataset.withdraw));
      busy = false;
      if (!r.ok) return msg(r.message, true);
      gotWishes(r.data);
      redraw();
      msg('撤回了，順幣退回了');
    }
  });
  el.addEventListener('submit', async (e) => {
    const form = (e.target as HTMLElement).closest<HTMLFormElement>('[data-tweak]');
    if (!form) return;
    e.preventDefault();
    const text = form.querySelector('textarea')!.value.trim();
    if (text.length < 5) return msg('想改哪裡至少寫 5 個字', true);
    if (busy) return;
    busy = true;
    form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = true;
    const r = await sendTweak(Number(form.dataset.tweak), text);
    busy = false;
    if (!r.ok) {
      form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = false;
      return msg(r.message, true);
    }
    tweakOpen = null;
    gotWishes(r.data);
    redraw();
    msg('調整送出了，審核後會開始做');
  });
  // 跟伺服器拿最新的；有新進度先照「新」畫出來，再告訴伺服器看過了（小紅點拿掉）
  void fetchMyWishes().then(async (r) => {
    if (!r.ok || !el.isConnected) return;
    gotWishes(r.data);
    redraw();
    if (!r.data.unseen) return;
    const s = await markWishesSeen();
    if (s.ok && wishState) gotWishes({ ...wishState, unseen: 0 });
  });
}
