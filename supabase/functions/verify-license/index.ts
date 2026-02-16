import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, errorResponse, successResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/auth.ts";
import { USE_LABELS } from "../_shared/email.ts";
import { logEvent } from "../_shared/events.ts";
import { verifyOnChain } from "../_shared/blockchain.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");

    if (!key || !key.startsWith("OP-")) {
      return errorResponse("Valid license key is required (format: OP-XXXX-XXXX)");
    }

    const supabase = createServiceClient();

    // Fetch the transaction
    const { data: tx, error: txError } = await supabase
      .from("license_transactions")
      .select("license_key, license_type, intended_use, buyer_name, buyer_organization, buyer_email, amount, status, created_at, article_id, blockchain_tx_hash")
      .eq("license_key", key)
      .single();

    if (txError || !tx) {
      return errorResponse("License not found", 404);
    }

    // Fetch the article
    const { data: article } = await supabase
      .from("licenses")
      .select("title, description, source_url, publisher_id")
      .eq("id", tx.article_id)
      .single();

    // Fetch the publisher
    let publisherName = "Unknown";
    if (article?.publisher_id) {
      const { data: publisher } = await supabase
        .from("publishers")
        .select("name")
        .eq("id", article.publisher_id)
        .single();
      if (publisher) publisherName = publisher.name;
    }

    // Log license.verified event
    await logEvent(supabase, {
      event_type: "license.verified",
      license_key: key,
      article_id: tx.article_id,
      publisher_id: article?.publisher_id,
      actor_type: "system",
      actor_id: null,
    });

    // On-chain verification (read-only, no gas)
    const onChainProof = await verifyOnChain(key);

    // Mask email for privacy: "al***@gmail.com"
    const emailParts = tx.buyer_email.split("@");
    const local = emailParts[0];
    const maskedLocal = local.length <= 2 ? local + "***" : local.substring(0, 2) + "***";
    const maskedEmail = maskedLocal + "@" + emailParts[1];

    // Build rights summary
    const rights = tx.license_type === "human"
      ? "Permission to republish this content for human readership with proper attribution to the original author and publisher. Non-exclusive, non-transferable."
      : "Permission to use this content for AI model training, fine-tuning, and data ingestion. Includes the right to process, analyze, and incorporate into training datasets. Non-exclusive, non-transferable.";

    const responseData: Record<string, unknown> = {
      license_key: tx.license_key,
      status: tx.status,
      license_type: tx.license_type,
      license_type_label: tx.license_type === "human" ? "Human Republication" : "AI Training",
      intended_use: tx.intended_use,
      intended_use_label: tx.intended_use ? USE_LABELS[tx.intended_use] || tx.intended_use : null,
      rights,
      licensee: {
        name: tx.buyer_name || null,
        organization: tx.buyer_organization || null,
        email: maskedEmail,
      },
      content: {
        title: article?.title || "Unknown",
        description: article?.description || null,
        source_url: article?.source_url || null,
        publisher: publisherName,
      },
      amount: tx.amount,
      currency: "usd",
      issued_at: tx.created_at,
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

    // For AI licenses, include machine-readable license object
    if (tx.license_type === "ai") {
      responseData.machine_readable = {
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

    return successResponse(responseData);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[verify-license] Error:", msg);
    return errorResponse("Internal server error", 500);
  }
});
