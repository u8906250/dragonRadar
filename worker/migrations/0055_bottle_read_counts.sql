-- 漂流瓶打開來看、看照片的次數（v1.669 隱私評估：位置是網頁送的、可以偽造，限制每小時看幾個，擋用程式把瓶子全部讀走）：
-- 只記次數，不記看了哪個瓶子、不記位置。k 是「d:裝置雜湊:小時」或「i:IP 雜湊:小時」，until 之後刪掉
CREATE TABLE IF NOT EXISTS bottle_read_counts (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  until INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bottle_read_counts_until ON bottle_read_counts (until);
