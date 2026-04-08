const LOCAL_AUTH_PROVIDER = "local";
const GOOGLE_AUTH_PROVIDER = "google";

function normalizeAuthProvider(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === GOOGLE_AUTH_PROVIDER) return GOOGLE_AUTH_PROVIDER;
  return LOCAL_AUTH_PROVIDER;
}

function canAutoLinkGoogleAccount(user) {
  return normalizeAuthProvider(user?.authProvider) === GOOGLE_AUTH_PROVIDER;
}

module.exports = {
  LOCAL_AUTH_PROVIDER,
  GOOGLE_AUTH_PROVIDER,
  normalizeAuthProvider,
  canAutoLinkGoogleAccount,
};
