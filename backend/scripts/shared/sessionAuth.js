const crypto = require("crypto");

const SESSION_COOKIE_NAME = "tastepick_session";
const SESSION_HASH_PATTERN = /^[a-f0-9]{64}$/i;

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || "").trim()).digest("hex");
}

function normalizeStoredSessionToken(token) {
  const normalized = String(token || "").trim();
  if (!normalized) return "";
  return SESSION_HASH_PATTERN.test(normalized) ? normalized.toLowerCase() : hashSessionToken(normalized);
}

function parseCookieHeader(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex < 0) return cookies;
      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      if (!key) return cookies;
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function readBearerToken(req) {
  const auth = String(req?.headers?.authorization || "");
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token.trim();
}

function readSessionToken(req) {
  const cookies = parseCookieHeader(req?.headers?.cookie || "");
  const cookieToken = String(cookies[SESSION_COOKIE_NAME] || "").trim();
  if (cookieToken) {
    return cookieToken;
  }
  return readBearerToken(req);
}

function isSecureRequest(req, publicOrigin = "") {
  const normalizedOrigin = String(publicOrigin || "").trim().toLowerCase();
  if (normalizedOrigin.startsWith("https://")) {
    return true;
  }

  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (forwardedProto) {
    return forwardedProto === "https";
  }

  return Boolean(req?.secure);
}

function buildSessionCookieOptions(req, { publicOrigin = "", maxAgeMs } = {}) {
  const options = {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: isSecureRequest(req, publicOrigin),
  };

  if (Number.isFinite(maxAgeMs) && maxAgeMs > 0) {
    options.maxAge = Math.floor(maxAgeMs);
  }

  return options;
}

function setSessionCookie(res, req, token, options = {}) {
  res.cookie(SESSION_COOKIE_NAME, token, buildSessionCookieOptions(req, options));
}

function clearSessionCookie(res, req, options = {}) {
  res.clearCookie(SESSION_COOKIE_NAME, buildSessionCookieOptions(req, options));
}

module.exports = {
  SESSION_COOKIE_NAME,
  buildSessionCookieOptions,
  clearSessionCookie,
  hashSessionToken,
  normalizeStoredSessionToken,
  readBearerToken,
  readSessionToken,
  setSessionCookie,
};
