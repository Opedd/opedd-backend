BEGIN;

-- Add UNIQUE constraint on stripe_session_id to prevent duplicate license issuance
-- from double-delivered Stripe webhooks
CREATE UNIQUE INDEX IF NOT EXISTS idx_license_transactions_stripe_session_unique
  ON license_transactions (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
COMMIT;
