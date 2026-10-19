-- 撿到的瓶子要「回收」才多一個額度；回收後撿到的人也看不到了
ALTER TABLE bottle_picks ADD COLUMN recycled_at INTEGER;
