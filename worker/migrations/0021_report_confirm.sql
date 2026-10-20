-- 使用者回報的貼文判讀完先給他確認，按「對」才放上雷達
-- confirm_state：NULL 舊資料或排程搜尋到的（直接上雷達）、pending 等確認、confirmed 已確認、rejected 回報的人說判讀錯了
-- confirm_plan：判讀好、還沒寫進雷達的資料（JSON）；confirm_note：回報的人說哪裡錯（給管理者看）
ALTER TABLE posts ADD COLUMN confirm_state TEXT;
ALTER TABLE posts ADD COLUMN confirm_plan TEXT;
ALTER TABLE posts ADD COLUMN confirm_note TEXT;
