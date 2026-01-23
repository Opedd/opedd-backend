import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const BACKEND_URL = Deno.env.get("BACKEND_URL") || "https://opedd-backend.vercel.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.searchParams.get("path") || "";
    const targetUrl = `${BACKEND_URL}/api/v1/${path}`;

    console.log(`[api-proxy] ${req.method} ${targetUrl}`);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      headers["Authorization"] = authHeader;
    }

    let body: string | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      try {
        body = await req.text();
      } catch {
        body = undefined;
      }
    }

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: body || undefined,
    });

    console.log(`[api-proxy] Response status: ${response.status}`);

    // Safely parse response body
    const responseText = await response.text();

    let data;
    if (!responseText || !responseText.trim()) {
      console.warn(`[api-proxy] Empty response from backend for: ${targetUrl}`);
      data = { success: true, data: [] };
    } else {
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error(`[api-proxy] Failed to parse JSON: ${responseText.substring(0, 200)}`);
        data = {
          success: false,
          error: { code: "PARSE_ERROR", message: "Invalid JSON from backend" },
        };
      }
    }

    console.log(`[api-proxy] Forwarding response:`, JSON.stringify(data).substring(0, 200));

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error(`[api-proxy] Error:`, error.message);
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "PROXY_ERROR", message: error.message },
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
