-- ============================================================
-- Migration 018: Pricing Controls & Marketplace View
-- ============================================================
--
-- 1. Non-negative price constraints on licenses
-- 2. Non-negative price constraints on publisher_settings
-- 3. Auto-apply default prices trigger on licenses
-- 4. Marketplace listings view (filtered: licensed + verified)
--
-- Run this in Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Non-negative price constraints on licenses
-- ============================================================

ALTER TABLE licenses ADD CONSTRAINT licenses_human_price_non_negative
  CHECK (human_price >= 0);

ALTER TABLE licenses ADD CONSTRAINT licenses_ai_price_non_negative
  CHECK (ai_price >= 0);

-- ============================================================
-- 2. Non-negative price constraints on publisher_settings
-- ============================================================

ALTER TABLE publisher_settings ADD CONSTRAINT publisher_settings_human_price_non_negative
  CHECK (default_human_price >= 0);

ALTER TABLE publisher_settings ADD CONSTRAINT publisher_settings_ai_price_non_negative
  CHECK (default_ai_price >= 0);

-- ============================================================
-- 3. Auto-apply default prices trigger on licenses
-- ============================================================
-- AFTER INSERT trigger that fills in prices from publisher_settings
-- only when prices are NULL (so explicit values aren't overwritten).

CREATE OR REPLACE FUNCTION apply_default_prices()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID;
  v_default_human NUMERIC(10,2);
  v_default_ai NUMERIC(10,2);
BEGIN
  -- Only apply if prices are NULL
  IF NEW.human_price IS NOT NULL AND NEW.ai_price IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Look up user_id via publisher
  SELECT user_id INTO v_user_id
  FROM publishers WHERE id = NEW.publisher_id;

  IF v_user_id IS NULL THEN RETURN NEW; END IF;

  -- Look up defaults
  SELECT default_human_price, default_ai_price
  INTO v_default_human, v_default_ai
  FROM publisher_settings WHERE user_id = v_user_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Apply defaults only to NULL fields
  UPDATE licenses SET
    human_price = COALESCE(NEW.human_price, v_default_human),
    ai_price = COALESCE(NEW.ai_price, v_default_ai)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER licenses_apply_default_prices
  AFTER INSERT ON licenses
  FOR EACH ROW EXECUTE FUNCTION apply_default_prices();

-- ============================================================
-- 4. Marketplace listings view
-- ============================================================
-- Public, read-only, filtered to only licensed + verified articles.

CREATE VIEW marketplace_listings AS
SELECT
  l.id,
  l.title,
  l.description,
  l.human_price,
  l.ai_price,
  l.license_type,
  l.source_url,
  l.thumbnail_url,
  l.published_at,
  l.metadata,
  p.id AS publisher_id,
  p.name AS publisher_name,
  l.created_at
FROM licenses l
JOIN publishers p ON l.publisher_id = p.id
WHERE l.licensing_enabled = TRUE
  AND l.verification_status = 'verified';

GRANT SELECT ON marketplace_listings TO anon;
GRANT SELECT ON marketplace_listings TO authenticated;

COMMIT;
