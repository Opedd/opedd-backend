import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, errorResponse, successResponse } from "../_shared/cors.ts";
import { createServiceClient, authenticatePublisher } from "../_shared/auth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const { user, publisher, error: authError } = await authenticatePublisher(req);
    if (authError || !publisher) {
      return errorResponse(authError || "Unauthorized", authError === "Publisher profile not found" ? 404 : 401);
    }

    const supabase = createServiceClient();

    // Parse query params
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
    const offset = Number(url.searchParams.get("offset")) || 0;
    const statusFilter = url.searchParams.get("status");
    const typeFilter = url.searchParams.get("type");
    const searchQuery = url.searchParams.get("search");

    // Get publisher's article IDs
    const { data: articles } = await supabase
      .from("licenses")
      .select("id, title")
      .eq("publisher_id", publisher.id);

    if (!articles || articles.length === 0) {
      return successResponse({ transactions: [], total: 0, metrics: { totalRevenue: 0, activeLicenses: 0, topAsset: null } });
    }

    const articleIds = articles.map((a: any) => a.id);
    const articleMap = new Map(articles.map((a: any) => [a.id, a.title]));

    // Build query
    let query = supabase
      .from("license_transactions")
      .select("id, article_id, buyer_email, amount, license_type, license_key, status, created_at, buyer_name, buyer_organization, intended_use, stripe_session_id", { count: "exact" })
      .in("article_id", articleIds)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (statusFilter) query = query.eq("status", statusFilter);
    if (typeFilter) query = query.eq("license_type", typeFilter);
    if (searchQuery) {
      const term = `%${searchQuery}%`;
      query = query.or(`buyer_email.ilike.${term},buyer_name.ilike.${term},license_key.ilike.${term}`);
    }

    const { data: transactions, error: txError, count } = await query;

    if (txError) {
      console.error("[get-transactions] Query error:", txError.message);
      return errorResponse("Failed to fetch transactions", 500);
    }

    // Enrich with article titles
    const enriched = (transactions || []).map((tx: any) => ({
      id: tx.id,
      article_id: tx.article_id,
      asset_title: articleMap.get(tx.article_id) || "Unknown",
      buyer_email: tx.buyer_email,
      buyer_name: tx.buyer_name,
      buyer_organization: tx.buyer_organization,
      intended_use: tx.intended_use,
      amount: tx.amount,
      license_type: tx.license_type,
      license_key: tx.license_key,
      status: tx.status,
      created_at: tx.created_at,
      payment_method: tx.stripe_session_id ? "stripe" : "free",
    }));

    // Calculate metrics from ALL completed transactions (not just current page)
    const { data: allCompleted } = await supabase
      .from("license_transactions")
      .select("amount, article_id")
      .in("article_id", articleIds)
      .eq("status", "completed");

    const totalRevenue = (allCompleted || []).reduce((sum: number, t: any) => sum + Number(t.amount), 0);
    const activeLicenses = (allCompleted || []).length;

    // Find top asset
    const revenueByArticle = new Map<string, number>();
    for (const t of allCompleted || []) {
      revenueByArticle.set(t.article_id, (revenueByArticle.get(t.article_id) || 0) + Number(t.amount));
    }
    let topAsset: { id: string; title: string; revenue: number } | null = null;
    for (const [articleId, revenue] of revenueByArticle) {
      if (!topAsset || revenue > topAsset.revenue) {
        topAsset = { id: articleId, title: articleMap.get(articleId) || "Unknown", revenue };
      }
    }

    return successResponse({
      transactions: enriched,
      total: count || 0,
      metrics: { totalRevenue, activeLicenses, topAsset },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[get-transactions] Error:", msg);
    return errorResponse("Internal server error", 500);
  }
});
