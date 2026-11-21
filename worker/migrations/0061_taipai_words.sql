-- 台派用詞（v1.775 使用者說「台派店家也可以提供類似關鍵字審核讓我決定」）：台派雷達判讀時記下判成台派的依據（一個短詞），
-- 新的詞先照判讀放上雷達、記成候選，管理者在管理頁決定算不算台派。
-- status：pending 候選、adopted 採用（寫進判讀說明，貼文寫到就算台派）、rejected 不算台派（之後只靠這個詞判成台派的改送管理者判斷）；
-- posts 是幾則放上雷達的回報用這個詞判成台派，last_post_id、last_permalink 是最近一則
CREATE TABLE IF NOT EXISTS taipai_words (
  word TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  posts INTEGER NOT NULL DEFAULT 0,
  last_post_id TEXT,
  last_permalink TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- 原本判讀說明裡寫的例子先列成採用（飄帶是 v1.769 使用者決定的）
INSERT OR IGNORE INTO taipai_words (word, status, posts, created_at, updated_at) VALUES ('台派', 'adopted', 0, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));
INSERT OR IGNORE INTO taipai_words (word, status, posts, created_at, updated_at) VALUES ('挺台', 'adopted', 0, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));
INSERT OR IGNORE INTO taipai_words (word, status, posts, created_at, updated_at) VALUES ('顧台灣', 'adopted', 0, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));
INSERT OR IGNORE INTO taipai_words (word, status, posts, created_at, updated_at) VALUES ('台灣價值', 'adopted', 0, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));
INSERT OR IGNORE INTO taipai_words (word, status, posts, created_at, updated_at) VALUES ('台灣主權', 'adopted', 0, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));
INSERT OR IGNORE INTO taipai_words (word, status, posts, created_at, updated_at) VALUES ('民主', 'adopted', 0, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));
INSERT OR IGNORE INTO taipai_words (word, status, posts, created_at, updated_at) VALUES ('飄帶', 'adopted', 0, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));
