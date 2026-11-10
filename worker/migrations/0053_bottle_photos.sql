-- 漂流瓶可以附一張照片（v1.594）：照片存在 R2（BOTTLE_PHOTOS），這裡記它的 key；瓶子刪掉時照片一起刪
ALTER TABLE bottles ADD COLUMN photo_key TEXT;
