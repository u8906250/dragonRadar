-- 回報的人可以取消自己的固定據點回報：取消碼只在第一次送出時給，別人重複送同一則拿不到
ALTER TABLE spot_requests ADD COLUMN cancel_key TEXT;
