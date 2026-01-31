-- Backward-compatibility view: the frontend calls /rest/v1/assets
-- but the underlying table is "licenses". This view bridges the gap
-- so PostgREST serves the same data at /rest/v1/assets.
-- Run this in Supabase SQL Editor.

-- ============================================
-- 1. Create the assets view
-- ============================================

CREATE OR REPLACE VIEW assets AS
SELECT
  id,
  publisher_id,
  title,
  description,
  license_type,
  content_hash,
  metadata,
  source_url,
  source_id,
  human_price,
  ai_price,
  access_type,
  created_at,
  updated_at
FROM licenses;

-- ============================================
-- 2. RLS on the view
-- ============================================
-- PostgREST respects RLS on the underlying table, so SELECT
-- through the view already honors the licenses RLS policies.
-- No additional policies are needed on the view itself.

-- ============================================
-- 3. Grant access so PostgREST can query the view
-- ============================================
-- anon and authenticated roles need SELECT on the view.
-- (These roles already have access to the licenses table via RLS.)

GRANT SELECT ON assets TO anon;
GRANT SELECT ON assets TO authenticated;

-- ============================================
-- Verification
-- ============================================
-- SELECT * FROM assets LIMIT 1;
