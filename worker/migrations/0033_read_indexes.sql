-- 減少 D1 讀取（免費方案每天 500 萬列）：排程每 10 分鐘的查詢原本要掃整張表
-- 過期的事件（status + end_at）、清舊資料（end_at、fetched_at）
CREATE INDEX IF NOT EXISTS idx_events_status_end ON events (status, end_at);
CREATE INDEX IF NOT EXISTS idx_events_end ON events (end_at);
-- 還沒判讀的貼文、清舊貼文、官方車掃與回報的貼文
CREATE INDEX IF NOT EXISTS idx_posts_processed ON posts (processed_at);
CREATE INDEX IF NOT EXISTS idx_posts_fetched ON posts (fetched_at);
CREATE INDEX IF NOT EXISTS idx_posts_source ON posts (source);
