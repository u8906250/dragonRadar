-- /api/events 少讀一點：併進官方車掃的相關貼文、固定據點第一天（每個地點查 MIN）、有沒有新資料（MAX(updated_at)）
CREATE INDEX IF NOT EXISTS idx_events_merged ON events (merged_into);
CREATE INDEX IF NOT EXISTS idx_events_post_place_start ON events (post_id, place_text, start_at);
CREATE INDEX IF NOT EXISTS idx_events_updated ON events (updated_at);
