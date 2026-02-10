import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Only POST allowed
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "METHOD_NOT_ALLOWED", message: `Method ${req.method} not allowed` },
        }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get and validate auth token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "MISSING_TOKEN", message: "No authorization token provided" },
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Create client with user's token for RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    // Verify user and get their info
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.error("[update-license-prices] Auth error:", authError?.message);
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "INVALID_TOKEN", message: "Invalid or expired token" },
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[update-license-prices] User authenticated:", user.id);

    // Get user's publisher
    const { data: publisher, error: publisherError } = await supabase
      .from("publishers")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (publisherError || !publisher) {
      console.error("[update-license-prices] Publisher not found:", publisherError?.message);
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "NO_PUBLISHER", message: "Publisher profile not found" },
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[update-license-prices] Publisher found:", publisher.id);

    // Parse request body
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "INVALID_JSON", message: "Invalid JSON in request body" },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { articleIds, sourceId, humanPrice, aiPrice, licensingEnabled } = body;

    // Validate: at least one selector (articleIds or sourceId), not both
    if (!articleIds && !sourceId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Either articleIds or sourceId is required" },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (articleIds && sourceId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Provide either articleIds or sourceId, not both" },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate articleIds format
    if (articleIds && (!Array.isArray(articleIds) || articleIds.length === 0)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "articleIds must be a non-empty array" },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate: at least one field to update
    if (humanPrice === undefined && aiPrice === undefined && licensingEnabled === undefined) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "At least one of humanPrice, aiPrice, or licensingEnabled is required" },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate prices are non-negative
    if (humanPrice !== undefined && (typeof humanPrice !== "number" || humanPrice < 0)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "humanPrice must be a non-negative number" },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (aiPrice !== undefined && (typeof aiPrice !== "number" || aiPrice < 0)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "aiPrice must be a non-negative number" },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (licensingEnabled !== undefined && typeof licensingEnabled !== "boolean") {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "licensingEnabled must be a boolean" },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build update payload
    const updatePayload: Record<string, unknown> = {};
    if (humanPrice !== undefined) updatePayload.human_price = humanPrice;
    if (aiPrice !== undefined) updatePayload.ai_price = aiPrice;
    if (licensingEnabled !== undefined) updatePayload.licensing_enabled = licensingEnabled;

    // Build and execute update query scoped to publisher_id
    let query = supabase
      .from("licenses")
      .update(updatePayload)
      .eq("publisher_id", publisher.id);

    if (articleIds) {
      query = query.in("id", articleIds);
    } else {
      query = query.eq("source_id", sourceId);
    }

    const { data, error: updateError } = await query.select("id");

    if (updateError) {
      console.error("[update-license-prices] Update error:", updateError.message);
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "UPDATE_ERROR", message: updateError.message },
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const updatedCount = data?.length ?? 0;
    console.log("[update-license-prices] Updated", updatedCount, "licenses");

    return new Response(
      JSON.stringify({
        success: true,
        data: { updatedCount },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[update-license-prices] Unexpected error:", errorMessage);
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "SERVER_ERROR", message: errorMessage },
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
