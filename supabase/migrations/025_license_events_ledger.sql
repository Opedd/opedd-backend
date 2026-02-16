-- ============================================================
-- Migration 025: Immutable License Events Ledger
-- ============================================================
-- Append-only event log for all license actions. This is the
-- backbone of the Registry of Proof — every action is recorded
-- as an immutable event for auditability and transparency.
-- ============================================================

BEGIN;

CREATE TABLE license_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  -- Event types:
  --   license.issued        — free license issued via issue-license
  --   license.paid          — paid license issued via stripe-webhook
  --   license.verified      — license key verified via verify-license
  --   license.revoked       — license revoked (future)
  --   payment.initiated     — Stripe checkout session created
  --   payment.completed     — Stripe payment succeeded
  --   payment.failed        — Stripe checkout expired/failed
  --   email.sent            — Handshake Email sent
  --   email.failed          — Handshake Email failed

  license_key TEXT,            -- OP-XXXX-XXXX (null for pre-issuance events)
  transaction_id UUID,         -- FK to license_transactions (null for verify events)
  article_id UUID,             -- FK to licenses
  publisher_id UUID,           -- FK to publishers

  actor_type TEXT NOT NULL,    -- 'system', 'buyer', 'publisher', 'stripe', 'cron'
  actor_id TEXT,               -- email address, user_id, 'stripe-webhook', etc.

  metadata JSONB DEFAULT '{}', -- flexible payload (amount, license_type, etc.)
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for common queries
CREATE INDEX idx_le_event_type ON license_events(event_type);
CREATE INDEX idx_le_license_key ON license_events(license_key);
CREATE INDEX idx_le_article_id ON license_events(article_id);
CREATE INDEX idx_le_publisher_id ON license_events(publisher_id);
CREATE INDEX idx_le_created_at ON license_events(created_at DESC);
CREATE INDEX idx_le_actor ON license_events(actor_type, actor_id);

-- RLS: append-only for service role, read-only for publishers
ALTER TABLE license_events ENABLE ROW LEVEL SECURITY;

-- Publishers can view events related to their content
CREATE POLICY "Publishers can view own events"
  ON license_events FOR SELECT USING (
    publisher_id IN (
      SELECT id FROM publishers WHERE user_id = auth.uid()
    )
  );

-- No UPDATE or DELETE policies — immutable by design
-- Service role (Edge Functions) bypasses RLS for INSERT

-- Enable Realtime for live event feed
ALTER PUBLICATION supabase_realtime ADD TABLE license_events;

NOTIFY pgrst, 'reload schema';
COMMIT;
