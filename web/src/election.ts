/**
 * 政黨雷達（2026-11-28 使用者說的）：2026 縣市長選舉（含直轄市長）各鄉鎮市區得票最高的政黨塗那一黨的顏色，
 * 得票率越高越深；點一區看那一區每位候選人的票數和那個縣市的當選人。資料在 election-2026.ts（第一次用到才載入）
 */
import { ELECTION_COUNTIES, ELECTION_UPDATED, TOWN_ARCS, TOWN_SHAPES, type ElectionCounty, type ElectionTown } from './election-2026';

export { ELECTION_UPDATED };

/** 政黨的顏色（各黨慣用的代表色）；沒列到的照名稱挑一個 */
const PARTY_COLORS: Record<string, string> = {
  民主進步黨: '#1b9431',
  中國國民黨: '#1f3fb4',
  台灣民眾黨: '#28c8c8',
  時代力量: '#fbbe01',
  台灣基進: '#a73f24',
  親民黨: '#ff6310',
  社會民主黨: '#e6007e',
  綠黨: '#73be00',
  新黨: '#ffcc00',
  無黨籍及未經政黨推薦: '#8a8a8a',
};
const OTHER_COLORS = ['#8e5bb5', '#c06c84', '#6c8ec0', '#b58b3a', '#4f8f84'];
export function partyColor(party: string): string {
  const c = PARTY_COLORS[party];
  if (c) return c;
  let h = 0;
  for (const ch of party) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return OTHER_COLORS[h % OTHER_COLORS.length];
}
/** 清單、介紹寫的政黨簡稱 */
export const partyShort = (party: string): string => (party === '無黨籍及未經政黨推薦' ? '無黨籍' : party);

/** 塗色的深淺：得票最高的那位在這一區的得票率 SHARE_LO 以下最淡、SHARE_HI 以上最深 */
export const SHARE_LO = 0.35;
export const SHARE_HI = 0.75;
export const ALPHA_LO = 0.14;
export const ALPHA_HI = 0.86;
export const shadeOf = (share: number): number => ALPHA_LO + (ALPHA_HI - ALPHA_LO) * Math.min(1, Math.max(0, (share - SHARE_LO) / (SHARE_HI - SHARE_LO)));

export interface TownResult {
  /** 鄉鎮市區代碼 */
  code: string;
  county: ElectionCounty;
  town: ElectionTown;
  /** 這一區得票最高的候選人（cands 的索引）；還沒開出票是 -1 */
  lead: number;
  /** 得票最高的那位在這一區的得票率（0～1） */
  share: number;
  /** 這一區的有效票（候選人得票加起來） */
  total: number;
  /** 形狀：每一圈 [緯度, 經度]（外圈、洞都在裡面，照 evenodd 判斷） */
  rings: Array<Array<[number, number]>>;
  /** 範圍 [南, 西, 北, 東] */
  box: [number, number, number, number];
}

/** 縣市的當選人：開票完畢（已送投票所數等於總數）時得票最高的；還沒開完是「目前領先」 */
export function countyLead(c: ElectionCounty): { index: number; done: boolean } {
  let index = -1;
  for (let i = 0; i < c.cands.length; i++) if (index < 0 || c.cands[i][3] > c.cands[index][3]) index = i;
  return { index, done: c.sent >= c.total && c.total > 0 };
}

/** 邊解碼成 [緯度, 經度] */
const arcs: Array<Array<[number, number]>> = TOWN_ARCS.map((flat) => {
  const out: Array<[number, number]> = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < flat.length; i += 2) {
    x += flat[i];
    y += flat[i + 1];
    out.push([y / 10000, x / 10000]);
  }
  return out;
});

function ringOf(ids: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const id of ids) {
    const pts = id >= 0 ? arcs[id] : [...arcs[~id]].reverse();
    out.push(...(out.length > 0 ? pts.slice(1) : pts));
  }
  return out;
}

export const TOWNS: TownResult[] = ELECTION_COUNTIES.flatMap((county) =>
  county.towns.flatMap((town): TownResult[] => {
    const shape = TOWN_SHAPES[town.code];
    if (!shape) return [];
    const rings = shape.flatMap((poly) => poly.map(ringOf)).filter((r) => r.length >= 4);
    const box: [number, number, number, number] = [90, 180, -90, -180];
    for (const r of rings)
      for (const [lat, lng] of r) {
        box[0] = Math.min(box[0], lat);
        box[1] = Math.min(box[1], lng);
        box[2] = Math.max(box[2], lat);
        box[3] = Math.max(box[3], lng);
      }
    const total = town.votes.reduce((a, b) => a + b, 0);
    let lead = -1;
    for (let i = 0; i < town.votes.length; i++) if (town.votes[i] > 0 && (lead < 0 || town.votes[i] > town.votes[lead])) lead = i;
    return [{ code: town.code, county, town, lead, share: lead >= 0 && total > 0 ? town.votes[lead] / total : 0, total, rings, box }];
  }),
);
export const COUNTIES = ELECTION_COUNTIES;

/** 點在哪一區（evenodd：外圈、洞一起算）；不在任何一區是 null */
export function townAt(lat: number, lng: number): TownResult | null {
  for (const t of TOWNS) {
    if (lat < t.box[0] || lat > t.box[2] || lng < t.box[1] || lng > t.box[3]) continue;
    let inside = false;
    for (const r of t.rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [yi, xi] = r[i];
        const [yj, xj] = r[j];
        if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    if (inside) return t;
  }
  return null;
}

/** 縣市的範圍（[南, 西, 北, 東]），清單點縣市時拉到那裡 */
export function countyBox(code: string): [number, number, number, number] | null {
  const ts = TOWNS.filter((t) => t.county.code === code);
  if (ts.length === 0) return null;
  return [Math.min(...ts.map((t) => t.box[0])), Math.min(...ts.map((t) => t.box[1])), Math.max(...ts.map((t) => t.box[2])), Math.max(...ts.map((t) => t.box[3]))];
}
