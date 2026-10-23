-- D1 讀了幾列：照日期（UTC，跟免費額度重置的時間一樣）、來源（排程的哪一項工作、哪個 API）加總
CREATE TABLE IF NOT EXISTS d1_usage (
  day TEXT NOT NULL,
  label TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  rows_read INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, label)
);
