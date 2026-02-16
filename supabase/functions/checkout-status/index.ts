import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, errorResponse, successResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/auth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("session_id");

    if (!sessionId) {
      return errorResponse("session_id is required");
    }

    const supabase = createServiceClient();

    const { data: tx, error: txError } = await supabase
      .from("license_transactions")
      .select("license_key, license_type, status, amount, article_id")
      .eq("stripe_session_id", sessionId)
      .single();

    if (txError || !tx) {
      return errorResponse("Transaction not found", 404);
    }

    // Fetch article title
    const { data: article } = await supabase
      .from("licenses")
      .select("title")
      .eq("id", tx.article_id)
      .single();

    return successResponse({
      status: tx.status,
      license_key: tx.license_key,
      license_type: tx.license_type,
      amount: tx.amount,
      article_title: article?.title || "Unknown",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[checkout-status] Error:", msg);
    return errorResponse("Internal server error", 500);
  }
});
