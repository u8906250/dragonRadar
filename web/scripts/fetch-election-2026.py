"""
抓中選會 2026 縣市長選舉（含直轄市長）各縣市、各鄉鎮市區的候選人得票數（vote.cec.gov.tw/2026-local 的開票頁），存成 JSON，
給 gen-election.py 產生 web/src/election-2026.ts。
用法：python3 fetch-election-2026.py 輸出目錄（每秒最多一個請求；抓過的頁面存在 輸出目錄/html/，重跑只抓沒有的）
"""
import html, json, os, re, sys, time, urllib.request

BASE = 'https://vote.cec.gov.tw/2026-local'
UA = 'Mozilla/5.0 (compatible; CurrentRadar/1.0; +https://current-radar.pages.dev)'
out = sys.argv[1]
os.makedirs(f'{out}/html', exist_ok=True)
last = [0.0]


def get(url, cache):
    path = f'{out}/html/{cache}'
    if os.path.exists(path):
        return open(path, encoding='utf-8').read()
    wait = 1.05 - (time.time() - last[0])
    if wait > 0:
        time.sleep(wait)
    last[0] = time.time()
    req = urllib.request.Request(url, headers={'user-agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode('utf-8')
    open(path, 'w', encoding='utf-8').write(body)
    return body


def text(s):
    return html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', s))).strip()


def parse(page):
    """候選人得票數頁：號次、姓名、得票數、得票率、推薦之政黨；已送／總投票所數"""
    m = re.search(r'已送投票所數/總投票所數:\s*(\d+)\s*/\s*(\d+)', text(page))
    rows = []
    for tr in re.findall(r'<tr>(.*?)</tr>', page, flags=re.S):
        tds = [text(td) for td in re.findall(r'<td[^>]*>(.*?)</td>', tr, flags=re.S)]
        if len(tds) >= 6 and tds[0].isdigit():
            rows.append({'no': int(tds[0]), 'name': tds[1], 'votes': int(tds[3].replace(',', '')), 'pct': float(tds[4]), 'party': tds[5]})
    t = re.search(r'資料更新時間:\s*([\d/]+ [\d:]+)', text(page))
    return {'sent': int(m.group(1)) if m else None, 'total': int(m.group(2)) if m else None, 'updated': t.group(1) if t else None, 'candidates': rows}


tree = json.loads(get(f'{BASE}/assets/def/tree-compiled.2026-local.min.json', 'tree.json'))
result = []
for ck in tree['_AREAROOT']['next']:
    c = tree[ck]
    code = c['serial']['c']
    county = {'code': code, 'name': c['zh'], **parse(get(f'{BASE}/zh-TW/TC/{code}00000000{"0000"}.html', f'TC-{code}.html')), 'towns': []}
    for tk in c['next']:
        t = tree[tk]
        if not isinstance(t, list):
            print('  不是鄉鎮市區', tk, flush=True)
            continue
        d = t[1]
        town = {'code': d, 'name': t[2], **parse(get(f'{BASE}/zh-TW/TC/{code}00{d}0000000.html', f'TC-{code}-{d}.html'))}
        county['towns'].append(town)
    print(county['name'], len(county['towns']), county['sent'], '/', county['total'], flush=True)
    result.append(county)
json.dump(result, open(f'{out}/mayor-2026.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('done', len(result))
