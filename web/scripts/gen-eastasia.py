"""
產生 web/src/eastasia.ts 的資料（EA_COAST、CHINA_MASK 那兩串）。
用法：下載 world-atlas@2 的 land-10m.json、countries-10m.json 到 ne/，裝 shapely（pip install --target geo-lib shapely），
然後 PYTHONPATH=geo-lib python3 gen-eastasia.py：印出檢查結果（哪些地方在中國範圍裡），寫出 ea.json 和 eastasia-data.txt（貼進 eastasia.ts）
"""
import json, sys
sys.path.insert(0, 'geo-lib')
from shapely.geometry import Polygon, MultiPolygon, LineString, Point, box
from shapely.ops import unary_union

def topo(path):
    d = json.load(open(path))
    sx, sy = d['transform']['scale']; tx, ty = d['transform']['translate']
    arcs = []
    for a in d['arcs']:
        x = y = 0; pts = []
        for dx, dy in a:
            x += dx; y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)
    def ring(idx):
        out = []
        for i in idx:
            pts = arcs[i] if i >= 0 else arcs[~i][::-1]
            out.extend(pts if not out else pts[1:])
        return out
    def geom(g):
        if g['type'] == 'Polygon': polys = [g['arcs']]
        elif g['type'] == 'MultiPolygon': polys = g['arcs']
        else: return None
        ps = []
        for p in polys:
            rs = [ring(r) for r in p]
            if len(rs[0]) >= 4: ps.append(Polygon(rs[0], [r for r in rs[1:] if len(r) >= 4]).buffer(0))
        return unary_union(ps)
    return d, geom

# 東亞的範圍（雷達用 1:10m 的海岸線；外面照舊 1:110m）
S, W, N, E = 18.0, 108.0, 46.0, 146.0
EA = box(W, S, E, N)

dc, gc = topo('ne/countries-10m.json')
countries = {g.get('id'): gc(g) for g in dc['objects']['countries']['geometries'] if g.get('id')}
taiwan = countries['158']

dl, gl = topo('ne/land-10m.json')
land = unary_union([gl(g) for g in dl['objects']['land']['geometries']])
parts = list(land.geoms) if hasattr(land, 'geoms') else [land]
tw_buf = taiwan.buffer(0.01)
lines = []
npts = 0
for p in parts:
    if not p.intersects(EA): continue
    # 台灣（本島、澎湖、金門…）用 taiwan.ts 那份
    if tw_buf.contains(p.representative_point()): continue
    if p.area < 1e-4: continue  # 約 1 km² 以下的小島不畫
    q = p.simplify(0.0036, preserve_topology=False)
    if q.is_empty: continue
    for poly in (q.geoms if hasattr(q, 'geoms') else [q]):
        for r in [poly.exterior, *poly.interiors]:
            c = list(r.coords)
            # 切到東亞範圍裡：在範圍外的點斷開
            cur = []
            for (x, y) in c:
                if W <= x <= E and S <= y <= N:
                    cur.append((y, x))
                else:
                    if len(cur) >= 2: lines.append(cur)
                    cur = []
            if len(cur) >= 2: lines.append(cur)
for l in lines: npts += len(l)
print('ea lines', len(lines), 'points', npts)

# 中國的範圍：國界外推 3 km（沿海的海岸線也算進來），扣掉其他國家（台灣、香港、澳門…不外溢）、金門馬祖烏坵東沙一帶
china = countries['156']
mask = china.buffer(0.04)
others = unary_union([g for k, g in countries.items() if k != '156' and g is not None and g.intersects(mask.envelope)])
mask = mask.difference(others)
# 金門本島在台灣的國界裡；烈嶼、大膽、二膽 Natural Earth 沒有，用小圓圈排除（離廈門最近的海岸都還有 1 km 以上）；馬祖、烏坵、東沙離得夠遠
for la, ln, r in [(24.43, 118.24, 0.045), (24.383, 118.155, 0.012), (24.373, 118.128, 0.01)]:
    mask = mask.difference(Point(ln, la).buffer(r))
mask = mask.difference(taiwan.buffer(0.015))
mask = mask.simplify(0.01, preserve_topology=True)
mrings = []
for poly in (mask.geoms if hasattr(mask, 'geoms') else [mask]):
    if poly.area < 1e-3: continue
    for r in [poly.exterior, *poly.interiors]:
        mrings.append([(round(y, 3), round(x, 3)) for (x, y) in r.coords])
print('mask rings', len(mrings), 'points', sum(len(r) for r in mrings))

# 檢查：這些點要在中國裡面／外面
inside = {'廈門': (24.48, 118.09), '福州': (26.07, 119.30), '上海': (31.23, 121.47), '深圳': (22.54, 114.06), '北京': (39.90, 116.40), '平潭': (25.50, 119.79), '黃岐': (26.33, 119.90)}
outside = {'二膽': (24.373, 118.128), '烈嶼西岸': (24.43, 118.205), '金門': (24.44, 118.35), '烈嶼': (24.43, 118.24), '大膽': (24.384, 118.16), '南竿': (26.16, 119.95), '北竿': (26.22, 120.0), '東引': (26.37, 120.49), '莒光': (25.97, 119.94), '烏坵': (24.99, 119.45), '香港': (22.30, 114.17), '澳門': (22.19, 113.54), '台北': (25.04, 121.52), '首爾': (37.57, 126.98), '平壤': (39.03, 125.75), '海參崴': (43.12, 131.89), '河內': (21.03, 105.85), '東沙': (20.70, 116.72)}
for name, (la, ln) in inside.items():
    print('IN ', name, mask.contains(Point(ln, la)))
for name, (la, ln) in outside.items():
    print('OUT', name, not mask.contains(Point(ln, la)))
json.dump({'lines': [[[round(a, 4), round(b, 4)] for a, b in l] for l in lines], 'mask': mrings}, open('ea.json', 'w'))

# 差值編碼（跟 eastasia.ts 的 decode 對應）
def enc(rings):
    out = []
    for r in rings:
        ints = [(round(a * 1000), round(b * 1000)) for a, b in r]
        v = [ints[0][0], ints[0][1]]
        for i in range(1, len(ints)):
            v += [ints[i][0] - ints[i - 1][0], ints[i][1] - ints[i - 1][1]]
        out.append(','.join(map(str, v)))
    return ';'.join(out)
open('eastasia-data.txt', 'w').write("export const EA_COAST = '" + enc([[(round(a, 4), round(b, 4)) for a, b in l] for l in lines]) + "';\nexport const CHINA_MASK = '" + enc(mrings) + "';\n")
