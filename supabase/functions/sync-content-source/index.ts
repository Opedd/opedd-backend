import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string | null;
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get auth token
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

    // Create client with service role for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
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

    const { source_id } = body;

    if (!source_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "MISSING_SOURCE_ID", message: "source_id is required" },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[sync] Syncing source:", source_id);

    // 1. Fetch content source
    const { data: source, error: sourceError } = await supabase
      .from("content_sources")
      .select("id, user_id, source_type, url, name")
      .eq("id", source_id)
      .eq("user_id", user.id)
      .single();

    if (sourceError || !source) {
      console.error("[sync] Source not found:", sourceError?.message);
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "SOURCE_NOT_FOUND", message: "Content source not found or access denied" },
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contentSource = source as ContentSource;
    console.log("[sync] Found source:", contentSource.url);

    // 2. Fetch publisher for this user
    const { data: publisher, error: publisherError } = await supabase
      .from("publishers")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (publisherError || !publisher) {
      console.error("[sync] Publisher not found:", publisherError?.message);
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "NO_PUBLISHER", message: "Publisher profile not found" },
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const publisherData = publisher as Publisher;
    console.log("[sync] Publisher ID:", publisherData.id);

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

    console.log("[sync] Publisher settings:", publisherSettings);

    // 4. Fetch the RSS feed
    let feedXml: string;
    try {
      const feedResponse = await fetch(contentSource.url, {
        headers: {
          "User-Agent": "Opedd RSS Sync/1.0",
          "Accept": "application/rss+xml, application/xml, text/xml, application/atom+xml",
        },
      });

      if (!feedResponse.ok) {
        throw new Error(`HTTP ${feedResponse.status}: ${feedResponse.statusText}`);
      }

      feedXml = await feedResponse.text();
      console.log("[sync] Fetched feed, length:", feedXml.length);
    } catch (fetchError) {
      console.error("[sync] Failed to fetch feed:", fetchError);
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "FETCH_ERROR", message: `Failed to fetch feed: ${fetchError.message}` },
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Parse the feed
    const feedItems = parseRSSFeed(feedXml);

    if (feedItems.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            source_id: contentSource.id,
            items_found: 0,
            items_imported: 0,
            items_skipped: 0,
            message: "No items found in feed",
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Get existing source_urls to check for duplicates
    const sourceUrls = feedItems.map((item) => item.link);
    const { data: existingLicenses } = await supabase
      .from("licenses")
      .select("source_url")
      .in("source_url", sourceUrls);

    const existingUrls = new Set((existingLicenses || []).map((l) => l.source_url));
    console.log("[sync] Existing URLs in DB:", existingUrls.size);

    // 7. Filter out duplicates and prepare new items
    const newItems = feedItems.filter((item) => !existingUrls.has(item.link));
    console.log("[sync] New items to import:", newItems.length);

    // 8. Insert new licenses
    let importedCount = 0;
    const errors: string[] = [];

    for (const item of newItems) {
      try {
        const { error: insertError } = await supabase.from("licenses").insert({
          publisher_id: publisherData.id,
          title: item.title.substring(0, 200),
          description: item.description,
          license_type: "standard",
          source_url: item.link,
          source_id: contentSource.id,
          metadata: {
            human_price: publisherSettings.default_human_price,
            ai_price: publisherSettings.default_ai_price,
            pub_date: item.pubDate,
            source_name: contentSource.name || contentSource.url,
            auto_imported: true,
          },
        });

        if (insertError) {
          // Skip duplicates silently (unique constraint)
          if (!insertError.message.includes("duplicate")) {
            console.error("[sync] Insert error for", item.link, ":", insertError.message);
            errors.push(`${item.title}: ${insertError.message}`);
          }
        } else {
          importedCount++;
          console.log("[sync] Imported:", item.title);
        }
      } catch (err) {
        console.error("[sync] Unexpected error:", err);
        errors.push(`${item.title}: Unexpected error`);
      }
    }

    // 9. Update last_sync_at
    await supabase
      .from("content_sources")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", contentSource.id);

    console.log("[sync] Sync complete. Imported:", importedCount);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          source_id: contentSource.id,
          source_url: contentSource.url,
          items_found: feedItems.length,
          items_imported: importedCount,
          items_skipped: feedItems.length - newItems.length,
          items_failed: errors.length,
          errors: errors.length > 0 ? errors : undefined,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[sync] Unexpected error:", errorMessage);
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "SERVER_ERROR", message: errorMessage },
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
