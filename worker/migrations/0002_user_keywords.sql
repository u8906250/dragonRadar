-- 使用者自訂關鍵字：pinned 是固定搜尋的預設關鍵字，其餘靠 last_requested_at 判斷是否還有人追蹤
ALTER TABLE keywords ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE keywords ADD COLUMN source TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE keywords ADD COLUMN last_requested_at INTEGER;

UPDATE keywords SET pinned = 1 WHERE term = '洋流漂帶';
INSERT INTO keywords (term, enabled, pinned, source, created_at)
  VALUES ('洋流飄帶', 1, 1, 'admin', strftime('%s', 'now'))
  ON CONFLICT(term) DO UPDATE SET enabled = 1, pinned = 1;
