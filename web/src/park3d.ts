/**
 * 3D 的中山公園（「3D 國館」，第一人稱走走看；大家都進得來，標記路燈、長椅要有管理 token）：
 * 照雷達同一份資料（zhongshan.ts：OpenStreetMap 的範圍、草地、步道、水面、橋、建築，正射影像判讀的樹冠、屋頂顏色、橋寬、映池石頭邊、旗台）
 * 蓋出來，平面的位置都是真的；高度大多沒有資料，是估的（下面的常數註明哪些是估的，找到資料再改）。
 * 記得上次站哪、面向哪（這個瀏覽器的 dr.park3d），下次接著走；第一次（或那裡現在站不到）從左下（西南角，光復南路那邊）的入口進去，面向南邊那條步道往東。
 * 電腦：拖曳轉頭、WASD 或方向鍵走路（Shift 快走）；手機：左下的搖桿走路、拖曳畫面轉頭。人走得到哪裡照 park.ts 的 personOk
 * （公園裡、不進建築、不下水，橋上可以），樹幹也擋。
 * 小法只在從汪星進來的時候在（地球的中山公園沒有）：跟汪星同一隻（PARK_DOGS，同一個時間在同一個地方做同一件事），
 * 照雷達上的畫法：dog.ts 同一組橢球照姿勢擺出來，表面長出一根根的毛（同一批位置）。
 * 標記（右上「標記」打開）：選種類（路燈、長椅、垃圾桶、其他），點地面放一個，可以轉方向、寫備註，按「儲存」存到伺服器
 * （/api/admin/park-marks，只有管理 token 能讀寫）；點已經標的可以移動、轉向、改備註、刪除。
 * three.js 只在打開時才載入（main.ts 用 import()），平常的雷達不會變大
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { deleteParkMark, fetchParkMarks, fetchPublicParkMarks, saveParkMark, type ParkMark, type ParkMarkIn, type ParkMarkKind } from './api';
import { dogHairRoots, dogPartArea, dogParts } from './dog';
import { dogPose, dogTurned, happyWag } from './dogs';
import { arriveRocket, ARRIVE_MS, DEPART_MS, departRocket, HATCH_CENTER, moveDogs, PARK_DOGS, personOk, petDog, rocketNow, setSniffMarks, stowRocket, STOW_MS, summonRocket, SUMMON_MS } from './park';
import { cloudLayer, puffTexture, rocketModel, ROCKET_H, ROCKET_WINDOW_Y, spaceScene, type SpaceTrip } from './rocket3d';
import { toWoof } from './space';
import { ZHONGSHAN_PARK as Z } from './zhongshan';
import { MIN_HALF, widthSides, withWidths as alongWidths } from './zhongshan-widths';

type Pt = [number, number];
/** 線上的一點和那裡的寬（公尺） */
type WP = [number, number, number];

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
/**
 * 翠湖小島上的翠亨亭（照使用者給的照片估的，屋頂外框照 OSM）：台基多高、從屋簷往內縮多少；台基邊上的矮牆多高、多厚，短邊中間留多寬上台階；
 * 柱子從屋簷往內縮多少、多粗，橫樑頂多高；屋簷（長邊中間）、正脊多高，屋面多厚，四個角往上翹多少、往外多少（比例）
 */
const PAV_BASE_H = 0.6;
const PAV_BASE_IN = 0.55;
const PAV_SEAT_H = 0.45;
const PAV_SEAT_T = 0.28;
const PAV_GATE = 1.2;
const PAV_COL_IN = 1.1;
const PAV_COL_R = 0.17;
const PAV_BEAM_TOP = 3.05;
const PAV_EAVE = 3.35;
const PAV_RIDGE = 4.5;
const PAV_ROOF_T = 0.22;
const PAV_CORNER_UP = 0.4;
const PAV_FLARE = 0.05;
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
/**
 * 橋（照使用者給的翠亨亭旁曲橋的照片）：寬（正射影像量的）、橋面多高、多厚；兩邊淺色的邊多寬；白色方石柱多粗、多高、頂上石球的半徑，
 * 柱子中心離橋邊多遠、大約幾公尺一根；朱紅色欄杆最上面那道圓橫桿多高（橋面算起）、多粗（寬度以外都是看照片估的）
 */
const BRIDGE_W = 2.6;
const BRIDGE_TOP = 0.3;
const BRIDGE_DECK_T = 0.3;
const BRIDGE_EDGE = 0.3;
const BRIDGE_POST_W = 0.26;
const BRIDGE_POST_H = 1.0;
const BRIDGE_BALL_R = 0.13;
const BRIDGE_POST_IN = 0.15;
const BRIDGE_PANEL = 2;
const BRIDGE_RAIL_H = 0.85;
const BRIDGE_RAIL_T = 0.07;
/**
 * 外圍一圈（公園外框，入口 Z.gates 斷開）：淺灰色的水泥矮牆，上面黑色的鐵欄杆（照使用者給的南邊步道照片：上下兩道橫桿、
 * 一根根尖頭的直桿、下面一帶一圈圈的花紋，每一片中間一根粗一點、頂上圓頭的柱子）；高度、寬度看照片估的
 */
const WALL_H = 0.5;
const WALL_T = 0.3;
const FENCE_H = 1.0;
const FENCE_PANEL = 2.4;
/** 入口兩邊再多拿掉幾公尺的牆（入口大一點） */
const GATE_CLEAR = 3;
/** 步道寬：照配置圖量的（zhongshan-widths.ts）；量不到、對不上的用這個（估的；OSM 只有中線） */
const PATH_W = 2;
/**
 * 南邊的櫻花步道（預設入口那一條，Z.sakuraLane）照使用者給的照片畫：深灰色的鋪面約 3.6 公尺寬，中間兩條淺色的磁磚線
 * （各 0.15 公尺寬、離中線 0.4 公尺）；寬度、線的位置看照片估的
 */
const SAKURA_W = 3.6;
const SAKURA_LINE_OFF = 0.4;
const SAKURA_LINE_W = 0.15;
/** 櫻花步道兩邊補草地：離路邊這麼多公尺內有草地，就補到草地為止 */
const SAKURA_GRASS_M = 6;
/**
 * 草（像雷達上一叢叢的草）：草地上每 GRASS_CELL 公尺一格，大多長一叢（2～4 根往上長、往兩邊散開一點的草葉，7～16 公分），
 * 只長在你附近 GRASS_NEAR 公尺內（遠的本來就小到看不到），每走 GRASS_CHUNK 公尺重排一次；路上不長
 */
const GRASS_CELL = 0.22;
const GRASS_NEAR = 14;
/** 立體的草叢從離你多遠開始越來越矮，到 GRASS_NEAR 沒入地面（跟遠處的平面草接起來） */
const GRASS_FADE = 6;
const GRASS_CHUNK = 5;
const GRASS_MAX = 20000;
/** 草地上那張一叢叢草的圖多大（公尺見方，重複鋪） */
const GRASS_TILE = 2;
/**
 * 銅像廣場（碑林，Z.statuePlaza）：位置照正射影像，樣子照使用者給的照片看的、大小是估的——墊高的灰色石頭平台、東邊幾階石階下到人行道
 * （南邊一道不鏽鋼扶手、北邊一排圓圓的矮樹叢），花台是石頭邊框、種滿紅色粉紅色的花，西邊一道長長的黑色石牆（碑林），銅像坐在中間面向東邊的紀念館
 */
const PLAZA_H = 0.7;
const PLAZA_STEPS = 5;
const STEP_DEPTH = 0.32;
const STELE_WALL_H = 2.1;
const STELE_WALL_T = 0.45;
const BED_H = 0.35;
/** 花台中間那一塊米色石板（從中間花台的中心往外幾公尺）、平台上草皮邊上的石條多寬 */
const PINK_HALF = 9.7;
const LAWN_EDGE = 0.22;
/** 站在鋪面上的樹，移到多近以內的草地（再遠的是廣場上種的，留著） */
const TREE_TO_LAWN_M = 5;
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
/** 手機搖桿推到底多久開始加速（秒） */
const STICK_RUN_S = 0.5;
const TAP_MAX_M = 150;

const KIND_NAME: Record<ParkMarkKind, string> = { lamp: '路燈', bench: '長椅', bin: '垃圾桶', stele: '石碑', other: '其他' };
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
/** 一條線兩邊各 w/2 的帶子（中間的轉角每一段多 w/2 接起來，頭尾不多），放在 y 高 */
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
      const p0: Pt = i > 1 ? [a[0] - ex, a[1] - ey] : a;
      const p1: Pt = i < l.length - 1 ? [b[0] + ex, b[1] + ey] : b;
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
/** 一條線往左（d > 0）或往右平移 d 公尺（轉角斜接） */
function offsetLine(l: Pt[], d: number): Pt[] {
  const dir = (a: Pt, b: Pt): Pt => {
    const n = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / n, (b[1] - a[1]) / n];
  };
  return l.map((p, i) => {
    const u0 = dir(l[Math.max(0, i - 1)], l[Math.max(1, i)]);
    const u1 = dir(l[Math.min(l.length - 2, i)], l[Math.min(l.length - 1, i + 1)]);
    const [mx, my] = [u0[0] + u1[0], u0[1] + u1[1]];
    const m = Math.hypot(mx, my) || 1;
    // 兩段方向的平均往左轉 90 度，長度 d / cos(轉角的一半)
    const k = d / Math.max(0.3, (mx / m) * u1[0] + (my / m) * u1[1]);
    return [p[0] - (my / m) * k, p[1] + (mx / m) * k];
  });
}
/** 寬度一段段不一樣的帶子（每一點照前後兩段的方向平均往兩邊各 w/2，碰到 blocked 的地方停），放在 y 高 */
function varStripGeo(lines: WP[][], y: number, blocked?: (p: Pt, m: number) => boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const l of lines) {
    const side = widthSides(l, blocked).map((s) => [s.left, s.right]);
    for (let i = 1; i < l.length; i++) {
      const q = [side[i - 1][0], side[i - 1][1], side[i][1], side[i][0]];
      for (const k of [0, 1, 2, 0, 2, 3]) pos.push(q[k][0], y, -q[k][1]);
    }
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
  /** 管理 token（標記路燈、長椅要有；大家都進得來，沒有 token 只看得到標好的） */
  token?: string;
  /** 從哪一邊進來：地球的中山公園沒有小法，汪星的才有 */
  world: 'earth' | 'woof';
  /** 在 3D 裡搭火箭到了另一邊（main.ts：你換到那一邊、雷達跟著換） */
  onWorld?: (to: 'earth' | 'woof') => void;
  /** 點到小法（main.ts：還沒有小法卡就拿一張） */
  onPetDog?: (id: string) => void;
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
/**
 * 小法（照雷達上的畫法）：每個部位一個橢球（毛底下的身體，撐胖一點點 FUR_BASE 倍的毛長），表面長出一根根的毛（跟雷達上同一批位置：
 * 從表面往外長、捲成 C 字、往下垂，照太陽分亮中暗三種顏色），整隻 DOG_HAIRS 根照面積分；眼睛、鼻子、嘴唇往外推 FUR_PUFF 倍的毛長（在毛的外面）
 */
const FUR_PUFF = 0.7;
const FUR_BASE = 0.3;
const DOG_HAIRS = 3600;
/** 一根毛分幾段畫（二次曲線） */
const HAIR_SEGS = 3;
const DOG_FAR_M = 120;
/** 點小法的範圍（看不到的球的半徑，公尺；5 公尺外照距離放大） */
const DOG_HIT_M = 0.45;
/** 小法的頭（眼睛）大概多高（抬頭看你時照這個算往上看幾度） */
const DOG_HEAD_Y = 0.3;
const wrap = (deg: number): number => ((((deg % 360) + 540) % 360) - 180);

/** 打開 3D 公園（蓋在整個畫面上面），回傳關掉的函式 */
export function openPark3D(o: Park3DOptions): () => void {
  const root = document.createElement('div');
  root.className = 'p3d';
  root.innerHTML = `
    <div class="p3d-top">
      <button type="button" class="chip p3d-exit">離開</button>
      <span class="p3d-title">3D 國館</span>
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
    <div class="p3d-msg" hidden></div>
    <div class="p3d-cockpit" hidden><div class="p3d-porthole"></div><div class="p3d-gauge"></div></div>
    <div class="p3d-flash"></div>`;
  document.body.appendChild(root);
  /** 現在在哪一邊（搭火箭會換） */
  let world = o.world;
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
  // 天空光、地面反光（帶一點草地的綠）亮一點：樹蔭下的草還是綠的
  scene.add(new THREE.HemisphereLight(0xeef6ff, 0x7f9a58, 1.7));
  // 太陽從西南邊高高的地方照下來（台北的太陽在南邊；下午），影子往東北
  const sun = new THREE.DirectionalLight(0xfff6e6, 1.9);
  const SUN_DIR = new THREE.Vector3(-0.5, 1.1, 0.6).normalize();
  sun.castShadow = true;
  sun.shadow.mapSize.set(touch ? 1024 : 2048, touch ? 1024 : 2048);
  const SH = 70;
  Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 300 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  // 影子淡一點、邊緣柔和（像真的樹蔭，不是一塊黑）
  sun.shadow.intensity = 0.72;

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
  const far = Array.from({ length: 64 }, (_, i): Pt => [Math.cos((i / 64) * Math.PI * 2) * 5000, Math.sin((i / 64) * Math.PI * 2) * 5000]);
  // 公園外面：從高處看像城市（一塊塊深淺不一的街廓、淺色的馬路，一張 400 公尺見方重複鋪）
  const city = (() => {
    const cv = document.createElement('canvas');
    [cv.width, cv.height] = [512, 512];
    const g = cv.getContext('2d')!;
    g.fillStyle = '#d4d0c6';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++) {
        const [x, y] = [i * 85 + 8, j * 85 + 8];
        for (let k = 0; k < 6; k++) {
          const v = 150 + Math.floor(hash(i * 61 + j * 17 + k * 5 + 300) * 50);
          g.fillStyle = hash(i * 7 + j * 13 + k + 800) < 0.12 ? `rgb(${v - 40}, ${v - 5}, ${v - 50})` : `rgb(${v}, ${v - 3}, ${v - 8})`;
          g.fillRect(x + (k % 3) * 24 + 1, y + Math.floor(k / 3) * 36 + 1, 22, 34);
        }
      }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / 400, 1 / 400);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  })();
  add(flatGeo([shapeOf(far, [outline])], -0.01), mat(0xffffff, { map: city }));
  const waters = Z.water.map(([outer, ...islands]) => ({ outer: ringEN(outer), islands: islands.map(ringEN) }));
  add(flatGeo([shapeOf(outline, waters.map((w) => w.outer))], 0), mat(0xe2dccf));
  // 草地：淡綠色上面一叢叢密密的草（畫在一張 GRASS_TILE 公尺見方、重複鋪的圖上，遠處也看得到草；近的還有立體的草）
  const grassTex = (() => {
    // 滿滿的草：深淺不一的綠底，上面幾千根短短的草葉（亮的、暗的、偏黃的），一塊塊淡淡的明暗（不會一整片一樣）
    const S = 512;
    const cv = document.createElement('canvas');
    [cv.width, cv.height] = [S, S];
    const g = cv.getContext('2d')!;
    // 跟長出來的草（淺草綠）差不多的顏色，遠的、近的接得起來
    g.fillStyle = '#78ab50';
    g.fillRect(0, 0, S, S);
    const wrapDraw = (f: (dx: number, dy: number) => void): void => {
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) f(dx, dy);
    };
    for (let k = 0; k < 60; k++) {
      const [x, y, r] = [hash(k * 5 + 1) * S, hash(k * 5 + 2) * S, 30 + hash(k * 5 + 3) * 70];
      g.fillStyle = hash(k * 5 + 4) < 0.5 ? 'rgba(160, 205, 105, 0.18)' : 'rgba(70, 120, 50, 0.14)';
      wrapDraw((dx, dy) => {
        g.beginPath();
        g.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        g.fill();
      });
    }
    g.lineCap = 'round';
    for (let k = 0; k < 9000; k++) {
      const [x, y] = [hash(k * 3 + 11) * S, hash(k * 3 + 12) * S];
      const h = hash(k * 3 + 13);
      const len = 5 + 9 * hash(k + 7000);
      const a = (h - 0.5) * 0.9;
      const tone = hash(k + 9000);
      // 深淺差小一點（中間距離不會一圈特別花），深的少一點
      g.strokeStyle = tone < 0.5 ? `rgba(${140 + Math.floor(h * 25)}, ${188 + Math.floor(h * 18)}, ${90 + Math.floor(h * 18)}, 0.85)` : tone < 0.94 ? `rgba(${112 + Math.floor(h * 25)}, ${162 + Math.floor(h * 20)}, ${72 + Math.floor(h * 18)}, 0.85)` : `rgba(${92 + Math.floor(h * 18)}, ${140 + Math.floor(h * 18)}, ${60 + Math.floor(h * 12)}, 0.85)`;
      g.lineWidth = 1 + hash(k + 8000) * 1.2;
      wrapDraw((dx, dy) => {
        if (x + dx < -20 || x + dx > S + 20 || y + dy < -20 || y + dy > S + 20) return;
        g.beginPath();
        g.moveTo(x + dx, y + dy);
        g.quadraticCurveTo(x + dx + Math.sin(a) * len * 0.3, y + dy - len * 0.6, x + dx + Math.sin(a) * len, y + dy - Math.cos(a) * len);
        g.stroke();
      });
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / GRASS_TILE, 1 / GRASS_TILE);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  })();
  const grass = mat(0xffffff, { map: grassTex });
  // 草地（花台另外畫）
  const bedSet = new Set(Z.flowerBeds);
  // 銅像廣場平台上的草皮另外畫（在平台上面）
  const onPlazaLawn = new Set(Z.plazaLawns);
  add(flatGeo(Z.green.flatMap((r, i) => (bedSet.has(i) || onPlazaLawn.has(i) ? [] : [shapeOf(ringEN(r))])), 0.02), grass);
  const inWater = (p: Pt): boolean => waters.some((w) => inside(p, w.outer) && !w.islands.some((i) => inside(p, i)));
  // 步道：經過水面的那幾段不畫（橋另外蓋）
  const splitWet = (l: WP[]): WP[][] => {
    const out: WP[][] = [];
    let cur: WP[] = [];
    for (let i = 0; i < l.length; i++) {
      if (i > 0 && inWater([(l[i - 1][0] + l[i][0]) / 2, (l[i - 1][1] + l[i][1]) / 2])) {
        if (cur.length > 1) out.push(cur);
        cur = [l[i]];
      } else cur.push(l[i]);
    }
    if (cur.length > 1) out.push(cur);
    return out;
  };
  /** 一條線只留公園外框裡面的部分（穿過外框的地方切開） */
  const clipIn = (l: WP[]): WP[][] => {
    const out: WP[][] = [];
    let cur: WP[] = [];
    for (let i = 1; i < l.length; i++) {
      const [a, b] = [l[i - 1], l[i]];
      // 這一段跟外框的交點（0～1）
      const ts = [0, 1];
      for (let k = 0; k < outline.length; k++) {
        const [c, d] = [outline[k], outline[(k + 1) % outline.length]];
        const [rx, ry, sx, sy] = [b[0] - a[0], b[1] - a[1], d[0] - c[0], d[1] - c[1]];
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
        const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
      }
      ts.sort((x, y) => x - y);
      for (let k = 1; k < ts.length; k++) {
        const at = (t: number): WP => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        const [p, q] = [at(ts[k - 1]), at(ts[k])];
        const mid = at((ts[k - 1] + ts[k]) / 2);
        if (inside([mid[0], mid[1]], outline)) {
          if (!cur.length) cur.push(p);
          cur.push(q);
        } else if (cur.length) {
          if (cur.length > 1) out.push(cur);
          cur = [];
        }
      }
    }
    if (cur.length > 1) out.push(cur);
    return out;
  };
  /** 一條步道照 PATH_STEP 公尺一點加密，每一點帶著配置圖量的寬（zhongshan-widths.ts；對不上就用 PATH_W） */
  const withWidths = (i: number): WP[] => alongWidths(i, Z.paths[i].map(en), PATH_W);
  const flat = (ls: WP[][]): Pt[][] => ls.map((l) => l.map(([x, y]): Pt => [x, y]));
  const pathLines = Z.paths.flatMap((_, i) => (i === Z.sakuraLane ? [] : clipIn(withWidths(i)).flatMap(splitWet)));
  const sakura = flat(clipIn(Z.paths[Z.sakuraLane].map(([a, b]): WP => [...en([a, b]), SAKURA_W])).flatMap(splitWet));
  /** 補的草地（一塊塊四邊形，草也長在上面） */
  const fillQuads: Pt[][] = [];
  // 櫻花步道兩邊旁邊是草地的地方（離路邊 SAKURA_GRASS_M 內有草地），路邊到草地之間補成草地（灰色的路直接接到草地）；
  // 超出公園外框、碰到水的點拉回外框、水邊
  {
    const lawns = Z.green.map(ringEN);
    const onLawn = (p: Pt): boolean => lawns.some((r) => inside(p, r));
    const nearestOn = (p: Pt, r: Pt[]): Pt => {
      let best: Pt = p;
      let bd = Infinity;
      for (let k = 0; k < r.length; k++) {
        const [a, b] = [r[k], r[(k + 1) % r.length]];
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        const q: Pt = [a[0] + dx * t, a[1] + dy * t];
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < bd) [best, bd] = [q, d];
      }
      return best;
    };
    const keepIn = (p: Pt): Pt => {
      if (!inside(p, outline)) p = nearestOn(p, outline);
      const w = waters.find((x) => inside(p, x.outer));
      return w ? nearestOn(p, w.outer) : p;
    };
    const pos: number[] = [];
    /** 一組線（半寬 half）兩邊補草地 */
    const fillBeside = (lines: Pt[][], half: number): void => {
    for (const l of lines)
      for (let i = 1; i < l.length; i++) {
        const [a, b] = [l[i - 1], l[i]];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.01) continue;
        const [nx, ny] = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
        // 一段太長就分幾小段看
        const n = Math.ceil(len / 3);
        for (let k = 0; k < n; k++)
          for (const side of [1, -1]) {
            // 前後各多 0.8 公尺（轉彎外側才不會有縫）
            const pad = 0.8 / len;
            const [t0, t1] = [k / n - pad, (k + 1) / n + pad];
            const at = (t: number, off: number): Pt => [a[0] + (b[0] - a[0]) * t + nx * off * side, a[1] + (b[1] - a[1]) * t + ny * off * side];
            // 往外看 SAKURA_GRASS_M 內第一個是草地的地方，補到那裡（再多 0.3 公尺疊上草地）
            const reach = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6].find((m) => m <= SAKURA_GRASS_M && onLawn(at((t0 + t1) / 2, half + m)));
            if (reach === undefined) continue;
            const far = half + reach + 0.3;
            const q = [at(t0, half - 0.05), at(t1, half - 0.05), at(t1, far), at(t0, far)].map(keepIn);
            for (const v of [0, 1, 2, 0, 2, 3]) pos.push(q[v][0], 0.02, -q[v][1]);
            fillQuads.push(q);
          }
      }
    };
    fillBeside(sakura, SAKURA_W / 2);
    // 西南角入口那條沙土路（paths 最後一條，接到櫻花步道）兩邊也一樣
    fillBeside(flat(clipIn(Z.paths[Z.paths.length - 1].map(([a, b]): WP => [...en([a, b]), PATH_W]))), PATH_W / 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // 草的圖照公園的座標鋪（跟草地一樣）
    g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.flatMap((v, k) => (k % 3 === 0 ? [v] : k % 3 === 2 ? [-v] : [])), 2));
    g.computeVertexNormals();
    add(g, new THREE.MeshLambertMaterial({ color: 0xffffff, map: grassTex, side: THREE.DoubleSide }));
  }
  // 路往旁邊鋪的時候碰到湖面、公園外面就停（不會蓋到湖、超出外框），碰到草地也停（離中線 MIN_HALF 以外，路至少留這麼寬）
  const lawnEN = Z.green.map(ringEN).map((r) => ({ r, box: [Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), Math.max(...r.map((p) => p[0])), Math.max(...r.map((p) => p[1]))] }));
  const onLawnEN = (p: Pt): boolean => lawnEN.some(({ r, box }) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3] && inside(p, r));
  add(varStripGeo(pathLines, 0.035, (p, m) => inWater(p) || !inside(p, outline) || (m > MIN_HALF && onLawnEN(p))), mat(0xd8cdb8));
  // 櫻花步道：深灰色、比較寬，上面兩條淺色的線（中線往兩邊平移）
  add(stripGeo(sakura, SAKURA_W, 0.04), mat(0x9d9b96));
  /** 一條線往左（正）或往右平移 d 公尺（每一點照前後兩段的方向平均） */
  const shift = (l: Pt[], d: number): Pt[] =>
    l.map((p, i) => {
      const [a, b] = [l[Math.max(0, i - 1)], l[Math.min(l.length - 1, i + 1)]];
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const len = Math.hypot(dx, dy) || 1;
      return [p[0] - (dy / len) * d, p[1] + (dx / len) * d];
    });
  add(stripGeo(sakura.flatMap((l) => [shift(l, SAKURA_LINE_OFF), shift(l, -SAKURA_LINE_OFF)]), SAKURA_LINE_W, 0.045), mat(0xf0ede6));
  // 路中間的小草地（像起點那一塊：OSM 的草地，中心在櫻花步道上或旁邊 1 公尺內、不到 150 平方公尺）蓋在路面上面，看得到整塊
  {
    const segs = sakura.flatMap((l) => l.slice(1).map((q, i): [Pt, Pt] => [l[i], q]));
    const dist = (p: Pt, a: Pt, b: Pt): number => {
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
    };
    const islands = Z.green.map(ringEN).filter((r) => {
      const area = Math.abs(r.reduce((s, [x, y], i) => s + x * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * y, 0)) / 2;
      const c: Pt = [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
      return area < 150 && segs.some(([a, b]) => dist(c, a, b) < SAKURA_W / 2 + 1);
    });
    if (islands.length) add(flatGeo(islands.map((r) => shapeOf(r)), 0.05), grass);
  }

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

  // ---- 橋（照使用者給的照片）：灰色水泥橋面、兩邊淺色的邊，白色方石柱頂上一顆石球（約每 BRIDGE_PANEL 公尺一根、轉角都有），
  // 柱子之間朱紅色的透空欄杆（最上面一道圓橫桿，下面是橫桿、直桿和中間方格「回」字的花紋，畫在圖上、透空的地方看得到水）；轉角底下一個橋墩
  const bridges = Z.bridges.map((l) => l.map(en));
  {
    // 欄杆的花紋（一片從柱子到柱子、從橋邊到最上面的圓橫桿底下；u 往右、v 往上都是 0～1）
    const cv = document.createElement('canvas');
    [cv.width, cv.height] = [512, 192];
    const g = cv.getContext('2d')!;
    g.fillStyle = '#c4452c';
    const bar = (u0: number, v0: number, u1: number, v1: number): void => {
      const [x0, x1] = [Math.min(u0, u1) * 512, Math.max(u0, u1) * 512];
      const [y0, y1] = [(1 - Math.max(v0, v1)) * 192, (1 - Math.min(v0, v1)) * 192];
      g.fillRect(x0 - 5, y0 - 5, x1 - x0 + 10, y1 - y0 + 10);
    };
    bar(0, 0.13, 1, 0.13);
    bar(0, 0.8, 1, 0.8);
    bar(0, 0.47, 0.3, 0.47);
    bar(0.7, 0.47, 1, 0.47);
    for (const u of [0.01, 0.12, 0.21, 0.79, 0.88, 0.99]) bar(u, 0.13, u, 1);
    // 中間的「回」：外框、裡面的小方塊、上下左右接起來
    for (const [u0, v0, u1, v1] of [[0.3, 0.22, 0.7, 0.72], [0.43, 0.36, 0.57, 0.58]])
      for (const [a, b, c, d] of [[u0, v0, u1, v0], [u0, v1, u1, v1], [u0, v0, u0, v1], [u1, v0, u1, v1]]) bar(a, b, c, d);
    bar(0.5, 0.13, 0.5, 0.36);
    bar(0.5, 0.58, 0.5, 0.8);
    bar(0.3, 0.47, 0.43, 0.47);
    bar(0.57, 0.47, 0.7, 0.47);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const [deckTop, deckSide] = [mat(0xa6a9ab), mat(0xc9c7c1)];
    const edgeGeos: THREE.BufferGeometry[] = [];
    const pierGeos: THREE.BufferGeometry[] = [];
    const postGeos: THREE.BufferGeometry[] = [];
    const railGeos: THREE.BufferGeometry[] = [];
    const panelGeos: THREE.BufferGeometry[] = [];
    const ball = new THREE.SphereGeometry(BRIDGE_BALL_R, 12, 8);
    const floor = BRIDGE_TOP + 0.04;
    /** 轉成 p 到 q 的方向、放在 o（高 y）；at 是放在 p、q 中間 */
    const turn = (p: Pt, q: Pt, o: Pt, y: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationY(Math.atan2(q[1] - p[1], q[0] - p[0])).setPosition(o[0], y, -o[1]);
    const at = (p: Pt, q: Pt, y: number): THREE.Matrix4 => turn(p, q, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], y);
    const band = (l: Pt[], d0: number, d1: number): THREE.Shape => shapeOf([...offsetLine(l, d0), ...offsetLine(l, d1).reverse()]);
    for (const l of bridges) {
      const half = BRIDGE_W / 2;
      add(prismGeo(band(l, half, -half), BRIDGE_TOP - BRIDGE_DECK_T, BRIDGE_DECK_T), [deckTop, deckSide], true);
      edgeGeos.push(prismGeo(band(l, half, half - BRIDGE_EDGE), BRIDGE_TOP, 0.04), prismGeo(band(l, -half + BRIDGE_EDGE, -half), BRIDGE_TOP, 0.04));
      // 轉角底下的橋墩
      for (let i = 1; i < l.length - 1; i++)
        pierGeos.push(new THREE.BoxGeometry(0.7, 1, 0.7 * BRIDGE_W).translate(0, -0.5, 0).applyMatrix4(turn(l[i - 1], l[i + 1], l[i], BRIDGE_TOP - BRIDGE_DECK_T)));
      for (const side of [1, -1]) {
        const line = offsetLine(l, side * (half - BRIDGE_POST_IN));
        // 柱子：每一段平均分（轉角也有一根）
        const posts: Array<[Pt, Pt]> = [];
        for (let i = 1; i < line.length; i++) {
          const [a, b] = [line[i - 1], line[i]];
          const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / BRIDGE_PANEL));
          for (let k = 0; k < n; k++) posts.push([[a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n]]);
        }
        const last = posts[posts.length - 1];
        for (const [o, [p, q]] of [...posts.map((x): [Pt, [Pt, Pt]] => [x[0], x]), [last[1], last] as [Pt, [Pt, Pt]]]) {
          postGeos.push(new THREE.BoxGeometry(BRIDGE_POST_W, BRIDGE_POST_H, BRIDGE_POST_W).translate(0, BRIDGE_POST_H / 2, 0).applyMatrix4(turn(p, q, o, floor)));
          postGeos.push(ball.clone().translate(o[0], floor + BRIDGE_POST_H + BRIDGE_BALL_R * 0.85, -o[1]));
        }
        for (const [p, q] of posts) {
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          railGeos.push(new THREE.BoxGeometry(len, BRIDGE_RAIL_T, BRIDGE_RAIL_T).applyMatrix4(at(p, q, floor + BRIDGE_RAIL_H)));
          const h = BRIDGE_RAIL_H - BRIDGE_RAIL_T / 2;
          panelGeos.push(new THREE.PlaneGeometry(Math.max(0.1, len - BRIDGE_POST_W), h).translate(0, h / 2, 0).applyMatrix4(at(p, q, floor)));
        }
      }
    }
    if (edgeGeos.length) {
      add(mergeGeometries(edgeGeos), mat(0xd8d6d0), true);
      if (pierGeos.length) add(mergeGeometries(pierGeos), mat(0x8e8c86));
      add(mergeGeometries(postGeos), mat(0xdedcd5), true);
      add(mergeGeometries(railGeos), mat(0xc4452c), true);
      add(mergeGeometries(panelGeos), new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide }), true);
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

  // ---- 外圍的矮牆、鐵欄杆：外框每一邊扣掉入口（入口投影到邊上、離邊 1.5 公尺內，前後各半個寬，兩邊再多 GATE_CLEAR），剩下的一段段蓋牆
  const gates = Z.gates.map(([lat, lng, w]) => ({ at: en([lat, lng]), w: w + 2 * GATE_CLEAR }));
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

  /**
   * 翠亨亭（照使用者給的照片）：整座灰色水泥。墊高的台基，邊上一圈矮牆（可以坐、靠），兩個短邊中間留缺口、外面三階台階；
   * 四根灰色圓柱，上面一圈橫樑、柱頭一塊斗栱；四坡頂：長邊方向一條正脊（兩頭翹起來），屋面往裡凹、四個角往上往外翹，簷下白色。
   * 屋頂外框照 OSM（屋簷），台基、柱子、高度看照片估的（PAV_*）
   */
  const pavilion = (ring: Pt[], color: string): void => {
    const r = rectOf(ring);
    // s 沿著長邊、q 沿著短邊；a、b 是一半長
    const [ax, a, b]: [Pt, number, number] = r.a >= r.b ? [r.ax, r.a, r.b] : [[-r.ax[1], r.ax[0]], r.b, r.a];
    const ay: Pt = [-ax[1], ax[0]];
    const P = (s: number, q: number): Pt => [r.c[0] + s * ax[0] + q * ay[0], r.c[1] + s * ax[1] + q * ay[1]];
    const rot = Math.atan2(ax[1], ax[0]);
    /** 長方塊：沿 s 長 ls、沿 q 長 lq、高 h，底的中間在 (s, q, y) */
    const block = (ls: number, lq: number, h: number, s: number, q: number, y: number): THREE.BufferGeometry => {
      const o = P(s, q);
      return new THREE.BoxGeometry(ls, h, lq).translate(0, h / 2, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(rot).setPosition(o[0], y, -o[1]));
    };
    const concrete: THREE.BufferGeometry[] = [];
    // 台基、矮牆（短邊中間留 PAV_GATE 的缺口）、台階（四階一樣高，最上面一階是台基）
    const [ba, bb] = [a - PAV_BASE_IN, b - PAV_BASE_IN];
    concrete.push(block(2 * ba, 2 * bb, PAV_BASE_H, 0, 0, 0));
    for (const sg of [1, -1]) {
      concrete.push(block(2 * ba, PAV_SEAT_T, PAV_SEAT_H, 0, sg * (bb - PAV_SEAT_T / 2), PAV_BASE_H));
      const piece = bb - PAV_GATE / 2;
      for (const qg of [1, -1]) concrete.push(block(PAV_SEAT_T, piece, PAV_SEAT_H, sg * (ba - PAV_SEAT_T / 2), qg * (bb - piece / 2), PAV_BASE_H));
      const rise = PAV_BASE_H / 4;
      for (let k = 1; k <= 3; k++) concrete.push(block(0.3, PAV_GATE, rise * k, sg * (ba + 0.15 + 0.3 * (3 - k)), 0, 0));
    }
    // 屋面的高度：離最近的屋簷 d（到正脊 d = b），往裡凹（t 的 1.5 次方），四個角往上翹；flare 是四個角往外推多少
    const near = (s: number, q: number): number => Math.min(Math.abs(s) / a, Math.abs(q) / b);
    const roofY = (s: number, q: number): number => {
      const t = Math.max(0, Math.min(1, Math.min(a - Math.abs(s), b - Math.abs(q)) / b));
      return PAV_EAVE + (PAV_RIDGE - PAV_EAVE) * t ** 1.5 + PAV_CORNER_UP * near(s, q) ** 3 * (1 - t) ** 2;
    };
    const flare = (s: number, q: number): Pt => {
      const t = Math.max(0, Math.min(1, Math.min(a - Math.abs(s), b - Math.abs(q)) / b));
      const k = 1 + PAV_FLARE * near(s, q) ** 3 * (1 - t) ** 2;
      return P(s * k, q * k);
    };
    // 柱子、橫樑、柱頭的斗栱（頂到屋面底下）
    const [cs, cq] = [a - PAV_COL_IN, b - PAV_COL_IN];
    const colH = PAV_BEAM_TOP - PAV_BASE_H;
    const cols: THREE.BufferGeometry[] = [];
    for (const sg of [1, -1])
      for (const qg of [1, -1]) {
        const o = P(sg * cs, qg * cq);
        cols.push(new THREE.CylinderGeometry(PAV_COL_R, PAV_COL_R, colH, 14).translate(o[0], PAV_BASE_H + colH / 2, -o[1]));
        concrete.push(block(0.44, 0.44, roofY(sg * cs, qg * cq) - PAV_ROOF_T - PAV_BEAM_TOP + 0.05, sg * cs, qg * cq, PAV_BEAM_TOP));
      }
    for (const sg of [1, -1]) {
      concrete.push(block(2 * cs + 0.3, 0.22, 0.32, 0, sg * cq, PAV_BEAM_TOP - 0.32));
      concrete.push(block(0.22, 2 * cq + 0.3, 0.32, sg * cs, 0, PAV_BEAM_TOP - 0.32));
    }
    // 屋面：四片（兩片梯形在長邊、兩片三角形在短邊），每片 (s, q) 照 u（沿著屋簷）、t（屋簷到屋脊）排成網格；上面屋瓦、下面往下 PAV_ROOF_T 是白色的簷下，屋簷那一圈接起來
    const NU = 16;
    const NT = 10;
    const top: number[] = [];
    const under: number[] = [];
    const rim: number[] = [];
    const quad = (out: number[], p: number[], q: number[], r: number[], w: number[]): void => void out.push(...p, ...q, ...r, ...p, ...r, ...w);
    const faces: Array<(u: number, t: number) => [number, number]> = [];
    for (const sg of [1, -1]) {
      faces.push((u, t) => [(2 * u - 1) * (a - t * b) * sg, sg * (b - t * b)]);
      faces.push((u, t) => [sg * (a - t * b), (1 - 2 * u) * (b - t * b) * sg]);
    }
    for (const f of faces) {
      const v = (u: number, t: number, dy: number): number[] => {
        const [s, q] = f(u, t);
        const o = flare(s, q);
        return [o[0], roofY(s, q) - dy, -o[1]];
      };
      for (let j = 0; j < NT; j++)
        for (let i = 0; i < NU; i++) {
          const [u0, u1, t0, t1] = [i / NU, (i + 1) / NU, j / NT, (j + 1) / NT];
          quad(top, v(u0, t0, 0), v(u1, t0, 0), v(u1, t1, 0), v(u0, t1, 0));
          quad(under, v(u0, t0, PAV_ROOF_T), v(u0, t1, PAV_ROOF_T), v(u1, t1, PAV_ROOF_T), v(u1, t0, PAV_ROOF_T));
        }
      for (let i = 0; i < NU; i++) quad(rim, v(i / NU, 0, PAV_ROOF_T), v((i + 1) / NU, 0, PAV_ROOF_T), v((i + 1) / NU, 0, 0), v(i / NU, 0, 0));
    }
    const geo = (pos: number[]): THREE.BufferGeometry => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      return g;
    };
    add(geo(top), mat(color, { side: THREE.DoubleSide }), true);
    // 簷下：從下面看只照得到草地反射的綠光（HemisphereLight 的地面色），照片上是白的，所以不照光、直接用淺灰白
    add(geo(under), new THREE.MeshBasicMaterial({ color: 0xd8d6d0, side: THREE.DoubleSide }));
    add(geo(rim), mat(0x8f8b82, { side: THREE.DoubleSide }), true);
    // 正脊（兩頭一塊往上翹的）、四條垂脊（沿著屋面的斜角到翹起來的角）
    const ridge: THREE.BufferGeometry[] = [block(2 * (a - b) + 0.3, 0.24, 0.22, 0, 0, PAV_RIDGE - 0.04)];
    for (const sg of [1, -1]) {
      const o = P(sg * (a - b + 0.12), 0);
      ridge.push(
        new THREE.BoxGeometry(0.26, 0.32, 0.24)
          .translate(0, 0.16, 0)
          .applyMatrix4(new THREE.Matrix4().makeRotationZ(-sg * 0.25))
          .applyMatrix4(new THREE.Matrix4().makeRotationY(rot).setPosition(o[0], PAV_RIDGE + 0.1, -o[1])),
      );
      for (const qg of [1, -1]) {
        const pts = Array.from({ length: 13 }, (_, k) => {
          const t = 1 - k / 12;
          const [s, q] = [sg * (a - t * b), qg * (b - t * b)];
          const o2 = flare(s, q);
          return new THREE.Vector3(o2[0], roofY(s, q) + 0.06, -o2[1]);
        });
        ridge.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.07, 6).toNonIndexed());
      }
    }
    add(mergeGeometries(ridge.map((g) => (g.index ? g.toNonIndexed() : g))), mat(0x7b766c), true);
    add(mergeGeometries(concrete), mat(0xa5a39c), true);
    add(mergeGeometries(cols), mat(0x9c9a93), true);
  };

  // ---- 建築：紀念館（牆、四面斜的黃色琉璃瓦、中間紅褐色平頂），翠亨亭（pavilion），其他照屋頂顏色的平頂方塊
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
      pavilion(ring, color);
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
  // ---- 銅像廣場（碑林）：墊高的石頭平台、東邊的石階、花台、西邊的黑色石牆
  const plazaRing = ringEN(Z.statuePlaza);
  const canvasTex = (S: number, draw: (g: CanvasRenderingContext2D) => void, repeat: number): THREE.CanvasTexture => {
    const cv = document.createElement('canvas');
    [cv.width, cv.height] = [S, S];
    draw(cv.getContext('2d')!);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / repeat, 1 / repeat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  };
  // 灰色的石板：一塊 0.6 公尺見方，深淺有一點不一樣、細細的縫（一張 2.4 公尺見方）
  const paving = mat(0xffffff, {
    map: canvasTex(
      256,
      (g) => {
        for (let i = 0; i < 4; i++)
          for (let j = 0; j < 4; j++) {
            const v = 172 + Math.floor(hash(i * 7 + j * 13 + 901) * 22);
            g.fillStyle = `rgb(${v}, ${v - 2}, ${v - 6})`;
            g.fillRect(i * 64, j * 64, 64, 64);
          }
        g.strokeStyle = 'rgba(90, 88, 84, 0.55)';
        g.lineWidth = 2;
        for (let k = 0; k <= 4; k++) {
          g.beginPath();
          g.moveTo(k * 64, 0);
          g.lineTo(k * 64, 256);
          g.moveTo(0, k * 64);
          g.lineTo(256, k * 64);
          g.stroke();
        }
      },
      2.4,
    ),
  });
  const plazaSide = mat(0x8f8b84);
  add(prismGeo(shapeOf(plazaRing), 0, PLAZA_H), [paving, plazaSide], true);
  // 東邊的石階：平台邊上 plazaSteps 那一段，一階一階往外（往人行道）
  const [stepA, stepB] = Z.plazaSteps.map(en);
  const stepLen = Math.hypot(stepB[0] - stepA[0], stepB[1] - stepA[1]);
  const along: Pt = [(stepB[0] - stepA[0]) / stepLen, (stepB[1] - stepA[1]) / stepLen];
  const plazaC: Pt = [plazaRing.reduce((t, p) => t + p[0], 0) / plazaRing.length, plazaRing.reduce((t, p) => t + p[1], 0) / plazaRing.length];
  // 往外（離開平台中心）的方向
  let out: Pt = [along[1], -along[0]];
  if ((stepA[0] - plazaC[0]) * out[0] + (stepA[1] - plazaC[1]) * out[1] < 0) out = [-out[0], -out[1]];
  const stepMid: Pt = [(stepA[0] + stepB[0]) / 2, (stepA[1] + stepB[1]) / 2];
  const stepAng = Math.atan2(along[1], along[0]);
  for (let k = 0; k < PLAZA_STEPS; k++) {
    const h = (PLAZA_H * (PLAZA_STEPS - k)) / PLAZA_STEPS;
    const d = (k + 0.5) * STEP_DEPTH;
    const st = add(new THREE.BoxGeometry(stepLen, h, STEP_DEPTH), [plazaSide, plazaSide, paving, plazaSide, plazaSide, plazaSide], true);
    st.position.set(stepMid[0] + out[0] * d, h / 2, -(stepMid[1] + out[1] * d));
    st.rotation.y = stepAng;
  }
  // 南邊一道不鏽鋼扶手（從平台上沿著台階斜下來）
  {
    const steel = mat(0xd3d7da);
    const run = PLAZA_STEPS * STEP_DEPTH;
    const base: Pt = [stepA[0] + along[0] * 0.25, stepA[1] + along[1] * 0.25];
    const top = new THREE.Vector3(base[0] - out[0] * 0.3, PLAZA_H + 0.9, -(base[1] - out[1] * 0.3));
    const bot = new THREE.Vector3(base[0] + out[0] * (run + 0.3), 0.9, -(base[1] + out[1] * (run + 0.3)));
    const rail = add(new THREE.CylinderGeometry(0.025, 0.025, top.distanceTo(bot), 8), steel, true);
    rail.position.copy(top).add(bot).multiplyScalar(0.5);
    rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bot.clone().sub(top).normalize());
    for (const t of [0, 0.5, 1]) {
      const at = top.clone().lerp(bot, t);
      const post = add(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 8), steel, true);
      post.position.set(at.x, at.y - 0.45, at.z);
    }
  }
  // 北邊一排圓圓的矮樹叢（人行道上，台階旁邊到平台的角）
  {
    const bushMat = mat(0x5f9a3c, { flatShading: true });
    const north = plazaRing.reduce((b, p) => ((p[0] - plazaC[0]) * out[0] + (p[1] - plazaC[1]) * out[1] > 0 && (p[0] - stepB[0]) * along[0] + (p[1] - stepB[1]) * along[1] > 0 ? p : b), stepB);
    const len = (north[0] - stepB[0]) * along[0] + (north[1] - stepB[1]) * along[1];
    for (let t = 0.8; t < len - 0.4; t += 1.15) {
      const b = add(new THREE.IcosahedronGeometry(0.58, 1), bushMat, true);
      b.position.set(stepB[0] + along[0] * t + out[0] * 0.75, 0.45, -(stepB[1] + along[1] * t + out[1] * 0.75));
      b.scale.set(1, 0.85, 1);
      b.rotation.y = hash(Math.round(t * 10)) * 3;
    }
  }
  // 花台：石頭邊框、上面種滿紅色粉紅色的花（中間的方塊、四個角的 L 形）
  const flowers = mat(0xffffff, {
    map: canvasTex(
      128,
      (g) => {
        g.fillStyle = '#3d6b33';
        g.fillRect(0, 0, 128, 128);
        for (let k = 0; k < 520; k++) {
          const t = hash(k + 4000);
          g.fillStyle = t < 0.55 ? '#d8344a' : t < 0.85 ? '#f07a98' : t < 0.93 ? '#fbd2dc' : '#2f5a2a';
          g.beginPath();
          g.arc(hash(k * 2 + 4100) * 128, hash(k * 2 + 4101) * 128, 1.6 + hash(k + 4300) * 2.2, 0, Math.PI * 2);
          g.fill();
        }
      },
      1.2,
    ),
  });
  const bedStone = mat(0xa9a59c);
  // 中間的花台是發射口（下面另外做成兩扇門）
  for (const i of Z.flowerBeds.slice(1)) {
    const r = ringEN(Z.green[i]);
    add(prismGeo(shapeOf(r), PLAZA_H, BED_H), [flowers, bedStone], true);
  }
  const bedRings = Z.flowerBeds.map((i) => ringEN(Z.green[i]));
  // 花台中間那一大塊：米色偏粉的大石板（照使用者給的照片；範圍是四個角 L 形花台裡面）
  const centerBed = ringEN(Z.green[Z.flowerBeds[0]]);
  const bedC: Pt = [centerBed.reduce((t, p) => t + p[0], 0) / centerBed.length, centerBed.reduce((t, p) => t + p[1], 0) / centerBed.length];
  {
    const [ux, uy] = [(stepB[0] - stepA[0]) / stepLen, (stepB[1] - stepA[1]) / stepLen];
    const sq = (h: number): Pt[] => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]): Pt => [bedC[0] + out[0] * a * h + ux * b * h, bedC[1] + out[1] * a * h + uy * b * h]);
    const pink = mat(0xffffff, {
      map: canvasTex(
        256,
        (g) => {
          for (let i = 0; i < 4; i++)
            for (let j = 0; j < 4; j++) {
              const v = hash(i * 5 + j * 11 + 977) * 16;
              g.fillStyle = `rgb(${214 + v}, ${188 + v}, ${172 + v})`;
              g.fillRect(i * 64, j * 64, 64, 64);
            }
          g.strokeStyle = 'rgba(120, 104, 96, 0.5)';
          g.lineWidth = 2;
          for (let k = 0; k <= 4; k++) {
            g.beginPath();
            g.moveTo(k * 64, 0);
            g.lineTo(k * 64, 256);
            g.moveTo(0, k * 64);
            g.lineTo(256, k * 64);
            g.stroke();
          }
        },
        3.2,
      ),
    });
    add(flatGeo([shapeOf(sq(PINK_HALF))], PLAZA_H + 0.004), pink);
  }
  // 平台上的草皮：灰色細點點的石條圍一圈，裡面是草（跟草地一樣的草圖，也長立體的草）
  const plazaLawnRings = Z.plazaLawns.map((i) => ringEN(Z.green[i]));
  add(flatGeo(plazaLawnRings.map((r) => shapeOf(r)), PLAZA_H + 0.008), mat(0x9d9a94));
  const plazaLawnInner = plazaLawnRings.map((r) => inset(r, LAWN_EDGE));
  add(flatGeo(plazaLawnInner.map((r) => shapeOf(r)), PLAZA_H + 0.012), grass);

  // ---- 發射口（中間的花台）和火箭：跟雷達共用同一支（在哪一邊、停著還是收著記在 park.ts 的 rocketNow）
  // 花台分成南北兩扇門：打開時先往下沉、再往兩邊滑進平台底下，底下是黑黑的井
  const bedST = centerBed.map((q): Pt => [(q[0] - bedC[0]) * out[0] + (q[1] - bedC[1]) * out[1], (q[0] - bedC[0]) * along[0] + (q[1] - bedC[1]) * along[1]]);
  const [bedHS, bedHT] = [Math.max(...bedST.map((q) => Math.abs(q[0]))), Math.max(...bedST.map((q) => Math.abs(q[1])))];
  const bedAt = (a: number, b: number): Pt => [bedC[0] + out[0] * a + along[0] * b, bedC[1] + out[1] * a + along[1] * b];
  const doors = [1, -1].map((sign) => {
    const ring: Pt[] = [bedAt(-bedHS, 0), bedAt(bedHS, 0), bedAt(bedHS, sign * bedHT), bedAt(-bedHS, sign * bedHT)];
    const m = new THREE.Mesh(prismGeo(shapeOf(sign > 0 ? ring : [...ring].reverse()), PLAZA_H, BED_H), [flowers, bedStone]);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    return { m, sign };
  });
  scene.add(new THREE.Mesh(flatGeo([shapeOf(inset(centerBed, 0.12))], PLAZA_H + 0.006), new THREE.MeshBasicMaterial({ color: 0x050505 })));
  /** 門開到哪（0 關、1 開）：前一半往下沉，後一半往兩邊滑開 */
  const setDoors = (k: number): void => {
    const sink = Math.min(1, k * 2) * (BED_H + 0.06);
    const slide = Math.max(0, k * 2 - 1) * (bedHT + 0.3);
    for (const d of doors) d.m.position.set(along[0] * slide * d.sign, -sink, -along[1] * slide * d.sign);
  };
  const rk = rocketModel();
  // 圓窗朝東（朝石階、紀念館）
  rk.group.rotation.y = Math.atan2(out[0], -out[1]);
  rk.group.visible = false;
  scene.add(rk.group);
  const ROCKET_TOP = PLAZA_H + BED_H;
  const ROCKET_HIDE = PLAZA_H - ROCKET_H - 0.5;
  const ease = (x: number): number => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
  };
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  /** 火箭在 (高度 y) 的樣子；回傳要不要一直重畫 */
  const placeRocket = (y: number, k: number, fire: boolean, now: number): void => {
    rk.group.position.set(bedC[0], y, -bedC[1]);
    rk.group.visible = y > ROCKET_HIDE + 0.01;
    rk.flame.visible = fire;
    if (fire) rk.flame.scale.set(1, 0.85 + 0.3 * Math.abs(Math.sin(now / 37)), 1);
    setDoors(k);
  };
  /** 照 park.ts 的火箭擺好火箭和發射口（叫出來、收回去、從另一邊飛來降進井裡）；回傳要不要一直重畫 */
  function updateRocket(now: number): boolean {
    const r = rocketNow(now);
    if (r.world !== world || r.phase === 'stored' || r.phase === 'away' || r.phase === 'depart') {
      placeRocket(ROCKET_HIDE, 0, false, now);
      return false;
    }
    if (r.phase === 'parked') {
      placeRocket(ROCKET_TOP, 0, false, now);
      return false;
    }
    if (r.phase === 'summon') {
      const u = r.e / SUMMON_MS;
      placeRocket(u < 0.2 ? ROCKET_HIDE : lerp(ROCKET_HIDE, ROCKET_TOP, ease((u - 0.2) / 0.55)), u < 0.2 ? ease(u / 0.2) : u < 0.78 ? 1 : 1 - ease((u - 0.78) / 0.22), false, now);
    } else if (r.phase === 'stow') {
      const u = r.e / STOW_MS;
      placeRocket(u < 0.22 ? ROCKET_TOP : lerp(ROCKET_TOP, ROCKET_HIDE, ease((u - 0.22) / 0.55)), u < 0.22 ? ease(u / 0.22) : u < 0.8 ? 1 : 1 - ease((u - 0.8) / 0.2), false, now);
    } else {
      // 從另一邊飛來：門打開，火箭噴著火從上面降下來、降進井裡，門關上
      const u = r.e / ARRIVE_MS;
      const y = u < 0.6 ? lerp(ROCKET_TOP + 40, ROCKET_TOP, 1 - Math.pow(1 - u / 0.6, 2.2)) : lerp(ROCKET_TOP, ROCKET_HIDE, ease((u - 0.6) / 0.22));
      placeRocket(y, u < 0.15 ? ease(u / 0.15) : u < 0.85 ? 1 : 1 - ease((u - 0.85) / 0.15), u < 0.6, now);
    }
    return true;
  }
  // 碑林：西邊一道長長的黑色石牆（一塊塊黑色的石碑排成一道，上面刻字），站在平台上
  const [wallA, wallB] = Z.steleWall.map(en);
  const wallLen = Math.hypot(wallB[0] - wallA[0], wallB[1] - wallA[1]);
  {
    const wallMid: Pt = [(wallA[0] + wallB[0]) / 2, (wallA[1] + wallB[1]) / 2];
    const ang = Math.atan2(wallB[1] - wallA[1], wallB[0] - wallA[0]);
    const black = mat(0x26282b);
    const body = add(new THREE.BoxGeometry(wallLen, STELE_WALL_H, STELE_WALL_T), black, true);
    body.position.set(wallMid[0], PLAZA_H + STELE_WALL_H / 2, -wallMid[1]);
    body.rotation.y = ang;
    const cap = add(new THREE.BoxGeometry(wallLen + 0.1, 0.08, STELE_WALL_T + 0.1), mat(0x3a3c40), true);
    cap.position.set(wallMid[0], PLAZA_H + STELE_WALL_H + 0.04, -wallMid[1]);
    cap.rotation.y = ang;
    // 朝廣場那一面：一塊塊石碑（1.2 公尺寬）的縫、淡淡的刻字
    const slabs = Math.max(1, Math.round(wallLen / 1.2));
    const face = canvasTex(
      256,
      (g) => {
        g.fillStyle = '#26282b';
        g.fillRect(0, 0, 256, 256);
        g.fillStyle = 'rgba(190, 188, 180, 0.5)';
        for (let c = 0; c < 9; c++)
          for (let r = 0; r < 14; r++) {
            if (hash(c * 31 + r + 7000) < 0.25) continue;
            g.fillRect(40 + c * 20, 30 + r * 14, 10 + hash(c * 17 + r + 7100) * 5, 8);
          }
        g.fillStyle = 'rgba(10, 10, 12, 0.9)';
        g.fillRect(0, 0, 4, 256);
      },
      1,
    );
    face.repeat.set(slabs, 1);
    const toward = (plazaC[0] - wallMid[0]) * Math.cos(ang + Math.PI / 2) + (plazaC[1] - wallMid[1]) * Math.sin(ang + Math.PI / 2) > 0 ? 1 : -1;
    const n: Pt = [Math.cos(ang + Math.PI / 2) * toward, Math.sin(ang + Math.PI / 2) * toward];
    const front = new THREE.Mesh(new THREE.PlaneGeometry(wallLen, STELE_WALL_H - 0.1), mat(0xffffff, { map: face }));
    front.position.set(wallMid[0] + n[0] * (STELE_WALL_T / 2 + 0.005), PLAZA_H + STELE_WALL_H / 2, -(wallMid[1] + n[1] * (STELE_WALL_T / 2 + 0.005)));
    // 平面本來朝 +z（南）：轉到朝 n（公園座標的東、北 → three 的 x、-z）
    front.rotation.y = Math.atan2(n[0], -n[1]);
    front.receiveShadow = true;
    scene.add(front);
  }
  /** 撞到碑林的牆、花台、銅像 */
  const hitPlaza = (p: Pt): boolean => {
    const [dx, dy] = [wallB[0] - wallA[0], wallB[1] - wallA[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - wallA[0]) * dx + (p[1] - wallA[1]) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(wallA[0] + dx * t - p[0], wallA[1] + dy * t - p[1]) < STELE_WALL_T / 2 + 0.3) return true;
    if (bedRings.some((r) => inside(p, r))) return true;
    const s0 = en(Z.statue);
    return Math.hypot(p[0] - s0[0], p[1] - s0[1]) < 1.25;
  };
  /** 平台、石階的高度（不在上面是 0） */
  const plazaFloor = (p: Pt): number => {
    if (inside(p, plazaRing)) return PLAZA_H;
    const a = (p[0] - stepA[0]) * along[0] + (p[1] - stepA[1]) * along[1];
    const d = (p[0] - stepA[0]) * out[0] + (p[1] - stepA[1]) * out[1];
    if (a < 0 || a > stepLen || d < 0 || d > PLAZA_STEPS * STEP_DEPTH) return 0;
    return (PLAZA_H * (PLAZA_STEPS - Math.floor(d / STEP_DEPTH))) / PLAZA_STEPS;
  };

  // 孫中山銅像（照雷達上的畫法，用一樣的大小）：白色的石頭台座（2 公尺寬、0.3 公尺高）上，坐在高椅背、圓圓扶手的椅子上，
  // 大腿平放、小腿垂下來、手從肩膀垂下來放在膝蓋上，頭朝前（鼻子、耳朵、鬍子），面向東邊的紀念館。在自己的座標裡 +x 是前面、+y 是上面
  const sp = en(Z.statue);
  const statue = new THREE.Group();
  statue.position.set(sp[0], PLAZA_H, -sp[1]);
  statue.rotation.y = Math.atan2(out[1], out[0]);
  {
    const body = mat(0x8a5a24);
    const dark = mat(0x5e3c18);
    const stoneTop = mat(0xd8d2c6);
    const put = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, sc?: [number, number, number]): THREE.Mesh => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      if (sc) mesh.scale.set(...sc);
      mesh.castShadow = mesh.receiveShadow = true;
      statue.add(mesh);
      return mesh;
    };
    /** 兩點之間的一節（手腳），半徑 r */
    const limb = (a: [number, number, number], b: [number, number, number], r: number, m: THREE.Material): void => {
      const [va, vb] = [new THREE.Vector3(...a), new THREE.Vector3(...b)];
      const mesh = put(new THREE.CapsuleGeometry(r, Math.max(0.01, va.distanceTo(vb)), 4, 10), m, 0, 0, 0);
      mesh.position.copy(va).add(vb).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    };
    // 雷達上的座標（往前 x、往上是負的 y）→ 這裡（往前 X、高度 H）
    const X = (x: number): number => 0.175 + x;
    const H = (y: number): number => 0.3 - y;
    put(new THREE.BoxGeometry(2, 0.3, 1.6), stoneTop, 0, 0.15, 0);
    // 椅子：椅座、椅背（上面圓圓的）、兩邊圓圓的扶手
    put(new THREE.BoxGeometry(0.72, 0.5, 1.0), dark, (X(-0.5) + X(0.22)) / 2, (H(0) + H(-0.5)) / 2, 0);
    put(new THREE.BoxGeometry(0.18, H(-1.42) - H(-0.45), 1.0), dark, (X(-0.5) + X(-0.32)) / 2, (H(-0.45) + H(-1.42)) / 2, 0);
    limb([X(-0.41), H(-1.44), -0.46], [X(-0.41), H(-1.44), 0.46], 0.09, dark);
    for (const z of [-0.43, 0.43]) limb([X(-0.42), H(-0.72), z], [X(0.16), H(-0.72), z], 0.11, dark);
    // 上身（中山裝）：圓圓有厚度的身體、圓圓的肩膀，立領、前面一排扣子、胸前和下面各兩個口袋蓋
    const seam = mat(0x6a4419);
    put(new THREE.CapsuleGeometry(0.2, 0.48, 8, 18), body, X(-0.12), (H(-0.5) + H(-1.38)) / 2 + 0.02, 0, [0.82, 1, 1.25]);
    for (const z of [-1, 1]) put(new THREE.SphereGeometry(0.085, 12, 8), body, X(-0.14), H(-1.28), z * 0.28);
    put(new THREE.CylinderGeometry(0.075, 0.085, 0.07, 16), body, X(-0.05), H(-1.4), 0);
    const front = X(-0.12) + 0.2 * 0.82;
    for (const h of [-1.3, -1.15, -1.0, -0.85, -0.7]) put(new THREE.SphereGeometry(0.013, 8, 6), seam, front + 0.004, H(h), 0);
    for (const z of [-1, 1]) {
      put(new THREE.BoxGeometry(0.012, 0.035, 0.1), seam, front, H(-1.18), z * 0.12);
      put(new THREE.BoxGeometry(0.012, 0.04, 0.13), seam, front, H(-0.74), z * 0.13);
    }
    // 衣襬蓋在大腿上
    put(new THREE.BoxGeometry(0.26, 0.06, 0.5), body, X(-0.02), H(-0.62), 0);
    // 大腿（平放）、小腿（垂下來、往前一點）、鞋子
    for (const z of [-0.12, 0.12]) {
      limb([X(-0.15), H(-0.64), z], [X(0.4), H(-0.64), z], 0.12, body);
      limb([X(0.36), H(-0.6), z], [X(0.4), H(-0.14), z], 0.085, body);
      // 褲腳、鞋子
      put(new THREE.CylinderGeometry(0.095, 0.095, 0.03, 12), seam, X(0.4), H(-0.15), z);
      put(new THREE.SphereGeometry(1, 12, 8), dark, X(0.46), H(-0.04), z, [0.15, 0.06, 0.07]);
    }
    // 手：從肩膀垂下來到手肘、再往前放在膝蓋上
    for (const z of [-1, 1]) {
      limb([X(-0.14), H(-1.28), z * 0.29], [X(-0.08), H(-0.92), z * 0.31], 0.075, body);
      limb([X(-0.08), H(-0.92), z * 0.31], [X(0.27), H(-0.83), z * 0.21], 0.068, body);
      // 袖口
      const cuff = put(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 12), seam, X(0.27), H(-0.83), z * 0.21);
      cuff.rotation.z = Math.PI / 2 - 0.25;
      put(new THREE.SphereGeometry(0.06, 10, 8), body, X(0.33), H(-0.81), z * 0.19);
    }
    // 右手拿著一捲紙（放在膝蓋上）
    limb([X(0.24), H(-0.79), -0.19], [X(0.4), H(-0.79), -0.19], 0.028, body);
    // 脖子、頭（鼻子朝前、兩邊耳朵、鬍子）
    limb([X(-0.05), H(-1.36), 0], [X(-0.05), H(-1.46), 0], 0.065, dark);
    put(new THREE.SphereGeometry(0.15, 18, 12), body, X(-0.05), H(-1.56), 0, [0.95, 1.08, 0.9]);
    const nose = put(new THREE.ConeGeometry(0.022, 0.05, 8), body, X(0.105), H(-1.545), 0);
    nose.rotation.z = -Math.PI / 2;
    // 眼睛（淺淺的凹下去，深色）、兩邊耳朵、八字鬍（鼻子下面往兩邊斜下來）
    for (const z of [-0.05, 0.05]) put(new THREE.SphereGeometry(0.018, 8, 6), dark, X(0.085), H(-1.59), z);
    for (const z of [-0.14, 0.14]) put(new THREE.SphereGeometry(0.035, 8, 6), body, X(-0.07), H(-1.56), z);
    for (const z of [-1, 1]) limb([X(0.09), H(-1.505), z * 0.008], [X(0.075), H(-1.485), z * 0.06], 0.011, dark);
  }
  scene.add(statue);

  // ---- 樹：樹幹、樹冠（一團低多邊形，照樹冠半徑；高度是估的），全部用 InstancedMesh 一次畫
  // 樹幹不長在步道上：樹的中心（樹幹）離步道中線不到半個步道寬（櫻花步道比較寬）加樹幹、0.3 公尺的，整棵往旁邊推到步道外面
  // （樹冠是航照的範圍，樹幹在哪本來就是照樹冠中心估的；推了還在步道上就再推，最多 4 次；推到水裡、建築裡的不畫）
  const pathSegs = [
    ...pathLines.flatMap((l) => l.slice(1).map((q, i): [Pt, Pt, number] => [[l[i][0], l[i][1]], [q[0], q[1]], (l[i][2] + q[2]) / 4])),
    ...sakura.flatMap((l) => l.slice(1).map((q, i): [Pt, Pt, number] => [l[i], q, SAKURA_W / 2])),
  ];
  const offPath = (at: Pt, r: number): Pt | null => {
    let p = at;
    let moved = false;
    for (let k = 0; k < 4; k++) {
      let best: { d: number; a: Pt; b: Pt; clear: number } | null = null;
      for (const [a, b, half] of pathSegs) {
        if (Math.abs(p[0] - a[0]) > 60 && Math.abs(p[0] - b[0]) > 60) continue;
        const d = segDist(p, a, b);
        const clear = half + trunkR(r) + 0.3;
        if (d < clear && (!best || d - clear < best.d - best.clear)) best = { d, a, b, clear };
      }
      if (!best) return moved && !personOk(ll(p[0], p[1])) ? null : p;
      const { a, b, clear } = best;
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const c: Pt = [a[0] + dx * t, a[1] + dy * t];
      let [nx, ny] = [p[0] - c[0], p[1] - c[1]];
      let l = Math.hypot(nx, ny);
      // 剛好在中線上：往步道的左邊推
      if (l < 1e-6) [nx, ny, l] = [-dy, dx, Math.hypot(dx, dy) || 1];
      p = [c[0] + (nx / l) * (clear + 0.05), c[1] + (ny / l) * (clear + 0.05)];
      moved = true;
    }
    return null;
  };
  // 站在鋪面上（不在草地、步道、建築）的樹：TREE_TO_LAWN_M 內有草地的，移到最近的草地上（離邊 0.6 公尺、不在步道上）；
  // 附近沒有草地的（廣場上種的大樹）留著
  const lawnEdges = lawnEN.flatMap(({ r }) => r.map((a, i): [Pt, Pt] => [a, r[(i + 1) % r.length]]));
  const blds = Z.buildings.map(ringEN);
  const onAnyPath = (p: Pt): boolean => pathSegs.some(([a, b, half]) => segDist(p, a, b) < half + 0.3);
  const toLawn = (p: Pt): Pt => {
    if (onLawnEN(p) || blds.some((b) => inside(p, b))) return p;
    let best: { d: number; q: Pt } | null = null;
    for (const [a, b] of lawnEdges) {
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const L = Math.hypot(dx, dy) || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (L * L)));
      const c: Pt = [a[0] + dx * t, a[1] + dy * t];
      const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
      if (d > TREE_TO_LAWN_M || (best && d >= best.d)) continue;
      for (const s of [0.6, -0.6]) {
        const q: Pt = [c[0] - (dy / L) * s, c[1] + (dx / L) * s];
        if (onLawnEN(q) && !onAnyPath(q)) {
          best = { d, q };
          break;
        }
      }
    }
    return best ? best.q : p;
  };
  const trees = Z.trees.flatMap(([lat, lng, r]) => {
    const at = offPath(en([lat, lng]), r);
    const p = at ? toLawn(at) : null;
    // 銅像廣場的平台上沒有樹（旁邊的樹冠蓋過來，樹幹在外面）
    return p && !inside(p, plazaRing) ? [{ at: p, r }] : [];
  });
  const trunkGeo = new THREE.CylinderGeometry(0.75, 1, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  const trunks = new THREE.InstancedMesh(trunkGeo, mat(0x6e5640), trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, mat(0xffffff, { flatShading: true }), trees.length);
  // 樹影有葉縫透光：樹冠算影子時用一張有很多小洞的圖（白的擋光、黑的透光）
  {
    const S = 128;
    const cv = document.createElement('canvas');
    [cv.width, cv.height] = [S, S];
    const g = cv.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#000000';
    for (let k = 0; k < 70; k++) {
      g.beginPath();
      g.arc(hash(k * 3 + 501) * S, hash(k * 3 + 502) * S, 2 + hash(k * 3 + 503) * 5, 0, Math.PI * 2);
      g.fill();
    }
    const holes = new THREE.CanvasTexture(cv);
    holes.wrapS = holes.wrapT = THREE.RepeatWrapping;
    crowns.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: holes, alphaTest: 0.5 });
  }
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
  // ---- 一叢叢的草（只長在你附近，走到別的地方重排）
  const tuftMesh = (() => {
    // 一小片一小片的草叢：兩片交叉的板子（寬 1、高 0.5，照每一叢的大小放大），貼著一張透明底、幾十根草葉的圖（三種），
    // 法線朝上（跟地面一樣受光，不會一片亮一片暗）
    const cardTex = (seed: number): THREE.DataTexture => {
      const [W, H] = [256, 128];
      const cv = document.createElement('canvas');
      [cv.width, cv.height] = [W, H];
      const g = cv.getContext('2d')!;
      g.lineCap = 'round';
      for (let k = 0; k < 45; k++) {
        const r = (n: number): number => hash(seed * 1000 + k * 7 + n);
        const x = 10 + r(1) * (W - 20);
        const len = H * (0.45 + 0.5 * r(2));
        const lean = (r(3) - 0.5) * 0.8;
        const tone = r(4);
        // 跟地面的草差不多的綠（少一點深綠），近的、遠的接得起來
        // 跟地面的草幾乎同色（亮一點點），遠的、近的接得起來
        g.strokeStyle = tone < 0.45 ? '#a3cd6c' : tone < 0.9 ? '#8dbf5c' : '#78ad4d';
        g.lineWidth = 2.5 + r(5) * 2;
        g.beginPath();
        g.moveTo(x, H);
        g.quadraticCurveTo(x + Math.sin(lean) * len * 0.3, H - len * 0.6, x + Math.sin(lean) * len, H - Math.cos(lean) * len);
        g.stroke();
      }
      // 透明的地方也填草綠（只是看不到）：縮小的時候草葉邊緣混到的是綠色，不會混到黑色變暗；上下顛倒放進貼圖（貼圖的第一列在下面）
      const src = g.getImageData(0, 0, W, H).data;
      const out = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const [i, o] = [(y * W + x) * 4, ((H - 1 - y) * W + x) * 4];
          const on = src[i + 3] >= 128;
          out[o] = on ? src[i] : 0x9e;
          out[o + 1] = on ? src[i + 1] : 0xcc;
          out[o + 2] = on ? src[i + 2] : 0x68;
          out[o + 3] = on ? 255 : 0;
        }
      const t = new THREE.DataTexture(out, W, H, THREE.RGBAFormat);
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    };
    const geo = (() => {
      const pos: number[] = [];
      const uv: number[] = [];
      for (const ang of [0, Math.PI / 2]) {
        const [c, sn] = [Math.cos(ang) * 0.5, Math.sin(ang) * 0.5];
        const q = [[-c, 0, -sn, 0, 0], [c, 0, sn, 1, 0], [c, 0.5, sn, 1, 1], [-c, 0.5, -sn, 0, 1]];
        // 正反兩面各一份（只畫正面）：雙面材質的背面法線會翻過來朝下、變暗，這樣兩面都朝上受光
        for (const k of [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]) {
          pos.push(q[k][0], q[k][1], q[k][2]);
          uv.push(q[k][3], q[k][4]);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      return g;
    })();
    // 每一格照這一叢離鏡頭多遠變矮（GRASS_FADE～GRASS_NEAR 平順地沒入地面，走路時不會一圈圈跳）
    const fadeByDistance = (m: THREE.Material): THREE.Material => {
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec4 grassAt = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            transformed.y *= 1.0 - smoothstep(${GRASS_FADE.toFixed(1)}, ${GRASS_NEAR.toFixed(1)}, distance(grassAt.xz, cameraPosition.xz));
          #endif`,
        );
      };
      return m;
    };
    return [1, 2, 3].map((seed) => {
      const im = new THREE.InstancedMesh(geo, fadeByDistance(new THREE.MeshLambertMaterial({ map: cardTex(seed), alphaTest: 0.5 })), GRASS_MAX);
      im.count = 0;
      im.receiveShadow = true;
      im.frustumCulled = false;
      scene.add(im);
      return im;
    });
  })();
  const lawnRings = Z.green.flatMap((r, i) => (bedSet.has(i) ? [] : [ringEN(r)])).map((r) => {
    const xs = r.map((p) => p[0]);
    const ys = r.map((p) => p[1]);
    return { r, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
  for (const r of fillQuads) {
    const xs = r.map((p) => p[0]);
    const ys = r.map((p) => p[1]);
    lawnRings.push({ r, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
  const onLawn = (p: Pt): boolean => lawnRings.some(({ r, box }) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3] && inside(p, r));
  // 步道（含櫻花步道）5 公尺一格的索引：草不長在路上
  const segGrid = new Map<string, Array<[Pt, Pt, number]>>();
  for (const sg of pathSegs) {
    const [a, b] = sg;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
    const keys = new Set<string>();
    for (let t = 0; t <= n; t++) keys.add(`${Math.floor((a[0] + ((b[0] - a[0]) * t) / n) / 5)},${Math.floor((a[1] + ((b[1] - a[1]) * t) / n) / 5)}`);
    for (const k of keys) segGrid.set(k, [...(segGrid.get(k) ?? []), sg]);
  }
  const onPath = (p: Pt): boolean => {
    for (let i = Math.floor(p[0] / 5) - 1; i <= Math.floor(p[0] / 5) + 1; i++)
      for (let j = Math.floor(p[1] / 5) - 1; j <= Math.floor(p[1] / 5) + 1; j++)
        for (const [a, b, half] of segGrid.get(`${i},${j}`) ?? []) if (segDist(p, a, b) < half + 0.1) return true;
    return false;
  };
  /** 格子 (i, j) 的第 n 個亂數（0～1，每次都一樣） */
  const cellRnd = (i: number, j: number, n: number): number => {
    let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(n + 1, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  let grassAt = '';
  /** 人走到別的一塊（GRASS_CHUNK 公尺）就重排附近的草 */
  function placeGrass(): void {
    const key = `${Math.floor(pos[0] / GRASS_CHUNK)},${Math.floor(pos[1] / GRASS_CHUNK)}`;
    if (key === grassAt) return;
    grassAt = key;
    const counts = [0, 0, 0];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    // 排到 GRASS_NEAR 再多一塊（走到下一塊重排之前，邊上的也都有草，畫的時候照距離變矮）
    const R = GRASS_NEAR + GRASS_CHUNK;
    const [i0, i1] = [Math.floor((pos[0] - R) / GRASS_CELL), Math.floor((pos[0] + R) / GRASS_CELL)];
    const [j0, j1] = [Math.floor((pos[1] - R) / GRASS_CELL), Math.floor((pos[1] + R) / GRASS_CELL)];
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        if (cellRnd(i, j, 0) < 0.1) continue;
        const p: Pt = [(i + cellRnd(i, j, 1)) * GRASS_CELL, (j + cellRnd(i, j, 2)) * GRASS_CELL];
        const dist = Math.hypot(p[0] - pos[0], p[1] - pos[1]);
        if (dist > R || !onLawn(p) || onPath(p) || (inside(p, plazaRing) && !plazaLawnInner.some((r) => inside(p, r)))) continue;
        const v = Math.floor(cellRnd(i, j, 3) * 3);
        if (counts[v] >= GRASS_MAX) continue;
        // 草叢 0.18～0.26 公尺寬、高一半（9～13 公分）；越遠越矮在畫的時候算（fadeByDistance）
        const size = 0.18 + 0.08 * cellRnd(i, j, 4);
        q.setFromAxisAngle(up, cellRnd(i, j, 5) * Math.PI * 2);
        m.compose(new THREE.Vector3(p[0], plazaFloor(p) + 0.02, -p[1]), q, new THREE.Vector3(size, size * (0.8 + 0.4 * cellRnd(i, j, 6)), size));
        tuftMesh[v].setMatrixAt(counts[v]++, m);
      }
    tuftMesh.forEach((im, v) => {
      im.count = counts[v];
      im.instanceMatrix.needsUpdate = true;
    });
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
  const canStand = (p: Pt): boolean => personOk(ll(p[0], p[1])) && !hitTrunk(p) && !hitWall(p) && !hitPlaza(p);
  /** 腳下多高：橋上是橋面、旗台上是旗台 */
  const floorAt = (p: Pt): number => (onBridge(p) ? BRIDGE_TOP : inside(p, flagBaseRing) ? FLAG_BASE_H : plazaFloor(p));

  // ---- 標記：路燈、長椅、垃圾桶、其他（伺服器上的，加上正在放、正在改的那一個）
  const markGroup = new THREE.Group();
  scene.add(markGroup);
  const markMats = {
    pole: mat(0x4a4f55),
    black: mat(0x1f2124),
    glass: mat(0xfbf6ea, { emissive: 0xffe6b8, emissiveIntensity: 0.45 }),
    granite: mat(0xc9c7c1),
    stele: mat(0x9a978f),
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
    } else if (kind === 'stele') {
      // 灰色的石碑：方形的底座、高高的碑身（照使用者給的照片，大小估的），刻字的那面朝 -z
      put(new THREE.BoxGeometry(0.95, 0.35, 0.75), markMats.granite, 0, 0.175, 0);
      put(new THREE.BoxGeometry(0.62, 2.3, 0.42), markMats.stele, 0, 0.35 + 1.15, 0);
      put(new THREE.BoxGeometry(0.7, 0.12, 0.5), markMats.granite, 0, 0.35 + 2.3 + 0.06, 0);
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
    // 小法會走過去聞（汪星的雷達也是同一隻）
    setSniffMarks(marks);
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
      el.textContent = `${draft.id ? `改 #${draft.id} ` : '新的'}${KIND_NAME[draft.kind]}・離你 ${d.toFixed(1)} 公尺・${draft.lat.toFixed(7)}, ${draft.lng.toFixed(7)}${draft.kind === 'bench' || draft.kind === 'stele' ? `・面向 ${Math.round(draft.heading)}°` : ''}`;
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
      marks = o.token ? await fetchParkMarks(o.token) : await fetchPublicParkMarks();
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
  // 點小法的範圍：看不到的一顆球，比小法大一點、離越遠越大（小法 0.38 公尺高，手機上離遠一點只剩幾個像素，點不到就拿不到卡）
  const dogHit = new THREE.Mesh(dogBall, new THREE.MeshBasicMaterial({ visible: false }));
  dogHit.matrixAutoUpdate = false;
  dogRoot.add(dogHit);
  const dogMeshes = new Map<string, THREE.Mesh>();
  // 身體的底、眼睛鼻子：跟雷達上一樣是平平的顏色（亮暗看毛）
  const dogMats = new Map<string, THREE.MeshBasicMaterial>();
  // 地上的影子：小法自己的座標是（往前、往左、往上），圓本來就躺在「前、左」那一面（不用轉；以前轉成直立的，影子立在身體正中間，
  // 站著被毛蓋住看不到，趴下來身體變矮就從背上露出來，像身上一塊黑黑的），前後長、左右窄，離地 3 公釐不跟地面搶
  const dogShadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  dogShadow.scale.set(0.26, 0.16, 1);
  dogShadow.position.set(0, 0, 0.003);
  dogRoot.add(dogShadow);
  // 一根根的毛（跟雷達上一樣有粗細：每一段是一條朝著鏡頭的窄帶子，每一格重算位置，顏色照亮中暗）
  const HAIR_MAX = Math.ceil(DOG_HAIRS * 1.3);
  const hairPos = new Float32Array(HAIR_MAX * HAIR_SEGS * 4 * 3);
  const hairCol = new Float32Array(hairPos.length);
  const hairIdx = new Uint32Array(HAIR_MAX * HAIR_SEGS * 6);
  for (let q = 0; q < HAIR_MAX * HAIR_SEGS; q++) hairIdx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6);
  const hairGeo = new THREE.BufferGeometry();
  hairGeo.setIndex(new THREE.BufferAttribute(hairIdx, 1));
  hairGeo.setAttribute('position', new THREE.BufferAttribute(hairPos, 3).setUsage(THREE.DynamicDrawUsage));
  hairGeo.setAttribute('color', new THREE.BufferAttribute(hairCol, 3).setUsage(THREE.DynamicDrawUsage));
  const hairMesh = new THREE.Mesh(hairGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  hairMesh.frustumCulled = false;
  dogRoot.add(hairMesh);
  const dogInv = new THREE.Matrix4();
  const toneRGB = new Map<string, [number, number, number]>();
  const rgbOf = (hex: string): [number, number, number] => {
    let c = toneRGB.get(hex);
    if (!c) {
      const k = new THREE.Color(hex);
      toneRGB.set(hex, (c = [k.r, k.g, k.b]));
    }
    return c;
  };
  const v3 = (q: [number, number, number]): THREE.Vector3 => new THREE.Vector3(q[0], q[1], q[2]);
  /** 擺好小法（離你太遠就藏起來）；回傳要不要一直重畫 */
  function drawDog(now: number): boolean {
    // 地球的中山公園沒有小法（小法只在汪星）
    if (world !== 'woof') {
      dogRoot.visible = false;
      return false;
    }
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
    const headDeg = b0 + turn * dogTurned(s, d.e);
    const B = (headDeg * Math.PI) / 180;
    // 狗自己的座標（往前、往左、往上）→ 公園（x 往東、y 往上、z 往南）
    const fwd = new THREE.Vector3(Math.sin(B), 0, -Math.cos(B));
    const left = new THREE.Vector3(-Math.cos(B), 0, -Math.sin(B));
    dogRoot.matrix.makeBasis(fwd, left, new THREE.Vector3(0, 1, 0)).setPosition(p[0], floorAt(p), -p[1]);
    dogRoot.matrixWorldNeedsUpdate = true;
    // 點的範圍：身體中間，半徑 DOG_HIT_M，5 公尺外照距離放大（15 公尺外約 1.35 公尺）
    const hr = DOG_HIT_M * Math.max(1, Math.hypot(p[0] - pos[0], p[1] - pos[1]) / 5);
    dogHit.matrix.makeScale(hr, hr, hr).setPosition(0, 0, DOG_HEAD_Y * 0.6);
    dogHit.matrixWorldNeedsUpdate = true;
    // 點了轉頭看你：頭轉向你站的地方（最多 80 度）、抬頭看你（照你們之間多遠、你的眼睛多高，抬六成五，越近抬越高：3～40 度，坐著少 8 度）；
    // 轉過來面向你坐下的時候，轉好了也抬頭看你
    let pose = dogPose(s, d.e, turn);
    const g = Math.max(xiaofa.glancing(now), s.pet ? dogTurned(s, d.e) : 0);
    if (g > 0) {
      const toYou = (Math.atan2(pos[0] - p[0], pos[1] - p[1]) * 180) / Math.PI;
      const look = Math.max(-80, Math.min(80, -wrap(toYou - headDeg)));
      const up = (Math.atan2(floorAt(pos) + EYE - (floorAt(p) + DOG_HEAD_Y), Math.hypot(pos[0] - p[0], pos[1] - p[1])) * 180) / Math.PI;
      // 抬六成五就有在看你的感覺（抬太多頭會仰到天上），越近抬越高（站在旁邊 40 度）；坐下時身體已經仰起來，頭少抬 8 度（近的時候一樣抬得比較高）
      const lift = Math.max(3, Math.min(40, up * 0.65) - (s.do === 'sit' ? 8 : 0));
      // 尾巴翹起來開心地搖
      pose = { ...pose, look: pose.look * (1 - g) + look * g, nod: pose.nod * (1 - g) - lift * g, blink: g > 0.9 ? 0 : pose.blink, wag: pose.wag * (1 - g) + happyWag(now) * g, tail: pose.tail * (1 - g) };
    }
    const all = dogParts(xiaofa.look, pose);
    // 毛：照面積分 DOG_HAIRS 根（臉附近密一點），每一根從表面往外長、捲成 C 字、往下垂；跟雷達上一樣：
    // 背對你的不畫，照「左上前方」的光（照你看過去的方向，不是太陽）分亮中暗，粗細照畫面上約 0.6 公分、最細 0.6 像素、最粗 2 像素
    {
      const look = xiaofa.look;
      const furred = all.filter((x) => x.hair > 0);
      const total = furred.reduce((t, x) => t + dogPartArea(x.a) * x.dense, 0) || 1;
      const dotv = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const norm3 = (a: number[]): number[] => {
        const l = Math.hypot(a[0], a[1], a[2]) || 1;
        return [a[0] / l, a[1] / l, a[2] / l];
      };
      const cross3 = (a: number[], b: number[]): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      // 鏡頭在狗自己的座標裡在哪，看過去的方向、畫面的右邊和上面
      dogInv.copy(dogRoot.matrix).invert();
      const cam = camera.position.clone().applyMatrix4(dogInv);
      const toward = norm3([cam.x, cam.y, cam.z - 0.25]);
      const right = norm3(cross3([0, 0, 1], toward));
      const upS = cross3(toward, right);
      const light = norm3([0, 1, 2].map((j) => -0.5 * right[j] + 0.7 * upS[j] + 0.5 * toward[j]));
      const dist = Math.hypot(cam.x, cam.y, cam.z - 0.25);
      const pxPerM = root.clientHeight / (2 * dist * Math.tan((camera.fov * Math.PI) / 360));
      const half = Math.max(0.6, Math.min(2, 0.006 * pxPerM)) / pxPerM / 2;
      let k = 0;
      const cap = HAIR_MAX * HAIR_SEGS;
      for (const part of furred) {
        const n = Math.round((DOG_HAIRS * dogPartArea(part.a) * part.dense) / total);
        const hs = dogHairRoots(part.key, n);
        const [a0, a1, a2] = part.a;
        const r2 = [dotv(a0, a0), dotv(a1, a1), dotv(a2, a2)];
        const tones = part.tones.map(rgbOf);
        for (let i = 0; i < n && k < cap - HAIR_SEGS; i++) {
          const h = hs[i];
          const nr = norm3([0, 1, 2].map((j) => (a0[j] * h.s[0]) / r2[0] + (a1[j] * h.s[1]) / r2[1] + (a2[j] * h.s[2]) / r2[2]));
          if (dotv(nr, toward) < -0.25) continue;
          const root0 = [0, 1, 2].map((j) => part.c[j] + a0[j] * h.s[0] + a1[j] * h.s[1] + a2[j] * h.s[2]);
          const L = dotv(nr, light);
          const col = tones[L > 0.2 ? 0 : L > -0.55 ? 1 : 2];
          const len = part.hair * h.len;
          // 旁邊的方向（捲的方向）
          const side = norm3(Math.abs(nr[2]) > 0.95 ? cross3(nr, [1, 0, 0]) : cross3(nr, [0, 0, 1]));
          const A = root0.map((v, j) => v - nr[j] * len * 0.25);
          const Cc = root0.map((v, j) => v + nr[j] * len * (0.6 + 0.3 * look.curl) + side[j] * len * look.curl * 0.9 * h.curl);
          const T = root0.map((v, j) => v + nr[j] * len * (0.65 - 0.25 * look.curl) + (j === 2 ? -len * (0.45 - 0.15 * look.curl) * part.droop : 0));
          let prev = A;
          for (let g = 1; g <= HAIR_SEGS; g++) {
            const t = g / HAIR_SEGS;
            const q = [0, 1, 2].map((j) => (1 - t) * (1 - t) * A[j] + 2 * (1 - t) * t * Cc[j] + t * t * T[j]);
            // 朝著鏡頭的窄帶子：往這一段和看過去的方向都垂直的方向各推半個寬
            const w = norm3(cross3([q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]], toward)).map((v) => v * half);
            hairPos.set([prev[0] - w[0], prev[1] - w[1], prev[2] - w[2], prev[0] + w[0], prev[1] + w[1], prev[2] + w[2], q[0] - w[0], q[1] - w[1], q[2] - w[2], q[0] + w[0], q[1] + w[1], q[2] + w[2]], k * 12);
            hairCol.set([...col, ...col, ...col, ...col], k * 12);
            prev = q;
            k++;
          }
        }
      }
      hairGeo.setDrawRange(0, k * 6);
      hairGeo.attributes.position.needsUpdate = true;
      hairGeo.attributes.color.needsUpdate = true;
    }
    const puff = (key: string): number => (all.find((x) => x.key === key)?.hair ?? 0) * FUR_PUFF;
    const [headPuff, mouthPuff] = [puff('head'), puff('muzzle')];
    const muzzle = all.find((x) => x.key === 'muzzle');
    const used = new Set<string>();
    for (const part of all) {
      let mesh = dogMeshes.get(part.key);
      if (!mesh) {
        let m = dogMats.get(part.fill);
        if (!m) dogMats.set(part.fill, (m = new THREE.MeshBasicMaterial({ color: part.fill })));
        mesh = new THREE.Mesh(dogBall, m);
        mesh.matrixAutoUpdate = false;
        dogMeshes.set(part.key, mesh);
        dogRoot.add(mesh);
      }
      if ((mesh.material as THREE.MeshBasicMaterial).color.getHexString() !== part.fill.slice(1)) {
        let m = dogMats.get(part.fill);
        if (!m) dogMats.set(part.fill, (m = new THREE.MeshBasicMaterial({ color: part.fill })));
        mesh.material = m;
      }
      used.add(part.key);
      let c = v3(part.c);
      let axes = part.a.map(v3);
      if (part.hair > 0) {
        // 毛底下的身體：每個半軸加長一點點（FUR_BASE 倍的毛長），毛從這裡長出來
        const h = part.hair * FUR_BASE;
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
  /** 手機搖桿推到底多久了（秒）：超過 STICK_RUN_S 慢慢加速到快走 */
  let stickHeld = 0;
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
    // 手機：搖桿推到底超過 STICK_RUN_S 秒，再 0.6 秒慢慢加速到快走（跟電腦按 Shift 一樣快），圓鈕變橘色
    const full = stick.id >= 0 && Math.hypot(stick.x, stick.y) > 0.92;
    stickHeld = full ? stickHeld + dt : 0;
    const boost = 1 + (FAST - 1) * Math.min(1, Math.max(0, (stickHeld - STICK_RUN_S) / 0.6));
    knob.classList.toggle('run', boost > 1.05);
    if (l < 0.05) return !!turn;
    const k = (Math.min(1, l) / l) * WALK * (keys.has('shift') ? FAST : boost) * dt;
    const [fx, fy] = [Math.sin(yaw), Math.cos(yaw)];
    const d: Pt = [(fx * f + fy * s) * k, (fy * f - fx * s) * k];
    // 撞到了就沿著牆滑過去
    for (const step of [d, [d[0], 0] as Pt, [0, d[1]] as Pt]) {
      const next: Pt = [pos[0] + step[0], pos[1] + step[1]];
      // 一下子高低差太多（平台的邊、不是石階的地方）上不去、下不來
      if (canStand(next) && Math.abs(floorAt(next) - floorAt(pos)) < 0.3) {
        pos = next;
        break;
      }
    }
    return true;
  }

  // ---- 點一下：標記模式下點地面放、點標記改
  const ray = new THREE.Raycaster();
  /** 不是在標記：點銅像叫出、收回火箭，點停著的火箭問要不要飛到另一邊 */
  function tapScene(cx: number, cy: number): void {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
    const targets: THREE.Object3D[] = [statue];
    if (rk.group.visible) targets.push(rk.group);
    if (dogRoot.visible) targets.push(dogRoot);
    const hit = ray.intersectObjects(targets, true).find((h) => !(h.object instanceof THREE.LineSegments));
    if (!hit || hit.distance > 80) return;
    let g: THREE.Object3D | null = hit.object;
    while (g && g !== statue && g !== rk.group && g !== dogRoot) g = g.parent;
    if (g === dogRoot) {
      // 點小法：轉頭看你，或轉過來面向你坐下（跟雷達上一樣，「你」是你站的地方）
      const at = xiaofa.now().at;
      const you = ll(pos[0], pos[1]);
      petDog(xiaofa.id, [you[0] - at[0], you[1] - at[1]]);
      o.onPetDog?.(xiaofa.id);
      dirty = true;
      return;
    }
    if (g === statue) {
      const now = rocketNow();
      if (now.world !== world) return msg(`火箭現在在${now.world === 'woof' ? '汪星' : '地球'}`);
      if (summonRocket(world)) msg('發射口打開了，火箭升上來');
      else if (stowRocket(world)) msg('火箭收回發射口');
      dirty = true;
    } else if (g === rk.group && rocketNow().phase === 'parked' && window.confirm(world === 'earth' ? '是否要到汪星球？' : '是否要回地球？')) startFlight();
  }

  // ---- 搭火箭：鏡頭在火箭裡、從圓窗看出去——點火、往上飛（公園越來越小、穿過雲）、太空（回頭看著出發的那一顆變小、轉向另一顆越來越大）、
  // 降到另一邊的中山公園（穿過雲、看著公園越來越近），快到的時候走出火箭、站在石階前面看火箭降進井裡；整趟不能走、不能點
  type World = 'earth' | 'woof';
  interface Flight {
    t0: number;
    to: World;
    space: SpaceTrip;
    clouds: THREE.Group;
    departed: boolean;
    switched: boolean;
  }
  let flight: Flight | null = null;
  const F_BOARD = 700;
  const F_UP = 6000;
  const F_SPACE = 8000;
  const F_DOWN = 6000;
  const F_TOP = 1500;
  const flightCam = new THREE.PerspectiveCamera(55, 1, 0.5, 9000);
  const SKY = new THREE.Color(0xbcd6ea);
  const DARK = new THREE.Color(0x0b1a33);
  const fog = scene.fog as THREE.Fog;
  const cockpit = $<HTMLElement>('.p3d-cockpit');
  const gauge = $<HTMLElement>('.p3d-gauge');
  const flash = $<HTMLElement>('.p3d-flash');
  /** 畫面蓋一層白的（穿過雲、大氣）或黑的（走進、走出火箭） */
  const cover = (color: 'white' | 'black', a: number): void => {
    flash.style.background = color === 'white' ? '#ffffff' : '#000000';
    flash.style.opacity = String(Math.max(0, Math.min(1, a)));
  };
  // 點火時底下冒出來的白煙
  const smokeTex = puffTexture();
  const smoke = Array.from({ length: 18 }, () => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xeeeeee, transparent: true, depthWrite: false }));
    sp.visible = false;
    scene.add(sp);
    return sp;
  });
  const showSmoke = (t: number, base: THREE.Vector3): void =>
    smoke.forEach((sp, k) => {
      const age = (t - k * 90) / 1800;
      sp.visible = age > 0 && age < 1;
      if (!sp.visible) return;
      const a = k * 2.4;
      const r = 1.5 + age * 6;
      sp.position.set(base.x + Math.cos(a) * r, base.y + 0.5 + age * 3, base.z + Math.sin(a) * r);
      sp.scale.setScalar(2 + age * 7);
      (sp.material as THREE.SpriteMaterial).opacity = 0.85 * (1 - age);
    });
  const parkAt = (w: World): [number, number] => (w === 'woof' ? toWoof(HATCH_CENTER) : HATCH_CENTER);
  function startFlight(): void {
    const to: World = world === 'earth' ? 'woof' : 'earth';
    flight = { t0: performance.now(), to, space: spaceScene(world, parkAt(world), parkAt(to)), clouds: cloudLayer(bedC[0], -bedC[1], 850, 1250), departed: false, switched: false };
    scene.add(flight.clouds);
    keys.clear();
    [stick.x, stick.y, stick.id] = [0, 0, -1];
    if (marking) {
      marking = false;
      draft = null;
      drawMarks();
      panel();
    }
    root.classList.add('p3d-flying');
  }
  /** 鏡頭在火箭裡（離地 alt 公尺）從圓窗（朝東）看出去，看著底下的公園（越高看得越正下方、越遠），震動 amp 公尺 */
  const inRocket = (alt: number, amp: number, now: number): void => {
    const win = new THREE.Vector3(out[0], 0, -out[1]);
    flightCam.position.set(bedC[0], ROCKET_TOP + alt + ROCKET_WINDOW_Y, -bedC[1]).addScaledVector(win, 0.3);
    flightCam.position.x += Math.sin(now / 23) * amp;
    flightCam.position.y += Math.sin(now / 31) * amp;
    flightCam.up.set(0, 1, 0);
    const reach = Math.min(170, 30 + alt * 0.12);
    flightCam.lookAt(new THREE.Vector3(bedC[0], PLAZA_H, -bedC[1]).addScaledVector(win, reach));
  };
  /** 天空、霧照高度變暗、變遠 */
  const skyAt = (alt: number): void => {
    const a = Math.min(1, alt / F_TOP);
    (scene.background as THREE.Color).copy(SKY).lerp(DARK, a);
    fog.color.copy(scene.background as THREE.Color);
    fog.near = 140 + alt * 1.5;
    fog.far = 700 + alt * 4;
  };
  const altText = (alt: number): string => `高度 ${Math.round(alt).toLocaleString('zh-TW')} 公尺`;
  /** 搭火箭的這一格：鏡頭擺好，回傳要畫哪一個場景 */
  function flightStep(now: number): THREE.Scene {
    const f = flight!;
    const dest = f.to === 'woof' ? '汪星' : '地球';
    let t = now - f.t0;
    if (t < F_BOARD) {
      // 走進火箭：畫面慢慢變黑
      cover('black', t / F_BOARD);
      return scene;
    }
    if (!f.departed) {
      f.departed = true;
      departRocket(now);
      if (f.to === 'woof') moveDogs();
      rk.group.visible = false;
      cockpit.hidden = false;
    }
    t -= F_BOARD;
    const base = new THREE.Vector3(bedC[0], ROCKET_TOP, -bedC[1]);
    if (t < DEPART_MS) {
      // 點火：震動、底下冒白煙
      cover('black', 1 - t / 400);
      showSmoke(t, base);
      inRocket(0, 0.04 * (t / DEPART_MS), now);
      skyAt(0);
      gauge.textContent = `點火・前往${dest}`;
      return scene;
    }
    t -= DEPART_MS;
    if (t < F_UP) {
      const u = t / F_UP;
      const alt = F_TOP * Math.pow(u, 2.4);
      showSmoke(t + DEPART_MS, base);
      inRocket(alt, 0.04 * (1 - u), now);
      skyAt(alt);
      cover('white', (u - 0.9) / 0.1);
      gauge.textContent = `${altText(alt)}・前往${dest}`;
      return scene;
    }
    t -= F_UP;
    if (t < F_SPACE) {
      f.space.at(t / F_SPACE, flightCam);
      cover('white', 1 - t / 700);
      gauge.textContent = `太空・前往${dest}`;
      return f.space.scene;
    }
    t -= F_SPACE;
    if (!f.switched) {
      // 到了另一邊的上空（汪星的中山公園有小法）
      f.switched = true;
      world = f.to;
      for (const sp of smoke) sp.visible = false;
    }
    if (t < F_DOWN) {
      const u = t / F_DOWN;
      const alt = 40 + (F_TOP - 40) * Math.pow(1 - u, 2.5);
      inRocket(alt, 0.015, now);
      skyAt(alt);
      cover('white', 1 - t / 700);
      gauge.textContent = `${altText(alt)}・降落${dest}`;
      return scene;
    }
    land(now);
    return scene;
  }
  /** 到了：走出火箭、站在石階前面看火箭降進井裡，雷達那邊也換到這一邊 */
  let fadeIn = 0;
  function land(now: number): void {
    const f = flight!;
    flight = null;
    scene.remove(f.clouds);
    arriveRocket(world, now);
    o.onWorld?.(world);
    skyAt(0);
    cockpit.hidden = true;
    root.classList.remove('p3d-flying');
    const run = PLAZA_STEPS * STEP_DEPTH + 4;
    const front: Pt = [stepMid[0] + out[0] * run, stepMid[1] + out[1] * run];
    if (canStand(front)) pos = front;
    yaw = Math.atan2(-out[0], -out[1]);
    pitch = 0.32;
    grassAt = '';
    fadeIn = now;
    dirty = true;
    remember();
  }

  function tap(cx: number, cy: number): void {
    if (flight) return;
    if (!marking) return tapScene(cx, cy);
    if (busy) return;
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
    // 銅像廣場的平台上：照平台的高度再算一次
    for (let k = 0; k < 2; k++) {
      const h = floorAt(p);
      if (!h) break;
      t = (h - oy) / d.y;
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
      const saved = await saveParkMark(o.token ?? '', d, draft.id);
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
      await deleteParkMark(o.token ?? '', draft.id);
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
  let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
  const onDown = (e: PointerEvent): void => {
    if (drag) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
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
    // 只有左鍵（手機是手指）點一下才算點地面；右鍵拖曳一樣轉頭。
    // 沒拖動就算點一下，不看按了多久：3D 畫得慢的電腦、手機，放開的事件會晚一秒多才處理，限時間的話點小法常常沒反應
    if (!drag.moved && e.button === 0) tap(e.clientX, e.clientY);
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
  // 沒有管理 token：只看得到標好的，不能標
  $<HTMLElement>('.p3d-mark-toggle').hidden = !o.token;
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
  hint.textContent = touch ? '左下搖桿走路（推到底一下下變快走）、拖曳畫面轉頭' : '拖曳轉頭、WASD 走路（方向鍵也可以）、Shift 快走';
  const hintTimer = setTimeout(() => (hint.hidden = true), 7000);

  // ---- 畫
  const resize = (): void => {
    const [w, h] = [root.clientWidth, root.clientHeight];
    renderer.setSize(w, h);
    camera.aspect = w / h;
    // 直的手機畫面：左右至少看得到約 70 度（照左右算上下的視角，最多 95 度）
    camera.fov = Math.min(95, Math.max(65, (2 * Math.atan(Math.tan((70 / 2) * (Math.PI / 180)) / camera.aspect) * 180) / Math.PI));
    camera.updateProjectionMatrix();
    flightCam.aspect = w / h;
    flightCam.updateProjectionMatrix();
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
    if (flight) {
      const sc = flightStep(now);
      if (flight) {
        drawDog(now);
        renderer.render(sc, flightCam);
        return;
      }
    }
    // 走出火箭：畫面從黑慢慢亮起來
    if (fadeIn) {
      const a = 1 - (now - fadeIn) / 600;
      cover('black', a);
      if (a <= 0) fadeIn = 0;
      dirty = true;
    }
    if (updateRocket(now)) dirty = true;
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
    placeGrass();
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
