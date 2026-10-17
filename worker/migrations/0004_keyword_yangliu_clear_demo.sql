-- 關鍵字改成「洋流」，停用「洋流飄帶」
UPDATE keywords SET enabled = 0, pinned = 0 WHERE term IN ('洋流飄帶', '洋流漂帶');
INSERT INTO keywords (term, enabled, pinned, source, created_at)
  VALUES ('洋流', 1, 1, 'admin', strftime('%s', 'now'))
  ON CONFLICT(term) DO UPDATE SET enabled = 1, pinned = 1, last_since = NULL;

-- 清掉示範資料（mock 產生的貼文與本機 seed）
DELETE FROM events WHERE post_id IN (SELECT id FROM posts WHERE id LIKE 'mock-%' OR id LIKE 'seed-%');
DELETE FROM posts WHERE id LIKE 'mock-%' OR id LIKE 'seed-%';
