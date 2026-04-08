const DEV_CORS_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
];

function normalizeOrigin(origin) {
  return String(origin || "").trim().replace(/\/$/, "");
}

function buildAllowedCorsOrigins({
  devOrigins = DEV_CORS_ORIGINS,
  apiPublicOrigin = "",
  extraOrigins = "",
} = {}) {
  const allowedOrigins = new Set(devOrigins.map((origin) => normalizeOrigin(origin)).filter(Boolean));

  if (apiPublicOrigin) {
    allowedOrigins.add(normalizeOrigin(apiPublicOrigin));
  }

  String(extraOrigins)
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean)
    .forEach((origin) => allowedOrigins.add(origin));

  return allowedOrigins;
}

function resolveCorsOrigin(origin, allowedOrigins) {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  return allowedOrigins.has(normalizedOrigin) ? normalizedOrigin : false;
}

module.exports = {
  DEV_CORS_ORIGINS,
  buildAllowedCorsOrigins,
  normalizeOrigin,
  resolveCorsOrigin,
};
