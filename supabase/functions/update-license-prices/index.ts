import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, errorResponse, successResponse } from "../_shared/cors.ts";
import { createServiceClient, authenticatePublisher } from "../_shared/auth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const { user, publisher, error: authError } = await authenticatePublisher(req);
    if (authError || !publisher) {
      return errorResponse(authError || "Unauthorized", authError === "Publisher profile not found" ? 404 : 401);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON");
    }

    const { articleIds, sourceId, humanPrice, aiPrice, licensingEnabled } = body;

    // Validate: at least one selector
    if (!articleIds && !sourceId) {
      return errorResponse("Either articleIds or sourceId is required");
    }
    if (articleIds && sourceId) {
      return errorResponse("Provide either articleIds or sourceId, not both");
    }
    if (articleIds && (!Array.isArray(articleIds) || articleIds.length === 0)) {
      return errorResponse("articleIds must be a non-empty array");
    }

    // Validate: at least one field to update
    if (humanPrice === undefined && aiPrice === undefined && licensingEnabled === undefined) {
      return errorResponse("At least one of humanPrice, aiPrice, or licensingEnabled is required");
    }

    // Validate prices
    if (humanPrice !== undefined && (typeof humanPrice !== "number" || humanPrice < 0)) {
      return errorResponse("humanPrice must be a non-negative number");
    }
    if (aiPrice !== undefined && (typeof aiPrice !== "number" || aiPrice < 0)) {
      return errorResponse("aiPrice must be a non-negative number");
    }
    if (licensingEnabled !== undefined && typeof licensingEnabled !== "boolean") {
      return errorResponse("licensingEnabled must be a boolean");
    }

    const supabase = createServiceClient();

    // Build update payload
    const updatePayload: Record<string, unknown> = {};
    if (humanPrice !== undefined) updatePayload.human_price = humanPrice;
    if (aiPrice !== undefined) updatePayload.ai_price = aiPrice;
    if (licensingEnabled !== undefined) updatePayload.licensing_enabled = licensingEnabled;

    // Execute update scoped to publisher_id
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
      return errorResponse("Failed to update prices", 500);
    }

    const updatedCount = data?.length ?? 0;
    console.log(`[update-license-prices] Updated ${updatedCount} licenses for publisher ${publisher.id}`);

    return successResponse({ updatedCount });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[update-license-prices] Error:", msg);
    return errorResponse("Internal server error", 500);
  }
});
