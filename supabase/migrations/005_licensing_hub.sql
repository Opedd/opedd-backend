-- Licensing Hub: Verification, Pricing, and Transactions
-- Run this in Supabase SQL Editor

-- ============================================
-- 1. ALTER content_sources — add verification columns
-- ============================================

-- Add verification_status column
ALTER TABLE content_sources
  ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'failed'));

-- Add verification_token column
ALTER TABLE content_sources
  ADD COLUMN IF NOT EXISTS verification_token TEXT;

-- Update source_type CHECK constraint to include 'beehiiv' and 'other'
-- Must drop the old constraint and recreate it
ALTER TABLE content_sources
  DROP CONSTRAINT IF EXISTS content_sources_source_type_check;

ALTER TABLE content_sources
  ADD CONSTRAINT content_sources_source_type_check
    CHECK (source_type IN ('rss', 'substack', 'ghost', 'wordpress', 'medium', 'beehiiv', 'other'));

-- ============================================
-- 2. ALTER licenses — add pricing and access type
-- ============================================

-- Add human_price column
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS human_price NUMERIC(10, 2);

-- Add ai_price column
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS ai_price NUMERIC(10, 2);

-- Add access_type column (separate from license_type)
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS access_type TEXT DEFAULT 'both'
    CHECK (access_type IN ('human', 'ai', 'both'));

-- ============================================
-- 3. CREATE transactions table
-- ============================================

CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  license_id UUID REFERENCES licenses(id) ON DELETE CASCADE NOT NULL,
  buyer_info JSONB DEFAULT '{}' NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  currency TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_license_id ON transactions(license_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);

-- Apply updated_at trigger
DROP TRIGGER IF EXISTS update_transactions_updated_at ON transactions;
CREATE TRIGGER update_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Transactions: owners can view their own transactions (via license -> publisher -> user_id)
CREATE POLICY "Publishers can view own transactions" ON transactions
  FOR SELECT USING (
    license_id IN (
      SELECT l.id FROM licenses l
      JOIN publishers p ON l.publisher_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );

-- ============================================
-- Verification Query
-- ============================================
-- Run this to verify changes were applied:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'content_sources' AND column_name IN ('verification_status', 'verification_token');
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'licenses' AND column_name IN ('human_price', 'ai_price', 'access_type');
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'transactions';
