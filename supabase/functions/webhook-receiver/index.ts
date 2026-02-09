import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ghost-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Shared utilities (same as sync-content-source) ──────────

// Generate a clean, readable snippet from HTML content
function generateSnippet(html: string): string {
  // 1. Strip HTML tags
  let text = html.replace(/<[^>]*>/g, "");
  // 2. Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  // 3. Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  // 4. Truncate at ~300 chars on a sentence or word boundary
  if (text.length <= 300) return text;
  const sentenceEnd = Math.max(
    text.lastIndexOf(". ", 300),
    text.lastIndexOf("! ", 300),
    text.lastIndexOf("? ", 300),
  );
  if (sentenceEnd > 100) return text.substring(0, sentenceEnd + 1) + "\u2026";
  const wordEnd = text.lastIndexOf(" ", 300);
  if (wordEnd > 100) return text.substring(0, wordEnd) + "\u2026";
  return text.substring(0, 300) + "\u2026";
}

async function generateContentHash(sourceUrl: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(sourceUrl);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex.substring(0, 32);
}

function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    let canonical = parsed.href;
    if (canonical.endsWith("/") && parsed.pathname !== "/") {
      canonical = canonical.slice(0, -1);
    }
    return canonical;
  } catch {
    return url.split("?")[0].split("#")[0].replace(/\/+$/, "");
  }
}

// ── Ghost signature verification ────────────────────────────
// Ghost sends: X-Ghost-Signature: sha256=<hex>, t=<timestamp>
// Signed string = rawBody + timestamp, HMAC-SHA256 with webhook_secret

async function verifyGhostSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  try {
    // Parse "sha256=<hash>, t=<timestamp>"
    const parts = signatureHeader.split(", ");
    const hashPart = parts.find((p) => p.startsWith("sha256="));
    const tPart = parts.find((p) => p.startsWith("t="));

    if (!hashPart || !tPart) {
      console.error("[webhook] Ghost signature missing hash or timestamp");
      return false;
    }

    const expectedHash = hashPart.replace("sha256=", "");
    const timestamp = tPart.replace("t=", "");

    // Compute HMAC-SHA256 of (body + timestamp) with the secret
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(rawBody + timestamp),
    );
    const computedHash = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Constant-time comparison
    if (computedHash.length !== expectedHash.length) return false;
    let mismatch = 0;
    for (let i = 0; i < computedHash.length; i++) {
      mismatch |= computedHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
    }
    return mismatch === 0;
  } catch (err) {
    console.error("[webhook] Ghost signature verification error:", err);
    return false;
  }
}

// ── Payload parsing ─────────────────────────────────────────

interface ParsedArticle {
  title: string;
  url: string;
  description: string;
  content: string;
  publishedAt: string | null;
  thumbnailUrl: string | null;
}

function parseGhostPayload(body: Record<string, unknown>): ParsedArticle | null {
  // Ghost post.published: { post: { current: { title, url, html, excerpt, published_at, feature_image, ... } } }
  const post = body.post as Record<string, unknown> | undefined;
  if (!post) return null;

  const current = post.current as Record<string, unknown> | undefined;
  if (!current) return null;

  const url = (current.url as string) || "";
  const title = (current.title as string) || "";
  if (!url || !title) return null;

  // Clean snippet from excerpt or HTML content
  const excerpt = (current.excerpt as string) || "";
  const html = (current.html as string) || "";
  const description = generateSnippet(excerpt || html);

  return {
    title: title.substring(0, 200),
    url: canonicalizeUrl(url),
    description,
    content: html,
    publishedAt: (current.published_at as string) || null,
    thumbnailUrl: (current.feature_image as string) || null,
  };
}

function parseBeehiivPayload(body: Record<string, unknown>): ParsedArticle | null {
  // Beehiiv post.sent: { event_type, data: { title, web_url, subtitle, thumbnail_url, publish_date, ... } }
  const data = body.data as Record<string, unknown> | undefined;
  if (!data) return null;

  const webUrl = (data.web_url as string) || "";
  const title = (data.title as string) || "";
  if (!webUrl || !title) return null;

  const subtitle = (data.subtitle as string) || "";
  const previewText = (data.preview_text as string) || "";
  const description = generateSnippet(subtitle || previewText);

  // publish_date is a Unix timestamp (seconds)
  let publishedAt: string | null = null;
  if (data.publish_date && typeof data.publish_date === "number") {
    publishedAt = new Date(data.publish_date * 1000).toISOString();
  } else if (data.publish_date && typeof data.publish_date === "string") {
    publishedAt = new Date(data.publish_date).toISOString();
  }

  return {
    title: title.substring(0, 200),
    url: canonicalizeUrl(webUrl),
    description,
    content: "",
    publishedAt,
    thumbnailUrl: (data.thumbnail_url as string) || null,
  };
}

// ── Main handler ────────────────────────────────────────────

serve(async (req) => {
  console.log("[webhook] ====== WEBHOOK RECEIVER INVOKED ======");
  console.log("[webhook] Method:", req.method);
  console.log("[webhook] Time:", new Date().toISOString());

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    // ── 1. Extract source_id from URL params ────────────────
    const url = new URL(req.url);
    const sourceId = url.searchParams.get("id");
    const querySecret = url.searchParams.get("secret");

    if (!sourceId) {
      console.error("[webhook] Missing id query parameter");
      return new Response(
        JSON.stringify({ success: false, error: "Missing 'id' query parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[webhook] Source ID:", sourceId);

    // Read raw body for signature verification, then parse
    const rawBody = await req.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.error("[webhook] Invalid JSON body");
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 2. Look up source and verify ────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: source, error: sourceError } = await supabase
      .from("content_sources")
      .select("id, user_id, source_type, url, name, webhook_secret, is_active, verification_status")
      .eq("id", sourceId)
      .single();

    if (sourceError || !source) {
      console.error("[webhook] Source not found:", sourceId, sourceError?.message);
      return new Response(
        JSON.stringify({ success: false, error: "Source not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!source.is_active || source.verification_status !== "verified") {
      console.error("[webhook] Source inactive or unverified:", sourceId);
      return new Response(
        JSON.stringify({ success: false, error: "Source is inactive or unverified" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!source.webhook_secret) {
      console.error("[webhook] No webhook_secret configured for source:", sourceId);
      return new Response(
        JSON.stringify({ success: false, error: "Webhook secret not configured for this source" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 3. Verify request authenticity ──────────────────────
    const ghostSignature = req.headers.get("x-ghost-signature");
    let verified = false;

    if (source.source_type === "ghost" && ghostSignature) {
      // Ghost: verify HMAC signature
      verified = await verifyGhostSignature(rawBody, ghostSignature, source.webhook_secret);
      if (!verified) {
        console.error("[webhook] Ghost signature verification failed for source:", sourceId);
      }
    } else if (querySecret) {
      // Beehiiv and others: verify via ?secret= query param
      verified = querySecret === source.webhook_secret;
      if (!verified) {
        console.error("[webhook] Secret mismatch for source:", sourceId);
      }
    }

    if (!verified) {
      return new Response(
        JSON.stringify({ success: false, error: "Webhook verification failed" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[webhook] Verified webhook for source:", sourceId, "type:", source.source_type);

    // ── 4. Parse payload based on source type ───────────────
    let article: ParsedArticle | null = null;

    if (source.source_type === "ghost") {
      article = parseGhostPayload(body);
    } else if (source.source_type === "beehiiv") {
      article = parseBeehiivPayload(body);
    } else {
      // Attempt Ghost format first, then Beehiiv
      article = parseGhostPayload(body) || parseBeehiivPayload(body);
    }

    if (!article) {
      console.log("[webhook] Could not parse article from payload, logging event only");
      // Still update last_webhook_at even if we can't parse the article
      await supabase
        .from("content_sources")
        .update({ last_webhook_at: new Date().toISOString() })
        .eq("id", sourceId);

      return new Response(
        JSON.stringify({ success: true, data: { parsed: false, message: "Webhook received but no article data found in payload" } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[webhook] Parsed article:", article.title, "url:", article.url);

    // ── 5. Fetch publisher and settings ─────────────────────
    const { data: publisher } = await supabase
      .from("publishers")
      .select("id")
      .eq("user_id", source.user_id)
      .single();

    if (!publisher) {
      console.error("[webhook] No publisher for user:", source.user_id);
      return new Response(
        JSON.stringify({ success: false, error: "No publisher found for source owner" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: settings } = await supabase
      .from("publisher_settings")
      .select("default_human_price, default_ai_price")
      .eq("user_id", source.user_id)
      .single();

    const publisherSettings = settings || { default_human_price: 0, default_ai_price: 0 };

    // ── 6. Insert article into licenses ─────────────────────
    const contentHash = await generateContentHash(article.url);
    const now = new Date().toISOString();
    const publishedAt = article.publishedAt ? new Date(article.publishedAt).toISOString() : null;

    const { data: inserted, error: insertError } = await supabase
      .from("licenses")
      .upsert(
        {
          publisher_id: publisher.id,
          title: article.title,
          description: article.description,
          content: article.content || null,
          source_url: article.url,
          source_id: source.id,
          content_hash: contentHash,
          verification_status: "verified",
          license_type: "standard",
          human_price: publisherSettings.default_human_price,
          ai_price: publisherSettings.default_ai_price,
          published_at: publishedAt,
          thumbnail_url: article.thumbnailUrl,
          metadata: {
            source_name: source.name || "Webhook",
            auto_imported: true,
            synced_at: now,
            registration_type: "invisible",
            webhook_source: source.source_type,
          },
        },
        { onConflict: "publisher_id,source_url" },
      )
      .select("id, title, source_url")
      .single();

    if (insertError) {
      console.error("[webhook] Insert/upsert error:", insertError.message);
      return new Response(
        JSON.stringify({ success: false, error: `Failed to insert article: ${insertError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[webhook] Inserted/updated article:", inserted?.id, inserted?.title);

    // ── 7. Update source: last_webhook_at + article_count ───
    const { count } = await supabase
      .from("licenses")
      .select("id", { count: "exact", head: true })
      .eq("source_id", source.id);

    await supabase
      .from("content_sources")
      .update({
        last_webhook_at: now,
        last_sync_at: now,
        sync_status: "synced",
        article_count: count || 0,
      })
      .eq("id", sourceId);

    // ── 8. Create notification ──────────────────────────────
    await supabase
      .from("notifications")
      .insert({
        user_id: source.user_id,
        type: "new_articles_synced",
        title: "New article from webhook",
        message: `"${article.title}" synced from ${source.name || source.source_type}`,
        metadata: {
          source_id: source.id,
          source_name: source.name,
          article_id: inserted?.id,
          article_title: article.title,
          webhook_source: source.source_type,
          synced_at: now,
        },
      });

    console.log("[webhook] ====== WEBHOOK COMPLETE ======");

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          article_id: inserted?.id,
          title: article.title,
          source_url: article.url,
          source_id: sourceId,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[webhook] ====== FATAL ERROR ======");
    console.error("[webhook] Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: { code: "SERVER_ERROR", message: errorMessage } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
