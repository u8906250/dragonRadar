-- 沒有連結的回報不審核了（v1.579 使用者說管理者也沒辦法判斷對不對）：確認後直接放上雷達、標明未查證，
-- 兩個不同的人回報問題就自動下架。0049 加的審核欄位、等審核的索引拿掉，改成管理頁列最近 7 天的沒有連結回報用的索引
DROP INDEX IF EXISTS idx_posts_review;
ALTER TABLE posts DROP COLUMN review_note;
ALTER TABLE posts DROP COLUMN reviewed_at;
CREATE INDEX IF NOT EXISTS idx_posts_note ON posts(fetched_at) WHERE source = 'note';
