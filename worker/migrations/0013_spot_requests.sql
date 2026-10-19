-- 使用者回報的固定據點：貼 Threads 連結加上地點，人工審核通過後才放上雷達
CREATE TABLE IF NOT EXISTS spot_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 給回報的人查進度用的隨機代碼，不用流水號，免得別人一個一個查
  key TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL,
  permalink TEXT,
  username TEXT,
  text TEXT NOT NULL,
  posted_at INTEGER NOT NULL,
  place TEXT NOT NULL,
  hours TEXT,
  note TEXT,
  -- 30 天後清掉
  ip_hash TEXT,
  -- pending 待審核、approved 已上雷達、rejected 不通過
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_spot_requests_code ON spot_requests (code);
CREATE INDEX IF NOT EXISTS idx_spot_requests_status ON spot_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_spot_requests_ip ON spot_requests (ip_hash, created_at);
