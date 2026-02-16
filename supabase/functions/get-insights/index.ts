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

    // Get all publisher's articles
    const { data: articles } = await supabase
      .from("licenses")
      .select("id, title, human_licenses_sold, ai_licenses_sold, human_price, ai_price, source_url, verification_status, created_at")
      .eq("publisher_id", publisher.id);

    if (!articles || articles.length === 0) {
      return successResponse({
        overview: { totalRevenue: 0, totalLicenses: 0, humanLicenses: 0, aiLicenses: 0, totalArticles: 0, licensedArticles: 0 },
        revenueByDay: [],
        topArticles: [],
        recentActivity: [],
      });
    }

    const articleIds = articles.map((a: any) => a.id);
    const articleMap = new Map(articles.map((a: any) => [a.id, a]));

    // Get all completed transactions
    const { data: transactions } = await supabase
      .from("license_transactions")
      .select("id, article_id, amount, license_type, created_at, buyer_email, buyer_name, status")
      .in("article_id", articleIds)
      .eq("status", "completed")
      .order("created_at", { ascending: false });

    const txs = transactions || [];

    // Overview metrics
    const totalRevenue = txs.reduce((sum: number, t: any) => sum + Number(t.amount), 0);
    const humanTxs = txs.filter((t: any) => t.license_type === "human");
    const aiTxs = txs.filter((t: any) => t.license_type === "ai");
    const articlesWithSales = new Set(txs.map((t: any) => t.article_id));

    const overview = {
      totalRevenue,
      totalLicenses: txs.length,
      humanLicenses: humanTxs.length,
      aiLicenses: aiTxs.length,
      humanRevenue: humanTxs.reduce((sum: number, t: any) => sum + Number(t.amount), 0),
      aiRevenue: aiTxs.reduce((sum: number, t: any) => sum + Number(t.amount), 0),
      totalArticles: articles.length,
      licensedArticles: articlesWithSales.size,
      verifiedArticles: articles.filter((a: any) => a.verification_status === "verified").length,
    };

    // Revenue by day (last 30 days)
    const revenueByDay: Record<string, { revenue: number; human: number; ai: number; count: number }> = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      revenueByDay[key] = { revenue: 0, human: 0, ai: 0, count: 0 };
    }

    for (const tx of txs) {
      const day = tx.created_at.split("T")[0];
      if (revenueByDay[day]) {
        revenueByDay[day].revenue += Number(tx.amount);
        revenueByDay[day].count += 1;
        if (tx.license_type === "human") revenueByDay[day].human += Number(tx.amount);
        else revenueByDay[day].ai += Number(tx.amount);
      }
    }

    const revenueByDayArray = Object.entries(revenueByDay)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Top articles by revenue
    const articleRevenue = new Map<string, number>();
    const articleLicenseCount = new Map<string, number>();
    for (const tx of txs) {
      articleRevenue.set(tx.article_id, (articleRevenue.get(tx.article_id) || 0) + Number(tx.amount));
      articleLicenseCount.set(tx.article_id, (articleLicenseCount.get(tx.article_id) || 0) + 1);
    }

    const topArticles = Array.from(articleRevenue.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, revenue]) => {
        const article = articleMap.get(id);
        return {
          id,
          title: article?.title || "Unknown",
          revenue,
          licenses_sold: articleLicenseCount.get(id) || 0,
          source_url: article?.source_url || null,
        };
      });

    // Recent activity (last 10 transactions, enriched)
    const recentActivity = txs.slice(0, 10).map((tx: any) => {
      const article = articleMap.get(tx.article_id);
      return {
        id: tx.id,
        type: tx.license_type === "ai" ? "license_ai" : "license_human",
        title: tx.license_type === "ai"
          ? `AI License — ${article?.title || "Unknown"}`
          : `Human License — ${article?.title || "Unknown"}`,
        description: tx.buyer_name
          ? `Licensed by ${tx.buyer_name}`
          : `Licensed by ${tx.buyer_email}`,
        amount: Number(tx.amount),
        created_at: tx.created_at,
        asset_title: article?.title || "Unknown",
      };
    });

    return successResponse({
      overview,
      revenueByDay: revenueByDayArray,
      topArticles,
      recentActivity,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[get-insights] Error:", msg);
    return errorResponse("Internal server error", 500);
  }
});
