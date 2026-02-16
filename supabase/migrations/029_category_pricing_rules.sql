-- ============================================================
-- Migration 029: Category & Pricing Rules for Widget Auto-Registration
-- ============================================================
--
-- 1. Add category column to licenses (for auto-registered articles)
-- 2. Add pricing_rules JSONB to publishers (category-based pricing)
-- 3. Update assets view to include category
--
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Add category column to licenses
-- ============================================================

ALTER TABLE licenses ADD COLUMN IF NOT EXISTS category TEXT;
CREATE INDEX IF NOT EXISTS idx_licenses_category ON licenses(category) WHERE category IS NOT NULL;

-- ============================================================
-- 2. Add pricing_rules to publishers
-- ============================================================
-- Format: {"Politics": {"human": 10, "ai": 50}, "default": {"human": 5, "ai": 25}}

ALTER TABLE publishers ADD COLUMN IF NOT EXISTS pricing_rules JSONB DEFAULT '{}';

-- ============================================================
-- 3. Update assets view to include category
-- ============================================================

DROP VIEW IF EXISTS assets;

CREATE VIEW assets AS
SELECT
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
  p.user_id,
  l.source_id                                                     AS publication_id,
  COALESCE(cs.verification_token,  l.verification_token)          AS verification_token,
  COALESCE(cs.verification_status, l.verification_status)         AS verification_status,
  l.licensing_enabled,
  l.total_revenue,
  l.human_licenses_sold,
  l.ai_licenses_sold,
  l.content,
  l.thumbnail_url,
  l.published_at,
  l.source_status,
  l.category
FROM licenses l
JOIN publishers p ON l.publisher_id = p.id
LEFT JOIN content_sources cs ON l.source_id = cs.id;

GRANT SELECT, INSERT, UPDATE, DELETE ON assets TO authenticated;
GRANT SELECT ON assets TO anon;

-- Recreate INSERT trigger (must recreate after DROP VIEW)
CREATE OR REPLACE FUNCTION assets_insert_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_publisher_id UUID;
  v_license_id   UUID;
BEGIN
  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT id INTO v_publisher_id
  FROM publishers WHERE user_id = NEW.user_id LIMIT 1;

  IF v_publisher_id IS NULL THEN
    INSERT INTO publishers (user_id, name)
    VALUES (NEW.user_id, 'Publisher')
    RETURNING id INTO v_publisher_id;
  END IF;

  INSERT INTO licenses (
    title, description, human_price, ai_price, license_type,
    content_hash, metadata, source_url, publisher_id, source_id,
    licensing_enabled, total_revenue, human_licenses_sold,
    ai_licenses_sold, content, thumbnail_url, published_at,
    verification_token, verification_status, category
  ) VALUES (
    NEW.title,
    COALESCE(NEW.description, ''),
    NEW.human_price,
    NEW.ai_price,
    COALESCE(NEW.license_type, 'standard'),
    NEW.content_hash,
    COALESCE(NEW.metadata, '{}'),
    NEW.source_url,
    v_publisher_id,
    NEW.publication_id,
    COALESCE(NEW.licensing_enabled, TRUE),
    COALESCE(NEW.total_revenue, 0),
    COALESCE(NEW.human_licenses_sold, 0),
    COALESCE(NEW.ai_licenses_sold, 0),
    NEW.content,
    NEW.thumbnail_url,
    NEW.published_at,
    NEW.verification_token,
    COALESCE(NEW.verification_status, 'pending'),
    NEW.category
  )
  RETURNING id INTO v_license_id;

  IF NEW.publication_id IS NOT NULL
     AND (NEW.verification_token IS NOT NULL
          OR NEW.verification_status IS NOT NULL) THEN
    UPDATE content_sources SET
      verification_token  = COALESCE(NEW.verification_token, verification_token),
      verification_status = COALESCE(NEW.verification_status, verification_status)
    WHERE id = NEW.publication_id;
  END IF;

  NEW.id := v_license_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assets_instead_insert
  INSTEAD OF INSERT ON assets
  FOR EACH ROW EXECUTE FUNCTION assets_insert_fn();

-- Recreate UPDATE trigger
CREATE OR REPLACE FUNCTION assets_update_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE licenses SET
    title               = NEW.title,
    description         = NEW.description,
    human_price         = NEW.human_price,
    ai_price            = NEW.ai_price,
    license_type        = NEW.license_type,
    content_hash        = NEW.content_hash,
    metadata            = NEW.metadata,
    source_url          = NEW.source_url,
    licensing_enabled   = NEW.licensing_enabled,
    total_revenue       = NEW.total_revenue,
    human_licenses_sold = NEW.human_licenses_sold,
    ai_licenses_sold    = NEW.ai_licenses_sold,
    content             = NEW.content,
    thumbnail_url       = NEW.thumbnail_url,
    published_at        = NEW.published_at,
    verification_token  = NEW.verification_token,
    verification_status = NEW.verification_status,
    category            = NEW.category,
    updated_at          = now()
  WHERE id = OLD.id
    AND publisher_id IN (
      SELECT id FROM publishers WHERE user_id = auth.uid()
    );

  RETURN NEW;
END;
$$;

CREATE TRIGGER assets_instead_update
  INSTEAD OF UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION assets_update_fn();

-- Recreate DELETE trigger
CREATE OR REPLACE FUNCTION assets_delete_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM licenses
  WHERE id = OLD.id
    AND publisher_id IN (
      SELECT id FROM publishers WHERE user_id = auth.uid()
    );

  RETURN OLD;
END;
$$;

CREATE TRIGGER assets_instead_delete
  INSTEAD OF DELETE ON assets
  FOR EACH ROW EXECUTE FUNCTION assets_delete_fn();

COMMIT;
