-- Shows what's actually stored for your most recent status updates, so we
-- can see whether media_url/media_type are populated correctly or blank.
SELECT id, user_id, media_type, media_url, caption, background_color, created_at, expires_at
FROM ican_statuses
ORDER BY created_at DESC
LIMIT 10;
