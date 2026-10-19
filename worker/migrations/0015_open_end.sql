-- 貼文沒寫結束時間（或寫「發完為止」）：畫面寫「發完為止」，不顯示系統預設的結束時間
-- end_open：當天的結束時間沒寫；until_open：固定據點沒寫最後一天
ALTER TABLE events ADD COLUMN end_open INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN until_open INTEGER NOT NULL DEFAULT 0;
