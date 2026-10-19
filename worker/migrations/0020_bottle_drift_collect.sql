-- 洋流漂移：沒人撿的瓶子每幾個小時往熱鬧的地方漂一段；記下丟下時的位置（已打散）好算漂了多遠
ALTER TABLE bottles ADD COLUMN origin_lat REAL;
ALTER TABLE bottles ADD COLUMN origin_lng REAL;
ALTER TABLE bottles ADD COLUMN drifted_at INTEGER;
UPDATE bottles SET origin_lat = lat, origin_lng = lng WHERE origin_lat IS NULL;
-- 瓶中信收藏：撿到的人可以把信收藏起來（瓶子回收了信還在），收藏的信不會被 30 天清掉
ALTER TABLE bottle_picks ADD COLUMN collected_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_bottle_picks_collected ON bottle_picks (device_id, collected_at);
