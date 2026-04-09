import { createClient } from "@supabase/supabase-js";

function readScopedSupabaseEnv(baseName) {
  const scopedValue = import.meta.env.PROD
    ? import.meta.env[`PROD_${baseName}`]
    : import.meta.env[`DEV_${baseName}`];
  return String(scopedValue || "").trim();
}

const SUPABASE_URL = readScopedSupabaseEnv("SUPABASE_URL").replace(/\/$/, "");
const SUPABASE_PUBLISHABLE_KEY = readScopedSupabaseEnv("SUPABASE_PUBLISHABLE_KEY");

export const hasSupabaseAuthConfig = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

let supabaseClient = null;

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

export function getSupabaseClient() {
  if (!hasSupabaseAuthConfig) return null;

  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
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
  return {
    url: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
  };
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
