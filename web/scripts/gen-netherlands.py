"""
產生 web/src/netherlands.ts、web/src/nl-land.ts 的資料（荷蘭拉遠時的海岸線、湖岸、省界、國界、地名、陸地範圍）。
用法：在 ne/ 放 world-atlas@2 的 land-10m.json、countries-10m.json 和 Natural Earth 的 GeoJSON
（ne_10m_lakes.geojson、ne_10m_lakes_europe.geojson、ne_10m_admin_1_states_provinces.geojson、ne_10m_populated_places_simple.geojson，
github.com/nvkelso/natural-earth-vector 的 geojson/），裝 shapely（pip install --target geo-lib shapely），
然後 PYTHONPATH=geo-lib python3 gen-netherlands.py：印出檢查結果，寫出 nl-data.txt（貼進 netherlands.ts）、nl-land.txt（貼進 nl-land.ts）
"""
import json, sys
sys.path.insert(0, 'geo-lib')
from shapely.geometry import Polygon, MultiPolygon, LineString, MultiLineString, Point, box, shape
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

# 荷蘭那一塊（雷達用這裡的海岸線；world.ts 在這裡面的點不畫）：比國界大一圈，比利時、德國沿海的一段也一起換
S, W, N, E = 50.6, 2.9, 53.8, 7.6
AREA = box(W, S, E, N)

dc, gc = topo('ne/countries-10m.json')
countries = {g.get('id'): gc(g) for g in dc['objects']['countries']['geometries'] if g.get('id')}
# 只要歐洲的荷蘭（加勒比海的不算）
nl = unary_union([p for p in parts(countries['528']) if p.bounds[1] > 50])
neighbors = unary_union([countries['056'], countries['276']])  # 比利時、德國

dl, gl = topo('ne/land-10m.json')
land = unary_union([gl(g) for g in dl['objects']['land']['geometries']]).intersection(AREA.buffer(0.5))

# 湖：Natural Earth 的陸地把艾瑟爾湖（含馬克湖）、勞沃斯湖算成陸地，扣掉才畫得出湖岸；10 km² 以上的才算
lakes = []
for f in json.load(open('ne/ne_10m_lakes.geojson'))['features'] + json.load(open('ne/ne_10m_lakes_europe.geojson'))['features']:
    g = shape(f['geometry'])
    if g.intersects(AREA) and g.area > 0.0013:
        lakes.append(g)
        print('lake', f['properties'].get('name'), round(g.area * 111 * 68, 1), 'km2')
lake = unary_union(lakes)
dry = land.difference(lake)

# 海岸線、湖岸：約 1 km² 以下的小島不畫，簡化到約 400 m，切到那一塊裡面（外面的點斷開）
coast = []
for p in parts(dry):
    if not p.intersects(AREA) or p.area < 1e-4: continue
    q = p.simplify(0.0036, preserve_topology=False)
    for poly in parts(q):
        if poly.is_empty: continue
        # 整圈的雷達會當成島塗淡淡的底色：湖岸（陸地裡的洞）和弗萊福蘭（圍海造的地，四周是湖；約 450 km² 以上的只有它）
        # 分成兩半、不接成一圈，跟旁邊的陸地一樣不塗；瓦登群島這些真的島照舊
        halves = lambda c: [c[:len(c) // 2 + 1], c[len(c) // 2:]]
        ext = list(poly.exterior.coords)
        rings = halves(ext) if poly.area > 0.06 else [ext]
        for r in poly.interiors:
            rings += halves(list(r.coords))
        for r in rings:
            cur = []
            for (x, y) in r:
                if W <= x <= E and S <= y <= N:
                    cur.append((y, x))
                else:
                    if len(cur) >= 2: coast.append(cur)
                    cur = []
            if len(cur) >= 2: coast.append(cur)
print('coast lines', len(coast), 'points', sum(len(l) for l in coast))

# 省界（陸地上的，水上的不畫）＋跟比利時、德國的國界；簡化到約 250 m
prov = [f for f in json.load(open('ne/ne_10m_admin_1_states_provinces.geojson'))['features'] if f['properties'].get('adm0_a3') == 'NLD' and shape(f['geometry']).bounds[1] > 50]
provs = {f['properties']['name']: shape(f['geometry']).buffer(0) for f in prov}
inner = unary_union([g.boundary for g in provs.values()]).difference(nl.boundary.buffer(0.004))
border = nl.boundary.intersection(neighbors.buffer(0.01))
onland = dry.buffer(-0.002)
lines = []
for g in (inner, border):
    m = linemerge(unary_union(g).intersection(onland))
    for l in parts(m):
        if not isinstance(l, LineString) or l.length < 0.02: continue
        s = l.simplify(0.0025)
        lines.append([(y, x) for (x, y) in s.coords])
print('border lines', len(lines), 'points', sum(len(l) for l in lines))

# 地名：省名寫在省裡離邊界最遠的一點（扣掉湖）；城市是 Natural Earth 的城市點（首都、省會、大城市）
PROV_ZH = {'Groningen': '格羅寧根省', 'Drenthe': '德倫特省', 'Overijssel': '上艾瑟爾省', 'Gelderland': '海爾德蘭省', 'Limburg': '林堡省', 'Zeeland': '澤蘭省',
           'Noord-Brabant': '北布拉班特省', 'Zuid-Holland': '南荷蘭省', 'Noord-Holland': '北荷蘭省', 'Friesland': '弗里斯蘭省', 'Flevoland': '弗萊福蘭省', 'Utrecht': '烏特勒支省'}
CITY_ZH = {'The Hague': '海牙', 'Amsterdam': '阿姆斯特丹', 'Rotterdam': '鹿特丹', 'Utrecht': '烏特勒支', 'Eindhoven': '埃因霍溫', 'Haarlem': '哈勒姆', 'Groningen': '格羅寧根',
           'Arnhem': '阿納姆', "'s-Hertogenbosch": '斯海爾托亨博斯', 'Leeuwarden': '呂伐登', 'Maastricht': '馬斯垂克', 'Zwolle': '茲沃勒', 'Assen': '阿森', 'Middelburg': '米德爾堡'}
plabels = []
for name, g in provs.items():
    g = g.difference(lake)
    # 分成好幾塊的（澤蘭的島、弗里斯蘭的群島）：大塊的裡面離整個省的中心最近的那一塊（澤蘭最大塊是南岸的澤蘭佛蘭德，字會偏到最南邊）
    top = max(p.area for p in parts(g))
    big = min((p for p in parts(g) if p.area > top * 0.2), key=lambda p: p.distance(g.centroid))
    pt = polylabel(big, tolerance=0.001)
    plabels.append((PROV_ZH[name], round(pt.y, 4), round(pt.x, 4)))
cities = []
for f in json.load(open('ne/ne_10m_populated_places_simple.geojson'))['features']:
    p = f['properties']
    if p.get('adm0_a3') == 'NLD' and p.get('latitude', 0) > 50:
        cities.append((CITY_ZH[p['name']], round(p['latitude'], 4), round(p['longitude'], 4)))
print('provinces', plabels)
print('cities', cities)

# 陸地範圍（拉遠時只畫荷蘭的路、綠地、河湖用）：國界外推約 2 km（沿海的路、橋），簡化到約 1 km
landmask = nl.buffer(0.02).simplify(0.01)
mrings = [[(round(y, 3), round(x, 3)) for (x, y) in p.exterior.coords] for p in parts(landmask) if p.area > 1e-3]
print('land rings', len(mrings), 'points', sum(len(r) for r in mrings))

# 檢查
for name, (la, ln) in {'阿姆斯特丹': (52.37, 4.89), '馬斯垂克': (50.85, 5.69), '泰瑟爾島': (53.07, 4.80), '萊利斯塔德': (52.52, 5.47), '格羅寧根': (53.22, 6.57), '弗利辛恩': (51.44, 3.57)}.items():
    print('IN ', name, any(Polygon([(b, a) for a, b in r]).contains(Point(ln, la)) for r in mrings))
for name, (la, ln) in {'安特衛普': (51.22, 4.40), '杜塞道夫': (51.23, 6.78), '布魯塞爾': (50.85, 4.35), '北海': (52.6, 3.9), '艾姆登': (53.37, 7.21)}.items():
    print('OUT', name, not any(Polygon([(b, a) for a, b in r]).contains(Point(ln, la)) for r in mrings))

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
open('nl-data.txt', 'w').write(
    f"export const NL_COAST = '{enc(coast)}';\nexport const NL_LINES = '{enc(lines)}';\n"
    f"export const NL_PROVINCES: Array<[string, number, number]> = [\n{fmt(sorted(plabels, key=lambda r: -r[1]))},\n];\n"
    f"export const NL_CITIES: Array<[string, number, number]> = [\n{fmt(sorted(cities, key=lambda r: -r[1]))},\n];\n")
open('nl-land.txt', 'w').write('export const NL_LAND: Array<Array<[number, number]>> = [\n' + ',\n'.join('  [' + ','.join(f'[{a},{b}]' for a, b in r) + ']' for r in mrings) + ',\n];\n')
