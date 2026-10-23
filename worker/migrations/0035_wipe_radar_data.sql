-- 2026-10-23 改版：資料來源要改成統一由回報系統處理，清掉雷達上的全部資料
-- （貼文、活動、固定據點、車掃路線，含使用者回報的，以及跟著這些資料的回報、結束回報、意見回饋、舊的固定據點申請）。
-- 漂流瓶、推播訂閱、地點快取、關鍵字、設定、讀取量紀錄不動。
-- 要還原：D1 Time Travel（免費方案保留 7 天）回到清除前，例如
--   wrangler d1 time-travel restore dragon-radar --timestamp=1792732295
DELETE FROM ended_reports;
DELETE FROM event_feedback;
DELETE FROM submissions;
DELETE FROM events;
DELETE FROM routes;
DELETE FROM spot_requests;
DELETE FROM posts;
