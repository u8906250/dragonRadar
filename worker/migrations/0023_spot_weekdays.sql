-- 固定據點只在每週幾開（「每週二、四」）：1 = 週一 … 7 = 週日，逗號分隔；NULL 是每天
ALTER TABLE events ADD COLUMN weekdays TEXT;
