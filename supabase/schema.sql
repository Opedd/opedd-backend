-- Opedd Database Schema
-- Run this in Supabase SQL Editor

-- Publishers table
CREATE TABLE IF NOT EXISTS publishers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Licenses table
CREATE TABLE IF NOT EXISTS licenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  publisher_id UUID REFERENCES publishers(id) ON DELETE CASCADE NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT DEFAULT '' NOT NULL,
  license_type VARCHAR(50) NOT NULL CHECK (license_type IN ('standard', 'exclusive', 'creative_commons')),
  content_hash VARCHAR(255),
  metadata JSONB DEFAULT '{}' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_publishers_user_id ON publishers(user_id);
CREATE INDEX IF NOT EXISTS idx_licenses_publisher_id ON licenses(publisher_id);
CREATE INDEX IF NOT EXISTS idx_licenses_created_at ON licenses(created_at DESC);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to tables
DROP TRIGGER IF EXISTS update_publishers_updated_at ON publishers;
CREATE TRIGGER update_publishers_updated_at
  BEFORE UPDATE ON publishers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_licenses_updated_at ON licenses;
CREATE TRIGGER update_licenses_updated_at
  BEFORE UPDATE ON licenses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies

-- Enable RLS
ALTER TABLE publishers ENABLE ROW LEVEL SECURITY;
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;

-- Publishers: users can only see/edit their own publisher profile
CREATE POLICY "Users can view own publisher" ON publishers
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own publisher" ON publishers
  FOR UPDATE USING (auth.uid() = user_id);

-- Licenses: publishers can only manage their own licenses
CREATE POLICY "Publishers can view own licenses" ON licenses
  FOR SELECT USING (
    publisher_id IN (
      SELECT id FROM publishers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Publishers can create own licenses" ON licenses
  FOR INSERT WITH CHECK (
    publisher_id IN (
      SELECT id FROM publishers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Publishers can update own licenses" ON licenses
  FOR UPDATE USING (
    publisher_id IN (
      SELECT id FROM publishers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Publishers can delete own licenses" ON licenses
  FOR DELETE USING (
    publisher_id IN (
      SELECT id FROM publishers WHERE user_id = auth.uid()
    )
  );

-- Infringements table (for Revenue Recovery feature)
CREATE TABLE IF NOT EXISTS infringements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id UUID REFERENCES licenses(id) ON DELETE CASCADE NOT NULL,
  detected_url TEXT NOT NULL,
  match_type VARCHAR(50) NOT NULL CHECK (match_type IN ('exact', 'partial', 'similar', 'derivative')),
  estimated_revenue DECIMAL(10, 2) DEFAULT 0.00 NOT NULL,
  status VARCHAR(50) DEFAULT 'detected' NOT NULL CHECK (status IN ('detected', 'reviewing', 'confirmed', 'disputed', 'resolved')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for infringements
CREATE INDEX IF NOT EXISTS idx_infringements_asset_id ON infringements(asset_id);
CREATE INDEX IF NOT EXISTS idx_infringements_status ON infringements(status);
CREATE INDEX IF NOT EXISTS idx_infringements_created_at ON infringements(created_at DESC);

-- Apply updated_at trigger to infringements
DROP TRIGGER IF EXISTS update_infringements_updated_at ON infringements;
CREATE TRIGGER update_infringements_updated_at
  BEFORE UPDATE ON infringements
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS on infringements
ALTER TABLE infringements ENABLE ROW LEVEL SECURITY;

-- Infringements: publishers can only see infringements for their own assets
CREATE POLICY "Publishers can view own infringements" ON infringements
  FOR SELECT USING (
    asset_id IN (
      SELECT l.id FROM licenses l
      JOIN publishers p ON l.publisher_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "Publishers can update own infringements" ON infringements
  FOR UPDATE USING (
    asset_id IN (
      SELECT l.id FROM licenses l
      JOIN publishers p ON l.publisher_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );

-- ============================================
-- Publisher Settings (Ingestion Config)
-- ============================================
CREATE TABLE IF NOT EXISTS publisher_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_human_price NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
  default_ai_price NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
  auto_mint_enabled BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

DROP TRIGGER IF EXISTS update_publisher_settings_updated_at ON publisher_settings;
CREATE TRIGGER update_publisher_settings_updated_at
  BEFORE UPDATE ON publisher_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE publisher_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own settings" ON publisher_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings" ON publisher_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings" ON publisher_settings
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- Content Sources (RSS, Substack, Ghost, etc.)
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

CREATE INDEX IF NOT EXISTS idx_content_sources_user_id ON content_sources(user_id);
CREATE INDEX IF NOT EXISTS idx_content_sources_source_type ON content_sources(source_type);

DROP TRIGGER IF EXISTS update_content_sources_updated_at ON content_sources;
CREATE TRIGGER update_content_sources_updated_at
  BEFORE UPDATE ON content_sources
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE content_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own content sources" ON content_sources
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own content sources" ON content_sources
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own content sources" ON content_sources
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own content sources" ON content_sources
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- Licenses table additions for ingestion
-- ============================================
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS source_url TEXT UNIQUE;

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES content_sources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_licenses_source_url ON licenses(source_url);
CREATE INDEX IF NOT EXISTS idx_licenses_source_id ON licenses(source_id);
