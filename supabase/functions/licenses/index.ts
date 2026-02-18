import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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
      console.error("[licenses] Auth error:", authError?.message);
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "INVALID_TOKEN", message: "Invalid or expired token" },
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[licenses] User authenticated:", user.id);

    // Get user's publisher
    let { data: publisher, error: publisherError } = await supabase
      .from("publishers")
      .select("id")
      .eq("user_id", user.id)
      .single();

    // Fallback: check team_members if not a direct owner
    if (!publisher) {
      const { data: membership } = await supabase
        .from("team_members")
        .select("publisher_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (membership) {
        publisher = { id: membership.publisher_id };
        publisherError = null;
      }
    }

    if (publisherError || !publisher) {
      console.error("[licenses] Publisher not found:", publisherError?.message);
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "NO_PUBLISHER", message: "Publisher profile not found" },
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[licenses] Publisher found:", publisher.id);

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const licenseId = pathParts[pathParts.length - 1] !== "licenses" ? pathParts[pathParts.length - 1] : null;

    // Handle GET - List user's licenses (paginated)
    if (req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "30")));
      const search = url.searchParams.get("search") || "";
      const status = url.searchParams.get("status") || "all";
      const sourceId = url.searchParams.get("source_id") || "all";

      let query = supabase
        .from("licenses")
        .select("*, content_sources(id, name, url, source_type, verification_token, verification_status)", { count: "exact" })
        .eq("publisher_id", publisher.id);

      // Server-side filters
      if (search) {
        query = query.ilike("title", `%${search}%`);
      }
      if (status !== "all") {
        if (status === "protected") {
          query = query.or("verification_status.eq.verified,licensing_enabled.eq.true");
        } else if (status === "syncing") {
          query = query.eq("verification_status", "pending").eq("licensing_enabled", false);
        } else if (status === "pending") {
          query = query.is("verification_status", null);
        } else if (status === "failed") {
          query = query.eq("verification_status", "failed");
        }
      }
      if (sourceId === "direct") {
        query = query.is("source_id", null);
      } else if (sourceId !== "all") {
        query = query.eq("source_id", sourceId);
      }

      const offset = (page - 1) * limit;
      query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

      const { data: licenses, error: listError, count } = await query;

      if (listError) {
        console.error("[licenses] List error:", listError.message);
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: "LIST_ERROR", message: listError.message },
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get protected count for metrics (lightweight head-only query)
      const { count: protectedCount } = await supabase
        .from("licenses")
        .select("id", { count: "exact", head: true })
        .eq("publisher_id", publisher.id)
        .or("verification_status.eq.verified,licensing_enabled.eq.true");

      console.log("[licenses] Returning page", page, "of", Math.ceil((count || 0) / limit), "— total:", count);

      return new Response(
        JSON.stringify({
          success: true,
          data: licenses?.map((l: any) => ({
            id: l.id,
            user_id: user.id,
            title: l.title,
            description: l.description,
            license_type: l.license_type,
            content_hash: l.content_hash,
            metadata: l.metadata,
            source_id: l.source_id ?? null,
            publication_id: l.source_id ?? null,
            source_url: l.source_url ?? null,
            human_price: l.human_price != null ? Number(l.human_price) : null,
            ai_price: l.ai_price != null ? Number(l.ai_price) : null,
            access_type: l.access_type ?? null,
            licensing_enabled: l.licensing_enabled ?? true,
            total_revenue: l.total_revenue != null ? Number(l.total_revenue) : 0,
            human_licenses_sold: l.human_licenses_sold ?? 0,
            ai_licenses_sold: l.ai_licenses_sold ?? 0,
            content: l.content ?? null,
            thumbnail_url: l.thumbnail_url ?? null,
            published_at: l.published_at ?? null,
            verification_token: l.content_sources?.verification_token ?? l.verification_token ?? null,
            verification_status: l.content_sources?.verification_status ?? l.verification_status ?? 'pending',
            source_status: l.source_status ?? 'active',
            created_at: l.created_at,
            updated_at: l.updated_at,
          })) || [],
          total: count || 0,
          page,
          limit,
          protectedCount: protectedCount || 0,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle POST - Create new license
    if (req.method === "POST") {
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

      const { title, description, licenseType, metadata } = body;

      if (!title || typeof title !== "string") {
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: "VALIDATION_ERROR", message: "Title is required" },
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validLicenseTypes = ["standard", "exclusive", "creative_commons"];
      const finalLicenseType = validLicenseTypes.includes(licenseType) ? licenseType : "standard";

      // Ensure metadata is an object and can contain url
      const finalMetadata = typeof metadata === "object" && metadata !== null ? metadata : {};

      console.log("[licenses] Creating license:", { title, licenseType: finalLicenseType, metadata: finalMetadata });

      const { data: license, error: insertError } = await supabase
        .from("licenses")
        .insert({
          publisher_id: publisher.id,
          title: title.trim(),
          description: (description || "").trim(),
          license_type: finalLicenseType,
          metadata: finalMetadata,
        })
        .select()
        .single();

      if (insertError) {
        console.error("[licenses] Insert error:", insertError.message);
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: "INSERT_ERROR", message: insertError.message },
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[licenses] Created license:", license.id);

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            id: license.id,
            publisherId: license.publisher_id,
            title: license.title,
            description: license.description,
            licenseType: license.license_type,
            contentHash: license.content_hash,
            metadata: license.metadata,
            createdAt: license.created_at,
            updatedAt: license.updated_at,
          },
        }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle DELETE - Delete license by ID
    if (req.method === "DELETE") {
      // Get license ID from query param or path
      const idFromQuery = url.searchParams.get("id");
      const deleteId = idFromQuery || licenseId;

      if (!deleteId) {
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: "MISSING_ID", message: "License ID is required for deletion" },
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[licenses] Deleting license:", deleteId);

      // First verify the license belongs to this publisher
      const { data: existing, error: findError } = await supabase
        .from("licenses")
        .select("id")
        .eq("id", deleteId)
        .eq("publisher_id", publisher.id)
        .single();

      if (findError || !existing) {
        console.error("[licenses] License not found or not owned:", findError?.message);
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: "NOT_FOUND", message: "License not found or access denied" },
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: deleteError } = await supabase
        .from("licenses")
        .delete()
        .eq("id", deleteId)
        .eq("publisher_id", publisher.id);

      if (deleteError) {
        console.error("[licenses] Delete error:", deleteError.message);
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: "DELETE_ERROR", message: deleteError.message },
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[licenses] Deleted license:", deleteId);

      return new Response(
        JSON.stringify({
          success: true,
          message: "License deleted successfully",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Method not allowed
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "METHOD_NOT_ALLOWED", message: `Method ${req.method} not allowed` },
      }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[licenses] Unexpected error:", errorMessage);
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "SERVER_ERROR", message: errorMessage },
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
