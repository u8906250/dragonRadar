-- 收集卡的引繼碼（換手機）：舊手機產生一組 8 個字的代碼，24 小時內在新手機輸入，卡片從舊的裝置搬到新的裝置（只搬卡片）。
-- 只存代碼的加鹽雜湊；用過一次就失效（used_at），同一台重新產生時舊的作廢；過期的 30 天後清掉
CREATE TABLE IF NOT EXISTS card_transfers (
  code_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS card_transfers_device ON card_transfers (device_id);
-- 產生、兌換的次數（防亂猜）：IP 的加鹽雜湊、哪一種（make、redeem），30 天後清掉
CREATE TABLE IF NOT EXISTS card_transfer_tries (
  ip_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS card_transfer_tries_ip ON card_transfer_tries (ip_hash, kind, created_at);
