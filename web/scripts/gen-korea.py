"""
產生 web/src/korea.ts、web/src/kr-land.ts 的資料（南韓拉遠時的道界、跟北韓的軍事分界線、地名、陸地範圍；海岸線用 eastasia.ts 的）。
用法：在 ne/ 放 world-atlas@2 的 land-10m.json、countries-10m.json 和 Natural Earth 的 GeoJSON
（ne_10m_admin_1_states_provinces.geojson、ne_10m_populated_places.geojson，github.com/nvkelso/natural-earth-vector 的 geojson/），
裝 shapely（pip install --target geo-lib shapely），然後 PYTHONPATH=geo-lib python3 gen-korea.py：
印出檢查結果，寫出 kr-data.txt（貼進 korea.ts）、kr-land.txt（貼進 kr-land.ts）
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

# 南韓那一塊（馬羅島到鬱陵島；載入的範圍）
S, W, N, E = 33.0, 124.5, 38.7, 131.0
AREA = box(W, S, E, N)

dc, gc = topo('ne/countries-10m.json')
countries = {g.get('id'): gc(g) for g in dc['objects']['countries']['geometries'] if g.get('id') in ('410', '408')}
kr, nk = countries['410'], countries['408']
dl, gl = topo('ne/land-10m.json')
land = unary_union([gl(g) for g in dl['objects']['land']['geometries']]).intersection(AREA.buffer(0.5))

# 道界（陸地上的，海上的不畫）＋跟北韓的軍事分界線；簡化到約 250 m
prov = [f for f in json.load(open('ne/ne_10m_admin_1_states_provinces.geojson'))['features'] if f['properties'].get('adm0_a3') == 'KOR']
provs = {f['properties']['name_zht']: shape(f['geometry']).buffer(0) for f in prov}
inner = unary_union([g.boundary for g in provs.values()]).difference(kr.boundary.buffer(0.004))
border = kr.boundary.intersection(nk.buffer(0.01))
onland = land.buffer(-0.002)
lines = []
for g in (inner, border):
    on = unary_union(g).intersection(onland)
    for l in parts(on if on.geom_type == 'LineString' else linemerge(on)):
        if not isinstance(l, LineString) or l.length < 0.02: continue
        lines.append([(y, x) for (x, y) in l.simplify(0.0025).coords])
print('lines', len(lines), 'points', sum(len(l) for l in lines))

# 地名：道、廣域市的名字寫在離邊界最遠的一點（分成好幾塊的用離中心最近的大塊）；廣域市、特別市只寫市名（「釜山」不寫「釜山廣域市」）
# 城市是 Natural Earth 的城市點（首都、道廳所在地、大城市），拿掉最後的「市」，簡體字改成繁體
PROV_FIX = {'仁川廣域市': '仁川', '釜山廣域市': '釜山', '蔚山廣域市': '蔚山', '大田廣域市': '大田', '光州廣域市': '光州', '大邱廣域市': '大邱', '世宗特別自治市': '世宗', '濟州特別自治道': '濟州道'}
CITY_FIX = {'安东': '安東', '济州': '濟州', '蔚山廣域市': '蔚山', '大邱廣域市': '大邱', '仁川廣域市': '仁川', '大田廣域市': '大田', '光州廣域市': '光州', '釜山廣域市': '釜山'}
plabels = []
for name, g in provs.items():
    top = max(p.area for p in parts(g))
    big = min((p for p in parts(g) if p.area > top * 0.2), key=lambda p: p.distance(g.centroid))
    pt = polylabel(big, tolerance=0.001)
    plabels.append((PROV_FIX.get(name, name), round(pt.y, 4), round(pt.x, 4)))
cities = []
for f in json.load(open('ne/ne_10m_populated_places.geojson'))['features']:
    p = f['properties']
    if p.get('ADM0_A3') != 'KOR': continue
    n = CITY_FIX.get(p['NAME_ZHT'], p['NAME_ZHT'])
    n = n[:-1] if n.endswith('市') and len(n) > 2 else n
    n = CITY_FIX.get(n, n)
    cities.append((n, round(p['LATITUDE'], 4), round(p['LONGITUDE'], 4)))
print('provinces', len(plabels), ' '.join(n for n, _, _ in sorted(plabels, key=lambda r: -r[1])))
print('cities', len(cities), ' '.join(n for n, _, _ in sorted(cities, key=lambda r: -r[1])))

# 陸地範圍（拉遠時只畫南韓的路、綠地、河湖用）：約 20 km² 以上的島，國界外推約 2 km（沿海的路、橋），簡化到約 1 km
mask = unary_union([p for p in parts(kr) if p.area > 0.002]).buffer(0.02).simplify(0.01)
mrings = [[(round(y, 3), round(x, 3)) for (x, y) in p.exterior.coords] for p in parts(mask)]
print('land rings', len(mrings), 'points', sum(len(r) for r in mrings))
inside = lambda la, ln: any(Polygon([(b, a) for a, b in r]).contains(Point(ln, la)) for r in mrings)
for name, (la, ln) in {'首爾': (37.57, 126.98), '釜山': (35.18, 129.08), '濟州': (33.5, 126.53), '鬱陵島': (37.5, 130.87), '江陵': (37.75, 128.9), '仁川機場': (37.46, 126.44)}.items():
    print('IN ', name, inside(la, ln))
for name, (la, ln) in {'開城': (37.97, 126.55), '平壤': (39.02, 125.75), '對馬': (34.4, 129.3), '福岡': (33.59, 130.4), '黃海': (36.0, 125.0), '日本海': (37.0, 130.0)}.items():
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
open('kr-data.txt', 'w').write(
    f"export const KR_LINES = '{enc(lines)}';\n"
    f"export const KR_PROVINCES: Array<[string, number, number]> = [\n{fmt(sorted(plabels, key=lambda r: -r[1]))},\n];\n"
    f"export const KR_CITIES: Array<[string, number, number]> = [\n{fmt(sorted(cities, key=lambda r: -r[1]))},\n];\n")
open('kr-land.txt', 'w').write(f"export const KR_LAND_CODE = '{enc(mrings)}';\n")
