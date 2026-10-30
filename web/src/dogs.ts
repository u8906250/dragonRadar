/**
 * 會動的狗（dog.ts 畫、park.ts 放在汪星的中山公園；之後可以有很多隻，每隻一個 Dog，長相是 DogLook）：
 * 每隻狗一段一段地動（DogSeg）：stand 站著搖尾巴、sniff 低頭聞一聞（鼻子湊到地上、左右聞）、sit 坐下（坐一下再站起來）、
 * stretch 伸懶腰（下犬式：前腳往前伸、胸口壓低貼地、屁股翹高，停一下再站起來；坐完、趴完常常伸一下）、
 * lie 趴著休息（跑完多半趴下來，平常偶爾也趴；rest 是下巴靠在前腳上、閉眼睛）、
 * walk 走（四隻腳輪流，有時候邊走邊低頭聞 nose）、run 跑（真的跑：前腳一起伸、後腳一起蹬，偶爾才跑），from 走到 to；
 * 大多在同一塊草皮裡走一走、停下來聞一聞，偶爾站著、坐下；有時候經過地面到附近另一塊草皮（大多用跑的，近的才用走的；DogYard 決定能去哪）；
 * 偶爾去附近的湖邊（池塘岸邊）喝水：走或跑到岸上、面向水低頭一口一口舔，喝完走回原來的地方；
 * 點了（pet）轉過來面向你（往南）坐下。
 * 每一段開始時慢慢轉到要走的方向（dir0 → dir，緯經度的方向）。拉近畫出整隻時每一格畫面重畫（animateDogs：照這一段在畫面上從哪到哪、
 * 面向哪邊，用 dog.ts 畫 3D 的狗），這一段結束時重畫整層（onDogMove 給的 redraw，算下一段在畫面上的位置）
 */
import { dogHeight, dogSvg, STILL, type DogLook, type DogPose } from './dog';

type Pt = [number, number];
export type DogDo = 'stand' | 'sniff' | 'sit' | 'lie' | 'stretch' | 'drink' | 'walk' | 'run';
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
  /** 去喝水：走到岸上之後面向哪（水裡的一點）、喝完走回哪裡 */
  goal?: 'drink';
  face?: Pt;
  home?: Pt;
}

/**
 * 狗待的地方：隨機一塊的隨機一處、這一塊裡隨機一處、從這裡到附近另一塊草皮的隨機一處（路上不經過水、建築；抽不到是 null）、
 * 兩點差幾公尺（狗走在哪個世界就照那裡的公尺）
 */
export interface DogYard {
  anywhere(rand: () => number): { ring: number; at: Pt } | null;
  within(ring: number, rand: () => number): Pt | null;
  elsewhere(ring: number, at: Pt, rand: () => number): { ring: number; at: Pt } | null;
  /** 附近的湖邊：站在岸上哪裡、面向水裡哪一點（路上不經過水、建築）；沒有水是 undefined */
  water?(at: Pt, rand: () => number): { at: Pt; face: Pt } | null;
  metres(a: Pt, b: Pt): number;
}

/** 走路、邊走邊聞、跑步多快（公尺／秒），走多遠（公尺） */
export const DOG_SPEED = { walk: 0.3, sniff: 0.18, run: 2.4 };
const REACH = { walk: [0.8, 4], sniff: [0.5, 2.5], run: [4, 20] };
/** 換到另一塊草皮：多常、多遠以內用走的（其他都用跑的） */
const CROSS = 0.15;
const CROSS_WALK_M = 15;
/** 這一段走多快 */
export const speedOf = (s: DogSeg): number => DOG_SPEED[s.do === 'run' ? 'run' : s.nose ? 'sniff' : 'walk'];
/** 轉身多久、點了坐多久、伸懶腰多久、喝水多久、多常去喝水 */
const TURN_MS = 450;
const PET_MS = 6000;
const STRETCH_MS = 3400;
const DRINK_MS = 5500;
const DRINK = 0.06;
/** 往南（點了轉過來面向你） */
const SOUTH: Pt = [-1e-5, 0];

/** 所有的狗（id → 狗）：畫面上的 data-dog 找得到是哪一隻 */
const DOGS = new Map<string, Dog>();
export const dogById = (id: string): Dog | undefined => DOGS.get(id);

export class Dog {
  seg: DogSeg | null = null;
  constructor(
    readonly id: string,
    readonly look: DogLook,
    readonly yard: DogYard,
  ) {
    DOGS.set(id, this);
  }

  /** 換到隨機一塊草皮的隨機一處，站著，面向隨機的方向 */
  place(rand: () => number = Math.random, now = performance.now()): DogSeg {
    const got = this.yard.anywhere(rand) ?? { ring: 0, at: [0, 0] as Pt };
    const a = rand() * 2 * Math.PI;
    const dir: Pt = [Math.cos(a) * 1e-5, Math.sin(a) * 1e-5];
    return (this.seg = { do: 'stand', from: got.at, to: got.at, start: now, ms: 1500 + rand() * 2500, dir0: dir, dir, ring: got.ring });
  }

  /** 現在在哪、在做什麼（這一段已經過了 e 毫秒）；還沒放就先放，很久沒看（分頁在背景）從停下來的地方重新開始 */
  now(now = performance.now(), rand: () => number = Math.random): { at: Pt; seg: DogSeg; e: number } {
    let s = this.seg ?? this.place(rand, now);
    if (now - (s.start + s.ms) > 60_000) s = { ...s, do: 'stand', from: s.to, to: s.to, start: now, ms: 2000, dir0: s.dir, goal: undefined, home: undefined };
    while (now >= s.start + s.ms) s = this.next(s, rand);
    this.seg = s;
    const e = now - s.start;
    const u = Math.max(0, Math.min(1, e / s.ms));
    return { at: [s.from[0] + (s.to[0] - s.from[0]) * u, s.from[1] + (s.to[1] - s.from[1]) * u], seg: s, e };
  }

  /** 點了：轉過來面向你（往南）坐下；已經坐著就再多坐一下 */
  pet(now = performance.now()): void {
    const d = this.now(now);
    if (d.seg.pet && d.e < d.seg.ms - 600) {
      this.seg = { ...d.seg, ms: d.e + PET_MS };
      return;
    }
    this.seg = { ...d.seg, do: 'sit', from: d.at, to: d.at, start: now, ms: PET_MS, dir0: d.seg.dir, dir: SOUTH, pet: true, tail0: tailNow(d.seg, d.e), tail: 0, goal: undefined, home: undefined };
  }

  /** 這一段的尾巴：跑步、伸懶腰時翹著；聞的時候一半垂下來，走路、站著有時候垂下來，坐著多半垂在後面 */
  private static tailFor(how: DogDo, rand: () => number): number {
    const down = { run: 0, stretch: 0, sniff: 0.5, walk: 0.3, stand: 0.35, sit: 0.6, lie: 0.75, drink: 0.4 }[how];
    return rand() < down ? 1 : 0;
  }

  /** 下一段：走完多半停下來聞一聞（有時候站著、坐下），停完多半再走（四成邊走邊聞，偶爾跑）；都在同一塊草皮裡 */
  private next(s: DogSeg, rand: () => number): DogSeg {
    const seg = this.step(s, rand);
    return { ...seg, tail0: s.tail ?? 0, tail: Dog.tailFor(seg.do, rand) };
  }

  private step(s: DogSeg, rand: () => number): DogSeg {
    const [at, start, dir0] = [s.to, s.start + s.ms, s.dir];
    // 走到湖邊了：面向水低頭喝；喝完走回原來的地方
    if (s.goal === 'drink' && s.face) return { do: 'drink', from: at, to: at, start, ms: DRINK_MS, dir0, dir: [s.face[0] - at[0], s.face[1] - at[1]], ring: s.ring, home: s.home };
    if (s.do === 'drink' && s.home) {
      const seg: DogSeg = { do: 'walk', from: at, to: s.home, start, ms: 0, dir0, dir: [s.home[0] - at[0], s.home[1] - at[1]], ring: s.ring };
      return { ...seg, ms: (Math.max(0.3, this.yard.metres(at, s.home)) / speedOf(seg)) * 1000 };
    }
    const moving = s.do === 'walk' || s.do === 'run';
    const stay = (how: DogDo): DogSeg => {
      const long: Partial<Record<DogDo, number>> = { sit: 4000 + rand() * 5000, lie: 7000 + rand() * 9000, sniff: 2000 + rand() * 3000, stretch: STRETCH_MS };
      const ms = long[how] ?? 1500 + rand() * 2000;
      return { do: how, from: at, to: at, start, ms, dir0, dir: dir0, ring: s.ring, ...(how === 'lie' && rand() < 0.5 ? { rest: true } : {}) };
    };
    // 坐完、趴完常常伸個懶腰；跑完多半趴下來休息
    if ((s.do === 'sit' || s.do === 'lie') && rand() < 0.4) return stay('stretch');
    if (s.do === 'run' && rand() < 0.6) return stay('lie');
    if (rand() < (moving ? 0.8 : 0.15)) {
      const r = rand();
      return stay(r < 0.55 ? 'sniff' : r < 0.68 ? 'stand' : r < 0.79 ? 'sit' : r < 0.9 ? 'lie' : 'stretch');
    }
    // 去附近的湖邊喝水：遠的用跑的
    if (this.yard.water && rand() < DRINK) {
      const w = this.yard.water(at, rand);
      if (w) {
        const m = this.yard.metres(at, w.at);
        const seg: DogSeg = { do: m > CROSS_WALK_M || rand() < 0.4 ? 'run' : 'walk', from: at, to: w.at, start, ms: 0, dir0, dir: [w.at[0] - at[0], w.at[1] - at[1]], ring: s.ring, goal: 'drink', face: w.face, home: at };
        return { ...seg, ms: (Math.max(0.3, m) / speedOf(seg)) * 1000 };
      }
    }
    // 經過地面到附近另一塊草皮：大多用跑的，近的偶爾用走的
    if (rand() < CROSS) {
      const o = this.yard.elsewhere(s.ring, at, rand);
      if (o) {
        const m = this.yard.metres(at, o.at);
        const how = m > CROSS_WALK_M || rand() < 0.75 ? 'run' : 'walk';
        const seg: DogSeg = { do: how, from: at, to: o.at, start, ms: 0, dir0, dir: [o.at[0] - at[0], o.at[1] - at[1]], ring: o.ring, cross: true };
        return { ...seg, ms: (m / speedOf(seg)) * 1000 };
      }
    }
    const run = rand() < 0.08;
    const nose = !run && rand() < 0.4;
    const [lo, hi] = REACH[run ? 'run' : nose ? 'sniff' : 'walk'];
    let best: { to: Pt; m: number } | null = null;
    for (let i = 0; i < 12; i++) {
      const to = this.yard.within(s.ring, rand);
      if (!to) break;
      const m = this.yard.metres(at, to);
      if (m >= lo && m <= hi) {
        best = { to, m };
        break;
      }
      if (m >= 0.3 && (!best || Math.abs(m - hi) < Math.abs(best.m - hi))) best = { to, m };
    }
    if (!best) return { do: 'sniff', from: at, to: at, start, ms: 2500, dir0, dir: dir0, ring: s.ring };
    // 走太遠的只走一段（走到一半停下來聞）
    const to: Pt = best.m > hi ? [at[0] + ((best.to[0] - at[0]) * hi) / best.m, at[1] + ((best.to[1] - at[1]) * hi) / best.m] : best.to;
    const m = Math.min(best.m, hi);
    const seg: DogSeg = { do: run ? 'run' : 'walk', from: at, to, start, ms: 0, dir0, dir: [to[0] - at[0], to[1] - at[1]], ring: s.ring, ...(nose ? { nose } : {}) };
    return { ...seg, ms: (m / speedOf(seg)) * 1000 };
  }
}

/** 0～1 頭尾慢 */
const smooth = (t: number): number => t * t * (3 - 2 * t);

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
 * - 尾巴有時候垂下來（每一段決定，tailFor），一開始慢慢放下或翹起來；平常每 4 秒左右眨一下眼睛
 */
export function dogPose(s: DogSeg, e: number): DogPose {
  const p = motion(s, e);
  // 眨眼：每 4 秒左右一下（每一段的節奏錯開一點）
  const blink = (e + (s.start % 1700)) % 4100 < 140 ? 1 : 0;
  return { ...p, tail: tailNow(s, e), blink: Math.max(p.blink, blink) };
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
      return { ...STILL, sit: ramp(550, s.pet ? TURN_MS * 0.6 : 0), wag: 12 * wave(650) };
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
      const r = ramp(500);
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

/** 狗在畫面上這一格：在哪（像素）、面向哪（扣掉指北針轉的角度）、點得到的範圍、3D 的狗 */
function frame(dog: Dog, d: { seg: DogSeg; e: number }, p: DogPath, heading: number): { x: number; y: number; hit: [number, number, number]; svg: string } {
  const s = d.seg;
  const u = s.do === 'walk' || s.do === 'run' ? Math.max(0, Math.min(1, d.e / s.ms)) : 0;
  const [x, y] = [p.ax + (p.bx - p.ax) * u, p.ay + (p.by - p.ay) * u];
  const t = smooth(Math.max(0, Math.min(1, d.e / TURN_MS)));
  const turn = ((((p.b1 - p.b0) % 360) + 540) % 360) - 180;
  const yaw = p.b0 + turn * t - heading;
  const h = dogHeight(dog.look) * p.k;
  return { x, y, hit: [x, y - h * 0.5, Math.max(DOG_HIT, h * 0.7)], svg: dogSvg(dog.look, dogPose(s, d.e), yaw, p.k) };
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
    const f = frame(dog, d, p, heading);
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
