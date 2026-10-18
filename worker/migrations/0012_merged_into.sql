-- 新聞、Threads 講的是官方車掃時，併進官方那一場：記下官方貼文 id，不再單獨顯示
ALTER TABLE events ADD COLUMN merged_into TEXT;
