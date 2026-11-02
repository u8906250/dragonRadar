/**
 * 3D 的中山公園（「3D 國館」，第一人稱走走看；測試中，只有存了管理 token 的瀏覽器看得到）：
 * 照雷達同一份資料（zhongshan.ts：OpenStreetMap 的範圍、草地、步道、水面、橋、建築，正射影像判讀的樹冠、屋頂顏色、橋寬、映池石頭邊、旗台）
 * 蓋出來，平面的位置都是真的；高度大多沒有資料，是估的（下面的常數註明哪些是估的，找到資料再改）。
 * 記得上次站哪、面向哪（這個瀏覽器的 dr.park3d），下次接著走；第一次（或那裡現在站不到）從左下（西南角，光復南路那邊）的入口進去，面向南邊那條步道往東。
 * 電腦：拖曳轉頭、WASD 或方向鍵走路（Shift 快走）；手機：左下的搖桿走路、拖曳畫面轉頭。人走得到哪裡照 park.ts 的 personOk
 * （公園裡、不進建築、不下水，橋上可以），樹幹也擋。
 * 小法也在：跟汪星同一隻（PARK_DOGS，同一個時間在同一個地方做同一件事），用 dog.ts 同一組橢球照姿勢擺出來，毛畫成撐胖一點的橢球。
 * 標記（右上「標記」打開）：選種類（路燈、長椅、垃圾桶、其他），點地面放一個，可以轉方向、寫備註，按「儲存」存到伺服器
 * （/api/admin/park-marks，只有管理 token 能讀寫）；點已經標的可以移動、轉向、改備註、刪除。
 * three.js 只在打開時才載入（main.ts 用 import()），平常的雷達不會變大
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { deleteParkMark, fetchParkMarks, saveParkMark, type ParkMark, type ParkMarkIn, type ParkMarkKind } from './api';
import { dogParts } from './dog';
import { dogPose, dogTurned } from './dogs';
import { PARK_DOGS, personOk } from './park';
import { ZHONGSHAN_PARK as Z } from './zhongshan';

type Pt = [number, number];

/** 公尺座標的原點（跟 park.ts 走路的一樣）：x 往東、z 往南（北是 -z）、y 往上 */
const O: Pt = [25.0394, 121.5596];
const MY = 110_574;
const MX = 111_320 * Math.cos((O[0] * Math.PI) / 180);
/** 台北的經緯度 → 公尺（東、北） */
const en = ([lat, lng]: Pt): Pt => [(lng - O[1]) * MX, (lat - O[0]) * MY];
/** 公尺（東、北）→ 台北的經緯度 */
const ll = (e: number, n: number): Pt => [O[0] + n / MY, O[1] + e / MX];

// 高度、寬度（公尺）：國父紀念館高 30.4 公尺、每邊 100 公尺是公開的資料；橋寬、映池石頭邊的寬是正射影像量的；其他都是估的
const HALL_TOP = 30.4;
/** 紀念館屋簷多高（估的） */
const HALL_EAVE = 13;
/** 紀念館的牆從屋頂外框往內縮多少（屋簷、走廊，估的） */
const HALL_WALL_IN = 4;
/** 一般建築、很小的（短邊不到 2 公尺的柱子、小亭）多高（估的） */
const HOUSE_H = 4;
const SMALL_H = 2.6;
/** 翠湖小島上的亭子：柱子多高、屋頂尖多高（估的） */
const PAVILION_EAVE = 2.8;
const PAVILION_TOP = 4.6;
/** 旗桿多高（估的，跟雷達一樣）、旗台多高（估的）；台座兩層（跟雷達一樣，估的） */
const FLAG_POLE_H = 15;
const FLAG_BASE_H = 0.3;
/** 映池那一圈石頭邊：寬（量的）、多高（估的：坐的高度），水面多高（估的） */
const RIM_W = 1.35;
const RIM_H = 0.45;
const POOL_WATER = 0.2;
/** 翠湖的水面、岸多深（估的） */
const LAKE_WATER = -0.35;
const BANK_DEPTH = 0.7;
/** 橋：寬（量的）、橋面多高、欄杆多高（估的） */
const BRIDGE_W = 2.6;
const BRIDGE_TOP = 0.3;
const RAIL_H = 0.9;
/**
 * 外圍一圈（公園外框，入口 Z.gates 斷開）：淺灰色的水泥矮牆，上面黑色的鐵欄杆（照使用者給的南邊步道照片：上下兩道橫桿、
 * 一根根尖頭的直桿、下面一帶一圈圈的花紋，每一片中間一根粗一點、頂上圓頭的柱子）；高度、寬度看照片估的
 */
const WALL_H = 0.5;
const WALL_T = 0.3;
const FENCE_H = 1.0;
const FENCE_PANEL = 2.4;
/** 步道寬（估的；OSM 只有中線） */
const PATH_W = 2;
/** 樹多高（估的：照樹冠大小，最高 20 公尺）、樹幹多粗 */
const treeH = (r: number): number => Math.min(20, 2.5 + 1.9 * r);
const trunkR = (r: number): number => Math.max(0.1, Math.min(0.4, r * 0.06));
/**
 * 標記畫出來的樣子照使用者給的公園照片（南邊那條步道）：路燈是黑色的細燈桿（底下一段粗一點的座），上面方形、上寬下窄的白玻璃燈箱，
 * 黑色的框和尖頂蓋、頂上一顆小圓頭；長椅（第二張照片看得清楚）是一整塊淺灰色、細細點點的花崗石，側面看像一張椅子：前面坐的地方、
 * 後面圓圓往上翹的靠背，底下往內收成比較窄的腳（BENCH_PROFILE 沿著長邊拉長）。大小是看照片估的：路燈約 4 公尺高，長椅約 1.6 公尺長
 */
const LAMP_POLE_H = 3.3;
const BENCH_LEN = 1.6;
/** 石椅的側面（往後、往上，公尺；前面是 -）：從腳的前面往後繞一圈 */
const BENCH_PROFILE: Pt[] = [
  [-0.07, 0], [0.11, 0], [0.19, 0.14], [0.25, 0.34], [0.27, 0.55], [0.25, 0.71], [0.19, 0.79], [0.12, 0.79], [0.07, 0.73],
  [0.04, 0.6], [0.0, 0.49], [-0.07, 0.44], [-0.19, 0.43], [-0.26, 0.41], [-0.29, 0.37], [-0.27, 0.31], [-0.2, 0.22], [-0.12, 0.1],
];

/** 眼睛多高、走多快（公尺／秒，比真的走路快一點；Shift 快走 2.5 倍）、點地面最遠多遠 */
const EYE = 1.6;
const WALK = 2.2;
/** 轉頭多快：方向鍵左右每秒最多幾弧度（約 52 度，按下去 TURN_RAMP_S 秒慢慢加速）、拖曳左右每像素幾弧度（上下看照 LOOK_DRAG） */
const TURN_KEY = 0.9;
const TURN_RAMP_S = 0.35;
const TURN_DRAG = 0.0028;
const LOOK_DRAG = 0.0045;
const FAST = 2.5;
const TAP_MAX_M = 150;

const KIND_NAME: Record<ParkMarkKind, string> = { lamp: '路燈', bench: '長椅', bin: '垃圾桶', other: '其他' };
const KINDS = Object.keys(KIND_NAME) as ParkMarkKind[];

/** 一圈經緯度在不在裡面（公尺座標，射線法） */
function inside([x, y]: Pt, r: Pt[]): boolean {
  let o = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) o = !o;
  }
  return o;
}

/** 一圈往內縮 d 公尺（每個角照兩邊往內平移後的交點，太尖的角最多縮 3 倍） */
function inset(r: Pt[], d: number): Pt[] {
  const n = r.length;
  const area = r.reduce((s, [x, y], i) => s + x * r[(i + 1) % n][1] - r[(i + 1) % n][0] * y, 0);
  // 逆時針時左手邊是裡面
  const k = area > 0 ? 1 : -1;
  const nrm = (u: Pt, v: Pt): Pt => {
    const [dx, dy] = [v[0] - u[0], v[1] - u[1]];
    const l = Math.hypot(dx, dy) || 1;
    return [(-dy / l) * k, (dx / l) * k];
  };
  return r.map((p, i) => {
    const [n1, n2] = [nrm(r[(i + n - 1) % n], p), nrm(p, r[(i + 1) % n])];
    const c = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    let [mx, my] = [((n1[0] + n2[0]) * d) / (c || 1), ((n1[1] + n2[1]) * d) / (c || 1)];
    const l = Math.hypot(mx, my);
    if (l > 3 * d) [mx, my] = [(mx / l) * 3 * d, (my / l) * 3 * d];
    return [p[0] + mx, p[1] + my];
  });
}

/** 去掉重複的最後一點（OSM 的圈頭尾一樣） */
const open = (r: Pt[]): Pt[] => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r);
const ringEN = (r: Pt[]): Pt[] => open(r).map(en);

function shapeOf(ring: Pt[], holes: Pt[][] = []): THREE.Shape {
  const s = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return s;
}
/** 平平的一塊（公尺座標的圈）放在 y 高 */
function flatGeo(shapes: THREE.Shape[], y: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shapes);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}
/** 一圈往上長 h（從 y0 開始）：上面、側面兩種材質 */
function prismGeo(shape: THREE.Shape, y0: number, h: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}
/** 一條線兩邊各 w/2 的帶子（頭尾各多 w/2，轉角接起來），放在 y 高 */
function stripGeo(lines: Pt[][], w: number, y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const l of lines)
    for (let i = 1; i < l.length; i++) {
      const [a, b] = [l[i - 1], l[i]];
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      const [ux, uy] = [dx / len, dy / len];
      const [nx, ny] = [-uy * (w / 2), ux * (w / 2)];
      const [ex, ey] = [ux * (w / 2), uy * (w / 2)];
      const p0: Pt = [a[0] - ex, a[1] - ey];
      const p1: Pt = [b[0] + ex, b[1] + ey];
      const q = [
        [p0[0] + nx, p0[1] + ny],
        [p0[0] - nx, p0[1] - ny],
        [p1[0] - nx, p1[1] - ny],
        [p1[0] + nx, p1[1] + ny],
      ];
      for (const k of [0, 1, 2, 0, 2, 3]) pos.push(q[k][0], y, -q[k][1]);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
/** 一圈的牆（從 y0 到 y1，往裡、往外都看得到） */
function wallGeo(ring: Pt[], y0: number, y1: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
    const q = [
      [a[0], y0, -a[1]],
      [b[0], y0, -b[1]],
      [b[0], y1, -b[1]],
      [a[0], y1, -a[1]],
    ];
    for (const k of [0, 1, 2, 0, 2, 3]) pos.push(...q[k]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * 屋頂：從外框（屋簷高 y0）斜斜往上接到中間的長方形（平頂，高 y1；長方形縮成一點就是尖的）。
 * 外框每一點接到長方形上最近的一點，經過長方形的角時補一塊三角形（角上就是斜脊）。c 是長方形中心（公尺），ax 是長方形的方向（單位向量），a、b 是半寬
 */
function roofGeo(ring: Pt[], c: Pt, ax: Pt, a: number, b: number, y0: number, y1: number): THREE.BufferGeometry {
  const ay: Pt = [-ax[1], ax[0]];
  const st = ([x, y]: Pt): Pt => [(x - c[0]) * ax[0] + (y - c[1]) * ax[1], (x - c[0]) * ay[0] + (y - c[1]) * ay[1]];
  const xy = ([s, t]: Pt): Pt => [c[0] + s * ax[0] + t * ay[0], c[1] + s * ax[1] + t * ay[1]];
  const clamp = ([s, t]: Pt): Pt => [Math.max(-a, Math.min(a, s)), Math.max(-b, Math.min(b, t))];
  /** 在長方形的哪幾邊上（'s+'、's-'、't+'、't-'） */
  const sides = ([s, t]: Pt): string[] => [...(s >= a - 1e-6 ? ['s+'] : []), ...(s <= -a + 1e-6 ? ['s-'] : []), ...(t >= b - 1e-6 ? ['t+'] : []), ...(t <= -b + 1e-6 ? ['t-'] : [])];
  const pos: number[] = [];
  const tri = (p: number[], q: number[], r: number[]): void => void pos.push(...p, ...q, ...r);
  const lo = (p: Pt): number[] => [p[0], y0, -p[1]];
  const hi = (p: Pt): number[] => {
    const q = xy(p);
    return [q[0], y1, -q[1]];
  };
  for (let i = 0; i < ring.length; i++) {
    const [p, q] = [ring[i], ring[(i + 1) % ring.length]];
    const [cp, cq] = [clamp(st(p)), clamp(st(q))];
    const [sp, sq] = [sides(cp), sides(cq)];
    tri(lo(p), lo(q), hi(cq));
    if (a === 0 && b === 0) continue;
    if (sp.some((x) => sq.includes(x))) tri(lo(p), hi(cq), hi(cp));
    else {
      // 經過長方形的一個角：角在 cp、cq 各自那一邊的交點
      const corner: Pt = [sp.includes('s+') || sq.includes('s+') ? a : -a, sp.includes('t+') || sq.includes('t+') ? b : -b];
      tri(lo(p), hi(cq), hi(corner));
      tri(lo(p), hi(corner), hi(cp));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** 長方形四個角（公尺座標）的中心、方向、半寬 */
function rectOf(r: Pt[]): { c: Pt; ax: Pt; a: number; b: number } {
  const c: Pt = [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
  const [dx, dy] = [r[1][0] - r[0][0], r[1][1] - r[0][1]];
  const l = Math.hypot(dx, dy) || 1;
  const ax: Pt = [dx / l, dy / l];
  const ay: Pt = [-ax[1], ax[0]];
  const ss = r.map(([x, y]) => (x - c[0]) * ax[0] + (y - c[1]) * ax[1]);
  const ts = r.map(([x, y]) => (x - c[0]) * ay[0] + (y - c[1]) * ay[1]);
  return { c, ax, a: (Math.max(...ss) - Math.min(...ss)) / 2, b: (Math.max(...ts) - Math.min(...ts)) / 2 };
}

/** 照編號固定的亂數（0～1） */
const hash = (i: number): number => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export interface Park3DOptions {
  /** 管理 token（讀寫標記） */
  token: string;
  onExit: () => void;
}

/**
 * 一開始站的地方：左下（西南角）的入口——公園南邊那條步道（OSM）從光復南路那邊進來、穿過公園外框的地方往裡面一點，
 * 面向步道往裡面走的方向（東南東）
 */
const START: Pt = [25.0381268, 121.5577984];
const START_HEADING = 109;
/** 上次在 3D 國館站哪、面向哪（localStorage 的 dr.park3d，只記在這個瀏覽器；每 2 秒有動就記一次、離開時記）；讀不到、現在站不到就從入口開始 */
const LS_SPOT = 'dr.park3d';
function loadSpot(): { at: Pt; yaw: number; pitch: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LS_SPOT) ?? 'null') as { lat?: unknown; lng?: unknown; yaw?: unknown; pitch?: unknown } | null;
    if (v && [v.lat, v.lng, v.yaw, v.pitch].every((x) => typeof x === 'number' && Number.isFinite(x))) return { at: [v.lat as number, v.lng as number], yaw: v.yaw as number, pitch: v.pitch as number };
  } catch {
    /* 沒有 localStorage（隱私模式）就從入口開始 */
  }
  return null;
}
function saveSpot(at: Pt, yaw: number, pitch: number): void {
  try {
    localStorage.setItem(LS_SPOT, JSON.stringify({ lat: +at[0].toFixed(7), lng: +at[1].toFixed(7), yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3) }));
  } catch {
    /* 存不了就算了 */
  }
}
/** 小法：毛畫成把橢球撐胖（毛長的幾倍）；離你多遠以外不畫 */
const FUR_PUFF = 0.7;
const DOG_FAR_M = 120;
const wrap = (deg: number): number => ((((deg % 360) + 540) % 360) - 180);

/** 打開 3D 公園（蓋在整個畫面上面），回傳關掉的函式 */
export function openPark3D(o: Park3DOptions): () => void {
  const root = document.createElement('div');
  root.className = 'p3d';
  root.innerHTML = `
    <div class="p3d-top">
      <button type="button" class="chip p3d-exit">離開</button>
      <span class="p3d-title">3D 國館<small>測試中・高度大多是估的</small></span>
      <button type="button" class="chip p3d-mark-toggle" aria-pressed="false">標記</button>
    </div>
    <div class="p3d-hint"></div>
    <div class="p3d-cross" hidden></div>
    <div class="p3d-stick" hidden><div class="p3d-knob"></div></div>
    <div class="p3d-panel" hidden>
      <div class="p3d-kinds">${KINDS.map((k) => `<button type="button" class="chip" data-kind="${k}">${KIND_NAME[k]}</button>`).join('')}</div>
      <div class="p3d-edit" hidden>
        <div class="p3d-row"><button type="button" class="chip p3d-rot" data-rot="-15" title="往左轉 15 度">⟲</button><button type="button" class="chip p3d-rot" data-rot="15" title="往右轉 15 度">⟳</button><input class="p3d-note" maxlength="60" placeholder="備註（可以不寫）" /></div>
        <div class="p3d-row"><button type="button" class="chip primary p3d-save">儲存</button><button type="button" class="chip p3d-cancel">取消</button><button type="button" class="chip p3d-del" hidden>刪除</button></div>
      </div>
      <div class="p3d-status"></div>
    </div>
    <div class="p3d-msg" hidden></div>`;
  document.body.appendChild(root);
  const $ = <T extends Element>(s: string): T => root.querySelector(s) as T;
  const msg = (text: string, ms = 3500): void => {
    const m = $<HTMLElement>('.p3d-msg');
    m.textContent = text;
    m.hidden = !text;
    if (text && ms) setTimeout(() => m.textContent === text && (m.hidden = true), ms);
  };

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    root.remove();
    o.onExit();
    alert('這個瀏覽器不能顯示 3D（沒有 WebGL）');
    return () => {};
  }
  const touch = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  root.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbcd6ea);
  scene.fog = new THREE.Fog(0xcfe0ea, 140, 700);
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1500);
  camera.rotation.order = 'YXZ';
  scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x8d8a6e, 1.6));
  // 太陽從西南邊高高的地方照下來（台北的太陽在南邊；下午），影子往東北
  const sun = new THREE.DirectionalLight(0xfff6e6, 1.8);
  const SUN_DIR = new THREE.Vector3(-0.5, 1.1, 0.6).normalize();
  sun.castShadow = true;
  sun.shadow.mapSize.set(touch ? 1024 : 2048, touch ? 1024 : 2048);
  const SH = 70;
  Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 300 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const mat = (color: number | string, more: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color, ...more });
  const add = (g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], cast = false): THREE.Mesh => {
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    mesh.castShadow = cast;
    scene.add(mesh);
    return mesh;
  };

  // ---- 地面：公園外面、公園（廣場，挖掉水面）、草地、步道
  // 公園外面一大圈（挖掉公園，不然會蓋住比地面低的翠湖）
  const outline = ringEN(Z.outline);
  const far = Array.from({ length: 48 }, (_, i): Pt => [Math.cos((i / 48) * Math.PI * 2) * 1500, Math.sin((i / 48) * Math.PI * 2) * 1500]);
  add(flatGeo([shapeOf(far, [outline])], -0.01), mat(0xc4c0b6));
  const waters = Z.water.map(([outer, ...islands]) => ({ outer: ringEN(outer), islands: islands.map(ringEN) }));
  add(flatGeo([shapeOf(outline, waters.map((w) => w.outer))], 0), mat(0xe2dccf));
  const grass = mat(0x86ad66);
  add(flatGeo(Z.green.map((r) => shapeOf(ringEN(r))), 0.02), grass);
  const inWater = (p: Pt): boolean => waters.some((w) => inside(p, w.outer) && !w.islands.some((i) => inside(p, i)));
  // 步道：經過水面的那幾段不畫（橋另外蓋）
  const pathLines = Z.paths.map((l) => l.map(en)).flatMap((l) => {
    const out: Pt[][] = [];
    let cur: Pt[] = [];
    for (let i = 0; i < l.length; i++) {
      if (i > 0 && inWater([(l[i - 1][0] + l[i][0]) / 2, (l[i - 1][1] + l[i][1]) / 2])) {
        if (cur.length > 1) out.push(cur);
        cur = [l[i]];
      } else cur.push(l[i]);
    }
    if (cur.length > 1) out.push(cur);
    return out;
  });
  add(stripGeo(pathLines, PATH_W, 0.035), mat(0xd8cdb8));

  // ---- 水：翠湖（水面低一點、岸是石頭）、映池（水面高一點、一圈可以坐的石頭邊）
  const stone = mat(0xb9b1a2);
  waters.forEach((w, i) => {
    const pool = i === 0;
    const y = pool ? POOL_WATER : LAKE_WATER;
    const inner = pool ? inset(w.outer, RIM_W) : w.outer;
    add(flatGeo([shapeOf(inner, w.islands)], y), mat(pool ? 0x4f95c4 : 0x3f84b0));
    add(wallGeo(w.outer, -BANK_DEPTH, 0.01), mat(0x9d9585, { side: THREE.DoubleSide }));
    // 小島：草地或石頭，岸一樣
    for (const isl of w.islands) {
      add(flatGeo([shapeOf(isl)], 0.005), stone);
      add(wallGeo(isl, -BANK_DEPTH, 0.01), mat(0x9d9585, { side: THREE.DoubleSide }));
    }
    if (pool) add(prismGeo(shapeOf(w.outer, [inner]), -BANK_DEPTH, BANK_DEPTH + RIM_H), mat(0xe6e0d4), true);
  });

  // ---- 橋：石頭橋面、兩邊欄杆
  const deckMat = mat(0xeee6d6);
  const railMat = mat(0x7d6b55);
  const bridges = Z.bridges.map((l) => l.map(en));
  for (const l of bridges)
    for (let i = 1; i < l.length; i++) {
      const [a, b] = [l[i - 1], l[i]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.05) continue;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const mid = new THREE.Vector3((a[0] + b[0]) / 2, 0, -(a[1] + b[1]) / 2);
      const deck = add(new THREE.BoxGeometry(len + BRIDGE_W * 0.5, 0.25, BRIDGE_W), deckMat, true);
      deck.position.set(mid.x, BRIDGE_TOP - 0.125, mid.z);
      deck.rotation.y = ang;
      for (const side of [-1, 1]) {
        const rail = add(new THREE.BoxGeometry(len + 0.1, RAIL_H, 0.1), railMat, true);
        const off = (BRIDGE_W / 2 - 0.05) * side;
        rail.position.set(mid.x - Math.sin(ang) * off, BRIDGE_TOP + RAIL_H / 2, mid.z - Math.cos(ang) * off);
        rail.rotation.y = ang;
      }
    }
  const onBridge = (p: Pt): boolean =>
    bridges.some((l) =>
      l.some((q, i) => {
        if (!i) return false;
        const a = l[i - 1];
        const [dx, dy] = [q[0] - a[0], q[1] - a[1]];
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]) <= BRIDGE_W / 2;
      }),
    );

  // ---- 外圍的矮牆、鐵欄杆：外框每一邊扣掉入口（入口投影到邊上、離邊 1.5 公尺內，前後各半個寬），剩下的一段段蓋牆
  const gates = Z.gates.map(([lat, lng, w]) => ({ at: en([lat, lng]), w }));
  const walls: Array<[Pt, Pt]> = [];
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) return;
    const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const at = (t: number): Pt => [a[0] + ux * t, a[1] + uy * t];
    const cuts = gates
      .flatMap(({ at: [gx, gy], w }) => {
        const t = (gx - a[0]) * ux + (gy - a[1]) * uy;
        const off = Math.abs((gx - a[0]) * uy - (gy - a[1]) * ux);
        return off < 1.5 && t > -w / 2 && t < len + w / 2 ? [[t - w / 2, t + w / 2] as Pt] : [];
      })
      .sort((p, q) => p[0] - q[0]);
    let from = 0;
    for (const [c0, c1] of cuts) {
      if (c0 > from + 0.1) walls.push([at(from), at(Math.min(len, c0))]);
      from = Math.max(from, c1);
    }
    if (len > from + 0.1) walls.push([at(from), at(len)]);
  });
  {
    // 欄杆的圖（一片 FENCE_PANEL 公尺寬、FENCE_H 高，透明的地方看得過去）
    const cv = document.createElement('canvas');
    [cv.width, cv.height] = [512, 256];
    const g = cv.getContext('2d')!;
    const Y = (m: number): number => 256 - (m / FENCE_H) * 256;
    g.fillStyle = g.strokeStyle = '#151618';
    for (const [m, h] of [[0.05, 7], [0.34, 6], [0.84, 8]] as const) g.fillRect(0, Y(m) - h / 2, 512, h);
    for (let x = 24; x < 500; x += 22) {
      g.fillRect(x - 2, Y(0.9), 4, Y(0) - Y(0.9));
      g.beginPath();
      g.moveTo(x - 5, Y(0.88));
      g.lineTo(x, Y(0.96));
      g.lineTo(x + 5, Y(0.88));
      g.fill();
    }
    g.lineWidth = 4;
    for (let x = 35; x < 500; x += 44) {
      g.beginPath();
      g.arc(x, Y(0.2), 13, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillRect(0, Y(0.94), 10, Y(0) - Y(0.94));
    g.beginPath();
    g.arc(5, Y(0.95), 7, 0, Math.PI * 2);
    g.fill();
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const wallGeos: THREE.BufferGeometry[] = [];
    const capGeos: THREE.BufferGeometry[] = [];
    const fenceGeos: THREE.BufferGeometry[] = [];
    for (const [a, b] of walls) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const m = new THREE.Matrix4().makeRotationY(Math.atan2(b[1] - a[1], b[0] - a[0])).setPosition((a[0] + b[0]) / 2, 0, -(a[1] + b[1]) / 2);
      wallGeos.push(new THREE.BoxGeometry(len + WALL_T, WALL_H, WALL_T).translate(0, WALL_H / 2, 0).applyMatrix4(m));
      capGeos.push(new THREE.BoxGeometry(len + WALL_T + 0.04, 0.05, WALL_T + 0.06).translate(0, WALL_H + 0.025, 0).applyMatrix4(m));
      const f = new THREE.PlaneGeometry(len, FENCE_H).translate(0, WALL_H + 0.05 + FENCE_H / 2, 0);
      const uv = f.getAttribute('uv') as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * (len / FENCE_PANEL));
      fenceGeos.push(f.applyMatrix4(m));
    }
    if (walls.length) {
      add(mergeGeometries(wallGeos), mat(0xbdb8ae), true);
      add(mergeGeometries(capGeos), mat(0xd3cec4), true);
      add(mergeGeometries(fenceGeos), new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide }), true);
    }
  }
  const segDist = (p: Pt, a: Pt, b: Pt): number => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
  };
  /** 撞到外圍的牆 */
  const hitWall = (p: Pt): boolean => walls.some(([a, b]) => segDist(p, a, b) < WALL_T / 2 + 0.25);

  // ---- 建築：紀念館（牆、四面斜的黃色琉璃瓦、中間紅褐色平頂），亭子（柱子、尖屋頂），其他照屋頂顏色的平頂方塊
  const wallMat = mat(0xd9d0c2);
  Z.buildings.forEach((b, i) => {
    const ring = ringEN(b);
    const [color, style] = Z.roofStyle[i] ?? ['#9fa3a4', 'flat'];
    if (style === 'hall') {
      const flat = rectOf(Z.hallFlat.map(en));
      // 牆：跟平頂同一個方向的長方形，比屋頂外框（四個方向各自最裡面的那一圈邊）再往內縮 HALL_WALL_IN
      const ay: Pt = [-flat.ax[1], flat.ax[0]];
      const ss = ring.map(([x, y]) => (x - flat.c[0]) * flat.ax[0] + (y - flat.c[1]) * flat.ax[1]);
      const ts = ring.map(([x, y]) => (x - flat.c[0]) * ay[0] + (y - flat.c[1]) * ay[1]);
      const q = (v: number[], p: number): number => [...v].sort((x, y) => x - y)[Math.round(p * (v.length - 1))];
      const [s0, s1, t0, t1] = [q(ss, 0.2) + HALL_WALL_IN, q(ss, 0.8) - HALL_WALL_IN, q(ts, 0.2) + HALL_WALL_IN, q(ts, 0.8) - HALL_WALL_IN];
      const corner = (s: number, t: number): Pt => [flat.c[0] + s * flat.ax[0] + t * ay[0], flat.c[1] + s * flat.ax[1] + t * ay[1]];
      add(prismGeo(shapeOf([corner(s0, t0), corner(s1, t0), corner(s1, t1), corner(s0, t1)]), 0, HALL_EAVE), wallMat, true);
      add(roofGeo(ring, flat.c, flat.ax, flat.a, flat.b, HALL_EAVE, HALL_TOP), mat(color, { side: THREE.DoubleSide, flatShading: true }), true);
      add(flatGeo([shapeOf([corner(-flat.a, -flat.b), corner(flat.a, -flat.b), corner(flat.a, flat.b), corner(-flat.a, flat.b)])], HALL_TOP + 0.01), mat(0x7d5047));
      return;
    }
    if (style === 'hip') {
      // 亭子：四個角往內一點的柱子、尖尖的屋頂
      for (const p of inset(ring, 0.3)) {
        const post = add(new THREE.CylinderGeometry(0.12, 0.12, PAVILION_EAVE, 8), mat(0x8a3b2c), true);
        post.position.set(p[0], PAVILION_EAVE / 2, -p[1]);
      }
      const c: Pt = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
      add(roofGeo(ring, c, [1, 0], 0, 0, PAVILION_EAVE, PAVILION_TOP), mat(color, { side: THREE.DoubleSide, flatShading: true }), true);
      return;
    }
    const box = rectOf(ring.length >= 4 ? ring : [...ring, ring[0]]);
    const h = Math.min(box.a, box.b) * 2 < 2 ? SMALL_H : HOUSE_H;
    add(prismGeo(shapeOf(ring), 0, h), [mat(color), wallMat], true);
  });

  // ---- 旗台、旗桿（兩層石頭台座）、孫中山銅像（石頭台座上坐著的銅像，面向南邊）
  const flagStone = mat(0xd5cec0);
  const flagBaseRing = ringEN(Z.flagBase);
  add(prismGeo(shapeOf(flagBaseRing), 0, FLAG_BASE_H), flagStone, true);
  const fp = en(Z.flagpole);
  const flagGroup = new THREE.Group();
  flagGroup.position.set(fp[0], FLAG_BASE_H, -fp[1]);
  const tierA = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 2.4), flagStone);
  tierA.position.y = 0.175;
  const tierB = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 1.4), flagStone);
  tierB.position.y = 0.525;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.11, FLAG_POLE_H, 12), mat(0xe8e8e8));
  pole.position.y = 0.7 + FLAG_POLE_H / 2;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), mat(0xd4a83a));
  ball.position.y = 0.7 + FLAG_POLE_H + 0.18;
  for (const m of [tierA, tierB, pole, ball]) {
    m.castShadow = m.receiveShadow = true;
    flagGroup.add(m);
  }
  scene.add(flagGroup);
  const sp = en(Z.statue);
  const statue = new THREE.Group();
  statue.position.set(sp[0], 0, -sp[1]);
  const bronze = mat(0x6b5636);
  const parts: Array<[THREE.BufferGeometry, THREE.Material, number, number, number]> = [
    [new THREE.BoxGeometry(2, 0.3, 2), flagStone, 0, 0.15, 0],
    [new THREE.BoxGeometry(1.0, 1.55, 0.25), bronze, 0, 1.08, -0.35],
    [new THREE.BoxGeometry(0.95, 0.5, 0.75), bronze, 0, 0.75, 0],
    [new THREE.BoxGeometry(0.7, 0.55, 0.3), bronze, 0, 0.58, 0.45],
    [new THREE.CylinderGeometry(0.24, 0.32, 0.75, 12), bronze, 0, 1.38, -0.12],
    [new THREE.SphereGeometry(0.16, 14, 10), bronze, 0, 1.92, -0.1],
  ];
  for (const [g, m, x, y, z] of parts) {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    statue.add(mesh);
  }
  scene.add(statue);

  // ---- 樹：樹幹、樹冠（一團低多邊形，照樹冠半徑；高度是估的），全部用 InstancedMesh 一次畫
  const trees = Z.trees.map(([lat, lng, r]) => ({ at: en([lat, lng]), r }));
  const trunkGeo = new THREE.CylinderGeometry(0.75, 1, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  const trunks = new THREE.InstancedMesh(trunkGeo, mat(0x6e5640), trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, mat(0xffffff, { flatShading: true }), trees.length);
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const col = new THREE.Color();
  trees.forEach(({ at, r }, i) => {
    const H = treeH(r);
    const half = Math.min(r * 0.8, H * 0.38);
    const cy = H - half;
    const tr = trunkR(r);
    m4.compose(new THREE.Vector3(at[0], 0, -at[1]), q4.identity(), new THREE.Vector3(tr, cy, tr));
    trunks.setMatrixAt(i, m4);
    q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i) * Math.PI * 2);
    m4.compose(new THREE.Vector3(at[0], cy, -at[1]), q4, new THREE.Vector3(r, half, r));
    crowns.setMatrixAt(i, m4);
    col.setHSL(0.27 + (hash(i + 7) - 0.5) * 0.06, 0.42 + hash(i + 3) * 0.12, 0.27 + hash(i + 11) * 0.08);
    crowns.setColorAt(i, col);
  });
  for (const m of [trunks, crowns]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    scene.add(m);
  }
  // 樹幹擋路：5 公尺一格的索引
  const trunkGrid = new Map<string, number[]>();
  trees.forEach(({ at }, i) => {
    const k = `${Math.floor(at[0] / 5)},${Math.floor(at[1] / 5)}`;
    trunkGrid.set(k, [...(trunkGrid.get(k) ?? []), i]);
  });
  const hitTrunk = (p: Pt): boolean => {
    for (let i = Math.floor(p[0] / 5) - 1; i <= Math.floor(p[0] / 5) + 1; i++)
      for (let j = Math.floor(p[1] / 5) - 1; j <= Math.floor(p[1] / 5) + 1; j++)
        for (const k of trunkGrid.get(`${i},${j}`) ?? []) if (Math.hypot(p[0] - trees[k].at[0], p[1] - trees[k].at[1]) < trunkR(trees[k].r) + 0.25) return true;
    return false;
  };
  const canStand = (p: Pt): boolean => personOk(ll(p[0], p[1])) && !hitTrunk(p) && !hitWall(p);
  /** 腳下多高：橋上是橋面、旗台上是旗台 */
  const floorAt = (p: Pt): number => (onBridge(p) ? BRIDGE_TOP : inside(p, flagBaseRing) ? FLAG_BASE_H : 0);

  // ---- 標記：路燈、長椅、垃圾桶、其他（伺服器上的，加上正在放、正在改的那一個）
  const markGroup = new THREE.Group();
  scene.add(markGroup);
  const markMats = {
    pole: mat(0x4a4f55),
    black: mat(0x1f2124),
    glass: mat(0xfbf6ea, { emissive: 0xffe6b8, emissiveIntensity: 0.45 }),
    granite: mat(0xc9c7c1),
    bin: mat(0x3e6b4c),
    pin: mat(0xd2483b),
  };
  const ghostMat = new THREE.MeshLambertMaterial({ color: 0x3aa0ff, transparent: true, opacity: 0.55 });
  /** 一個標記的樣子（原點在地上，往北是 -z；長椅坐的人面向 -z） */
  function markModel(kind: ParkMarkKind, ghost: boolean): THREE.Group {
    const g = new THREE.Group();
    const put = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, turn?: { x?: number; y?: number; z?: number }): void => {
      const mesh = new THREE.Mesh(geo, ghost ? ghostMat : m);
      mesh.position.set(x, y, z);
      if (turn) mesh.rotation.set(turn.x ?? 0, turn.y ?? 0, turn.z ?? 0);
      mesh.castShadow = !ghost;
      g.add(mesh);
    };
    /** 方形、上下不一樣寬（四個角朝斜的方向轉 45 度，邊才是正的） */
    const square = (top: number, bottom: number, h: number): THREE.BufferGeometry => new THREE.CylinderGeometry(top, bottom, h, 4).rotateY(Math.PI / 4);
    if (kind === 'lamp') {
      const H = LAMP_POLE_H;
      put(new THREE.CylinderGeometry(0.09, 0.12, 0.6, 12), markMats.black, 0, 0.3, 0);
      put(new THREE.CylinderGeometry(0.045, 0.06, H - 0.6, 10), markMats.black, 0, 0.6 + (H - 0.6) / 2, 0);
      put(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 10), markMats.black, 0, H + 0.04, 0);
      put(square(0.13, 0.07, 0.1), markMats.black, 0, H + 0.13, 0);
      put(square(0.2, 0.14, 0.34), markMats.glass, 0, H + 0.35, 0);
      put(square(0.215, 0.215, 0.04), markMats.black, 0, H + 0.54, 0);
      put(new THREE.ConeGeometry(0.27, 0.2, 4).rotateY(Math.PI / 4), markMats.black, 0, H + 0.66, 0);
      put(new THREE.SphereGeometry(0.035, 10, 8), markMats.black, 0, H + 0.79, 0);
    } else if (kind === 'bench') {
      // 一整塊花崗石：側面照 BENCH_PROFILE 圓圓的（曲線），沿著長邊拉長、兩頭邊緣磨圓；坐的人面向 -z
      const side = new THREE.Shape();
      side.moveTo(...BENCH_PROFILE[0]);
      side.splineThru(BENCH_PROFILE.slice(1).map(([u, v]) => new THREE.Vector2(u, v)));
      side.closePath();
      const geo = new THREE.ExtrudeGeometry(side, { depth: BENCH_LEN - 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 3, curveSegments: 6 });
      geo.rotateY(-Math.PI / 2);
      geo.translate((BENCH_LEN - 0.06) / 2, 0, 0);
      put(geo, markMats.granite, 0, 0, 0);
    } else if (kind === 'bin') {
      put(new THREE.CylinderGeometry(0.25, 0.22, 0.85, 14), markMats.bin, 0, 0.425, 0);
    } else {
      put(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8), markMats.pole, 0, 0.6, 0);
      put(new THREE.SphereGeometry(0.18, 14, 10), markMats.pin, 0, 1.3, 0);
    }
    return g;
  }
  let marks: ParkMark[] = [];
  /** 正在放（id 沒有）或正在改（有 id）的那一個 */
  let draft: (ParkMarkIn & { id?: number }) | null = null;
  let kind: ParkMarkKind = 'lamp';
  let marking = false;
  let busy = false;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3aa0ff, transparent: true, opacity: 0.8, depthWrite: false }));
  function drawMarks(): void {
    for (const c of [...markGroup.children]) {
      markGroup.remove(c);
      c.traverse((x) => x instanceof THREE.Mesh && x.geometry.dispose());
    }
    for (const m of marks) {
      if (draft?.id === m.id) continue;
      const g = markModel(m.kind, false);
      place(g, m);
      g.userData.markId = m.id;
      markGroup.add(g);
    }
    if (draft) {
      const g = markModel(draft.kind, true);
      place(g, draft);
      markGroup.add(g);
      ring.position.set(g.position.x, g.position.y + 0.04, g.position.z);
      markGroup.add(ring);
    }
    renderer.shadowMap.needsUpdate = true;
    dirty = true;
  }
  function place(g: THREE.Object3D, m: { lat: number; lng: number; heading: number }): void {
    const p = en([m.lat, m.lng]);
    g.position.set(p[0], floorAt(p), -p[1]);
    g.rotation.y = (-m.heading * Math.PI) / 180;
  }
  const status = (): void => {
    const el = $<HTMLElement>('.p3d-status');
    if (draft) {
      const p = en([draft.lat, draft.lng]);
      const d = Math.hypot(p[0] - pos[0], p[1] - pos[1]);
      el.textContent = `${draft.id ? `改 #${draft.id} ` : '新的'}${KIND_NAME[draft.kind]}・離你 ${d.toFixed(1)} 公尺・${draft.lat.toFixed(7)}, ${draft.lng.toFixed(7)}${draft.kind === 'bench' ? `・面向 ${Math.round(draft.heading)}°` : ''}`;
    } else el.textContent = `點地面放一個${KIND_NAME[kind]}，點已經標的可以改；已經標了 ${marks.length} 個`;
  };
  function panel(): void {
    $<HTMLElement>('.p3d-panel').hidden = !marking;
    $<HTMLElement>('.p3d-cross').hidden = !marking;
    $<HTMLElement>('.p3d-mark-toggle').setAttribute('aria-pressed', String(marking));
    for (const b of root.querySelectorAll<HTMLButtonElement>('.p3d-kinds button')) b.classList.toggle('primary', (draft?.kind ?? kind) === b.dataset.kind);
    $<HTMLElement>('.p3d-edit').hidden = !draft;
    $<HTMLElement>('.p3d-del').hidden = !draft?.id;
    for (const b of root.querySelectorAll<HTMLButtonElement>('.p3d-rot')) b.disabled = !draft;
    status();
  }
  async function loadMarks(): Promise<void> {
    try {
      marks = await fetchParkMarks(o.token);
      drawMarks();
      panel();
    } catch (e) {
      msg(`讀不到標記：${(e as Error).message}`, 6000);
    }
  }

  // ---- 小法（跟汪星同一隻）：每一格照牠現在在哪、在做什麼擺好每個部位；地上一塊淡淡的影子（不重畫太陽的影子）
  const xiaofa = PARK_DOGS[0];
  const dogRoot = new THREE.Group();
  dogRoot.matrixAutoUpdate = false;
  scene.add(dogRoot);
  const dogBall = new THREE.SphereGeometry(1, 18, 12);
  const dogMeshes = new Map<string, THREE.Mesh>();
  const dogMats = new Map<string, THREE.MeshLambertMaterial>();
  const dogShadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  dogShadow.scale.set(0.16, 1, 0.26);
  dogRoot.add(dogShadow);
  const v3 = (q: [number, number, number]): THREE.Vector3 => new THREE.Vector3(q[0], q[1], q[2]);
  /** 擺好小法（離你太遠就藏起來）；回傳要不要一直重畫 */
  function drawDog(now: number): boolean {
    const d = xiaofa.now(now);
    const p = en(d.at);
    if (Math.hypot(p[0] - pos[0], p[1] - pos[1]) > DOG_FAR_M) {
      dogRoot.visible = false;
      return false;
    }
    dogRoot.visible = true;
    const s = d.seg;
    // 面向哪（度，0 是北、順時針）：從上一段的方向轉到這一段的方向
    const bearing = (dir: Pt): number => (Math.atan2(dir[1] * MX, dir[0] * MY) * 180) / Math.PI;
    const [b0, b1] = [bearing(s.dir0), bearing(s.dir)];
    const turn = wrap(b1 - b0);
    const B = ((b0 + turn * dogTurned(s, d.e)) * Math.PI) / 180;
    // 狗自己的座標（往前、往左、往上）→ 公園（x 往東、y 往上、z 往南）
    const fwd = new THREE.Vector3(Math.sin(B), 0, -Math.cos(B));
    const left = new THREE.Vector3(-Math.cos(B), 0, -Math.sin(B));
    dogRoot.matrix.makeBasis(fwd, left, new THREE.Vector3(0, 1, 0)).setPosition(p[0], floorAt(p), -p[1]);
    dogRoot.matrixWorldNeedsUpdate = true;
    const all = dogParts(xiaofa.look, dogPose(s, d.e, turn));
    const puff = (key: string): number => (all.find((x) => x.key === key)?.hair ?? 0) * FUR_PUFF;
    const [headPuff, mouthPuff] = [puff('head'), puff('muzzle')];
    const muzzle = all.find((x) => x.key === 'muzzle');
    const used = new Set<string>();
    for (const part of all) {
      let mesh = dogMeshes.get(part.key);
      if (!mesh) {
        let m = dogMats.get(part.fill);
        if (!m) dogMats.set(part.fill, (m = mat(part.fill)));
        mesh = new THREE.Mesh(dogBall, m);
        mesh.matrixAutoUpdate = false;
        dogMeshes.set(part.key, mesh);
        dogRoot.add(mesh);
      }
      if ((mesh.material as THREE.MeshLambertMaterial).color.getHexString() !== part.fill.slice(1)) {
        let m = dogMats.get(part.fill);
        if (!m) dogMats.set(part.fill, (m = mat(part.fill)));
        mesh.material = m;
      }
      used.add(part.key);
      let c = v3(part.c);
      let axes = part.a.map(v3);
      if (part.hair > 0) {
        // 毛：每個半軸加長毛的 FUR_PUFF 倍
        const h = part.hair * FUR_PUFF;
        axes = axes.map((a) => a.multiplyScalar(1 + h / (a.length() || 1)));
      } else {
        // 貼在臉上的（眼睛、鼻子、嘴唇）：往外推到毛的外面
        const onMouth = /^(nose|nostril|noseshine|philtrum|lip|tongue)/.test(part.key);
        const dir = part.facing ? v3(part.facing).normalize() : muzzle ? c.clone().sub(v3(muzzle.c)).normalize() : new THREE.Vector3(1, 0, 0);
        c = c.addScaledVector(dir, (onMouth ? mouthPuff : headPuff) + part.bias + 0.003);
      }
      mesh.matrix.makeBasis(axes[0], axes[1], axes[2]).setPosition(c);
      mesh.visible = true;
    }
    for (const [k, m] of dogMeshes) if (!used.has(k)) m.visible = false;
    return true;
  }

  // ---- 走路、轉頭
  let pos: Pt = en(START);
  let yaw = (START_HEADING * Math.PI) / 180;
  let pitch = -0.05;
  const lastSpot = loadSpot();
  if (lastSpot && canStand(en(lastSpot.at))) [pos, yaw, pitch] = [en(lastSpot.at), lastSpot.yaw, lastSpot.pitch];
  let saved = '';
  const remember = (): void => {
    const key = `${pos[0].toFixed(2)},${pos[1].toFixed(2)},${yaw.toFixed(2)},${pitch.toFixed(2)}`;
    if (key === saved) return;
    saved = key;
    saveSpot(ll(pos[0], pos[1]), yaw, pitch);
  };
  let rememberedAt = 0;
  const keys = new Set<string>();
  /** 方向鍵左右按了多久（秒） */
  let turnHeld = 0;
  const stick = { x: 0, y: 0, id: -1 };
  let dirty = true;
  let shadowAt: Pt = [Infinity, Infinity];
  function updateCamera(): void {
    camera.position.set(pos[0], floorAt(pos) + EYE, -pos[1]);
    camera.rotation.set(pitch, -yaw, 0);
    // 現在站哪、面向哪（測試看得到）
    const [lat, lng] = ll(pos[0], pos[1]);
    root.dataset.at = `${lat.toFixed(7)},${lng.toFixed(7)},${(((((yaw * 180) / Math.PI) % 360) + 360) % 360).toFixed(1)}`;
    // 影子的範圍跟著人（每 20 公尺挪一次，影子才不會一直閃）
    const snap: Pt = [Math.round(pos[0] / 20) * 20, Math.round(pos[1] / 20) * 20];
    if (snap[0] !== shadowAt[0] || snap[1] !== shadowAt[1]) {
      shadowAt = snap;
      sun.target.position.set(snap[0], 0, -snap[1]);
      sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 150);
      sun.target.updateMatrixWorld();
      renderer.shadowMap.needsUpdate = true;
    }
  }
  function move(dt: number): boolean {
    let f = 0;
    let s = 0;
    if (keys.has('w') || keys.has('arrowup')) f += 1;
    if (keys.has('s') || keys.has('arrowdown')) f -= 1;
    if (keys.has('d')) s += 1;
    if (keys.has('a')) s -= 1;
    // 方向鍵左右轉頭（按下去慢慢加速）
    const turn = (keys.has('arrowright') ? 1 : 0) - (keys.has('arrowleft') ? 1 : 0);
    turnHeld = turn ? turnHeld + dt : 0;
    if (turn) yaw += turn * dt * TURN_KEY * Math.min(1, 0.25 + turnHeld / TURN_RAMP_S);
    if (stick.id >= 0) {
      f += -stick.y;
      s += stick.x;
    }
    const l = Math.hypot(f, s);
    if (l < 0.05) return !!turn;
    const k = (Math.min(1, l) / l) * WALK * (keys.has('shift') ? FAST : 1) * dt;
    const [fx, fy] = [Math.sin(yaw), Math.cos(yaw)];
    const d: Pt = [(fx * f + fy * s) * k, (fy * f - fx * s) * k];
    // 撞到了就沿著牆滑過去
    for (const step of [d, [d[0], 0] as Pt, [0, d[1]] as Pt]) {
      const next: Pt = [pos[0] + step[0], pos[1] + step[1]];
      if (canStand(next)) {
        pos = next;
        break;
      }
    }
    return true;
  }

  // ---- 點一下：標記模式下點地面放、點標記改
  const ray = new THREE.Raycaster();
  function tap(cx: number, cy: number): void {
    if (!marking || busy) return;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(markGroup.children.filter((c) => c.userData.markId), true)[0];
    if (hit) {
      let g: THREE.Object3D | null = hit.object;
      while (g && !g.userData.markId) g = g.parent;
      const m = marks.find((x) => x.id === g?.userData.markId);
      if (m) {
        draft = { id: m.id, kind: m.kind, lat: m.lat, lng: m.lng, heading: m.heading, note: m.note };
        $<HTMLInputElement>('.p3d-note').value = m.note ?? '';
        drawMarks();
        panel();
        return;
      }
    }
    // 地面（y = 0 那一面；橋上照橋面高）
    const d = ray.ray.direction;
    const oy = ray.ray.origin.y;
    if (d.y >= -1e-4) return;
    let t = (0 - oy) / d.y;
    let p: Pt = [ray.ray.origin.x + d.x * t, -(ray.ray.origin.z + d.z * t)];
    if (onBridge(p)) {
      t = (BRIDGE_TOP - oy) / d.y;
      p = [ray.ray.origin.x + d.x * t, -(ray.ray.origin.z + d.z * t)];
    }
    if (t > TAP_MAX_M) return msg('太遠了，走近一點再放');
    const [lat, lng] = ll(p[0], p[1]);
    if (draft) Object.assign(draft, { lat, lng });
    else {
      // 新的長椅：坐的人面向你
      draft = { kind, lat, lng, heading: (((yaw * 180) / Math.PI + 180) % 360 + 360) % 360, note: null };
      $<HTMLInputElement>('.p3d-note').value = '';
    }
    drawMarks();
    panel();
  }
  async function save(): Promise<void> {
    if (!draft || busy) return;
    busy = true;
    const d: ParkMarkIn = { kind: draft.kind, lat: draft.lat, lng: draft.lng, heading: draft.heading, note: $<HTMLInputElement>('.p3d-note').value.trim() || null };
    try {
      const saved = await saveParkMark(o.token, d, draft.id);
      marks = draft.id ? marks.map((m) => (m.id === saved.id ? saved : m)) : [...marks, saved];
      draft = null;
      msg(`存好了：${KIND_NAME[saved.kind]} #${saved.id}`);
    } catch (e) {
      msg(`存不起來：${(e as Error).message}`, 6000);
    }
    busy = false;
    drawMarks();
    panel();
  }
  async function remove(): Promise<void> {
    if (!draft?.id || busy || !confirm(`刪除這個${KIND_NAME[draft.kind]}（#${draft.id}）？`)) return;
    busy = true;
    try {
      await deleteParkMark(o.token, draft.id);
      marks = marks.filter((m) => m.id !== draft?.id);
      msg('刪掉了');
      draft = null;
    } catch (e) {
      msg(`刪不掉：${(e as Error).message}`, 6000);
    }
    busy = false;
    drawMarks();
    panel();
  }

  // ---- 輸入
  const canvas = renderer.domElement;
  let drag: { id: number; x: number; y: number; t: number; moved: boolean } | null = null;
  const onDown = (e: PointerEvent): void => {
    if (drag) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    const [dx, dy] = [e.clientX - drag.x, e.clientY - drag.y];
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    yaw -= dx * TURN_DRAG;
    pitch = Math.max(-1.3, Math.min(1.2, pitch - dy * LOOK_DRAG));
    [drag.x, drag.y] = [e.clientX, e.clientY];
    dirty = true;
  };
  const onUp = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    // 只有左鍵（手機是手指）點一下才算點地面；右鍵拖曳一樣轉頭
    if (!drag.moved && e.button === 0 && performance.now() - drag.t < 600) tap(e.clientX, e.clientY);
    drag = null;
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', () => (drag = null));
  // 右鍵不跳出瀏覽器的選單（畫布會有「另存圖片」）；備註欄照常可以按右鍵貼上
  root.addEventListener('contextmenu', (e) => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
  });
  // 搖桿（手機）
  const stickEl = $<HTMLElement>('.p3d-stick');
  const knob = $<HTMLElement>('.p3d-knob');
  stickEl.hidden = !touch;
  const stickAt = (e: PointerEvent): void => {
    const r = stickEl.getBoundingClientRect();
    const R = r.width / 2;
    let [x, y] = [(e.clientX - r.left - R) / R, (e.clientY - r.top - R) / R];
    const l = Math.hypot(x, y);
    if (l > 1) [x, y] = [x / l, y / l];
    [stick.x, stick.y] = [x, y];
    knob.style.transform = `translate(${(x * R * 0.6).toFixed(1)}px, ${(y * R * 0.6).toFixed(1)}px)`;
  };
  stickEl.addEventListener('pointerdown', (e) => {
    stick.id = e.pointerId;
    stickEl.setPointerCapture(e.pointerId);
    stickAt(e);
  });
  stickEl.addEventListener('pointermove', (e) => e.pointerId === stick.id && stickAt(e));
  const stickUp = (e: PointerEvent): void => {
    if (e.pointerId !== stick.id) return;
    stick.id = -1;
    [stick.x, stick.y] = [0, 0];
    knob.style.transform = '';
  };
  stickEl.addEventListener('pointerup', stickUp);
  stickEl.addEventListener('pointercancel', stickUp);
  // 鍵盤：3D 打開時按鍵都不交給雷達（打備註時也不會走路）
  const typing = (e: KeyboardEvent): boolean => e.target instanceof HTMLInputElement;
  const onKey = (e: KeyboardEvent): void => {
    e.stopPropagation();
    if (typing(e)) {
      if (e.type === 'keydown' && e.key === 'Enter') void save();
      return;
    }
    const k = e.key.toLowerCase();
    if (e.type === 'keydown') {
      if (k === 'escape' && draft) {
        draft = null;
        drawMarks();
        panel();
      }
      if (['w', 'a', 's', 'd', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        keys.add(k);
        e.preventDefault();
      }
    } else keys.delete(k);
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  const onBlur = (): void => keys.clear();
  window.addEventListener('blur', onBlur);
  // 直接關掉分頁也記住站哪
  const onHide = (): void => remember();
  window.addEventListener('pagehide', onHide);

  $('.p3d-exit').addEventListener('click', () => close());
  $('.p3d-mark-toggle').addEventListener('click', () => {
    marking = !marking;
    if (!marking && draft) {
      draft = null;
      drawMarks();
    }
    panel();
  });
  for (const b of root.querySelectorAll<HTMLButtonElement>('.p3d-kinds button'))
    b.addEventListener('click', () => {
      kind = b.dataset.kind as ParkMarkKind;
      if (draft) {
        draft.kind = kind;
        drawMarks();
      }
      panel();
    });
  for (const b of root.querySelectorAll<HTMLButtonElement>('.p3d-rot'))
    b.addEventListener('click', () => {
      if (!draft) return;
      draft.heading = (((draft.heading + Number(b.dataset.rot)) % 360) + 360) % 360;
      drawMarks();
      panel();
    });
  $('.p3d-save').addEventListener('click', () => void save());
  $('.p3d-cancel').addEventListener('click', () => {
    draft = null;
    drawMarks();
    panel();
  });
  $('.p3d-del').addEventListener('click', () => void remove());
  const hint = $<HTMLElement>('.p3d-hint');
  hint.textContent = touch ? '左下搖桿走路、拖曳畫面轉頭' : '拖曳轉頭、WASD 走路（方向鍵也可以）、Shift 快走';
  const hintTimer = setTimeout(() => (hint.hidden = true), 7000);

  // ---- 畫
  const resize = (): void => {
    const [w, h] = [root.clientWidth, root.clientHeight];
    renderer.setSize(w, h);
    camera.aspect = w / h;
    // 直的手機畫面：左右至少看得到約 70 度（照左右算上下的視角，最多 95 度）
    camera.fov = Math.min(95, Math.max(65, (2 * Math.atan(Math.tan((70 / 2) * (Math.PI / 180)) / camera.aspect) * 180) / Math.PI));
    camera.updateProjectionMatrix();
    dirty = true;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  resize();
  let last = performance.now();
  let frame = 0;
  const loop = (now: number): void => {
    frame = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (move(dt)) {
      dirty = true;
      if (draft) status();
    }
    // 小法在附近就每一格都畫（會動）
    if (drawDog(now)) dirty = true;
    if (now - rememberedAt > 2000) {
      rememberedAt = now;
      remember();
    }
    if (!dirty) return;
    dirty = false;
    updateCamera();
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(loop);
  panel();
  void loadMarks();

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(frame);
    clearTimeout(hintTimer);
    ro.disconnect();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pagehide', onHide);
    remember();
    scene.traverse((x) => {
      if (x instanceof THREE.Mesh) {
        x.geometry.dispose();
        for (const m of Array.isArray(x.material) ? x.material : [x.material]) m.dispose();
      }
    });
    renderer.dispose();
    root.remove();
    o.onExit();
  }
  return close;
}
