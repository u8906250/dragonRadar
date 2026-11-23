"""
產生 web/src/australia-*.ts、web/src/au-land.ts 的資料（澳洲拉遠時的海岸線、湖岸、州界、地名、陸地範圍）。
澳洲很大，分成幾塊（西澳、中部、昆士蘭、東南、塔斯馬尼亞），雷達附近碰到哪一塊才載入哪一塊。
用法：跟 gen-usa.py 一樣（ne/ 放 world-atlas@2 的 land-10m.json、countries-10m.json 和 Natural Earth 的
ne_10m_lakes.geojson、ne_10m_admin_1_states_provinces.geojson、ne_10m_populated_places.geojson，裝 shapely），
然後 PYTHONPATH=geo-lib python3 gen-australia.py：印出檢查結果，寫出 au-<塊>.txt（貼進 australia-<塊>.ts）、au-land.txt（貼進 au-land.ts）
"""
import json, sys
sys.path.insert(0, 'geo-lib')
from shapely.geometry import Polygon, LineString, Point, box, shape
from shapely.ops import unary_union, linemerge, polylabel
from shapely.validation import make_valid
from shapely.affinity import translate

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
    def unwrap(r):
        out = []; off = 0
        for i, (x, y) in enumerate(r):
            d = x - r[i - 1][0] if i else 0
            if d > 180: off -= 360
            elif d < -180: off += 360
            out.append((x + off, y))
        return out, off
    def geom(g):
        if g['type'] == 'Polygon': polys = [g['arcs']]
        elif g['type'] == 'MultiPolygon': polys = g['arcs']
        else: return None
        ps = []
        for p in polys:
            rs = [ring(r) for r in p]
            if len(rs[0]) < 4: continue
            # 跨過換日線的（斐濟的島：經度從 180 跳到 -180）攤平成連續的經度、再切回 -180～180，跟 gen-usa.py 一樣；
            # 不然當平面看是繞地球一圈的細長條，切進澳洲這幾塊，雷達塗海時在南緯 16.5 度多出幾條橫過海面的縫
            un = [unwrap(r) for r in rs]
            if any(off for _, off in un):
                ps.append(Polygon(rs[0], [r for r in rs[1:] if len(r) >= 4]).buffer(0))
                continue
            poly = Polygon(un[0][0], [r for r, _ in un[1:] if len(r) >= 4]).buffer(0)
            if poly.bounds[0] < -180 or poly.bounds[2] > 180:
                poly = unary_union([poly.intersection(box(-180, -90, 180, 90)), translate(poly.intersection(box(180, -90, 540, 90)), -360), translate(poly.intersection(box(-540, -90, -180, 90)), 360)])
            ps.append(poly)
        return unary_union(ps)
    return d, geom

def parts(g):
    return list(g.geoms) if hasattr(g, 'geoms') else [g]

def merged(g):
    return parts(g if g.geom_type == 'LineString' else linemerge(g)) if not g.is_empty else []

# 幾塊（s, w, n, e）、海岸線簡化到多少度、多小的島不畫（平方度）：人多的東南、塔斯馬尼亞簡化到約 400 m（跟美國一樣，拉到 30 km 海岸才對得上路），
# 西澳、中部、昆士蘭的海岸很長很曲折（金伯利、大堡礁的島），簡化到約 1 km、約 10 km² 以下的島不畫。北邊到南緯 9 度（托雷斯海峽群島）
BLOCKS = {
    'west': ((-35.5, 112.5, -13.4, 129.0), 0.01, 1e-3),
    'central': ((-38.2, 129.0, -10.8, 141.0), 0.01, 1e-3),
    'north': ((-29.0, 141.0, -9.0, 154.0), 0.008, 1e-3),
    'southeast': ((-39.2, 141.0, -29.0, 154.0), 0.004, 3e-4),
    'tas': ((-43.8, 143.5, -39.2, 149.0), 0.004, 3e-4),
}

dc, gc = topo('ne/countries-10m.json')
au = next(gc(g) for g in dc['objects']['countries']['geometries'] if g.get('id') == '036')
dl, gl = topo('ne/land-10m.json')
world_land = unary_union([gl(g) for g in dl['objects']['land']['geometries']])

# 湖：澳洲的大湖（艾爾湖、托倫斯湖…）多半是乾的鹽湖，Natural Earth 的陸地照樣算陸地；約 300 km² 以上的扣掉，畫湖岸
all_lakes = [(f['properties'].get('name'), shape(f['geometry']).buffer(0)) for f in json.load(open('ne/ne_10m_lakes.geojson'))['features']]

# 州界（陸地上的）；豪勳爵島、麥覺理島、傑維斯灣（很小、很遠）不算一個州
SKIP_STATES = {'Jervis Bay Territory', 'Macquarie Island', 'Lord Howe Island'}
states = [f for f in json.load(open('ne/ne_10m_admin_1_states_provinces.geojson'))['features'] if f['properties'].get('adm0_a3') == 'AUS']
sgeo = {f['properties']['name']: shape(f['geometry']).buffer(0) for f in states}
inner_all = unary_union([g.boundary for g in sgeo.values()]).difference(au.boundary.buffer(0.004))

# 州名、城市名（台灣常用的寫法）：Natural Earth 的繁體中文名再改幾個
STATE_ZH = {'Victoria': '維多利亞州', 'Australian Capital Territory': '澳洲首都領地'}
CITY_ZH = {
    'Brisbane': '布里斯本', 'Alice Springs': '愛麗絲泉', 'Broome': '布魯姆', 'Port Hedland': '黑德蘭港', 'Dubbo': '達博',
    'Geelong': '吉朗', 'Wollongong': '臥龍崗', 'Launceston': '朗塞斯頓', 'Toowoomba': '圖文巴', 'Bundaberg': '班達堡',
    'Sunshine Coast': '陽光海岸', 'Bunbury': '班伯里',
}
# 首都、州首府、大城市，再加台灣人常去的（打工度假、旅遊）
MORE = {'Geelong', 'Wollongong', 'Launceston', 'Toowoomba', 'Bundaberg', 'Mackay', 'Sunshine Coast', 'Ballarat', 'Mildura', 'Albury', 'Byron Bay', 'Coffs Harbour', 'Bunbury'}
places = [f['properties'] for f in json.load(open('ne/ne_10m_populated_places.geojson'))['features'] if f['properties'].get('ADM0_A3') == 'AUS']
places = [p for p in places if p.get('FEATURECLA') != 'Populated place' or p.get('SCALERANK', 9) <= 4 or p['NAME'] in MORE]
# 很小的地方（溫多拉約一百人）不寫
places = [p for p in places if p['NAME'] not in ('Windorah',)]

# 州名寫在州裡離邊界最遠的一點（扣掉湖；分成好幾塊的用離中心最近的大塊）
big_lakes = unary_union([g for _, g in all_lakes if g.area > 0.032 and g.intersects(box(112, -44, 154, -9))])
state_labels = []
for f in states:
    name = f['properties']['name']
    if name in SKIP_STATES: continue
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
    # 海岸線、湖岸：封閉的形狀，切到這一塊裡面（切開的地方沿著這一塊的邊走，湖是挖空的圈；雷達塗海用，畫海岸線時邊上那幾段不畫）
    coast = []
    for p in parts(dry):
        if not p.intersects(AREA) or p.area < min_island: continue
        for poly in parts(make_valid(p.simplify(tol, preserve_topology=False)).intersection(AREA)):
            if poly.geom_type != 'Polygon' or poly.is_empty: continue
            for r in [poly.exterior, *poly.interiors]:
                coast.append([(y, x) for (x, y) in r.coords])
    onland = dry.buffer(-0.002)
    lines = []
    for l in merged(inner_all.intersection(AREA).intersection(onland)):
        if not isinstance(l, LineString) or l.length < 0.05: continue
        lines.append([(y, x) for (x, y) in l.simplify(0.01).coords])
    plabels = [(n, round(pt.y, 4), round(pt.x, 4)) for n, pt in state_labels if AREA.contains(pt)]
    cities = [(CITY_ZH.get(p['NAME'], p['NAME_ZHT']), round(p['LATITUDE'], 4), round(p['LONGITUDE'], 4)) for p in places if AREA.contains(Point(p['LONGITUDE'], p['LATITUDE']))]
    print(f'== {key}: lakes {[n for n, _ in lakes]}')
    print(f'   coast {len(coast)} rings, {sum(len(l) for l in coast)} points; borders {len(lines)} lines, {sum(len(l) for l in lines)} points')
    print('   states', ' '.join(n for n, _, _ in sorted(plabels, key=lambda r: r[1])))
    print('   cities', len(cities), ' '.join(n for n, _, _ in sorted(cities, key=lambda r: -r[1])))
    open(f'au-{key}.txt', 'w').write(
        f"export const COAST = '{enc(coast)}';\nexport const LINES = '{enc(lines)}';\n"
        f"export const STATES: Array<[string, number, number]> = [\n{fmt(sorted(plabels, key=lambda r: -r[1]))},\n];\n"
        f"export const CITIES: Array<[string, number, number]> = [\n{fmt(sorted(cities, key=lambda r: -r[1]))},\n];\n")

# 陸地範圍（拉遠時只畫澳洲的路、綠地、河湖用；每個人都會載入，要小）：約 100 km² 以上的島，國界外推約 4 km，簡化到約 5 km
mask = unary_union([p for p in parts(au.intersection(box(110, -45, 155, -9))) if p.area > 0.012]).buffer(0.04).simplify(0.05)
mrings = [[(round(y, 3), round(x, 3)) for (x, y) in p.exterior.coords] for p in parts(mask)]
print('land rings', len(mrings), 'points', sum(len(r) for r in mrings))
inside = lambda la, ln: any(Polygon([(b, a) for a, b in r]).contains(Point(ln, la)) for r in mrings)
for name, (la, ln) in {'雪梨': (-33.87, 151.21), '墨爾本': (-37.81, 144.96), '伯斯': (-31.95, 115.86), '荷巴特': (-42.88, 147.33), '達爾文': (-12.46, 130.84), '凱恩斯': (-16.92, 145.77), '黃金海岸': (-28.0, 153.43), '愛麗絲泉': (-23.7, 133.88)}.items():
    print('IN ', name, inside(la, ln))
for name, (la, ln) in {'莫士比港': (-9.44, 147.18), '帝力': (-8.56, 125.57), '巴斯海峽': (-39.8, 146.0), '紐西蘭': (-41.29, 174.78), '卡本塔利亞灣': (-14.0, 139.0)}.items():
    print('OUT', name, not inside(la, ln))
open('au-land.txt', 'w').write(f"export const AU_LAND_CODE = '{enc(mrings)}';\n")
