import crypto from 'crypto';

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function generateToken(): string {
  const random = crypto.randomBytes(16).toString('hex');
  return `OPEDD-${random}`;
}

/**
 * Builds the list of URLs to check for the verification token.
 *
 * For Substack publications (including custom domains), the token is
 * expected to appear on the /about page. We always try the /about
 * page first, then fall back to the root URL so this works for both
 * native Substack URLs and custom domains like opedd.com.
 */
function getCandidateUrls(url: string, sourceType?: string): string[] {
  const base = url.replace(/\/+$/, '');
  const candidates: string[] = [];

  // For known Substack sources — or any URL — check /about first.
  // Custom domains on Substack serve the same /about page structure,
  // so we always include it regardless of the hostname.
  if (sourceType === 'substack' || sourceType === 'rss') {
    candidates.push(`${base}/about`);
  }

  // Always try /about as a fallback even for unknown types — a custom
  // domain on Substack won't have "substack.com" in the URL.
  if (!candidates.includes(`${base}/about`)) {
    candidates.push(`${base}/about`);
  }

  // Finally, check the root URL itself.
  candidates.push(base);

  return candidates;
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': BROWSER_USER_AGENT },
      redirect: 'follow',
    });

    if (!response.ok) return null;

    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Verify a publication by checking whether the verification token
 * appears anywhere in the page content at the given URL.
 *
 * Tries the /about page first (Substack convention), then the root URL.
 */
export async function verifyPublication(
  url: string,
  token: string,
  sourceType?: string
): Promise<boolean> {
  const candidates = getCandidateUrls(url, sourceType);

  for (const candidate of candidates) {
    const html = await fetchPage(candidate);
    if (html && html.includes(token)) {
      return true;
    }
  }

  return false;
}
