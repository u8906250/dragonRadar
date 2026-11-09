-- 回報滿 5 則的獎勵不用選了（v1.579 使用者說「雞肉乾在拿到卡後，獎勵就不用再出現選擇（只剩順幣的選擇）」）：
-- 之後每 5 則直接給一枚順幣；還沒選的獎勵（item = 'pick'，拿到的時候一定已經有肉乾卡）都改成順幣
UPDATE item_grants SET item = 'coin' WHERE item = 'pick';
