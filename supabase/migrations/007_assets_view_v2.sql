-- Replace the assets view with one that exposes every column the
-- Lovable frontend expects.  Columns that don't exist on the
-- licenses table are either aliased, joined, or stubbed with
-- sensible defaults so PostgREST never returns a 400.
--
-- Run this in Supabase SQL Editor.

-- ============================================
-- 1. Drop and recreate the view
-- ============================================

DROP VIEW IF EXISTS assets;

CREATE OR REPLACE VIEW assets AS
SELECT
  -- Columns that map 1-to-1
  l.id,
  l.title,
  l.description,
  l.human_price,
  l.ai_price,
  l.license_type,
  l.content_hash,
  l.metadata,
  l.source_url,
  l.created_at,
  l.updated_at,

  -- user_id: the frontend filters by user_id, but licenses has
  -- publisher_id. Join through publishers to expose user_id.
  p.user_id,

  -- publication_id: frontend name for source_id
  l.source_id AS publication_id,

  -- verification columns live on content_sources, not licenses
  cs.verification_token,
  cs.verification_status,

  -- Columns the frontend expects but don't exist on licenses yet.
  -- Stub them with safe defaults so SELECTs never 400.
  TRUE                       AS licensing_enabled,
  0.00::numeric(10,2)        AS total_revenue,
  0                          AS human_licenses_sold,
  0                          AS ai_licenses_sold,
  NULL::text                 AS content,
  NULL::text                 AS thumbnail_url,
  NULL::timestamptz          AS published_at

FROM licenses l
JOIN publishers p ON l.publisher_id = p.id
LEFT JOIN content_sources cs ON l.source_id = cs.id;

-- ============================================
-- 2. Grant access
-- ============================================

GRANT SELECT ON assets TO anon;
GRANT SELECT ON assets TO authenticated;

-- ============================================
-- Verification
-- ============================================
-- SELECT * FROM assets LIMIT 1;
