-- 回報的累計（收集卡 No.002「古錐媽的肉乾」、道具）：回報、確認、放上雷達的貼文一則一筆（device_id 是裝置代碼的加鹽雜湊，2026-11-03 上線後才算）；
-- 回報的人自己刪掉的拿掉；一台一天（台灣時間）最多算 20 則。不會過期清掉
CREATE TABLE IF NOT EXISTS report_credits (
  post_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS report_credits_device ON report_credits (device_id, created_at);
-- 道具：拿到一個一筆。reason 是為什麼拿到（例如 reports:5 是累計滿 5 則；同一台、同一種道具、同一個原因只給一次，刪掉再貼不會重拿）；
-- used_at 是用掉的時間（用法之後再設計）
CREATE TABLE IF NOT EXISTS item_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  item TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  UNIQUE (device_id, item, reason)
);
CREATE INDEX IF NOT EXISTS item_grants_device ON item_grants (device_id, item);
