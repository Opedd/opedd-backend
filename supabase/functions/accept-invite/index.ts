import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, errorResponse, successResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/auth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createServiceClient();

  try {
    // GET — public lookup: return invitation details by token (no auth needed)
    if (req.method === "GET") {
      const url = new URL(req.url);
      const inviteToken = url.searchParams.get("token");
      if (!inviteToken) {
        return errorResponse("Token query parameter is required");
      }

      const { data: invitation, error: lookupErr } = await supabase
        .from("team_invitations")
        .select("id, publisher_id, email, expires_at, accepted_at")
        .eq("token", inviteToken)
        .single();

      if (lookupErr || !invitation) {
        return errorResponse("Invalid invitation token", 404);
      }

      // Get publisher name
      const { data: pub } = await supabase
        .from("publishers")
        .select("name")
        .eq("id", invitation.publisher_id)
        .single();

      const expired = new Date(invitation.expires_at) < new Date();
      const accepted = !!invitation.accepted_at;

      return successResponse({
        email: invitation.email,
        publisher_name: pub?.name || "Unknown",
        expired,
        accepted,
      });
    }

    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    // POST — two modes:
    // 1. With auth header → existing user accepting invite
    // 2. Without auth, with password → new user signup + accept

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

    if (invitation.accepted_at) {
      return errorResponse("This invitation has already been accepted");
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return errorResponse("This invitation has expired");
    }

    const authHeader = req.headers.get("Authorization");
    const hasAuth = authHeader && authHeader.startsWith("Bearer ") && authHeader.length > 20;

    // --- Mode 1: Authenticated user accepting invite ---
    if (hasAuth) {
      const token = authHeader!.substring(7).trim();
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return errorResponse("Invalid or expired token", 401);
      }

      // Validate email matches
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
        await supabase
          .from("team_invitations")
          .update({ accepted_at: new Date().toISOString() })
          .eq("id", invitation.id);
        return successResponse({ joined: true, already_member: true });
      }

      // Insert team member
      const { error: insertErr } = await supabase
        .from("team_members")
        .insert({
          publisher_id: invitation.publisher_id,
          user_id: user.id,
          role: invitation.role || "member",
        });

      if (insertErr) {
        console.error("[accept-invite] Insert error:", insertErr.message);
        return errorResponse("Failed to join team", 500);
      }

      await supabase
        .from("team_invitations")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invitation.id);

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
    }

    // --- Mode 2: No auth — signup with password + accept ---
    const password = body.password;
    if (!password || typeof password !== "string" || password.length < 8) {
      return errorResponse("Password is required (minimum 8 characters)");
    }

    const invitedEmail = invitation.email.toLowerCase();

    // Try to create user — if they already exist, createUser returns an error
    // This avoids the O(n) listUsers() scan
    const { data: newUserData, error: createErr } = await supabase.auth.admin.createUser({
      email: invitedEmail,
      password,
      email_confirm: true,
    });

    if (createErr) {
      // User already exists — tell frontend to redirect to login
      if (createErr.message?.includes("already been registered") || createErr.message?.includes("already exists")) {
        return errorResponse("An account with this email already exists. Please log in instead.", 409);
      }
      console.error("[accept-invite] Create user error:", createErr.message);
      return errorResponse("Failed to create account", 500);
    }

    if (!newUserData?.user) {
      return errorResponse("Failed to create account", 500);
    }

    const newUser = newUserData.user;

    // Insert team member
    const { error: insertErr } = await supabase
      .from("team_members")
      .insert({
        publisher_id: invitation.publisher_id,
        user_id: newUser.id,
        role: invitation.role || "member",
      });

    if (insertErr) {
      console.error("[accept-invite] Insert member error:", insertErr.message);
      return errorResponse("Account created but failed to join team. Please log in and try again.", 500);
    }

    // Mark invitation accepted
    await supabase
      .from("team_invitations")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invitation.id);

    const { data: pub } = await supabase
      .from("publishers")
      .select("name")
      .eq("id", invitation.publisher_id)
      .single();

    console.log(`[accept-invite] New user ${newUser.id} created and joined publisher ${invitation.publisher_id}`);
    return successResponse({
      joined: true,
      created: true,
      publisher_name: pub?.name || "Unknown",
      email: invitedEmail,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[accept-invite] Error:", msg);
    return errorResponse("Internal server error", 500);
  }
});
