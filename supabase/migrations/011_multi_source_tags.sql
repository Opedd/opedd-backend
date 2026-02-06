-- ============================================================
-- Migration 011: Add tags column for Multi-Source architecture
-- ============================================================
--
-- This migration adds a `tags` column to content_sources for
-- categorizing feeds, and updates the rss_sources view and
-- its INSTEAD OF triggers to handle the new column.
--
-- Run this in Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Add tags column to content_sources
-- ============================================================

ALTER TABLE content_sources
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- ============================================================
-- 2. Recreate rss_sources view to include tags
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
  cs.tags,
  cs.created_at,
  cs.updated_at
FROM content_sources cs;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON rss_sources TO authenticated;
GRANT SELECT ON rss_sources TO anon;

-- ============================================================
-- 3. Recreate INSTEAD OF triggers with tags support
-- ============================================================

-- INSERT trigger with upsert + tags
CREATE OR REPLACE FUNCTION rss_sources_insert_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO content_sources (
    user_id, name, url, source_type, sync_status, article_count, tags
  ) VALUES (
    NEW.user_id,
    COALESCE(NEW.name, ''),
    NEW.feed_url,
    COALESCE(NEW.platform, 'rss'),
    COALESCE(NEW.sync_status, 'pending'),
    COALESCE(NEW.article_count, 0),
    COALESCE(NEW.tags, '{}')
  )
  ON CONFLICT (user_id, url) DO UPDATE SET
    name          = EXCLUDED.name,
    source_type   = EXCLUDED.source_type,
    sync_status   = EXCLUDED.sync_status,
    article_count = EXCLUDED.article_count,
    tags          = EXCLUDED.tags,
    updated_at    = now()
  RETURNING id INTO NEW.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER rss_sources_instead_insert
  INSTEAD OF INSERT ON rss_sources
  FOR EACH ROW EXECUTE FUNCTION rss_sources_insert_fn();

-- UPDATE trigger with tags
CREATE OR REPLACE FUNCTION rss_sources_update_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE content_sources SET
    name          = NEW.name,
    url           = NEW.feed_url,
    source_type   = NEW.platform,
    sync_status   = NEW.sync_status,
    article_count = NEW.article_count,
    tags          = NEW.tags,
    updated_at    = now()
  WHERE id = OLD.id
    AND user_id = auth.uid();

  RETURN NEW;
END;
$$;

CREATE TRIGGER rss_sources_instead_update
  INSTEAD OF UPDATE ON rss_sources
  FOR EACH ROW EXECUTE FUNCTION rss_sources_update_fn();

-- DELETE trigger (unchanged logic)
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
-- 4. Force PostgREST schema cache reload
-- ============================================================

NOTIFY pgrst, 'reload schema';

COMMIT;
