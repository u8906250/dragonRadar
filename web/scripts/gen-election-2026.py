"""
產生 web/src/election-2026.ts（政黨雷達：2026 縣市長選舉各鄉鎮市區的得票、鄉鎮市區的形狀）。
用法：python3 gen-election-2026.py mayor-2026.json towns-10t.json > ../src/election-2026.ts
- mayor-2026.json：fetch-election-2026.py 抓的中選會開票結果（各縣市、各鄉鎮市區的候選人得票數）
- towns-10t.json：taiwan-atlas（npm，MIT）的鄉鎮市區界 TopoJSON，原始資料是內政部國土測繪中心的鄉鎮市區界線（政府資料開放授權條款）
鄉鎮市區的形狀照 TopoJSON 的共用邊簡化（相鄰兩區的邊一起簡化，不會有縫），座標存成 0.0001 度的整數、差值
"""
import json, sys

TOL = 0.0003  # 簡化的容許誤差（度，約 30 公尺）
Q = 10000  # 座標存成 0.0001 度的整數

mayor = json.load(open(sys.argv[1], encoding='utf-8'))
topo = json.load(open(sys.argv[2], encoding='utf-8'))
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


arcs = [dp(decode(a), TOL) for a in topo['arcs']]
used = set()
towns = {}
for g in topo['objects']['towns']['geometries']:
    polys = [g['arcs']] if g['type'] == 'Polygon' else g['arcs']
    towns[g['properties']['TOWNCODE']] = (g['properties']['COUNTYNAME'], g['properties']['TOWNNAME'], polys)
    for p in polys:
        for r in p:
            for i in r:
                used.add(i if i >= 0 else ~i)

# 只留用得到的邊，重新編號
order = sorted(used)
newid = {old: i for i, old in enumerate(order)}
enc = []
npts = 0
for old in order:
    pts = arcs[old]
    q = [(round(x * Q), round(y * Q)) for x, y in pts]
    flat = [q[0][0], q[0][1]]
    for (x0, y0), (x1, y1) in zip(q, q[1:]):
        flat += [x1 - x0, y1 - y0]
    enc.append(flat)
    npts += len(q)

shapes = {}
for code, (_, _, polys) in towns.items():
    shapes[code] = [[[newid[i] if i >= 0 else ~newid[~i] for i in r] for r in p] for p in polys]

# 開票結果：候選人照號次，每個鄉鎮市區的票數照候選人的順序
counties = []
missing = []
for c in mayor:
    cands = sorted(c['candidates'], key=lambda x: x['no'])
    nos = [x['no'] for x in cands]
    tw = []
    for t in c['towns']:
        code = c['code'] + t['code']
        if code not in shapes:
            missing.append(f"{c['name']}{t['name']}（{code}）")
        by = {x['no']: x['votes'] for x in t['candidates']}
        tw.append({'code': code, 'name': t['name'], 'sent': t['sent'], 'total': t['total'], 'votes': [by.get(n, 0) for n in nos]})
    counties.append({'code': c['code'], 'name': c['name'], 'sent': c['sent'], 'total': c['total'], 'updated': c['updated'],
                     'cands': [[x['no'], x['name'], x['party'], x['votes']] for x in cands], 'towns': tw})
covered = {t['code'] for c in counties for t in c['towns']}
nodata = [f"{towns[k][0]}{towns[k][1]}（{k}）" for k in shapes if k not in covered]
print(f'邊 {len(enc)} 條、{npts} 點；縣市 {len(counties)}、鄉鎮市區 {len(covered)}', file=sys.stderr)
if missing:
    print('開票結果有、形狀沒有：' + '、'.join(missing), file=sys.stderr)
if nodata:
    print('形狀有、開票結果沒有：' + '、'.join(nodata), file=sys.stderr)

updated = max((c['updated'] or '') for c in counties)
print(f"""/**
 * 政黨雷達（2026-11-28 使用者說的）：2026 年直轄市長、縣市長選舉各鄉鎮市區的候選人得票數，和鄉鎮市區的形狀。
 * 開票結果：中央選舉委員會（vote.cec.gov.tw/2026-local）開票資料，{updated} 抓的；正式結果以中選會公告為準。
 * 鄉鎮市區界：內政部國土測繪中心（政府資料開放授權條款第 1 版），經 taiwan-atlas（MIT）轉成 TopoJSON，共用邊簡化到約 30 公尺。
 * 由 web/scripts/gen-election-2026.py 產生，不要手改。
 */

/** 開票資料的時間（中選會頁面寫的） */
export const ELECTION_UPDATED = {json.dumps(updated, ensure_ascii=False)};

export interface ElectionTown {{
  /** 內政部的鄉鎮市區代碼（縣市 5 碼 + 3 碼），對得上 TOWN_SHAPES */
  code: string;
  name: string;
  /** 已送、總投票所數 */
  sent: number;
  total: number;
  /** 每位候選人的得票數，照 cands 的順序 */
  votes: number[];
}}

export interface ElectionCounty {{
  code: string;
  name: string;
  sent: number;
  total: number;
  /** 號次、姓名、推薦之政黨、全縣市得票數 */
  cands: Array<[number, string, string, number]>;
  towns: ElectionTown[];
}}

export const ELECTION_COUNTIES: ElectionCounty[] = {json.dumps([{k: v for k, v in c.items() if k != 'updated'} for c in counties], ensure_ascii=False, separators=(',', ':'))};

/** 鄉鎮市區的邊：每條是 [經度, 緯度, 差值…]（0.0001 度的整數），相鄰兩區共用 */
export const TOWN_ARCS: number[][] = {json.dumps(enc, separators=(',', ':'))};

/** 每個鄉鎮市區的形狀：多邊形 → 外圈、洞 → 邊的編號（負的是 ~編號，反過來走） */
export const TOWN_SHAPES: Record<string, number[][][]> = {json.dumps(shapes, separators=(',', ':'))};
""")
