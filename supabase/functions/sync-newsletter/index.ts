import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";
import Parser from "npm:rss-parser@3.13.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Chrome-like User-Agent for sites that block bots
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

// Generate content_hash from source_url — must match sync-content-source logic
async function generateContentHash(sourceUrl: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(sourceUrl);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex.substring(0, 32);
}

// Determine if URL needs browser User-Agent (Substack, Medium, etc.)
function needsBrowserUserAgent(url: string): boolean {
  const browserAgentDomains = [
    "substack.com",
    "medium.com",
    "ghost.io",
    "opedd.com",
  ];
  return browserAgentDomains.some((domain) => url.includes(domain));
}

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: {
    id: string;
    user_id: string;
    url: string;
    name?: string;
    source_type?: string;
  };
  schema: string;
  old_record: Record<string, unknown> | null;
}

interface PublisherSettings {
  default_human_price: number;
  default_ai_price: number;
  auto_mint_enabled: boolean;
}

// Helper: update content_sources sync_status and return a 200 response
async function setErrorStatus(
  supabase: ReturnType<typeof createClient>,
  sourceId: string,
  message: string,
) {
  await supabase
    .from("content_sources")
    .update({ sync_status: "error" })
    .eq("id", sourceId);

  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

serve(async (req) => {
  console.log("[sync-newsletter] ====== INVOKED ======");
  console.log("[sync-newsletter] Method:", req.method);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Always return 200 so Supabase webhooks don't retry
  try {
    // ── 1. Parse webhook payload ──────────────────────────────
    let payload: WebhookPayload;
    try {
      payload = await req.json();
      console.log("[sync-newsletter] Payload type:", payload.type, "table:", payload.table);
    } catch {
      console.error("[sync-newsletter] Invalid JSON payload");
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON payload" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 2. Guard: only handle INSERT ─────────────────────────
    if (payload.type !== "INSERT") {
      console.log("[sync-newsletter] Ignoring non-INSERT event:", payload.type);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: `Ignored ${payload.type} event` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { id: sourceId, user_id: userId, url: feedUrl } = payload.record;

    if (!sourceId || !userId || !feedUrl) {
      console.error("[sync-newsletter] Missing required fields in record");
      return new Response(
        JSON.stringify({ success: false, error: "Missing id, user_id, or url in record" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[sync-newsletter] Processing source:", sourceId, "user:", userId, "url:", feedUrl);

    // ── Service-role client (no auth header from webhooks) ───
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── 3. Set status to 'syncing' ──────────────────────────
    await supabase
      .from("content_sources")
      .update({ sync_status: "syncing" })
      .eq("id", sourceId);

    console.log("[sync-newsletter] Status set to syncing");

    // ── 4. Find or create publisher ─────────────────────────
    let { data: publisher, error: publisherError } = await supabase
      .from("publishers")
      .select("id")
      .eq("user_id", userId)
      .single();

    if (publisherError || !publisher) {
      console.log("[sync-newsletter] Publisher not found, auto-creating for user:", userId);

      // Fetch user email for publisher name
      const { data: { user } } = await supabase.auth.admin.getUserById(userId);
      const publisherName = user?.email?.split("@")[0] || "Publisher";

      const { data: newPublisher, error: createError } = await supabase
        .from("publishers")
        .insert({ user_id: userId, name: publisherName })
        .select("id")
        .single();

      if (createError || !newPublisher) {
        console.error("[sync-newsletter] Failed to create publisher:", createError?.message);
        return setErrorStatus(supabase, sourceId, "Failed to create publisher");
      }

      publisher = newPublisher;
      console.log("[sync-newsletter] Auto-created publisher:", publisher.id);
    }

    const publisherId = publisher.id as string;
    console.log("[sync-newsletter] Publisher ID:", publisherId);

    // ── 5. Fetch publisher settings ─────────────────────────
    const { data: settings } = await supabase
      .from("publisher_settings")
      .select("default_human_price, default_ai_price, auto_mint_enabled")
      .eq("user_id", userId)
      .single();

    const publisherSettings: PublisherSettings = settings || {
      default_human_price: 0,
      default_ai_price: 0,
      auto_mint_enabled: false,
    };

    console.log("[sync-newsletter] Publisher settings:", JSON.stringify(publisherSettings));

    // ── 6. Fetch RSS feed ───────────────────────────────────
    let feedText: string;
    try {
      const userAgent = needsBrowserUserAgent(feedUrl)
        ? BROWSER_USER_AGENT
        : "Opedd RSS Sync/1.0";

      console.log("[sync-newsletter] Fetching feed with UA:", userAgent.substring(0, 50));

      const feedResponse = await fetch(feedUrl, {
        headers: {
          "User-Agent": userAgent,
          Accept:
            "application/rss+xml, application/xml, text/xml, application/atom+xml, */*",
        },
      });

      console.log("[sync-newsletter] Feed response status:", feedResponse.status);

      if (!feedResponse.ok) {
        console.error("[sync-newsletter] Feed fetch failed:", feedResponse.status);
        return setErrorStatus(
          supabase,
          sourceId,
          `Failed to fetch feed: HTTP ${feedResponse.status}`,
        );
      }

      feedText = await feedResponse.text();
      console.log("[sync-newsletter] Fetched feed, length:", feedText.length, "bytes");
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : "Unknown fetch error";
      console.error("[sync-newsletter] Fetch exception:", msg);
      return setErrorStatus(supabase, sourceId, `Failed to fetch feed: ${msg}`);
    }

    // ── 7. Parse with rss-parser ────────────────────────────
    const parser = new Parser({
      customFields: {
        item: [["content:encoded", "contentEncoded"]],
      },
    });

    let feed;
    try {
      feed = await parser.parseString(feedText);
      console.log("[sync-newsletter] Parsed feed:", feed.title, "—", feed.items?.length, "items");
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : "Unknown parse error";
      console.error("[sync-newsletter] Parse error:", msg);
      return setErrorStatus(supabase, sourceId, `Failed to parse feed: ${msg}`);
    }

    if (!feed.items || feed.items.length === 0) {
      console.log("[sync-newsletter] No items found in feed");
      await supabase
        .from("content_sources")
        .update({
          sync_status: "protected",
          article_count: 0,
          last_sync_at: new Date().toISOString(),
        })
        .eq("id", sourceId);

      return new Response(
        JSON.stringify({ success: true, items_found: 0, items_imported: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 8. Build license rows ───────────────────────────────
    const now = new Date().toISOString();
    const sourceName = payload.record.name || new URL(feedUrl).hostname;

    const licenseRows = [];
    for (const item of feed.items) {
      const link = item.link;
      if (!link) continue;

      const title = (item.title || "Untitled").substring(0, 200);
      const description = generateSnippet(item.contentSnippet || "");
      const content = item.contentEncoded || item.content || "";
      const publishedAt = item.isoDate
        ? new Date(item.isoDate).toISOString()
        : null;
      const contentHash = await generateContentHash(link);

      licenseRows.push({
        publisher_id: publisherId,
        title,
        description,
        content,
        source_url: link,
        source_id: sourceId,
        content_hash: contentHash,
        verification_status: "verified",
        license_type: "standard",
        human_price: publisherSettings.default_human_price,
        ai_price: publisherSettings.default_ai_price,
        published_at: publishedAt,
        metadata: {
          source_name: sourceName,
          auto_imported: true,
          synced_at: now,
          registration_type: "invisible",
        },
      });
    }

    console.log("[sync-newsletter] Built", licenseRows.length, "license rows");

    // ── 9. Batch upsert into licenses (chunks of 50) ───────
    const CHUNK_SIZE = 50;
    let totalImported = 0;
    const errors: string[] = [];

    for (let i = 0; i < licenseRows.length; i += CHUNK_SIZE) {
      const chunk = licenseRows.slice(i, i + CHUNK_SIZE);

      const { data, error } = await supabase
        .from("licenses")
        .upsert(chunk, { onConflict: "publisher_id,source_url" })
        .select("id");

      if (error) {
        console.error(
          "[sync-newsletter] Upsert error on chunk",
          i / CHUNK_SIZE,
          ":",
          error.message,
        );
        errors.push(error.message);
      } else {
        totalImported += data?.length || 0;
        console.log(
          "[sync-newsletter] Upserted chunk",
          i / CHUNK_SIZE,
          ":",
          data?.length,
          "rows",
        );
      }
    }

    console.log("[sync-newsletter] Total imported:", totalImported, "errors:", errors.length);

    // ── 10. Set status to 'protected' ───────────────────────
    await supabase
      .from("content_sources")
      .update({
        sync_status: "protected",
        article_count: totalImported,
        last_sync_at: now,
      })
      .eq("id", sourceId);

    console.log("[sync-newsletter] ====== SYNC COMPLETE ======");

    // ── 11. Always return 200 ───────────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        source_id: sourceId,
        items_found: feed.items.length,
        items_imported: totalImported,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[sync-newsletter] ====== FATAL ERROR ======", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
