-- 車掃路線：實際路徑、各站預計時間與各路段認領人數（來自台北大洋流車掃地圖），雷達和地圖畫成路線
CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,          -- 車掃地圖的活動代碼，例如 2026-10-18-songshan-xinyi
  post_id TEXT NOT NULL,        -- 對應的官方航線貼文（voyage-<id>），事件都掛在這則貼文下
  title TEXT NOT NULL,
  day_start INTEGER NOT NULL,   -- 當天 00:00（台北時間）
  depart_at INTEGER,
  arrive_at INTEGER,
  show_until INTEGER NOT NULL,  -- 過了這個時間就不再顯示
  claim_url TEXT,
  stops TEXT NOT NULL,          -- JSON：起點、加油點、終點，含預計時間
  segments TEXT NOT NULL,       -- JSON：每段路徑與認領人數
  updated_at INTEGER NOT NULL
);
