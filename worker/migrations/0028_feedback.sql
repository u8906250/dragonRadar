-- 問題回報：大家在詳細資料回報地點錯誤、時間錯誤等，推到管理者手機，管理頁標成已處理。
-- 存回報當時的標題、地點（事件之後可能被重新判讀、刪掉）；裝置代碼、IP 是加鹽雜湊，只用來限制次數與去重複；30 天後刪除
CREATE TABLE IF NOT EXISTS event_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  post_id TEXT,
  title TEXT NOT NULL,
  place_text TEXT,
  kind TEXT NOT NULL,
  note TEXT,
  device TEXT,
  ip TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_event_feedback_status ON event_feedback (status, created_at);
CREATE INDEX IF NOT EXISTS idx_event_feedback_event ON event_feedback (event_id, kind);
CREATE INDEX IF NOT EXISTS idx_event_feedback_device ON event_feedback (device, created_at);
CREATE INDEX IF NOT EXISTS idx_event_feedback_ip ON event_feedback (ip, created_at);
-- 管理者手機的推播訂閱（收回報通知）
CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_push_at INTEGER
);
