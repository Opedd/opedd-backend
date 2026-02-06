-- ============================================================
-- Migration 012: Source Management View with Asset Count
-- ============================================================
--
-- This migration:
-- 1. Ensures tags column exists (idempotent)
-- 2. Creates source_management_view with live asset count
-- 3. Updates unique constraint for user_id + url
--
-- Run this in Supabase SQL Editor.
-- ============================================================

BEGIN;

-- 1. Add Tags support to Content Sources (idempotent)
ALTER TABLE content_sources
ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

-- 2. Create a View for the "Sources" UI that includes the live Asset Count
-- This prevents "Spaghetti" code by calculating the count at the DB level
-- Note: licenses table has source_id FK to content_sources
CREATE OR REPLACE VIEW source_management_view AS
SELECT
    cs.*,
    COUNT(l.id) as asset_count,
    MAX(l.created_at) as last_asset_added_at
FROM content_sources cs
LEFT JOIN licenses l ON cs.id = l.source_id
GROUP BY cs.id;

-- Grant permissions on the new view
GRANT SELECT ON source_management_view TO authenticated;
GRANT SELECT ON source_management_view TO anon;

-- 3. Update the Unique Constraint (Safeguard for Scale)
-- This ensures a user can't add the same feed twice, even with different tags
ALTER TABLE content_sources
DROP CONSTRAINT IF EXISTS content_sources_user_id_url_key;

ALTER TABLE content_sources
ADD CONSTRAINT content_sources_user_id_url_key UNIQUE (user_id, url);

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';

COMMIT;
