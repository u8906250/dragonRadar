-- 全螢幕雷達的搜尋地址（v1.785）：查過的結果（含查不到）快取，不記是誰查的。
-- query 是「查詢字串|畫面的大概位置（0.5 度的格子）」，results 是 JSON；查到的 7 天、查不到的 1 天後重查，排程刪過期的
CREATE TABLE IF NOT EXISTS geo_search (
  query TEXT PRIMARY KEY,
  results TEXT NOT NULL,
  resolved_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_geo_search_resolved ON geo_search (resolved_at);

-- 沒快取、真的去查的次數（Photon、Nominatim 是免費的公用服務）：只記次數，不記查了什麼。
-- k 是「i:IP 雜湊:小時」或「all:分鐘」，until 之後刪掉
CREATE TABLE IF NOT EXISTS geo_search_counts (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  until INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_geo_search_counts_until ON geo_search_counts (until);
