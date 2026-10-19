-- 漂流瓶：使用者在自己附近丟一句打氣的話，別人走到附近才撿得起來、看得到內容。
-- 不用登入：裝置代碼（瀏覽器裡的隨機字串）只存雜湊；位置在丟的時候就打散到約 100 m 內，不存真正的位置。
CREATE TABLE IF NOT EXISTS bottles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  text TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  -- active 漂流中、hidden 被檢舉藏起來、deleted 丟的人自己收回、removed 管理者移除
  status TEXT NOT NULL DEFAULT 'active',
  picks INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  -- 30 天後清掉
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bottles_geo ON bottles (status, lat, lng);
CREATE INDEX IF NOT EXISTS idx_bottles_device ON bottles (device_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bottles_ip ON bottles (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS bottle_picks (
  bottle_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bottle_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_bottle_picks_device ON bottle_picks (device_id, created_at);

CREATE TABLE IF NOT EXISTS bottle_reports (
  bottle_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  ip_hash TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bottle_id, device_id)
);
