/**
 * 3D 的狗（dogs.ts 讓牠動、park.ts 放在汪星的中山公園）：一組橢球（身體、胸、屁股、脖子、頭、嘴巴、耳朵、四隻腳、腳掌、尾巴）
 * 照姿勢（DogPose）擺好，照面向的方向從斜上方（CAM）正射投影到畫面，哪個方向都畫得出來（走向畫面上方看到背、走向你看到臉）。
 * 每個橢球畫成一個橢圓（底色）再長滿一根根的毛：像公園的草，從表面往外長、往下垂、捲一點，照光分亮、中、暗三種顏色，
 * 密密的（照畫面上多大決定幾根，整隻最多約 3000 根，背面的不畫）；遠的先畫（照每個橢球中心的深度）。
 * 眼睛、鼻子、舌頭是貼在頭上的小橢球，轉到另一邊就被頭擋住。
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

/**
 * 使用者的馬爾濟斯（照相簿）：幾乎全白的捲毛（暗的地方也只有一點點米白，耳朵尾端一點點米色），頭和耳朵連成一顆大大圓圓毛茸茸的球，
 * 耳朵垂到下巴旁邊，短短的嘴巴藏在一團圓圓的毛裡，又大又圓的黑眼睛、大大的黑鼻子，腳像穿了毛褲、腳掌圓圓一團，尾巴長毛往上捲
 */
export const MALTESE: DogLook = { name: '馬爾濟斯', size: 1, fur: ['#ffffff', '#fbf9f4', '#ece6db'], ear: '#f8f3ea', hair: 0.024, curl: 1, ears: 'drop', tail: 'plume', muzzle: 0.02 };

/** 頭頂多高（公尺） */
export const dogHeight = (look: DogLook): number => 0.38 * look.size;

/**
 * 姿勢：legs 四隻腳（左前、右前、左後、右後）往前擺幾度、腳抬多高（公尺，負的是往下壓、貼在地上），bob 身體往上幾公尺，sit 坐下多少（0 站著～1 坐好），
 * lean 身體前面往下幾度（跑步時前後搖、聞的時候前面低下去），nod 脖子和頭往下低幾度，look 頭往左轉幾度，
 * ear 耳朵往後飛幾度（跑步），wag 尾巴往左右搖幾度，tongue 吐舌頭
 */
export interface DogPose {
  legs: Array<[number, number]>;
  bob: number;
  sit: number;
  lean: number;
  nod: number;
  look: number;
  ear: number;
  wag: number;
  tongue: boolean;
}
export const STILL: DogPose = { legs: [[0, 0], [0, 0], [0, 0], [0, 0]], bob: 0, sit: 0, lean: 0, nod: 0, look: 0, ear: 0, wag: 0, tongue: false };

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
/** 一個部位：毛多長（0 是沒有毛：眼睛、鼻子）、底色和毛的顏色（亮、中、暗）；bias 是深度往前一點（貼在頭上的眼睛、鼻子畫在頭後面） */
interface Part {
  key: string;
  e: Ell;
  fill: string;
  hair: number;
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
/** 繞一點轉（先 u-w 再 u-v），再交給外面那一層 */
const joint = (outer: Xf, pivot: V, uw: number, uv = 0): Xf => ({
  p: (q) => outer.p(add(rotUV(rotUW(sub(q, pivot), uw), uv), pivot)),
  d: (q) => outer.d(rotUV(rotUW(q, uw), uv)),
});

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
  const earTones: [string, string, string] = [shade(look.ear, 0.6), look.ear, shade(look.ear, -0.05)];
  const sit = pose.sit;
  // 身體繞後腳連到身體的地方轉：坐下前面往上、聞和跑步時前面往下（lean），整個往下坐；走、跑時一上一下
  const P = S([-0.1, 0, 0.16]);
  const drop = sit * 0.07 * s - pose.bob * s;
  const body = joint({ p: (q) => [q[0], q[1], q[2] - drop], d: (q) => q }, P, (sit * 26 - pose.lean) * RAD);
  // 脖子和頭繞肩膀轉：低頭聞（nod，鼻子湊到地上）、左右看（look），坐下時轉回來平平地看
  const neck = joint(body, S([0.09, 0, 0.22]), -(pose.nod + sit * 20) * RAD, pose.look * RAD);
  // 尾巴繞連到屁股的地方左右搖
  const B = S([-0.155, 0, 0.25]);
  const tail = joint(body, B, 0, pose.wag * RAD);
  const H = look.hair;
  const out: Part[] = [];
  const furry = (key: string, e: Ell, hair = H, tones = fur, fill = fur[1]): void => void out.push({ key, e, fill, hair, tones });
  furry('body', move(ell(S([0, 0, 0.205]), 0.135 * s, 0.096 * s, 0.08 * s), body));
  furry('rump', move(ell(S([-0.095, 0, 0.205]), 0.078 * s, 0.093 * s, 0.082 * s), body));
  furry('chest', move(ell(S([0.09, 0, 0.2]), 0.08 * s, 0.096 * s, 0.092 * s), body), H * 1.15);
  furry('neck', move(ell(S([0.13, 0, 0.255]), 0.05 * s, 0.06 * s, 0.066 * s), neck));
  // 頭（大大圓圓、毛茸茸）、嘴巴（短短的，藏在毛裡）、鼻子、眼睛（又大又圓的黑眼睛、一點反光，下面淡淡的淚痕）、舌頭
  const Hc = S([0.175, 0, 0.292]);
  const rH = 0.081 * s;
  furry('head', move(ell(Hc, 0.079 * s, 0.085 * s, 0.079 * s), neck), H * 0.95);
  const mu = look.muzzle + 0.006;
  const M = add(Hc, S([0.058 + look.muzzle * 0.5, 0, -0.026]));
  furry('muzzle', move(ell(M, mu * s, 0.038 * s, 0.029 * s), neck), H * 0.55);
  const solid = (key: string, e: Ell, fill: string, bias = 0.004): void => void out.push({ key, e, fill, hair: 0, tones: [fill, fill, fill], bias: bias * s });
  solid('nose', move(ell(add(M, S([mu * 0.95, 0, 0.01])), 0.013 * s, 0.016 * s, 0.012 * s), neck), '#1d1a17');
  if (pose.tongue) solid('tongue', move(ell(add(M, S([mu * 0.55, 0, -0.026])), 0.013 * s, 0.011 * s, 0.005 * s), neck), '#e8828c', 0.002);
  for (const side of [1, -1]) {
    const n = norm([0.86, 0.4 * side, 0.2]);
    const t1 = norm(cross(n, [0, 0, 1]));
    const t2 = cross(n, t1);
    const eye = add(Hc, mul(n, rH * 0.98));
    const disc = (c: V, r: number): Ell => ({ c, a: [mul(n, 0.003 * s), mul(t1, r * s), mul(t2, r * s)] });
    solid(`stain${side}`, move(disc(add(eye, S([0, 0, -0.016])), 0.007), neck), '#f1e6d2', 0.003);
    solid(`eye${side}`, move(disc(eye, 0.02), neck), '#1d1a17', 0.006);
    solid(`shine${side}`, move(disc(add(add(eye, mul(t2, -0.008 * s)), mul(n, 0.002 * s)), 0.0055), neck), '#ffffff', 0.009);
  }
  // 耳朵：又寬又長、垂到下巴下面（跑步時往後飛），或豎起來的
  for (const side of [1, -1]) {
    if (look.ears === 'drop') {
      // 寬寬的、垂到下巴旁邊，下面往外張開一點（跟頭連成一顆圓球，正面看把臉框起來）
      const c = add(Hc, S([-0.015, 0.078 * side, -0.035]));
      const ear = joint(neck, add(c, S([0, 0, 0.06])), -pose.ear * RAD);
      furry(`ear${side}`, move({ c, a: [[0.042 * s, 0, 0], [0, 0.032 * s, 0], [0, 0.016 * s * side, 0.068 * s]] }, ear), H * 1.2, earTones, look.ear);
    } else furry(`ear${side}`, move(ell(add(Hc, S([-0.005, 0.042 * side, 0.072])), 0.02 * s, 0.012 * s, 0.045 * s), neck), H * 0.5, earTones, look.ear);
  }
  // 尾巴：一串長毛往上捲過背，或直直往後翹
  const knots: Array<[V, number]> =
    look.tail === 'plume'
      ? [[[-0.02, 0, 0.04], 0.03], [[0, 0, 0.085], 0.036], [[0.04, 0, 0.105], 0.034]]
      : [[[-0.035, 0, 0.02], 0.016], [[-0.07, 0, 0.045], 0.014]];
  knots.forEach(([q, r], i) => furry(`tail${i}`, move(ell(add(B, S(q)), r * s, r * s, r * s), tail), H * 1.4));
  // 腳（像穿了毛褲）：照姿勢前後擺、抬起來；坐下時前腳直直撐著地、後腳往前折，屁股旁邊一團大腿
  const legR = 0.032 * s;
  const hips: Array<[number, number, boolean]> = [[0.09, 0.05, true], [0.09, -0.05, true], [-0.095, 0.052, false], [-0.095, -0.052, false]];
  hips.forEach(([u, v, front], i) => {
    const [deg, lift] = pose.legs[i] ?? [0, 0];
    const hip = body.p(S([u, v, 0.16]));
    const th = deg * RAD;
    // 腳從連到身體的地方到地上；往前伸很多時（伸懶腰）照腳的長度伸出去，腳往下壓（lift 是負的）就貼在地上
    const L = Math.max(0.02 * s, hip[2], 0.17 * s * Math.abs(Math.sin(th)));
    const step: V = [hip[0] + L * Math.sin(th), hip[1], Math.max(0, hip[2] - L * Math.cos(th) + lift * s)];
    const sat: V = [hip[0] + (front ? 0.015 : 0.1) * s, hip[1], 0];
    const foot = mix(step, sat, sit);
    const end: V = [foot[0], foot[1], foot[2] + 0.02 * s];
    const dir = sub(end, hip);
    const len = Math.hypot(...dir);
    const a1 = mul(dir, 0.5 + legR / (len || 1));
    const a3 = mul(norm(cross(dir, [0, 1, 0])), legR);
    const key = `leg${front ? 'f' : 'h'}${v > 0 ? 'l' : 'r'}`;
    furry(key, { c: mix(hip, end, 0.5), a: [a1, [0, legR, 0], a3] }, H * 0.7);
    furry(`${key}paw`, ell(add(foot, S([0.01, 0, 0.02])), 0.04 * s, 0.035 * s, 0.022 * s), H * 0.5);
    if (!front && sit > 0.05) furry(`${key}thigh`, ell(add(hip, S([0.015, v > 0 ? 0.03 : -0.03, -0.012])), 0.075 * s * sit, 0.045 * s * sit, 0.062 * s * sit), H * 0.8);
  });
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
type Hair = { s: V; curl: number; len: number };
const roots = new Map<string, Hair[]>();
function hairsOf(key: string, n: number): Hair[] {
  const had = roots.get(key) ?? [];
  if (had.length >= n) return had;
  let seed = 7;
  for (const ch of key) seed = Math.imul(seed ^ ch.charCodeAt(0), 2654435761);
  const r = mulberry(seed);
  const list: Hair[] = [];
  // 從頭重抽（同一個 seed，前面的跟原來一樣），抽到夠多
  const want = Math.max(n, had.length * 2, 64);
  for (let i = 0; i < want; i++) {
    const z = r() * 2 - 1;
    const t = r() * 2 * Math.PI;
    const q = Math.sqrt(1 - z * z);
    list.push({ s: [q * Math.cos(t), q * Math.sin(t), z], curl: r() * 2 - 1, len: 0.7 + r() * 0.5 });
  }
  roots.set(key, list);
  return list;
}
/** 橢球的表面積（Knud Thomsen 近似） */
function area(e: Ell): number {
  const [a, b, c] = e.a.map((x) => Math.hypot(...x));
  const p = 1.6;
  return 4 * Math.PI * (((a * b) ** p + (a * c) ** p + (b * c) ** p) / 3) ** (1 / p);
}
/** 整隻最多幾根毛（背面的不畫，畫出來的大約一半） */
const MAX_HAIRS = 3000;

/**
 * 畫一隻狗（SVG，單位是畫面像素，(0, 0) 是腳下的地上、往下是正的）：yaw 是牠在畫面上面向哪邊（順時針、0 是往畫面上方走），
 * k 是每公尺幾像素。毛長滿整個身體：畫面上小的時候約每 1.6 像素一根，拉近時整隻最多 MAX_HAIRS 根（毛間距跟著變大，毛比間距長很多，還是蓋滿）
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
  const all = parts(look, pose);
  const furred = all.filter((p) => p.hair > 0);
  const total = furred.reduce((sum, p) => sum + area(p.e), 0);
  // 毛根的間距（公尺）：畫面上 1.6 像素，整隻最多 MAX_HAIRS 根
  const gap = Math.max(1.6 / k, Math.sqrt(total / MAX_HAIRS));
  const w = Math.max(0.4, Math.min(2, 0.006 * k));
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
  const items = all.map((p) => {
    let svg = oval(p.e, p.fill);
    if (p.hair > 0) {
      // 一根根的毛：從表面往外長、往下垂、捲一點，背對看的人的不畫，照光分三種顏色
      const d = ['', '', ''];
      const r2 = p.e.a.map((ax) => dot(ax, ax));
      const n = Math.ceil(area(p.e) / (gap * gap));
      const hs = hairsOf(p.key, n);
      for (let i = 0; i < n; i++) {
        const h = hs[i];
        const root = add(p.e.c, add(add(mul(p.e.a[0], h.s[0]), mul(p.e.a[1], h.s[1])), mul(p.e.a[2], h.s[2])));
        const nr = norm(add(add(mul(p.e.a[0], h.s[0] / r2[0]), mul(p.e.a[1], h.s[1] / r2[1])), mul(p.e.a[2], h.s[2] / r2[2])));
        const nv = view(nr);
        if (nv[2] < -0.25) continue;
        const L = dot(nv, LIGHT);
        const tone = L > 0.2 ? 0 : L > -0.55 ? 1 : 2;
        const len = p.hair * h.len;
        const side = norm(Math.abs(nr[2]) > 0.95 ? cross(nr, [1, 0, 0]) : cross(nr, [0, 0, 1]));
        // 捲的毛彎成 C 字（往旁邊彎），直的毛往外長再往下垂
        const a = view(sub(root, mul(nr, len * 0.25)));
        const ctl = view(add(add(root, mul(nr, len * (0.6 + 0.3 * look.curl))), mul(side, len * look.curl * 0.9 * h.curl)));
        const tip = view(add(add(root, mul(nr, len * (0.65 - 0.25 * look.curl))), [0, 0, -len * (0.45 - 0.15 * look.curl)]));
        d[tone] += `M${f(a[0] * k)} ${f(a[1] * k)}Q${f(ctl[0] * k)} ${f(ctl[1] * k)} ${f(tip[0] * k)} ${f(tip[1] * k)}`;
      }
      // 暗的先畫、亮的蓋在上面
      for (const i of [2, 1, 0]) if (d[i]) svg += `<path d="${d[i]}" fill="none" stroke="${p.tones[i]}" stroke-width="${w.toFixed(2)}" stroke-linecap="round" />`;
    }
    return { d: view(p.e.c)[2] + (p.bias ?? 0), key: p.key, svg };
  });
  items.sort((a, b) => a.d - b.d);
  // 地上的影子（橢圓，跟著身體轉）
  const shadow = oval({ c: [0, 0, 0], a: [[0.21 * look.size, 0, 0], [0, 0.1 * look.size, 0], [0, 0, 0]] }, '#000').replace('<ellipse', '<ellipse class="dog-shadow"');
  return shadow + items.map((it) => `<g data-part="${it.key}">${it.svg}</g>`).join('');
}
