-- 暱稱公開了（v1.766：漂流瓶的署名、卡片、許願預先帶入）：設定暱稱要審核
-- nickname_checked：這個暱稱審核過了（v1.765 設的還沒審核，要署名時再審）；nickname_day、nickname_tries：一天最多審核幾次
ALTER TABLE accounts ADD COLUMN nickname_checked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN nickname_day INTEGER;
ALTER TABLE accounts ADD COLUMN nickname_tries INTEGER NOT NULL DEFAULT 0;
-- 漂流瓶的署名：丟的時候帳號的暱稱（之後改暱稱不會變）
ALTER TABLE bottles ADD COLUMN signed TEXT;
