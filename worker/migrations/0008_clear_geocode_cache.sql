-- 舊的快取可能把「XX區XX站」對到整個行政區的中心點，清掉讓新規則重新查
DELETE FROM geocode_cache;
