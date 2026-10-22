-- 國外的活動：當地時區（IANA，例如 America/Los_Angeles），畫面用當地時間顯示；台灣的是 NULL
ALTER TABLE events ADD COLUMN tz TEXT;
-- 手機推播的訂閱者所在時區：深夜不推照當地時間算（國外的訂閱者）
ALTER TABLE push_subscriptions ADD COLUMN tz TEXT;
