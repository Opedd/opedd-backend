-- ============================================================
-- Migration 015: Smart Sync Engine
-- ============================================================
--
-- This migration:
-- 1. Creates a notifications table for user alerts
-- 2. Enables pg_cron + pg_net extensions (must be enabled in Dashboard first)
-- 3. Schedules a cron job to sync all verified sources every 12 hours
--
-- Prerequisites (manual, one-time):
--   1. Enable pg_cron and pg_net extensions in Supabase Dashboard
--   2. Store secrets in Supabase Vault:
--      SELECT vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key', 'For pg_cron batch sync');
--      SELECT vault.create_secret('<SUPABASE_URL>', 'supabase_url', 'For pg_cron batch sync');
--
-- Run this in Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. Notifications table
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  metadata JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON notifications (user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON notifications (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id, is_read) WHERE is_read = FALSE;

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

-- Users can update their own notifications (mark as read)
CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Service role inserts (bypasses RLS automatically)

-- Enable Realtime for notifications table
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- ─────────────────────────────────────────────────────────────
-- 2. Enable extensions (must be enabled in Dashboard first)
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ─────────────────────────────────────────────────────────────
-- 3. Cron job: sync all verified sources every 12 hours
-- ─────────────────────────────────────────────────────────────
-- Reads service_role_key and supabase_url from Vault.
-- Schedule: every 12 hours at minute 0 (midnight & noon UTC).

SELECT cron.schedule(
  'smart-sync-all-sources',
  '0 */12 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/sync-content-sources',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{"source": "pg_cron"}'::jsonb
  );
  $$
);

-- Hardcoded fallback (uncomment and fill in if Vault is not available):
-- SELECT cron.schedule(
--   'smart-sync-all-sources',
--   '0 */12 * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-content-sources',
--     headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
--     body := '{"source": "pg_cron"}'::jsonb
--   );
--   $$
-- );

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';

COMMIT;
