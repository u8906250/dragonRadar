-- 使用者貼上的 Threads 連結（source = 'link'）與「回報已發完」

-- 每次提交一筆，用來限制同一個來源的頻率；IP 只存加鹽雜湊，30 天後刪除
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  result TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_ip ON submissions (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_post ON submissions (post_id);

-- 同一個來源對同一個事件只算一次
CREATE TABLE IF NOT EXISTS ended_reports (
  event_id INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, ip_hash)
);
CREATE INDEX IF NOT EXISTS idx_ended_reports_ip ON ended_reports (ip_hash, created_at);

-- 上次重讀原貼文的時間（偵測刪文、改文）
ALTER TABLE posts ADD COLUMN checked_at INTEGER;
