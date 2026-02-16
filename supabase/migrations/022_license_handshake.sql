-- ============================================================
-- Migration 022: License Handshake Fields
-- ============================================================
-- Adds buyer identity and intent fields to license_transactions
-- to support the Licensing Handshake flow.
-- ============================================================

BEGIN;

ALTER TABLE license_transactions ADD COLUMN buyer_name TEXT;
ALTER TABLE license_transactions ADD COLUMN buyer_organization TEXT;
ALTER TABLE license_transactions ADD COLUMN intended_use TEXT CHECK (
  intended_use IN ('personal', 'editorial', 'commercial', 'ai_training', 'corporate')
);

NOTIFY pgrst, 'reload schema';
COMMIT;
