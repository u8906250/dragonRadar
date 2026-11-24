-- 回報的貼文判讀花了多久（毫秒，v1.831 使用者說判讀中要寫用哪個模型、預估秒數）：從讀貼文到判讀、定位好；
-- 判讀中的提示照最近幾十次的中位數預估
ALTER TABLE posts ADD COLUMN judge_ms INTEGER;
CREATE INDEX IF NOT EXISTS idx_posts_judged ON posts (checked_at) WHERE judge_ms IS NOT NULL;
