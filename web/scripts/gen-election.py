"""
產生政黨雷達的資料：web/src/election-shapes.ts（鄉鎮市區的形狀，各年共用）、web/src/election-年.ts（那一年縣市長選舉各鄉鎮市區的得票）。
用法：python3 gen-election.py towns-10t.json mayor-2018.json mayor-2022.json mayor-2026.json（檔名裡的年就是那一年；寫到 ../src/）
- mayor-年.json：fetch-election-2026.py（2026 開票網頁）、fetch-election-db.py（2018、2022 選舉資料庫）抓的
- towns-10t.json：taiwan-atlas（npm，MIT）的鄉鎮市區界 TopoJSON，原始資料是內政部國土測繪中心的鄉鎮市區界線（政府資料開放授權條款）
鄉鎮市區的形狀照 TopoJSON 的共用邊簡化（相鄰兩區的邊一起簡化，不會有縫），座標存成 0.0001 度的整數、差值。
中選會的縣市代碼（省市 2 碼 + 縣市 3 碼）、鄉鎮市區代碼（3 碼）跟內政部的一樣；對不上的照名稱找
"""
import json, os, re, sys

TOL = 0.0003  # 簡化的容許誤差（度，約 30 公尺）
Q = 10000  # 座標存成 0.0001 度的整數
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src')

topo = json.load(open(sys.argv[1], encoding='utf-8'))
sx, sy = topo['transform']['scale']
tx, ty = topo['transform']['translate']


def decode(arc):
    x = y = 0
    out = []
    for dx, dy in arc:
        x += dx
        y += dy
        out.append((x * sx + tx, y * sy + ty))
    return out


def dp(pts, tol):
    """Douglas-Peucker：頭尾一定留著（共用邊的端點兩邊都一樣）"""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay
        L = (dx * dx + dy * dy) ** 0.5
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / L if L > 0 else ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


norm = lambda s: s.replace('台', '臺')
arcs = [dp(decode(a), TOL) for a in topo['arcs']]
used = set()
towns = {}
by_name = {}
for g in topo['objects']['towns']['geometries']:
    pr = g['properties']
    polys = [g['arcs']] if g['type'] == 'Polygon' else g['arcs']
    towns[pr['TOWNCODE']] = polys
    by_name[norm(pr['COUNTYNAME'] + pr['TOWNNAME'])] = pr['TOWNCODE']
    for p in polys:
        for r in p:
            for i in r:
                used.add(i if i >= 0 else ~i)

order = sorted(used)
newid = {old: i for i, old in enumerate(order)}
enc = []
for old in order:
    q = [(round(x * Q), round(y * Q)) for x, y in arcs[old]]
    flat = [q[0][0], q[0][1]]
    for (x0, y0), (x1, y1) in zip(q, q[1:]):
        flat += [x1 - x0, y1 - y0]
    enc.append(flat)
shapes = {code: [[[newid[i] if i >= 0 else ~newid[~i] for i in r] for r in p] for p in polys] for code, polys in towns.items()}
print(f'形狀：邊 {len(enc)} 條、{sum(len(e) // 2 for e in enc)} 點、{len(shapes)} 區', file=sys.stderr)

open(os.path.join(SRC, 'election-shapes.ts'), 'w', encoding='utf-8').write(f"""/**
 * 政黨雷達：鄉鎮市區的形狀（各年共用）。內政部國土測繪中心的鄉鎮市區界線（政府資料開放授權條款第 1 版），
 * 經 taiwan-atlas（MIT）轉成 TopoJSON，共用邊簡化到約 30 公尺。由 web/scripts/gen-election.py 產生，不要手改。
 */

/** 鄉鎮市區的邊：每條是 [經度, 緯度, 差值…]（0.0001 度的整數），相鄰兩區共用 */
export const TOWN_ARCS: number[][] = {json.dumps(enc, separators=(',', ':'))};

/** 每個鄉鎮市區（內政部代碼）的形狀：多邊形 → 外圈、洞 → 邊的編號（負的是 ~編號，反過來走） */
export const TOWN_SHAPES: Record<string, number[][][]> = {json.dumps(shapes, separators=(',', ':'))};
""")

for path in sys.argv[2:]:
    year = int(re.search(r'(\d{4})', os.path.basename(path)).group(1))
    mayor = json.load(open(path, encoding='utf-8'))
    counties = []
    problems = []
    for c in mayor:
        cands = sorted(c['candidates'], key=lambda x: x['no'])
        nos = [x['no'] for x in cands]
        tw = []
        for t in c['towns']:
            code = c['code'] + t['code']
            if code not in shapes:
                code = by_name.get(norm(c['name'] + t['name']), code)
            if code not in shapes:
                problems.append(f"{c['name']}{t['name']}")
            by = {x['no']: x['votes'] for x in t['candidates']}
            tw.append({'code': code, 'name': t['name'], 'sent': t['sent'], 'total': t['total'], 'votes': [by.get(n, 0) for n in nos]})
        counties.append({'code': c['code'], 'name': c['name'], 'sent': c['sent'], 'total': c['total'], 'victor': c.get('victor'),
                         'cands': [[x['no'], x['name'], x['party'], x['votes']] for x in cands], 'towns': tw})
    covered = {t['code'] for c in counties for t in c['towns']}
    missing = [k for k in shapes if k not in covered]
    updated = max((c.get('updated') or '') for c in mayor) or None
    print(f'{year}：縣市 {len(counties)}、鄉鎮市區 {len(covered)}' + (f'；對不上形狀：{"、".join(problems)}' if problems else '') + (f'；沒有得票：{"、".join(missing)}' if missing else ''), file=sys.stderr)
    source = f'中選會開票網頁（vote.cec.gov.tw），{updated} 抓的；正式結果以中選會公告為準' if updated else '中選會選舉資料庫（db.cec.gov.tw）'
    open(os.path.join(SRC, f'election-{year}.ts'), 'w', encoding='utf-8').write(f"""/**
 * 政黨雷達：{year} 年直轄市長、縣市長選舉各鄉鎮市區的候選人得票數。資料：{source}。
 * 由 web/scripts/gen-election.py 產生，不要手改。
 */
import type {{ ElectionYear }} from './election';

export const ELECTION: ElectionYear = {json.dumps({'year': year, 'updated': updated, 'counties': counties}, ensure_ascii=False, separators=(',', ':'))};
""")
