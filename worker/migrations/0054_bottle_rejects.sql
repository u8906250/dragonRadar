-- 漂流瓶沒通過審核的紀錄（v1.623 使用者說記 7 天）：管理頁查為什麼沒過、改善審核用，7 天後刪掉。
-- 不記位置；照片只記有沒有附（不存照片）。device_id 是裝置代碼的加鹽雜湊、ip_hash 是 IP 的加鹽雜湊：
-- 分辨是不是同一個人，也用來擋一直送沒通過的瓶子（一小時、一天、同一個網路沒通過太多次就先停）
-- stage：rule 規則（連結、電話、帳號…）、text AI 看文字、photo AI 看照片、ai_error AI 沒回應
CREATE TABLE IF NOT EXISTS bottle_rejects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  device_id TEXT,
  ip_hash TEXT,
  stage TEXT NOT NULL,
  reason TEXT,
  text TEXT NOT NULL,
  has_photo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bottle_rejects_time ON bottle_rejects (created_at);
CREATE INDEX IF NOT EXISTS idx_bottle_rejects_device ON bottle_rejects (device_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bottle_rejects_ip ON bottle_rejects (ip_hash, created_at);
