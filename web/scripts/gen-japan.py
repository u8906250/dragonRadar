"""
產生 web/src/japan.ts、web/src/jp-land.ts 的資料（日本拉遠時的都道府縣界、琵琶湖岸、地名、陸地範圍；海岸線用 eastasia.ts 的）。
用法：在 ne/ 放 world-atlas@2 的 land-10m.json、countries-10m.json 和 Natural Earth 的 GeoJSON
（ne_10m_lakes.geojson、ne_10m_admin_1_states_provinces.geojson、ne_10m_populated_places.geojson，
github.com/nvkelso/natural-earth-vector 的 geojson/），裝 shapely（pip install --target geo-lib shapely），
然後 PYTHONPATH=geo-lib python3 gen-japan.py：印出檢查結果，寫出 jp-data.txt（貼進 japan.ts）、jp-land.txt（貼進 jp-land.ts）
"""
import json, sys
sys.path.insert(0, 'geo-lib')
from shapely.geometry import Polygon, LineString, Point, box, shape
from shapely.ops import unary_union, linemerge, polylabel

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

def parts(g):
    return list(g.geoms) if hasattr(g, 'geoms') else [g]

# 日本那一塊（與那國島到北海道東端；載入、抓路的範圍）
S, W, N, E = 24.0, 122.9, 45.6, 146.0
AREA = box(W, S, E, N)

dc, gc = topo('ne/countries-10m.json')
jp = [gc(g) for g in dc['objects']['countries']['geometries'] if g.get('id') == '392'][0]
dl, gl = topo('ne/land-10m.json')
land = unary_union([gl(g) for g in dl['objects']['land']['geometries']]).intersection(AREA.buffer(0.5))

# 湖：Natural Earth 的陸地把湖算成陸地；日本在 1:10m 的湖只有琵琶湖（約 660 km²）。湖岸整圈（雷達塗海時當成水面）
lakes = [shape(f['geometry']) for f in json.load(open('ne/ne_10m_lakes.geojson'))['features'] if f['properties'].get('name') == 'Biwa Ko']
lake = unary_union(lakes)
shores = [[(y, x) for (x, y) in p.exterior.coords] for p in parts(lake.simplify(0.0036, preserve_topology=False))]
print('lake shores', len(shores), 'points', sum(len(l) for l in shores))

# 都道府縣界（陸地上的，海上、湖上的不畫）；簡化到約 250 m
prov = [f for f in json.load(open('ne/ne_10m_admin_1_states_provinces.geojson'))['features'] if f['properties'].get('adm0_a3') == 'JPN']
provs = {f['properties']['name_zht']: shape(f['geometry']).buffer(0) for f in prov}
dry = land.difference(lake)
inner = unary_union([g.boundary for g in provs.values()]).difference(jp.boundary.buffer(0.004))
lines = []
for l in parts(linemerge(inner.intersection(dry.buffer(-0.002)))):
    if not isinstance(l, LineString) or l.length < 0.02: continue
    lines.append([(y, x) for (x, y) in l.simplify(0.0025).coords])
print('pref lines', len(lines), 'points', sum(len(l) for l in lines))

# 地名：都道府縣名寫在離邊界最遠的一點（分成好幾塊的用離中心最近的大塊：東京都不跑到小笠原、鹿兒島縣不跑到奄美）；
# 城市是 Natural Earth 的城市點（首都、縣廳所在地、大城市），中文名用 Natural Earth 的繁體中文名，拿掉最後的「市」
PREF_FIX = {'東京': '東京都'}
CITY_FIX = {'仙臺': '仙台'}
plabels = []
for name, g in provs.items():
    g = g.difference(lake)
    top = max(p.area for p in parts(g))
    big = min((p for p in parts(g) if p.area > top * 0.2), key=lambda p: p.distance(g.centroid))
    pt = polylabel(big, tolerance=0.001)
    plabels.append((PREF_FIX.get(name, name), round(pt.y, 4), round(pt.x, 4)))
cities = []
for f in json.load(open('ne/ne_10m_populated_places.geojson'))['features']:
    p = f['properties']
    if p.get('ADM0_A3') != 'JPN': continue
    n = p['NAME_ZHT']
    n = n[:-1] if n.endswith('市') and len(n) > 2 else n
    cities.append((CITY_FIX.get(n, n), round(p['LATITUDE'], 4), round(p['LONGITUDE'], 4)))
print('prefs', len(plabels), ' '.join(n for n, _, _ in sorted(plabels, key=lambda r: -r[1])))
print('cities', len(cities), ' '.join(n for n, _, _ in sorted(cities, key=lambda r: -r[1])))

# 陸地範圍（拉遠時只畫日本的路、綠地、河湖用）：約 20 km² 以上的島，國界外推約 2 km（沿海的路、橋），簡化到約 1.5 km
mask = unary_union([p for p in parts(jp) if p.area > 0.002]).buffer(0.02).simplify(0.015)
mrings = [[(round(y, 3), round(x, 3)) for (x, y) in p.exterior.coords] for p in parts(mask)]
print('land rings', len(mrings), 'points', sum(len(r) for r in mrings))
inside = lambda la, ln: any(Polygon([(b, a) for a, b in r]).contains(Point(ln, la)) for r in mrings)
for name, (la, ln) in {'東京': (35.68, 139.76), '札幌': (43.06, 141.35), '那霸': (26.21, 127.68), '鹿兒島': (31.6, 130.56), '與那國': (24.47, 123.0), '佐渡': (38.02, 138.37), '瀨戶大橋': (34.4, 133.81)}.items():
    print('IN ', name, inside(la, ln))
for name, (la, ln) in {'釜山': (35.18, 129.08), '濟州': (33.5, 126.53), '海參崴': (43.12, 131.89), '台北': (25.04, 121.52), '庫頁島': (46.95, 142.73), '日本海': (38.5, 135.0)}.items():
    print('OUT', name, not inside(la, ln))

def enc(rings):
    out = []
    for r in rings:
        ints = [(round(a * 1000), round(b * 1000)) for a, b in r]
        v = [ints[0][0], ints[0][1]]
        for i in range(1, len(ints)):
            v += [ints[i][0] - ints[i - 1][0], ints[i][1] - ints[i - 1][1]]
        out.append(','.join(map(str, v)))
    return ';'.join(out)
fmt = lambda rows: ',\n'.join(f"  ['{n}', {a}, {b}]" for n, a, b in rows)
open('jp-data.txt', 'w').write(
    f"export const JP_LAKES = '{enc(shores)}';\nexport const JP_LINES = '{enc(lines)}';\n"
    f"export const JP_PREFS: Array<[string, number, number]> = [\n{fmt(sorted(plabels, key=lambda r: -r[1]))},\n];\n"
    f"export const JP_CITIES: Array<[string, number, number]> = [\n{fmt(sorted(cities, key=lambda r: -r[1]))},\n];\n")
open('jp-land.txt', 'w').write(f"export const JP_LAND_CODE = '{enc(mrings)}';\n")
