-- 帳號的暱稱（建立帳號後設定，之後可以改；選填，現在只顯示給自己看）
ALTER TABLE accounts ADD COLUMN nickname TEXT;
