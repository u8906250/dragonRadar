-- 本機示範用：塞幾個台北市區的事件，時間相對於現在
INSERT OR IGNORE INTO posts (id, username, text, permalink, posted_at, keyword, source, fetched_at, processed_at) VALUES
  ('seed-1', 'demo_giver', '現在在捷運中山站 4號出口發飲料，發完為止！', 'https://www.threads.net/@demo_giver/post/seed-1', strftime('%s','now') - 600, '洋流飄帶', 'manual', strftime('%s','now'), strftime('%s','now')),
  ('seed-2', 'demo_giver', '等等 2 分鐘後在西門町捷運西門站 6號出口發周邊小物', 'https://www.threads.net/@demo_giver/post/seed-2', strftime('%s','now') - 500, '洋流飄帶', 'manual', strftime('%s','now'), strftime('%s','now')),
  ('seed-3', 'demo_giver', '15 分鐘後台北車站東三門發貼紙，限量 100 份', 'https://www.threads.net/@demo_giver/post/seed-3', strftime('%s','now') - 400, '洋流飄帶', 'manual', strftime('%s','now'), strftime('%s','now')),
  ('seed-4', 'demo_giver', '45 分鐘後捷運市政府站 2號出口發洋流飄帶', 'https://www.threads.net/@demo_giver/post/seed-4', strftime('%s','now') - 300, '洋流飄帶', 'manual', strftime('%s','now'), strftime('%s','now'));

INSERT INTO events (post_id, title, item, start_at, end_at, place_text, place_query, lat, lng, status, confidence, created_at, updated_at) VALUES
  ('seed-1', '中山站發飲料', '飲料', strftime('%s','now') - 300, strftime('%s','now') + 3600, '捷運中山站 4號出口', '台北市 捷運中山站 4號出口', 25.0527, 121.5203, 'active', 0.9, strftime('%s','now'), strftime('%s','now')),
  ('seed-2', '西門發周邊', '周邊小物', strftime('%s','now') + 120, strftime('%s','now') + 3600, '西門町 捷運西門站 6號出口', '台北市 捷運西門站 6號出口', 25.0422, 121.5081, 'upcoming', 0.85, strftime('%s','now'), strftime('%s','now')),
  ('seed-3', '北車發貼紙', '貼紙', strftime('%s','now') + 900, strftime('%s','now') + 5400, '台北車站東三門', '台北市 台北車站 東三門', 25.0478, 121.5176, 'upcoming', 0.9, strftime('%s','now'), strftime('%s','now')),
  ('seed-4', '市政府站發洋流飄帶', '洋流飄帶', strftime('%s','now') + 2700, strftime('%s','now') + 7200, '捷運市政府站 2號出口', '台北市 捷運市政府站 2號出口', 25.0410, 121.5655, 'upcoming', 0.8, strftime('%s','now'), strftime('%s','now'));
