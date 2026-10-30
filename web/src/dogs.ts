/**
 * 會動的狗（dog.ts 畫、park.ts 放在汪星的中山公園；之後可以有很多隻，每隻一個 Dog，長相是 DogLook）：
 * 每隻狗一段一段地動（DogSeg）：stand 站著搖尾巴、sniff 低頭聞一聞（鼻子湊到地上、左右聞）、sit 坐下（坐一下再站起來）、
 * walk 走（四隻腳輪流，有時候邊走邊低頭聞 nose）、run 跑（真的跑：前腳一起伸、後腳一起蹬，偶爾才跑），from 走到 to；
 * 在同一塊草皮裡（DogYard 決定能去哪），大多是走一走、停下來聞一聞，偶爾站著、坐下；點了（pet）轉過來面向你（往南）坐下。
 * 每一段開始時慢慢轉到要走的方向（dir0 → dir，緯經度的方向）。拉近畫出整隻時每一格畫面重畫（animateDogs：照這一段在畫面上從哪到哪、
 * 面向哪邊，用 dog.ts 畫 3D 的狗），這一段結束時重畫整層（onDogMove 給的 redraw，算下一段在畫面上的位置）
 */
import { dogHeight, dogSvg, STILL, type DogLook, type DogPose } from './dog';

type Pt = [number, number];
export type DogDo = 'stand' | 'sniff' | 'sit' | 'walk' | 'run';
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
}

/** 狗待的地方：隨機一塊的隨機一處、這一塊裡隨機一處（抽不到是 null）、兩點差幾公尺（狗走在哪個世界就照那裡的公尺） */
export interface DogYard {
  anywhere(rand: () => number): { ring: number; at: Pt } | null;
  within(ring: number, rand: () => number): Pt | null;
  metres(a: Pt, b: Pt): number;
}

/** 走路、邊走邊聞、跑步多快（公尺／秒），走多遠（公尺） */
export const DOG_SPEED = { walk: 0.3, sniff: 0.18, run: 2.4 };
const REACH = { walk: [0.8, 4], sniff: [0.5, 2.5], run: [4, 20] };
/** 這一段走多快 */
export const speedOf = (s: DogSeg): number => DOG_SPEED[s.do === 'run' ? 'run' : s.nose ? 'sniff' : 'walk'];
/** 轉身多久、點了坐多久 */
const TURN_MS = 450;
const PET_MS = 6000;
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
    if (now - (s.start + s.ms) > 60_000) s = { ...s, do: 'stand', from: s.to, to: s.to, start: now, ms: 2000, dir0: s.dir };
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
    this.seg = { ...d.seg, do: 'sit', from: d.at, to: d.at, start: now, ms: PET_MS, dir0: d.seg.dir, dir: SOUTH, pet: true };
  }

  /** 下一段：走完多半停下來聞一聞（有時候站著、坐下），停完多半再走（四成邊走邊聞，偶爾跑）；都在同一塊草皮裡 */
  private next(s: DogSeg, rand: () => number): DogSeg {
    const [at, start, dir0] = [s.to, s.start + s.ms, s.dir];
    const moving = s.do === 'walk' || s.do === 'run';
    if (rand() < (moving ? 0.8 : 0.15)) {
      const r = rand();
      const how: DogDo = r < 0.65 ? 'sniff' : r < 0.82 ? 'stand' : 'sit';
      const ms = how === 'sit' ? 4000 + rand() * 5000 : how === 'sniff' ? 2000 + rand() * 3000 : 1500 + rand() * 2000;
      return { do: how, from: at, to: at, start, ms, dir0, dir: dir0, ring: s.ring };
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

/**
 * 這一段的姿勢（已經過了 e 毫秒）：
 * - 走路：四隻腳輪流（左後、左前、右後、右前各差四分之一步），往前擺時抬起來；邊走邊聞的走得慢、頭低下去左右聞；
 * - 跑步：兩隻前腳一起往前伸、兩隻後腳一起往後蹬（身體拉長、離地），再一起收到肚子下面；身體前後搖、上下彈，耳朵往後飛，吐舌頭；
 * - 聞：身體前面往下、頭低到鼻子湊到地上，左右慢慢聞；坐下一開始坐下最後站起來；站著搖尾巴
 */
export function dogPose(s: DogSeg, e: number): DogPose {
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
      return { ...STILL, sit: ramp(550, s.pet ? TURN_MS * 0.6 : 0), wag: 12 * wave(650), tongue: !!s.pet };
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
/** 畫一格平均要多久（毫秒）、這一格要不要跳過（畫一格超過 10 毫秒的慢手機隔一格畫一次） */
let cost = 0;
let skip = false;
function tick(now: number): void {
  raf = 0;
  const els = document.querySelectorAll<SVGGElement>('.woof-dog[data-path]');
  if (!els.length) return;
  skip = cost > 10 && !skip;
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
