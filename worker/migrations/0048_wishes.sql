-- 許願（v1.569）：投 5 枚順幣送一個想法（不分類型，天馬行空都可以），管理者審核，通過才由維護者用 AI 做出來、上線；
-- 上線後有 3 次免費調整，之後每次 1 枚順幣。許願不會自動變成程式，審核、實作都經過管理者。
-- kind：wish 願望、tweak 調整（parent_id 是哪個願望）
-- status：pending 審核中、rejected 不通過、approved 已通過、building 製作中、live 已上線、dropped 做不出來、withdrawn 自己撤回
--   （rejected、dropped、withdrawn 的順幣退回，之後不能再改）
-- cost：這一筆投了幾枚順幣（暫扣的順幣是 item_grants.used_for = 'wish:<id>' 的那幾枚）；free：調整用的是免費次數（1）還是付順幣（0）
-- reply：管理者的回覆（不通過的原因、上線在哪裡看）；seen：許願的人看過最新進度了沒（管理者改了就變 0，道具按鈕亮小紅點）
-- token：送出時配對暫扣順幣用的隨機字串；ip_hash 只用來限制頻率，30 天後清掉；不通過、做不出來、撤回的 30 天後刪除
CREATE TABLE IF NOT EXISTS wishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  parent_id INTEGER,
  body TEXT NOT NULL,
  nickname TEXT,
  links TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  cost INTEGER NOT NULL DEFAULT 0,
  free INTEGER NOT NULL DEFAULT 0,
  reply TEXT,
  seen INTEGER NOT NULL DEFAULT 1,
  token TEXT,
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wishes_device ON wishes (device_id, created_at);
CREATE INDEX IF NOT EXISTS wishes_status ON wishes (status, created_at);
CREATE INDEX IF NOT EXISTS wishes_parent ON wishes (parent_id);
CREATE INDEX IF NOT EXISTS wishes_token ON wishes (token);
-- 道具用在哪裡（wish:<id> 是許願暫扣、扣掉的順幣）；退回時跟 used_at 一起清掉
ALTER TABLE item_grants ADD COLUMN used_for TEXT;
CREATE INDEX IF NOT EXISTS item_grants_used_for ON item_grants (used_for);
