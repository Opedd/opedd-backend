import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, errorResponse, successResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/auth.ts";
import { isRateLimited } from "../_shared/rate-limit.ts";

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const selectCols = "id, title, description, source_url, human_price, ai_price, licensing_enabled, publisher_id, category";

async function lookupByUrl(supabase: ReturnType<typeof createServiceClient>, sourceUrl: string) {
  // Try exact match first
  let { data: article } = await supabase
    .from("licenses")
    .select(selectCols)
    .eq("source_url", sourceUrl)
    .maybeSingle();

  // Try without trailing slash
  if (!article) {
    const normalized = sourceUrl.replace(/\/+$/, "");
    const { data: alt } = await supabase
      .from("licenses")
      .select(selectCols)
      .eq("source_url", normalized)
      .maybeSingle();
    if (alt) article = alt;
  }

  // Try with trailing slash
  if (!article) {
    const withSlash = sourceUrl.replace(/\/+$/, "") + "/";
    const { data: alt2 } = await supabase
      .from("licenses")
      .select(selectCols)
      .eq("source_url", withSlash)
      .maybeSingle();
    if (alt2) article = alt2;
  }

  return article;
}

async function getPublisherName(supabase: ReturnType<typeof createServiceClient>, publisherId: string) {
  const { data: publisher } = await supabase
    .from("publishers")
    .select("name")
    .eq("id", publisherId)
    .single();
  return publisher?.name || "Unknown";
}

function formatArticleResponse(article: Record<string, unknown>, publisherName: string) {
  return {
    id: article.id,
    title: article.title,
    description: article.description,
    source_url: article.source_url,
    publisher: publisherName,
    human_price: article.human_price,
    ai_price: article.ai_price,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createServiceClient();

    // === GET: existing lookup logic ===
    if (req.method === "GET") {
      const reqUrl = new URL(req.url);
      const sourceUrl = reqUrl.searchParams.get("url");

      if (!sourceUrl) {
        return errorResponse("url query parameter is required");
      }

      const article = await lookupByUrl(supabase, sourceUrl);

      if (!article) {
        return errorResponse("Article not found for the given URL", 404);
      }

      if (!article.licensing_enabled) {
        return errorResponse("Licensing is not enabled for this article", 403);
      }

      const publisherName = article.publisher_id
        ? await getPublisherName(supabase, article.publisher_id as string)
        : "Unknown";

      return successResponse(formatArticleResponse(article, publisherName));
    }

    // === POST: auto-register article ===
    if (req.method === "POST") {
      const body = await req.json();
      const { publisher_id, url, title, description, category, published_at, thumbnail_url } = body;

      // Validate required fields
      if (!publisher_id || !url || !title) {
        return errorResponse("publisher_id, url, and title are required");
      }

      // Rate limit: 100/hour per publisher
      const limited = await isRateLimited(supabase, `auto-register:${publisher_id}`, 100, 3600);
      if (limited) {
        return errorResponse("Rate limit exceeded for auto-registration", 429);
      }

      // Fetch publisher
      const { data: publisher, error: pubError } = await supabase
        .from("publishers")
        .select("id, name, website_url, default_human_price, default_ai_price, pricing_rules")
        .eq("id", publisher_id)
        .single();

      if (pubError || !publisher) {
        return errorResponse("Publisher not found", 404);
      }

      // Domain check: Origin header must match publisher's website_url
      const origin = req.headers.get("Origin") || req.headers.get("Referer") || "";
      const originDomain = extractDomain(origin);
      const publisherDomain = extractDomain(publisher.website_url || "");

      if (!originDomain || !publisherDomain || originDomain !== publisherDomain) {
        return errorResponse("Domain mismatch: widget must be served from publisher's registered domain", 403);
      }

      // Check if article already exists (idempotent)
      const existing = await lookupByUrl(supabase, url);
      if (existing) {
        const publisherName = await getPublisherName(supabase, publisher_id);
        return successResponse(formatArticleResponse(existing, publisherName));
      }

      // Determine pricing: category rules → publisher defaults
      let humanPrice = publisher.default_human_price ?? 0;
      let aiPrice = publisher.default_ai_price ?? 0;

      if (category && publisher.pricing_rules && typeof publisher.pricing_rules === "object") {
        const rules = publisher.pricing_rules as Record<string, { human?: number; ai?: number }>;
        if (rules[category]) {
          humanPrice = rules[category].human ?? humanPrice;
          aiPrice = rules[category].ai ?? aiPrice;
        }
      }

      // Insert new article
      const { data: newArticle, error: insertError } = await supabase
        .from("licenses")
        .insert({
          publisher_id,
          title,
          description: description || "",
          source_url: url,
          human_price: humanPrice,
          ai_price: aiPrice,
          licensing_enabled: true,
          verification_status: "verified",
          category: category || null,
          published_at: published_at || null,
          thumbnail_url: thumbnail_url || null,
        })
        .select(selectCols)
        .single();

      if (insertError) {
        console.error("[lookup-article] Insert error:", insertError.message);
        return errorResponse("Failed to register article", 500);
      }

      return successResponse(formatArticleResponse(newArticle, publisher.name));
    }

    return errorResponse("Method not allowed", 405);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[lookup-article] Error:", msg);
    return errorResponse("Internal server error", 500);
  }
});
