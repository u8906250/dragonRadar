"""
產生 web/src/country-fill.ts 的資料：有畫地圖的國家（荷蘭、日本、南韓、美國；台灣用 taiwan.ts 的 TAIWAN_RINGS）的形狀，
拉遠時只有這些國家塗淡淡的底色（雷達、地球、地圖頁），其他國家只畫海岸線。
用法：在 ne/ 放 world-atlas@2 的 countries-10m.json 和 Natural Earth 的 ne_10m_lakes.geojson、ne_10m_lakes_europe.geojson，裝 shapely（pip install --target geo-lib shapely），
然後 PYTHONPATH=geo-lib python3 gen-country-fill.py：印出檢查結果，寫出 country-fill.txt（貼進 country-fill.ts）
"""
import json, sys
sys.path.insert(0, 'geo-lib')
from shapely.geometry import Polygon, box, shape
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
        polys = [g['arcs']] if g['type'] == 'Polygon' else g['arcs']
        ps = []
        for p in polys:
            rs = [ring(r) for r in p]
            if len(rs[0]) >= 4: ps.append(Polygon(rs[0], [r for r in rs[1:] if len(r) >= 4]).buffer(0))
        return unary_union(ps)
    return d, geom

def parts(g):
    return list(g.geoms) if hasattr(g, 'geoms') else [g]

dc, gc = topo('ne/countries-10m.json')
c = {g.get('id'): gc(g) for g in dc['objects']['countries']['geometries'] if g.get('id') in ('528', '392', '410', '840')}
# 每個國家：只要哪一塊、簡化到多少度（拉遠到 200 km 以上才塗，約 2 km 只差幾個像素；阿拉斯加的海岸很曲折，約 4 km）；約 200 km² 以下的島不塗
ALASKA = box(-180, 51, -129.9, 72)
SHAPES = [
    ('荷蘭', c['528'].intersection(box(2, 50, 8, 54)), 0.02),
    ('日本', c['392'], 0.02),
    ('南韓', c['410'], 0.02),
    ('美國本土、夏威夷', c['840'].difference(ALASKA).intersection(box(-180, 15, -60, 50)), 0.02),
    ('阿拉斯加', c['840'].intersection(ALASKA), 0.04),
]
# 國界包含湖面（五大湖美國那一半、大鹽湖、琵琶湖、艾瑟爾湖）：約 300 km² 以上的湖扣掉，湖裡面的變成洞（另一圈，照 evenodd 塗）
lakes = unary_union([g for g in (shape(f['geometry']).buffer(0) for f in json.load(open('ne/ne_10m_lakes.geojson'))['features'] + json.load(open('ne/ne_10m_lakes_europe.geojson'))['features']) if g.area > 0.032])
rings = []
for name, g, tol in SHAPES:
    rs = []
    for p in parts(g.difference(lakes).simplify(tol)):
        if p.area <= 0.02: continue
        rs.append([(round(y, 3), round(x, 3)) for (x, y) in p.exterior.coords])
        rs += [[(round(y, 3), round(x, 3)) for (x, y) in h.coords] for h in p.interiors if Polygon(h).area > 0.02]
    print(name, len(rs), 'rings', sum(len(r) for r in rs), 'points')
    rings += rs

def enc(rings):
    out = []
    for r in rings:
        ints = [(round(a * 1000), round(b * 1000)) for a, b in r]
        v = [ints[0][0], ints[0][1]]
        for i in range(1, len(ints)):
            v += [ints[i][0] - ints[i - 1][0], ints[i][1] - ints[i - 1][1]]
        out.append(','.join(map(str, v)))
    return ';'.join(out)
open('country-fill.txt', 'w').write(f"export const COUNTRY_FILL_CODE = '{enc(rings)}';\n")
