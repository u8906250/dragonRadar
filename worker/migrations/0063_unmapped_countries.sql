-- 有活動、但雷達還沒畫地圖的國家（v1.793）：國外的活動放上雷達時那個國家沒有地圖就記下來（ISO 兩碼），第一次出現推給管理者。
-- events 是記到幾則、last_* 是最近一則；dismissed 是管理者按了「知道了」（不再推，列在收起來的那一堆）
CREATE TABLE IF NOT EXISTS unmapped_countries (
  country TEXT PRIMARY KEY,
  events INTEGER NOT NULL,
  last_event_id INTEGER,
  last_title TEXT,
  last_place TEXT,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  dismissed INTEGER NOT NULL DEFAULT 0
);
