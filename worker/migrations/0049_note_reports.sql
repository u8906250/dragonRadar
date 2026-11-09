-- 沒有連結的回報（v1.578）：貼文字、上傳截圖（AI 讀出圖片裡的字，圖片不存）、自己填。
-- posts.source = 'note'、id 是 note-＋亂數；跟貼連結一樣先判讀、預覽，回報的人確認後 confirm_state = 'review' 等管理者審核，
-- 通過才放上雷達（confirmed），沒通過是 refused（原因寫在 review_note，回報的人在「我的回報」看得到）
-- note_kind：text 貼文字、image 截圖讀出來的字、manual 自己填；reviewed_at：管理者審核的時間
ALTER TABLE posts ADD COLUMN note_kind TEXT;
ALTER TABLE posts ADD COLUMN review_note TEXT;
ALTER TABLE posts ADD COLUMN reviewed_at INTEGER;
-- 管理頁列出等審核的（只有少數幾則，部分索引）
CREATE INDEX IF NOT EXISTS idx_posts_review ON posts(fetched_at) WHERE confirm_state = 'review';
