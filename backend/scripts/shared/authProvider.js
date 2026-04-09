const LOCAL_AUTH_PROVIDER = "local";
const GOOGLE_AUTH_PROVIDER = "google";
const KNOWN_AUTH_PROVIDERS = [LOCAL_AUTH_PROVIDER, GOOGLE_AUTH_PROVIDER];

function parseAuthProviders(value) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",");

  const normalized = new Set();
  for (const raw of rawValues) {
    const next = String(raw || "").trim().toLowerCase();
    if (KNOWN_AUTH_PROVIDERS.includes(next)) {
      normalized.add(next);
    }
  }

  if (normalized.size === 0) {
    normalized.add(LOCAL_AUTH_PROVIDER);
  }

  return KNOWN_AUTH_PROVIDERS.filter((provider) => normalized.has(provider));
}

function normalizeAuthProvider(value) {
  return parseAuthProviders(value).join(",");
}

function hasAuthProvider(userOrValue, provider) {
  if (!provider) return false;
  const currentValue =
    typeof userOrValue === "string" || Array.isArray(userOrValue)
      ? userOrValue
      : userOrValue?.authProvider;

  return parseAuthProviders(currentValue).includes(String(provider).trim().toLowerCase());
}

function canAutoLinkGoogleAccount(user) {
  return hasAuthProvider(user, GOOGLE_AUTH_PROVIDER);
}

function mergeAuthProvider(value, provider) {
  return normalizeAuthProvider([...parseAuthProviders(value), provider]);
}

module.exports = {
  LOCAL_AUTH_PROVIDER,
  GOOGLE_AUTH_PROVIDER,
  hasAuthProvider,
  mergeAuthProvider,
  normalizeAuthProvider,
  parseAuthProviders,
  canAutoLinkGoogleAccount,
};
