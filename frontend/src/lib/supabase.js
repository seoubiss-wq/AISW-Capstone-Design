import { createClient } from "@supabase/supabase-js";
import { resolveApiUrl } from "./api";

const DEFAULT_SUPABASE_CONFIG = {
  url: String(__SUPABASE_URL__ || "").trim().replace(/\/$/, ""),
  publishableKey: String(__SUPABASE_PUBLISHABLE_KEY__ || "").trim(),
};

let supabaseClient = null;
let supabaseAuthConfig = { ...DEFAULT_SUPABASE_CONFIG };
let supabaseAuthConfigHydrationPromise = null;

function createMemoryStorage() {
  const map = new Map();

  return {
    get length() {
      return map.size;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function getBrowserStorageCandidates() {
  if (typeof window === "undefined") return [];
  try {
    return [window.localStorage, window.sessionStorage].filter((storage) => storage && typeof storage.length === "number");
  } catch {
    return [];
  }
}

export function buildSupabaseStoragePrefix(supabaseUrl = SUPABASE_URL) {
  try {
    const hostname = new URL(String(supabaseUrl || "").trim()).hostname;
    const projectRef = hostname.split(".")[0];
    return projectRef ? `sb-${projectRef}-auth-token` : "";
  } catch {
    return "";
  }
}

export function clearSupabaseAuthStorage(storages = getBrowserStorageCandidates(), supabaseUrl = SUPABASE_URL) {
  const prefix = buildSupabaseStoragePrefix(supabaseUrl);
  if (!prefix) return;

  for (const storage of storages) {
    try {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) {
          keys.push(key);
        }
      }
      keys.forEach((key) => storage.removeItem(key));
    } catch {}
  }
}

export async function clearSupabaseBridgeSession(client = getSupabaseClient()) {
  try {
    await client?.auth?.signOut?.({ scope: "local" });
  } catch {}

  clearSupabaseAuthStorage();
}

export function getSupabaseBridgeStorage() {
  if (typeof window === "undefined") {
    return createMemoryStorage();
  }

  try {
    if (window.sessionStorage && typeof window.sessionStorage.length === "number") {
      return window.sessionStorage;
    }
  } catch {}

  return createMemoryStorage();
}

function normalizeSupabaseAuthConfig(config) {
  return {
    url: String(config?.url || config?.supabaseUrl || "").trim().replace(/\/$/, ""),
    publishableKey: String(
      config?.publishableKey || config?.supabasePublishableKey || "",
    ).trim(),
  };
}

function applySupabaseAuthConfig(nextConfig) {
  const normalizedNextConfig = normalizeSupabaseAuthConfig(nextConfig);
  const prevConfigKey = `${supabaseAuthConfig.url}|${supabaseAuthConfig.publishableKey}`;
  const nextConfigKey = `${normalizedNextConfig.url}|${normalizedNextConfig.publishableKey}`;

  supabaseAuthConfig = normalizedNextConfig;
  if (prevConfigKey !== nextConfigKey) {
    supabaseClient = null;
  }
}

export function hasSupabaseAuthConfig() {
  return Boolean(supabaseAuthConfig.url && supabaseAuthConfig.publishableKey);
}

export async function hydrateSupabaseAuthConfig(fetchImpl = fetch) {
  if (!supabaseAuthConfigHydrationPromise) {
    supabaseAuthConfigHydrationPromise = (async () => {
      try {
        const response = await fetchImpl(resolveApiUrl("/auth/config"), {
          credentials: "include",
        });

        if (response.ok) {
          const payload = await response.json();
          const nextConfig = normalizeSupabaseAuthConfig(payload);
          if (nextConfig.url && nextConfig.publishableKey) {
            applySupabaseAuthConfig(nextConfig);
            return getSupabaseAuthConfig();
          }
        }
      } catch {}

      return getSupabaseAuthConfig();
    })();
  }

  return supabaseAuthConfigHydrationPromise;
}

export function getSupabaseClient() {
  if (!hasSupabaseAuthConfig()) return null;

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseAuthConfig.url, supabaseAuthConfig.publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: true,
        flowType: "pkce",
        persistSession: true,
        storage: getSupabaseBridgeStorage(),
      },
    });
  }

  return supabaseClient;
}

export function getSupabaseAuthConfig() {
  return { ...supabaseAuthConfig };
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
