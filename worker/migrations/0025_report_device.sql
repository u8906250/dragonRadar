-- 回報的人用瀏覽器的裝置代碼（加鹽雜湊）認自己的回報，可以自己刪除；跟 IP 雜湊一樣 30 天後隨回報紀錄刪除
-- posts.confirm_state 多一種 withdrawn：回報的人刪除了，雷達上的事件已拿掉，之後有人再貼會重新判讀
ALTER TABLE submissions ADD COLUMN device TEXT;
CREATE INDEX IF NOT EXISTS idx_submissions_device ON submissions (device, created_at);
