import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Create a service-role Supabase client
export function createServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

// Authenticate a request and return the user + publisher
export async function authenticatePublisher(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { user: null, publisher: null, error: "No authorization token provided" };
  }

  const token = authHeader.substring(7).trim();
  if (!token || token.length < 20) {
    return { user: null, publisher: null, error: "Invalid token format" };
  }

  const supabase = createServiceClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return { user: null, publisher: null, error: "Invalid or expired token" };
  }

  // Fast path: direct owner lookup
  const { data: publisher } = await supabase
    .from("publishers")
    .select("id, name, api_key, default_human_price, default_ai_price, website_url, description, stripe_account_id, stripe_onboarding_complete, webhook_url, webhook_secret")
    .eq("user_id", user.id)
    .single();

  if (publisher) {
    return { user, publisher, role: "owner" as const, error: null };
  }

  // Fallback: check team_members for this user
  const { data: membership } = await supabase
    .from("team_members")
    .select("publisher_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (membership) {
    const { data: teamPublisher } = await supabase
      .from("publishers")
      .select("id, name, api_key, default_human_price, default_ai_price, website_url, description, stripe_account_id, stripe_onboarding_complete, webhook_url, webhook_secret")
      .eq("id", membership.publisher_id)
      .single();

    if (teamPublisher) {
      return { user, publisher: teamPublisher, role: membership.role as "owner" | "member", error: null };
    }
  }

  return { user, publisher: null, role: null, error: "Publisher profile not found" };
}
