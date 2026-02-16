// Shared email utilities: HTML escaping, Handshake Email builder, send helper

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const USE_LABELS: Record<string, string> = {
  personal: "Personal Use",
  editorial: "Editorial / Journalism",
  commercial: "Commercial Use",
  ai_training: "AI Training / Ingestion",
  corporate: "Corporate / Enterprise",
};

export interface HandshakeEmailParams {
  licenseKey: string;
  articleTitle: string;
  articleUrl: string | null;
  publisherName: string;
  buyerName: string | null;
  buyerOrganization: string | null;
  buyerEmail: string;
  licenseType: "human" | "ai";
  intendedUse: string | null;
  amount: number;
  verifyUrl: string;
  issuedAt: string;
}

export function buildHandshakeEmail(params: HandshakeEmailParams): string {
  const {
    licenseKey, articleTitle, articleUrl, publisherName,
    buyerName, buyerOrganization, buyerEmail, licenseType,
    intendedUse, amount, verifyUrl, issuedAt,
  } = params;

  const typeLabel = licenseType === "human" ? "Human Republication" : "AI Training";
  const useLabel = intendedUse ? (USE_LABELS[intendedUse] || intendedUse) : "Not specified";
  const safeName = buyerName ? escapeHtml(buyerName) : null;
  const safeOrg = buyerOrganization ? escapeHtml(buyerOrganization) : null;
  const safeTitle = escapeHtml(articleTitle);
  const safePublisher = escapeHtml(publisherName);
  const licensee = safeName
    ? (safeOrg ? `${safeName} (${safeOrg})` : safeName)
    : escapeHtml(buyerEmail);
  const dateStr = new Date(issuedAt).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const rightsHuman = `
    <p style="margin:0 0 8px">This license grants you permission to republish the above content for human readership.</p>
    <ul style="margin:0;padding-left:20px;color:#374151">
      <li>Must include proper attribution to the original author and publisher</li>
      <li>Non-exclusive, non-transferable</li>
      <li>Single-use for the purpose specified above</li>
    </ul>`;

  const rightsAi = `
    <p style="margin:0 0 8px">This license grants you permission to use the above content for AI model training, fine-tuning, and data ingestion.</p>
    <ul style="margin:0;padding-left:20px;color:#374151">
      <li>Includes the right to process, analyze, and incorporate into training datasets</li>
      <li>Non-exclusive, non-transferable</li>
      <li>Covers the specific content identified above</li>
    </ul>`;

  const aiJsonBlock = licenseType === "ai" ? `
    <div style="margin-top:32px;padding:24px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px">
      <p style="margin:0 0 12px;font-weight:700;color:#166534;font-size:14px">Machine-Readable License (license.json)</p>
      <p style="margin:0 0 12px;font-size:12px;color:#166534">Include this in your training data manifest for compliance verification.</p>
      <pre style="margin:0;padding:16px;background:#052e16;color:#4ade80;border-radius:8px;font-size:12px;line-height:1.5;overflow-x:auto;white-space:pre-wrap">${JSON.stringify({
        "@context": "https://opedd.com/schema/v1",
        protocol: "opedd",
        version: "1.0",
        license_id: licenseKey,
        license_type: "ai_training",
        content_title: articleTitle,
        content_url: articleUrl,
        publisher: publisherName,
        licensee: buyerName,
        licensee_organization: buyerOrganization,
        issued_at: issuedAt,
        status: "completed",
      }, null, 2)}</pre>
    </div>` : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#ffffff">

  <!-- Header -->
  <div style="background:#040042;padding:40px 32px;text-align:center">
    <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:3px;color:rgba(255,255,255,0.5)">Opedd Protocol</p>
    <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700">License Confirmed</h1>
  </div>

  <!-- License Key -->
  <div style="text-align:center;padding:40px 32px;background:#fafafa;border-bottom:1px solid #e5e7eb">
    <p style="margin:0 0 12px;font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#9ca3af">Your License Key</p>
    <p style="margin:0;font-family:'Courier New',monospace;font-size:36px;font-weight:700;letter-spacing:6px;color:#040042">${licenseKey}</p>
  </div>

  <!-- Details Table -->
  <div style="padding:32px">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:12px 0;color:#9ca3af;width:140px">Content</td>
        <td style="padding:12px 0;color:#111827;font-weight:600">${safeTitle}</td>
      </tr>
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:12px 0;color:#9ca3af">Publisher</td>
        <td style="padding:12px 0;color:#111827">${safePublisher}</td>
      </tr>
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:12px 0;color:#9ca3af">Licensed To</td>
        <td style="padding:12px 0;color:#111827">${licensee}</td>
      </tr>
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:12px 0;color:#9ca3af">License Type</td>
        <td style="padding:12px 0;color:#111827">${typeLabel}</td>
      </tr>
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:12px 0;color:#9ca3af">Permitted Use</td>
        <td style="padding:12px 0;color:#111827">${useLabel}</td>
      </tr>
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:12px 0;color:#9ca3af">Amount</td>
        <td style="padding:12px 0;color:#111827;font-weight:600">$${amount.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding:12px 0;color:#9ca3af">Issued</td>
        <td style="padding:12px 0;color:#111827">${dateStr}</td>
      </tr>
    </table>
  </div>

  <!-- Rights -->
  <div style="padding:0 32px 32px">
    <div style="padding:24px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px">
      <p style="margin:0 0 12px;font-weight:700;color:#1e40af;font-size:14px">What This License Permits</p>
      <div style="font-size:13px;color:#374151;line-height:1.6">
        ${licenseType === "human" ? rightsHuman : rightsAi}
      </div>
    </div>
  </div>

  ${aiJsonBlock}

  <!-- Verify Button -->
  <div style="padding:${licenseType === "ai" ? "32px" : "0"} 32px 32px;text-align:center">
    <a href="${verifyUrl}" style="display:inline-block;background:#4A26ED;color:#ffffff;padding:14px 40px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">Verify This License</a>
    <p style="margin:12px 0 0;font-size:12px;color:#9ca3af">Anyone can verify the authenticity of this license at any time.</p>
  </div>

  <!-- Footer -->
  <div style="padding:24px 32px;background:#fafafa;border-top:1px solid #e5e7eb;text-align:center">
    <p style="margin:0;font-size:12px;color:#9ca3af">
      Powered by <span style="color:#040042;font-weight:600">Opedd Protocol</span>
    </p>
  </div>

</div>
</body>
</html>`;
}

// Send an email via Resend API. Non-blocking — returns success/failure but doesn't throw.
export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const emailFrom = Deno.env.get("EMAIL_FROM") || "Opedd <onboarding@resend.dev>";

  if (!resendApiKey) {
    console.warn("[email] RESEND_API_KEY not set — skipping email");
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: emailFrom,
        to: params.to,
        subject: params.subject,
        html: params.html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[email] Resend error:", res.status, errText);
      return false;
    }

    console.log("[email] Sent to", params.to);
    return true;
  } catch (err) {
    console.error("[email] Send failed:", err);
    return false;
  }
}
