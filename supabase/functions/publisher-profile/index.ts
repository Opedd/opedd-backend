import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, errorResponse, successResponse } from "../_shared/cors.ts";
import { createServiceClient, authenticatePublisher } from "../_shared/auth.ts";
import Stripe from "https://esm.sh/stripe@17?target=deno";
import { generateWebhookSecret } from "../_shared/webhook.ts";

function generateApiKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomValues = crypto.getRandomValues(new Uint8Array(32));
  let key = "op_";
  for (let i = 0; i < 32; i++) {
    key += chars[randomValues[i] % chars.length];
  }
  return key;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!["GET", "PATCH", "POST"].includes(req.method)) {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const { user, publisher, error: authError } = await authenticatePublisher(req);
    if (!user) {
      return errorResponse(authError || "Unauthorized", 401);
    }

    const supabase = createServiceClient();

    // GET — fetch publisher profile
    if (req.method === "GET") {
      if (!publisher) {
        return errorResponse("Publisher profile not found", 404);
      }

      // Get article and transaction counts
      const { count: articleCount } = await supabase
        .from("licenses")
        .select("id", { count: "exact", head: true })
        .eq("publisher_id", publisher.id);

      const { data: articles } = await supabase
        .from("licenses")
        .select("id")
        .eq("publisher_id", publisher.id);

      const articleIds = (articles || []).map((a: any) => a.id);

      let transactionCount = 0;
      if (articleIds.length > 0) {
        const { count } = await supabase
          .from("license_transactions")
          .select("id", { count: "exact", head: true })
          .in("article_id", articleIds)
          .eq("status", "completed");
        transactionCount = count || 0;
      }

      return successResponse({
        ...publisher,
        email: user.email,
        article_count: articleCount || 0,
        transaction_count: transactionCount,
        stripe_connect: {
          connected: !!publisher.stripe_account_id,
          onboarding_complete: publisher.stripe_onboarding_complete || false,
        },
        webhook: {
          configured: !!publisher.webhook_url,
          url: publisher.webhook_url || null,
        },
      });
    }

    // POST — special actions (generate API key)
    if (req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { body = {}; }

      const action = body.action;

      if (action === "generate_api_key" || action === "regenerate_api_key") {
        const newKey = generateApiKey();

        const { error: updateError } = await supabase
          .from("publishers")
          .update({ api_key: newKey })
          .eq("user_id", user.id);

        if (updateError) {
          return errorResponse("Failed to generate API key", 500);
        }

        console.log(`[publisher-profile] API key generated for user ${user.id}`);
        return successResponse({ api_key: newKey });
      }

      // Stripe Connect: start onboarding
      if (action === "connect_stripe") {
        if (!publisher) {
          return errorResponse("Publisher profile not found", 404);
        }

        const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
        if (!stripeKey) {
          return errorResponse("Stripe not configured", 500);
        }

        const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
        const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://opedd.com";

        let accountId = publisher.stripe_account_id;

        // Create account if not exists
        if (!accountId) {
          const account = await stripe.accounts.create({
            type: "express",
            email: user.email,
            metadata: { publisher_id: publisher.id, user_id: user.id },
            capabilities: {
              card_payments: { requested: true },
              transfers: { requested: true },
            },
          });
          accountId = account.id;

          await supabase
            .from("publishers")
            .update({ stripe_account_id: accountId })
            .eq("id", publisher.id);

          console.log(`[publisher-profile] Stripe Connect account created: ${accountId} for publisher ${publisher.id}`);
        }

        // Create onboarding link
        const accountLink = await stripe.accountLinks.create({
          account: accountId,
          refresh_url: `${frontendUrl}/settings?stripe=refresh`,
          return_url: `${frontendUrl}/settings?stripe=complete`,
          type: "account_onboarding",
        });

        return successResponse({
          onboarding_url: accountLink.url,
          stripe_account_id: accountId,
        });
      }

      // Stripe Connect: get dashboard link
      if (action === "stripe_dashboard") {
        if (!publisher) {
          return errorResponse("Publisher profile not found", 404);
        }

        if (!publisher.stripe_account_id) {
          return errorResponse("Stripe Connect not set up. Use connect_stripe first.", 400);
        }

        const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
        if (!stripeKey) {
          return errorResponse("Stripe not configured", 500);
        }

        const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

        const loginLink = await stripe.accounts.createLoginLink(publisher.stripe_account_id);

        return successResponse({
          dashboard_url: loginLink.url,
        });
      }

      // Stripe Connect: check status
      if (action === "stripe_status") {
        if (!publisher) {
          return errorResponse("Publisher profile not found", 404);
        }

        if (!publisher.stripe_account_id) {
          return successResponse({
            connected: false,
            onboarding_complete: false,
          });
        }

        const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
        if (!stripeKey) {
          return errorResponse("Stripe not configured", 500);
        }

        const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
        const account = await stripe.accounts.retrieve(publisher.stripe_account_id);

        // Update onboarding status if changed
        const isComplete = account.charges_enabled && account.payouts_enabled;
        if (isComplete !== publisher.stripe_onboarding_complete) {
          await supabase
            .from("publishers")
            .update({ stripe_onboarding_complete: isComplete })
            .eq("id", publisher.id);
        }

        return successResponse({
          connected: true,
          onboarding_complete: isComplete,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          details_submitted: account.details_submitted,
        });
      }

      // Webhook: set URL
      if (action === "set_webhook") {
        if (!publisher) {
          return errorResponse("Publisher profile not found", 404);
        }

        const webhookUrl = body.webhook_url;
        if (!webhookUrl || typeof webhookUrl !== "string") {
          return errorResponse("webhook_url is required");
        }

        // Validate URL format
        try {
          const parsed = new URL(webhookUrl);
          if (!["http:", "https:"].includes(parsed.protocol)) {
            return errorResponse("webhook_url must be http or https");
          }
        } catch {
          return errorResponse("Invalid webhook_url format");
        }

        // Generate secret if not already set
        let secret = publisher.webhook_secret;
        if (!secret) {
          secret = generateWebhookSecret();
        }

        const { error: updateErr } = await supabase
          .from("publishers")
          .update({ webhook_url: webhookUrl, webhook_secret: secret })
          .eq("id", publisher.id);

        if (updateErr) {
          return errorResponse("Failed to set webhook", 500);
        }

        console.log(`[publisher-profile] Webhook set for publisher ${publisher.id}: ${webhookUrl}`);
        return successResponse({
          webhook_url: webhookUrl,
          webhook_secret: secret,
          events: ["license.issued", "license.paid", "license.verified", "license.revoked"],
        });
      }

      // Webhook: remove
      if (action === "remove_webhook") {
        if (!publisher) {
          return errorResponse("Publisher profile not found", 404);
        }

        await supabase
          .from("publishers")
          .update({ webhook_url: null, webhook_secret: null })
          .eq("id", publisher.id);

        console.log(`[publisher-profile] Webhook removed for publisher ${publisher.id}`);
        return successResponse({ removed: true });
      }

      // Webhook: view delivery log
      if (action === "webhook_deliveries") {
        if (!publisher) {
          return errorResponse("Publisher profile not found", 404);
        }

        const limit = Math.min(Number(body.limit) || 20, 100);
        const { data: deliveries } = await supabase
          .from("webhook_deliveries")
          .select("id, event_type, status, status_code, attempts, created_at")
          .eq("publisher_id", publisher.id)
          .order("created_at", { ascending: false })
          .limit(limit);

        return successResponse({ deliveries: deliveries || [] });
      }

      if (action === "generate_embed_snippets") {
        if (!publisher) {
          return errorResponse("Publisher profile not found", 404);
        }

        const articleId = body.article_id;
        const widgetUrl = "https://djdzcciayennqchjgybx.supabase.co/functions/v1/widget";
        const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://opedd.com";

        // If article_id provided, generate per-article snippets
        if (articleId) {
          const { data: article, error: artErr } = await supabase
            .from("licenses")
            .select("id, title, source_url")
            .eq("id", articleId)
            .eq("publisher_id", publisher.id)
            .single();

          if (artErr || !article) {
            return errorResponse("Article not found", 404);
          }

          return successResponse({
            article: { id: article.id, title: article.title },
            snippets: {
              html_card: `<script src="${widgetUrl}" data-asset-id="${article.id}" data-frontend-url="${frontendUrl}"><\/script>`,
              html_badge: `<script src="${widgetUrl}" data-asset-id="${article.id}" data-mode="badge" data-frontend-url="${frontendUrl}"><\/script>`,
              html_compact: `<script src="${widgetUrl}" data-asset-id="${article.id}" data-mode="compact" data-frontend-url="${frontendUrl}"><\/script>`,
              html_dark: `<script src="${widgetUrl}" data-asset-id="${article.id}" data-theme="dark" data-frontend-url="${frontendUrl}"><\/script>`,
              html_fixed: `<script src="${widgetUrl}" data-asset-id="${article.id}" data-position="bottom-right" data-frontend-url="${frontendUrl}"><\/script>`,
              wordpress_shortcode: `[opedd_widget asset_id="${article.id}"]`,
              direct_link: `${frontendUrl}/l/${article.id}`,
            },
          });
        }

        // Publisher-level snippets (auto-detect by URL)
        return successResponse({
          publisher: { id: publisher.id, name: publisher.name },
          snippets: {
            html_auto_detect: `<script src="${widgetUrl}" data-publisher-id="${publisher.id}" data-frontend-url="${frontendUrl}"><\/script>`,
            html_auto_detect_dark: `<script src="${widgetUrl}" data-publisher-id="${publisher.id}" data-theme="dark" data-frontend-url="${frontendUrl}"><\/script>`,
            html_auto_detect_badge: `<script src="${widgetUrl}" data-publisher-id="${publisher.id}" data-mode="badge" data-frontend-url="${frontendUrl}"><\/script>`,
            wordpress_shortcode: `[opedd_widget publisher_id="${publisher.id}"]`,
          },
          options: {
            "data-mode": { values: ["card", "badge", "compact"], default: "card", description: "Widget display mode" },
            "data-theme": { values: ["light", "dark"], default: "light", description: "Color theme" },
            "data-position": { values: ["inline", "bottom-right", "bottom-left"], default: "inline", description: "Widget position" },
            "data-color": { default: "#4A26ED", description: "Primary brand color (hex)" },
            "data-text": { default: "License this content", description: "CTA button text" },
            "data-radius": { default: "10", description: "Border radius in pixels" },
          },
        });
      }

      return errorResponse("Unknown action");
    }

    // PATCH — update publisher profile
    if (req.method === "PATCH") {
      let body;
      try { body = await req.json(); } catch {
        return errorResponse("Invalid JSON");
      }

      const allowedFields = ["name", "default_human_price", "default_ai_price", "website_url", "description"];
      const updatePayload: Record<string, unknown> = {};

      for (const field of allowedFields) {
        if (body[field] !== undefined) {
          updatePayload[field] = body[field];
        }
      }

      if (Object.keys(updatePayload).length === 0) {
        return errorResponse("No valid fields to update");
      }

      // Validate prices
      if (updatePayload.default_human_price !== undefined) {
        const price = Number(updatePayload.default_human_price);
        if (isNaN(price) || price < 0) {
          return errorResponse("default_human_price must be a non-negative number");
        }
        updatePayload.default_human_price = price;
      }

      if (updatePayload.default_ai_price !== undefined) {
        const price = Number(updatePayload.default_ai_price);
        if (isNaN(price) || price < 0) {
          return errorResponse("default_ai_price must be a non-negative number");
        }
        updatePayload.default_ai_price = price;
      }

      const { data: updated, error: updateError } = await supabase
        .from("publishers")
        .update(updatePayload)
        .eq("user_id", user.id)
        .select("id, name, default_human_price, default_ai_price, website_url, description")
        .single();

      if (updateError) {
        console.error("[publisher-profile] Update error:", updateError.message);
        return errorResponse("Failed to update profile", 500);
      }

      console.log(`[publisher-profile] Profile updated for user ${user.id}`);
      return successResponse(updated);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[publisher-profile] Error:", msg);
    return errorResponse("Internal server error", 500);
  }
});
