-- ============================================================
-- Migration 013: Composite Unique Index for Publisher + Source URL
-- ============================================================
--
-- Migration 008 dropped the UNIQUE constraint on licenses.source_url
-- to allow different publishers to license the same URL.
--
-- The new sync-newsletter edge function needs to upsert licenses
-- with onConflict: 'publisher_id,source_url'. This requires a
-- unique index on that pair.
--
-- This composite index preserves the intent of migration 008
-- (different publishers CAN license the same URL) while enabling
-- dedup within a single publisher.
--
-- Run this in Supabase SQL Editor.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_publisher_source_url
  ON licenses(publisher_id, source_url);
