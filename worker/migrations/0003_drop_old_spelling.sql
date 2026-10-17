-- 只保留「洋流飄帶」。舊寫法「洋流漂帶」跟它在手機上幾乎一樣，看起來像重複
UPDATE keywords SET enabled = 0, pinned = 0 WHERE term = '洋流漂帶';
