-- Add blockchain proof tracking to license_transactions
ALTER TABLE license_transactions
  ADD COLUMN blockchain_tx_hash TEXT,
  ADD COLUMN blockchain_status TEXT DEFAULT 'pending'
    CHECK (blockchain_status IN ('pending', 'submitted', 'confirmed', 'failed'));

-- Index for finding unconfirmed transactions (retry logic)
CREATE INDEX idx_lt_blockchain_status ON license_transactions(blockchain_status)
  WHERE blockchain_status IN ('pending', 'failed');
