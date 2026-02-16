-- Add Stripe Connect fields to publishers
ALTER TABLE publishers
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_onboarding_complete BOOLEAN DEFAULT FALSE;

-- Index for looking up publishers by stripe account
CREATE INDEX IF NOT EXISTS idx_publishers_stripe_account_id
  ON publishers(stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
