function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeSupabaseUrl(rawUrl) {
  return String(rawUrl || "").trim().replace(/\/$/, "");
}

function normalizeSupabaseProjectRef(rawValue) {
  return String(rawValue || "").trim().toLowerCase();
}

function readJsonWebTokenPayload(accessToken) {
  const normalizedAccessToken = String(accessToken || "").trim();
  const segments = normalizedAccessToken.split(".");
  if (segments.length < 2) {
    return null;
  }

  try {
    const payload = segments[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const paddedPayload = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    return JSON.parse(Buffer.from(paddedPayload, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function getSupabaseProjectRefFromUrl(supabaseUrl) {
  try {
    const hostname = new URL(normalizeSupabaseUrl(supabaseUrl)).hostname;
    return normalizeSupabaseProjectRef(hostname.split(".")[0]);
  } catch {
    return "";
  }
}

function getSupabaseProjectRefFromAccessToken(accessToken) {
  const payload = readJsonWebTokenPayload(accessToken);
  const issuer = String(payload?.iss || "").trim();
  if (!issuer) {
    return "";
  }

  return getSupabaseProjectRefFromUrl(issuer);
}

function buildSupabaseAuthConfig({ label, supabaseUrl, supabasePublishableKey }) {
  const normalizedSupabaseUrl = normalizeSupabaseUrl(supabaseUrl);
  const normalizedSupabasePublishableKey = String(supabasePublishableKey || "").trim();

  return {
    label: String(label || "").trim(),
    projectRef: getSupabaseProjectRefFromUrl(normalizedSupabaseUrl),
    supabaseUrl: normalizedSupabaseUrl,
    supabasePublishableKey: normalizedSupabasePublishableKey,
  };
}

function resolveSupabaseAuthConfigForAccessToken(accessToken, configs) {
  const normalizedConfigs = Array.isArray(configs)
    ? configs.filter((config) => config?.supabaseUrl && config?.supabasePublishableKey)
    : [];

  if (normalizedConfigs.length === 0) {
    return null;
  }

  const projectRefFromToken = getSupabaseProjectRefFromAccessToken(accessToken);
  if (projectRefFromToken) {
    const exactMatch = normalizedConfigs.find((config) => config.projectRef === projectRefFromToken);
    if (exactMatch) {
      return exactMatch;
    }
  }

  return normalizedConfigs[0];
}

function hasGoogleProvider(userPayload) {
  const provider = String(userPayload?.app_metadata?.provider || "").trim().toLowerCase();
  if (provider === "google") return true;

  const providers = Array.isArray(userPayload?.app_metadata?.providers)
    ? userPayload.app_metadata.providers
    : [];
  if (providers.some((entry) => String(entry || "").trim().toLowerCase() === "google")) {
    return true;
  }

  const identities = Array.isArray(userPayload?.identities) ? userPayload.identities : [];
  return identities.some((identity) => String(identity?.provider || "").trim().toLowerCase() === "google");
}

function buildFallbackName(email) {
  const localPart = String(email || "").split("@")[0].trim();
  return (localPart || "Google User").slice(0, 60);
}

function pickSupabaseDisplayName(userPayload) {
  const candidates = [
    userPayload?.user_metadata?.full_name,
    userPayload?.user_metadata?.name,
    userPayload?.user_metadata?.user_name,
    userPayload?.identities?.[0]?.identity_data?.full_name,
    userPayload?.identities?.[0]?.identity_data?.name,
    userPayload?.email,
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim().slice(0, 60);
    if (normalized) {
      return candidate === userPayload?.email ? buildFallbackName(normalized) : normalized;
    }
  }

  return "Google User";
}

async function readSupabaseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function fetchSupabaseUserProfile({
  accessToken,
  supabaseUrl,
  supabasePublishableKey,
  fetchImpl = fetch,
}) {
  const normalizedAccessToken = String(accessToken || "").trim();
  if (!normalizedAccessToken) {
    const error = new Error("Google OAuth access token is required.");
    error.status = 400;
    throw error;
  }

  const normalizedSupabaseUrl = normalizeSupabaseUrl(supabaseUrl);
  const normalizedSupabasePublishableKey = String(supabasePublishableKey || "").trim();
  if (!normalizedSupabaseUrl || !normalizedSupabasePublishableKey) {
    const error = new Error("Supabase Google OAuth configuration is missing.");
    error.status = 500;
    throw error;
  }

  const response = await fetchImpl(`${normalizedSupabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: normalizedSupabasePublishableKey,
      Authorization: `Bearer ${normalizedAccessToken}`,
    },
  });
  const payload = await readSupabaseJson(response);

  if (!response.ok) {
    const error = new Error(
      payload?.msg ||
      payload?.error_description ||
      payload?.error ||
      "Supabase Google user lookup failed.",
    );
    error.status = response.status || 401;
    throw error;
  }

  const email = normalizeEmail(payload?.email);
  if (!email) {
    const error = new Error("Google account email is missing from the Supabase session.");
    error.status = 401;
    throw error;
  }

  if (!hasGoogleProvider(payload)) {
    const error = new Error("Supabase session is not a Google login.");
    error.status = 401;
    throw error;
  }

  return {
    email,
    name: pickSupabaseDisplayName(payload),
    user: payload,
  };
}

module.exports = {
  buildSupabaseAuthConfig,
  fetchSupabaseUserProfile,
  getSupabaseProjectRefFromAccessToken,
  getSupabaseProjectRefFromUrl,
  hasGoogleProvider,
  normalizeSupabaseUrl,
  pickSupabaseDisplayName,
  resolveSupabaseAuthConfigForAccessToken,
};
