-- 固定據點自動審核：誰審的（auto 自動、admin 人工），以及自動審核沒通過的原因（給回報的人看，等人工審核）
ALTER TABLE spot_requests ADD COLUMN reviewer TEXT;
ALTER TABLE spot_requests ADD COLUMN review_note TEXT;
