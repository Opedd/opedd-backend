-- ============================================================
-- Migration 023: Stripe Checkout Support
-- ============================================================
-- Adds stripe_session_id, makes license_key nullable (generated
-- after payment), and allows 'pending'/'failed' statuses.
-- ============================================================

BEGIN;

-- Add stripe_session_id column
ALTER TABLE license_transactions ADD COLUMN stripe_session_id TEXT UNIQUE;

-- Allow license_key to be NULL (pending transactions don't have one yet)
ALTER TABLE license_transactions ALTER COLUMN license_key DROP NOT NULL;

-- Update status CHECK to include 'pending' and 'failed'
ALTER TABLE license_transactions DROP CONSTRAINT IF EXISTS license_transactions_status_check;
ALTER TABLE license_transactions ADD CONSTRAINT license_transactions_status_check
  CHECK (status IN ('pending', 'completed', 'failed', 'refunded'));

-- Update default status to 'pending' for new Stripe-based flow
-- (existing issue-license still sets 'completed' explicitly)
ALTER TABLE license_transactions ALTER COLUMN status SET DEFAULT 'pending';

-- Index for webhook lookup
CREATE INDEX idx_lt_stripe_session_id ON license_transactions(stripe_session_id);

NOTIFY pgrst, 'reload schema';
COMMIT;
