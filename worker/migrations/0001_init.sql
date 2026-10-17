-- 設定值（例如目前使用的 Threads token）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 要監控的關鍵字
CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_since INTEGER,
  created_at INTEGER NOT NULL
);

-- 抓到的原始貼文
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  username TEXT,
  text TEXT NOT NULL,
  permalink TEXT,
  posted_at INTEGER NOT NULL,
  keyword TEXT,
  source TEXT NOT NULL DEFAULT 'threads',
  fetched_at INTEGER NOT NULL,
  processed_at INTEGER,
  extraction TEXT
);

-- 解析出來的發放事件
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL REFERENCES posts(id),
  title TEXT NOT NULL,
  item TEXT,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  place_text TEXT NOT NULL,
  place_query TEXT,
  lat REAL,
  lng REAL,
  status TEXT NOT NULL CHECK (status IN ('upcoming', 'active', 'ended', 'unlocated')),
  confidence REAL,
  ended_reason TEXT,
  last_checked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_status_time ON events (status, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_events_post ON events (post_id);

-- 地點查詢快取（lat 為 NULL 代表查不到）
CREATE TABLE IF NOT EXISTS geocode_cache (
  query TEXT PRIMARY KEY,
  lat REAL,
  lng REAL,
  display_name TEXT,
  resolved_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO keywords (term, enabled, created_at) VALUES ('洋流漂帶', 1, strftime('%s', 'now'));
