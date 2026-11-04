/**
 * 3D 國館的火箭和搭火箭的太空（park3d.ts 用）：
 * - rocketModel：跟雷達上同一支火箭的樣子做成立體的（約 8.5 公尺高，白色機身、紅色鼻錐、紅色腰帶、四片紅色尾翼、一個圓窗，
 *   底下會閃的火焰），原點在底下（尾翼的底），圓窗朝 +z；
 * - spaceScene：飛到另一顆星球的路上看到的：滿天的星星、地球（全世界的海岸線畫的陸地、一層雲、藍色的大氣）、
 *   汪星（跟雷達一樣：台北的陸地攤在整顆星球上、鋪滿草地，山一層一層的色塊，周圍是海，暖色的大氣），火箭從出發那一顆的中山公園飛到另一顆的中山公園；
 * - cloudLayer：火箭往上飛、往下降時穿過的一層雲。
 * 星球的大小、距離不是真的（看起來像在飛就好）
 */
import * as THREE from 'three';
import { WOOF_HILLS, WOOF_LAND } from './space';
import { WORLD_RINGS } from './world';

/** 火箭多高、窗戶在多高（跟雷達上的一樣） */
export const ROCKET_H = 8.5;
export const ROCKET_WINDOW_Y = 3.9;

const lambert = (color: number, more: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color, ...more });

/** 火箭：group 是整支（原點在底下），flame 是底下的火焰（要噴火時打開） */
export function rocketModel(): { group: THREE.Group; flame: THREE.Group } {
  const group = new THREE.Group();
  const white = lambert(0xf4f1ea);
  const red = lambert(0xd23a2f);
  const gray = lambert(0x55595f);
  const put = (g: THREE.BufferGeometry, m: THREE.Material, y = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = y;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  // 噴嘴、機身、紅色腰帶
  put(new THREE.CylinderGeometry(0.55, 0.72, 0.48, 24), gray, 0.24);
  put(new THREE.CylinderGeometry(0.9, 0.9, 5.1, 40), white, 0.3 + 5.1 / 2);
  put(new THREE.CylinderGeometry(0.915, 0.915, 0.35, 40), red, 1.175);
  // 鼻錐：從機身頂慢慢收到尖（往外鼓一點）
  const nose: THREE.Vector2[] = [];
  for (let k = 0; k <= 16; k++) {
    const u = k / 16;
    nose.push(new THREE.Vector2(0.9 * Math.pow(1 - u * u, 0.62) + 1e-4, 5.4 + 3.1 * u));
  }
  put(new THREE.LatheGeometry(nose, 40), red);
  // 四片尾翼：從機身往外斜下來
  const fin = new THREE.Shape([new THREE.Vector2(0.85, 2.4), new THREE.Vector2(1.75, 0.15), new THREE.Vector2(1.75, -0.05), new THREE.Vector2(0.85, 0.35)]);
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.1, bevelEnabled: false });
  finGeo.translate(0, 0.05, -0.05);
  for (let k = 0; k < 4; k++) {
    const f = put(finGeo, red);
    f.rotation.y = Math.PI / 4 + (k * Math.PI) / 2;
  }
  // 圓窗（朝 +z）：深藍色的玻璃、白色的框、一點反光
  const win = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.4, 32), lambert(0x2c5f8a, { emissive: 0x0d2236 }));
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 10, 32), lambert(0xd9dde2));
  const glint = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
  glint.position.set(-0.13, 0.13, 0.002);
  win.add(glass, frame, glint);
  win.position.set(0, ROCKET_WINDOW_Y, 0.905);
  group.add(win);
  // 火焰：外面橘色、裡面黃色，往下
  const flame = new THREE.Group();
  const cone = (r: number, h: number, color: number, opacity: number): THREE.Mesh => {
    const g = new THREE.ConeGeometry(r, h, 20, 1, true);
    g.rotateX(Math.PI);
    g.translate(0, -h / 2, 0);
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
  };
  flame.add(cone(0.62, 3.6, 0xff8a2a, 0.85), cone(0.32, 2.2, 0xffe28a, 0.95));
  flame.visible = false;
  group.add(flame);
  return { group, flame };
}

/** 一張中間白、邊緣透明的雲（火箭穿過的雲、太空裡的白煙也用） */
export function puffTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  [cv.width, cv.height] = [128, 128];
  const g = cv.getContext('2d')!;
  for (let k = 0; k < 9; k++) {
    const [x, y, r] = [40 + ((k * 37) % 48), 44 + ((k * 23) % 40), 26 + ((k * 11) % 18)];
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 一層雲：在 (x, z) 附近、高度 y0～y1，火箭正上方也有幾朵（一定穿過去） */
export function cloudLayer(x: number, z: number, y0: number, y1: number): THREE.Group {
  const g = new THREE.Group();
  const tex = puffTexture();
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let k = 0; k < 70; k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9 }));
    const near = k < 12;
    const r = near ? rnd() * 40 : 60 + rnd() * 700;
    const a = rnd() * Math.PI * 2;
    s.position.set(x + Math.cos(a) * r, y0 + rnd() * (y1 - y0), z + Math.sin(a) * r);
    const size = 120 + rnd() * 220;
    s.scale.set(size, size * 0.6, 1);
    g.add(s);
  }
  return g;
}

/** 一顆星球表面 (lat, lng) 的方向（跟 SphereGeometry 的貼圖一樣：經度 -180 在貼圖左邊） */
export function surfaceDir(lat: number, lng: number): THREE.Vector3 {
  const phi = ((lng + 180) * Math.PI) / 180;
  const theta = ((90 - lat) * Math.PI) / 180;
  return new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
}

/** 等距圓柱的貼圖畫布：經緯度 → 畫布座標 */
function equirect(W: number, H: number): { cv: HTMLCanvasElement; g: CanvasRenderingContext2D; xy: (lat: number, lng: number) => [number, number] } {
  const cv = document.createElement('canvas');
  [cv.width, cv.height] = [W, H];
  return { cv, g: cv.getContext('2d')!, xy: (lat, lng) => [((lng + 180) / 360) * W, ((90 - lat) / 180) * H] };
}

/** 一圈一圈的陸地填色（經度攤開成連續的，跨過換日線的往兩邊各畫一次）；color 照那一圈的平均緯度給顏色 */
function fillRings(g: CanvasRenderingContext2D, xy: (lat: number, lng: number) => [number, number], rings: Array<Array<[number, number]>>, color: (lat: number) => string): void {
  for (const ring of rings) {
    // 經度攤開成連續的（不跳過 ±180）
    const pts: Array<[number, number]> = [];
    for (const [lat, lng] of ring) {
      let l = lng;
      if (pts.length) {
        const prev = pts[pts.length - 1][1];
        while (l - prev > 180) l -= 360;
        while (prev - l > 180) l += 360;
      }
      pts.push([lat, l]);
    }
    for (const shift of [-360, 0, 360]) {
      g.beginPath();
      pts.forEach(([lat, lng], i) => {
        const [x, y] = xy(lat, lng + shift);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.closePath();
      g.fillStyle = color(pts.reduce((t, q) => t + q[0], 0) / pts.length);
      g.fill();
    }
  }
}

/** 地球的貼圖：藍色的海、綠色的陸地（全世界的海岸線，很北的（格陵蘭）偏灰） */
function earthTexture(): THREE.CanvasTexture {
  const { cv, g, xy } = equirect(2048, 1024);
  g.fillStyle = '#1d5fa8';
  g.fillRect(0, 0, 2048, 1024);
  fillRings(g, xy, WORLD_RINGS, (lat) => (Math.abs(lat) > 62 ? '#9bab8a' : '#4f8f3a'));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 地球的雲：一條條白色的雲帶（透明） */
function cloudTexture(): THREE.CanvasTexture {
  const { cv, g } = equirect(1024, 512);
  let seed = 11;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let k = 0; k < 160; k++) {
    const [x, y] = [rnd() * 1024, 60 + rnd() * 392];
    const [rx, ry] = [20 + rnd() * 70, 6 + rnd() * 14];
    const grad = g.createRadialGradient(x, y, 0, x, y, rx);
    grad.addColorStop(0, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.save();
    g.translate(x, y);
    g.scale(1, ry / rx);
    g.translate(-x, -y);
    g.fillRect(x - rx, y - rx, rx * 2, rx * 2);
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 汪星的貼圖：跟雷達一樣——海（汪星的海色），陸地是台北市的範圍攤在整顆星球上（WOOF_LAND），鋪滿草地的綠色；山一層一層疊上去（WOOF_HILLS，越高越深、最高的偏土黃） */
const WOOF_GRASS = '#6fa34f';
const WOOF_HILL_COLORS = ['#5f9445', '#50823b', '#456f33', '#77744f', '#8d8262'];
function woofTexture(): THREE.CanvasTexture {
  const { cv, g, xy } = equirect(2048, 1024);
  g.fillStyle = '#2a6496';
  g.fillRect(0, 0, 2048, 1024);
  fillRings(g, xy, WOOF_LAND, () => WOOF_GRASS);
  WOOF_HILLS.forEach((band, i) => fillRings(g, xy, band.map((h) => h.ring), () => WOOF_HILL_COLORS[i] ?? WOOF_HILL_COLORS[WOOF_HILL_COLORS.length - 1]));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface SpaceTrip {
  scene: THREE.Scene;
  /** u（0～1）走到哪：鏡頭的位置、看哪裡 */
  at: (u: number, camera: THREE.PerspectiveCamera) => void;
}

/**
 * 太空：from 那一顆在原點，to 那一顆在遠一點的地方；fromAt、toAt 是兩邊中山公園在那一顆上的經緯度。
 * 鏡頭從 from 的中山公園上方出發（先回頭看著 from 變小），慢慢轉向 to、飛到 to 的中山公園正上方（看著 to 越來越大）
 */
export function spaceScene(from: 'earth' | 'woof', fromAt: [number, number], toAt: [number, number]): SpaceTrip {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03050b);
  // 滿天的星星
  {
    const n = 3000;
    const pos = new Float32Array(n * 3);
    let seed = 3;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let k = 0; k < n; k++) {
      const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(3000);
      pos.set([v.x, v.y, v.z], k * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false })));
  }
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  // 太陽從上面照（兩邊的中山公園都轉到朝上、朝著對方，白天看得到）
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(0.25, 1, 0.35);
  scene.add(sun);
  const R_EARTH = 100;
  const R_WOOF = 85;
  const planet = (r: number, map: THREE.Texture, air: number, clouds: boolean): THREE.Group => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 96, 48), new THREE.MeshLambertMaterial({ map })));
    if (clouds) g.add(new THREE.Mesh(new THREE.SphereGeometry(r * 1.012, 96, 48), new THREE.MeshLambertMaterial({ map: cloudTexture(), transparent: true, depthWrite: false })));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(r * 1.05, 64, 32), new THREE.MeshBasicMaterial({ color: air, transparent: true, opacity: 0.18, side: THREE.BackSide, depthWrite: false })));
    return g;
  };
  const earth = planet(R_EARTH, earthTexture(), 0x7fb8ff, true);
  const woof = planet(R_WOOF, woofTexture(), 0xffd9a0, false);
  const far = new THREE.Vector3(560, 140, -420);
  const [A, B] = from === 'earth' ? [earth, woof] : [woof, earth];
  const [rA, rB] = from === 'earth' ? [R_EARTH, R_WOOF] : [R_WOOF, R_EARTH];
  B.position.copy(far);
  scene.add(earth, woof);
  // 兩顆星球轉一下：出發那一邊的中山公園朝上、朝著要去的那一顆，要去那一邊的中山公園朝上、朝著出發的那一顆
  const toward = far.clone().normalize();
  const want = (v: THREE.Vector3): THREE.Vector3 => v.clone().add(new THREE.Vector3(0, 1.1, 0)).normalize();
  const dA = want(toward);
  const dB = want(toward.clone().negate());
  A.quaternion.setFromUnitVectors(surfaceDir(...fromAt), dA);
  B.quaternion.setFromUnitVectors(surfaceDir(...toAt), dB);
  const S = dA.clone().multiplyScalar(rA + 4);
  const E = far.clone().add(dB.clone().multiplyScalar(rB + 4));
  const c1 = S.clone().add(dA.clone().multiplyScalar(160));
  const c2 = E.clone().add(dB.clone().multiplyScalar(160));
  const curve = new THREE.CubicBezierCurve3(S, c1, c2, E);
  const smooth = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return {
    scene,
    at: (u, camera) => {
      const e = u * u * (3 - 2 * u);
      camera.position.copy(curve.getPoint(e));
      // 先回頭看著出發的那一顆，一半時轉向要去的那一顆
      const look = new THREE.Vector3().lerpVectors(A.position, B.position, smooth(0.28, 0.62, u));
      camera.up.set(0, 1, 0);
      camera.lookAt(look);
    },
  };
}
