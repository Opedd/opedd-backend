import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, errorResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/auth.ts";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const url = new URL(req.url);
    const licenseKey = url.searchParams.get("key");

    if (!licenseKey || !licenseKey.startsWith("OP-")) {
      return errorResponse("Valid license key is required (format: OP-XXXX-XXXX)");
    }

    const supabase = createServiceClient();

    // Fetch completed transaction
    const { data: tx, error: txError } = await supabase
      .from("license_transactions")
      .select("license_key, license_type, status, amount, created_at, article_id, buyer_name, buyer_email, buyer_organization, intended_use")
      .eq("license_key", licenseKey)
      .eq("status", "completed")
      .single();

    if (txError || !tx) {
      return errorResponse("License not found or not completed", 404);
    }

    // Fetch article + publisher
    const { data: article } = await supabase
      .from("licenses")
      .select("title, source_url, publisher_id")
      .eq("id", tx.article_id)
      .single();

    let publisherName = "Unknown Publisher";
    if (article?.publisher_id) {
      const { data: pub } = await supabase
        .from("publishers")
        .select("name, website_url")
        .eq("id", article.publisher_id)
        .single();
      if (pub) publisherName = pub.name;
    }

    // Verification count
    const { count: verifyCount } = await supabase
      .from("license_events")
      .select("id", { count: "exact", head: true })
      .eq("license_key", licenseKey)
      .eq("event_type", "license.verified");

    // Generate PDF
    const pdf = buildCertificatePDF({
      licenseKey: tx.license_key,
      licenseType: tx.license_type,
      amount: tx.amount,
      issuedAt: tx.created_at,
      articleTitle: article?.title || "Unknown",
      articleUrl: article?.source_url || null,
      publisherName,
      buyerName: tx.buyer_name || null,
      buyerEmail: tx.buyer_email,
      buyerOrganization: tx.buyer_organization || null,
      intendedUse: tx.intended_use || null,
      verificationCount: verifyCount || 0,
    });

    const pdfBytes = pdf.output("arraybuffer");

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="opedd-certificate-${licenseKey}.pdf"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[certificate] Error:", msg);
    return errorResponse("Internal server error", 500);
  }
});

interface CertificateData {
  licenseKey: string;
  licenseType: string;
  amount: number;
  issuedAt: string;
  articleTitle: string;
  articleUrl: string | null;
  publisherName: string;
  buyerName: string | null;
  buyerEmail: string;
  buyerOrganization: string | null;
  intendedUse: string | null;
  verificationCount: number;
}

const USE_LABELS: Record<string, string> = {
  personal: "Personal Use",
  editorial: "Editorial Use",
  commercial: "Commercial Use",
  ai_training: "AI Training",
  corporate: "Corporate Use",
};

function buildCertificatePDF(data: CertificateData): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const w = doc.internal.pageSize.getWidth();   // 297
  const h = doc.internal.pageSize.getHeight();   // 210
  const cx = w / 2;

  // Colors
  const navy = [26, 32, 44];     // #1a202c
  const blue = [49, 130, 206];   // #3182ce
  const gray = [113, 128, 150];  // #718096
  const lightGray = [226, 232, 240]; // #e2e8f0
  const gold = [214, 158, 46];   // #d69e2e

  // === Border ===
  doc.setDrawColor(...gold);
  doc.setLineWidth(1.5);
  doc.rect(10, 10, w - 20, h - 20);
  doc.setLineWidth(0.5);
  doc.rect(13, 13, w - 26, h - 26);

  // === Header ===
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...blue);
  doc.text("OPEDD PROTOCOL", cx, 28, { align: "center" });

  doc.setFontSize(28);
  doc.setTextColor(...navy);
  doc.text("Certificate of License", cx, 42, { align: "center" });

  // Thin line under header
  doc.setDrawColor(...gold);
  doc.setLineWidth(0.8);
  doc.line(cx - 60, 47, cx + 60, 47);

  // === License Key (prominent) ===
  doc.setFontSize(16);
  doc.setTextColor(...blue);
  doc.text(data.licenseKey, cx, 58, { align: "center" });

  // === License type badge ===
  const typeLabel = data.licenseType === "human" ? "HUMAN REPUBLICATION LICENSE" : "AI TRAINING LICENSE";
  doc.setFontSize(10);
  doc.setTextColor(...gray);
  doc.text(typeLabel, cx, 65, { align: "center" });

  // === Content section ===
  let y = 78;
  const leftX = 40;
  const rightX = w - 40;
  const valueX = 110;

  const addField = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...gray);
    doc.text(label, leftX, y);

    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(10);
    doc.setTextColor(...navy);
    // Truncate long values
    const maxLen = 70;
    const displayVal = value.length > maxLen ? value.substring(0, maxLen) + "..." : value;
    doc.text(displayVal, valueX, y);
    y += 8;
  };

  addField("Content:", data.articleTitle, true);
  addField("Publisher:", data.publisherName);

  if (data.buyerName || data.buyerOrganization) {
    const licensee = [data.buyerName, data.buyerOrganization].filter(Boolean).join(", ");
    addField("Licensed to:", licensee, true);
  } else {
    addField("Licensed to:", data.buyerEmail);
  }

  if (data.intendedUse) {
    addField("Intended Use:", USE_LABELS[data.intendedUse] || data.intendedUse);
  }

  addField("Amount:", `$${Number(data.amount).toFixed(2)} USD`);

  const issuedDate = new Date(data.issuedAt).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  addField("Issued:", issuedDate);
  addField("Verifications:", String(data.verificationCount));

  // === Source URL ===
  if (data.articleUrl) {
    y += 2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...gray);
    const displayUrl = data.articleUrl.length > 90 ? data.articleUrl.substring(0, 90) + "..." : data.articleUrl;
    doc.text(`Source: ${displayUrl}`, cx, y, { align: "center" });
  }

  // === Footer ===
  doc.setDrawColor(...lightGray);
  doc.setLineWidth(0.3);
  doc.line(40, h - 40, w - 40, h - 40);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...gray);
  doc.text(
    "This certificate was generated by the Opedd Decentralized Content Rights Protocol.",
    cx, h - 33, { align: "center" }
  );
  doc.text(
    `Verify at: opedd.com/verify/${data.licenseKey}`,
    cx, h - 28, { align: "center" }
  );
  doc.text(
    `Generated: ${new Date().toISOString().split("T")[0]}`,
    cx, h - 23, { align: "center" }
  );

  return doc;
}
