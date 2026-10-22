-- 模組：同一套雷達換不同主題的資料。每則貼文屬於一個模組（current 洋流、dog 狗狗陪伴），事件跟著貼文
ALTER TABLE posts ADD COLUMN module TEXT NOT NULL DEFAULT 'current';
CREATE INDEX IF NOT EXISTS idx_posts_module ON posts (module);
-- 模組自己的欄位（JSON），例如職缺的工作期間、每天時段、薪資、雇主、怎麼應徵、防詐提醒
ALTER TABLE events ADD COLUMN extra TEXT;
