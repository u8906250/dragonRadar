-- 路線可以指定畫法：rainbow 是彩虹（同志遊行）；沒寫是車掃的畫法
ALTER TABLE routes ADD COLUMN style TEXT;

-- 第 24 屆臺灣同志遊行（2026-10-31 六）：主辦單位公布的時間、地點和南北兩條路線（https://www.taiwanpride.lgbt/2026-info-1），
-- 約 17:35 回到市民廣場是警方交管公告的預估（自由時報 2026-10-30）。
-- 雷達上一場活動（市民廣場，13:00 集合到 18:40 舞台活動結束），加一條彩虹路線（14:05 出發、約 17:35 回來，北、南兩段同時走）；
-- 路線照公布的道路，路口位置取自 OpenStreetMap（© OpenStreetMap contributors），兩個路口之間的路是直的。
-- 貼文的 source 是 site（主辦單位公告），不經過 AI 判讀（processed_at 已填），關鍵字跟著洋流
INSERT INTO posts (id, username, text, permalink, posted_at, keyword, source, fetched_at, processed_at, module)
VALUES ('pride-2026', '臺灣同志遊行', '第 24 屆臺灣同志遊行
日期：2026-10-31（六）
地點：臺北市政府前廣場（市民廣場）
時間：12:00 彩虹市集、13:00 遊行隊伍集合、14:05 出發，約 17:35 回到市民廣場（警方預估），舞台活動到 18:40
北路線：市民廣場 → 仁愛路 → 敦化南路 → 忠孝東路 → 逸仙路 → 仁愛路 → 市民廣場
南路線：市民廣場 → 仁愛路 → 光復南路 → 信義路 → 敦化南路 → 仁愛路 → 市民廣場
交通：建議避開捷運市政府站、台北101／世貿站，改搭到國父紀念館站、永春站、信義安和站、象山站或南京三民站', 'https://www.taiwanpride.lgbt/2026-info-1', 1793361600, '洋流', 'site', 1793361600, 1793361600, 'current');

INSERT INTO events (post_id, kind, title, item, start_at, end_at, place_text, place_query, lat, lng, status, confidence, all_day, spot, approx_area, end_open, until_open, weekdays, tz, extra, created_at, updated_at)
VALUES ('pride-2026', 'activity', '第 24 屆臺灣同志遊行', NULL, 1793422800, 1793443200, '臺北市政府前廣場（市民廣場）', '台北市民廣場', 25.037561, 121.5628, 'upcoming', 1, 0, 0, NULL, 0, 0, NULL, NULL, NULL, 1793361600, 1793361600);

INSERT INTO routes (id, post_id, title, day_start, depart_at, arrive_at, show_until, claim_url, stops, segments, updated_at, style)
VALUES ('pride-2026', 'pride-2026', '第 24 屆臺灣同志遊行', 1793376000, 1793426700, 1793439300, 1793443200, NULL, '[{"kind":"start","title":"第 24 屆臺灣同志遊行","name":"臺北市政府前廣場（市民廣場）","lat":25.037561,"lng":121.5628,"at":1793426700},{"kind":"end","title":"第 24 屆臺灣同志遊行","name":"臺北市政府前廣場（市民廣場）","lat":25.037561,"lng":121.5628,"at":1793439300}]', '[{"seq":1,"from":"北路線","to":"市民廣場 → 仁愛路 → 敦化南路 → 忠孝東路 → 逸仙路 → 仁愛路 → 市民廣場","path":[[25.037561,121.5628],[25.037627,121.561458],[25.037686,121.557579],[25.037857,121.548832],[25.041526,121.548868],[25.041348,121.557679],[25.04123,121.561584],[25.037627,121.561458],[25.037561,121.5628]],"lengthM":3633,"people":0,"target":0},{"seq":2,"from":"南路線","to":"市民廣場 → 仁愛路 → 光復南路 → 信義路 → 敦化南路 → 仁愛路 → 市民廣場","path":[[25.037561,121.5628],[25.037627,121.561458],[25.037686,121.557579],[25.033095,121.557486],[25.033277,121.548796],[25.037857,121.548832],[25.037686,121.557579],[25.037627,121.561458],[25.037561,121.5628]],"lengthM":3830,"people":0,"target":0}]', 1793361600, 'rainbow');
