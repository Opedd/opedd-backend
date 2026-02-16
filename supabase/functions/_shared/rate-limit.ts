import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Database-backed rate limiting via check_rate_limit() SQL function.
// Fail-closed: blocks on DB error to prevent abuse.
export async function isRateLimited(
  supabase: SupabaseClient,
  key: string,
  maxHits = 5,
  windowSeconds = 60
): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_key: key,
    p_max_hits: maxHits,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("[rate-limit] Check error:", error.message);
    return true; // Fail closed — block on error
  }
  return data === true;
}
