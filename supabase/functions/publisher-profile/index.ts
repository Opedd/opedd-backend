import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, errorResponse, successResponse } from "../_shared/cors.ts";
import { createServiceClient, authenticatePublisher } from "../_shared/auth.ts";
import Stripe from "https://esm.sh/stripe@17?target=deno";
import { generateWebhookSecret } from "../_shared/webhook.ts";
import { sendEmail, escapeHtml, buildBrandedEmail } from "../_shared/email.ts";

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
    const { user, publisher, role, error: authError } = await authenticatePublisher(req);
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

      // Role gating: owner-only actions
      const ownerOnlyActions = [
        "generate_api_key", "regenerate_api_key",
        "connect_stripe", "stripe_dashboard",
        "set_webhook", "remove_webhook",
        "invite_member", "remove_member", "cancel_invitation",
      ];
      if (ownerOnlyActions.includes(action) && role !== "owner") {
        return errorResponse("Only the account owner can perform this action", 403);
      }

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

      // Stripe Connect: get balance for connected account
      if (action === "stripe_balance") {
        if (!publisher) {
          return errorResponse("Publisher profile not found", 404);
        }

        if (!publisher.stripe_account_id || !publisher.stripe_onboarding_complete) {
          return successResponse({
            available: 0,
            pending: 0,
            currency: "usd",
          });
        }

        const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
        if (!stripeKey) {
          return errorResponse("Stripe not configured", 500);
        }

        const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

        try {
          const balance = await stripe.balance.retrieve({
            stripeAccount: publisher.stripe_account_id,
          });

          const available = balance.available.reduce((sum: number, b: any) => sum + b.amount, 0) / 100;
          const pending = balance.pending.reduce((sum: number, b: any) => sum + b.amount, 0) / 100;
          const currency = balance.available[0]?.currency || "usd";

          return successResponse({ available, pending, currency });
        } catch (err) {
          console.error("[publisher-profile] Stripe balance error:", err instanceof Error ? err.message : err);
          return successResponse({ available: 0, pending: 0, currency: "usd" });
        }
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

      // Team: list members + pending invitations
      if (action === "list_team") {
        if (!publisher) {
          return errorResponse("Publisher profile not found", 404);
        }

        // Get team members
        const { data: members } = await supabase
          .from("team_members")
          .select("id, user_id, role, joined_at")
          .eq("publisher_id", publisher.id)
          .order("joined_at", { ascending: true });

        // Enrich members with email from auth
        const enrichedMembers = [];
        for (const m of members || []) {
          const { data: { user: memberUser } } = await supabase.auth.admin.getUserById(m.user_id);
          enrichedMembers.push({
            id: m.id,
            user_id: m.user_id,
            role: m.role,
            email: memberUser?.email || "unknown",
            joined_at: m.joined_at,
          });
        }

        // Get pending invitations (not accepted, not expired)
        const { data: invitations } = await supabase
          .from("team_invitations")
          .select("id, email, role, created_at, expires_at")
          .eq("publisher_id", publisher.id)
          .is("accepted_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false });

        return successResponse({
          members: enrichedMembers,
          invitations: invitations || [],
          current_user_role: role,
        });
      }

      // Team: invite a new member
      if (action === "invite_member") {
        if (!publisher) {
          return errorResponse("Publisher profile not found", 404);
        }

        const email = (body.email || "").trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return errorResponse("Valid email is required");
        }

        // Cannot invite self
        if (email === user.email?.toLowerCase()) {
          return errorResponse("You cannot invite yourself");
        }

        // Check if already a team member by looking up existing members' emails
        const { data: existingMembers } = await supabase
          .from("team_members")
          .select("user_id")
          .eq("publisher_id", publisher.id);

        if (existingMembers && existingMembers.length > 0) {
          for (const m of existingMembers) {
            const { data: { user: memberUser } } = await supabase.auth.admin.getUserById(m.user_id);
            if (memberUser?.email?.toLowerCase() === email) {
              return errorResponse("This user is already a team member");
            }
          }
        }

        // Generate token
        const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
        const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, "0")).join("");

        // Insert invitation (UNIQUE constraint will prevent duplicates)
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const { error: insertErr } = await supabase
          .from("team_invitations")
          .insert({
            publisher_id: publisher.id,
            email,
            role: "member",
            token,
            invited_by: user.id,
            expires_at: expiresAt,
          });

        if (insertErr) {
          if (insertErr.code === "23505") {
            return errorResponse("An invitation for this email is already pending");
          }
          console.error("[publisher-profile] Invite insert error:", insertErr.message);
          return errorResponse("Failed to create invitation", 500);
        }

        // Send invite email
        const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://opedd.com";
        const inviteLink = `${frontendUrl}/invite/${token}`;
        const safePublisher = escapeHtml(publisher.name || "A publisher");

        await sendEmail({
          to: email,
          subject: `You've been invited to join ${publisher.name} on Opedd`,
          html: buildBrandedEmail("Team Invitation", `
    <p style="margin:0 0 8px;font-size:16px;color:#1f2937;font-weight:600">You're invited!</p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.7"><strong>${safePublisher}</strong> has invited you to join their team on Opedd as a member. You'll be able to view the dashboard, manage content, and see transactions.</p>
    <div style="text-align:center;padding:8px 0 24px">
      <a href="${inviteLink}" style="display:inline-block;background:linear-gradient(135deg,#4A26ED 0%,#7C3AED 100%);color:#ffffff;padding:14px 44px;border-radius:12px;text-decoration:none;font-weight:600;font-size:15px;letter-spacing:0.2px;box-shadow:0 4px 14px rgba(74,38,237,0.3)">Accept Invitation</a>
    </div>
    <div style="background:#f9fafb;border-radius:10px;padding:16px 20px">
      <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">This invitation expires in 7 days. If you weren't expecting this, you can safely ignore it.</p>
    </div>`),
        });

        console.log(`[publisher-profile] Invite sent to ${email} for publisher ${publisher.id}`);
        return successResponse({ invited: true, email, expires_at: expiresAt });
      }

      // Team: remove a member
      if (action === "remove_member") {
        if (!publisher) {
          return errorResponse("Publisher profile not found", 404);
        }

        const memberId = body.member_id;
        if (!memberId) {
          return errorResponse("member_id is required");
        }

        // Verify member exists and is not an owner
        const { data: member } = await supabase
          .from("team_members")
          .select("id, role, user_id")
          .eq("id", memberId)
          .eq("publisher_id", publisher.id)
          .single();

        if (!member) {
          return errorResponse("Member not found", 404);
        }

        if (member.role === "owner") {
          return errorResponse("Cannot remove the account owner");
        }

        const { error: deleteErr } = await supabase
          .from("team_members")
          .delete()
          .eq("id", memberId);

        if (deleteErr) {
          console.error("[publisher-profile] Remove member error:", deleteErr.message);
          return errorResponse("Failed to remove member", 500);
        }

        console.log(`[publisher-profile] Removed member ${memberId} from publisher ${publisher.id}`);
        return successResponse({ removed: true });
      }

      // Team: cancel a pending invitation
      if (action === "cancel_invitation") {
        if (!publisher) {
          return errorResponse("Publisher profile not found", 404);
        }

        const invitationId = body.invitation_id;
        if (!invitationId) {
          return errorResponse("invitation_id is required");
        }

        const { error: deleteErr } = await supabase
          .from("team_invitations")
          .delete()
          .eq("id", invitationId)
          .eq("publisher_id", publisher.id);

        if (deleteErr) {
          console.error("[publisher-profile] Cancel invitation error:", deleteErr.message);
          return errorResponse("Failed to cancel invitation", 500);
        }

        console.log(`[publisher-profile] Cancelled invitation ${invitationId} for publisher ${publisher.id}`);
        return successResponse({ cancelled: true });
      }

      return errorResponse("Unknown action");
    }

    // PATCH — update publisher profile (owner-only)
    if (req.method === "PATCH") {
      if (role !== "owner") {
        return errorResponse("Only the account owner can update the profile", 403);
      }

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
        .eq("id", publisher!.id)
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
