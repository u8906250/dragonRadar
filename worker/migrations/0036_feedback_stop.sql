-- 車掃的問題回報可以指定哪一站：路線上那一站的標題（跟雷達上那一點的標題一樣）、預計經過的時間
ALTER TABLE event_feedback ADD COLUMN stop TEXT;
ALTER TABLE event_feedback ADD COLUMN stop_at INTEGER;
