import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    console.log("[auth-check] Authorization header present:", !!authHeader);

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({
          success: false,
          authenticated: false,
          error: { code: "MISSING_TOKEN", message: "No authorization token provided" },
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    console.log("[auth-check] Token length:", token.length);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("[auth-check] Missing environment variables");
      return new Response(
        JSON.stringify({
          success: false,
          authenticated: false,
          error: { code: "CONFIG_ERROR", message: "Server configuration error" },
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });

    let user = null;
    let error = null;

    try {
      const result = await supabase.auth.getUser();
      user = result.data?.user;
      error = result.error;
      console.log("[auth-check] getUser result - user:", !!user, "error:", error?.message);
    } catch (authError) {
      console.error("[auth-check] getUser threw:", authError);
      error = authError;
    }

    if (error || !user) {
      const errorMessage = error instanceof Error ? error.message : "Invalid or expired token";
      return new Response(
        JSON.stringify({
          success: false,
          authenticated: false,
          error: { code: "INVALID_TOKEN", message: errorMessage },
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("[auth-check] User authenticated:", user.id);

    return new Response(
      JSON.stringify({
        success: true,
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[auth-check] Unexpected error:", errorMessage);
    return new Response(
      JSON.stringify({
        success: false,
        authenticated: false,
        error: { code: "CHECK_ERROR", message: errorMessage },
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
