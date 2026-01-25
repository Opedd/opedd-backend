-- Ingestion Infrastructure for Automated Content Import
-- Run this in Supabase SQL Editor

-- ============================================
-- 1. Publisher Settings Table
-- ============================================
CREATE TABLE IF NOT EXISTS publisher_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_human_price NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
  default_ai_price NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
  auto_mint_enabled BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Apply updated_at trigger
DROP TRIGGER IF EXISTS update_publisher_settings_updated_at ON publisher_settings;
CREATE TRIGGER update_publisher_settings_updated_at
  BEFORE UPDATE ON publisher_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE publisher_settings ENABLE ROW LEVEL SECURITY;

-- Users can only access their own settings
CREATE POLICY "Users can view own settings" ON publisher_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings" ON publisher_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings" ON publisher_settings
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- 2. Content Sources Table
-- ============================================
CREATE TABLE IF NOT EXISTS content_sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('rss', 'substack', 'ghost', 'wordpress', 'medium')),
  url TEXT NOT NULL,
  name TEXT,
  is_active BOOLEAN DEFAULT TRUE NOT NULL,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, url)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_content_sources_user_id ON content_sources(user_id);
CREATE INDEX IF NOT EXISTS idx_content_sources_source_type ON content_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_content_sources_is_active ON content_sources(is_active);

-- Apply updated_at trigger
DROP TRIGGER IF EXISTS update_content_sources_updated_at ON content_sources;
CREATE TRIGGER update_content_sources_updated_at
  BEFORE UPDATE ON content_sources
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE content_sources ENABLE ROW LEVEL SECURITY;

-- Users can only access their own content sources
CREATE POLICY "Users can view own content sources" ON content_sources
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own content sources" ON content_sources
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own content sources" ON content_sources
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own content sources" ON content_sources
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 3. Update Licenses (Assets) Table
-- ============================================
-- Add source_url for deduplication
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS source_url TEXT UNIQUE;

-- Add source_id to link to content_sources
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES content_sources(id) ON DELETE SET NULL;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_licenses_source_url ON licenses(source_url);
CREATE INDEX IF NOT EXISTS idx_licenses_source_id ON licenses(source_id);

-- ============================================
-- Verification Query
-- ============================================
-- Run this to verify tables were created:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('publisher_settings', 'content_sources');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'licenses' AND column_name IN ('source_url', 'source_id');
