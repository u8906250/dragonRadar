-- 回報的人手動加的關鍵字（直接修改時加的、判讀沒抽到的）：回報放上雷達後記下來，管理者在管理頁採用了，
-- 之後同一個雷達的貼文內文寫到就標上（跟寫死的常見詞 MODULE_TAGS 一樣）。
-- status：pending 等管理者看、adopted 採用、rejected 不要（之後再有人加也不會再列成候選）；posts 是幾則回報加過，last_post_id 是最近一則
CREATE TABLE IF NOT EXISTS learned_tags (
  module TEXT NOT NULL,
  tag TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  posts INTEGER NOT NULL DEFAULT 1,
  last_post_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (module, tag)
);
