BEGIN;

-- Drop old transactions table (no production data yet)
DROP TABLE IF EXISTS transactions;

-- Lean license_transactions table
CREATE TABLE license_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  buyer_email TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  license_type TEXT NOT NULL CHECK (license_type IN ('human', 'ai')),
  license_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_lt_article_id ON license_transactions(article_id);
CREATE INDEX idx_lt_license_key ON license_transactions(license_key);
CREATE INDEX idx_lt_buyer_email ON license_transactions(buyer_email);

-- RLS: service role only (Edge Functions bypass RLS)
ALTER TABLE license_transactions ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
COMMIT;
