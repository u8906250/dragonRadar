-- 活動有了主題（events.extra 的 topic，AI 照貼文內容判斷）：第 24 屆臺灣同志遊行是 0040 手動放的、沒經過判讀，補上「遊行」，
-- 雷達清單、詳細資料的標籤寫「遊行」，開始時的推播寫「遊行開始」
UPDATE events SET extra = '{"topic":"遊行"}' WHERE post_id = 'pride-2026' AND kind = 'activity' AND extra IS NULL;
