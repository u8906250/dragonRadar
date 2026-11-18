"""
產生 web/src/launch-site.ts 的資料（屏東縣滿州鄉九棚村的國家發射場，國家太空中心規劃中）。
來源：「國家發射場域設置計畫環境影響說明書」（環境部環評書件系統），新聞轉載的兩張圖：
- fig43.webp：圖 4-3 本計畫基地現況圖（五千分之一縮圖），紅線是開發範圍，圖框有 TWD97 座標刻度
  （客新聞 https://gcs.hakkanews.tw/2026/05/2026-05-25-2026-05-25-54415.webp）
- render.webp：圖 5.2.5-12 本計畫景觀示意圖（發射核心區）
  （客新聞 https://gcs.hakkanews.tw/2026/05/2026-05-25-2026-05-25-54451-e1779708950965.webp）
用法：兩張圖下載到同一個資料夾，裝 numpy、shapely、Pillow（pip install --target geo-lib numpy shapely pillow），
然後 PYTHONPATH=geo-lib python3 gen-launch-site.py：印出三塊範圍的面積（合計要接近說明書的 26.02 公頃），寫出 launch-data.txt（貼進 launch-site.ts）
"""
import json, math, sys
sys.path.insert(0, 'geo-lib')
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from shapely.geometry import box, Polygon, Point
from shapely.ops import unary_union

# ---- 圖 4-3：紅線範圍 → TWD97 → 經緯度 ----
# 圖框刻度：東距 236000 在 x=87.5、238000 在 x=1374.5（每公尺 0.6435 像素，跟比例尺 500 m = 321 像素一致），北距 2446000 在 y=742.5
PX = 0.6435
def en(px, py):
    return 236000 + (px - 87.5) / PX, 2446000 + (742.5 - py) / PX

# TWD97 TM2（中央經線 121 度、k0 0.9999、東偏 250000，GRS80）反算經緯度
A, F = 6378137.0, 1 / 298.257222101
E2 = F * (2 - F); K0 = 0.9999; LON0 = math.radians(121); FE = 250000
def tm_inv(E, N):
    x = (E - FE) / K0; y = N / K0
    e1 = (1 - math.sqrt(1 - E2)) / (1 + math.sqrt(1 - E2))
    mu = y / (A * (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256))
    p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu) + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu)
    ep2 = E2 / (1 - E2); C1 = ep2 * math.cos(p1) ** 2; T1 = math.tan(p1) ** 2
    N1 = A / math.sqrt(1 - E2 * math.sin(p1) ** 2); R1 = A * (1 - E2) / (1 - E2 * math.sin(p1) ** 2) ** 1.5; D = x / N1
    lat = p1 - (N1 * math.tan(p1) / R1) * (D ** 2 / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6 / 720)
    lon = LON0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5 / 120) / math.cos(p1)
    return math.degrees(lat), math.degrees(lon)
def ll(px, py):
    la, ln = tm_inv(*en(px, py))
    return [round(la, 6), round(ln, 6)]

im = np.asarray(Image.open('fig43.webp').convert('RGB')).astype(int)
H, W, _ = im.shape
R, G, B = im[:, :, 0], im[:, :, 1], im[:, :, 2]
red = (R > 100) & (R - G > 50) & (R - B > 40)
red[1180:, 1440:] = False  # 圖例
red[:, :24] = red[:, 1862:] = False; red[1312:, :] = red[:19, :] = False
# 紅線加粗補小缺口，從外面填，填不到的就是紅線圍起來的
m = Image.fromarray(np.where(red, 255, 0).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))
ImageDraw.floodfill(m, (500, 200), 128)
inside = np.asarray(m) != 128
inside[:, :24] = inside[:, 1862:] = False; inside[1312:, :] = inside[:19, :] = False
cells = []
for y in range(H):
    row = inside[y]; x = 0
    while x < W:
        if row[x]:
            s = x
            while x < W and row[x]: x += 1
            cells.append(box(s, y, x, y + 1))
        else: x += 1
u = unary_union(cells)
polys = sorted([p for p in (u.geoms if hasattr(u, 'geoms') else [u]) if p.area > 3000], key=lambda p: -p.area)
# 線加粗了、紅線本身約 2.5 像素：往內縮回線的中間
polys = [p.buffer(-3.2, join_style=2).simplify(1.2) for p in polys]
for p in polys: print('範圍', round(p.area / PX / PX / 1e4, 2), '公頃')
print('合計', round(sum(p.area for p in polys) / PX / PX / 1e4, 2), '公頃（說明書 26.02）')
areas = [[ll(x, y) for x, y in p.exterior.coords] for p in polys]
core = polys[0]

# ---- 景觀示意圖（幾乎是正上方看）→ 圖 4-3 的像素：照四個對得上的點求仿射（誤差幾個像素） ----
# 西端、北邊伸到河口那一角、東端（橢圓最東邊）、南邊道路轉進橢圓的地方
src = np.array([[95, 478], [985, 268], [1488, 560], [1290, 585]], float)
dst = np.array([[998, 838], [1545, 655], [1766, 880], [1640, 905]], float)
aff, *_ = np.linalg.lstsq(np.hstack([src, np.ones((4, 1))]), dst, rcond=None)
print('對位誤差（像素）', np.round(np.hstack([src, np.ones((4, 1))]) @ aff - dst, 1).tolist())
def rp(x, y):
    q = np.array([x, y, 1.0]) @ aff
    return float(q[0]), float(q[1])
def rll(x, y):
    return ll(*rp(x, y))
M_PER_RPX = 1 / (PX * math.sqrt(abs(np.linalg.det(aff[:2, :2]))))  # 示意圖一個像素幾公尺（約 1.04）
def ring(pts):
    out = [rll(x, y) for x, y in pts]
    return out + [out[0]]
def ellipse(cx, cy, rx, ry, deg=0, n=40):
    a = math.radians(deg)
    pts = [(cx + rx * math.cos(t) * math.cos(a) - ry * math.sin(t) * math.sin(a), cy + rx * math.cos(t) * math.sin(a) + ry * math.sin(t) * math.cos(a)) for t in [2 * math.pi * i / n for i in range(n)]]
    return ring(pts)
def circle_m(cx, cy, r_m, n=40):
    """圓心照示意圖、半徑照公尺（示意圖斜看的圓是橢圓，取橫的半徑）"""
    ox, oy = rp(cx, cy)
    E0, N0 = en(ox, oy)
    out = []
    for i in range(n):
        t = 2 * math.pi * i / n
        la, ln = tm_inv(E0 + r_m * math.cos(t), N0 + r_m * math.sin(t))
        out.append([round(la, 6), round(ln, 6)])
    return out + [out[0]]

# 示意圖上量的（像素 ≈ 公尺）
paved = [
    ring([(205, 474), (210, 509), (365, 514), (420, 488), (420, 420), (320, 425), (255, 452)]),  # 西段公路南邊的場地
    ring([(437, 360), (453, 337), (540, 340), (547, 367), (563, 397), (527, 410), (473, 425), (440, 417)]),  # 公路北邊的場地
    ring([(898, 362), (977, 320), (1027, 345), (953, 395)]),  # 燃料、儲存場
    ellipse(1392, 544, 72, 50, 30.7),  # 最東邊的大橢圓場地
]
buildings = [
    ring([(323, 387), (380, 377), (388, 417), (337, 432)]),
    ring([(282, 432), (317, 422), (322, 443), (287, 457)]),
    ring([(288, 478), (333, 463), (340, 493), (295, 505)]),
    ring([(450, 342), (523, 347), (520, 372), (448, 368)]),
    ring([(235, 463), (250, 463), (250, 475), (235, 475)]),
]
substation = ring([(353, 447), (397, 440), (410, 473), (367, 485)])
solar = ring([(493, 327), (533, 327), (533, 343), (493, 343)])
ponds = [ellipse(927, 313, 24, 11, 8), ellipse(1025, 381, 23, 9, 8)]
pads = [
    {'at': rll(843, 315), 'r': 27, 'ring': circle_m(843, 315, 27), 'masts': 3},
    {'at': rll(1123, 420), 'r': 31, 'ring': circle_m(1123, 420, 31), 'masts': 4},
]
# 圓的槽：西段的水塔、燃料場的四個
tanks = [[*rll(488, 410), round(18.5 * M_PER_RPX, 1)]] + [[*rll(x, y), 4] for x, y in [(908, 378), (918, 373), (915, 387), (926, 381)]]
# 場內道路（中線）：西段北邊場地往東到發射台 2、大橢圓；岔路到發射台 1
roads = [
    [rll(x, y) for x, y in [(540, 372), (600, 380), (680, 390), (847, 397), (1013, 405), (1080, 418), (1123, 420), (1200, 477), (1267, 500), (1327, 518)]],
    [rll(x, y) for x, y in [(723, 386), (790, 345), (823, 322), (843, 315)]],
]
# 避雷塔：發射台 1 北邊三支，發射台 2 四周四支
def around(cx, cy, r_m, angles):
    ox, oy = rp(cx, cy); E0, N0 = en(ox, oy)
    return [[round(v, 6) for v in tm_inv(E0 + r_m * math.cos(math.radians(a)), N0 + r_m * math.sin(math.radians(a)))] for a in angles]
masts = around(843, 315, 30, [150, 100, 50]) + around(1123, 420, 34, [45, 135, 225, 315])
rocket = pads[1]['at']
for p in pads: print('發射台', p['at'], '直徑', 2 * p['r'], 'm', '在範圍裡' if core.contains(Point(*rp(*[843, 315] if p is pads[0] else [1123, 420]))) else '不在範圍裡！')

f = lambda pts: '[' + ','.join(f'[{a},{b}]' for a, b in pts) + ']'
fs = lambda rings: '[\n' + ',\n'.join('  ' + f(r) for r in rings) + ',\n]'
open('launch-data.txt', 'w').write(
    f"export const LAUNCH_AREAS: Pt[][] = {fs(areas)};\n"
    f"export const LAUNCH_PAVED: Pt[][] = {fs(paved + [p['ring'] for p in pads])};\n"
    f"export const LAUNCH_BUILDINGS: Pt[][] = {fs(buildings)};\n"
    f"export const LAUNCH_SUBSTATION: Pt[] = {f(substation)};\n"
    f"export const LAUNCH_SOLAR: Pt[] = {f(solar)};\n"
    f"export const LAUNCH_PONDS: Pt[][] = {fs(ponds)};\n"
    f"export const LAUNCH_PADS: Array<{{ at: Pt; r: number }}> = [{', '.join(f'{{ at: [{p['at'][0]}, {p['at'][1]}], r: {p['r']} }}' for p in pads)}];\n"
    f"export const LAUNCH_TANKS: Array<[number, number, number]> = [{', '.join(f'[{a}, {b}, {c}]' for a, b, c in tanks)}];\n"
    f"export const LAUNCH_ROADS: Pt[][] = {fs(roads)};\n"
    f"export const LAUNCH_MASTS: Pt[] = {f(masts)};\n"
    f"export const LAUNCH_ROCKET: Pt = [{rocket[0]}, {rocket[1]}];\n"
)
print('寫出 launch-data.txt')
