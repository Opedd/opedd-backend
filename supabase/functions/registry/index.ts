import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, errorResponse, successResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/auth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const url = new URL(req.url);
    const publisherId = url.searchParams.get("publisher_id");
    const articleId = url.searchParams.get("article_id");
    const licenseKey = url.searchParams.get("license_key");
    const limit = Math.min(Number(url.searchParams.get("limit")) || 25, 100);
    const offset = Number(url.searchParams.get("offset")) || 0;

    const supabase = createServiceClient();

    // Mode 1: Verify a specific license key (detailed view)
    if (licenseKey) {
      return await getByLicenseKey(supabase, licenseKey);
    }

    // Mode 2: Registry for a specific article
    if (articleId) {
      return await getByArticle(supabase, articleId, limit, offset);
    }

    // Mode 3: Registry for a publisher
    if (publisherId) {
      return await getByPublisher(supabase, publisherId, limit, offset);
    }

    // Mode 4: Global recent activity (public feed)
    return await getGlobalFeed(supabase, limit, offset);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[registry] Error:", msg);
    return errorResponse("Internal server error", 500);
  }
});

// Fetch a single license record by key (public verification)
async function getByLicenseKey(supabase: any, key: string) {
  if (!key.startsWith("OP-")) {
    return errorResponse("Invalid license key format (expected OP-XXXX-XXXX)");
  }

  const { data: tx, error } = await supabase
    .from("license_transactions")
    .select("license_key, license_type, status, amount, created_at, article_id, buyer_name, buyer_organization, intended_use")
    .eq("license_key", key)
    .eq("status", "completed")
    .single();

  if (error || !tx) {
    return errorResponse("License not found", 404);
  }

  // Fetch article + publisher
  const { data: article } = await supabase
    .from("licenses")
    .select("title, source_url, publisher_id")
    .eq("id", tx.article_id)
    .single();

  let publisherName = "Unknown";
  if (article?.publisher_id) {
    const { data: pub } = await supabase
      .from("publishers")
      .select("name")
      .eq("id", article.publisher_id)
      .single();
    if (pub) publisherName = pub.name;
  }

  // Count verifications from license_events
  const { count: verifyCount } = await supabase
    .from("license_events")
    .select("id", { count: "exact", head: true })
    .eq("license_key", key)
    .eq("event_type", "license.verified");

  // Get event history for this license
  const { data: events } = await supabase
    .from("license_events")
    .select("event_type, actor_type, created_at")
    .eq("license_key", key)
    .order("created_at", { ascending: true })
    .limit(20);

  return successResponse({
    license: {
      key: tx.license_key,
      type: tx.license_type,
      type_label: tx.license_type === "human" ? "Human Republication" : "AI Training",
      status: tx.status,
      amount: tx.amount,
      currency: "usd",
      issued_at: tx.created_at,
      licensee: {
        name: tx.buyer_name || null,
        organization: tx.buyer_organization || null,
      },
      intended_use: tx.intended_use,
    },
    content: {
      title: article?.title || "Unknown",
      source_url: article?.source_url || null,
      publisher: publisherName,
    },
    proof: {
      verification_count: verifyCount || 0,
      event_trail: (events || []).map((e: any) => ({
        event: e.event_type,
        actor: e.actor_type,
        timestamp: e.created_at,
      })),
    },
  });
}

// Registry for a specific article — all public licenses issued for it
async function getByArticle(supabase: any, articleId: string, limit: number, offset: number) {
  const { data: article, error: artError } = await supabase
    .from("licenses")
    .select("id, title, source_url, publisher_id, human_price, ai_price, human_licenses_sold, ai_licenses_sold, total_revenue")
    .eq("id", articleId)
    .single();

  if (artError || !article) {
    return errorResponse("Article not found", 404);
  }

  let publisherName = "Unknown";
  if (article.publisher_id) {
    const { data: pub } = await supabase
      .from("publishers")
      .select("name")
      .eq("id", article.publisher_id)
      .single();
    if (pub) publisherName = pub.name;
  }

  // Fetch completed transactions (public-safe fields only)
  const { data: txs, count } = await supabase
    .from("license_transactions")
    .select("license_key, license_type, amount, created_at, buyer_name, buyer_organization", { count: "exact" })
    .eq("article_id", articleId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  return successResponse({
    article: {
      id: article.id,
      title: article.title,
      source_url: article.source_url,
      publisher: publisherName,
      human_price: article.human_price,
      ai_price: article.ai_price,
    },
    stats: {
      human_licenses: article.human_licenses_sold || 0,
      ai_licenses: article.ai_licenses_sold || 0,
      total_licenses: (article.human_licenses_sold || 0) + (article.ai_licenses_sold || 0),
      total_revenue: article.total_revenue || 0,
    },
    licenses: (txs || []).map((tx: any) => ({
      key: tx.license_key,
      type: tx.license_type,
      amount: tx.amount,
      licensee: tx.buyer_name || tx.buyer_organization || "Anonymous",
      issued_at: tx.created_at,
    })),
    total: count || 0,
    limit,
    offset,
  });
}

// Registry for a publisher — summary and recent licenses
async function getByPublisher(supabase: any, publisherId: string, limit: number, offset: number) {
  const { data: publisher, error: pubError } = await supabase
    .from("publishers")
    .select("id, name, website_url, description")
    .eq("id", publisherId)
    .single();

  if (pubError || !publisher) {
    return errorResponse("Publisher not found", 404);
  }

  // Get all publisher articles
  const { data: articles } = await supabase
    .from("licenses")
    .select("id, title, source_url, human_licenses_sold, ai_licenses_sold, total_revenue, licensing_enabled")
    .eq("publisher_id", publisherId);

  const allArticles = articles || [];
  const articleIds = allArticles.map((a: any) => a.id);

  // Aggregate stats
  const totalHuman = allArticles.reduce((s: number, a: any) => s + (a.human_licenses_sold || 0), 0);
  const totalAi = allArticles.reduce((s: number, a: any) => s + (a.ai_licenses_sold || 0), 0);
  const totalRevenue = allArticles.reduce((s: number, a: any) => s + Number(a.total_revenue || 0), 0);
  const licensedArticles = allArticles.filter((a: any) => a.licensing_enabled).length;

  // Recent licenses across all publisher articles
  let recentLicenses: any[] = [];
  let totalLicenseCount = 0;
  if (articleIds.length > 0) {
    const { data: txs, count } = await supabase
      .from("license_transactions")
      .select("license_key, license_type, amount, created_at, buyer_name, buyer_organization, article_id", { count: "exact" })
      .in("article_id", articleIds)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    recentLicenses = txs || [];
    totalLicenseCount = count || 0;
  }

  // Build article title map for enrichment
  const articleMap = new Map(allArticles.map((a: any) => [a.id, a.title]));

  return successResponse({
    publisher: {
      name: publisher.name,
      website_url: publisher.website_url,
      description: publisher.description,
    },
    stats: {
      total_articles: allArticles.length,
      licensed_articles: licensedArticles,
      human_licenses: totalHuman,
      ai_licenses: totalAi,
      total_licenses: totalHuman + totalAi,
      total_revenue: totalRevenue,
    },
    articles: allArticles
      .filter((a: any) => a.licensing_enabled)
      .slice(0, 20)
      .map((a: any) => ({
        id: a.id,
        title: a.title,
        source_url: a.source_url,
        human_licenses: a.human_licenses_sold || 0,
        ai_licenses: a.ai_licenses_sold || 0,
      })),
    recent_licenses: recentLicenses.map((tx: any) => ({
      key: tx.license_key,
      type: tx.license_type,
      amount: tx.amount,
      article_title: articleMap.get(tx.article_id) || "Unknown",
      licensee: tx.buyer_name || tx.buyer_organization || "Anonymous",
      issued_at: tx.created_at,
    })),
    total: totalLicenseCount,
    limit,
    offset,
  });
}

// Global public feed — recent licensing activity across all publishers
async function getGlobalFeed(supabase: any, limit: number, offset: number) {
  // Recent events from the ledger (public-safe events only)
  const { data: events, count } = await supabase
    .from("license_events")
    .select("event_type, license_key, article_id, publisher_id, created_at, metadata", { count: "exact" })
    .in("event_type", ["license.issued", "license.paid", "license.verified"])
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (!events || events.length === 0) {
    return successResponse({
      feed: [],
      total: 0,
      limit,
      offset,
      global_stats: { total_licenses: 0, total_publishers: 0, total_articles: 0 },
    });
  }

  // Batch-fetch article titles and publisher names
  const articleIds = [...new Set(events.map((e: any) => e.article_id).filter(Boolean))];
  const publisherIds = [...new Set(events.map((e: any) => e.publisher_id).filter(Boolean))];

  const articleMap = new Map<string, string>();
  const publisherMap = new Map<string, string>();

  if (articleIds.length > 0) {
    const { data: articles } = await supabase
      .from("licenses")
      .select("id, title")
      .in("id", articleIds);
    for (const a of articles || []) articleMap.set(a.id, a.title);
  }

  if (publisherIds.length > 0) {
    const { data: pubs } = await supabase
      .from("publishers")
      .select("id, name")
      .in("id", publisherIds);
    for (const p of pubs || []) publisherMap.set(p.id, p.name);
  }

  // Global stats
  const { count: totalLicenses } = await supabase
    .from("license_transactions")
    .select("id", { count: "exact", head: true })
    .eq("status", "completed");

  const { count: totalPublishers } = await supabase
    .from("publishers")
    .select("id", { count: "exact", head: true });

  const { count: totalArticles } = await supabase
    .from("licenses")
    .select("id", { count: "exact", head: true })
    .eq("licensing_enabled", true);

  const eventLabels: Record<string, string> = {
    "license.issued": "License Issued",
    "license.paid": "License Purchased",
    "license.verified": "License Verified",
  };

  return successResponse({
    feed: events.map((e: any) => ({
      event: e.event_type,
      event_label: eventLabels[e.event_type] || e.event_type,
      license_key: e.license_key,
      article_title: articleMap.get(e.article_id) || null,
      publisher_name: publisherMap.get(e.publisher_id) || null,
      timestamp: e.created_at,
      license_type: e.metadata?.license_type || null,
    })),
    total: count || 0,
    limit,
    offset,
    global_stats: {
      total_licenses: totalLicenses || 0,
      total_publishers: totalPublishers || 0,
      total_articles: totalArticles || 0,
    },
  });
}
