-- 有門牌卻只定位到路或鄉鎮區（約略位置）的事件，排程定時重查門牌；記錄上次重查的時間，同一個地址隔幾小時才再查
ALTER TABLE events ADD COLUMN locate_checked_at INTEGER;
