-- 事件類型：giveaway 發放、activity 活動（車掃、開講、造勢、見面會等）
ALTER TABLE events ADD COLUMN kind TEXT NOT NULL DEFAULT 'giveaway';
