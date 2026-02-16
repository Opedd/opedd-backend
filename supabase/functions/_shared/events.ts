import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Event types for the license_events immutable ledger
export type EventType =
  | "license.issued"     // free license issued via issue-license
  | "license.paid"       // paid license issued via stripe-webhook
  | "license.verified"   // license key verified via verify-license
  | "license.revoked"    // license revoked (future)
  | "payment.initiated"  // Stripe checkout session created
  | "payment.completed"  // Stripe payment succeeded
  | "payment.failed"     // Stripe checkout expired/failed
  | "email.sent"         // Handshake Email sent
  | "email.failed"              // Handshake Email failed
  | "license.registered_onchain"; // license registered on-chain (Base)

export type ActorType = "system" | "buyer" | "publisher" | "stripe" | "cron";

export interface LicenseEvent {
  event_type: EventType;
  license_key?: string | null;
  transaction_id?: string | null;
  article_id?: string | null;
  publisher_id?: string | null;
  actor_type: ActorType;
  actor_id?: string | null;
  metadata?: Record<string, unknown>;
}

// Log an event to the license_events immutable ledger.
// Non-blocking: logs errors but doesn't throw.
export async function logEvent(
  supabase: SupabaseClient,
  event: LicenseEvent
): Promise<void> {
  const { error } = await supabase.from("license_events").insert({
    event_type: event.event_type,
    license_key: event.license_key ?? null,
    transaction_id: event.transaction_id ?? null,
    article_id: event.article_id ?? null,
    publisher_id: event.publisher_id ?? null,
    actor_type: event.actor_type,
    actor_id: event.actor_id ?? null,
    metadata: event.metadata ?? {},
  });

  if (error) {
    console.error("[events] Failed to log event:", event.event_type, error.message);
  }
}
