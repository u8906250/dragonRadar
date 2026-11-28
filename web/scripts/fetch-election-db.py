"""
抓中選會選舉資料庫（db.cec.gov.tw）2022、2018 年直轄市長、縣市長選舉各縣市、各鄉鎮市區的候選人得票數，
存成跟 fetch-election-2026.py 一樣格式的 JSON（mayor-年.json），給 gen-election.py 用。
用法：python3 fetch-election-db.py 輸出目錄（每秒最多一個請求；抓過的檔案存在 輸出目錄/年/json/，重跑只抓沒有的）
2022 年嘉義市長延到 12 月 18 日重行選舉，嘉義市用重行選舉的結果
"""
import json, os, sys, time, urllib.request

BASE = 'https://db.cec.gov.tw/static/elections/data/tickets/ELC'
UA = 'Mozilla/5.0 (compatible; CurrentRadar/1.0; +https://current-radar.pages.dev)'
# 年 → [(類別, theme_id)]：C1 直轄市長、C2 縣市長；後面的蓋掉前面同一個縣市的
THEMES = {
    2022: [('C1', '05cc7b904c7a30cc7c88d5b10898c98e'), ('C2', '63615098f5afa8ec53159c4a86fc01d3'), ('C2', '1275d73551f2c0caf202e803b1766057')],
    2018: [('C1', 'a0222f6529a3ff2192a1a04f209eaac3'), ('C2', 'f75e94cad2958f8764f9d090e72b5567')],
}
out = sys.argv[1]
last = [0.0]


def get(url, cache):
    if os.path.exists(cache):
        return json.load(open(cache, encoding='utf-8'))
    wait = 1.05 - (time.time() - last[0])
    if wait > 0:
        time.sleep(wait)
    last[0] = time.time()
    req = urllib.request.Request(url, headers={'user-agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode('utf-8')
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    open(cache, 'w', encoding='utf-8').write(body)
    return json.loads(body)


def cands(rows):
    return [{'no': r['cand_no'], 'name': r['cand_name'], 'votes': r['ticket_num'], 'pct': r['ticket_percent'], 'party': r['party_name']} for r in sorted(rows, key=lambda r: r['cand_no'])]


for year, themes in THEMES.items():
    counties = {}
    for subject, theme in themes:
        top = get(f'{BASE}/{subject}/00/{theme}/C/00_000_00_000_0000.json', f'{out}/{year}/json/{theme}-C.json')
        rows = next(iter(top.values()))
        by = {}
        for r in rows:
            by.setdefault((r['prv_code'], r['city_code'], r['area_name']), []).append(r)
        for (prv, city, name), rs in by.items():
            code = prv + city
            d = get(f'{BASE}/{subject}/00/{theme}/D/{prv}_{city}_00_000_0000.json', f'{out}/{year}/json/{theme}-D-{code}.json')
            towns = {}
            for r in next(iter(d.values())):
                towns.setdefault((r['dept_code'], r['area_name']), []).append(r)
            victor = [r['cand_no'] for r in rs if r['is_victor'].strip()]
            counties[code] = {
                'code': code, 'name': name, 'sent': 1, 'total': 1, 'updated': None, 'victor': victor[0] if victor else None,
                'candidates': cands(rs),
                'towns': [{'code': dept, 'name': tn, 'sent': 1, 'total': 1, 'candidates': cands(trs)} for (dept, tn), trs in towns.items()],
            }
    result = list(counties.values())
    json.dump(result, open(f'{out}/{year}/mayor-{year}.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(year, len(result), '縣市', sum(len(c['towns']) for c in result), '鄉鎮市區', flush=True)
