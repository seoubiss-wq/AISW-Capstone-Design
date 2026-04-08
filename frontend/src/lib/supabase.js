import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = String(import.meta.env.REACT_APP_SUPABASE_URL || "").trim().replace(/\/$/, "");
const SUPABASE_PUBLISHABLE_KEY = String(import.meta.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY || "").trim();

export const hasSupabaseAuthConfig = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

let supabaseClient = null;

export function getSupabaseClient() {
  if (!hasSupabaseAuthConfig) return null;

  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        persistSession: true,
      },
    });
  }

  return supabaseClient;
}

export function buildSupabaseGoogleRedirectUrl(locationLike = window.location) {
  if (!locationLike) return "";
  return `${locationLike.origin}${locationLike.pathname}`;
}

export function isSupabaseGoogleSession(session) {
  if (!session?.access_token) return false;

  const provider = String(session?.user?.app_metadata?.provider || "").trim().toLowerCase();
  if (provider === "google") return true;

  const providers = Array.isArray(session?.user?.app_metadata?.providers)
    ? session.user.app_metadata.providers
    : [];
  return providers.some((entry) => String(entry || "").trim().toLowerCase() === "google");
}

export function stripSupabaseAuthParams(urlString = window.location.href) {
  try {
    const url = new URL(urlString, window.location.origin);
    ["code", "error", "error_code", "error_description", "state"].forEach((key) => {
      url.searchParams.delete(key);
    });

    if (url.hash.startsWith("#")) {
      const hashParams = new URLSearchParams(url.hash.slice(1));
      [
        "access_token",
        "expires_at",
        "expires_in",
        "provider_token",
        "refresh_token",
        "token_type",
        "type",
      ].forEach((key) => {
        hashParams.delete(key);
      });
      const nextHash = hashParams.toString();
      url.hash = nextHash ? `#${nextHash}` : "";
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return window.location.pathname;
  }
}
