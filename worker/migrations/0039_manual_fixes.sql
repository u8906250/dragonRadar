-- 管理者處理問題回報時手動改的地點、時間：重新判讀這則貼文時套回去，不會被 AI 判讀、地圖查詢蓋掉
-- place_key 是判讀出來的地點文字（去掉空白）；
-- kind = 'place'：改位置 lat、lng，place_text 有寫就連地點名稱一起改；at_key 是 0
-- kind = 'time'：at_key 是判讀出來的開始時間（車掃的站是預計經過時間），改成 start_at、end_at（null 是沒寫結束）
CREATE TABLE manual_fixes (
  post_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  place_key TEXT NOT NULL,
  at_key INTEGER NOT NULL DEFAULT 0,
  lat REAL,
  lng REAL,
  place_text TEXT,
  start_at INTEGER,
  end_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, kind, place_key, at_key)
);
