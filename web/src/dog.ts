/**
 * 3D 的狗（dogs.ts 讓牠動、park.ts 放在汪星的中山公園）：一組橢球（身體、胸、屁股、脖子、頭、嘴巴、耳朵、四隻腳、腳掌、尾巴）
 * 照姿勢（DogPose）擺好，照面向的方向從斜上方（CAM）正射投影到畫面，哪個方向都畫得出來（走向畫面上方看到背、走向你看到臉）。
 * 每個橢球畫成一個橢圓（底色）再長出一根根的毛：像公園的草，從表面往外長、往下垂、捲一點，照光分亮、中、暗三種顏色；
 * 遠的先畫（照每個橢球中心的深度）。眼睛、鼻子、舌頭是貼在頭上的小橢球，轉到另一邊就被頭擋住。
 * 單位是公尺，(0, 0, 0) 是四隻腳中間的地上；狗自己的座標 u 往前、v 往左、w 往上。不同的狗只換 DogLook
 */
type V = [number, number, number];

/** 一種狗長什麼樣子（基準是頭頂約 0.37 公尺的小型犬，size 照比例放大） */
export interface DogLook {
  /** 叫什麼（品種） */
  name: string;
  size: number;
  /** 毛色：亮、中（底色）、暗 */
  fur: [string, string, string];
  /** 耳朵的毛色（中），亮、暗照毛色調 */
  ear: string;
  /** 毛多長（公尺）、多捲（0～1） */
  hair: number;
  curl: number;
  /** 耳朵垂下來（drop）或豎起來（prick） */
  ears: 'drop' | 'prick';
  /** 尾巴往上捲過背（plume）或直直往後翹（straight） */
  tail: 'plume' | 'straight';
  /** 嘴巴多長（公尺） */
  muzzle: number;
}

/** 使用者的馬爾濟斯：白色捲捲的長毛、圓圓的頭、垂下來的長耳朵（米白）、短嘴巴、往上捲的蓬蓬尾巴 */
export const MALTESE: DogLook = { name: '馬爾濟斯', size: 1, fur: ['#ffffff', '#f1ece2', '#cdc3b1'], ear: '#efe3cc', hair: 0.03, curl: 0.7, ears: 'drop', tail: 'plume', muzzle: 0.033 };

/** 頭頂多高（公尺） */
export const dogHeight = (look: DogLook): number => 0.37 * look.size;

/**
 * 姿勢：phase 步伐走到哪（0～1 一步）、swing 腳前後擺幾度、bob 身體往上幾公尺、sit 坐下多少（0 站著～1 坐好）、
 * nod 頭往下低幾度、wag 尾巴往左右搖幾度、tongue 吐舌頭
 */
export interface DogPose {
  phase: number;
  swing: number;
  bob: number;
  sit: number;
  nod: number;
  wag: number;
  tongue: boolean;
}
export const STILL: DogPose = { phase: 0, swing: 0, bob: 0, sit: 0, nod: 0, wag: 0, tongue: false };

const RAD = Math.PI / 180;
/** 從水平往下看幾度（跟銅像、火箭差不多，看得到背） */
const CAM = 22 * RAD;
const [CC, CS] = [Math.cos(CAM), Math.sin(CAM)];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => mul(a, 1 / (Math.hypot(...a) || 1));
const mix = (a: V, b: V, t: number): V => add(a, mul(sub(b, a), t));
/** 照光的方向（畫面上：往右、往下、朝看的人）：左上前方 */
const LIGHT = norm([-0.5, -0.7, 0.5]);

/** 橢球：中心、三個互相垂直的半軸 */
interface Ell {
  c: V;
  a: [V, V, V];
}
const ell = (c: V, rx: number, ry: number, rz: number): Ell => ({ c, a: [[rx, 0, 0], [0, ry, 0], [0, 0, rz]] });
/** 一個部位：毛多長、幾根（拉近、整隻夠大時的根數）、底色和毛的顏色（亮、中、暗）；bias 是深度往前一點（貼在頭上的眼睛、鼻子畫在頭後面） */
interface Part {
  key: string;
  e: Ell;
  fill: string;
  hair: number;
  n: number;
  tones: [string, string, string];
  bias?: number;
}

/** 轉動：繞 v 軸（u-w 平面，正的是前面往上）、繞 w 軸（u-v 平面，正的是往左） */
const rotUW = (q: V, ang: number): V => [q[0] * Math.cos(ang) - q[2] * Math.sin(ang), q[1], q[0] * Math.sin(ang) + q[2] * Math.cos(ang)];
const rotUV = (q: V, ang: number): V => [q[0] * Math.cos(ang) - q[1] * Math.sin(ang), q[0] * Math.sin(ang) + q[1] * Math.cos(ang), q[2]];
interface Xf {
  p: (q: V) => V;
  d: (q: V) => V;
}
const move = (e: Ell, x: Xf): Ell => ({ c: x.p(e.c), a: e.a.map(x.d) as [V, V, V] });

/** 調顏色：往白（t > 0）或往暗（t < 0）混 */
function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t)));
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** 照姿勢擺好的部位（狗自己的座標） */
function parts(look: DogLook, pose: DogPose): Part[] {
  const s = look.size;
  const S = (v: V): V => mul(v, s);
  const fur = look.fur;
  const earTones: [string, string, string] = [shade(look.ear, 0.45), look.ear, shade(look.ear, -0.14)];
  const sit = pose.sit;
  // 身體繞後腳連到身體的地方往上轉（坐下），整個往下坐；走、跑時一上一下
  const P = S([-0.1, 0, 0.16]);
  const pitch = sit * 26 * RAD;
  const drop = sit * 0.07 * s - pose.bob * s;
  const body: Xf = {
    p: (q) => {
      const r = add(rotUW(sub(q, P), pitch), P);
      return [r[0], r[1], r[2] - drop];
    },
    d: (q) => rotUW(q, pitch),
  };
  // 頭繞脖子轉：低頭聞（nod），坐下時轉回來平平地看
  const N = S([0.14, 0, 0.26]);
  const headAng = -(pose.nod + sit * 20) * RAD;
  const head: Xf = { p: (q) => body.p(add(rotUW(sub(q, N), headAng), N)), d: (q) => body.d(rotUW(q, headAng)) };
  // 尾巴繞連到屁股的地方左右搖
  const B = S([-0.165, 0, 0.25]);
  const wag = pose.wag * RAD;
  const tail: Xf = { p: (q) => body.p(add(rotUV(sub(q, B), wag), B)), d: (q) => body.d(rotUV(q, wag)) };
  const H = look.hair;
  const out: Part[] = [];
  const furry = (key: string, e: Ell, n: number, hair = H): void => void out.push({ key, e, fill: fur[1], hair, n, tones: fur });
  furry('body', move(ell(S([0, 0, 0.205]), 0.15 * s, 0.085 * s, 0.075 * s), body), 150);
  furry('rump', move(ell(S([-0.105, 0, 0.205]), 0.075 * s, 0.082 * s, 0.078 * s), body), 60);
  furry('chest', move(ell(S([0.1, 0, 0.2]), 0.075 * s, 0.078 * s, 0.085 * s), body), 60);
  furry('neck', move(ell(S([0.14, 0, 0.255]), 0.05 * s, 0.056 * s, 0.065 * s), body), 30);
  // 頭、嘴巴、鼻子、眼睛（大大的黑眼睛、一點反光，下面淡淡的淚痕）、舌頭
  const Hc = S([0.185, 0, 0.3]);
  const rH = 0.069 * s;
  furry('head', move(ell(Hc, 0.067 * s, 0.07 * s, 0.066 * s), head), 100, H * 0.75);
  const M = add(Hc, S([0.028 + look.muzzle, 0, -0.018]));
  furry('muzzle', move(ell(M, look.muzzle * s, 0.03 * s, 0.026 * s), head), 26, H * 0.45);
  const solid = (key: string, e: Ell, fill: string, bias = 0.004): void => void out.push({ key, e, fill, hair: 0, n: 0, tones: [fill, fill, fill], bias: bias * s });
  solid('nose', move(ell(add(M, S([look.muzzle * 0.95, 0, 0.011])), 0.011 * s, 0.013 * s, 0.01 * s), head), '#1d1a17');
  if (pose.tongue) solid('tongue', move(ell(add(M, S([look.muzzle * 0.6, 0, -0.024])), 0.012 * s, 0.01 * s, 0.005 * s), head), '#e8828c', 0.002);
  for (const side of [1, -1]) {
    const n = norm([0.8, 0.45 * side, 0.3]);
    const t1 = norm(cross(n, [0, 0, 1]));
    const t2 = cross(n, t1);
    const eye = add(Hc, mul(n, rH * 0.97));
    const disc = (c: V, r: number): Ell => ({ c, a: [mul(n, 0.003 * s), mul(t1, r * s), mul(t2, r * s)] });
    solid(`stain${side}`, move(disc(add(eye, S([0, 0, -0.014])), 0.008), head), '#e6d2b0', 0.003);
    solid(`eye${side}`, move(disc(eye, 0.0145), head), '#1d1a17', 0.006);
    solid(`shine${side}`, move(disc(add(add(eye, mul(t2, -0.006 * s)), mul(n, 0.002 * s)), 0.0045), head), '#ffffff', 0.009);
  }
  // 耳朵：垂下來毛茸茸的長耳朵，或豎起來的
  for (const side of [1, -1]) {
    const e = look.ears === 'drop' ? ell(add(Hc, S([-0.015, 0.064 * side, -0.035])), 0.03 * s, 0.022 * s, 0.072 * s) : ell(add(Hc, S([-0.005, 0.04 * side, 0.07])), 0.02 * s, 0.012 * s, 0.045 * s);
    out.push({ key: `ear${side}`, e: move(e, head), fill: look.ear, hair: H * 0.9, n: 40, tones: earTones });
  }
  // 尾巴：一串蓬蓬的毛往上捲過背，或直直往後翹
  const knots: Array<[V, number]> =
    look.tail === 'plume'
      ? [[[-0.02, 0, 0.035], 0.028], [[-0.005, 0, 0.075], 0.032], [[0.035, 0, 0.095], 0.03]]
      : [[[-0.035, 0, 0.02], 0.016], [[-0.07, 0, 0.045], 0.014]];
  knots.forEach(([q, r], i) => furry(`tail${i}`, move(ell(add(B, S(q)), r * s, r * s, r * s), tail), 26, H * 1.1));
  // 腳：站著、走路時照步伐前後擺（對角的兩隻一起），坐下時前腳直直撐著地、後腳往前折，屁股旁邊一團大腿
  const legR = 0.029 * s;
  const sw = Math.sin(pose.phase * 2 * Math.PI) * pose.swing * RAD;
  for (const [u, v, pair, front] of [[0.1, 0.048, 1, true], [0.1, -0.048, -1, true], [-0.105, 0.05, -1, false], [-0.105, -0.05, 1, false]] as Array<[number, number, number, boolean]>) {
    const hip = body.p(S([u, v, 0.16]));
    const L = Math.max(0.02 * s, hip[2]);
    const th = sw * pair;
    const walk: V = [hip[0] + L * Math.sin(th), hip[1], Math.max(0, hip[2] - L * Math.cos(th))];
    const sat: V = [hip[0] + (front ? 0.015 : 0.1) * s, hip[1], 0];
    const foot = mix(walk, sat, sit);
    const top = foot[2] + 0.018 * s;
    const end: V = [foot[0], foot[1], top];
    const dir = sub(end, hip);
    const len = Math.hypot(...dir);
    const a1 = mul(dir, 0.5 + legR / (len || 1));
    const a3 = mul(norm(cross(dir, [0, 1, 0])), legR);
    const key = `leg${u > 0 ? 'f' : 'h'}${v > 0 ? 'l' : 'r'}`;
    furry(key, { c: mix(hip, end, 0.5), a: [a1, [0, legR, 0], a3] }, 24, H * 0.6);
    furry(`${key}paw`, ell(add(foot, S([0.01, 0, 0.018])), 0.036 * s, 0.03 * s, 0.02 * s), 12, H * 0.4);
    if (!front && sit > 0.05) furry(`${key}thigh`, ell(add(hip, S([0.015, v > 0 ? 0.03 : -0.03, -0.012])), 0.075 * s * sit, 0.045 * s * sit, 0.062 * s * sit), 34, H * 0.8);
  }
  return out;
}

/** 固定的亂數（同一根毛每一格都在同一個地方） */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 每個部位的毛長在哪（單位球上隨機的方向，取前幾根還是平均分布）、捲的方向、長短 */
const roots = new Map<string, Array<{ s: V; curl: number; len: number }>>();
function hairsOf(key: string, n: number): Array<{ s: V; curl: number; len: number }> {
  const had = roots.get(key);
  if (had && had.length >= n) return had;
  let seed = 7;
  for (const ch of key) seed = Math.imul(seed ^ ch.charCodeAt(0), 2654435761);
  const r = mulberry(seed);
  const list = Array.from({ length: Math.max(n, 160) }, () => {
    const z = r() * 2 - 1;
    const t = r() * 2 * Math.PI;
    const q = Math.sqrt(1 - z * z);
    return { s: [q * Math.cos(t), q * Math.sin(t), z] as V, curl: r() * 2 - 1, len: 0.7 + r() * 0.5 };
  });
  roots.set(key, list);
  return list;
}

/**
 * 畫一隻狗（SVG，單位是畫面像素，(0, 0) 是腳下的地上、往下是正的）：yaw 是牠在畫面上面向哪邊（順時針、0 是往畫面上方走），
 * k 是每公尺幾像素；毛的根數照整隻在畫面上多大（小的時候少畫一點）
 */
export function dogSvg(look: DogLook, pose: DogPose, yaw: number, k: number): string {
  const [cy, sy] = [Math.cos(yaw * RAD), Math.sin(yaw * RAD)];
  /** 狗的座標 → 畫面（往右、往下，公尺）和朝看的人的深度 */
  const view = (q: V): V => {
    const X = q[0] * sy - q[1] * cy;
    const Y = q[0] * cy + q[1] * sy;
    return [X, -(q[2] * CC + Y * CS), -Y * CC + q[2] * CS];
  };
  const f = (v: number): string => v.toFixed(1);
  const dense = Math.max(0.12, Math.min(1, (dogHeight(look) * k) / 110));
  const w = Math.max(0.35, Math.min(1.8, 0.0055 * k));
  /** 橢球投影到畫面是橢圓：半軸投影後的 2×2 形狀矩陣分解成兩個半徑和轉角 */
  const oval = (e: Ell, fill: string): string => {
    const c = view(e.c);
    let [a, b, d] = [0, 0, 0];
    for (const ax of e.a) {
      const p = view(ax);
      a += p[0] * p[0];
      b += p[0] * p[1];
      d += p[1] * p[1];
    }
    const m = (a + d) / 2;
    const r = Math.sqrt(((a - d) / 2) ** 2 + b * b);
    const ang = (0.5 * Math.atan2(2 * b, a - d)) / RAD;
    const [rx, ry] = [Math.sqrt(m + r) * k, Math.sqrt(Math.max(0, m - r)) * k];
    if (rx < 0.05) return '';
    return `<ellipse cx="${f(c[0] * k)}" cy="${f(c[1] * k)}" rx="${f(rx)}" ry="${f(Math.max(0.05, ry))}" transform="rotate(${ang.toFixed(1)} ${f(c[0] * k)} ${f(c[1] * k)})" fill="${fill}" />`;
  };
  const items = parts(look, pose).map((p) => {
    let svg = oval(p.e, p.fill);
    if (p.hair > 0) {
      // 一根根的毛：從表面往外長、往下垂、捲一點，背對看的人的不畫，照光分三種顏色
      const d = ['', '', ''];
      const r2 = p.e.a.map((ax) => dot(ax, ax));
      for (const h of hairsOf(p.key, p.n).slice(0, Math.ceil(p.n * dense))) {
        const root = add(p.e.c, add(add(mul(p.e.a[0], h.s[0]), mul(p.e.a[1], h.s[1])), mul(p.e.a[2], h.s[2])));
        const n = norm(add(add(mul(p.e.a[0], h.s[0] / r2[0]), mul(p.e.a[1], h.s[1] / r2[1])), mul(p.e.a[2], h.s[2] / r2[2])));
        const nv = view(n);
        if (nv[2] < -0.2) continue;
        const L = dot(nv, LIGHT);
        const tone = L > 0.45 ? 0 : L > 0 ? 1 : 2;
        const len = p.hair * h.len;
        const side = norm(Math.abs(n[2]) > 0.95 ? cross(n, [1, 0, 0]) : cross(n, [0, 0, 1]));
        const a = view(sub(root, mul(n, len * 0.2)));
        const ctl = view(add(add(root, mul(n, len * 0.65)), mul(side, len * look.curl * 0.6 * h.curl)));
        const tip = view(add(add(root, mul(n, len * 0.7)), [0, 0, -len * 0.45]));
        d[tone] += `M${f(a[0] * k)} ${f(a[1] * k)}Q${f(ctl[0] * k)} ${f(ctl[1] * k)} ${f(tip[0] * k)} ${f(tip[1] * k)}`;
      }
      d.forEach((path, i) => {
        if (path) svg += `<path d="${path}" fill="none" stroke="${p.tones[i]}" stroke-width="${w.toFixed(2)}" stroke-linecap="round" />`;
      });
    }
    return { d: view(p.e.c)[2] + (p.bias ?? 0), key: p.key, svg };
  });
  items.sort((a, b) => a.d - b.d);
  // 地上的影子（橢圓，跟著身體轉）
  const shadow = oval({ c: [0, 0, 0], a: [[0.21 * look.size, 0, 0], [0, 0.1 * look.size, 0], [0, 0, 0]] }, '#000').replace('<ellipse', '<ellipse class="dog-shadow"');
  return shadow + items.map((it) => `<g data-part="${it.key}">${it.svg}</g>`).join('');
}
