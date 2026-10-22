-- 管理者直接改的標題（回報管理的「改標題」）：畫面就用這個標題，重新判讀也保留
ALTER TABLE events ADD COLUMN title_manual INTEGER NOT NULL DEFAULT 0;
