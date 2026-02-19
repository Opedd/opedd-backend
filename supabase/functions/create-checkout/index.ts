import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@17?target=deno";
import { corsHeaders, errorResponse, successResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/auth.ts";
import { isRateLimited, rateLimitResponse } from "../_shared/rate-limit.ts";
import { logEvent } from "../_shared/events.ts";

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

    const { article_id, buyer_email, license_type, buyer_name, buyer_organization, intended_use, return_url, embedded } = body;

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

    // Rate limit: 10 checkouts per email per hour
    if (await isRateLimited(supabase, `create-checkout:${buyer_email}`, 10, 3600)) {
      return rateLimitResponse("Too many checkout attempts. Try again later.", 3600);
    }

    // Fetch article + price
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

    // Look up publisher for Stripe Connect
    const { data: publisher } = await supabase
      .from("publishers")
      .select("stripe_account_id, stripe_onboarding_complete")
      .eq("id", article.publisher_id)
      .single();

    // Create Stripe Checkout Session
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2024-12-18.acacia",
    });

    const licenseTypeLabel = license_type === "human" ? "Human Republication License" : "AI Training License";

    // Build session params
    const sessionParams: any = {
      mode: "payment",
      customer_email: buyer_email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(price * 100),
            product_data: {
              name: `${licenseTypeLabel} — ${article.title}`,
              description: `License to ${license_type === "human" ? "republish" : "use for AI training"}: "${article.title}"`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        article_id,
        license_type,
        publisher_id: article.publisher_id,
        buyer_name: buyer_name || "",
        buyer_organization: buyer_organization || "",
        intended_use: intended_use || "",
      },
    };

    if (embedded) {
      // Embedded Checkout mode — renders inside widget on publisher's page
      sessionParams.ui_mode = "embedded";
      sessionParams.return_url = return_url || "https://opedd.com/license/success?session_id={CHECKOUT_SESSION_ID}";
    } else {
      // Hosted Checkout mode — redirects to Stripe-hosted page
      const frontendUrl = return_url || Deno.env.get("FRONTEND_URL") || "https://opedd.com";
      sessionParams.success_url = `${frontendUrl}/license/success?session_id={CHECKOUT_SESSION_ID}`;
      sessionParams.cancel_url = `${frontendUrl}/l/${article_id}`;
    }

    // If publisher has Stripe Connect, route payment to them with 10% platform fee
    if (publisher?.stripe_account_id && publisher?.stripe_onboarding_complete) {
      const platformFee = Math.round(price * 100 * 0.10); // 10% platform fee
      sessionParams.payment_intent_data = {
        application_fee_amount: platformFee,
        transfer_data: {
          destination: publisher.stripe_account_id,
        },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    // Insert pending transaction
    const { error: insertError } = await supabase
      .from("license_transactions")
      .insert({
        article_id,
        buyer_email,
        amount: price,
        license_type,
        status: "pending",
        stripe_session_id: session.id,
        ...(buyer_name ? { buyer_name } : {}),
        ...(buyer_organization ? { buyer_organization } : {}),
        ...(intended_use ? { intended_use } : {}),
      });

    if (insertError) {
      console.error("[create-checkout] Insert error:", insertError.message);
      return errorResponse("Failed to create transaction", 500);
    }

    console.log(`[create-checkout] Session created: ${session.id} for "${article.title}" — ${licenseTypeLabel} $${price}`);

    // Log payment.initiated event
    await logEvent(supabase, {
      event_type: "payment.initiated",
      article_id,
      publisher_id: article.publisher_id,
      actor_type: "buyer",
      actor_id: buyer_email,
      metadata: { license_type, amount: price, stripe_session_id: session.id },
    });

    if (embedded) {
      return successResponse({
        client_secret: session.client_secret,
        publishable_key: Deno.env.get("STRIPE_PUBLISHABLE_KEY"),
      });
    }

    return successResponse({ checkout_url: session.url });
  } catch (error) {
    console.error("[create-checkout] Error:", error instanceof Error ? error.message : "Unknown error");
    return errorResponse("Internal server error", 500);
  }
});
