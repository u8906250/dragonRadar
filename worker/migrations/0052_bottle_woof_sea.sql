-- 漂流瓶改版（v1.593）：在丟的地方附近漂 24 小時，沒人撿就漂到汪星的海上，在汪星留 30 天才沉下去。
-- world：earth 在地球、woof 在汪星的海上（lat、lng 換成汪星的經緯度）；sea_at：漂到汪星的時間
ALTER TABLE bottles ADD COLUMN world TEXT NOT NULL DEFAULT 'earth';
ALTER TABLE bottles ADD COLUMN sea_at INTEGER;
-- 還在漂的瓶子照新的壽命（地球 1 天＋汪星 30 天）；已經漂走的不動
UPDATE bottles SET expires_at = created_at + 31 * 86400 WHERE status = 'active' AND expires_at > CAST(strftime('%s', 'now') AS INTEGER);
-- 撿到就收進瓶中信收藏（拿掉「回收瓶子」）：撿到、還沒回收、沒收藏的都收進收藏
UPDATE bottle_picks SET collected_at = created_at WHERE collected_at IS NULL AND recycled_at IS NULL;
-- 汪星海上的瓶子一次全部列出
CREATE INDEX IF NOT EXISTS idx_bottles_world ON bottles (world, status);
