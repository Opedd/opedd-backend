import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// In-memory rate limit: max 5 requests per email per 60s
const rateLimitWindow = 60_000;
const rateLimitMax = 5;
const hits = new Map<string, number[]>();

function isRateLimited(email: string): boolean {
  const now = Date.now();
  const timestamps = (hits.get(email) || []).filter((t) => now - t < rateLimitWindow);
  if (timestamps.length >= rateLimitMax) {
    hits.set(email, timestamps);
    return true;
  }
  timestamps.push(now);
  hits.set(email, timestamps);
  return false;
}

function generateLicenseKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O, 1/I
  let part1 = "";
  let part2 = "";
  for (let i = 0; i < 4; i++) {
    part1 += chars[Math.floor(Math.random() * chars.length)];
    part2 += chars[Math.floor(Math.random() * chars.length)];
  }
  return `OP-${part1}-${part2}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { article_id, buyer_email, license_type } = body;

    // Validate
    if (!article_id || typeof article_id !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "article_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!buyer_email || typeof buyer_email !== "string" || !buyer_email.includes("@")) {
      return new Response(
        JSON.stringify({ success: false, error: "Valid buyer_email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!license_type || !["human", "ai"].includes(license_type)) {
      return new Response(
        JSON.stringify({ success: false, error: "license_type must be 'human' or 'ai'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limit
    if (isRateLimited(buyer_email)) {
      return new Response(
        JSON.stringify({ success: false, error: "Too many requests. Try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch article + price
    const { data: article, error: articleError } = await supabase
      .from("licenses")
      .select("id, title, human_price, ai_price, licensing_enabled, publisher_id")
      .eq("id", article_id)
      .single();

    if (articleError || !article) {
      return new Response(
        JSON.stringify({ success: false, error: "Article not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!article.licensing_enabled) {
      return new Response(
        JSON.stringify({ success: false, error: "Licensing not enabled for this article" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const price = Number(license_type === "human" ? article.human_price : article.ai_price);
    if (!price || price <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: `No price set for ${license_type} license` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate unique license key (retry on collision)
    let licenseKey = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateLicenseKey();
      const { data: existing } = await supabase
        .from("license_transactions")
        .select("id")
        .eq("license_key", candidate)
        .maybeSingle();
      if (!existing) {
        licenseKey = candidate;
        break;
      }
    }
    if (!licenseKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to generate license key" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert transaction
    const { error: insertError } = await supabase
      .from("license_transactions")
      .insert({
        article_id,
        buyer_email,
        amount: price,
        license_type,
        license_key: licenseKey,
        status: "completed",
      });

    if (insertError) {
      console.error("[issue-license] Insert error:", insertError.message);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to save transaction" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Increment sales counter
    const counterField = license_type === "human" ? "human_licenses_sold" : "ai_licenses_sold";
    const { data: current } = await supabase
      .from("licenses")
      .select(counterField)
      .eq("id", article_id)
      .single();

    await supabase
      .from("licenses")
      .update({ [counterField]: ((current as any)?.[counterField] || 0) + 1 })
      .eq("id", article_id);

    // Notify publisher
    const licenseTypeLabel = license_type === "human" ? "Human" : "AI";
    console.log(`[issue-license] Sale: "${article.title}" — ${licenseTypeLabel} license to ${buyer_email} for $${price}`);

    const { data: publisher } = await supabase
      .from("publishers")
      .select("user_id")
      .eq("id", article.publisher_id)
      .single();

    if (publisher) {
      await supabase.from("notifications").insert({
        user_id: publisher.user_id,
        type: "license_sold",
        title: "License Sold!",
        message: `"${article.title}" — ${licenseTypeLabel} license purchased for $${price.toFixed(2)}`,
        metadata: { article_id, license_type, amount: price, buyer_email, license_key: licenseKey },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: { license_key: licenseKey, article_title: article.title },
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[issue-license] Error:", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
