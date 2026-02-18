import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, errorResponse, successResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/auth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    // Require auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return errorResponse("No authorization token provided", 401);
    }

    const supabase = createServiceClient();
    const token = authHeader.substring(7).trim();

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return errorResponse("Invalid or expired token", 401);
    }

    // Read invite token from body
    let body;
    try { body = await req.json(); } catch { body = {}; }

    const inviteToken = body.token;
    if (!inviteToken || typeof inviteToken !== "string") {
      return errorResponse("Invitation token is required");
    }

    // Look up invitation
    const { data: invitation, error: lookupErr } = await supabase
      .from("team_invitations")
      .select("id, publisher_id, email, role, expires_at, accepted_at")
      .eq("token", inviteToken)
      .single();

    if (lookupErr || !invitation) {
      return errorResponse("Invalid invitation token", 404);
    }

    // Validate: not already accepted
    if (invitation.accepted_at) {
      return errorResponse("This invitation has already been accepted");
    }

    // Validate: not expired
    if (new Date(invitation.expires_at) < new Date()) {
      return errorResponse("This invitation has expired");
    }

    // Validate: email matches (case-insensitive)
    if (invitation.email.toLowerCase() !== user.email?.toLowerCase()) {
      return errorResponse("This invitation was sent to a different email address", 403);
    }

    // Check if already a member
    const { data: existingMember } = await supabase
      .from("team_members")
      .select("id")
      .eq("publisher_id", invitation.publisher_id)
      .eq("user_id", user.id)
      .single();

    if (existingMember) {
      // Mark invitation as accepted even if already a member
      await supabase
        .from("team_invitations")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invitation.id);

      return successResponse({ joined: true, already_member: true });
    }

    // Insert into team_members
    const { error: insertErr } = await supabase
      .from("team_members")
      .insert({
        publisher_id: invitation.publisher_id,
        user_id: user.id,
        role: invitation.role || "member",
        invited_by: null, // we could look up invited_by from invitation but not critical
      });

    if (insertErr) {
      console.error("[accept-invite] Insert error:", insertErr.message);
      return errorResponse("Failed to join team", 500);
    }

    // Mark invitation as accepted
    await supabase
      .from("team_invitations")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invitation.id);

    // Get publisher name for response
    const { data: pub } = await supabase
      .from("publishers")
      .select("name")
      .eq("id", invitation.publisher_id)
      .single();

    console.log(`[accept-invite] User ${user.id} joined publisher ${invitation.publisher_id}`);
    return successResponse({
      joined: true,
      publisher_name: pub?.name || "Unknown",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[accept-invite] Error:", msg);
    return errorResponse("Internal server error", 500);
  }
});
