-- Infringements table for Revenue Recovery feature
-- Run this in Supabase SQL Editor

-- Create the infringements table
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
-- MOCK DATA FOR TESTING (Total: $4,200)
-- Uses existing license ID: 0d4e820b-a638-4c8f-979b-10456e50b62e
-- ============================================

INSERT INTO infringements (asset_id, detected_url, match_type, estimated_revenue, status) VALUES
  ('0d4e820b-a638-4c8f-979b-10456e50b62e',
   'https://ai-bot-trainer.io/scraped-content/article-1',
   'exact',
   3500.00,
   'detected'),

  ('0d4e820b-a638-4c8f-979b-10456e50b62e',
   'https://www.google.com/search?q=commercial-scraper-news.com',
   'partial',
   700.00,
   'confirmed');
