-- 同一個固定據點的其他貼文：同一個帳號的新貼文取代舊的（舊貼文 link_role = 'previous'），
-- 別人的貼文只附上去（link_role = 'related'）。linked_to 是現在代表這個據點的貼文 id
ALTER TABLE posts ADD COLUMN linked_to TEXT;
ALTER TABLE posts ADD COLUMN link_role TEXT;
CREATE INDEX IF NOT EXISTS idx_posts_linked_to ON posts(linked_to);
