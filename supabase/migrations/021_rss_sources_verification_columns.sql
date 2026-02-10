-- Add verification_token and verification_status to the rss_sources view
-- so the frontend can display the token in the verification modal.
DROP VIEW IF EXISTS rss_sources;
CREATE VIEW rss_sources AS
SELECT
  id,
  user_id,
  name,
  url AS feed_url,
  source_type AS platform,
  sync_status,
  article_count,
  last_sync_at AS last_synced_at,
  tags,
  verification_token,
  verification_status,
  created_at,
  updated_at
FROM content_sources;

NOTIFY pgrst, 'reload schema';
