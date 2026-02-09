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
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Shared utilities (same logic as sync-content-source) ────

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

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string | null;
  contentHash?: string;
}

function parseRSSFeed(xml: string): RSSItem[] {
  const items: RSSItem[] = [];

  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (!doc) {
      console.error("[batch-sync] Failed to parse XML document");
      return items;
    }

    // Try RSS 2.0 format first
    let itemElements = doc.querySelectorAll("item");

    // If no items, try Atom format
    if (itemElements.length === 0) {
      itemElements = doc.querySelectorAll("entry");
    }

    for (const item of itemElements) {
      let title = item.querySelector("title")?.textContent?.trim() || "";
      let link = item.querySelector("link")?.textContent?.trim() || "";
      const description = generateSnippet(
        item.querySelector("description")?.textContent?.trim() ||
        item.querySelector("content\\:encoded")?.textContent?.trim() ||
        item.querySelector("content")?.textContent?.trim() ||
        "");
      const pubDate =
        item.querySelector("pubDate")?.textContent?.trim() ||
        item.querySelector("published")?.textContent?.trim() ||
        item.querySelector("updated")?.textContent?.trim() ||
        null;

      // Atom format: link is in href attribute
      if (!link) {
        const linkEl = item.querySelector("link");
        link = linkEl?.getAttribute("href") || "";
      }

      if (title && link) {
        items.push({ title, link, description, pubDate });
      }
    }

    console.log(`[batch-sync] Parsed ${items.length} items from feed`);
  } catch (error) {
    console.error("[batch-sync] Error parsing RSS:", error);
  }

  return items;
}

function needsBrowserUserAgent(url: string): boolean {
  const browserAgentDomains = [
    "substack.com",
    "medium.com",
    "ghost.io",
    "opedd.com",
  ];
  return browserAgentDomains.some((domain) => url.includes(domain));
}

// ── New utility: URL canonicalization ───────────────────────

function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = ""; // strip ?utm_source=... etc.
    parsed.hash = "";   // strip #fragment
    let canonical = parsed.href;
    if (canonical.endsWith("/") && parsed.pathname !== "/") {
      canonical = canonical.slice(0, -1);
    }
    return canonical;
  } catch {
    return url.split("?")[0].split("#")[0].replace(/\/+$/, "");
  }
}

// ── Types ───────────────────────────────────────────────────

interface ContentSource {
  id: string;
  user_id: string;
  source_type: string;
  url: string;
  name: string | null;
}

interface SourceResult {
  source_id: string;
  source_name: string | null;
  status: "synced" | "error" | "skipped";
  new_articles: number;
  total_articles: number;
  error?: string;
}

// ── Main handler ────────────────────────────────────────────

serve(async (req) => {
  console.log("[batch-sync] ====== BATCH SYNC INVOKED ======");
  console.log("[batch-sync] Method:", req.method);
  console.log("[batch-sync] Time:", new Date().toISOString());

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth: service role key only ─────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "MISSING_TOKEN", message: "No authorization token provided" } }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (token !== supabaseServiceKey) {
      console.error("[batch-sync] Unauthorized: token does not match service role key");
      return new Response(
        JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "Only service role key is accepted" } }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── 1. Fetch all active, verified sources ───────────────
    const { data: sources, error: sourcesError } = await supabase
      .from("content_sources")
      .select("id, user_id, source_type, url, name")
      .eq("verification_status", "verified")
      .eq("is_active", true);

    if (sourcesError) {
      console.error("[batch-sync] Failed to fetch sources:", sourcesError.message);
      return new Response(
        JSON.stringify({ success: false, error: { code: "FETCH_SOURCES_ERROR", message: sourcesError.message } }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!sources || sources.length === 0) {
      console.log("[batch-sync] No active verified sources found");
      return new Response(
        JSON.stringify({ success: true, data: { sources_processed: 0, total_new_articles: 0, errors: 0, results: [] } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[batch-sync] Found ${sources.length} active verified sources`);

    // ── 2. Batch-fetch publishers and publisher_settings ─────
    const userIds = [...new Set(sources.map((s: ContentSource) => s.user_id))];

    const { data: publishers } = await supabase
      .from("publishers")
      .select("id, user_id")
      .in("user_id", userIds);

    const publisherMap = new Map<string, string>();
    for (const p of publishers || []) {
      publisherMap.set(p.user_id, p.id);
    }

    const { data: allSettings } = await supabase
      .from("publisher_settings")
      .select("user_id, default_human_price, default_ai_price")
      .in("user_id", userIds);

    const settingsMap = new Map<string, { default_human_price: number; default_ai_price: number }>();
    for (const s of allSettings || []) {
      settingsMap.set(s.user_id, {
        default_human_price: s.default_human_price,
        default_ai_price: s.default_ai_price,
      });
    }

    // ── 3. Process each source sequentially ─────────────────
    const results: SourceResult[] = [];
    const notifications: Array<{ user_id: string; type: string; title: string; message: string; metadata: Record<string, unknown> }> = [];
    let totalNewArticles = 0;
    let errorCount = 0;

    for (const source of sources as ContentSource[]) {
      const sourceResult: SourceResult = {
        source_id: source.id,
        source_name: source.name,
        status: "synced",
        new_articles: 0,
        total_articles: 0,
      };

      try {
        // Check publisher exists
        const publisherId = publisherMap.get(source.user_id);
        if (!publisherId) {
          console.error(`[batch-sync] No publisher for user ${source.user_id}, skipping source ${source.id}`);
          sourceResult.status = "error";
          sourceResult.error = "No publisher found for user";
          errorCount++;
          results.push(sourceResult);
          continue;
        }

        const settings = settingsMap.get(source.user_id) || {
          default_human_price: 0,
          default_ai_price: 0,
        };

        // Set sync_status = 'syncing'
        await supabase
          .from("content_sources")
          .update({ sync_status: "syncing" })
          .eq("id", source.id);

        // Fetch RSS feed
        const userAgent = needsBrowserUserAgent(source.url) ? BROWSER_USER_AGENT : "Opedd RSS Sync/1.0";
        const feedResponse = await fetch(source.url, {
          headers: {
            "User-Agent": userAgent,
            Accept: "application/rss+xml, application/xml, text/xml, application/atom+xml, */*",
          },
        });

        if (!feedResponse.ok) {
          throw new Error(`Feed fetch failed: HTTP ${feedResponse.status}`);
        }

        const feedXml = await feedResponse.text();
        const feedItems = parseRSSFeed(feedXml);

        // Empty feed — not an error
        if (feedItems.length === 0) {
          console.log(`[batch-sync] Empty feed for source ${source.id}, skipping`);
          await supabase
            .from("content_sources")
            .update({ sync_status: "synced", last_sync_at: new Date().toISOString() })
            .eq("id", source.id);
          sourceResult.status = "synced";
          results.push(sourceResult);
          continue;
        }

        // Sort items newest-first by pubDate
        feedItems.sort((a, b) => {
          if (!a.pubDate && !b.pubDate) return 0;
          if (!a.pubDate) return 1;
          if (!b.pubDate) return -1;
          return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
        });

        // Canonicalize feed item URLs
        for (const item of feedItems) {
          item.link = canonicalizeUrl(item.link);
        }

        // Fetch existing source_urls for this source_id
        const { data: existingLicenses } = await supabase
          .from("licenses")
          .select("source_url")
          .eq("source_id", source.id);

        const existingUrls = new Set(
          (existingLicenses || []).map((l: { source_url: string }) => canonicalizeUrl(l.source_url)),
        );

        // Delta logic: iterate newest-first; break at first known URL
        const newItems: RSSItem[] = [];
        for (const item of feedItems) {
          if (existingUrls.has(item.link)) {
            break;
          }
          newItems.push(item);
        }

        console.log(`[batch-sync] Source ${source.id}: ${feedItems.length} feed items, ${existingUrls.size} existing, ${newItems.length} new`);

        // Insert only new items
        if (newItems.length > 0) {
          for (const item of newItems) {
            const contentHash = await generateContentHash(item.link);
            const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : null;
            const now = new Date().toISOString();

            const { error: insertError } = await supabase
              .from("licenses")
              .insert({
                publisher_id: publisherId,
                title: item.title.substring(0, 200),
                description: item.description,
                source_url: item.link,
                source_id: source.id,
                content_hash: contentHash,
                verification_status: "verified",
                license_type: "standard",
                human_price: settings.default_human_price,
                ai_price: settings.default_ai_price,
                published_at: publishedAt,
                metadata: {
                  source_name: source.name || new URL(source.url).hostname,
                  auto_imported: true,
                  synced_at: now,
                  registration_type: "invisible",
                },
              });

            if (insertError) {
              // Skip duplicates silently (unique constraint)
              if (!insertError.message.includes("duplicate")) {
                console.error(`[batch-sync] Insert error for ${item.link}:`, insertError.message);
              }
            } else {
              sourceResult.new_articles++;
            }
          }
        }

        // ── Source Archived detection ──────────────────────────
        // Compare feed contents against DB articles within the feed's
        // date range. Articles missing from the feed are candidates;
        // confirm with a HEAD request before marking source_archived.
        try {
          const feedUrls = new Set(feedItems.map((item) => item.link));

          // Find the oldest pubDate in the feed — the "feed horizon"
          const feedDates = feedItems
            .filter((item) => item.pubDate)
            .map((item) => new Date(item.pubDate!).getTime());

          if (feedDates.length > 0) {
            const feedHorizon = new Date(Math.min(...feedDates)).toISOString();

            // Query active articles for this source published within feed range
            const { data: candidateArticles } = await supabase
              .from("licenses")
              .select("id, source_url")
              .eq("source_id", source.id)
              .eq("source_status", "active")
              .gte("published_at", feedHorizon);

            const missingArticles = (candidateArticles || []).filter(
              (a: { id: string; source_url: string }) => !feedUrls.has(canonicalizeUrl(a.source_url)),
            );

            // HEAD-check up to 5 candidates per source per cycle
            const toCheck = missingArticles.slice(0, 5);
            for (const article of toCheck) {
              try {
                const headResp = await fetch(article.source_url, {
                  method: "HEAD",
                  headers: { "User-Agent": "Opedd Archive Check/1.0" },
                  redirect: "follow",
                });

                if (headResp.status === 404 || headResp.status === 410) {
                  await supabase
                    .from("licenses")
                    .update({ source_status: "source_archived" })
                    .eq("id", article.id);

                  console.log(`[batch-sync] Marked source_archived: ${article.source_url}`);
                }
              } catch {
                // Network error — skip, don't mark
              }
            }
          }
        } catch (archiveErr) {
          // Archive detection is best-effort; don't fail the sync
          console.error(`[batch-sync] Archive detection error for source ${source.id}:`, archiveErr);
        }

        // Count total articles for this source
        const { count } = await supabase
          .from("licenses")
          .select("id", { count: "exact", head: true })
          .eq("source_id", source.id);

        sourceResult.total_articles = count || 0;

        // Update content_source
        await supabase
          .from("content_sources")
          .update({
            sync_status: "synced",
            last_sync_at: new Date().toISOString(),
            article_count: sourceResult.total_articles,
          })
          .eq("id", source.id);

        totalNewArticles += sourceResult.new_articles;

        // Queue notification if new articles were found
        if (sourceResult.new_articles > 0) {
          const articleWord = sourceResult.new_articles === 1 ? "article" : "articles";
          notifications.push({
            user_id: source.user_id,
            type: "new_articles_synced",
            title: "New articles synced",
            message: `${sourceResult.new_articles} new ${articleWord} synced from ${source.name || "your source"}`,
            metadata: {
              source_id: source.id,
              source_name: source.name,
              new_article_count: sourceResult.new_articles,
              synced_at: new Date().toISOString(),
            },
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[batch-sync] Error processing source ${source.id}:`, errMsg);
        sourceResult.status = "error";
        sourceResult.error = errMsg;
        errorCount++;

        // Set sync_status to error
        await supabase
          .from("content_sources")
          .update({ sync_status: "error" })
          .eq("id", source.id);
      }

      results.push(sourceResult);
    }

    // ── 4. Batch insert notifications ───────────────────────
    if (notifications.length > 0) {
      const { error: notifError } = await supabase
        .from("notifications")
        .insert(notifications);

      if (notifError) {
        console.error("[batch-sync] Failed to insert notifications:", notifError.message);
      } else {
        console.log(`[batch-sync] Inserted ${notifications.length} notifications`);
      }
    }

    // ── 5. Return summary ───────────────────────────────────
    const summary = {
      sources_processed: sources.length,
      total_new_articles: totalNewArticles,
      errors: errorCount,
      results,
    };

    console.log("[batch-sync] ====== BATCH SYNC COMPLETE ======");
    console.log(`[batch-sync] Processed: ${summary.sources_processed}, New articles: ${summary.total_new_articles}, Errors: ${summary.errors}`);

    return new Response(
      JSON.stringify({ success: true, data: summary }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[batch-sync] ====== FATAL ERROR ======");
    console.error("[batch-sync] Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: { code: "SERVER_ERROR", message: errorMessage } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
