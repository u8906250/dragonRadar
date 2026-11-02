-- 收集卡（尋找小法）：在汪星的雷達或 3D 國館點到小法就拿到一張卡。不用登入，device_id 是瀏覽器裝置代碼的加鹽雜湊；
-- 第幾位找到照 id 的順序算；ip_hash 只用來限制頻率，30 天後清掉
CREATE TABLE IF NOT EXISTS card_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card TEXT NOT NULL,
  device_id TEXT NOT NULL,
  ip_hash TEXT,
  -- 在公園哪裡找到的（碑林、翠湖…，小法當時的位置，不是使用者的位置）
  place TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (card, device_id)
);
CREATE INDEX IF NOT EXISTS card_claims_device ON card_claims (device_id);
CREATE INDEX IF NOT EXISTS card_claims_ip ON card_claims (ip_hash, created_at);
