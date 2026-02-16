import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, errorResponse, successResponse } from "../_shared/cors.ts";
import { createServiceClient, authenticatePublisher } from "../_shared/auth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!["GET", "PATCH"].includes(req.method)) {
    return errorResponse("Method not allowed", 405);
  }

  try {
    // authenticatePublisher returns user even if publisher not found
    const authResult = await authenticatePublisher(req);
    if (!authResult.user) {
      return errorResponse(authResult.error || "Unauthorized", 401);
    }

    const supabase = createServiceClient();
    const userId = authResult.user.id;

    // GET — fetch notifications
    if (req.method === "GET") {
      const url = new URL(req.url);
      const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 50);
      const unreadOnly = url.searchParams.get("unread") === "true";

      let query = supabase
        .from("notifications")
        .select("id, type, title, message, metadata, is_read, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (unreadOnly) {
        query = query.eq("is_read", false);
      }

      const { data: notifications, error: fetchError } = await query;

      if (fetchError) {
        console.error("[get-notifications] Fetch error:", fetchError.message);
        return errorResponse("Failed to fetch notifications", 500);
      }

      // Get unread count
      const { count: unreadCount } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_read", false);

      return successResponse({
        notifications: notifications || [],
        unread_count: unreadCount || 0,
      });
    }

    // PATCH — mark notifications as read
    if (req.method === "PATCH") {
      let body;
      try { body = await req.json(); } catch {
        return errorResponse("Invalid JSON");
      }

      const { notification_ids, mark_all_read } = body;

      if (mark_all_read) {
        await supabase
          .from("notifications")
          .update({ is_read: true })
          .eq("user_id", userId)
          .eq("is_read", false);
      } else if (notification_ids && Array.isArray(notification_ids)) {
        await supabase
          .from("notifications")
          .update({ is_read: true })
          .eq("user_id", userId)
          .in("id", notification_ids);
      } else {
        return errorResponse("Provide notification_ids array or mark_all_read: true");
      }

      return successResponse({ marked: true });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[get-notifications] Error:", msg);
    return errorResponse("Internal server error", 500);
  }
});
