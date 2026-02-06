import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Chrome-like User-Agent for sites that block bots
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Generate content_hash from source_url - must match frontend logic
// Uses SHA-256 hash of the URL, truncated to 32 chars
async function generateContentHash(sourceUrl: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(sourceUrl);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex.substring(0, 32);
}

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string | null;
  contentHash?: string;
}

interface ContentSource {
  id: string;
  user_id: string;
  source_type: string;
  url: string;
  name: string | null;
}

interface PublisherSettings {
  default_human_price: number;
  default_ai_price: number;
  auto_mint_enabled: boolean;
}

interface Publisher {
  id: string;
}

// Parse RSS/Atom feed XML
function parseRSSFeed(xml: string): RSSItem[] {
  const items: RSSItem[] = [];

  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (!doc) {
      console.error("[sync] Failed to parse XML document");
      return items;
    }

    // Try RSS 2.0 format first
    let itemElements = doc.querySelectorAll("item");

    // If no items, try Atom format
    if (itemElements.length === 0) {
      itemElements = doc.querySelectorAll("entry");
    }

    for (const item of itemElements) {
      // RSS 2.0 format
      let title = item.querySelector("title")?.textContent?.trim() || "";
      let link = item.querySelector("link")?.textContent?.trim() || "";
      let description = item.querySelector("description")?.textContent?.trim() ||
                       item.querySelector("content\\:encoded")?.textContent?.trim() ||
                       item.querySelector("content")?.textContent?.trim() || "";
      let pubDate = item.querySelector("pubDate")?.textContent?.trim() ||
                   item.querySelector("published")?.textContent?.trim() ||
                   item.querySelector("updated")?.textContent?.trim() || null;

      // Atom format: link is in href attribute
      if (!link) {
        const linkEl = item.querySelector("link");
        link = linkEl?.getAttribute("href") || "";
      }

      // Clean up description (remove HTML tags for preview)
      description = description.replace(/<[^>]*>/g, "").substring(0, 500);

      if (title && link) {
        items.push({ title, link, description, pubDate });
      }
    }

    console.log(`[sync] Parsed ${items.length} items from feed`);
  } catch (error) {
    console.error("[sync] Error parsing RSS:", error);
  }

  return items;
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

serve(async (req) => {
  // Log every request at the very start
  console.log("[sync] ====== SYNC FUNCTION INVOKED ======");
  console.log("[sync] Method:", req.method);
  console.log("[sync] Time:", new Date().toISOString());

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get auth token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("[sync] ERROR: No authorization token provided");
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

    // Create client with service role for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.log("[sync] ERROR: Invalid or expired token");
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "INVALID_TOKEN", message: "Invalid or expired token" },
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[sync] User authenticated:", user.id);

    // Parse request body
    let body: { source_id?: string; sourceUrl?: string };
    try {
      body = await req.json();
      console.log("[sync] Request body:", JSON.stringify(body));
    } catch {
      console.log("[sync] ERROR: Invalid JSON in request body");
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "INVALID_JSON", message: "Invalid JSON in request body" },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { source_id, sourceUrl } = body;

    // Validate: need either source_id or sourceUrl
    if (!source_id && !sourceUrl) {
      console.log("[sync] ERROR: Missing source_id or sourceUrl");
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "MISSING_PARAMS", message: "Either source_id or sourceUrl is required" },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Fetch or create publisher for this user (needed for both paths)
    let { data: publisher, error: publisherError } = await supabase
      .from("publishers")
      .select("id")
      .eq("user_id", user.id)
      .single();

    // Auto-create publisher if one doesn't exist
    if (publisherError || !publisher) {
      console.log("[sync] Publisher not found, auto-creating one for user:", user.id);

      const { data: newPublisher, error: createPublisherError } = await supabase
        .from("publishers")
        .insert({
          user_id: user.id,
          name: user.email?.split("@")[0] || "Publisher",
        })
        .select("id")
        .single();

      if (createPublisherError || !newPublisher) {
        console.error("[sync] ERROR: Failed to create publisher:", createPublisherError?.message);
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: "PUBLISHER_CREATE_FAILED", message: "Failed to create publisher profile. Please try again." },
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      publisher = newPublisher;
      console.log("[sync] Auto-created publisher:", publisher.id);
    }

    const publisherData = publisher as Publisher;
    console.log("[sync] Publisher ID:", publisherData.id);

    // 2. Determine the feed URL to fetch
    let feedUrl: string;
    let contentSource: ContentSource | null = null;

    if (source_id) {
      // Fetch from existing content_source record
      console.log("[sync] Looking up source_id:", source_id);

      const { data: source, error: sourceError } = await supabase
        .from("content_sources")
        .select("id, user_id, source_type, url, name")
        .eq("id", source_id)
        .eq("user_id", user.id)
        .single();

      if (sourceError || !source) {
        console.error("[sync] ERROR: Source not found:", sourceError?.message);
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: "SOURCE_NOT_FOUND", message: "Content source not found or access denied" },
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      contentSource = source as ContentSource;
      feedUrl = contentSource.url;
    } else {
      // Use sourceUrl directly (ad-hoc sync)
      feedUrl = sourceUrl!;

      // Optionally create/find content_source record
      console.log("[sync] Using direct sourceUrl:", feedUrl);

      // Check if this URL already exists as a content source
      const { data: existingSource } = await supabase
        .from("content_sources")
        .select("id, user_id, source_type, url, name")
        .eq("user_id", user.id)
        .eq("url", feedUrl)
        .single();

      if (existingSource) {
        contentSource = existingSource as ContentSource;
        console.log("[sync] Found existing content_source:", contentSource.id);
      } else {
        // Create a new content_source record
        console.log("[sync] Creating new content_source for URL:", feedUrl);

        const { data: newSource, error: createError } = await supabase
          .from("content_sources")
          .insert({
            user_id: user.id,
            source_type: "rss",
            url: feedUrl,
            name: new URL(feedUrl).hostname,
          })
          .select()
          .single();

        if (createError) {
          console.error("[sync] ERROR: Failed to create content_source:", createError.message);
          // Continue without content_source - we can still import
        } else {
          contentSource = newSource as ContentSource;
          console.log("[sync] Created content_source:", contentSource.id);
        }
      }
    }

    // ===== FETCH THE FEED =====
    console.log("Fetching URL:", feedUrl);

    // 3. Fetch publisher settings (or use defaults)
    const { data: settings } = await supabase
      .from("publisher_settings")
      .select("default_human_price, default_ai_price, auto_mint_enabled")
      .eq("user_id", user.id)
      .single();

    const publisherSettings: PublisherSettings = settings || {
      default_human_price: 0,
      default_ai_price: 0,
      auto_mint_enabled: false,
    };

    console.log("[sync] Publisher settings:", JSON.stringify(publisherSettings));

    // 4. Fetch the RSS feed with appropriate User-Agent
    let feedXml: string;
    try {
      const userAgent = needsBrowserUserAgent(feedUrl) ? BROWSER_USER_AGENT : "Opedd RSS Sync/1.0";
      console.log("[sync] Using User-Agent:", userAgent.substring(0, 50) + "...");

      const feedResponse = await fetch(feedUrl, {
        headers: {
          "User-Agent": userAgent,
          "Accept": "application/rss+xml, application/xml, text/xml, application/atom+xml, */*",
        },
      });

      console.log("[sync] Feed response status:", feedResponse.status);

      if (!feedResponse.ok) {
        const errorText = await feedResponse.text().catch(() => "");
        console.error("[sync] ERROR: Feed fetch failed:", feedResponse.status, errorText.substring(0, 200));
        return new Response(
          JSON.stringify({
            success: false,
            error: {
              code: "FETCH_ERROR",
              message: `Failed to fetch feed: HTTP ${feedResponse.status} ${feedResponse.statusText}`,
              url: feedUrl,
            },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      feedXml = await feedResponse.text();
      console.log("[sync] Fetched feed, length:", feedXml.length, "bytes");
      console.log("[sync] Feed preview:", feedXml.substring(0, 200));
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : "Unknown fetch error";
      console.error("[sync] ERROR: Exception fetching feed:", errorMessage);
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "FETCH_ERROR",
            message: `Failed to fetch feed: ${errorMessage}`,
            url: feedUrl,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Parse the feed
    const feedItems = parseRSSFeed(feedXml);
    console.log("[sync] Items parsed from feed:", feedItems.length);

    if (feedItems.length === 0) {
      console.log("[sync] WARNING: No items found in feed");
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            source_id: contentSource?.id || null,
            source_url: feedUrl,
            items_found: 0,
            items_imported: 0,
            items_skipped: 0,
            message: "No items found in feed. The feed may be empty or in an unsupported format.",
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Generate content_hash for each item
    for (const item of feedItems) {
      item.contentHash = await generateContentHash(item.link);
    }
    console.log("[sync] Generated content hashes for", feedItems.length, "items");

    // 7. Get existing items by content_hash to check for duplicates/updates
    const contentHashes = feedItems.map((item) => item.contentHash!);
    const { data: existingLicenses } = await supabase
      .from("licenses")
      .select("id, content_hash, source_url")
      .in("content_hash", contentHashes);

    const existingByHash = new Map(
      (existingLicenses || []).map((l) => [l.content_hash, l])
    );
    console.log("[sync] Existing items in DB by content_hash:", existingByHash.size);

    // 8. Upsert licenses with "Invisible Registration" flow
    // - All successfully synced articles are marked as 'verified' (protected)
    // - Bypass blockchain for now, just populate metadata
    // - Every article must be linked via source_id
    // - Return full article data for frontend display
    let importedCount = 0;
    let updatedCount = 0;
    const errors: string[] = [];
    const syncedArticles: Array<{
      id: string;
      title: string;
      source_url: string;
      content_hash: string;
      source_id: string | null;
      verification_status: string;
      published_at: string | null;
      created_at: string;
    }> = [];

    for (const item of feedItems) {
      try {
        const existing = existingByHash.get(item.contentHash!);
        const now = new Date().toISOString();
        const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : null;

        // Common fields for both insert and update
        const articleData = {
          title: item.title.substring(0, 200),
          description: item.description,
          source_url: item.link,
          source_id: contentSource?.id || null, // MUST be linked to parent source
          content_hash: item.contentHash,
          verification_status: "verified", // Auto-protected via Invisible Registration
          human_price: publisherSettings.default_human_price,
          ai_price: publisherSettings.default_ai_price,
          published_at: publishedAt,
          metadata: {
            pub_date: item.pubDate,
            source_name: contentSource?.name || new URL(feedUrl).hostname,
            auto_imported: true,
            synced_at: now,
            registration_type: "invisible", // Mark as invisibly registered
          },
        };

        if (existing) {
          // Update existing record (frontend may have mirrored it)
          const { data: updatedRecord, error: updateError } = await supabase
            .from("licenses")
            .update(articleData)
            .eq("id", existing.id)
            .select("id, title, source_url, content_hash, source_id, verification_status, published_at, created_at")
            .single();

          if (updateError) {
            console.error("[sync] Update error for", item.link, ":", updateError.message);
            errors.push(`${item.title}: ${updateError.message}`);
          } else {
            updatedCount++;
            if (updatedRecord) {
              syncedArticles.push(updatedRecord);
            }
            console.log("[sync] Updated & protected:", item.title);
          }
        } else {
          // Insert new record with full metadata
          const { data: insertedRecord, error: insertError } = await supabase
            .from("licenses")
            .insert({
              publisher_id: publisherData.id,
              license_type: "standard",
              ...articleData,
            })
            .select("id, title, source_url, content_hash, source_id, verification_status, published_at, created_at")
            .single();

          if (insertError) {
            // Skip duplicates silently (unique constraint on source_url)
            if (!insertError.message.includes("duplicate")) {
              console.error("[sync] Insert error for", item.link, ":", insertError.message);
              errors.push(`${item.title}: ${insertError.message}`);
            } else {
              console.log("[sync] Skipped duplicate:", item.title);
            }
          } else {
            importedCount++;
            if (insertedRecord) {
              syncedArticles.push(insertedRecord);
            }
            console.log("[sync] Imported & protected:", item.title);
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unexpected error";
        console.error("[sync] Unexpected error importing item:", errMsg);
        errors.push(`${item.title}: ${errMsg}`);
      }
    }

    // 9. Update last_sync_at and sync_status for content_source
    if (contentSource?.id) {
      await supabase
        .from("content_sources")
        .update({
          last_sync_at: new Date().toISOString(),
          sync_status: "synced",
          article_count: syncedArticles.length,
        })
        .eq("id", contentSource.id);
      console.log("[sync] Updated content_source:", contentSource.id, "with", syncedArticles.length, "articles");
    }

    console.log("[sync] ====== SYNC COMPLETE ======");
    console.log("[sync] Summary - Found:", feedItems.length, "| Imported:", importedCount, "| Updated:", updatedCount, "| Errors:", errors.length);

    // Return full array of synced articles for immediate frontend display
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          source_id: contentSource?.id || null,
          source_url: feedUrl,
          source_name: contentSource?.name || new URL(feedUrl).hostname,
          items_found: feedItems.length,
          items_imported: importedCount,
          items_updated: updatedCount,
          items_failed: errors.length,
          // Full article array for frontend to display immediately without refresh
          articles: syncedArticles,
          errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[sync] ====== FATAL ERROR ======");
    console.error("[sync] Error:", errorMessage);
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "SERVER_ERROR", message: errorMessage },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
