"""
產生 web/src/usa-*.ts、web/src/us-land.ts 的資料（美國拉遠時的海岸線、湖岸、州界、國界、地名、陸地範圍）。
美國很大，分成幾塊（本土西半、本土東半、阿拉斯加、夏威夷），雷達附近碰到哪一塊才載入哪一塊。
用法：在 ne/ 放 world-atlas@2 的 land-10m.json、countries-10m.json 和 Natural Earth 的 GeoJSON
（ne_10m_lakes.geojson、ne_10m_admin_1_states_provinces.geojson、ne_10m_populated_places.geojson，
github.com/nvkelso/natural-earth-vector 的 geojson/），裝 shapely（pip install --target geo-lib shapely），
然後 PYTHONPATH=geo-lib python3 gen-usa.py：印出檢查結果，寫出 us-<塊>.txt（貼進 usa-<塊>.ts）、us-land.txt（貼進 us-land.ts）
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

def merged(g):
    return parts(g if g.geom_type == 'LineString' else linemerge(g)) if not g.is_empty else []

# 幾塊（s, w, n, e）、海岸線簡化到多少度、多小的島不畫（平方度）：本土以西經 100 度分東西兩半（海岸線、湖岸沒有跨過這條線），
# 簡化到約 400 m（跟荷蘭一樣；約 1 km 的話拉到 30 km 紐約的海岸跟路對不上）、約 3 km² 以下的島不畫；阿拉斯加的海岸很曲折（峽灣、群島），簡化到約 2 km、約 40 km² 以下的島不畫，
# 到西經 180 度（再西邊的阿留申群島照舊用世界海岸線）
BLOCKS = {
    'west': ((24.3, -125.0, 49.5, -100.0), 0.004, 3e-4),
    'east': ((24.3, -100.0, 49.5, -66.8), 0.004, 3e-4),
    'alaska': ((51.0, -180.0, 71.6, -129.9), 0.02, 1e-2),
    'hawaii': ((18.8, -160.6, 22.4, -154.7), 0.005, 1e-3),
}

dc, gc = topo('ne/countries-10m.json')
countries = {g.get('id'): gc(g) for g in dc['objects']['countries']['geometries'] if g.get('id') in ('840', '124', '484')}
us, neighbors = countries['840'], unary_union([countries['124'], countries['484']])
dl, gl = topo('ne/land-10m.json')
world_land = unary_union([gl(g) for g in dl['objects']['land']['geometries']])

# 湖：Natural Earth 的陸地把湖算成陸地，扣掉才畫得出湖岸（五大湖、大鹽湖、奧基喬比湖…）；約 300 km² 以上的才算
all_lakes = [(f['properties'].get('name'), shape(f['geometry']).buffer(0)) for f in json.load(open('ne/ne_10m_lakes.geojson'))['features']]

# 州界（陸地上的，湖上、海上的不畫）＋跟加拿大、墨西哥的國界；簡化到約 1 km
states = [f for f in json.load(open('ne/ne_10m_admin_1_states_provinces.geojson'))['features'] if f['properties'].get('adm0_a3') == 'USA']
sgeo = {f['properties']['name']: shape(f['geometry']).buffer(0) for f in states}
inner_all = unary_union([g.boundary for g in sgeo.values()]).difference(us.boundary.buffer(0.004))
border_all = us.boundary.intersection(neighbors.buffer(0.01))

# 州名（台灣常用的寫法）：Natural Earth 的繁體中文名再改幾個
STATE_ZH = {
    'California': '加州', 'Texas': '德州', 'Pennsylvania': '賓州', 'Massachusetts': '麻州', 'Michigan': '密西根州', 'Maine': '緬因州', 'Indiana': '印第安納州',
    'Delaware': '德拉瓦州', 'South Carolina': '南卡羅來納州', 'North Carolina': '北卡羅來納州', 'District of Columbia': '華盛頓特區',
}
CITY_ZH = {
    'Washington, D.C.': '華盛頓', 'Kodiak': '科迪亞克', 'Cold Bay': '冷灣', 'Valdez': '瓦爾迪茲', 'Augusta': '奧古斯塔', 'Jefferson City': '傑佛遜城',
    'Frankfort': '法蘭克福', 'Albany': '奧爾巴尼', 'Trenton': '特倫頓', 'Utqiaġvik': '烏特恰維克', 'Burlington': '伯靈頓',
}
places = [f['properties'] for f in json.load(open('ne/ne_10m_populated_places.geojson'))['features'] if f['properties'].get('ADM0_A3') == 'USA']
# 首都、州首府、大城市
places = [p for p in places if p.get('FEATURECLA') != 'Populated place' or p.get('SCALERANK', 9) <= 4]
# 華盛頓州的溫哥華（緊鄰波特蘭）：會被當成加拿大的溫哥華
places = [p for p in places if p['NAME'] != 'Vancouver']

# 州名寫在州裡離邊界最遠的一點（扣掉湖；分成好幾塊的用離中心最近的大塊），點在哪一塊就寫在那一塊
# （每一塊扣的湖不一樣，分開算的話北達科他州這種在西經 100 度附近的會兩邊都不寫）
big_lakes = unary_union([g for _, g in all_lakes if g.area > 0.032 and any(g.intersects(box(W, S, E, N)) for (S, W, N, E), _, _ in BLOCKS.values())])
state_labels = []
for f in states:
    name = f['properties']['name']
    if name == 'District of Columbia': continue
    g = sgeo[name].difference(big_lakes)
    top = max(p.area for p in parts(g))
    big = min((p for p in parts(g) if p.area > top * 0.2), key=lambda p: p.distance(g.centroid))
    pt = polylabel(big, tolerance=0.005)
    state_labels.append((STATE_ZH.get(name, f['properties']['name_zht']), pt))

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

for key, ((S, W, N, E), tol, min_island) in BLOCKS.items():
    AREA = box(W, S, E, N)
    land = world_land.intersection(AREA.buffer(0.5))
    lakes = [(n, g) for n, g in all_lakes if g.intersects(AREA) and g.area > 0.032]
    lake = unary_union([g for _, g in lakes]) if lakes else None
    dry = land.difference(lake) if lake else land
    # 海岸線、湖岸：小島不畫、簡化（照上面每一塊的設定），切到這一塊裡面（外面的點斷開）
    coast = []
    for p in parts(dry):
        if not p.intersects(AREA) or p.area < min_island: continue
        for poly in parts(p.simplify(tol, preserve_topology=False)):
            if poly.is_empty: continue
            # 整圈的雷達會當成島塗淡淡的底色：大陸、湖岸（陸地裡的洞）分成兩半、不接成一圈；島照舊
            halves = lambda c: [c[:len(c) // 2 + 1], c[len(c) // 2:]]
            ext = list(poly.exterior.coords)
            rings = halves(ext) if poly.area > 5 else [ext]
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
    onland = dry.buffer(-0.002)
    lines = []
    for g in (inner_all, border_all):
        for l in merged(g.intersection(AREA).intersection(onland)):
            if not isinstance(l, LineString) or l.length < 0.05: continue
            lines.append([(y, x) for (x, y) in l.simplify(0.01).coords])
    plabels = [(n, round(pt.y, 4), round(pt.x, 4)) for n, pt in state_labels if AREA.contains(pt)]
    cities = [(CITY_ZH.get(p['NAME'].replace('  ', ' '), CITY_ZH.get(p['NAME'], p['NAME_ZHT'])), round(p['LATITUDE'], 4), round(p['LONGITUDE'], 4)) for p in places if AREA.contains(Point(p['LONGITUDE'], p['LATITUDE']))]
    print(f'== {key}: lakes {[n for n, _ in lakes]}')
    print(f'   coast {len(coast)} lines, {sum(len(l) for l in coast)} points; borders {len(lines)} lines, {sum(len(l) for l in lines)} points')
    print('   states', ' '.join(n for n, _, _ in sorted(plabels, key=lambda r: -r[1])))
    print('   cities', len(cities), ' '.join(n for n, _, _ in sorted(cities, key=lambda r: -r[1])))
    open(f'us-{key}.txt', 'w').write(
        f"export const COAST = '{enc(coast)}';\nexport const LINES = '{enc(lines)}';\n"
        f"export const STATES: Array<[string, number, number]> = [\n{fmt(sorted(plabels, key=lambda r: -r[1]))},\n];\n"
        f"export const CITIES: Array<[string, number, number]> = [\n{fmt(sorted(cities, key=lambda r: -r[1]))},\n];\n")

# 陸地範圍（拉遠時只畫美國的路、綠地、河湖用；每個人都會載入，要小）：約 100 km² 以上的島，國界外推約 4 km，簡化到約 5 km；
# 西經 180 度以西的不算。國界的五大湖是美國的那一半湖面也算在裡面（湖上沒有路，沒關係）
mask = unary_union([p for p in parts(us.intersection(box(-180, 15, -60, 72))) if p.area > 0.012]).buffer(0.04).simplify(0.05)
mrings = [[(round(y, 3), round(x, 3)) for (x, y) in p.exterior.coords] for p in parts(mask)]
print('land rings', len(mrings), 'points', sum(len(r) for r in mrings))
inside = lambda la, ln: any(Polygon([(b, a) for a, b in r]).contains(Point(ln, la)) for r in mrings)
for name, (la, ln) in {'紐約': (40.71, -74.0), '洛杉磯': (34.05, -118.24), '西雅圖': (47.6, -122.33), '邁阿密': (25.77, -80.19), '基韋斯特': (24.56, -81.78), '安克拉治': (61.22, -149.9), '檀香山': (21.31, -157.86), '底特律': (42.33, -83.05), '聖地牙哥': (32.72, -117.16)}.items():
    print('IN ', name, inside(la, ln))
for name, (la, ln) in {'溫哥華': (49.28, -123.12), '多倫多': (43.65, -79.38), '溫莎': (42.3, -83.0), '提華納': (32.51, -117.04), '蒙特雷': (25.69, -100.32), '密西根湖': (43.5, -87.0), '墨西哥灣': (27.0, -90.0), '哈瓦那': (23.11, -82.37)}.items():
    print('OUT', name, not inside(la, ln))
open('us-land.txt', 'w').write(f"export const US_LAND_CODE = '{enc(mrings)}';\n")
