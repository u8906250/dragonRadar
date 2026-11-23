/**
 * 全螢幕雷達的搜尋地址（v1.785 使用者說想在全螢幕雷達直接搜尋地址）：右上的放大鏡打開一個框，打地址、地名、路名按 Enter，
 * 先列網頁裡就有的縣市、鄉鎮市區、地標（places-tw、pois-tw，不用連網），再列伺服器查到的（Photon、Nominatim，只查台灣）；
 * 點一筆雷達飛過去、插一根針。按 Enter 才查（Nominatim 的使用規範不能邊打邊查）
 */
import { searchPlaces, type PlaceHit } from './api';
import { haversineKm, type LatLng } from './geo';

export type FoundPlace = PlaceHit;

/** 網頁裡就有的最多列幾筆、全部最多幾筆 */
const LOCAL_MAX = 3;
const ALL_MAX = 8;
/** 同名、這麼近就當成同一個 */
const SAME_KM = 0.5;

/** pois-tw 的種類 */
const POI_KIND: Record<string, string> = {
  lpark: '公園',
  park: '公園',
  es: '國小',
  jh: '國中',
  hs: '高中職',
  school: '大學',
  culture: '文化',
  historic: '古蹟',
  attraction: '景點',
  fun: '遊樂園',
  gov: '政府',
  stadium: '體育場',
};

export interface LocalData {
  counties: ReadonlyArray<readonly [string, number, number]>;
  towns: ReadonlyArray<readonly [string, number, number, string]>;
  pois: ReadonlyArray<readonly [string, number, number, string, number]>;
}

/** 比對用：台→臺、全形英數轉半形、拿掉空白、英文小寫 */
export const fold = (s: string): string =>
  s
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/台/g, '臺')
    .replace(/[\s　]+/g, '')
    .toLowerCase();

/** 地標外框的公頃 → 飛過去的範圍：看得到整個 */
const poiKm = (ha: number): number => Math.min(5, Math.max(0.3, (Math.sqrt(Math.max(0, ha)) / 10) * 0.75));

/**
 * 網頁裡就有的：名字一樣的最先，再來是開頭一樣的，再來是名字裡有（打兩個字以上才算）；
 * 一樣的先縣市、再鄉鎮市區、再地標（打「大安」先列大安區），同一種照離畫面中間的遠近。
 * 地標寫它在哪個縣市（照最近的鄉鎮市區中心，40 公里內）
 */
export function localMatches(q: string, d: LocalData, near: LatLng | null, max = LOCAL_MAX): FoundPlace[] {
  const k = fold(q);
  if (!k) return [];
  const cands: Array<{ hit: FoundPlace; rank: number; tier: number; d: number }> = [];
  const consider = (names: string[], tier: number, hit: FoundPlace): void => {
    let rank = 3;
    for (const name of names) {
      const n = fold(name);
      rank = Math.min(rank, n === k ? 0 : n.startsWith(k) ? 1 : k.length >= 2 && n.includes(k) ? 2 : 3);
    }
    if (rank < 3) cands.push({ hit, rank, tier, d: near ? haversineKm(near, hit) : 0 });
  };
  for (const [name, lat, lng] of d.counties) consider([name], 0, { name, area: '', kind: '縣市', lat, lng, km: name.endsWith('縣') ? 30 : 15 });
  for (const [name, lat, lng, county] of d.towns) consider([name, `${county}${name}`], 1, { name, area: county, kind: '鄉鎮市區', lat, lng, km: 4 });
  for (const [name, lat, lng, kind, ha] of d.pois) consider([name], 2, { name, area: '', kind: POI_KIND[kind] ?? '', lat, lng, km: poiKm(ha) });
  cands.sort((a, b) => a.rank - b.rank || a.tier - b.tier || a.d - b.d);
  const out = cands.slice(0, max).map((c) => c.hit);
  for (const h of out) if (!h.area && h.kind !== '縣市') h.area = countyNear(h, d.towns);
  return out;
}

function countyNear(p: LatLng, towns: LocalData['towns']): string {
  let best = '';
  let bd = 40;
  for (const t of towns) {
    const dk = haversineKm(p, { lat: t[1], lng: t[2] });
    if (dk < bd) {
      bd = dk;
      best = t[3];
    }
  }
  return best;
}

/** 網頁裡的先、伺服器的接著；同名、SAME_KM 內的只留一筆 */
export function mergeHits(local: FoundPlace[], server: FoundPlace[]): FoundPlace[] {
  const out: FoundPlace[] = [];
  for (const h of [...local, ...server]) {
    if (out.some((o) => fold(o.name) === fold(h.name) && haversineKm(o, h) < SAME_KM)) continue;
    out.push(h);
    if (out.length >= ALL_MAX) break;
  }
  return out;
}

let localData: Promise<LocalData> | null = null;
/** 縣市、鄉鎮市區、地標（約 100 KB）：打開搜尋框時才載入 */
function loadLocal(): Promise<LocalData> {
  localData ??= Promise.all([import('./places-tw'), import('./pois-tw')])
    .then(([pl, po]) => ({ counties: pl.TW_COUNTIES, towns: pl.TW_TOWNS, pois: po.TW_POIS }))
    .catch(() => {
      localData = null;
      return { counties: [], towns: [], pois: [] };
    });
  return localData;
}

export interface FindHooks {
  /** 畫面中間（排遠近用） */
  center(): LatLng;
  /** 飛過去、插針 */
  go(p: FoundPlace): void;
  /** 拿掉針 */
  clear(): void;
}

export function wireFind(h: FindHooks): void {
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const btn = $<HTMLButtonElement>('find-btn');
  const box = $<HTMLDivElement>('find-box');
  const form = $<HTMLFormElement>('find-form');
  const input = $<HTMLInputElement>('find-input');
  const clearBtn = $<HTMLButtonElement>('find-clear');
  const status = $<HTMLParagraphElement>('find-status');
  const list = $<HTMLUListElement>('find-results');
  /** 查到一半又查了：舊的結果不用 */
  let seq = 0;
  const setStatus = (text: string): void => {
    status.textContent = text;
    status.hidden = text === '';
  };
  const setOpen = (open: boolean): void => {
    box.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('on', open);
    if (open) {
      void loadLocal();
      input.focus();
      input.select();
    }
  };
  const show = (hits: FoundPlace[]): void => {
    list.replaceChildren(
      ...hits.map((hit) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'find-hit';
        const name = document.createElement('b');
        name.textContent = hit.name;
        b.appendChild(name);
        const sub = [hit.kind, hit.area].filter(Boolean).join(' · ');
        if (sub) {
          const s = document.createElement('span');
          s.textContent = sub;
          b.appendChild(s);
        }
        b.addEventListener('click', () => {
          setOpen(false);
          input.blur();
          h.go(hit);
        });
        li.appendChild(b);
        return li;
      }),
    );
  };
  btn.addEventListener('click', () => setOpen(box.hidden));
  input.addEventListener('input', () => {
    clearBtn.hidden = input.value === '';
  });
  clearBtn.addEventListener('click', () => {
    seq++;
    input.value = '';
    clearBtn.hidden = true;
    list.replaceChildren();
    setStatus('');
    h.clear();
    input.focus();
  });
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    setOpen(false);
    btn.focus();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const my = ++seq;
    const near = h.center();
    list.replaceChildren();
    setStatus('搜尋中…');
    void (async () => {
      const local = localMatches(q, await loadLocal(), near);
      if (my !== seq) return;
      show(local);
      const r = await searchPlaces(q, near);
      if (my !== seq) return;
      const all = mergeHits(local, r.ok ? r.data : []);
      show(all);
      if (!r.ok) setStatus(all.length > 0 ? `${r.message}，只列出網頁裡就有的` : r.message);
      else setStatus(all.length > 0 ? '' : `找不到「${q}」。可以換個寫法，例如加上縣市、寫完整的路名`);
    })();
  });
}
