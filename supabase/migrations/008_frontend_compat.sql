-- ============================================================
-- Migration 008: Frontend Compatibility Layer
-- ============================================================
--
-- Makes the Supabase PostgREST API match what the Lovable-
-- generated frontend expects.
--
-- Problem: The frontend does direct PostgREST calls to tables
-- and views that don't exist or aren't writable:
--   - INSERT into "rss_sources"  (table doesn't exist)
--   - INSERT/UPDATE/DELETE "assets"  (read-only view)
--   - INSERT into "transactions" with asset_id  (column is license_id)
--
-- This migration fixes all of those by:
--   1. Adding columns to `licenses` the frontend writes via `assets`
--   2. Adding columns to `content_sources` for rss_sources compat
--   3. Relaxing CHECK constraints to accept frontend values
--   4. Creating writable `rss_sources` view over `content_sources`
--   5. Recreating writable `assets` view over `licenses`
--   6. Aligning `transactions` table with frontend field names
--   7. Setting up RLS policies, grants, and triggers
--
-- Run this in Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Add columns to licenses that the frontend writes
--    via the assets view
-- ============================================================

ALTER TABLE licenses ADD COLUMN IF NOT EXISTS total_revenue NUMERIC(10,2) DEFAULT 0;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS human_licenses_sold INTEGER DEFAULT 0;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS ai_licenses_sold INTEGER DEFAULT 0;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS licensing_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending';
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS verification_token TEXT;

-- ============================================================
-- 2. Add columns to content_sources for rss_sources compat
-- ============================================================

ALTER TABLE content_sources ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'pending';
ALTER TABLE content_sources ADD COLUMN IF NOT EXISTS article_count INTEGER DEFAULT 0;

-- Drop the UNIQUE constraint on source_url — different publishers
-- should be able to license the same URL
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'licenses'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%source_url%'
  LOOP
    EXECUTE format('ALTER TABLE licenses DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- ============================================================
-- 3. Relax CHECK constraints
-- ============================================================

-- license_type: frontend sends 'human', 'ai', 'both' in addition
-- to the original 'standard', 'exclusive', 'creative_commons'
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'licenses'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%license_type%'
  LOOP
    EXECUTE format('ALTER TABLE licenses DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE licenses ADD CONSTRAINT licenses_license_type_check
  CHECK (license_type IN ('standard', 'exclusive', 'creative_commons', 'human', 'ai', 'both'));

-- source_type: frontend sends various platform names;
-- remove the restrictive CHECK entirely
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'content_sources'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%source_type%'
  LOOP
    EXECUTE format('ALTER TABLE content_sources DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- ============================================================
-- 4. Create writable rss_sources view over content_sources
-- ============================================================

DROP VIEW IF EXISTS rss_sources;

CREATE VIEW rss_sources AS
SELECT
  cs.id,
  cs.user_id,
  cs.name,
  cs.url            AS feed_url,
  cs.source_type    AS platform,
  cs.sync_status,
  cs.article_count,
  cs.created_at,
  cs.updated_at
FROM content_sources cs;

GRANT SELECT, INSERT, UPDATE, DELETE ON rss_sources TO authenticated;
GRANT SELECT ON rss_sources TO anon;

-- INSERT trigger -----------------------------------------------
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

-- UPDATE trigger -----------------------------------------------
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

-- DELETE trigger -----------------------------------------------
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
-- 5. Recreate writable assets view over licenses
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
  l.published_at
FROM licenses l
JOIN publishers p ON l.publisher_id = p.id
LEFT JOIN content_sources cs ON l.source_id = cs.id;

GRANT SELECT, INSERT, UPDATE, DELETE ON assets TO authenticated;
GRANT SELECT ON assets TO anon;

-- INSERT trigger -----------------------------------------------
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
    NEW.publication_id,              -- maps to source_id in licenses
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

  -- Also push verification data to the linked content_source
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

-- UPDATE trigger -----------------------------------------------
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

-- DELETE trigger -----------------------------------------------
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
-- 6. Align transactions table with frontend expectations
-- ============================================================

-- Create table if migration 005 was never applied
CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id UUID REFERENCES licenses(id) ON DELETE CASCADE NOT NULL,
  buyer_info JSONB DEFAULT '{}' NOT NULL,
  amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'USD' NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- If table existed from migration 005 with license_id, rename it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'license_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'asset_id'
  ) THEN
    ALTER TABLE transactions RENAME COLUMN license_id TO asset_id;
  END IF;
END $$;

-- Add columns the frontend expects
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS publisher_id UUID;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS license_type TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS story_protocol_hash TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS buyer_email TEXT;

-- Relax status CHECK to include 'settled' (used by frontend Checkout)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'transactions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE transactions DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE transactions ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('pending', 'completed', 'failed', 'refunded', 'settled'));

-- Indexes
DROP INDEX IF EXISTS idx_transactions_license_id;
CREATE INDEX IF NOT EXISTS idx_transactions_asset_id ON transactions(asset_id);
CREATE INDEX IF NOT EXISTS idx_transactions_publisher_id ON transactions(publisher_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);

-- Updated_at trigger
DROP TRIGGER IF EXISTS update_transactions_updated_at ON transactions;
CREATE TRIGGER update_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Drop old policies (may reference license_id)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies WHERE tablename = 'transactions'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON transactions', r.policyname);
  END LOOP;
END $$;

-- Publishers can see transactions on their content
CREATE POLICY "Publishers can view own transactions"
  ON transactions FOR SELECT
  USING (publisher_id = auth.uid());

-- Any authenticated user can create a transaction (buyer flow)
CREATE POLICY "Authenticated users can insert transactions"
  ON transactions FOR INSERT
  WITH CHECK (true);

GRANT ALL ON transactions TO authenticated;
GRANT SELECT ON transactions TO anon;

COMMIT;
