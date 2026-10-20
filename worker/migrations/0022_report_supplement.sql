-- 貼文沒寫地點或時間時，回報的人可以補充（例如店名地址、每週幾），判讀時接在貼文後面一起看
ALTER TABLE posts ADD COLUMN supplement TEXT;
