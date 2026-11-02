-- 中山公園的標記：管理者在 3D 公園裡標的路燈、長椅、垃圾桶等（真的位置，之後畫進雷達、3D 公園）。只有管理 token 能讀寫
CREATE TABLE IF NOT EXISTS park_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  -- 面向哪（度，0 是北、順時針）：長椅坐的人面向哪邊
  heading REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
