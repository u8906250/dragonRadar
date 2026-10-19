-- 「撿走就消失」之前被撿過的瓶子還是 active，雷達上一直看得到：改成已撿走
UPDATE bottles SET status = 'picked', picks = 1
 WHERE status = 'active' AND id IN (SELECT bottle_id FROM bottle_picks);
