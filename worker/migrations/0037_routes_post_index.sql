-- /api/events 每一點都查這則貼文有沒有車掃路線（網頁沒有這條路線就重抓）
CREATE INDEX IF NOT EXISTS idx_routes_post ON routes (post_id);
