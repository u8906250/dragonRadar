-- 手機推播：瀏覽器的推播訂閱（推播服務網址、加密金鑰）與約略位置（小數點後 3 位，約 100 公尺）。
-- 關掉通知、推播服務說訂閱失效、或 30 天沒打開網頁就刪掉
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_push_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_lat ON push_subscriptions (lat, lng);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_updated ON push_subscriptions (updated_at);
-- 事件推過了沒（開始時推一次）
ALTER TABLE events ADD COLUMN pushed_at INTEGER;
