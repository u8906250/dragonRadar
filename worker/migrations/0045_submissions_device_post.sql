-- 我的回報：照裝置把回報依貼文合起來（device、post_id、created_at 都在索引裡，不用回表、不用另外排序）
CREATE INDEX IF NOT EXISTS idx_submissions_device_post ON submissions (device, post_id, created_at);
