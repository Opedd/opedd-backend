-- ============================================================
-- Migration 016: Webhook Receiver Infrastructure
-- ============================================================
--
-- This migration:
-- 1. Adds webhook_secret column to content_sources
-- 2. Adds last_webhook_at column to content_sources
-- 3. Updates source_management_view to include new columns
--
-- Run this in Supabase SQL Editor.
-- ============================================================

BEGIN;

-- 1. Add webhook_secret column (per-source secret for verifying webhook requests)
ALTER TABLE content_sources ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

-- 2. Add last_webhook_at column (for "Last Webhook Received" in UI)
ALTER TABLE content_sources ADD COLUMN IF NOT EXISTS last_webhook_at TIMESTAMPTZ;

-- 3. Unique partial index on webhook_secret (only non-null values, for fast lookups)
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_sources_webhook_secret
  ON content_sources (webhook_secret) WHERE webhook_secret IS NOT NULL;

-- 4. Update source_management_view to include new columns
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
