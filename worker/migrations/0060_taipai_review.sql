-- 台派雷達看不出是台派的店家，回報的人可以送給管理者判斷（v1.771 使用者說「如果無法判斷為台派店家，可回報給管理員判斷」）：
-- posts.confirm_state 多 review（等管理者判斷）、refused（管理者判斷不是台派）；confirm_note 是回報的人寫的為什麼是台派，
-- review_note 是管理者寫的不是台派的原因（再貼這個連結的人看得到），reviewed_at 是管理者判斷的時間
ALTER TABLE posts ADD COLUMN review_note TEXT;
ALTER TABLE posts ADD COLUMN reviewed_at INTEGER;
-- 管理頁列出等判斷的（只有少數幾則，部分索引）
CREATE INDEX IF NOT EXISTS idx_posts_review ON posts(fetched_at) WHERE confirm_state = 'review';
