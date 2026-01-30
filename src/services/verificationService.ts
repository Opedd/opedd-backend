import crypto from 'crypto';

export function generateToken(): string {
  const random = crypto.randomBytes(16).toString('hex');
  return `OPEDD-${random}`;
}

export async function verifyPublication(url: string, token: string): Promise<boolean> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch publication URL: ${response.status}`);
  }

  const html = await response.text();
  return html.includes(token);
}
