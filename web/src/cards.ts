/**
 * 收集卡（尋找小法）：卡冊、拿到卡時翻開的畫面。
 * 卡片的內容寫在這裡（照片在 public/cards/），拿到的卡存在伺服器（裝置代碼，worker/src/cards.ts），
 * 這個瀏覽器另外記一份（dr.cards）：點小法時拿過的就不再問伺服器
 */
import { claimCard, fetchMyCards, type CardClaim } from './api';

export interface CardDef {
  /** 跟伺服器的 CARDS 一樣 */
  id: string;
  no: number;
  name: string;
  img: string;
  /** 卡片上的介紹 */
  about: string;
  /** 還沒拿到時卡冊裡的提示（只給一點點） */
  hint: string;
}

export const CARD_DEFS: CardDef[] = [
  { id: 'xiaofa', no: 1, name: '小法', img: `${import.meta.env.BASE_URL}cards/xiaofa.webp`, about: '白色馬爾濟斯。愛邊走邊聞，常在碑林出現。', hint: '國館的小法' },
];

const LS_CARDS = 'dr.cards';
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

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const noText = (d: CardDef): string => `No.${String(d.no).padStart(3, '0')}`;
const dateText = (t: number): string => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(t * 1000));
const PAW =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="43" rx="14" ry="12"/><ellipse cx="13" cy="27" rx="6" ry="8" transform="rotate(-20 13 27)"/><ellipse cx="25" cy="15" rx="6" ry="8.5" transform="rotate(-6 25 15)"/><ellipse cx="39" cy="15" rx="6" ry="8.5" transform="rotate(6 39 15)"/><ellipse cx="51" cy="27" rx="6" ry="8" transform="rotate(20 51 27)"/></svg>';

function frontHtml(d: CardDef, c: CardClaim): string {
  return `<div class="tc-face tc-front">
      <div class="tc-top"><span>${noText(d)}</span><span>汪星・中山公園</span></div>
      <div class="tc-photo"><img src="${d.img}" alt="${esc(d.name)}的照片" draggable="false"></div>
      <div class="tc-name">${esc(d.name)}</div>
      <p class="tc-about">${esc(d.about)}</p>
      <div class="tc-meta"><span>在${esc(c.place)}找到</span><span>${dateText(c.at)}</span></div>
      <div class="tc-serial">第 ${c.serial} 位找到${esc(d.name)}的人</div>
    </div>`;
}

/** 卡片背面；還沒拿到的在卡冊裡畫背面加一個問號和提示 */
function backHtml(d: CardDef, missing = false): string {
  return `<div class="tc-face tc-back">
      <div class="tc-paw">${PAW}</div>
      <div class="tc-back-title">${missing ? '？？？' : '尋找小法'}</div>
      <div class="tc-back-no">${noText(d)}</div>
      ${missing ? `<div class="tc-back-hint">提示：${esc(d.hint)}</div>` : ''}
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

/** 拿到卡：卡片背面朝上出現，翻過來 */
function showReveal(d: CardDef, c: CardClaim): void {
  const el = overlay(
    'tc-reveal',
    `<div class="tc-box">
      <h2 class="tc-title">找到${esc(d.name)}了！</h2>
      <div class="tc-flip"><div class="tc-inner">${frontHtml(d, c)}${backHtml(d)}</div></div>
      <p class="tc-note">收進卡冊了，選單裡的「卡冊」隨時看得到。</p>
      <button type="button" class="chip primary" data-close>好</button>
    </div>`,
  );
  window.setTimeout(() => el.querySelector('.tc-flip')?.classList.add('open'), 450);
}

let claiming = false;
/** 點到小法（雷達或 3D）：還沒有這張卡就跟伺服器拿，翻開給你看；拿過的不做什麼 */
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

/**
 * 卡冊：拿到的卡、還沒拿到的（背面加問號和一點點提示）。
 * 打開時再跟伺服器對一次（這個瀏覽器的紀錄被清掉、伺服器還有的補回來）
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
  const el = overlay('tc-album', `<div class="tc-box">${list()}</div>`);
  void fetchMyCards().then((r) => {
    if (!r.ok || !el.isConnected) return;
    const local = myCards();
    if (r.data.cards.length === local.length && r.data.cards.every((c) => local.some((x) => x.card === c.card))) return;
    saveCards(r.data.cards.filter(isClaim));
    const box = el.querySelector('.tc-box');
    if (box) box.innerHTML = list();
  });
}
