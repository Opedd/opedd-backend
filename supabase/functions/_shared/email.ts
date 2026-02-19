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

const LOGO_URL = "https://djdzcciayennqchjgybx.supabase.co/storage/v1/object/public/brand/opedd-logo-inverse.png";

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
    <p style="margin:0 0 8px;font-size:13px;color:#374151">This license grants you permission to republish the above content for human readership.</p>
    <ul style="margin:0;padding-left:20px;color:#374151;font-size:13px;line-height:1.6">
      <li>Must include proper attribution to the original author and publisher</li>
      <li>Non-exclusive, non-transferable</li>
      <li>Single-use for the purpose specified above</li>
    </ul>`;

  const rightsAi = `
    <p style="margin:0 0 8px;font-size:13px;color:#374151">This license grants you permission to use the above content for AI model training, fine-tuning, and data ingestion.</p>
    <ul style="margin:0;padding-left:20px;color:#374151;font-size:13px;line-height:1.6">
      <li>Includes the right to process, analyze, and incorporate into training datasets</li>
      <li>Non-exclusive, non-transferable</li>
      <li>Covers the specific content identified above</li>
    </ul>`;

  const aiJsonBlock = licenseType === "ai" ? `
      <div style="margin-top:24px;padding:20px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px">
        <p style="margin:0 0 10px;font-weight:700;color:#166534;font-size:13px">Machine-Readable License (license.json)</p>
        <p style="margin:0 0 10px;font-size:11px;color:#166534">Include this in your training data manifest for compliance verification.</p>
        <pre style="margin:0;padding:14px;background:#052e16;color:#4ade80;border-radius:8px;font-size:11px;line-height:1.5;overflow-x:auto;white-space:pre-wrap">${JSON.stringify({
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

  const row = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:10px 0;color:#9ca3af;font-size:13px;width:130px;vertical-align:top;border-bottom:1px solid #f3f4f6">${label}</td><td style="padding:10px 0;color:#1f2937;font-size:14px;${bold ? "font-weight:600;" : ""}border-bottom:1px solid #f3f4f6">${value}</td></tr>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');</style>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased">
<div style="max-width:600px;margin:0 auto">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">License Confirmed — ${licenseKey}</div>
<div style="padding:32px 16px">
<div style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#040042 0%,#0A0066 100%);padding:40px 32px;text-align:center">
    <img src="${LOGO_URL}" alt="Opedd" width="120" style="display:inline-block;margin:0 0 20px" />
    <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px">License Confirmed</h1>
  </div>

  <!-- License Key -->
  <div style="text-align:center;padding:32px;background:linear-gradient(180deg,#f9fafb 0%,#ffffff 100%)">
    <p style="margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#9ca3af">Your License Key</p>
    <div style="display:inline-block;background:linear-gradient(135deg,#040042 0%,#0A0066 100%);border-radius:12px;padding:16px 28px">
      <p style="margin:0;font-family:'Courier New',monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#ffffff">${licenseKey}</p>
    </div>
  </div>

  <!-- Details Table -->
  <div style="padding:24px 32px 32px">
    <table style="width:100%;border-collapse:collapse">
      ${row("Content", safeTitle, true)}
      ${row("Publisher", safePublisher)}
      ${row("Licensed To", licensee)}
      ${row("License Type", typeLabel)}
      ${row("Permitted Use", useLabel)}
      ${row("Amount", `$${amount.toFixed(2)}`, true)}
      ${row("Issued", dateStr)}
    </table>
  </div>

  <!-- Rights -->
  <div style="padding:0 32px 28px">
    <div style="padding:20px 24px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px">
      <p style="margin:0 0 10px;font-weight:700;color:#1e40af;font-size:13px">What This License Permits</p>
      ${licenseType === "human" ? rightsHuman : rightsAi}
    </div>
    ${aiJsonBlock}
  </div>

  <!-- Verify Button -->
  <div style="padding:0 32px 32px;text-align:center">
    <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#4A26ED 0%,#7C3AED 100%);color:#ffffff;padding:14px 44px;border-radius:12px;text-decoration:none;font-weight:600;font-size:15px;letter-spacing:0.2px;box-shadow:0 4px 14px rgba(74,38,237,0.3)">Verify This License</a>
    <p style="margin:12px 0 0;font-size:12px;color:#9ca3af">Anyone can verify the authenticity of this license at any time.</p>
  </div>

  <!-- Footer -->
  <div style="padding:24px 32px;border-top:1px solid #f0f0f5;text-align:center">
    <p style="margin:0 0 6px;font-size:12px;color:#9ca3af"><a href="https://opedd.com" style="color:#4A26ED;text-decoration:none;font-weight:600">opedd.com</a></p>
    <p style="margin:0;font-size:11px;color:#d1d5db">Content rights infrastructure for the AI era</p>
  </div>

</div>
</div>
</div>
</body>
</html>`;
}

// Shared email wrapper for simple notification emails (team invites, etc.)
export function buildBrandedEmail(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');</style>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased">
<div style="max-width:600px;margin:0 auto">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(title)}</div>
<div style="padding:32px 16px">
<div style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,#040042 0%,#0A0066 100%);padding:40px 32px;text-align:center">
    <img src="${LOGO_URL}" alt="Opedd" width="120" style="display:inline-block;margin:0 0 20px" />
    <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px">${escapeHtml(title)}</h1>
  </div>
  <div style="padding:36px 32px 32px">
    ${bodyHtml}
  </div>
  <div style="padding:24px 32px;border-top:1px solid #f0f0f5;text-align:center">
    <p style="margin:0 0 6px;font-size:12px;color:#9ca3af"><a href="https://opedd.com" style="color:#4A26ED;text-decoration:none;font-weight:600">opedd.com</a></p>
    <p style="margin:0;font-size:11px;color:#d1d5db">Content rights infrastructure for the AI era</p>
  </div>
</div>
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
