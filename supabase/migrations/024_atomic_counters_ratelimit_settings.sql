-- ============================================================
-- Migration 024: Atomic Counters, Rate Limiting, Publisher Settings
-- ============================================================

BEGIN;

-- 1. Atomic license counter increment (fixes race condition)
CREATE OR REPLACE FUNCTION increment_license_counter(
  p_article_id UUID,
  p_license_type TEXT,
  p_amount NUMERIC
) RETURNS void AS $$
BEGIN
  IF p_license_type = 'human' THEN
    UPDATE licenses
    SET human_licenses_sold = human_licenses_sold + 1,
        total_revenue = total_revenue + p_amount
    WHERE id = p_article_id;
  ELSIF p_license_type = 'ai' THEN
    UPDATE licenses
    SET ai_licenses_sold = ai_licenses_sold + 1,
        total_revenue = total_revenue + p_amount
    WHERE id = p_article_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 2. Rate limiting table
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hit_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

-- Auto-cleanup: delete entries older than 5 minutes
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

-- Rate limit check function: returns TRUE if rate limited
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key TEXT,
  p_max_hits INTEGER DEFAULT 5,
  p_window_seconds INTEGER DEFAULT 60
) RETURNS BOOLEAN AS $$
DECLARE
  v_count INTEGER;
  v_window_start TIMESTAMPTZ;
BEGIN
  v_window_start := NOW() - (p_window_seconds || ' seconds')::INTERVAL;

  -- Clean old entries
  DELETE FROM rate_limits WHERE window_start < v_window_start;

  -- Count recent hits
  SELECT COALESCE(SUM(hit_count), 0) INTO v_count
  FROM rate_limits
  WHERE key = p_key AND window_start >= v_window_start;

  IF v_count >= p_max_hits THEN
    RETURN TRUE; -- Rate limited
  END IF;

  -- Record this hit
  INSERT INTO rate_limits (key, window_start, hit_count)
  VALUES (p_key, date_trunc('second', NOW()), 1)
  ON CONFLICT (key, window_start) DO UPDATE SET hit_count = rate_limits.hit_count + 1;

  RETURN FALSE; -- Not rate limited
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 3. Publisher settings columns
ALTER TABLE publishers ADD COLUMN IF NOT EXISTS api_key TEXT UNIQUE;
ALTER TABLE publishers ADD COLUMN IF NOT EXISTS default_human_price NUMERIC(10,2);
ALTER TABLE publishers ADD COLUMN IF NOT EXISTS default_ai_price NUMERIC(10,2);
ALTER TABLE publishers ADD COLUMN IF NOT EXISTS website_url TEXT;
ALTER TABLE publishers ADD COLUMN IF NOT EXISTS description TEXT;

-- Index for API key lookup
CREATE INDEX IF NOT EXISTS idx_publishers_api_key ON publishers(api_key);

NOTIFY pgrst, 'reload schema';
COMMIT;
