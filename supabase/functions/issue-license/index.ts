import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, errorResponse, successResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/auth.ts";
import { generateUniqueLicenseKey } from "../_shared/license-key.ts";
import { isRateLimited } from "../_shared/rate-limit.ts";
import { buildHandshakeEmail, sendEmail } from "../_shared/email.ts";
import { logEvent } from "../_shared/events.ts";
import { notifyPublisherWebhook } from "../_shared/webhook.ts";
import { registerOnChain } from "../_shared/blockchain.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON");
    }

    const { article_id, buyer_email, license_type, buyer_name, buyer_organization, intended_use } = body;

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

    // Validate optional handshake fields
    const validUses = ["personal", "editorial", "commercial", "ai_training", "corporate"];
    if (intended_use && !validUses.includes(intended_use)) {
      return errorResponse(`intended_use must be one of: ${validUses.join(", ")}`);
    }

    const supabase = createServiceClient();

    // Database-backed rate limit
    if (await isRateLimited(supabase, `issue-license:${buyer_email}`, 5, 60)) {
      return errorResponse("Too many requests. Try again later.", 429);
    }

    // Fetch article + price + source_url
    const { data: article, error: articleError } = await supabase
      .from("licenses")
      .select("id, title, human_price, ai_price, licensing_enabled, publisher_id, source_url")
      .eq("id", article_id)
      .single();

    if (articleError || !article) {
      return errorResponse("Article not found", 404);
    }

    if (!article.licensing_enabled) {
      return errorResponse("Licensing not enabled for this article", 403);
    }

    const price = Number(license_type === "human" ? article.human_price : article.ai_price);
    if (!price || price <= 0) {
      return errorResponse(`No price set for ${license_type} license`);
    }

    // Generate unique license key (retry on collision)
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
      console.error("[issue-license] Insert error:", insertError.message);
      return errorResponse("Failed to save transaction", 500);
    }

    // Atomic counter increment (no race condition)
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
      publisherId: article.publisher_id,
    }).catch(err => console.error("[issue-license] On-chain error:", err));

    // Fetch publisher name for email + notification
    const { data: publisher } = await supabase
      .from("publishers")
      .select("user_id, name")
      .eq("id", article.publisher_id)
      .single();

    const licenseTypeLabel = license_type === "human" ? "Human" : "AI";
    const publisherName = publisher?.name || "Unknown Publisher";
    console.log(`[issue-license] Sale: "${article.title}" — ${licenseTypeLabel} license to ${buyer_email} for $${price}`);

    // Log event: license.issued
    await logEvent(supabase, {
      event_type: "license.issued",
      license_key: licenseKey,
      transaction_id: txRow?.id,
      article_id,
      publisher_id: article.publisher_id,
      actor_type: "buyer",
      actor_id: buyer_email,
      metadata: { license_type, amount: price, buyer_name, buyer_organization, intended_use },
    });

    // Notify publisher
    if (publisher) {
      await supabase.from("notifications").insert({
        user_id: publisher.user_id,
        type: "license_sold",
        title: "License Sold!",
        message: `"${article.title}" — ${licenseTypeLabel} license purchased for $${price.toFixed(2)}`,
        metadata: { article_id, license_type, amount: price, buyer_email, license_key: licenseKey, buyer_name: buyer_name || null, buyer_organization: buyer_organization || null, intended_use: intended_use || null },
      });
    }

    // Notify publisher webhook
    if (article.publisher_id) {
      await notifyPublisherWebhook(supabase, article.publisher_id, "license.issued", {
        license_key: licenseKey,
        license_type,
        article_id,
        article_title: article.title,
        amount: price,
        buyer_email,
        buyer_name: buyer_name || null,
        buyer_organization: buyer_organization || null,
        intended_use: intended_use || null,
        free: price === 0,
      });
    }

    // Send Handshake Email via Resend (non-blocking — license is already issued)
    const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://opedd.com";
    const issuedAt = new Date().toISOString();
    const verifyUrl = `${frontendUrl}/verify/${licenseKey}`;

    const html = buildHandshakeEmail({
      licenseKey,
      articleTitle: article.title,
      articleUrl: article.source_url || null,
      publisherName,
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

    // Log email event
    await logEvent(supabase, {
      event_type: emailSent ? "email.sent" : "email.failed",
      license_key: licenseKey,
      transaction_id: txRow?.id,
      article_id,
      publisher_id: article.publisher_id,
      actor_type: "system",
      actor_id: buyer_email,
    });

    return successResponse({ license_key: licenseKey, article_title: article.title }, 201);
  } catch (error) {
    console.error("[issue-license] Error:", error instanceof Error ? error.message : "Unknown error");
    return errorResponse("Internal server error", 500);
  }
});
