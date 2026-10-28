-- 回報地點錯誤時在小地圖上標的正確位置（選填）：管理頁直接帶到地圖上，管理者確認後才改
ALTER TABLE event_feedback ADD COLUMN pin_lat REAL;
ALTER TABLE event_feedback ADD COLUMN pin_lng REAL;
