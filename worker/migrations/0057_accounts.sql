-- 帳號（passkey 登入，選用）：不用登入照樣能用；建立帳號、登入時把這台裝置的收集卡、道具、許願、回報、漂流瓶併進帳號，
-- 之後登入同一個帳號的裝置都看到同一份。帳號不存名字、email，只存 passkey 的公鑰。
-- id 跟裝置代碼的加鹽雜湊同樣是 24 個 16 進位字（收集卡、道具…的 device_id 欄位直接放帳號的 id）
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  -- WebAuthn 的 user.id（base64url），同一個帳號的每一把 passkey 都用這個，密碼管理員才會放在一起
  user_handle TEXT NOT NULL UNIQUE,
  ip_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS accounts_ip ON accounts (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS passkeys (
  -- credential id（base64url）
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  -- COSE 公鑰（base64url）
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  -- 有沒有同步到雲端（iCloud 鑰匙圈、Google 密碼管理員…）
  backed_up INTEGER NOT NULL DEFAULT 0,
  -- 建立時的裝置（照瀏覽器的 User-Agent 寫「iPhone · Safari」）
  label TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS passkeys_account ON passkeys (account_id);

-- 登入狀態：網站和 API 不同網域，不能靠 cookie，瀏覽器存 token、放在 x-account 標頭；伺服器只存雜湊
CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_sessions_account ON account_sessions (account_id);

-- passkey 的一次性題目（5 分鐘內有效，用一次就刪）
CREATE TABLE IF NOT EXISTS passkey_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  -- register：建立帳號或加一把 passkey（account_id 有值）；login：登入
  kind TEXT NOT NULL,
  account_id TEXT,
  user_handle TEXT,
  -- 同一個網路短時間要太多題目就擋
  ip_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS passkey_challenges_ip ON passkey_challenges (ip_hash, created_at);
