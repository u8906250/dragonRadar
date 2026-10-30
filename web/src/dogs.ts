/**
 * 會動的狗（dog.ts 畫、park.ts 放在汪星的中山公園；之後可以有很多隻，每隻一個 Dog，有名字，長相是 DogLook，個性是 DogNature）：
 * 每隻狗一段一段地動（DogSeg）：stand 站著搖尾巴、sniff 低頭聞一聞（鼻子湊到地上、左右聞）、sit 坐下（坐一下再站起來）、
 * stretch 伸懶腰（下犬式：前腳往前伸、胸口壓低貼地、屁股翹高，停一下再站起來；坐完、趴完常常伸一下）、
 * lie 趴著休息（跑完多半趴下來，平常偶爾也趴；rest 是下巴靠在前腳上、閉眼睛）、idle 停下來發呆（一動也不動、盯著旁邊、慢慢眨眼）、
 * walk 走（四隻腳輪流，有時候邊走邊低頭聞 nose）、run 跑（真的跑：前腳一起伸、後腳一起蹬，偶爾才跑），from 走到 to；
 * 大多在同一塊草皮裡走一走、停下來聞一聞，偶爾站著、坐下；有時候經過地面到附近另一塊草皮（大多用跑的，近的才用走的；DogYard 決定能去哪）；
 * 偶爾去附近的湖邊（池塘岸邊）喝水：走或跑到岸上、面向水低頭一口一口舔，喝完走回原來的地方；
 * 點了（pet）有時候只轉頭看你，其他時候轉過來面向你（往南）坐下：先站好、頭先轉過來，身體以後腳附近為支點、四隻腳一步一步踏著轉過來，轉好了才坐下。
 * 每一段開始時慢慢轉到要走的方向（dir0 → dir，緯經度的方向；原地轉身的照 turn 踏步轉）。拉近畫出整隻時每一格畫面重畫（animateDogs：照這一段在畫面上從哪到哪、
 * 面向哪邊，用 dog.ts 畫 3D 的狗），這一段結束時重畫整層（onDogMove 給的 redraw，算下一段在畫面上的位置）
 */
import { dogHeight, dogSvg, STILL, type DogLook, type DogPose } from './dog';

type Pt = [number, number];
export type DogDo = 'stand' | 'idle' | 'sniff' | 'sit' | 'lie' | 'sleep' | 'stretch' | 'drink' | 'walk' | 'run';
export interface DogSeg {
  do: DogDo;
  from: Pt;
  to: Pt;
  /** performance.now() */
  start: number;
  ms: number;
  /** 一開始面向哪（上一段的方向）、轉到面向哪（緯經度的方向，長短不管） */
  dir0: Pt;
  dir: Pt;
  /** 在哪一塊草皮 */
  ring: number;
  /** 被點了坐下 */
  pet?: boolean;
  /** 邊走邊低頭聞 */
  nose?: boolean;
  /** 經過地面到另一塊草皮 */
  cross?: boolean;
  /** 尾巴：一開始（上一段的）、這一段放下來多少（0 往上捲過背～1 垂在後面） */
  tail0?: number;
  tail?: number;
  /** 趴著時下巴靠在前腳上、閉眼睛 */
  rest?: boolean;
  /** 照步道走：走到 to 之後接著走的轉折點 */
  via?: Pt[];
  /** 去喝水：走到岸上之後面向哪（水裡的一點）、喝完照原路走回去的轉折點 */
  goal?: 'drink';
  face?: Pt;
  back?: Pt[];
  /**
   * 原地轉身（被點了轉過來、走到湖邊轉向水）：這一段開始後幾毫秒開始轉、轉多久（轉越多越久），
   * 頭先轉過去、身體跟著一步一步踏著轉，以後腳附近為支點（from 繞到 to）
   */
  turn?: [number, number];
  /** 被點的時候是什麼姿勢、幾毫秒慢慢站好（趴著、坐著先站起來，低著頭的先抬起來） */
  pose0?: DogPose;
  rise?: number;
}

/**
 * 狗待的地方：隨機一塊的隨機一處、這一塊裡隨機一處、直直走過去走不走得到（只走草地和步道）、照步道從這裡走到那裡的轉折點、
 * 從這裡照步道走到附近另一塊草皮的轉折點（最後一點是要去的地方；抽不到是 null）、兩點差幾公尺（狗走在哪個世界就照那裡的公尺）
 */
export interface DogYard {
  anywhere(rand: () => number): { ring: number; at: Pt } | null;
  within(ring: number, rand: () => number): Pt | null;
  canWalk?(a: Pt, b: Pt): boolean;
  route?(a: Pt, b: Pt, maxM?: number): Pt[] | null;
  elsewhere(ring: number, at: Pt, rand: () => number): { ring: number; path: Pt[] } | null;
  /** 附近的湖邊：照步道走到岸上的轉折點（最後一點站在岸上）、面向水裡哪一點；沒有水是 undefined */
  water?(at: Pt, rand: () => number): { path: Pt[]; face: Pt } | null;
  metres(a: Pt, b: Pt): number;
}

/**
 * 個性（每隻狗可以不一樣；之後給一隻狗自己的動作和個性就給牠自己的一份）：
 * speed 走路、邊走邊聞、跑步多快（公尺／秒），reach 一次走、聞著走、在草皮裡跑多遠（公尺），
 * stop 走完停下來、again 停完再停一下的機率，stays 停下來做什麼（權重：聞、站著、發呆、坐、趴、伸懶腰），
 * run 在草皮裡用跑的、nose 邊走邊聞、cross 換到另一塊草皮、crossRun 換草皮時用跑的、drink 去湖邊喝水的機率，crossWalk 幾公尺內去喝水偶爾用走的（再遠用跑的），
 * last 每種停下來的動作停多久（毫秒，最短～最長），
 * afterRun 跑完做什麼（權重：趴下來休息、停下來發呆、改成走路），stretchAfterRest 坐完趴完伸懶腰、chin 趴著下巴靠下去閉眼睛的機率，
 * glance 點了只轉頭看你（繼續做原本的事）的機率（其他時候轉過來坐下），
 * sleep 停下來捲成一圈睡覺的權重（白天、晚上不一樣，晚上是 night 那幾點：晚上一睡就睡到早上，白天打個盹 nap 毫秒），
 * tail 每種動作尾巴垂下來的機率
 */
export interface DogNature {
  speed: { walk: number; sniff: number; run: number };
  reach: { walk: [number, number]; sniff: [number, number]; run: [number, number] };
  stop: number;
  again: number;
  stays: Partial<Record<DogDo, number>>;
  run: number;
  nose: number;
  cross: number;
  crossRun: number;
  drink: number;
  crossWalk: number;
  afterRun: { lie: number; idle: number; walk: number };
  stretchAfterRest: number;
  chin: number;
  glance: number;
  sleep: { day: number; night: number };
  night: [number, number];
  nap: [number, number];
  tail: Partial<Record<DogDo, number>>;
  last: Partial<Record<DogDo, [number, number]>>;
}
/** 一般的狗：大多走一走、停下來聞一聞，偶爾站著、發呆、坐、趴（趴比較久）、伸懶腰，偶爾才跑一下，跑完趴下來、發呆或改成走路 */
export const NATURE: DogNature = {
  speed: { walk: 0.3, sniff: 0.18, run: 2.4 },
  reach: { walk: [0.8, 4], sniff: [0.5, 2.5], run: [3, 8] },
  stop: 0.8,
  again: 0.15,
  stays: { sniff: 0.5, stand: 0.1, idle: 0.11, sit: 0.09, lie: 0.1, stretch: 0.1 },
  run: 0.04,
  nose: 0.4,
  cross: 0.1,
  crossRun: 0.5,
  drink: 0.06,
  crossWalk: 12,
  afterRun: { lie: 0.35, idle: 0.3, walk: 0.35 },
  stretchAfterRest: 0.4,
  chin: 0.5,
  glance: 0.6,
  sleep: { day: 0.03, night: 0.6 },
  night: [22, 9],
  nap: [240_000, 600_000],
  tail: { sniff: 0.5, walk: 0.3, stand: 0.35, idle: 0.7, sit: 0.6, lie: 0.75, sleep: 1, drink: 0.4 },
  last: { stand: [1500, 3500], sniff: [2000, 5000], idle: [3500, 8500], sit: [6000, 14000], lie: [15000, 35000] },
};
/** 這一段走多快 */
export const speedOf = (s: DogSeg, nature: DogNature = NATURE): number => nature.speed[s.do === 'run' ? 'run' : s.nose ? 'sniff' : 'walk'];
/** 轉身多久、點了坐多久、伸懶腰多久、喝水多久 */
const TURN_MS = 450;
const PET_MS = 6000;
/** 點了只轉頭看你：看多久 */
const GLANCE_MS = 2600;
const STRETCH_MS = 3400;
/** 睡覺：被點了多久站起來（捲起來的身體慢慢打開） */
const WAKE_MS = 1600;
const DRINK_MS = 5500;
/** 往南（點了轉過來面向你） */
const SOUTH: Pt = [-1e-5, 0];
/**
 * 原地轉身：轉一點點約 0.35 秒，每多轉 1 度多 5.3 毫秒（轉半圈約 1.25 秒），轉不到 8 度不用踏步；
 * 以後腳附近為支點（在身體中間後面幾公尺，照 size；dog.ts 的後腳在 0.095）
 */
const SPIN_MS = 300;
const SPIN_PER_DEG = 5.3;
const SPIN_MIN = 8;
const PIVOT = 0.08;
/** 被點了先站好要多久（照原本在做什麼；站著、發呆的不用） */
const RISE: Partial<Record<DogDo, number>> = { lie: 900, sit: 600, stretch: 700, drink: 500, sniff: 350, walk: 250, run: 400, stand: 0, idle: 0 };

/** 角度換到 -180～180（轉最少的那一邊） */
const wrap = (deg: number): number => ((((deg % 360) + 540) % 360) - 180);
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

/**
 * 記住每隻狗在做什麼（localStorage 的 dr.dog.<id>，這一段開始的時間存成真正的時刻）：重新整理網頁還在同一個地方，接著做
 * （走到一半的接著走；離開很久了就停在上次那一段的終點）。每換一段記一次
 */
const LS_DOG = 'dr.dog.';
/** performance.now() 的 0 是什麼時刻（換算存起來的時間） */
const origin = (): number => (typeof performance !== 'undefined' && performance.timeOrigin) || 0;
function saveSeg(id: string, s: DogSeg): void {
  try {
    localStorage.setItem(LS_DOG + id, JSON.stringify({ ...s, start: s.start + origin() }));
  } catch {
    // 沒有 localStorage（測試、私密瀏覽）：不記
  }
}
function loadSeg(id: string): DogSeg | null {
  try {
    const v = JSON.parse(localStorage.getItem(LS_DOG + id) ?? 'null') as DogSeg | null;
    const pt = (p: unknown): boolean => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
    if (!v || typeof v.do !== 'string' || !pt(v.from) || !pt(v.to) || !pt(v.dir) || !pt(v.dir0) || !Number.isFinite(v.start) || !(v.ms > 0) || !Number.isInteger(v.ring)) return null;
    // 轉身、站好的資料不對就不管（直接轉過去）
    if (v.turn && !(pt(v.turn) && v.turn[1] > 0)) v.turn = undefined;
    if (v.pose0 && !(Array.isArray(v.pose0.legs) && v.pose0.legs.length === 4 && Number.isFinite(v.rise))) [v.pose0, v.rise] = [undefined, undefined];
    return { ...v, start: v.start - origin() };
  } catch {
    return null;
  }
}

/** 所有的狗（id → 狗）：畫面上的 data-dog 找得到是哪一隻 */
const DOGS = new Map<string, Dog>();
export const dogById = (id: string): Dog | undefined => DOGS.get(id);

/** 一隻狗：id（畫面上的 data-dog）、名字、長相、待的地方、個性 */
export class Dog {
  seg: DogSeg | null = null;
  readonly id: string;
  readonly name: string;
  readonly look: DogLook;
  readonly yard: DogYard;
  readonly nature: DogNature;
  /** performance.now() 的時間是幾點（小數，照手機、電腦的時間；測試可以換） */
  readonly hour: (t: number) => number;
  constructor(o: { id: string; name: string; look: DogLook; yard: DogYard; nature?: DogNature; hour?: (t: number) => number }) {
    [this.id, this.name, this.look, this.yard, this.nature] = [o.id, o.name, o.look, o.yard, o.nature ?? NATURE];
    this.hour =
      o.hour ??
      ((t) => {
        const d = new Date(Date.now() - performance.now() + t);
        return d.getHours() + d.getMinutes() / 60;
      });
    DOGS.set(this.id, this);
    // 上次在哪、在做什麼（重新整理網頁還在同一個地方）
    this.seg = loadSeg(this.id);
  }

  /** 換到新的一段（記起來） */
  private set(s: DogSeg): DogSeg {
    if (this.seg?.start !== s.start || this.seg?.ms !== s.ms || this.seg?.do !== s.do) saveSeg(this.id, s);
    return (this.seg = s);
  }

  /** 換到隨機一塊草皮的隨機一處，站著，面向隨機的方向 */
  place(rand: () => number = Math.random, now = performance.now()): DogSeg {
    const got = this.yard.anywhere(rand) ?? { ring: 0, at: [0, 0] as Pt };
    const a = rand() * 2 * Math.PI;
    const dir: Pt = [Math.cos(a) * 1e-5, Math.sin(a) * 1e-5];
    return this.set({ do: 'stand', from: got.at, to: got.at, start: now, ms: 1500 + rand() * 2500, dir0: dir, dir, ring: got.ring });
  }

  /** 現在在哪、在做什麼（這一段已經過了 e 毫秒）；還沒放就先放，很久沒看（分頁在背景）從停下來的地方重新開始 */
  now(now = performance.now(), rand: () => number = Math.random): { at: Pt; seg: DogSeg; e: number } {
    let s = this.seg ?? this.place(rand, now);
    if (now - (s.start + s.ms) > 60_000) s = { ...s, do: 'stand', from: s.to, to: s.to, start: now, ms: 2000, dir0: s.dir, goal: undefined, back: undefined, via: undefined, turn: undefined, pose0: undefined, rise: undefined };
    while (now >= s.start + s.ms) s = this.next(s, rand);
    this.set(s);
    const e = now - s.start;
    // 原地轉身的照轉到哪（繞著後腳，從 from 慢慢到 to）
    const u = s.turn ? turned(s, e) : clamp01(e / s.ms);
    return { at: [s.from[0] + (s.to[0] - s.from[0]) * u, s.from[1] + (s.to[1] - s.from[1]) * u], seg: s, e };
  }

  /** 點了只轉頭看你：什麼時候開始、看多久（不記起來） */
  glance: { start: number; ms: number } | null = null;

  /** 轉頭看你看到哪（0 沒有～1 頭轉過來了；頭尾 0.35 秒慢慢轉） */
  glancing(now = performance.now()): number {
    const g = this.glance;
    if (!g) return 0;
    const t = now - g.start;
    if (t >= g.ms || t < 0) {
      this.glance = null;
      return 0;
    }
    return smooth(Math.max(0, Math.min(1, t / 350, (g.ms - t) / 350)));
  }

  /** 點了：睡覺的話醒過來（慢慢站起來、伸懶腰）；有時候（照個性）只轉頭看你、繼續做原本的事，其他時候轉過來面向你（往南）坐下；已經坐著就再多坐一下 */
  pet(now = performance.now(), rand: () => number = Math.random): void {
    const d = this.now(now);
    if (d.seg.do === 'sleep') {
      if (d.e < d.seg.ms - WAKE_MS) this.set({ ...d.seg, ms: d.e + WAKE_MS });
      return;
    }
    if (d.seg.pet && d.e < d.seg.ms - 600) {
      this.set({ ...d.seg, ms: Math.max(d.seg.ms, d.e + PET_MS) });
      return;
    }
    if (rand() < this.nature.glance) {
      this.glance = { start: now, ms: GLANCE_MS };
      return;
    }
    // 轉過來坐下：先站好（趴著、坐著先站起來，低著頭的先抬起來），頭先轉過來、身體跟著一步一步踏著轉（以後腳附近為支點），轉好了才坐下；
    // 正在轉頭看你的話頭慢慢轉回去，接著轉身
    const g = this.glance;
    if (g) g.ms = Math.min(g.ms, now - g.start + 350);
    const rise = RISE[d.seg.do] ?? 300;
    const dir0 = this.facing(d.seg, d.e, d.at);
    const { to, turn } = this.spin(d.at, dir0, SOUTH, rise * 0.7);
    this.set({
      ...d.seg,
      do: 'sit',
      from: d.at,
      to,
      start: now,
      ms: PET_MS + (turn ? turn[0] + turn[1] : rise),
      dir0,
      dir: SOUTH,
      pet: true,
      tail0: tailNow(d.seg, d.e),
      tail: 0,
      goal: undefined,
      back: undefined,
      via: undefined,
      turn,
      pose0: rise ? dogPose(d.seg, d.e) : undefined,
      rise: rise || undefined,
    });
  }

  /** 緯經度的方向在這裡是哪個方位（度，順時針、0 是北；照這裡的公尺，緯度、經度一度不一樣長） */
  private bearing(at: Pt, dir: Pt): number {
    const [my, mx] = [this.yard.metres(at, [at[0] + 1e-4, at[1]]), this.yard.metres(at, [at[0], at[1] + 1e-4])];
    return (Math.atan2(dir[1] * mx, dir[0] * my) * 180) / Math.PI;
  }

  /** 從 at 往 deg 方位走 m 公尺 */
  private offset(at: Pt, deg: number, m: number): Pt {
    const [my, mx] = [this.yard.metres(at, [at[0] + 1e-4, at[1]]) / 1e-4 || 1, this.yard.metres(at, [at[0], at[1] + 1e-4]) / 1e-4 || 1];
    const r = (deg * Math.PI) / 180;
    return [at[0] + (Math.cos(r) * m) / my, at[1] + (Math.sin(r) * m) / mx];
  }

  /** 現在身體面向哪（緯經度的方向；轉身轉到一半的照轉到哪） */
  private facing(s: DogSeg, e: number, at: Pt): Pt {
    const t = turned(s, e);
    if (t >= 1) return s.dir;
    const b0 = this.bearing(at, s.dir0);
    const p = this.offset(at, b0 + wrap(this.bearing(at, s.dir) - b0) * t, 1);
    return [p[0] - at[0], p[1] - at[1]];
  }

  /** 原地從面向 dir0 轉到 dir（begin 毫秒開始，轉越多越久）：以後腳附近為支點，轉完站在哪；轉一點點的不用踏步 */
  private spin(at: Pt, dir0: Pt, dir: Pt, begin: number): { to: Pt; turn?: [number, number] } {
    const b0 = this.bearing(at, dir0);
    const deg = wrap(this.bearing(at, dir) - b0);
    if (Math.abs(deg) < SPIN_MIN) return { to: at };
    const r = PIVOT * this.look.size;
    return { to: this.offset(this.offset(at, b0, -r), b0 + deg, r), turn: [begin, SPIN_MS + Math.abs(deg) * SPIN_PER_DEG] };
  }

  /** 這一段的尾巴（照個性）：跑步、伸懶腰時翹著；聞的時候一半垂下來，走路、站著有時候垂下來，坐著、趴著多半垂在後面 */
  private tailFor(how: DogDo, rand: () => number): number {
    return rand() < (this.nature.tail[how] ?? 0) ? 1 : 0;
  }

  /** 下一段：走完多半停下來聞一聞（有時候站著、坐下），停完多半再走（四成邊走邊聞，偶爾跑）；都在同一塊草皮裡 */
  private next(s: DogSeg, rand: () => number): DogSeg {
    const seg = this.step(s, rand);
    // 照步道走的下一段：尾巴照舊
    const on = !!s.via?.length && seg.do === s.do;
    return { ...seg, tail0: s.tail ?? 0, tail: on ? (s.tail ?? 0) : this.tailFor(seg.do, rand) };
  }

  /** 照轉折點走（走路或跑步）：第一段走到 path[0]，接著的放在 via；extra 是要一起帶著的（換草皮、去喝水） */
  private legs(how: 'walk' | 'run', at: Pt, path: Pt[], start: number, dir0: Pt, ring: number, extra: Partial<DogSeg> = {}): DogSeg {
    const [to, ...via] = path;
    const seg: DogSeg = { do: how, from: at, to, start, ms: 0, dir0, dir: [to[0] - at[0], to[1] - at[1]], ring, ...extra, via };
    return { ...seg, ms: (Math.max(0.2, this.yard.metres(at, to)) / speedOf(seg, this.nature)) * 1000 };
  }

  private step(s: DogSeg, rand: () => number): DogSeg {
    const [at, start, dir0] = [s.to, s.start + s.ms, s.dir];
    const N = this.nature;
    const speedOf_ = (x: DogSeg): number => speedOf(x, N);
    // 照步道走：接著走到下一個轉折點
    if (s.via?.length && (s.do === 'walk' || s.do === 'run')) {
      const { cross, goal, face, back, nose } = s;
      return this.legs(s.do, at, s.via, start, dir0, s.ring, { cross, goal, face, back, nose });
    }
    // 走到湖邊了：一步一步轉向水，低頭喝；喝完照原路走回去
    if (s.goal === 'drink' && s.face) {
      const dir: Pt = [s.face[0] - at[0], s.face[1] - at[1]];
      const { to, turn } = this.spin(at, dir0, dir, 0);
      return { do: 'drink', from: at, to, start, ms: DRINK_MS + (turn?.[1] ?? 0), dir0, dir, ring: s.ring, back: s.back, turn };
    }
    if (s.do === 'drink' && s.back?.length) return this.legs('walk', at, s.back, start, dir0, s.ring);
    const moving = s.do === 'walk' || s.do === 'run';
    const h = this.hour(start);
    const night = N.night[0] > N.night[1] ? h >= N.night[0] || h < N.night[1] : h >= N.night[0] && h < N.night[1];
    const stay = (how: DogDo): DogSeg => {
      const [lo, hi] = how === 'sleep' ? N.nap : (N.last[how] ?? [1500, 3500]);
      // 晚上一睡就睡到早上（至少 10 分鐘），白天打個盹
      const toMorning = (((N.night[1] - h) % 24) + 24) % 24;
      const ms = how === 'stretch' ? STRETCH_MS : how === 'sleep' && night ? Math.max(600_000, toMorning * 3_600_000) : lo + rand() * (hi - lo);
      return { do: how, from: at, to: at, start, ms, dir0, dir: dir0, ring: s.ring, ...(how === 'lie' && rand() < N.chin ? { rest: true } : {}) };
    };
    // 睡醒一定伸個懶腰；坐完、趴完常常伸個懶腰
    if (s.do === 'sleep') return stay('stretch');
    if ((s.do === 'sit' || s.do === 'lie') && rand() < N.stretchAfterRest) return stay('stretch');
    // 跑完照個性：趴下來休息、停下來發呆，或改成走路（不再跑、不換草皮）
    let walkOn = false;
    if (s.do === 'run') {
      const after = Object.entries(N.afterRun) as Array<['lie' | 'idle' | 'walk', number]>;
      let r = rand() * after.reduce((a, [, w]) => a + w, 0);
      const how = (after.find(([, w]) => (r -= w) < 0) ?? after[after.length - 1])[0];
      if (how === 'walk') walkOn = true;
      else return stay(how);
    }
    if (!walkOn && rand() < (moving ? N.stop : N.again)) {
      // 照權重抽停下來做什麼（晚上比較常睡覺）
      const ways = Object.entries({ ...N.stays, sleep: night ? N.sleep.night : N.sleep.day }) as Array<[DogDo, number]>;
      let r = rand() * ways.reduce((a, [, w]) => a + w, 0);
      return stay((ways.find(([, w]) => (r -= w) < 0) ?? ways[ways.length - 1])[0]);
    }
    /** 照轉折點走多遠 */
    const along = (path: Pt[]): number => path.reduce((m, p, i) => m + this.yard.metres(i ? path[i - 1] : at, p), 0);
    // 去附近的湖邊喝水（照步道走過去）：遠的用跑的，喝完照原路走回來
    if (!walkOn && this.yard.water && rand() < N.drink) {
      const w = this.yard.water(at, rand);
      if (w) {
        const back = [...w.path.slice(0, -1).reverse(), at];
        return this.legs(along(w.path) > N.crossWalk || rand() < 0.4 ? 'run' : 'walk', at, w.path, start, dir0, s.ring, { goal: 'drink', face: w.face, back });
      }
    }
    // 照步道走到附近另一塊草皮：照個性一部分用跑的
    if (!walkOn && rand() < N.cross) {
      const o = this.yard.elsewhere(s.ring, at, rand);
      if (o) return this.legs(rand() < N.crossRun ? 'run' : 'walk', at, o.path, start, dir0, o.ring, { cross: true });
    }
    const run = !walkOn && rand() < N.run;
    const nose = !run && !walkOn && rand() < N.nose;
    const [lo, hi] = N.reach[run ? 'run' : nose ? 'sniff' : 'walk'];
    // 在草皮裡走：直直走過去要走得到（不穿過建築、廣場）
    let best: { to: Pt; m: number } | null = null;
    let detour: Pt | null = null;
    for (let i = 0; i < 12; i++) {
      const to = this.yard.within(s.ring, rand);
      if (!to) break;
      if (this.yard.canWalk && !this.yard.canWalk(at, to)) {
        detour ??= to;
        continue;
      }
      const m = this.yard.metres(at, to);
      if (m >= lo && m <= hi) {
        best = { to, m };
        break;
      }
      if (m >= 0.3 && (!best || Math.abs(m - hi) < Math.abs(best.m - hi))) best = { to, m };
    }
    if (!best) {
      // 不在草皮上直直走不到（例如走到一半被點了坐在步道上）：照步道走回草皮
      const path = detour && this.yard.route ? this.yard.route(at, detour) : null;
      if (path) return this.legs('walk', at, path, start, dir0, s.ring);
      return { do: 'sniff', from: at, to: at, start, ms: 2500, dir0, dir: dir0, ring: s.ring };
    }
    // 走太遠的只走一段（走到一半停下來聞）
    const to: Pt = best.m > hi ? [at[0] + ((best.to[0] - at[0]) * hi) / best.m, at[1] + ((best.to[1] - at[1]) * hi) / best.m] : best.to;
    const m = Math.min(best.m, hi);
    const seg: DogSeg = { do: run ? 'run' : 'walk', from: at, to, start, ms: 0, dir0, dir: [to[0] - at[0], to[1] - at[1]], ring: s.ring, ...(nose ? { nose } : {}) };
    return { ...seg, ms: (m / speedOf_(seg)) * 1000 };
  }
}

/** 0～1 頭尾慢 */
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** 身體轉到哪（0 還是 dir0～1 轉到 dir）：原地轉身照 turn，其他的一開始 0.45 秒轉過去（走路、跑步邊走邊轉） */
const turned = (s: DogSeg, e: number): number => smooth(clamp01(s.turn ? (e - s.turn[0]) / s.turn[1] : e / TURN_MS));
/** 什麼時候站好、轉好了（毫秒；之後才坐下、低頭喝水） */
const settled = (s: DogSeg): number => (s.turn ? s.turn[0] + s.turn[1] : (s.rise ?? 0));

/** 尾巴現在放下來多少（每一段一開始 0.6 秒慢慢放下或翹起來） */
const tailNow = (s: DogSeg, e: number): number => {
  const [a, b] = [s.tail0 ?? 0, s.tail ?? 0];
  return a + (b - a) * smooth(Math.max(0, Math.min(1, e / 600)));
};

/**
 * 這一段的姿勢（已經過了 e 毫秒）：
 * - 走路：四隻腳輪流（左後、左前、右後、右前各差四分之一步），往前擺時抬起來；邊走邊聞的走得慢、頭低下去左右聞；
 * - 跑步：兩隻前腳一起往前伸、兩隻後腳一起往後蹬（身體拉長、離地），再一起收到肚子下面；身體前後搖、上下彈，耳朵往後飛，吐舌頭；
 * - 聞：身體前面往下、頭低到鼻子湊到地上，左右慢慢聞；坐下一開始坐下最後站起來（不吐舌頭）；站著搖尾巴；
 * - 伸懶腰（下犬式）：兩隻前腳往前伸、貼在地上，身體前面往下壓（胸口貼地）、屁股翹高、後腳直直的，頭抬起來看前面、尾巴搖，停一下再站起來；
 * - 喝水：身體前面往下、頭低到水面，頭一點一點、舌頭一伸一縮地舔；
 * - 趴著：身體整個貼地，前腳往前伸平、後腳收在兩側，頭抬著看看四周（下巴靠在前腳上休息的閉著眼睛），最後站起來；
 * - 睡覺：慢慢趴下、身體捲成一圈（頭靠到尾巴旁邊，前腳收在胸口下面），閉上眼睛，身體跟著呼吸慢慢起伏；醒來慢慢打開、站起來；
 * - 發呆：站著一動也不動，頭低一點、慢慢轉去盯著旁邊某個方向（每一段左邊或右邊），尾巴不搖，慢慢眨眼；
 * - 尾巴有時候垂下來（每一段決定，tailFor），一開始慢慢放下或翹起來；平常每 4 秒左右眨一下眼睛；站著、走路時畫嘴唇線；
 * - 被點了：從原本的姿勢慢慢站好（pose0、rise），原地轉身時（turn，身體要轉 deg 度，順時針是正的）頭先轉過去、四隻腳一步一步踏著轉
 */
export function dogPose(s: DogSeg, e: number, deg = 0): DogPose {
  let p = motion(s, e);
  if (s.pose0 && s.rise && e < s.rise) p = blend(s.pose0, p, smooth(clamp01(e / s.rise)));
  if (s.turn && Math.abs(deg) >= 1) p = spinning(p, s.turn, e, deg);
  // 眨眼：每 4 秒左右一下（每一段的節奏錯開一點）
  const blink = (e + (s.start % 1700)) % 4100 < 140 ? 1 : 0;
  // 嘴唇線只在站著（包括發呆）、走路時畫
  return { ...p, tail: tailNow(s, e), blink: Math.max(p.blink, blink), lips: s.do === 'stand' || s.do === 'idle' || s.do === 'walk' };
}

/** 從姿勢 a 慢慢變成 b（t 0～1） */
function blend(a: DogPose, b: DogPose, t: number): DogPose {
  const m = (x: number | undefined, y: number): number => (x ?? 0) + (y - (x ?? 0)) * t;
  return {
    ...b,
    legs: b.legs.map(([deg, lift], i): [number, number] => [m(a.legs[i]?.[0], deg), m(a.legs[i]?.[1], lift)]),
    bob: m(a.bob, b.bob),
    sit: m(a.sit, b.sit),
    lean: m(a.lean, b.lean),
    nod: m(a.nod, b.nod),
    look: m(a.look, b.look),
    ear: m(a.ear, b.ear),
    wag: m(a.wag, b.wag),
    lie: m(a.lie, b.lie),
    blink: m(a.blink, b.blink),
    curl: m(a.curl, b.curl),
    tongue: t < 0.5 ? !!a.tongue : b.tongue,
  };
}

/**
 * 原地轉身（turn：幾毫秒開始轉、轉多久，身體要轉 deg 度，順時針是正的）：
 * 頭先轉過去（比身體早、快一點，脖子最多轉 80 度），身體跟著轉；轉的時候四隻腳一隻一隻抬起來踏一步（每轉 60 度左右四隻腳各踏一步，
 * 往右轉右前腳先踏，往左轉左前腳先踏，前腳踏比較大步、後腳在原地小步），身體跟著腳步輕輕上下
 */
function spinning(p: DogPose, [t0, ms]: [number, number], e: number, deg: number): DogPose {
  const tau = (e - t0) / ms;
  // 頭：身體開始轉前 0.2 就開始轉（不早於被點的時候），身體轉到 0.35 時頭已經轉好
  const h0 = Math.max(0, t0 - 0.2 * ms);
  if (e <= h0 || tau >= 1) return p;
  const head = smooth(clamp01((e - h0) / (t0 + 0.35 * ms - h0)));
  const look = p.look + Math.max(-80, Math.min(80, -(head - smooth(clamp01(tau))) * deg));
  const legs = p.legs.map((l): [number, number] => [l[0], l[1]]);
  let bob = p.bob;
  if (tau > 0) {
    // 腳的順序（0 左前、1 右前、2 左後、3 右後）：對角輪流
    const order = deg > 0 ? [1, 2, 0, 3] : [0, 3, 1, 2];
    const beats = 4 * Math.max(1, Math.round(Math.abs(deg) / 60));
    for (let j = 0; j < beats; j++) {
      // 第 j 步：1/(beats+1) 開始，踏 1.8 拍（前一步還沒踩下去下一步就抬起來）
      const q = (tau - j / (beats + 1)) / (1.8 / (beats + 1));
      if (q <= 0 || q >= 1) continue;
      const i = order[j % 4];
      const up = Math.sin(Math.PI * q);
      legs[i] = [legs[i][0] + (i < 2 ? 12 : 5) * up, Math.max(legs[i][1], (i < 2 ? 0.022 : 0.012) * up)];
      bob = Math.max(bob, 0.002 * up);
    }
  }
  return { ...p, look, legs, bob };
}

/** 尾巴以外的動作 */
function motion(s: DogSeg, e: number): DogPose {
  const ramp = (r: number, from = 0): number => smooth(Math.max(0, Math.min(1, (e - from) / r, (s.ms - e) / r)));
  const wave = (ms: number, off = 0): number => Math.sin(2 * Math.PI * (e / ms - off));
  switch (s.do) {
    case 'walk': {
      const ms = s.nose ? 950 : 750;
      const leg = (off: number): [number, number] => {
        const t = 2 * Math.PI * (e / ms - off);
        return [16 * Math.sin(t), 0.018 * Math.max(0, Math.cos(t))];
      };
      const sniff = s.nose ? ramp(400) : 0;
      return {
        ...STILL,
        legs: [leg(0.25), leg(0.75), leg(0), leg(0.5)],
        bob: 0.003 * Math.abs(wave(ms / 2)),
        nod: (38 + 4 * wave(500)) * sniff + 3 * wave(ms / 2) * (1 - sniff),
        lean: 8 * sniff,
        look: 8 * wave(1700) * sniff,
        wag: 10 * wave(ms),
      };
    }
    case 'run': {
      const ms = 260;
      const t = (off: number): number => 2 * Math.PI * (e / ms - off);
      const front = (off: number): [number, number] => [42 * Math.sin(t(off)), 0.05 * Math.max(0, Math.cos(t(off)))];
      const hind = (off: number): [number, number] => [-42 * Math.sin(t(off)), 0.05 * Math.max(0, -Math.cos(t(off)))];
      return {
        ...STILL,
        legs: [front(0), front(0.07), hind(0.05), hind(0.12)],
        bob: 0.008 + 0.03 * Math.max(0, Math.sin(t(0))),
        lean: 7 * Math.cos(t(0)),
        nod: 6 - 6 * Math.cos(t(0)),
        ear: 40,
        wag: 6 * wave(ms),
        tongue: true,
      };
    }
    case 'sniff': {
      const r = ramp(450);
      return { ...STILL, nod: (50 + 4 * wave(380)) * r, lean: 12 * r, look: 12 * wave(1800) * r, wag: 6 * wave(900) };
    }
    case 'sit':
      // 被點的：站好、轉好了才坐下
      return { ...STILL, sit: ramp(550, s.pet ? Math.max(0, settled(s) - 100) : 0), wag: 12 * wave(650) };
    case 'sleep': {
      const r = ramp(1500);
      const shut = smooth(Math.max(0, Math.min(1, (e - 1100) / 800, (s.ms - e - 300) / 500)));
      return { ...STILL, legs: [[-46 * r, -0.2 * r], [-42 * r, -0.2 * r], [0, 0], [0, 0]], lie: r, curl: r, nod: 10 * r, blink: shut, bob: 0.004 * Math.sin((2 * Math.PI * e) / 4200) * r };
    }
    case 'idle': {
      const r = ramp(900);
      const side = Math.floor(s.start / 7) % 2 ? 1 : -1;
      // 慢慢眨眼：每 2.6 秒一下，閉上再慢慢張開
      const t = e % 2600;
      const slow = t < 500 ? Math.sin((Math.PI * t) / 500) : 0;
      return { ...STILL, nod: 7 * r, look: 22 * side * r, blink: slow * r };
    }
    case 'lie': {
      const r = ramp(800);
      const rest = s.rest ? smooth(Math.max(0, Math.min(1, (e - 1200) / 900, (s.ms - 900 - e) / 700))) : 0;
      return {
        ...STILL,
        legs: [[80 * r, -0.2 * r], [78 * r, -0.2 * r], [0, 0], [0, 0]],
        lie: r,
        nod: -8 * r + 30 * rest,
        look: 14 * wave(5200) * r * (1 - rest),
        blink: rest,
        wag: 3 * wave(1400) * (1 - rest),
      };
    }
    case 'drink': {
      // 轉向水了才低頭
      const r = ramp(500, settled(s));
      const lap = Math.sin((2 * Math.PI * e) / 300);
      return { ...STILL, lean: 15 * r, nod: (58 + 5 * lap) * r, wag: 8 * wave(800), tongue: r > 0.8 && lap > 0 };
    }
    case 'stretch': {
      const r = ramp(750);
      return { ...STILL, legs: [[74 * r, -0.2 * r], [72 * r, -0.2 * r], [-8 * r, 0], [-8 * r, 0]], lean: 27 * r, nod: -20 * r, wag: 14 * wave(500) * r };
    }
    default:
      return { ...STILL, wag: 14 * wave(900) };
  }
}

/** 這一段在畫面上：起點、終點（像素），一開始、轉到面向哪（度，順時針、0 是上），每公尺幾像素，這一段從什麼時候開始 */
export interface DogPath {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  b0: number;
  b1: number;
  k: number;
  start: number;
}
export const pathAttr = (p: DogPath): string => [p.ax, p.ay, p.bx, p.by, p.b0, p.b1, p.k].map((v) => +v.toFixed(2)).join(' ') + ` ${p.start}`;
const pathOf = (attr: string): DogPath => {
  const [ax, ay, bx, by, b0, b1, k, start] = attr.split(' ').map(Number);
  return { ax, ay, bx, by, b0, b1, k, start };
};

/** 點得到的範圍（至少 DOG_HIT 像素半徑） */
const DOG_HIT = 16;

/**
 * 轉頭看你：頭要往左轉幾度（dog.ts 的 look）才看向畫面下方（你在的地方）；yaw 是牠在畫面上面向哪邊（順時針、0 是往上、180 是朝你），
 * 脖子最多轉 80 度（背對你就從肩膀回頭看）
 */
export function lookAtViewer(yaw: number): number {
  const rel = ((((180 - yaw) % 360) + 540) % 360) - 180;
  return Math.max(-80, Math.min(80, -rel)) || 0;
}

/** 狗在畫面上這一格：在哪（像素）、面向哪（扣掉指北針轉的角度）、點得到的範圍、3D 的狗（點了轉頭看你的話頭轉過來、抬起來） */
function frame(dog: Dog, d: { seg: DogSeg; e: number }, p: DogPath, heading: number, now = performance.now()): { x: number; y: number; hit: [number, number, number]; svg: string } {
  const s = d.seg;
  const t = turned(s, d.e);
  const turn = wrap(p.b1 - p.b0);
  let [x, y] = [p.ax, p.ay];
  if (s.do === 'walk' || s.do === 'run') {
    const u = clamp01(d.e / s.ms);
    [x, y] = [p.ax + (p.bx - p.ax) * u, p.ay + (p.by - p.ay) * u];
  } else if (s.turn && t > 0) {
    // 原地轉身：繞著後腳附近轉（支點在一開始身體中間的後面），轉到最後剛好在 to
    const r = PIVOT * dog.look.size * p.k;
    const fwd = (b: number): Pt => [Math.sin((b * Math.PI) / 180), -Math.cos((b * Math.PI) / 180)];
    const [f0, f1, f] = [fwd(p.b0), fwd(p.b1), fwd(p.b0 + turn * t)];
    const [cx, cy] = [p.ax - r * f0[0], p.ay - r * f0[1]];
    [x, y] = [cx + r * f[0] + (p.bx - cx - r * f1[0]) * t, cy + r * f[1] + (p.by - cy - r * f1[1]) * t];
  }
  const yaw = p.b0 + turn * t - heading;
  const h = dogHeight(dog.look) * p.k;
  let pose = dogPose(s, d.e, turn);
  const g = dog.glancing(now);
  if (g > 0) pose = { ...pose, look: pose.look * (1 - g) + lookAtViewer(yaw) * g, nod: pose.nod * (1 - g) - 6 * g, blink: g > 0.9 ? 0 : pose.blink };
  return { x, y, hit: [x, y - h * 0.5, Math.max(DOG_HIT, h * 0.7)], svg: dogSvg(dog.look, pose, yaw, p.k) };
}

/**
 * 整隻狗的 SVG（畫面像素）：外面一層照指北針轉回來（data-at、data-flip="no"，radar.ts 的 standUp；之後每一格 animateDogs 自己轉），
 * 點得到的圓（dog-hit，每一格只移動，不換掉，點的時候按下、放開是同一個）、3D 的狗（dog-body，每一格換掉）
 */
export function dogMarkup(dog: Dog, d: { seg: DogSeg; e: number }, p: DogPath, heading: number): string {
  const f = frame(dog, d, p, heading);
  const n = (v: number): string => v.toFixed(1);
  return (
    `<g class="woof-dog full ${d.seg.do}" data-dog="${dog.id}" data-path="${pathAttr(p)}" data-at="${n(f.x)} ${n(f.y)}" data-flip="no">` +
    `<circle class="dog-hit" cx="${n(f.hit[0])}" cy="${n(f.hit[1])}" r="${n(f.hit[2])}" /><g class="dog-body" transform="translate(${n(f.x)} ${n(f.y)})">${f.svg}</g></g>`
  );
}

/** 這一段結束時重畫整層（main.ts 給：重畫汪星）、指北針轉了幾度 */
let redraw: (() => void) | null = null;
let headingOf: () => number = () => 0;
export function onDogMove(r: () => void, heading?: () => number): void {
  redraw = r;
  if (heading) headingOf = heading;
}
export const dogHeading = (): number => headingOf();

/** 最早結束的那一段結束時重畫（還沒畫出整隻、只是一個點時，點靠 CSS 移動） */
let timer: ReturnType<typeof setTimeout> | undefined;
let wakeAt = Infinity;
export function wakeDogs(at: number, now: number): void {
  if (!redraw || at >= wakeAt) return;
  clearTimeout(timer);
  wakeAt = at;
  timer = setTimeout(() => {
    wakeAt = Infinity;
    redraw?.();
  }, Math.max(0, at - now) + 30);
}

/** 畫面上有整隻的狗：每一格重畫（照這一段在畫面上的起點、終點走過去，轉身、擺腳、搖尾巴），換下一段時重畫整層；都沒有就停 */
let raf = 0;
export function animateDogs(): void {
  if (raf || typeof requestAnimationFrame !== 'function') return;
  raf = requestAnimationFrame(tick);
}
/**
 * 畫一格平均要多久（毫秒）、畫面平均隔多久一格、這一格要不要跳過：
 * 算狗超過 10 毫秒，或整個畫面每格超過 22 毫秒（不到約 45 fps，瀏覽器畫毛畫不完）的慢手機隔一格畫一次
 */
let cost = 0;
let frameGap = 16;
let lastFrame = 0;
let skip = false;
function tick(now: number): void {
  raf = 0;
  const els = document.querySelectorAll<SVGGElement>('.woof-dog[data-path]');
  if (!els.length) {
    lastFrame = 0;
    return;
  }
  if (lastFrame && now - lastFrame < 200) frameGap = frameGap * 0.9 + (now - lastFrame) * 0.1;
  lastFrame = now;
  skip = (cost > 10 || frameGap > 22) && !skip;
  if (skip) {
    animateDogs();
    return;
  }
  const t0 = performance.now();
  const heading = headingOf();
  let stale = false;
  for (const el of els) {
    const dog = DOGS.get(el.dataset.dog ?? '');
    if (!dog) continue;
    const p = pathOf(el.dataset.path ?? '');
    const d = dog.now(now);
    if (Math.abs(d.seg.start - p.start) > 0.5) {
      stale = true;
      continue;
    }
    const f = frame(dog, d, p, heading, now);
    const n = (v: number): string => v.toFixed(1);
    if (heading) el.setAttribute('transform', `rotate(${heading.toFixed(1)} ${n(f.x)} ${n(f.y)})`);
    else el.removeAttribute('transform');
    el.setAttribute('class', `woof-dog full ${d.seg.do}`);
    const hit = el.querySelector('.dog-hit');
    hit?.setAttribute('cx', n(f.hit[0]));
    hit?.setAttribute('cy', n(f.hit[1]));
    const body = el.querySelector('.dog-body');
    if (body) {
      body.setAttribute('transform', `translate(${n(f.x)} ${n(f.y)})`);
      body.innerHTML = f.svg;
    }
  }
  cost = cost * 0.9 + (performance.now() - t0) * 0.1;
  if (stale) redraw?.();
  animateDogs();
}
