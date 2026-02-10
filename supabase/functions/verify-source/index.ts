import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Build candidate URLs to check for the verification token.
 * Tries /about first (Substack convention), then root URL.
 */
function getCandidateUrls(
  url: string,
  sourceType?: string
): string[] {
  const base = url.replace(/\/+$/, "");
  const candidates: string[] = [];

  if (sourceType === "substack" || sourceType === "rss") {
    candidates.push(`${base}/about`);
  }

  if (!candidates.includes(`${base}/about`)) {
    candidates.push(`${base}/about`);
  }

  candidates.push(base);
  return candidates;
}

/**
 * Fetch a page and return HTML text, or null on failure.
 */
async function fetchPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": BROWSER_USER_AGENT },
      redirect: "follow",
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

serve(async (req) => {
  console.log("[verify-source] ====== VERIFY FUNCTION INVOKED ======");
  console.log("[verify-source] Method:", req.method);
  console.log("[verify-source] Time:", new Date().toISOString());

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Extract and validate Bearer token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("[verify-source] ERROR: No authorization token provided");
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "MISSING_TOKEN",
            message: "No authorization token provided",
          },
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Service role client for DB writes (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.log("[verify-source] ERROR: Invalid or expired token");
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "INVALID_TOKEN",
            message: "Invalid or expired token",
          },
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("[verify-source] User authenticated:", user.id);

    // 2. Parse request body
    let body: { source_id?: string };
    try {
      body = await req.json();
      console.log("[verify-source] Request body:", JSON.stringify(body));
    } catch {
      console.log("[verify-source] ERROR: Invalid JSON in request body");
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "INVALID_JSON",
            message: "Invalid JSON in request body",
          },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { source_id } = body;
    if (!source_id) {
      console.log("[verify-source] ERROR: Missing source_id");
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "MISSING_PARAMS",
            message: "source_id is required",
          },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 3. Fetch the content source
    const { data: source, error: sourceError } = await supabase
      .from("content_sources")
      .select(
        "id, user_id, url, source_type, verification_token, verification_status"
      )
      .eq("id", source_id)
      .single();

    if (sourceError || !source) {
      console.error(
        "[verify-source] ERROR: Source not found:",
        sourceError?.message
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "SOURCE_NOT_FOUND",
            message: "Content source not found",
          },
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 4. Verify ownership (service role bypasses RLS, so manual check)
    if (source.user_id !== user.id) {
      console.log(
        "[verify-source] ERROR: User does not own this source"
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "ACCESS_DENIED",
            message: "You do not own this content source",
          },
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!source.verification_token) {
      console.log("[verify-source] ERROR: No verification token on source");
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "NO_TOKEN",
            message:
              "This content source does not have a verification token",
          },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("[verify-source] Checking source:", source.url);
    console.log("[verify-source] Token:", source.verification_token);

    // 5. Build candidate URLs and check for token
    const candidates = getCandidateUrls(source.url, source.source_type);
    let verified = false;

    for (const candidateUrl of candidates) {
      console.log("[verify-source] Checking URL:", candidateUrl);
      const html = await fetchPage(candidateUrl);
      if (html && html.includes(source.verification_token)) {
        console.log("[verify-source] Token FOUND at:", candidateUrl);
        verified = true;
        break;
      }
      console.log(
        "[verify-source] Token not found at:",
        candidateUrl
      );
    }

    // 6. Update verification status
    const newStatus = verified ? "verified" : "failed";
    const updateData: Record<string, unknown> = {
      verification_status: newStatus,
    };

    if (verified) {
      updateData.last_verified_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from("content_sources")
      .update(updateData)
      .eq("id", source_id);

    if (updateError) {
      console.error(
        "[verify-source] ERROR: Failed to update status:",
        updateError.message
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "UPDATE_FAILED",
            message: "Failed to update verification status",
          },
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(
      "[verify-source] Updated status to:",
      newStatus
    );
    console.log("[verify-source] ====== VERIFY COMPLETE ======");

    // 7. Return result
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          id: source.id,
          verification_status: newStatus,
          verified,
          checked_urls: candidates,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[verify-source] ====== FATAL ERROR ======");
    console.error("[verify-source] Error:", errorMessage);
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "SERVER_ERROR", message: errorMessage },
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
