-- ============================================================
-- Migration 009: Fix UNIQUE violation on rss_sources INSERT
-- ============================================================
--
-- Problem: If a user already has a content_source with the same
-- feed URL, the rss_sources INSERT trigger fails with:
--   "duplicate key value violates unique constraint"
--
-- Fix: Use ON CONFLICT ... DO UPDATE (upsert) so re-adding
-- the same feed URL updates the existing row instead of failing.
--
-- Run this in Supabase SQL Editor.
-- ============================================================

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
