-- 固定據點：店家、服務處等連續多天的固定時段，每天一筆，前端合成一張卡
ALTER TABLE events ADD COLUMN spot INTEGER NOT NULL DEFAULT 0;
