import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O, 1/I

// Generate a cryptographically secure license key: OP-XXXX-XXXX
export function generateLicenseKey(): string {
  const randomValues = crypto.getRandomValues(new Uint8Array(8));
  let part1 = "";
  let part2 = "";
  for (let i = 0; i < 4; i++) {
    part1 += CHARS[randomValues[i] % CHARS.length];
    part2 += CHARS[randomValues[i + 4] % CHARS.length];
  }
  return `OP-${part1}-${part2}`;
}

// Generate a unique license key with collision check (retries up to 5 times)
export async function generateUniqueLicenseKey(
  supabase: SupabaseClient
): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateLicenseKey();
    const { data: existing } = await supabase
      .from("license_transactions")
      .select("id")
      .eq("license_key", candidate)
      .maybeSingle();
    if (!existing) return candidate;
  }
  return null;
}
