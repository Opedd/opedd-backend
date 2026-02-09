-- ============================================================
-- Migration 014: Source Verification Engine
-- ============================================================
--
-- This migration:
-- 1. Adds last_verified_at column to content_sources
-- 2. Adds UNIQUE partial index on verification_token
-- 3. Adds CHECK constraint on verification_status
-- 4. Adds CHECK constraint on source_type
-- 5. Updates source_management_view to include last_verified_at
--
-- Run this in Supabase SQL Editor.
-- ============================================================

BEGIN;

-- 1. Add last_verified_at column
ALTER TABLE content_sources ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

-- 2. Add UNIQUE partial index on verification_token (only non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_sources_verification_token
  ON content_sources (verification_token) WHERE verification_token IS NOT NULL;

-- 3. Add CHECK constraint on verification_status
ALTER TABLE content_sources ADD CONSTRAINT content_sources_verification_status_check
  CHECK (verification_status IN ('pending', 'verified', 'failed'));

-- 4. Add CHECK constraint on source_type (matches SourceType entity)
ALTER TABLE content_sources ADD CONSTRAINT content_sources_source_type_check
  CHECK (source_type IN ('rss', 'substack', 'ghost', 'wordpress', 'medium', 'beehiiv', 'custom', 'other'));

-- 5. Update source_management_view to include last_verified_at
CREATE OR REPLACE VIEW source_management_view AS
SELECT
    cs.*,
    COUNT(l.id) as asset_count,
    MAX(l.created_at) as last_asset_added_at
FROM content_sources cs
LEFT JOIN licenses l ON cs.id = l.source_id
GROUP BY cs.id;

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';

COMMIT;
