-- 只定位到鄉鎮區中心的事件，記下區域名稱，前端標成「約略位置」
ALTER TABLE events ADD COLUMN approx_area TEXT;
