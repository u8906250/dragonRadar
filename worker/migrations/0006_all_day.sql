-- 只有日期、沒有公布時間的活動（例如官方航線的車掃日）
ALTER TABLE events ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0;
