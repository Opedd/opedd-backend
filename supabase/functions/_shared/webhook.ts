import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

interface WebhookPayload {
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
}

// Sign a webhook payload with HMAC-SHA256
async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Generate a webhook secret
export function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "whsec_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Deliver a webhook to a publisher
export async function deliverWebhook(
  supabase: SupabaseClient,
  publisherId: string,
  webhookUrl: string,
  webhookSecret: string,
  event: string,
  data: Record<string, unknown>
): Promise<boolean> {
  const payload: WebhookPayload = {
    event,
    data,
    timestamp: new Date().toISOString(),
  };

  const body = JSON.stringify(payload);
  const signature = await signPayload(body, webhookSecret);

  // Log delivery attempt
  const { data: delivery, error: insertErr } = await supabase
    .from("webhook_deliveries")
    .insert({
      publisher_id: publisherId,
      event_type: event,
      payload,
      status: "pending",
      attempts: 1,
      last_attempt_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertErr) {
    console.error("[webhook] Failed to log delivery:", insertErr.message);
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Opedd-Signature": signature,
        "X-Opedd-Event": event,
        "X-Opedd-Timestamp": payload.timestamp,
        "User-Agent": "Opedd-Webhook/1.0",
      },
      body,
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    const success = res.status >= 200 && res.status < 300;

    if (delivery?.id) {
      await supabase
        .from("webhook_deliveries")
        .update({
          status: success ? "delivered" : "failed",
          status_code: res.status,
        })
        .eq("id", delivery.id);
    }

    if (success) {
      console.log(`[webhook] Delivered ${event} to ${webhookUrl} (${res.status})`);
    } else {
      console.error(`[webhook] Failed ${event} to ${webhookUrl} (${res.status})`);
    }

    return success;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[webhook] Delivery error for ${event}:`, msg);

    if (delivery?.id) {
      await supabase
        .from("webhook_deliveries")
        .update({ status: "failed", status_code: 0 })
        .eq("id", delivery.id);
    }

    return false;
  }
}

// Check if a publisher has webhooks configured and deliver if so
export async function notifyPublisherWebhook(
  supabase: SupabaseClient,
  publisherId: string,
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  const { data: publisher } = await supabase
    .from("publishers")
    .select("webhook_url, webhook_secret")
    .eq("id", publisherId)
    .single();

  if (!publisher?.webhook_url || !publisher?.webhook_secret) {
    return; // No webhook configured, skip silently
  }

  // Fire and forget — don't block the main flow
  deliverWebhook(supabase, publisherId, publisher.webhook_url, publisher.webhook_secret, event, data).catch((err) => {
    console.error("[webhook] Background delivery error:", err);
  });
}
