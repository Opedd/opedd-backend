import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, errorResponse, successResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/auth.ts";
import { generateUniqueLicenseKey } from "../_shared/license-key.ts";
import { isRateLimited } from "../_shared/rate-limit.ts";
import { buildHandshakeEmail, sendEmail } from "../_shared/email.ts";
import { logEvent } from "../_shared/events.ts";
import { registerOnChain, verifyOnChain } from "../_shared/blockchain.ts";

// Authenticate via X-API-Key header and return the publisher
async function authenticateApiKey(req: Request) {
  const apiKey = req.headers.get("X-API-Key") || req.headers.get("x-api-key");

  if (!apiKey || !apiKey.startsWith("op_")) {
    return { publisher: null, error: "Missing or invalid API key. Use X-API-Key header with your op_ key." };
  }

  const supabase = createServiceClient();

  const { data: publisher, error: dbError } = await supabase
    .from("publishers")
    .select("id, name, website_url, default_human_price, default_ai_price")
    .eq("api_key", apiKey)
    .single();

  if (dbError || !publisher) {
    return { publisher: null, error: "Invalid API key" };
  }

  return { publisher, error: null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (!action) {
      return successResponse({
        name: "Opedd Programmatic API",
        version: "1.0",
        docs: "https://opedd.com/docs/api",
        actions: {
          articles: "GET ?action=articles — List licensable articles",
          article: "GET ?action=article&id=<uuid> — Get article details + pricing",
          purchase: "POST ?action=purchase — Purchase a single license",
          batch_purchase: "POST ?action=batch_purchase — Purchase licenses for multiple articles",
          verify: "GET ?action=verify&key=<OP-XXXX-XXXX> — Verify a license",
          usage: "GET ?action=usage — API key usage stats",
          docs: "GET ?action=docs — Full API documentation",
        },
        auth: "Include X-API-Key header with your op_ key",
      });
    }

    // Public actions (no auth)
    if (action === "verify") {
      return await handleVerify(req, url);
    }
    if (action === "docs") {
      return handleDocs();
    }

    // All other actions require API key auth
    const { publisher, error: authError } = await authenticateApiKey(req);
    if (authError || !publisher) {
      return errorResponse(authError || "Unauthorized", 401);
    }

    switch (action) {
      case "articles":
        return await handleListArticles(publisher, url);
      case "article":
        return await handleGetArticle(publisher, url);
      case "purchase":
        return await handlePurchase(publisher, req);
      case "batch_purchase":
        return await handleBatchPurchase(publisher, req);
      case "usage":
        return await handleUsage(publisher);
      default:
        return errorResponse(`Unknown action: ${action}. Valid actions: articles, article, purchase, batch_purchase, verify, usage, docs`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[api] Error:", msg);
    return errorResponse("Internal server error", 500);
  }
});

// GET ?action=articles — List all licensable articles for this publisher
async function handleListArticles(publisher: any, url: URL) {
  const supabase = createServiceClient();
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
  const offset = Number(url.searchParams.get("offset")) || 0;
  const type = url.searchParams.get("type"); // human, ai

  let query = supabase
    .from("licenses")
    .select("id, title, description, source_url, human_price, ai_price, licensing_enabled, human_licenses_sold, ai_licenses_sold, created_at", { count: "exact" })
    .eq("publisher_id", publisher.id)
    .eq("licensing_enabled", true)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  // Filter by price availability
  if (type === "human") {
    query = query.gt("human_price", 0);
  } else if (type === "ai") {
    query = query.gt("ai_price", 0);
  }

  const { data: articles, error, count } = await query;

  if (error) {
    console.error("[api] List articles error:", error.message);
    return errorResponse("Failed to fetch articles", 500);
  }

  return successResponse({
    articles: (articles || []).map((a: any) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      source_url: a.source_url,
      pricing: {
        human: a.human_price ? { price: Number(a.human_price), currency: "usd" } : null,
        ai: a.ai_price ? { price: Number(a.ai_price), currency: "usd" } : null,
      },
      stats: {
        human_licenses_sold: a.human_licenses_sold || 0,
        ai_licenses_sold: a.ai_licenses_sold || 0,
      },
      created_at: a.created_at,
    })),
    total: count || 0,
    limit,
    offset,
  });
}

// GET ?action=article&id=<uuid> — Get single article details
async function handleGetArticle(publisher: any, url: URL) {
  const articleId = url.searchParams.get("id");
  if (!articleId) {
    return errorResponse("id parameter is required");
  }

  const supabase = createServiceClient();

  const { data: article, error } = await supabase
    .from("licenses")
    .select("id, title, description, source_url, human_price, ai_price, licensing_enabled, human_licenses_sold, ai_licenses_sold, total_revenue, created_at")
    .eq("id", articleId)
    .eq("publisher_id", publisher.id)
    .single();

  if (error || !article) {
    return errorResponse("Article not found", 404);
  }

  // Get recent transactions for this article
  const { data: recentTxs } = await supabase
    .from("license_transactions")
    .select("license_key, license_type, amount, created_at, buyer_name, buyer_organization")
    .eq("article_id", articleId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(10);

  return successResponse({
    article: {
      id: article.id,
      title: article.title,
      description: article.description,
      source_url: article.source_url,
      licensing_enabled: article.licensing_enabled,
      pricing: {
        human: article.human_price ? { price: Number(article.human_price), currency: "usd" } : null,
        ai: article.ai_price ? { price: Number(article.ai_price), currency: "usd" } : null,
      },
      stats: {
        human_licenses_sold: article.human_licenses_sold || 0,
        ai_licenses_sold: article.ai_licenses_sold || 0,
        total_revenue: Number(article.total_revenue || 0),
      },
      created_at: article.created_at,
    },
    recent_licenses: (recentTxs || []).map((tx: any) => ({
      key: tx.license_key,
      type: tx.license_type,
      amount: tx.amount,
      licensee: tx.buyer_name || tx.buyer_organization || "Anonymous",
      issued_at: tx.created_at,
    })),
  });
}

// POST ?action=purchase — Purchase a license programmatically
async function handlePurchase(publisher: any, req: Request) {
  if (req.method !== "POST") {
    return errorResponse("Purchase requires POST method", 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON");
  }

  const { article_id, license_type, buyer_email, buyer_name, buyer_organization, intended_use } = body;

  // Validate required fields
  if (!article_id || typeof article_id !== "string") {
    return errorResponse("article_id is required");
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!buyer_email || typeof buyer_email !== "string" || !emailRegex.test(buyer_email)) {
    return errorResponse("Valid buyer_email is required");
  }
  if (!license_type || !["human", "ai"].includes(license_type)) {
    return errorResponse("license_type must be 'human' or 'ai'");
  }

  const validUses = ["personal", "editorial", "commercial", "ai_training", "corporate"];
  if (intended_use && !validUses.includes(intended_use)) {
    return errorResponse(`intended_use must be one of: ${validUses.join(", ")}`);
  }

  const supabase = createServiceClient();

  // Rate limit: 30 purchases per API key per hour
  if (await isRateLimited(supabase, `api-purchase:${publisher.id}`, 30, 3600)) {
    return errorResponse("Rate limit exceeded. Max 30 purchases per hour.", 429);
  }

  // Verify article belongs to this publisher
  const { data: article, error: artError } = await supabase
    .from("licenses")
    .select("id, title, human_price, ai_price, licensing_enabled, publisher_id, source_url")
    .eq("id", article_id)
    .eq("publisher_id", publisher.id)
    .single();

  if (artError || !article) {
    return errorResponse("Article not found or not owned by this API key", 404);
  }

  if (!article.licensing_enabled) {
    return errorResponse("Licensing not enabled for this article", 403);
  }

  const price = Number(license_type === "human" ? article.human_price : article.ai_price);
  if (!price || price <= 0) {
    return errorResponse(`No price set for ${license_type} license`);
  }

  // Generate unique license key
  const licenseKey = await generateUniqueLicenseKey(supabase);
  if (!licenseKey) {
    return errorResponse("Failed to generate license key", 500);
  }

  // Insert transaction
  const { data: txRow, error: insertError } = await supabase
    .from("license_transactions")
    .insert({
      article_id,
      buyer_email,
      amount: price,
      license_type,
      license_key: licenseKey,
      status: "completed",
      ...(buyer_name ? { buyer_name } : {}),
      ...(buyer_organization ? { buyer_organization } : {}),
      ...(intended_use ? { intended_use } : {}),
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("[api] Insert error:", insertError.message);
    return errorResponse("Failed to create license", 500);
  }

  // Atomic counter increment
  await supabase.rpc("increment_license_counter", {
    p_article_id: article_id,
    p_license_type: license_type,
    p_amount: price,
  });

  // Register on-chain (non-blocking — fire and forget)
  registerOnChain(supabase, {
    licenseKey,
    articleId: article_id,
    licenseType: license_type,
    intendedUse: intended_use || null,
    transactionId: txRow!.id,
    publisherId: publisher.id,
  }).catch(err => console.error("[api] On-chain error:", err));

  // Log event
  await logEvent(supabase, {
    event_type: "license.issued",
    license_key: licenseKey,
    transaction_id: txRow?.id,
    article_id,
    publisher_id: publisher.id,
    actor_type: "publisher",
    actor_id: `api:${publisher.id}`,
    metadata: { license_type, amount: price, buyer_email, buyer_name, buyer_organization, intended_use, via: "programmatic_api" },
  });

  const licenseTypeLabel = license_type === "human" ? "Human" : "AI";
  console.log(`[api] License issued: ${licenseKey} for "${article.title}" — ${licenseTypeLabel} $${price} via API`);

  // Send Handshake Email
  const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://opedd.com";
  const issuedAt = new Date().toISOString();
  const verifyUrl = `${frontendUrl}/verify/${licenseKey}`;

  const html = buildHandshakeEmail({
    licenseKey,
    articleTitle: article.title,
    articleUrl: article.source_url || null,
    publisherName: publisher.name,
    buyerName: buyer_name || null,
    buyerOrganization: buyer_organization || null,
    buyerEmail: buyer_email,
    licenseType: license_type,
    intendedUse: intended_use || null,
    amount: price,
    verifyUrl,
    issuedAt,
  });

  const emailSent = await sendEmail({
    to: buyer_email,
    subject: `License Confirmed — ${licenseKey}`,
    html,
  });

  await logEvent(supabase, {
    event_type: emailSent ? "email.sent" : "email.failed",
    license_key: licenseKey,
    transaction_id: txRow?.id,
    article_id,
    publisher_id: publisher.id,
    actor_type: "system",
    actor_id: buyer_email,
  });

  // Return full license details
  return successResponse({
    license: {
      key: licenseKey,
      type: license_type,
      type_label: licenseTypeLabel + (license_type === "human" ? " Republication" : " Training"),
      status: "completed",
      amount: price,
      currency: "usd",
      issued_at: issuedAt,
    },
    content: {
      id: article_id,
      title: article.title,
      source_url: article.source_url,
    },
    licensee: {
      email: buyer_email,
      name: buyer_name || null,
      organization: buyer_organization || null,
      intended_use: intended_use || null,
    },
    verify_url: verifyUrl,
    email_sent: emailSent,
  }, 201);
}

// POST ?action=batch_purchase — Purchase licenses for multiple articles
async function handleBatchPurchase(publisher: any, req: Request) {
  if (req.method !== "POST") {
    return errorResponse("Batch purchase requires POST method", 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON");
  }

  const { items, buyer_email, buyer_name, buyer_organization, intended_use } = body;

  // Validate required fields
  if (!Array.isArray(items) || items.length === 0) {
    return errorResponse("items must be a non-empty array of { article_id, license_type }");
  }
  if (items.length > 50) {
    return errorResponse("Maximum 50 items per batch");
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!buyer_email || typeof buyer_email !== "string" || !emailRegex.test(buyer_email)) {
    return errorResponse("Valid buyer_email is required");
  }

  const validUses = ["personal", "editorial", "commercial", "ai_training", "corporate"];
  if (intended_use && !validUses.includes(intended_use)) {
    return errorResponse(`intended_use must be one of: ${validUses.join(", ")}`);
  }

  // Validate each item
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.article_id || typeof item.article_id !== "string") {
      return errorResponse(`items[${i}].article_id is required`);
    }
    if (!item.license_type || !["human", "ai"].includes(item.license_type)) {
      return errorResponse(`items[${i}].license_type must be 'human' or 'ai'`);
    }
  }

  const supabase = createServiceClient();

  // Rate limit: 10 batch purchases per API key per hour
  if (await isRateLimited(supabase, `api-batch:${publisher.id}`, 10, 3600)) {
    return errorResponse("Rate limit exceeded. Max 10 batch purchases per hour.", 429);
  }

  // Fetch all articles in one query
  const articleIds = [...new Set(items.map((i: any) => i.article_id))];
  const { data: articles, error: artError } = await supabase
    .from("licenses")
    .select("id, title, human_price, ai_price, licensing_enabled, publisher_id, source_url")
    .in("id", articleIds)
    .eq("publisher_id", publisher.id);

  if (artError) {
    console.error("[api] Batch fetch articles error:", artError.message);
    return errorResponse("Failed to fetch articles", 500);
  }

  const articleMap = new Map((articles || []).map((a: any) => [a.id, a]));

  // Validate all articles exist, are owned, enabled, and priced
  const errors: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const article = articleMap.get(item.article_id);
    if (!article) {
      errors.push(`items[${i}]: Article ${item.article_id} not found or not owned by this API key`);
      continue;
    }
    if (!article.licensing_enabled) {
      errors.push(`items[${i}]: Licensing not enabled for "${article.title}"`);
      continue;
    }
    const price = Number(item.license_type === "human" ? article.human_price : article.ai_price);
    if (!price || price <= 0) {
      errors.push(`items[${i}]: No ${item.license_type} price set for "${article.title}"`);
    }
  }

  if (errors.length > 0) {
    return errorResponse(errors.join("; "));
  }

  // Process each item
  const results: any[] = [];
  let totalAmount = 0;

  for (const item of items) {
    const article = articleMap.get(item.article_id)!;
    const price = Number(item.license_type === "human" ? article.human_price : article.ai_price);

    const licenseKey = await generateUniqueLicenseKey(supabase);
    if (!licenseKey) {
      results.push({ article_id: item.article_id, error: "Failed to generate license key" });
      continue;
    }

    const { data: txRow, error: insertError } = await supabase
      .from("license_transactions")
      .insert({
        article_id: item.article_id,
        buyer_email,
        amount: price,
        license_type: item.license_type,
        license_key: licenseKey,
        status: "completed",
        ...(buyer_name ? { buyer_name } : {}),
        ...(buyer_organization ? { buyer_organization } : {}),
        ...(intended_use ? { intended_use } : {}),
      })
      .select("id")
      .single();

    if (insertError) {
      console.error(`[api] Batch insert error for ${item.article_id}:`, insertError.message);
      results.push({ article_id: item.article_id, error: "Failed to create license" });
      continue;
    }

    // Increment counters
    await supabase.rpc("increment_license_counter", {
      p_article_id: item.article_id,
      p_license_type: item.license_type,
      p_amount: price,
    });

    // Register on-chain (non-blocking — fire and forget)
    registerOnChain(supabase, {
      licenseKey,
      articleId: item.article_id,
      licenseType: item.license_type,
      intendedUse: intended_use || null,
      transactionId: txRow!.id,
      publisherId: publisher.id,
    }).catch(err => console.error("[api] Batch on-chain error:", err));

    // Log event
    await logEvent(supabase, {
      event_type: "license.issued",
      license_key: licenseKey,
      transaction_id: txRow?.id,
      article_id: item.article_id,
      publisher_id: publisher.id,
      actor_type: "publisher",
      actor_id: `api:${publisher.id}`,
      metadata: { license_type: item.license_type, amount: price, buyer_email, buyer_name, buyer_organization, intended_use, via: "programmatic_api", batch: true },
    });

    totalAmount += price;
    results.push({
      article_id: item.article_id,
      title: article.title,
      license_key: licenseKey,
      license_type: item.license_type,
      amount: price,
    });
  }

  const successCount = results.filter((r: any) => r.license_key).length;
  const failCount = results.filter((r: any) => r.error).length;

  console.log(`[api] Batch purchase: ${successCount} issued, ${failCount} failed, $${totalAmount} total for publisher ${publisher.id}`);

  // Send summary email with all licenses
  if (successCount > 0) {
    const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://opedd.com";
    const successItems = results.filter((r: any) => r.license_key);

    const licenseRows = successItems.map((r: any) =>
      `<tr><td style="padding:6px 12px;border:1px solid #e2e8f0">${r.title}</td><td style="padding:6px 12px;border:1px solid #e2e8f0">${r.license_type === "human" ? "Human" : "AI"}</td><td style="padding:6px 12px;border:1px solid #e2e8f0"><code>${r.license_key}</code></td><td style="padding:6px 12px;border:1px solid #e2e8f0">$${Number(r.amount).toFixed(2)}</td></tr>`
    ).join("");

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#1a202c">Batch License Confirmation</h2>
        <p>You have been issued <strong>${successCount}</strong> license${successCount > 1 ? "s" : ""} via the Opedd Protocol.</p>
        ${buyer_name ? `<p><strong>Licensee:</strong> ${buyer_name}${buyer_organization ? ` (${buyer_organization})` : ""}</p>` : ""}
        <p><strong>Total:</strong> $${totalAmount.toFixed(2)} USD</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <thead><tr style="background:#f7fafc">
            <th style="padding:6px 12px;border:1px solid #e2e8f0;text-align:left">Article</th>
            <th style="padding:6px 12px;border:1px solid #e2e8f0;text-align:left">Type</th>
            <th style="padding:6px 12px;border:1px solid #e2e8f0;text-align:left">License Key</th>
            <th style="padding:6px 12px;border:1px solid #e2e8f0;text-align:left">Amount</th>
          </tr></thead>
          <tbody>${licenseRows}</tbody>
        </table>
        <p>Verify any license: <a href="${frontendUrl}/verify">opedd.com/verify</a></p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
        <p style="font-size:12px;color:#718096">Issued by the Opedd Protocol</p>
      </div>
    `;

    const emailSent = await sendEmail({
      to: buyer_email,
      subject: `Batch License Confirmation — ${successCount} License${successCount > 1 ? "s" : ""} Issued`,
      html,
    });

    await logEvent(supabase, {
      event_type: emailSent ? "email.sent" : "email.failed",
      article_id: successItems[0].article_id,
      publisher_id: publisher.id,
      actor_type: "system",
      actor_id: buyer_email,
      metadata: { batch: true, count: successCount },
    });
  }

  return successResponse({
    summary: {
      total_requested: items.length,
      issued: successCount,
      failed: failCount,
      total_amount: totalAmount,
      currency: "usd",
    },
    licenses: results,
  }, 201);
}

// GET ?action=verify&key=OP-XXXX-XXXX — Verify a license (public, no auth needed)
async function handleVerify(req: Request, url: URL) {
  const key = url.searchParams.get("key");

  if (!key || !key.startsWith("OP-")) {
    return errorResponse("Valid license key is required (format: OP-XXXX-XXXX)");
  }

  const supabase = createServiceClient();

  const { data: tx, error } = await supabase
    .from("license_transactions")
    .select("license_key, license_type, intended_use, buyer_name, buyer_organization, amount, status, created_at, article_id, blockchain_tx_hash")
    .eq("license_key", key)
    .single();

  if (error || !tx) {
    return errorResponse("License not found", 404);
  }

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

  // Log verification event
  await logEvent(supabase, {
    event_type: "license.verified",
    license_key: key,
    article_id: tx.article_id,
    publisher_id: article?.publisher_id,
    actor_type: "system",
    actor_id: "api",
  });

  // On-chain verification (read-only, no gas)
  const onChainProof = await verifyOnChain(key);

  const result: Record<string, unknown> = {
    valid: tx.status === "completed",
    license: {
      key: tx.license_key,
      type: tx.license_type,
      type_label: tx.license_type === "human" ? "Human Republication" : "AI Training",
      status: tx.status,
      intended_use: tx.intended_use,
      amount: tx.amount,
      currency: "usd",
      issued_at: tx.created_at,
    },
    content: {
      title: article?.title || "Unknown",
      source_url: article?.source_url || null,
      publisher: publisherName,
    },
    licensee: {
      name: tx.buyer_name || null,
      organization: tx.buyer_organization || null,
    },
    blockchain_proof: onChainProof
      ? {
          registered: onChainProof.registered,
          valid: onChainProof.valid,
          chain: onChainProof.chain,
          contract: onChainProof.contract,
          explorer_url: tx.blockchain_tx_hash
            ? `https://sepolia.basescan.org/tx/${tx.blockchain_tx_hash}`
            : null,
        }
      : null,
  };

  // Include machine-readable license for AI type
  if (tx.license_type === "ai") {
    result.machine_readable = {
      "@context": "https://opedd.com/schema/v1",
      protocol: "opedd",
      version: "1.0",
      license_id: tx.license_key,
      license_type: "ai_training",
      content_title: article?.title || "Unknown",
      content_url: article?.source_url || null,
      publisher: publisherName,
      licensee: tx.buyer_name || null,
      licensee_organization: tx.buyer_organization || null,
      issued_at: tx.created_at,
      status: tx.status,
    };
  }

  return successResponse(result);
}

// GET ?action=usage — API key usage stats
async function handleUsage(publisher: any) {
  const supabase = createServiceClient();

  // Get all articles
  const { data: articles, error: artError } = await supabase
    .from("licenses")
    .select("id, title, human_licenses_sold, ai_licenses_sold, total_revenue, licensing_enabled")
    .eq("publisher_id", publisher.id);

  const allArticles = articles || [];
  const articleIds = allArticles.map((a: any) => a.id);

  // Transaction stats
  let totalTransactions = 0;
  let completedTransactions = 0;
  let totalRevenue = 0;
  let apiTransactions = 0;

  if (articleIds.length > 0) {
    const { count: total } = await supabase
      .from("license_transactions")
      .select("id", { count: "exact", head: true })
      .in("article_id", articleIds);
    totalTransactions = total || 0;

    const { count: completed } = await supabase
      .from("license_transactions")
      .select("id", { count: "exact", head: true })
      .in("article_id", articleIds)
      .eq("status", "completed");
    completedTransactions = completed || 0;

    totalRevenue = allArticles.reduce((s: number, a: any) => s + Number(a.total_revenue || 0), 0);

    // Count API-sourced licenses (via event metadata)
    const { count: apiCount } = await supabase
      .from("license_events")
      .select("id", { count: "exact", head: true })
      .eq("publisher_id", publisher.id)
      .eq("event_type", "license.issued")
      .contains("metadata", { via: "programmatic_api" });
    apiTransactions = apiCount || 0;
  }

  // Event counts (last 24h)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: eventsLast24h } = await supabase
    .from("license_events")
    .select("id", { count: "exact", head: true })
    .eq("publisher_id", publisher.id)
    .gte("created_at", oneDayAgo);

  return successResponse({
    publisher: {
      name: publisher.name,
    },
    content: {
      total_articles: allArticles.length,
      licensed_articles: allArticles.filter((a: any) => a.licensing_enabled).length,
    },
    transactions: {
      total: totalTransactions,
      completed: completedTransactions,
      via_api: apiTransactions,
      total_revenue: totalRevenue,
      currency: "usd",
    },
    activity: {
      events_last_24h: eventsLast24h || 0,
    },
    rate_limits: {
      purchases_per_hour: 30,
    },
  });
}

// GET ?action=docs — Full API documentation (public, no auth)
function handleDocs() {
  const baseUrl = "https://djdzcciayennqchjgybx.supabase.co/functions/v1/api";

  return successResponse({
    openapi: "3.0.0",
    info: {
      title: "Opedd Programmatic API",
      version: "1.0.0",
      description: "Programmatic API for the Opedd Decentralized Content Rights Protocol. Enables AI companies and platforms to discover licensable content, purchase licenses, and verify license keys.",
      contact: { url: "https://opedd.com" },
    },
    base_url: baseUrl,
    authentication: {
      type: "API Key",
      header: "X-API-Key",
      format: "op_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      description: "Generate an API key in your Opedd publisher dashboard under Settings. Include it in the X-API-Key header for all authenticated requests.",
      public_actions: ["verify", "docs"],
    },
    endpoints: {
      articles: {
        method: "GET",
        url: `${baseUrl}?action=articles`,
        auth: true,
        description: "List all licensable articles for your publisher account.",
        parameters: {
          limit: { type: "number", default: 50, max: 100, description: "Number of results per page" },
          offset: { type: "number", default: 0, description: "Pagination offset" },
          type: { type: "string", enum: ["human", "ai"], description: "Filter by license type availability" },
        },
        response_example: {
          success: true,
          data: {
            articles: [{
              id: "uuid",
              title: "Article Title",
              description: "...",
              source_url: "https://example.com/article",
              pricing: {
                human: { price: 10.00, currency: "usd" },
                ai: { price: 50.00, currency: "usd" },
              },
              stats: { human_licenses_sold: 5, ai_licenses_sold: 2 },
              created_at: "2026-01-01T00:00:00Z",
            }],
            total: 1,
            limit: 50,
            offset: 0,
          },
        },
      },
      article: {
        method: "GET",
        url: `${baseUrl}?action=article&id={uuid}`,
        auth: true,
        description: "Get detailed information about a specific article including recent license activity.",
        parameters: {
          id: { type: "string", required: true, description: "Article UUID" },
        },
        response_example: {
          success: true,
          data: {
            article: {
              id: "uuid",
              title: "Article Title",
              pricing: { human: { price: 10.00, currency: "usd" }, ai: { price: 50.00, currency: "usd" } },
              stats: { human_licenses_sold: 5, ai_licenses_sold: 2, total_revenue: 150.00 },
            },
            recent_licenses: [{ key: "OP-XXXX-XXXX", type: "ai", amount: 50.00, licensee: "Corp", issued_at: "2026-01-01T00:00:00Z" }],
          },
        },
      },
      purchase: {
        method: "POST",
        url: `${baseUrl}?action=purchase`,
        auth: true,
        description: "Purchase a single license. Generates a unique license key, increments counters, and sends a Handshake Email to the buyer.",
        rate_limit: "30 purchases per API key per hour",
        request_body: {
          article_id: { type: "string", required: true, description: "UUID of the article to license" },
          license_type: { type: "string", required: true, enum: ["human", "ai"], description: "Type of license" },
          buyer_email: { type: "string", required: true, description: "Email to receive the license certificate" },
          buyer_name: { type: "string", required: false, description: "Name of the licensee" },
          buyer_organization: { type: "string", required: false, description: "Organization name" },
          intended_use: { type: "string", required: false, enum: ["personal", "editorial", "commercial", "ai_training", "corporate"], description: "How the content will be used" },
        },
        response_example: {
          success: true,
          data: {
            license: { key: "OP-XXXX-XXXX", type: "ai", type_label: "AI Training", status: "completed", amount: 50.00, currency: "usd", issued_at: "2026-01-01T00:00:00Z" },
            content: { id: "uuid", title: "Article Title", source_url: "https://example.com/article" },
            licensee: { email: "buyer@example.com", name: "John", organization: "Corp", intended_use: "ai_training" },
            verify_url: "https://opedd.com/verify/OP-XXXX-XXXX",
            email_sent: true,
          },
        },
      },
      batch_purchase: {
        method: "POST",
        url: `${baseUrl}?action=batch_purchase`,
        auth: true,
        description: "Purchase licenses for multiple articles in a single request. Max 50 items per batch.",
        rate_limit: "10 batch purchases per API key per hour",
        request_body: {
          items: { type: "array", required: true, max_items: 50, description: "Array of { article_id: string, license_type: 'human' | 'ai' }" },
          buyer_email: { type: "string", required: true, description: "Email to receive the batch license summary" },
          buyer_name: { type: "string", required: false },
          buyer_organization: { type: "string", required: false },
          intended_use: { type: "string", required: false, enum: ["personal", "editorial", "commercial", "ai_training", "corporate"] },
        },
        response_example: {
          success: true,
          data: {
            summary: { total_requested: 3, issued: 3, failed: 0, total_amount: 110.00, currency: "usd" },
            licenses: [
              { article_id: "uuid1", title: "Article 1", license_key: "OP-XXXX-XXXX", license_type: "ai", amount: 50.00 },
              { article_id: "uuid2", title: "Article 2", license_key: "OP-YYYY-YYYY", license_type: "human", amount: 10.00 },
            ],
          },
        },
      },
      verify: {
        method: "GET",
        url: `${baseUrl}?action=verify&key={OP-XXXX-XXXX}`,
        auth: false,
        description: "Verify a license key. Public endpoint — no API key required. Returns license details and machine-readable data for AI licenses.",
        parameters: {
          key: { type: "string", required: true, format: "OP-XXXX-XXXX", description: "License key to verify" },
        },
        response_example: {
          success: true,
          data: {
            valid: true,
            license: { key: "OP-XXXX-XXXX", type: "ai", type_label: "AI Training", status: "completed", amount: 50.00 },
            content: { title: "Article Title", source_url: "https://example.com/article", publisher: "Publisher Name" },
            machine_readable: { "@context": "https://opedd.com/schema/v1", protocol: "opedd", version: "1.0", license_type: "ai_training" },
          },
        },
      },
      usage: {
        method: "GET",
        url: `${baseUrl}?action=usage`,
        auth: true,
        description: "Get API usage statistics for your publisher account.",
        response_example: {
          success: true,
          data: {
            publisher: { name: "Publisher Name" },
            content: { total_articles: 50, licensed_articles: 45 },
            transactions: { total: 100, completed: 95, via_api: 30, total_revenue: 5000.00, currency: "usd" },
            activity: { events_last_24h: 12 },
            rate_limits: { purchases_per_hour: 30 },
          },
        },
      },
    },
    related_endpoints: {
      registry: "GET /functions/v1/registry — Public Registry of Proof (by license_key, article, publisher, or global feed)",
      certificate: "GET /functions/v1/certificate?key=OP-XXXX-XXXX — Download PDF license certificate",
      ai_defense: "GET /functions/v1/ai-defense-policy?publisher_id=xxx — AI crawler policy (robots.txt, ai.txt)",
      widget: "GET /functions/v1/widget — Embeddable licensing widget JS",
    },
    errors: {
      format: { success: false, error: "Error message" },
      codes: {
        400: "Bad request — missing or invalid parameters",
        401: "Unauthorized — invalid or missing API key",
        403: "Forbidden — licensing not enabled",
        404: "Not found — article or license not found",
        405: "Method not allowed",
        429: "Rate limit exceeded",
        500: "Internal server error",
      },
    },
  });
}
