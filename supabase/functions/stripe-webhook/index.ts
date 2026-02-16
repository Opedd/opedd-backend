import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@17?target=deno";
import { createServiceClient } from "../_shared/auth.ts";
import { generateUniqueLicenseKey } from "../_shared/license-key.ts";
import { buildHandshakeEmail, sendEmail } from "../_shared/email.ts";
import { logEvent } from "../_shared/events.ts";
import { notifyPublisherWebhook } from "../_shared/webhook.ts";
import { registerOnChain } from "../_shared/blockchain.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2024-12-18.acacia",
    });

    // Read raw body for signature verification
    const rawBody = await req.text();
    const sig = req.headers.get("stripe-signature");

    if (!sig) {
      console.error("[stripe-webhook] Missing stripe-signature header");
      return new Response("Missing signature", { status: 400 });
    }

    // Verify the webhook signature
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        rawBody,
        sig,
        Deno.env.get("STRIPE_WEBHOOK_SECRET")!
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      console.error("[stripe-webhook] Signature verification failed:", msg);
      return new Response("Invalid signature", { status: 400 });
    }

    console.log(`[stripe-webhook] Received event: ${event.type} (${event.id})`);

    const supabase = createServiceClient();

    // Handle checkout.session.completed
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const metadata = session.metadata || {};

      const articleId = metadata.article_id;
      const licenseType = metadata.license_type as "human" | "ai";
      const publisherId = metadata.publisher_id;
      const buyerName = metadata.buyer_name || null;
      const buyerOrganization = metadata.buyer_organization || null;
      const intendedUse = metadata.intended_use || null;
      const buyerEmail = session.customer_email || "";

      if (!articleId || !licenseType) {
        console.error("[stripe-webhook] Missing metadata:", metadata);
        return new Response("OK", { status: 200 });
      }

      // Log payment.completed event
      await logEvent(supabase, {
        event_type: "payment.completed",
        article_id: articleId,
        publisher_id: publisherId,
        actor_type: "stripe",
        actor_id: session.id,
        metadata: { buyer_email: buyerEmail, amount_total: session.amount_total },
      });

      // Find the pending transaction
      const { data: tx, error: txError } = await supabase
        .from("license_transactions")
        .select("id, amount")
        .eq("stripe_session_id", session.id)
        .eq("status", "pending")
        .single();

      if (txError || !tx) {
        console.error("[stripe-webhook] Pending transaction not found for session:", session.id);
        return new Response("OK", { status: 200 });
      }

      // Generate unique license key
      const licenseKey = await generateUniqueLicenseKey(supabase);
      if (!licenseKey) {
        console.error("[stripe-webhook] Failed to generate unique license key");
        return new Response("OK", { status: 200 });
      }

      // Update transaction to completed with license key
      const { error: updateError } = await supabase
        .from("license_transactions")
        .update({ status: "completed", license_key: licenseKey })
        .eq("id", tx.id);

      if (updateError) {
        console.error("[stripe-webhook] Update error:", updateError.message);
        return new Response("OK", { status: 200 });
      }

      const amount = Number(tx.amount);

      // Fetch article details
      const { data: current } = await supabase
        .from("licenses")
        .select("title, source_url")
        .eq("id", articleId)
        .single();

      const articleTitle = current?.title || "Unknown";
      const articleUrl = current?.source_url || null;

      // Atomic counter increment (no race condition)
      await supabase.rpc("increment_license_counter", {
        p_article_id: articleId,
        p_license_type: licenseType,
        p_amount: amount,
      });

      // Register on-chain (non-blocking — fire and forget)
      registerOnChain(supabase, {
        licenseKey,
        articleId: articleId,
        licenseType: licenseType,
        intendedUse: intendedUse || null,
        transactionId: tx.id,
        publisherId: publisherId || null,
      }).catch(err => console.error("[stripe-webhook] On-chain error:", err));

      // Fetch publisher for notification + email
      let publisherName = "Unknown Publisher";
      let publisherUserId: string | null = null;
      if (publisherId) {
        const { data: publisher } = await supabase
          .from("publishers")
          .select("user_id, name")
          .eq("id", publisherId)
          .single();
        if (publisher) {
          publisherName = publisher.name;
          publisherUserId = publisher.user_id;
        }
      }

      const licenseTypeLabel = licenseType === "human" ? "Human" : "AI";
      console.log(`[stripe-webhook] License issued: ${licenseKey} for "${articleTitle}" — ${licenseTypeLabel} $${amount}`);

      // Log license.paid event
      await logEvent(supabase, {
        event_type: "license.paid",
        license_key: licenseKey,
        transaction_id: tx.id,
        article_id: articleId,
        publisher_id: publisherId,
        actor_type: "stripe",
        actor_id: session.id,
        metadata: { license_type: licenseType, amount, buyer_email: buyerEmail, buyer_name: buyerName, buyer_organization: buyerOrganization, intended_use: intendedUse },
      });

      // Notify publisher
      if (publisherUserId) {
        await supabase.from("notifications").insert({
          user_id: publisherUserId,
          type: "license_sold",
          title: "License Sold!",
          message: `"${articleTitle}" — ${licenseTypeLabel} license purchased for $${amount.toFixed(2)}`,
          metadata: {
            article_id: articleId, license_type: licenseType, amount,
            buyer_email: buyerEmail, license_key: licenseKey,
            buyer_name: buyerName, buyer_organization: buyerOrganization,
            intended_use: intendedUse, payment_method: "stripe",
          },
        });
      }

      // Notify publisher webhook
      if (publisherId) {
        await notifyPublisherWebhook(supabase, publisherId, "license.paid", {
          license_key: licenseKey,
          license_type: licenseType,
          article_id: articleId,
          article_title: articleTitle,
          amount,
          buyer_email: buyerEmail,
          buyer_name: buyerName,
          buyer_organization: buyerOrganization,
          intended_use: intendedUse,
          payment_method: "stripe",
        });
      }

      // Send Handshake Email via Resend
      if (buyerEmail) {
        const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://opedd.com";
        const issuedAt = new Date().toISOString();
        const verifyUrl = `${frontendUrl}/verify/${licenseKey}`;

        const html = buildHandshakeEmail({
          licenseKey, articleTitle, articleUrl, publisherName,
          buyerName, buyerOrganization, buyerEmail, licenseType,
          intendedUse, amount, verifyUrl, issuedAt,
        });

        const emailSent = await sendEmail({
          to: buyerEmail,
          subject: `License Confirmed — ${licenseKey}`,
          html,
        });

        // Log email event
        await logEvent(supabase, {
          event_type: emailSent ? "email.sent" : "email.failed",
          license_key: licenseKey,
          transaction_id: tx.id,
          article_id: articleId,
          publisher_id: publisherId,
          actor_type: "system",
          actor_id: buyerEmail,
        });
      }
    }

    // Handle checkout.session.expired — mark as failed
    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      const metadata = session.metadata || {};

      await supabase
        .from("license_transactions")
        .update({ status: "failed" })
        .eq("stripe_session_id", session.id)
        .eq("status", "pending");

      console.log(`[stripe-webhook] Session expired: ${session.id}`);

      // Log payment.failed event
      await logEvent(supabase, {
        event_type: "payment.failed",
        article_id: metadata.article_id,
        publisher_id: metadata.publisher_id,
        actor_type: "stripe",
        actor_id: session.id,
        metadata: { reason: "session_expired" },
      });
    }

    // Handle account.updated — Stripe Connect onboarding status
    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      const isComplete = account.charges_enabled && account.payouts_enabled;

      const { error: connectErr } = await supabase
        .from("publishers")
        .update({ stripe_onboarding_complete: isComplete })
        .eq("stripe_account_id", account.id);

      if (connectErr) {
        console.error("[stripe-webhook] Connect update error:", connectErr.message);
      } else {
        console.log(`[stripe-webhook] Connect account ${account.id} updated: onboarding_complete=${isComplete}`);
      }
    }

    // Always return 200 to acknowledge receipt
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[stripe-webhook] Error:", msg);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
