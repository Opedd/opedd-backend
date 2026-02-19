import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

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

// Build a 429 response with Retry-After header
export function rateLimitResponse(message: string, retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    }
  );
}
