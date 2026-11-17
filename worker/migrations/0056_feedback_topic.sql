-- 回報問題的「類型錯誤」（v1.753）：回報的人選的正確類型（發放、造勢、講座…，跟網頁類型按鈕一樣的 10 類）
ALTER TABLE event_feedback ADD COLUMN topic TEXT;
-- 管理者改的類型：kind = 'topic'，place_key 是那個地點，at_key 是 0；重新判讀這則貼文時同一個地點照樣用這個類型
ALTER TABLE manual_fixes ADD COLUMN topic TEXT;
