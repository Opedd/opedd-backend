-- ============================================================
-- Migration 010: Fix PostgREST schema cache + view alignment
-- ============================================================
--
-- Root cause: After migrations 008/009 created views with
-- INSTEAD OF triggers, PostgREST's in-memory schema cache
-- was never reloaded.  Without the reload, PostgREST does not
-- know the views are writable and rejects INSERT/UPDATE/DELETE
-- with a permission or "cannot insert into view" error.
--
-- This migration also:
--   - Adds the missing `last_synced_at` column to rss_sources
--   - Adds an INSERT RLS policy on publishers
--   - Forces a PostgREST schema cache reload
--
-- Run this in Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Recreate rss_sources view with last_synced_at column
--    (content_sources has `last_sync_at`; frontend expects
--     `last_synced_at`)
-- ============================================================

DROP VIEW IF EXISTS rss_sources CASCADE;

CREATE VIEW rss_sources AS
SELECT
  cs.id,
  cs.user_id,
  cs.name,
  cs.url            AS feed_url,
  cs.source_type    AS platform,
  cs.sync_status,
  cs.article_count,
  cs.last_sync_at   AS last_synced_at,
  cs.created_at,
  cs.updated_at
FROM content_sources cs;

GRANT SELECT, INSERT, UPDATE, DELETE ON rss_sources TO authenticated;
GRANT SELECT ON rss_sources TO anon;

-- INSERT trigger (includes upsert from migration 009) ----------
CREATE OR REPLACE FUNCTION rss_sources_insert_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO content_sources (
    user_id, name, url, source_type, sync_status, article_count
  ) VALUES (
    NEW.user_id,
    COALESCE(NEW.name, ''),
    NEW.feed_url,
    COALESCE(NEW.platform, 'rss'),
    COALESCE(NEW.sync_status, 'pending'),
    COALESCE(NEW.article_count, 0)
  )
  ON CONFLICT (user_id, url) DO UPDATE SET
    name         = EXCLUDED.name,
    source_type  = EXCLUDED.source_type,
    sync_status  = EXCLUDED.sync_status,
    article_count = EXCLUDED.article_count,
    updated_at   = now()
  RETURNING id INTO NEW.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER rss_sources_instead_insert
  INSTEAD OF INSERT ON rss_sources
  FOR EACH ROW EXECUTE FUNCTION rss_sources_insert_fn();

-- UPDATE trigger ------------------------------------------------
CREATE OR REPLACE FUNCTION rss_sources_update_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE content_sources SET
    name         = NEW.name,
    url          = NEW.feed_url,
    source_type  = NEW.platform,
    sync_status  = NEW.sync_status,
    article_count = NEW.article_count,
    updated_at   = now()
  WHERE id = OLD.id
    AND user_id = auth.uid();

  RETURN NEW;
END;
$$;

CREATE TRIGGER rss_sources_instead_update
  INSTEAD OF UPDATE ON rss_sources
  FOR EACH ROW EXECUTE FUNCTION rss_sources_update_fn();

-- DELETE trigger ------------------------------------------------
CREATE OR REPLACE FUNCTION rss_sources_delete_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM content_sources
  WHERE id = OLD.id
    AND user_id = auth.uid();

  RETURN OLD;
END;
$$;

CREATE TRIGGER rss_sources_instead_delete
  INSTEAD OF DELETE ON rss_sources
  FOR EACH ROW EXECUTE FUNCTION rss_sources_delete_fn();

-- ============================================================
-- 2. Ensure assets view triggers are present
--    (recreate just in case they were lost)
-- ============================================================

-- Drop and recreate assets view to ensure clean state
DROP VIEW IF EXISTS assets CASCADE;

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
  l.published_at
FROM licenses l
JOIN publishers p ON l.publisher_id = p.id
LEFT JOIN content_sources cs ON l.source_id = cs.id;

GRANT SELECT, INSERT, UPDATE, DELETE ON assets TO authenticated;
GRANT SELECT ON assets TO anon;

-- INSERT trigger ------------------------------------------------
CREATE OR REPLACE FUNCTION assets_insert_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_publisher_id UUID;
  v_license_id   UUID;
BEGIN
  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Find or create publisher for this user
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
    verification_token, verification_status
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
    COALESCE(NEW.verification_status, 'pending')
  )
  RETURNING id INTO v_license_id;

  -- Push verification data to the linked content_source
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

-- UPDATE trigger ------------------------------------------------
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

-- DELETE trigger ------------------------------------------------
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

-- ============================================================
-- 3. Add INSERT RLS policy on publishers
--    (SECURITY DEFINER triggers bypass RLS, but adding the
--     policy is good practice for direct access)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'publishers'
      AND policyname = 'Users can create own publisher'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can create own publisher" ON publishers
      FOR INSERT WITH CHECK (auth.uid() = user_id)';
  END IF;
END $$;

-- ============================================================
-- 4. Force PostgREST schema cache reload
--    This is CRITICAL — without it PostgREST doesn't know
--    the views have INSTEAD OF triggers and rejects writes.
-- ============================================================

NOTIFY pgrst, 'reload schema';

COMMIT;
